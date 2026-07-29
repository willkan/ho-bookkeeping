export type SpeechModelDownloadSource = 'domestic' | 'international';

export type SpeechModelFileName = 'model.int8.onnx' | 'tokens.txt';

export type SpeechModelFile = {
  name: SpeechModelFileName;
  bytes: number;
  sha256: string;
};

const REPOSITORY = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09';

export const SENSE_VOICE_MODEL = {
  id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
  revision: '355f4d4884d8afd08aef04b9007a8556d7b463b2',
  files: [
    {
      name: 'model.int8.onnx',
      bytes: 237_115_547,
      sha256: '12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d',
    },
    {
      name: 'tokens.txt',
      bytes: 315_894,
      sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    },
  ] satisfies SpeechModelFile[],
} as const;

const SOURCE_ORIGINS: Record<SpeechModelDownloadSource, string> = {
  domestic: 'https://hf-mirror.com',
  international: 'https://huggingface.co',
};

export function getSpeechModelDownloadUrl(
  source: SpeechModelDownloadSource,
  fileName: SpeechModelFileName,
): string {
  return `${SOURCE_ORIGINS[source]}/${REPOSITORY}/resolve/${SENSE_VOICE_MODEL.revision}/${fileName}?download=true`;
}

export function totalSpeechModelBytes(): number {
  return SENSE_VOICE_MODEL.files.reduce((total, file) => total + file.bytes, 0);
}
