import type { SpeechModelDownloadSource, SpeechModelFile } from '../speech-model';

export type SpeechModelDownloadProgress = {
  bytesDownloaded: number;
  totalBytes: number;
};

export interface SpeechModelArtifactsPort {
  isReady(): Promise<boolean>;
  getReadyPath(): Promise<string | null>;
  getFreeBytes(): Promise<number>;
  prepareStaging(): Promise<void>;
  downloadFile(request: {
    source: SpeechModelDownloadSource;
    file: SpeechModelFile;
    onProgress: (bytesDownloaded: number) => void;
  }): Promise<void>;
  verifyStagedFile(file: SpeechModelFile): Promise<boolean>;
  publish(): Promise<string>;
  discardStaging(): Promise<void>;
  deleteReadyModel(): Promise<void>;
  cancel(): void;
}
