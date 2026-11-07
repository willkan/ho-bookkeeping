import { describe, expect, it } from 'vitest';
import {
  SENSE_VOICE_VAD_MODEL,
  SILERO_VAD_FILE,
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
    ]);
    expect(SENSE_VOICE_VAD_MODEL.files.every((file) => file.sha256.length === 64)).toBe(true);
    expect(totalSpeechModelBytes()).toBe(239_549_735);
    expect(SILERO_VAD_FILE.bytes).toBe(643_854);
    expect(SILERO_VAD_FILE.sha256).toBe(
      '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    );
  });

  it('uses distinct visible hosts for the large SenseVoice files without changing the revision', () => {
    const domestic = getSpeechModelDownloadUrl('domestic', 'tokens.txt');
    const international = getSpeechModelDownloadUrl('international', 'tokens.txt');

    expect(new URL(domestic).host).toBe('www.modelscope.cn');
    expect(domestic).toContain('fengge2024/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17');
    expect(domestic).toContain('9bd9398d89294cbf1964af126ff13e6890394cbc');
    expect(new URL(international).host).toBe('huggingface.co');
    expect(domestic).not.toContain(SENSE_VOICE_VAD_MODEL.revision);
    expect(international).toContain(SENSE_VOICE_VAD_MODEL.revision);
  });

  it('keeps the VAD file as a bundled runtime asset', () => {
    expect(SENSE_VOICE_VAD_MODEL.files.map((file) => file.name)).not.toContain('silero_vad.onnx');
    expect(getSpeechModelRuntimeRelativePath(SILERO_VAD_FILE.name)).toBe('vad/silero_vad.onnx');
  });

  it('isolates ASR files from the VAD file in the published runtime layout', () => {
    expect(getSpeechModelRuntimeRelativePath('model.int8.onnx')).toBe('asr/model.int8.onnx');
    expect(getSpeechModelRuntimeRelativePath('tokens.txt')).toBe('asr/tokens.txt');
    expect(getSpeechModelRuntimeRelativePath('silero_vad.onnx')).toBe('vad/silero_vad.onnx');
  });
});
