import { describe, expect, it } from 'vitest';
import {
  SENSE_VOICE_VAD_MODEL,
  getSpeechModelDownloadUrl,
  totalSpeechModelBytes,
} from './speech-model';

describe('local streaming speech model contract', () => {
  it('pins the official SenseVoiceSmall INT8 and Silero VAD files with immutable integrity metadata', () => {
    expect(SENSE_VOICE_VAD_MODEL.id).toBe(
      'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17-vad',
    );
    expect(SENSE_VOICE_VAD_MODEL.files.map((file) => file.name)).toEqual([
      'model.int8.onnx',
      'tokens.txt',
      'silero_vad.onnx',
    ]);
    expect(SENSE_VOICE_VAD_MODEL.files.every((file) => file.sha256.length === 64)).toBe(true);
    expect(totalSpeechModelBytes()).toBe(240_193_589);
  });

  it('uses distinct visible hosts for the large SenseVoice files without changing the revision', () => {
    const domestic = getSpeechModelDownloadUrl('domestic', 'tokens.txt');
    const international = getSpeechModelDownloadUrl('international', 'tokens.txt');

    expect(new URL(domestic).host).toBe('hf-mirror.com');
    expect(new URL(international).host).toBe('huggingface.co');
    expect(domestic).toContain(SENSE_VOICE_VAD_MODEL.revision);
    expect(international).toContain(SENSE_VOICE_VAD_MODEL.revision);
  });

  it('downloads the VAD file from the immutable sherpa-onnx official release asset', () => {
    expect(getSpeechModelDownloadUrl('domestic', 'silero_vad.onnx')).toBe(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    );
    expect(getSpeechModelDownloadUrl('international', 'silero_vad.onnx')).toBe(
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    );
  });
});
