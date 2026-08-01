export type SpeechModelDownloadSource = 'domestic' | 'international';

export type SpeechModelFileName = 'model.int8.onnx' | 'tokens.txt' | 'silero_vad.onnx';

export type SpeechModelFile = {
  name: SpeechModelFileName;
  bytes: number;
  sha256: string;
};

export const SPEECH_MODEL_RUNTIME_DIRS = {
  asr: 'asr',
  vad: 'vad',
} as const;

const REPOSITORY = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const SILERO_VAD_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';

export const SENSE_VOICE_VAD_MODEL = {
  id: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
  revision: '2365baeacb507f821a0c8120fcee3d484dba7a07',
  files: [
    {
      name: 'model.int8.onnx',
      bytes: 239_233_841,
      sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
    },
    {
      name: 'tokens.txt',
      bytes: 315_894,
      sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    },
    {
      name: 'silero_vad.onnx',
      bytes: 643_854,
      sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
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
  if (fileName === 'silero_vad.onnx') return SILERO_VAD_URL;
  return `${SOURCE_ORIGINS[source]}/${REPOSITORY}/resolve/${SENSE_VOICE_VAD_MODEL.revision}/${fileName}?download=true`;
}

export function totalSpeechModelBytes(): number {
  return SENSE_VOICE_VAD_MODEL.files.reduce((total, file) => total + file.bytes, 0);
}

export function getSpeechModelRuntimeRelativePath(fileName: SpeechModelFileName): string {
  const directory =
    fileName === 'silero_vad.onnx' ? SPEECH_MODEL_RUNTIME_DIRS.vad : SPEECH_MODEL_RUNTIME_DIRS.asr;
  return `${directory}/${fileName}`;
}
