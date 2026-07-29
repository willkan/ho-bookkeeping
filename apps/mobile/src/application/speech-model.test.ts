import { describe, expect, it } from 'vitest';
import {
  SENSE_VOICE_MODEL,
  getSpeechModelDownloadUrl,
  totalSpeechModelBytes,
} from './speech-model';

describe('local speech model contract', () => {
  it('pins one SenseVoice INT8 model with immutable file integrity metadata', () => {
    expect(SENSE_VOICE_MODEL.id).toBe('sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09');
    expect(SENSE_VOICE_MODEL.files).toEqual([
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
    ]);
    expect(totalSpeechModelBytes()).toBe(237_431_441);
  });

  it('uses distinct visible hosts without changing the pinned revision', () => {
    const domestic = getSpeechModelDownloadUrl('domestic', 'tokens.txt');
    const international = getSpeechModelDownloadUrl('international', 'tokens.txt');

    expect(new URL(domestic).host).toBe('hf-mirror.com');
    expect(new URL(international).host).toBe('huggingface.co');
    expect(domestic).toContain(SENSE_VOICE_MODEL.revision);
    expect(international).toContain(SENSE_VOICE_MODEL.revision);
  });
});
