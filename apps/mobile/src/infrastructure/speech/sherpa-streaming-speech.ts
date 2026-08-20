import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { createPcmLiveStream, type PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import { createSTT, type SttEngine } from 'react-native-sherpa-onnx/stt';
import {
  createVoiceActivityDetector,
  type VoiceActivityDetector,
  type VoiceActivitySegment,
} from 'sherpa-vad';
import {
  StreamingSpeechError,
  type StreamingSpeechObserver,
  type StreamingSpeechPort,
} from '../../application/ports/streaming-speech';
import type { SpeechModelManager } from '../../application/speech-model-manager';
import { SPEECH_MODEL_RUNTIME_DIRS } from '../../application/speech-model';
import { createMobileLogger, sanitizeDiagnosticMessage } from '../logging/mobile-logger';

const SAMPLE_RATE = 16_000;
const BUFFER_SIZE_FRAMES = 1_600;
const logger = createMobileLogger('streaming-speech');

type ActiveSession = {
  generation: number;
  mic: PcmLiveStreamHandle;
  vad: VoiceActivityDetector;
  engineReady: Promise<SttEngine>;
  observer: StreamingSpeechObserver;
  transcripts: string[];
  removeDataListener: () => void;
  removeErrorListener: () => void;
  processing: Promise<void>;
  failure: StreamingSpeechError | null;
  acceptingAudio: boolean;
  cancelled: boolean;
  finalizing: boolean;
};

function joinSegments(segments: readonly string[]): string {
  return segments.reduce((combined, segment) => {
    const next = segment.trim();
    if (!next) return combined;
    if (!combined) return next;
    if (/\s$/.test(combined) || /^\s/.test(next)) return combined + next;
    const left = combined[combined.length - 1]!;
    const right = next[0]!;
    const isCjk = (value: string) => /[\u3400-\u9fff]/.test(value);
    return isCjk(left) || isCjk(right) ? combined + next : `${combined} ${next}`;
  }, '');
}

export class SherpaStreamingSpeech implements StreamingSpeechPort {
  private engine: SttEngine | null = null;
  private engineLoad: Promise<SttEngine> | null = null;
  private active: ActiveSession | null = null;
  private generation = 0;

  constructor(private readonly modelManager: SpeechModelManager) {}

  isAvailable(): boolean {
    return true;
  }

  async prepare(): Promise<void> {
    const modelPath = await this.requireModelPath();
    await this.getOrCreateEngine(modelPath);
  }

  async getPermissions(): Promise<{ granted: boolean }> {
    const result = await getRecordingPermissionsAsync();
    return { granted: result.granted };
  }

  async requestPermissions(): Promise<{ granted: boolean }> {
    const result = await requestRecordingPermissionsAsync();
    return { granted: result.granted };
  }

  async start(observer: StreamingSpeechObserver): Promise<void> {
    if (this.active) throw new StreamingSpeechError('busy');
    const generation = ++this.generation;
    const modelPath = await this.requireModelPath();
    let vad: VoiceActivityDetector | null = null;
    let mic: PcmLiveStreamHandle | null = null;

    try {
      vad = await createVoiceActivityDetector({
        modelPath: `${modelPath}/${SPEECH_MODEL_RUNTIME_DIRS.vad}/silero_vad.onnx`,
        sampleRate: SAMPLE_RATE,
        threshold: 0.5,
        minSilenceDuration: 0.25,
        minSpeechDuration: 0.25,
        windowSize: 512,
        maxSpeechDuration: 5,
        numThreads: 1,
        provider: 'cpu',
      });
      const engineReady = this.getOrCreateEngine(modelPath);
      mic = createPcmLiveStream({
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        bufferSizeFrames: BUFFER_SIZE_FRAMES,
      });
      const session: ActiveSession = {
        generation,
        mic,
        vad,
        engineReady,
        observer,
        transcripts: [],
        removeDataListener: () => {},
        removeErrorListener: () => {},
        processing: Promise.resolve(),
        failure: null,
        acceptingAudio: true,
        cancelled: false,
        finalizing: false,
      };
      session.removeDataListener = mic.onData((samples, sampleRate) => {
        if (!session.acceptingAudio || this.active !== session) return;
        session.processing = session.processing
          .then(async () => {
            if (session.cancelled) return;
            if (sampleRate !== SAMPLE_RATE) {
              throw new Error(`Unexpected PCM sample rate: ${sampleRate}`);
            }
            const segments = await session.vad.acceptWaveform(Array.from(samples));
            await this.recognizeSegments(session, segments);
          })
          .catch((error: unknown) => {
            this.signalFailure(session, 'recognition-failed', error);
          });
      });
      session.removeErrorListener = mic.onError((message) => {
        this.signalFailure(session, 'capture-failed', new Error(message));
      });
      void engineReady.catch((error: unknown) => {
        this.signalFailure(session, 'model-load-failed', error);
      });
      this.active = session;
      await mic.start();
      logger.info('stream_started', {
        generation,
        sample_rate: SAMPLE_RATE,
        buffer_frames: BUFFER_SIZE_FRAMES,
        recognition: 'sense_voice_vad',
      });
    } catch (error) {
      if (this.active?.generation === generation) this.active = null;
      await this.releasePartialSession(mic, vad);
      if (error instanceof StreamingSpeechError) throw error;
      logger.error('stream_start_failed', {
        generation,
        diagnostic: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw new StreamingSpeechError(vad ? 'capture-failed' : 'model-load-failed');
    }
  }

  async stop(): Promise<string> {
    const session = this.active;
    if (!session) throw new StreamingSpeechError('interrupted');
    session.finalizing = true;

    try {
      try {
        await session.mic.stop();
      } catch (error) {
        session.failure = new StreamingSpeechError('capture-failed');
        logger.error('stream_stop_capture_failed', {
          generation: session.generation,
          diagnostic: sanitizeDiagnosticMessage(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
      session.acceptingAudio = false;
      session.removeDataListener();
      session.removeErrorListener();
      if (this.active === session) this.active = null;
      await session.processing;
      if (session.failure) throw session.failure;
      await this.recognizeSegments(session, await session.vad.flush());
      const result = joinSegments(session.transcripts);
      logger.info('stream_finalized', {
        generation: session.generation,
        segment_count: session.transcripts.length,
        has_text: result.length > 0,
      });
      return result;
    } catch (error) {
      if (error instanceof StreamingSpeechError) throw error;
      logger.error('stream_finalize_failed', {
        generation: session.generation,
        diagnostic: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw new StreamingSpeechError('recognition-failed');
    } finally {
      session.acceptingAudio = false;
      session.removeDataListener();
      session.removeErrorListener();
      if (this.active === session) this.active = null;
      await this.ignoreError(() => session.vad.destroy());
    }
  }

  async cancel(): Promise<void> {
    const session = this.active;
    if (!session) return;
    this.active = null;
    session.acceptingAudio = false;
    session.cancelled = true;
    session.removeDataListener();
    session.removeErrorListener();
    await this.ignoreError(() => session.mic.stop());
    await this.ignoreError(() => session.processing);
    await this.ignoreError(() => session.vad.destroy());
    logger.info('stream_cancelled', { generation: session.generation });
  }

  async dispose(): Promise<void> {
    await this.cancel();
    const loading = this.engineLoad;
    if (loading) await this.ignoreError(async () => void (await loading));
    const engine = this.engine;
    this.engine = null;
    this.engineLoad = null;
    if (engine) await this.ignoreError(() => engine.destroy());
  }

  private async requireModelPath(): Promise<string> {
    const modelPath = await this.modelManager.getReadyPath();
    if (!modelPath) throw new StreamingSpeechError('model-not-ready');
    return modelPath;
  }

  private async getOrCreateEngine(modelPath: string): Promise<SttEngine> {
    if (this.engine) return this.engine;
    if (this.engineLoad) return this.engineLoad;

    const loading = createSTT({
      modelPath: {
        type: 'file',
        path: `${modelPath}/${SPEECH_MODEL_RUNTIME_DIRS.asr}`,
      },
      preferInt8: true,
      modelType: 'sense_voice',
      numThreads: 2,
      provider: 'cpu',
      dither: 0,
      debug: false,
      modelOptions: {
        senseVoice: {
          language: 'auto',
          useItn: true,
        },
      },
    })
      .then((engine) => {
        this.engine = engine;
        logger.info('engine_loaded', { model: 'sense_voice_2024_07_17_int8' });
        return engine;
      })
      .catch((error: unknown) => {
        logger.error('engine_load_failed', {
          diagnostic: sanitizeDiagnosticMessage(
            error instanceof Error ? error.message : String(error),
          ),
        });
        throw new StreamingSpeechError('model-load-failed');
      })
      .finally(() => {
        if (this.engineLoad === loading) this.engineLoad = null;
      });
    this.engineLoad = loading;
    return loading;
  }

  private async recognizeSegments(
    session: ActiveSession,
    segments: readonly VoiceActivitySegment[],
  ): Promise<void> {
    const engine = await session.engineReady;
    for (const segment of segments) {
      if (session.cancelled) return;
      const result = await engine.transcribeSamples(segment.samples, SAMPLE_RATE);
      const text = result.text.trim();
      if (!text) continue;
      session.transcripts.push(text);
      if (this.active === session && !session.finalizing) {
        session.observer.onPartial(joinSegments(session.transcripts));
      }
    }
  }

  private signalFailure(
    session: ActiveSession,
    code: 'model-load-failed' | 'capture-failed' | 'recognition-failed',
    error: unknown,
  ): void {
    if (session.failure || session.cancelled) return;
    session.failure =
      error instanceof StreamingSpeechError ? error : new StreamingSpeechError(code);
    logger.error('stream_runtime_failed', {
      generation: session.generation,
      category: session.failure.code,
      diagnostic: sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error)),
    });
    if (this.active === session && !session.finalizing) {
      session.observer.onError(session.failure);
    }
  }

  private async releasePartialSession(
    mic: PcmLiveStreamHandle | null,
    vad: VoiceActivityDetector | null,
  ): Promise<void> {
    if (mic) await this.ignoreError(() => mic.stop());
    if (vad) await this.ignoreError(() => vad.destroy());
  }

  private async ignoreError(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      // Native resources are best-effort during cancellation and teardown.
    }
  }
}
