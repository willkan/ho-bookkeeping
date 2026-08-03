import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechModelManager } from '../../application/speech-model-manager';
import { SherpaStreamingSpeech } from './sherpa-streaming-speech';

const native = vi.hoisted(() => {
  let onData: ((samples: Float32Array, sampleRate: number) => void) | null = null;
  let onError: ((message: string) => void) | null = null;
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const queuedSegments: { start: number; samples: number[] }[][] = [];
  let flushedSegments: { start: number; samples: number[] }[] = [];

  const vad = {
    acceptWaveform: vi.fn(async () => queuedSegments.shift() ?? []),
    flush: vi.fn(async () => flushedSegments),
    destroy: vi.fn(async () => {}),
  };
  const engine = {
    transcribeSamples: vi.fn(async (samples: number[]) => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await Promise.resolve();
      activeCalls -= 1;
      const textByMarker: Record<number, string> = {
        1: '买菜花了300元，',
        2: '其中用了195抵200的优惠券。',
        3: '尾段',
      };
      return {
        text: textByMarker[samples[0] ?? 0] ?? '',
        tokens: [],
        timestamps: [],
        lang: 'zh',
        emotion: '',
        event: '',
        durations: [],
      };
    }),
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
    vad,
    mic,
    createSTT: vi.fn(async () => engine),
    createVoiceActivityDetector: vi.fn(async () => vad),
    createPcmLiveStream: vi.fn(() => mic),
    emitData(samples: number[]) {
      onData?.(Float32Array.from(samples), 16_000);
    },
    emitError(message: string) {
      onError?.(message);
    },
    queueVadResult(segments: { start: number; samples: number[] }[]) {
      queuedSegments.push(segments);
    },
    setFlushedSegments(segments: { start: number; samples: number[] }[]) {
      flushedSegments = segments;
    },
    maxActiveCalls: () => maxActiveCalls,
    reset() {
      onData = null;
      onError = null;
      activeCalls = 0;
      maxActiveCalls = 0;
      queuedSegments.splice(0);
      flushedSegments = [];
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
  createSTT: native.createSTT,
}));

vi.mock('sherpa-vad', () => ({
  createVoiceActivityDetector: native.createVoiceActivityDetector,
}));

function readyModelManager(): SpeechModelManager {
  return {
    getReadyPath: vi.fn(async () => '/models/sense-voice'),
  } as unknown as SpeechModelManager;
}

describe('SherpaStreamingSpeech SenseVoice + VAD boundary', () => {
  beforeEach(() => native.reset());

  it('prepares the recognizer without opening a recording session and reuses it on first start', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());

    await speech.prepare();

    expect(native.createSTT).toHaveBeenCalledTimes(1);
    expect(native.createVoiceActivityDetector).not.toHaveBeenCalled();
    expect(native.createPcmLiveStream).not.toHaveBeenCalled();

    await speech.start({ onPartial: vi.fn(), onError: vi.fn() });

    expect(native.createSTT).toHaveBeenCalledTimes(1);
    expect(native.createVoiceActivityDetector).toHaveBeenCalledTimes(1);
    expect(native.createPcmLiveStream).toHaveBeenCalledTimes(1);
  });

  it('shares one recognizer load when preparation and first start overlap', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());
    let finishLoading!: () => void;
    native.createSTT.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoading = () => resolve(native.engine);
        }),
    );

    const preparation = speech.prepare();
    const starting = speech.start({ onPartial: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(native.createSTT).toHaveBeenCalledTimes(1));
    finishLoading();
    await Promise.all([preparation, starting]);

    expect(native.createSTT).toHaveBeenCalledTimes(1);
  });

  it('recognizes completed VAD segments serially and flushes the tail only on stop', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());
    const partials: string[] = [];
    native.queueVadResult([{ start: 0, samples: [1] }]);
    native.queueVadResult([]);
    native.queueVadResult([{ start: 16_000, samples: [2] }]);
    native.setFlushedSegments([{ start: 32_000, samples: [3] }]);

    await speech.start({
      onPartial: (text) => partials.push(text),
      onError: vi.fn(),
    });
    native.emitData([0.1]);
    await vi.waitFor(() => expect(partials).toEqual(['买菜花了300元，']));
    native.emitData([0.2]);
    native.emitData([0.3]);
    await vi.waitFor(() =>
      expect(partials).toEqual(['买菜花了300元，', '买菜花了300元，其中用了195抵200的优惠券。']),
    );
    const finalText = await speech.stop();

    expect(native.createSTT).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: { type: 'file', path: '/models/sense-voice/asr' },
        modelType: 'sense_voice',
        preferInt8: true,
        numThreads: 2,
        provider: 'cpu',
        modelOptions: {
          senseVoice: { language: 'auto', useItn: true },
        },
      }),
    );
    expect(native.createVoiceActivityDetector).toHaveBeenCalledWith({
      modelPath: '/models/sense-voice/vad/silero_vad.onnx',
      sampleRate: 16_000,
      threshold: 0.5,
      minSilenceDuration: 0.25,
      minSpeechDuration: 0.25,
      windowSize: 512,
      maxSpeechDuration: 5,
      numThreads: 1,
      provider: 'cpu',
    });
    expect(native.maxActiveCalls()).toBe(1);
    expect(native.vad.acceptWaveform).toHaveBeenCalledTimes(3);
    expect(native.vad.flush).toHaveBeenCalledTimes(1);
    expect(native.vad.destroy).toHaveBeenCalledTimes(1);
    expect(partials).toEqual(['买菜花了300元，', '买菜花了300元，其中用了195抵200的优惠券。']);
    expect(finalText).toBe('买菜花了300元，其中用了195抵200的优惠券。尾段');
  });

  it('surfaces capture failure and releases the VAD session on cancellation', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());
    const onError = vi.fn();
    await speech.start({ onPartial: vi.fn(), onError });

    native.emitError('microphone disconnected');
    await speech.cancel();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'capture-failed' }));
    expect(native.mic.stop).toHaveBeenCalledTimes(1);
    expect(native.vad.destroy).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight VAD work before destroying the native session', async () => {
    const speech = new SherpaStreamingSpeech(readyModelManager());
    let finishAccept!: (segments: []) => void;
    native.vad.acceptWaveform.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAccept = resolve;
        }),
    );
    await speech.start({ onPartial: vi.fn(), onError: vi.fn() });
    native.emitData([0.1]);
    await vi.waitFor(() => expect(native.vad.acceptWaveform).toHaveBeenCalledTimes(1));

    const cancellation = speech.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(native.vad.destroy).not.toHaveBeenCalled();
    finishAccept([]);
    await cancellation;
    expect(native.vad.destroy).toHaveBeenCalledTimes(1);
  });
});
