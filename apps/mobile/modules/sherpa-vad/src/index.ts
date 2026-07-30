import { requireNativeModule } from 'expo';

export type VoiceActivitySegment = {
  start: number;
  samples: number[];
};

export type VoiceActivityDetectorOptions = {
  modelPath: string;
  sampleRate: number;
  threshold: number;
  minSilenceDuration: number;
  minSpeechDuration: number;
  windowSize: number;
  maxSpeechDuration: number;
  numThreads: number;
  provider: string;
};

export type VoiceActivityDetector = {
  acceptWaveform(samples: number[]): Promise<VoiceActivitySegment[]>;
  flush(): Promise<VoiceActivitySegment[]>;
  destroy(): Promise<void>;
};

type SherpaVadNativeModule = {
  initialize(id: string, options: VoiceActivityDetectorOptions): Promise<void>;
  acceptWaveform(id: string, samples: number[]): Promise<VoiceActivitySegment[]>;
  flush(id: string): Promise<VoiceActivitySegment[]>;
  destroy(id: string): Promise<void>;
};

const SherpaVad = requireNativeModule<SherpaVadNativeModule>('SherpaVad');
let detectorCounter = 0;

export async function createVoiceActivityDetector(
  options: VoiceActivityDetectorOptions,
): Promise<VoiceActivityDetector> {
  const id = `vad_${++detectorCounter}`;
  await SherpaVad.initialize(id, options);
  let destroyed = false;

  const guard = () => {
    if (destroyed) throw new Error(`VAD instance ${id} has been destroyed`);
  };

  return {
    async acceptWaveform(samples) {
      guard();
      return SherpaVad.acceptWaveform(id, samples);
    },
    async flush() {
      guard();
      return SherpaVad.flush(id);
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await SherpaVad.destroy(id);
    },
  };
}
