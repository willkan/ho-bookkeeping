export type SpeechModelDownloadSource = 'domestic' | 'international';

export type SpeechModelFileName =
  | 'encoder.int8.onnx'
  | 'decoder.onnx'
  | 'joiner.int8.onnx'
  | 'tokens.txt';

export type SpeechModelFile = {
  name: SpeechModelFileName;
  bytes: number;
  sha256: string;
};

const REPOSITORY = 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30';

export const STREAMING_SPEECH_MODEL = {
  id: 'sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30',
  revision: 'ad658fa0201659a09ea3c176129a191c77ecae8f',
  files: [
    {
      name: 'encoder.int8.onnx',
      bytes: 161_141_793,
      sha256: '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f',
    },
    {
      name: 'decoder.onnx',
      bytes: 5_165_083,
      sha256: '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e',
    },
    {
      name: 'joiner.int8.onnx',
      bytes: 1_033_416,
      sha256: 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b',
    },
    {
      name: 'tokens.txt',
      bytes: 20_628,
      sha256: '6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652',
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
  return `${SOURCE_ORIGINS[source]}/${REPOSITORY}/resolve/${STREAMING_SPEECH_MODEL.revision}/${fileName}?download=true`;
}

export function totalSpeechModelBytes(): number {
  return STREAMING_SPEECH_MODEL.files.reduce((total, file) => total + file.bytes, 0);
}
