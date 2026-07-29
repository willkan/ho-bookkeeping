import type { SpeechTranscriberPort } from '../../application/ports/speech-transcriber';

export class FakeSpeechTranscriber implements SpeechTranscriberPort {
  available = true;
  transcript = '买菜花了300元';
  transcriptionResult: Promise<string> | null = null;
  error: Error | null = null;
  transcribeCallCount = 0;
  cancelCallCount = 0;
  lastRequest: {
    uri: string;
    lang: string;
    sampleRate: number;
    audioChannels: number;
  } | null = null;
  events: string[] = [];

  isAvailable(): boolean {
    return this.available;
  }

  async transcribe(request: {
    uri: string;
    lang: string;
    sampleRate: number;
    audioChannels: number;
  }): Promise<string> {
    this.transcribeCallCount += 1;
    this.lastRequest = request;
    this.events.push('transcribe:start');
    if (this.error) throw this.error;
    if (this.transcriptionResult) return this.transcriptionResult;
    return this.transcript;
  }

  cancel(): void {
    this.cancelCallCount += 1;
    this.events.push('transcribe:cancel');
  }
}
