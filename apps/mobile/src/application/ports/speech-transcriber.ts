export type SpeechTranscriptionErrorCode =
  | 'aborted'
  | 'interrupted'
  | 'no-speech'
  | 'busy'
  | 'model-not-ready'
  | 'model-load-failed'
  | 'unknown';

export class SpeechTranscriptionError extends Error {
  constructor(
    readonly code: SpeechTranscriptionErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SpeechTranscriptionError';
  }
}

/**
 * Transcribes one completed local audio file. It never owns microphone capture.
 */
export interface SpeechTranscriberPort {
  isAvailable(): boolean;
  transcribe(request: {
    uri: string;
    lang: string;
    sampleRate: number;
    audioChannels: number;
  }): Promise<string>;
  cancel(): void;
}
