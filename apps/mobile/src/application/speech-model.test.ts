import { describe, expect, it } from 'vitest';
import {
  SENSE_VOICE_VAD_MODEL,
  getSpeechModelDownloadUrl,
  getSpeechModelRuntimeRelativePath,
  totalSpeechModelBytes,
} from './speech-model';

describe('local streaming speech model contract', () => {
  it('pins the official SenseVoiceSmall INT8 and Silero VAD files with immutable integrity metadata', () => {
    expect(SENSE_VOICE_VAD_MODEL.id).toBe(
      'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    );
    expect(SENSE_VOICE_VAD_MODEL.id).not.toMatch(/vad|silero/i);
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

  it('isolates ASR files from the VAD file in the published runtime layout', () => {
    expect(getSpeechModelRuntimeRelativePath('model.int8.onnx')).toBe('asr/model.int8.onnx');
    expect(getSpeechModelRuntimeRelativePath('tokens.txt')).toBe('asr/tokens.txt');
    expect(getSpeechModelRuntimeRelativePath('silero_vad.onnx')).toBe('vad/silero_vad.onnx');
  });
});
