import type {
  StreamingSpeechObserver,
  StreamingSpeechPort,
  VoicePermissionResult,
} from '../../application/ports/streaming-speech';

export class FakeStreamingSpeech implements StreamingSpeechPort {
  available = true;
  permissionGranted = true;
  finalTranscript = '买菜花了300元';
  startError: Error | null = null;
  stopError: Error | null = null;
  stopResult: Promise<string> | null = null;
  startCallCount = 0;
  stopCallCount = 0;
  cancelCallCount = 0;
  disposeCallCount = 0;
  prepareCallCount = 0;
  observer: StreamingSpeechObserver | null = null;

  isAvailable(): boolean {
    return this.available;
  }

  async prepare(): Promise<void> {
    this.prepareCallCount += 1;
  }

  async getPermissions(): Promise<VoicePermissionResult> {
    return { granted: this.permissionGranted };
  }

  async requestPermissions(): Promise<VoicePermissionResult> {
    return { granted: this.permissionGranted };
  }

  async start(observer: StreamingSpeechObserver): Promise<void> {
    this.startCallCount += 1;
    if (this.startError) throw this.startError;
    this.observer = observer;
  }

  emitPartial(text: string): void {
    this.observer?.onPartial(text);
  }

  emitError(error: Parameters<StreamingSpeechObserver['onError']>[0]): void {
    this.observer?.onError(error);
  }

  async stop(): Promise<string> {
    this.stopCallCount += 1;
    if (this.stopError) throw this.stopError;
    if (this.stopResult) return this.stopResult;
    return this.finalTranscript;
  }

  async cancel(): Promise<void> {
    this.cancelCallCount += 1;
    this.observer = null;
  }

  async dispose(): Promise<void> {
    this.disposeCallCount += 1;
    this.observer = null;
  }
}
