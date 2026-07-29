import {
  DocumentDirectoryPath,
  downloadFile,
  exists,
  getFSInfo,
  hash,
  mkdir,
  moveFile,
  readFile,
  stat,
  stopDownload,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs';
import type { SpeechModelArtifactsPort } from '../../application/ports/speech-model-artifacts';
import {
  SENSE_VOICE_MODEL,
  getSpeechModelDownloadUrl,
  type SpeechModelFile,
} from '../../application/speech-model';
import { createMobileLogger } from '../logging/mobile-logger';

const logger = createMobileLogger('speech-model');
const MODELS_ROOT = `${DocumentDirectoryPath}/speech-models`;
const READY_DIR = `${MODELS_ROOT}/${SENSE_VOICE_MODEL.id}`;
const STAGING_DIR = `${MODELS_ROOT}/.${SENSE_VOICE_MODEL.id}.partial`;
const READY_MARKER = '.ready.json';

type ReadyManifest = {
  id: string;
  revision: string;
  files: readonly SpeechModelFile[];
};

const EXPECTED_READY_MANIFEST: ReadyManifest = {
  id: SENSE_VOICE_MODEL.id,
  revision: SENSE_VOICE_MODEL.revision,
  files: SENSE_VOICE_MODEL.files,
};

async function removeIfPresent(path: string): Promise<void> {
  if (await exists(path)) await unlink(path);
}

export class SenseVoiceModelArtifacts implements SpeechModelArtifactsPort {
  private activeDownloadJobId: number | null = null;

  async isReady(): Promise<boolean> {
    const markerPath = `${READY_DIR}/${READY_MARKER}`;
    if (!(await exists(markerPath))) return false;

    try {
      const manifest = JSON.parse(await readFile(markerPath, 'utf8')) as ReadyManifest;
      if (JSON.stringify(manifest) !== JSON.stringify(EXPECTED_READY_MANIFEST)) {
        return false;
      }
      for (const file of SENSE_VOICE_MODEL.files) {
        const path = `${READY_DIR}/${file.name}`;
        if (!(await exists(path)) || (await stat(path)).size !== file.bytes) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async getReadyPath(): Promise<string | null> {
    return (await this.isReady()) ? READY_DIR : null;
  }

  async getFreeBytes(): Promise<number> {
    const info = await getFSInfo();
    return info.freeSpaceEx ?? info.freeSpace;
  }

  async prepareStaging(): Promise<void> {
    await mkdir(MODELS_ROOT, { NSURLIsExcludedFromBackupKey: true });
    await removeIfPresent(STAGING_DIR);
    await mkdir(STAGING_DIR, { NSURLIsExcludedFromBackupKey: true });
  }

  async downloadFile({
    source,
    file,
    onProgress,
  }: Parameters<SpeechModelArtifactsPort['downloadFile']>[0]): Promise<void> {
    const destination = `${STAGING_DIR}/${file.name}`;
    const url = getSpeechModelDownloadUrl(source, file.name);
    logger.info('model_file_download_started', {
      model_id: SENSE_VOICE_MODEL.id,
      source,
      provider_host: new URL(url).host,
      file: file.name,
      expected_bytes: file.bytes,
    });

    const task = downloadFile({
      fromUrl: url,
      toFile: destination,
      background: false,
      progressInterval: 500,
      progressDivider: 1,
      progress: ({ bytesWritten }) => onProgress(bytesWritten),
    });
    this.activeDownloadJobId = task.jobId;
    try {
      const result = await task.promise;
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(`下载服务返回 ${result.statusCode}`);
      }
      logger.info('model_file_download_completed', {
        model_id: SENSE_VOICE_MODEL.id,
        source,
        file: file.name,
        bytes: result.bytesWritten,
      });
    } finally {
      if (this.activeDownloadJobId === task.jobId) this.activeDownloadJobId = null;
    }
  }

  async verifyStagedFile(file: SpeechModelFile): Promise<boolean> {
    const path = `${STAGING_DIR}/${file.name}`;
    if (!(await exists(path))) return false;
    const actualSize = (await stat(path)).size;
    if (actualSize !== file.bytes) {
      logger.warn('model_file_size_mismatch', {
        model_id: SENSE_VOICE_MODEL.id,
        file: file.name,
        expected_bytes: file.bytes,
        actual_bytes: actualSize,
      });
      return false;
    }
    const actualSha256 = (await hash(path, 'sha256')).toLowerCase();
    const valid = actualSha256 === file.sha256;
    logger.info('model_file_integrity_checked', {
      model_id: SENSE_VOICE_MODEL.id,
      file: file.name,
      valid,
    });
    return valid;
  }

  async publish(): Promise<string> {
    await writeFile(
      `${STAGING_DIR}/${READY_MARKER}`,
      JSON.stringify(EXPECTED_READY_MANIFEST),
      'utf8',
    );
    await removeIfPresent(READY_DIR);
    await moveFile(STAGING_DIR, READY_DIR);
    logger.info('model_published', { model_id: SENSE_VOICE_MODEL.id });
    return READY_DIR;
  }

  async discardStaging(): Promise<void> {
    await removeIfPresent(STAGING_DIR);
  }

  async deleteReadyModel(): Promise<void> {
    await removeIfPresent(READY_DIR);
    logger.info('model_deleted', { model_id: SENSE_VOICE_MODEL.id });
  }

  cancel(): void {
    if (this.activeDownloadJobId !== null) {
      stopDownload(this.activeDownloadJobId);
      this.activeDownloadJobId = null;
    }
  }
}
