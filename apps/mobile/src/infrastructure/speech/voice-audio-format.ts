export const VOICE_AUDIO_FORMAT = {
  sampleRate: 16000,
  audioChannels: 1,
  bitRate: 64000,
} as const;

type RecordingOptionsBase = {
  android: Record<string, unknown>;
  [key: string]: unknown;
};

/** Keeps native recording parameters and SpeechRecognizer PCM declarations aligned. */
export function createVoiceRecordingOptions<T extends RecordingOptionsBase>(base: T) {
  return {
    ...base,
    sampleRate: VOICE_AUDIO_FORMAT.sampleRate,
    numberOfChannels: VOICE_AUDIO_FORMAT.audioChannels,
    bitRate: VOICE_AUDIO_FORMAT.bitRate,
    android: {
      ...base.android,
      audioSource: 'voice_recognition' as const,
    },
  };
}
