export type VoicePermissionResult = {
  granted: boolean;
};

export type StreamingSpeechErrorCode =
  | 'aborted'
  | 'interrupted'
  | 'no-speech'
  | 'busy'
  | 'model-not-ready'
  | 'model-load-failed'
  | 'capture-failed'
  | 'recognition-failed'
  | 'unknown';

export class StreamingSpeechError extends Error {
  constructor(
    readonly code: StreamingSpeechErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'StreamingSpeechError';
  }
}

export type StreamingSpeechObserver = {
  onPartial(text: string): void;
  onError(error: StreamingSpeechError): void;
};

/**
 * Owns one microphone PCM stream, VAD segmenter, and local recognizer as a
 * single lifecycle. Implementations never write audio files or submit ledger input.
 */
export interface StreamingSpeechPort {
  isAvailable(): boolean;
  getPermissions(): Promise<VoicePermissionResult>;
  requestPermissions(): Promise<VoicePermissionResult>;
  start(observer: StreamingSpeechObserver): Promise<void>;
  stop(): Promise<string>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}
