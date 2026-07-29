import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechModelManager } from '../../application/speech-model-manager';
import { SherpaStreamingSpeech } from './sherpa-streaming-speech';

const native = vi.hoisted(() => {
  let onData: ((samples: Float32Array, sampleRate: number) => void) | null = null;
  let onError: ((message: string) => void) | null = null;
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const processAudioChunk = vi.fn(async (samples: Float32Array | number[]) => {
    activeCalls += 1;
    maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
    await Promise.resolve();
    activeCalls -= 1;
    return {
      result: { text: samples.length === 1 ? '买菜' : '买菜花了300元', tokens: [], timestamps: [] },
      isEndpoint: false,
    };
  });
  const stream = {
    processAudioChunk,
    inputFinished: vi.fn(async () => {}),
    isReady: vi.fn(async () => false),
    decode: vi.fn(async () => {}),
    getResult: vi.fn(async () => ({
      text: '买菜花了300元',
      tokens: [],
      timestamps: [],
    })),
    release: vi.fn(async () => {}),
  };
  const engine = {
    createStream: vi.fn(async () => stream),
    destroy: vi.fn(async () => {}),
  };
  const mic = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onData: vi.fn((callback: typeof onData) => {
      onData = callback;
      return () => {
        onData = null;
      };
    }),
    onError: vi.fn((callback: typeof onError) => {
      onError = callback;
      return () => {
        onError = null;
      };
    }),
  };
  return {
    engine,
    stream,
    mic,
    createStreamingSTT: vi.fn(async () => engine),
    createPcmLiveStream: vi.fn(() => mic),
    emitData(samples: number[]) {
      onData?.(Float32Array.from(samples), 16_000);
    },
    emitError(message: string) {
      onError?.(message);
    },
    maxActiveCalls: () => maxActiveCalls,
    reset() {
      onData = null;
      onError = null;
      activeCalls = 0;
      maxActiveCalls = 0;
      vi.clearAllMocks();
    },
  };
});

vi.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock('react-native-sherpa-onnx/audio', () => ({
  createPcmLiveStream: native.createPcmLiveStream,
}));

vi.mock('react-native-sherpa-onnx/stt', () => ({
  createStreamingSTT: native.createStreamingSTT,
}));

function readyModelManager(): SpeechModelManager {
  return {
    getReadyPath: vi.fn(async () => '/models/streaming-zipformer'),
  } as unknown as SpeechModelManager;
}

describe('SherpaStreamingSpeech native boundary', () => {
  beforeEach(() => native.reset());

  it('feeds PCM chunks serially and flushes one final transcript on stop', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());
    const partials: string[] = [];
    await speech.start({
      onPartial: (text) => partials.push(text),
      onError: vi.fn(),
    });

    native.emitData([0.1]);
    native.emitData([0.1, 0.2]);
    native.mic.stop.mockImplementationOnce(async () => {
      native.emitData([0.1, 0.2, 0.3]);
    });
    const finalText = await speech.stop();

    expect(native.createStreamingSTT).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: { type: 'file', path: '/models/streaming-zipformer' },
        modelType: 'transducer',
        enableEndpoint: false,
        enableInputNormalization: false,
      }),
    );
    expect(native.maxActiveCalls()).toBe(1);
    expect(native.stream.processAudioChunk).toHaveBeenCalledTimes(3);
    expect(native.stream.inputFinished).toHaveBeenCalledTimes(1);
    expect(native.stream.release).toHaveBeenCalledTimes(1);
    expect(finalText).toBe('买菜花了300元');
    expect(partials).toEqual([]);
  });

  it('surfaces capture failure and releases the active stream on cancellation', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());
    const onError = vi.fn();
    await speech.start({ onPartial: vi.fn(), onError });

    native.emitError('microphone disconnected');
    await speech.cancel();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'capture-failed' }));
    expect(native.mic.stop).toHaveBeenCalledTimes(1);
    expect(native.stream.release).toHaveBeenCalledTimes(1);
  });
});
