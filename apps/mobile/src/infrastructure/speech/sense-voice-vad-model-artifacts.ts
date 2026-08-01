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
  SENSE_VOICE_VAD_MODEL,
  getSpeechModelDownloadUrl,
  getSpeechModelRuntimeRelativePath,
  SPEECH_MODEL_RUNTIME_DIRS,
  type SpeechModelFile,
} from '../../application/speech-model';
import { createMobileLogger, sanitizeDiagnosticMessage } from '../logging/mobile-logger';

const logger = createMobileLogger('speech-model');
const MODELS_ROOT = `${DocumentDirectoryPath}/speech-models`;
const READY_DIR = `${MODELS_ROOT}/${SENSE_VOICE_VAD_MODEL.id}`;
const STAGING_DIR = `${MODELS_ROOT}/.${SENSE_VOICE_VAD_MODEL.id}.partial`;
const PATH_KEYWORD_LEGACY_MODEL_ID = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17-vad';
const PATH_KEYWORD_LEGACY_READY_DIR = `${MODELS_ROOT}/${PATH_KEYWORD_LEGACY_MODEL_ID}`;
const LEGACY_MODEL_IDS = [
  'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30',
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
] as const;
const READY_MARKER = '.ready.json';
let pathKeywordMigrationPromise: Promise<void> | null = null;
let pathKeywordCleanupPromise: Promise<void> | null = null;
let flatRuntimeMigrationPromise: Promise<void> | null = null;

type ReadyManifest = {
  id: string;
  revision: string;
  files: readonly SpeechModelFile[];
};

const EXPECTED_READY_MANIFEST: ReadyManifest = {
  id: SENSE_VOICE_VAD_MODEL.id,
  revision: SENSE_VOICE_VAD_MODEL.revision,
  files: SENSE_VOICE_VAD_MODEL.files,
};

async function removeIfPresent(path: string): Promise<void> {
  if (await exists(path)) await unlink(path);
}

export class SenseVoiceVadModelArtifacts implements SpeechModelArtifactsPort {
  private activeDownloadJobId: number | null = null;
  private legacyCleaned = false;

  async isReady(): Promise<boolean> {
    await this.migratePathKeywordLegacyDirectory();
    await this.cleanupLegacyArtifacts();
    await this.migrateFlatRuntimeLayout();
    const markerPath = `${READY_DIR}/${READY_MARKER}`;
    if (!(await exists(markerPath))) return false;

    try {
      const manifest = JSON.parse(await readFile(markerPath, 'utf8')) as ReadyManifest;
      if (JSON.stringify(manifest) !== JSON.stringify(EXPECTED_READY_MANIFEST)) return false;
      for (const file of SENSE_VOICE_VAD_MODEL.files) {
        const path = `${READY_DIR}/${getSpeechModelRuntimeRelativePath(file.name)}`;
        if (!(await exists(path)) || (await stat(path)).size !== file.bytes) return false;
      }
      pathKeywordCleanupPromise ??= removeIfPresent(PATH_KEYWORD_LEGACY_READY_DIR);
      await pathKeywordCleanupPromise;
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
    await this.cleanupLegacyArtifacts();
    await mkdir(MODELS_ROOT, { NSURLIsExcludedFromBackupKey: true });
    await removeIfPresent(STAGING_DIR);
    await mkdir(STAGING_DIR, { NSURLIsExcludedFromBackupKey: true });
    await mkdir(`${STAGING_DIR}/${SPEECH_MODEL_RUNTIME_DIRS.asr}`, {
      NSURLIsExcludedFromBackupKey: true,
    });
    await mkdir(`${STAGING_DIR}/${SPEECH_MODEL_RUNTIME_DIRS.vad}`, {
      NSURLIsExcludedFromBackupKey: true,
    });
  }

  async downloadFile({
    source,
    file,
    onProgress,
  }: Parameters<SpeechModelArtifactsPort['downloadFile']>[0]): Promise<void> {
    const destination = `${STAGING_DIR}/${getSpeechModelRuntimeRelativePath(file.name)}`;
    const url = getSpeechModelDownloadUrl(source, file.name);
    logger.info('model_file_download_started', {
      model_id: SENSE_VOICE_VAD_MODEL.id,
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
        model_id: SENSE_VOICE_VAD_MODEL.id,
        source,
        file: file.name,
        bytes: result.bytesWritten,
      });
    } finally {
      if (this.activeDownloadJobId === task.jobId) this.activeDownloadJobId = null;
    }
  }

