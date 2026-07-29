import { describe, expect, it } from 'vitest';
import { createVoiceRecordingOptions, VOICE_AUDIO_FORMAT } from './voice-audio-format';

describe('voice audio transport contract', () => {
  it('normalizes the recorder and speech source to 16 kHz mono voice audio', () => {
    const options = createVoiceRecordingOptions({
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      android: {
        outputFormat: 'mpeg4',
        audioEncoder: 'aac',
      },
    });

    expect(VOICE_AUDIO_FORMAT).toEqual({
      sampleRate: 16000,
      audioChannels: 1,
      bitRate: 64000,
    });
    expect(options).toMatchObject({
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 64000,
      android: {
        outputFormat: 'mpeg4',
        audioEncoder: 'aac',
        audioSource: 'voice_recognition',
      },
    });
  });
});
