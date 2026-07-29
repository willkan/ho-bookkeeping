export type VoicePermissionResult = {
  granted: boolean;
};

export type CompletedVoiceRecording = {
  uri: string;
  sampleRate: number;
  audioChannels: number;
  durationMillis?: number;
};

/**
 * App-owned microphone capture. Implementations must not start speech recognition.
 * The returned file is temporary and must be deleted after use.
 */
export interface VoiceRecorderPort {
  getPermissions(): Promise<VoicePermissionResult>;
  requestPermissions(): Promise<VoicePermissionResult>;
  start(): Promise<void>;
  stop(): Promise<CompletedVoiceRecording>;
  cancel(): Promise<void>;
  deleteTemporaryFile(uri: string): Promise<void>;
  cleanupOrphanedFiles(): Promise<void>;
}
