import type {
  CompletedVoiceRecording,
  VoicePermissionResult,
  VoiceRecorderPort,
} from '../../application/ports/voice-recorder';

export class FakeVoiceRecorder implements VoiceRecorderPort {
  permissionGranted = true;
  startError: Error | null = null;
  stopError: Error | null = null;
  recording: CompletedVoiceRecording = {
    uri: 'file:///cache/bookkeeping-voice-test.m4a',
    sampleRate: 16000,
    audioChannels: 1,
    durationMillis: 8000,
  };
  startCallCount = 0;
  stopCallCount = 0;
  cancelCallCount = 0;
  deleteCallCount = 0;
  cleanupOrphansCallCount = 0;
  deletedUris: string[] = [];
  events: string[] = [];

  async getPermissions(): Promise<VoicePermissionResult> {
    return { granted: this.permissionGranted };
  }

  async requestPermissions(): Promise<VoicePermissionResult> {
    return { granted: this.permissionGranted };
  }

  async start(): Promise<void> {
    this.startCallCount += 1;
    this.events.push('record:start');
    if (this.startError) throw this.startError;
  }

  async stop(): Promise<CompletedVoiceRecording> {
    this.stopCallCount += 1;
    this.events.push('record:stop');
    if (this.stopError) throw this.stopError;
    return this.recording;
  }

  async cancel(): Promise<void> {
    this.cancelCallCount += 1;
    this.events.push('record:cancel');
  }

  async deleteTemporaryFile(uri: string): Promise<void> {
    this.deleteCallCount += 1;
    this.deletedUris.push(uri);
    this.events.push('record:delete');
  }

  async cleanupOrphanedFiles(): Promise<void> {
    this.cleanupOrphansCallCount += 1;
    this.events.push('record:cleanup-orphans');
  }
}