  async verifyStagedFile(file: SpeechModelFile): Promise<boolean> {
    const path = `${STAGING_DIR}/${getSpeechModelRuntimeRelativePath(file.name)}`;
    if (!(await exists(path))) return false;
    const actualSize = (await stat(path)).size;
    if (actualSize !== file.bytes) {
      logger.warn('model_file_size_mismatch', {
        model_id: SENSE_VOICE_VAD_MODEL.id,
        file: file.name,
        expected_bytes: file.bytes,
        actual_bytes: actualSize,
      });
      return false;
    }
    const actualSha256 = (await hash(path, 'sha256')).toLowerCase();
    const valid = actualSha256 === file.sha256;
    logger.info('model_file_integrity_checked', {
      model_id: SENSE_VOICE_VAD_MODEL.id,
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
    logger.info('model_published', { model_id: SENSE_VOICE_VAD_MODEL.id });
    return READY_DIR;
  }

  async discardStaging(): Promise<void> {
    await removeIfPresent(STAGING_DIR);
  }

  async deleteReadyModel(): Promise<void> {
    await removeIfPresent(READY_DIR);
    logger.info('model_deleted', { model_id: SENSE_VOICE_VAD_MODEL.id });
  }

  cancel(): void {
    if (this.activeDownloadJobId !== null) {
      stopDownload(this.activeDownloadJobId);
      this.activeDownloadJobId = null;
    }
  }

  private async cleanupLegacyArtifacts(): Promise<void> {
    if (this.legacyCleaned) return;
    for (const modelId of LEGACY_MODEL_IDS) {
      await removeIfPresent(`${MODELS_ROOT}/${modelId}`);
      await removeIfPresent(`${MODELS_ROOT}/.${modelId}.partial`);
    }
    this.legacyCleaned = true;
  }

  private async migratePathKeywordLegacyDirectory(): Promise<void> {
    pathKeywordMigrationPromise ??= this.performPathKeywordLegacyDirectoryMigration().catch(
      (error: unknown) => {
        logger.warn('model_directory_migration_failed', {
          model_id: SENSE_VOICE_VAD_MODEL.id,
          diagnostic: sanitizeDiagnosticMessage(
            error instanceof Error ? error.message : String(error),
          ),
        });
      },
    );
    await pathKeywordMigrationPromise;
  }

  private async performPathKeywordLegacyDirectoryMigration(): Promise<void> {
    await mkdir(MODELS_ROOT, { NSURLIsExcludedFromBackupKey: true });
    if (!(await exists(READY_DIR)) && (await exists(PATH_KEYWORD_LEGACY_READY_DIR))) {
      await moveFile(PATH_KEYWORD_LEGACY_READY_DIR, READY_DIR);
      logger.info('model_directory_migrated', {
        model_id: SENSE_VOICE_VAD_MODEL.id,
        from_layout: 'path_keyword_legacy',
      });
    }

    const markerPath = `${READY_DIR}/${READY_MARKER}`;
    if (!(await exists(markerPath))) return;
    try {
      const manifest = JSON.parse(await readFile(markerPath, 'utf8')) as ReadyManifest;
      const hasSameArtifacts =
        manifest.revision === EXPECTED_READY_MANIFEST.revision &&
        JSON.stringify(manifest.files) === JSON.stringify(EXPECTED_READY_MANIFEST.files);
      if (manifest.id === PATH_KEYWORD_LEGACY_MODEL_ID && hasSameArtifacts) {
        await writeFile(markerPath, JSON.stringify(EXPECTED_READY_MANIFEST), 'utf8');
      }
    } catch {
      // isReady() rejects malformed manifests; migration never makes them authoritative.
    }
  }

  private async migrateFlatRuntimeLayout(): Promise<void> {
    flatRuntimeMigrationPromise ??= this.performFlatRuntimeLayoutMigration().catch(
      (error: unknown) => {
        logger.warn('model_runtime_layout_migration_failed', {
          model_id: SENSE_VOICE_VAD_MODEL.id,
          diagnostic: sanitizeDiagnosticMessage(
            error instanceof Error ? error.message : String(error),
          ),
        });
      },
    );
    await flatRuntimeMigrationPromise;
  }

  private async performFlatRuntimeLayoutMigration(): Promise<void> {
    const markerPath = `${READY_DIR}/${READY_MARKER}`;
    if (!(await exists(markerPath))) return;

    const manifest = JSON.parse(await readFile(markerPath, 'utf8')) as ReadyManifest;
    if (JSON.stringify(manifest) !== JSON.stringify(EXPECTED_READY_MANIFEST)) return;

    await mkdir(`${READY_DIR}/${SPEECH_MODEL_RUNTIME_DIRS.asr}`, {
      NSURLIsExcludedFromBackupKey: true,
    });
    await mkdir(`${READY_DIR}/${SPEECH_MODEL_RUNTIME_DIRS.vad}`, {
      NSURLIsExcludedFromBackupKey: true,
    });
    for (const file of SENSE_VOICE_VAD_MODEL.files) {
      const flatPath = `${READY_DIR}/${file.name}`;
      const runtimePath = `${READY_DIR}/${getSpeechModelRuntimeRelativePath(file.name)}`;
      if (await exists(runtimePath)) {
        await removeIfPresent(flatPath);
      } else if (await exists(flatPath)) {
        await moveFile(flatPath, runtimePath);
      }
    }
  }
}
