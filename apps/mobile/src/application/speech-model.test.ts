import { describe, expect, it } from 'vitest';
import {
  STREAMING_SPEECH_MODEL,
  getSpeechModelDownloadUrl,
  totalSpeechModelBytes,
} from './speech-model';

describe('local streaming speech model contract', () => {
  it('pins one Chinese Streaming Zipformer INT8 model with immutable integrity metadata', () => {
    expect(STREAMING_SPEECH_MODEL.id).toBe('sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30');
    expect(STREAMING_SPEECH_MODEL.files.map((file) => file.name)).toEqual([
      'encoder.int8.onnx',
      'decoder.onnx',
      'joiner.int8.onnx',
      'tokens.txt',
    ]);
    expect(STREAMING_SPEECH_MODEL.files.every((file) => file.sha256.length === 64)).toBe(true);
    expect(totalSpeechModelBytes()).toBe(167_360_920);
  });

  it('uses distinct visible hosts without changing the pinned revision', () => {
    const domestic = getSpeechModelDownloadUrl('domestic', 'tokens.txt');
    const international = getSpeechModelDownloadUrl('international', 'tokens.txt');

    expect(new URL(domestic).host).toBe('hf-mirror.com');
    expect(new URL(international).host).toBe('huggingface.co');
    expect(domestic).toContain(STREAMING_SPEECH_MODEL.revision);
    expect(international).toContain(STREAMING_SPEECH_MODEL.revision);
  });
});
