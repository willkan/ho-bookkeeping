import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { createPcmLiveStream, type PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import {
  createStreamingSTT,
  type StreamingSttEngine,
  type SttStream,
} from 'react-native-sherpa-onnx/stt';
import {
  StreamingSpeechError,
  type StreamingSpeechObserver,
  type StreamingSpeechPort,
} from '../../application/ports/streaming-speech';
import type { SpeechModelManager } from '../../application/speech-model-manager';
import { createMobileLogger, sanitizeDiagnosticMessage } from '../logging/mobile-logger';

const SAMPLE_RATE = 16_000;
const BUFFER_SIZE_FRAMES = 1_600;
const logger = createMobileLogger('streaming-speech');

type ActiveSession = {
  generation: number;
  mic: PcmLiveStreamHandle;
  stream: SttStream;
  removeDataListener: () => void;
  removeErrorListener: () => void;
  processing: Promise<void>;
  failure: StreamingSpeechError | null;
  acceptingAudio: boolean;
  cancelled: boolean;
  finalizing: boolean;
};

export class SherpaStreamingSpeech implements StreamingSpeechPort {
  private engine: StreamingSttEngine | null = null;
  private active: ActiveSession | null = null;
  private generation = 0;

  constructor(private readonly modelManager: SpeechModelManager) {}

  isAvailable(): boolean {
    return true;
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
    const engine = await this.getOrCreateEngine();
    let stream: SttStream | null = null;
    let mic: PcmLiveStreamHandle | null = null;

    try {
      stream = await engine.createStream();
      mic = createPcmLiveStream({
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        bufferSizeFrames: BUFFER_SIZE_FRAMES,
      });
      const session: ActiveSession = {
        generation,
        mic,
        stream,
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
            const { result } = await stream!.processAudioChunk(samples, sampleRate);
            if (this.active === session && !session.finalizing) {
              observer.onPartial(result.text);
            }
          })
          .catch((error: unknown) => {
            this.signalFailure(session, observer, 'recognition-failed', error);
          });
      });
      session.removeErrorListener = mic.onError((message) => {
        this.signalFailure(session, observer, 'capture-failed', new Error(message));
      });
      this.active = session;
      await mic.start();
      logger.info('stream_started', {
        generation,
        sample_rate: SAMPLE_RATE,
        buffer_frames: BUFFER_SIZE_FRAMES,
      });
    } catch (error) {
      if (this.active?.generation === generation) this.active = null;
      await this.releasePartialSession(mic, stream);
      if (error instanceof StreamingSpeechError) throw error;
      logger.error('stream_start_failed', {
        generation,
        diagnostic: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw new StreamingSpeechError(stream ? 'capture-failed' : 'model-load-failed');
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
      await session.stream.inputFinished();
      while (await session.stream.isReady()) {
        await session.stream.decode();
      }
      const result = await session.stream.getResult();
      logger.info('stream_finalized', {
        generation: session.generation,
        has_text: result.text.trim().length > 0,
      });
      return result.text;
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
      await this.releaseStream(session.stream);
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
    await this.ignoreError(() => session.stream.release());
    logger.info('stream_cancelled', { generation: session.generation });
  }

  async dispose(): Promise<void> {
    await this.cancel();
    const engine = this.engine;
    this.engine = null;
    if (engine) await this.ignoreError(() => engine.destroy());
  }

  private async getOrCreateEngine(): Promise<StreamingSttEngine> {
    if (this.engine) return this.engine;
    const modelPath = await this.modelManager.getReadyPath();
    if (!modelPath) throw new StreamingSpeechError('model-not-ready');
    try {
      this.engine = await createStreamingSTT({
        modelPath: { type: 'file', path: modelPath },
        modelType: 'transducer',
        enableEndpoint: false,
        decodingMethod: 'greedy_search',
        numThreads: 2,
        provider: 'cpu',
        dither: 0,
        debug: false,
        enableInputNormalization: false,
      });
      logger.info('engine_loaded', { model: 'streaming-zipformer-zh-int8' });
      return this.engine;
    } catch (error) {
      logger.error('engine_load_failed', {
        diagnostic: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw new StreamingSpeechError('model-load-failed');
    }
  }

  private signalFailure(
    session: ActiveSession,
    observer: StreamingSpeechObserver,
    code: 'capture-failed' | 'recognition-failed',
    error: unknown,
  ): void {
    if (session.failure || session.cancelled) return;
    session.failure = new StreamingSpeechError(code);
    logger.error('stream_runtime_failed', {
      generation: session.generation,
      category: code,
      diagnostic: sanitizeDiagnosticMessage(error instanceof Error ? error.message : String(error)),
    });
    if (this.active === session && !session.finalizing) {
      observer.onError(session.failure);
    }
  }

  private async releasePartialSession(
    mic: PcmLiveStreamHandle | null,
    stream: SttStream | null,
  ): Promise<void> {
    if (mic) await this.ignoreError(() => mic.stop());
    if (stream) await this.ignoreError(() => stream.release());
  }

  private async releaseStream(stream: SttStream): Promise<void> {
    await this.ignoreError(() => stream.release());
  }

  private async ignoreError(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      // Native resources are best-effort during cancellation and teardown.
    }
  }
}
