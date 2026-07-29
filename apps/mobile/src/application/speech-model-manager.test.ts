import { describe, expect, it } from 'vitest';
import type {
  SpeechModelArtifactsPort,
  SpeechModelDownloadProgress,
} from './ports/speech-model-artifacts';
import { SpeechModelManager, SpeechModelManagerError } from './speech-model-manager';
import type { SpeechModelDownloadSource, SpeechModelFile } from './speech-model';
import { totalSpeechModelBytes } from './speech-model';

class FakeSpeechModelArtifacts implements SpeechModelArtifactsPort {
  freeBytes = totalSpeechModelBytes() + 200 * 1024 * 1024;
  ready = false;
  published = false;
  discarded = false;
  deleted = false;
  downloaded: string[] = [];
  invalidFile: string | null = null;

  async isReady() {
    return this.ready;
  }
  async getReadyPath() {
    return this.ready ? '/models/sense-voice' : null;
  }
  async getFreeBytes() {
    return this.freeBytes;
  }
  async prepareStaging() {
    this.discarded = false;
  }
  async downloadFile(request: {
    source: SpeechModelDownloadSource;
    file: SpeechModelFile;
    onProgress: (bytesDownloaded: number) => void;
  }) {
    this.downloaded.push(`${request.source}:${request.file.name}`);
    request.onProgress(request.file.bytes);
  }
  async verifyStagedFile(file: SpeechModelFile) {
    return file.name !== this.invalidFile;
  }
  async publish() {
    this.published = true;
    this.ready = true;
    return '/models/sense-voice';
  }
  async discardStaging() {
    this.discarded = true;
  }
  async deleteReadyModel() {
    this.deleted = true;
    this.ready = false;
  }
  cancel() {}
}

describe('speech model download lifecycle', () => {
  it('publishes only after every pinned file has downloaded and verified', async () => {
    const artifacts = new FakeSpeechModelArtifacts();
    const manager = new SpeechModelManager(artifacts);
    const progress: SpeechModelDownloadProgress[] = [];

    const path = await manager.download('domestic', (next) => progress.push(next));

    expect(path).toBe('/models/sense-voice');
    expect(artifacts.downloaded).toEqual(['domestic:model.int8.onnx', 'domestic:tokens.txt']);
    expect(artifacts.published).toBe(true);
    expect(progress.at(-1)).toEqual({
      bytesDownloaded: totalSpeechModelBytes(),
      totalBytes: totalSpeechModelBytes(),
    });
  });

  it('discards all staged artifacts when one file fails integrity validation', async () => {
    const artifacts = new FakeSpeechModelArtifacts();
    artifacts.invalidFile = 'tokens.txt';
    const manager = new SpeechModelManager(artifacts);

    await expect(manager.download('international')).rejects.toMatchObject({
      code: 'integrity_failed',
    });
    expect(artifacts.published).toBe(false);
    expect(artifacts.discarded).toBe(true);
  });

  it('reports insufficient storage before downloading any file', async () => {
    const artifacts = new FakeSpeechModelArtifacts();
    artifacts.freeBytes = totalSpeechModelBytes();
    const manager = new SpeechModelManager(artifacts);

    await expect(manager.download('domestic')).rejects.toBeInstanceOf(SpeechModelManagerError);
    expect(artifacts.downloaded).toEqual([]);
  });

  it('deletes only the downloaded speech model artifacts', async () => {
    const artifacts = new FakeSpeechModelArtifacts();
    artifacts.ready = true;
    const manager = new SpeechModelManager(artifacts);

    await manager.delete();

    expect(artifacts.deleted).toBe(true);
    expect(await manager.isReady()).toBe(false);
  });
});
