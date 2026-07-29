import { createSTT, type SttEngine } from 'react-native-sherpa-onnx/stt';
import {
  SpeechTranscriptionError,
  type SpeechTranscriberPort,
} from '../../application/ports/speech-transcriber';
import type { SpeechModelManager } from '../../application/speech-model-manager';
import { createMobileLogger, sanitizeDiagnosticMessage } from '../logging/mobile-logger';

const logger = createMobileLogger('speech-transcriber');

function nativeFilePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

export class SherpaSenseVoiceTranscriber implements SpeechTranscriberPort {
  private engine: SttEngine | null = null;
  private activeGeneration = 0;
  private transcribing = false;

  constructor(private readonly modelManager: SpeechModelManager) {}

  isAvailable(): boolean {
    return true;
  }

  async transcribe(request: {
    uri: string;
    lang: string;
    sampleRate: number;
    audioChannels: number;
  }): Promise<string> {
    if (this.transcribing) throw new SpeechTranscriptionError('busy');
    const modelPath = await this.modelManager.getReadyPath();
    if (!modelPath) {
      throw new SpeechTranscriptionError('model-not-ready', 'speech model not ready');
    }

    const generation = ++this.activeGeneration;
    const startedAtMs = Date.now();
    this.transcribing = true;
    logger.info('local_transcription_requested', {
      model: 'sense-voice-small-int8',
      language: request.lang,
      sample_rate: request.sampleRate,
      audio_channels: request.audioChannels,
    });

    try {
      if (!this.engine) {
        this.engine = await createSTT({
          modelPath: { type: 'file', path: modelPath },
          modelType: 'sense_voice',
          preferInt8: true,
          numThreads: 2,
          provider: 'cpu',
          debug: false,
          modelOptions: {
            senseVoice: {
              language: 'zh',
              useItn: true,
            },
          },
        });
      }
      const result = await this.engine.transcribeFile(nativeFilePath(request.uri));
      if (generation !== this.activeGeneration) {
        throw new SpeechTranscriptionError('aborted');
      }
      const text = result.text.trim();
      logger.info('local_transcription_completed', {
        model: 'sense-voice-small-int8',
        latency_ms: Date.now() - startedAtMs,
        has_result: Boolean(text),
      });
      if (!text) throw new SpeechTranscriptionError('no-speech');
      return text;
    } catch (error) {
      if (error instanceof SpeechTranscriptionError) throw error;
      logger.warn('local_transcription_failed', {
        model: 'sense-voice-small-int8',
        latency_ms: Date.now() - startedAtMs,
        native_message: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw new SpeechTranscriptionError(
        'model-load-failed',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.transcribing = false;
    }
  }

  cancel(): void {
    this.activeGeneration += 1;
  }

  async dispose(): Promise<void> {
    this.cancel();
    const engine = this.engine;
    this.engine = null;
    if (engine) await engine.destroy();
  }
}
