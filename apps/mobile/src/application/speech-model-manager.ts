import type {
  SpeechModelArtifactsPort,
  SpeechModelDownloadProgress,
} from './ports/speech-model-artifacts';
import {
  SENSE_VOICE_VAD_MODEL,
  totalSpeechModelBytes,
  type SpeechModelDownloadSource,
} from './speech-model';

export type SpeechModelManagerErrorCode =
  | 'insufficient_storage'
  | 'integrity_failed'
  | 'download_failed';

export class SpeechModelManagerError extends Error {
  constructor(
    readonly code: SpeechModelManagerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpeechModelManagerError';
  }
}

const REQUIRED_FREE_SPACE_BUFFER_BYTES = 128 * 1024 * 1024;

export class SpeechModelManager {
  constructor(private readonly artifacts: SpeechModelArtifactsPort) {}

  isReady(): Promise<boolean> {
    return this.artifacts.isReady();
  }

  getReadyPath(): Promise<string | null> {
    return this.artifacts.getReadyPath();
  }

  async download(
    source: SpeechModelDownloadSource,
    onProgress?: (progress: SpeechModelDownloadProgress) => void,
  ): Promise<string> {
    const existing = await this.artifacts.getReadyPath();
    if (existing) return existing;

    const totalBytes = totalSpeechModelBytes();
    const freeBytes = await this.artifacts.getFreeBytes();
    if (freeBytes < totalBytes + REQUIRED_FREE_SPACE_BUFFER_BYTES) {
      throw new SpeechModelManagerError(
        'insufficient_storage',
        '设备可用空间不足，请至少预留 400 MB 后重试',
      );
    }

    let completedBytes = 0;
    await this.artifacts.prepareStaging();
    try {
      for (const file of SENSE_VOICE_VAD_MODEL.files) {
        await this.artifacts.downloadFile({
          source,
          file,
          onProgress: (fileBytes) => {
            onProgress?.({
              bytesDownloaded: completedBytes + Math.min(fileBytes, file.bytes),
              totalBytes,
            });
          },
        });
        if (!(await this.artifacts.verifyStagedFile(file))) {
          throw new SpeechModelManagerError(
            'integrity_failed',
            `语音模型文件校验失败：${file.name}`,
          );
        }
        completedBytes += file.bytes;
        onProgress?.({ bytesDownloaded: completedBytes, totalBytes });
      }
      return await this.artifacts.publish();
    } catch (error) {
      await this.artifacts.discardStaging();
      if (error instanceof SpeechModelManagerError) throw error;
      throw new SpeechModelManagerError(
        'download_failed',
        error instanceof Error ? error.message : '语音模型下载失败',
      );
    }
  }

  cancel(): void {
    this.artifacts.cancel();
  }

  async delete(): Promise<void> {
    this.artifacts.cancel();
    await this.artifacts.discardStaging();
    await this.artifacts.deleteReadyModel();
  }
}
