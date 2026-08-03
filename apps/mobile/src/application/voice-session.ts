import {
  StreamingSpeechError,
  type StreamingSpeechErrorCode,
  type StreamingSpeechPort,
} from './ports/streaming-speech';

export const VOICE_COPY = {
  streaming: '正在听，松开结束',
  finalizing: '正在完成识别…',
  permissionDenied: '未获得麦克风权限，可在系统设置中开启后重试',
  noSpeech: '没有识别到语音，可重试',
  modelNotReady: '请先下载离线语音模型',
  modelFailed: '本地语音模型加载失败，可重新下载后重试',
  captureFailed: '麦克风收音失败，可重试',
  recognitionFailed: '本地语音识别失败，可重试',
  busy: '语音识别正忙，请稍后再试',
  interrupted: '语音识别被打断，可重试',
  unknown: '语音识别出错，可重试',
  holdAgain: '权限已开启，请再按住说话',
  disclosure: '语音在本机识别，不会保存录音',
  micHold: '按住说话',
  micToggleIdle: '开始语音输入',
  micToggleStreaming: '结束语音输入',
  micFinalizing: '正在完成识别',
} as const;

export type VoiceErrorReason =
  | 'permission_denied'
  | 'no_speech'
  | 'model_not_ready'
  | 'model_failed'
  | 'busy'
  | 'interrupted'
  | 'capture_failed'
  | 'recognition_failed'
  | 'unknown';

export type VoiceSessionPhase = 'idle' | 'requesting_permission' | 'streaming' | 'finalizing';

export type VoiceSessionState = {
  phase: VoiceSessionPhase;
  typedText: string;
  partialText: string;
  error: { reason: VoiceErrorReason; message: string } | null;
  notice: string | null;
};

export function createInitialVoiceSessionState(typedText = ''): VoiceSessionState {
  return { phase: 'idle', typedText, partialText: '', error: null, notice: null };
}

export function joinTranscript(prefix: string, segment: string): string {
  if (!segment) return prefix;
  if (!prefix) return segment;
  if (/\s$/.test(prefix) || /^\s/.test(segment)) return prefix + segment;
  const last = prefix[prefix.length - 1]!;
  const first = segment[0]!;
  const isCjk = (character: string) => /[\u3400-\u9FFF]/.test(character);
  if (isCjk(last) || isCjk(first)) return prefix + segment;
  return `${prefix} ${segment}`;
}

export function displayText(state: VoiceSessionState): string {
  return joinTranscript(state.typedText, state.partialText);
}

export function isFieldEditingDisabled(state: VoiceSessionState): boolean {
  return state.phase !== 'idle';
}

export function statusMessage(state: VoiceSessionState): string | null {
  if (state.error) return state.error.message;
  if (state.notice) return state.notice;
  if (state.phase === 'streaming') return state.partialText || VOICE_COPY.streaming;
  if (state.phase === 'finalizing') return VOICE_COPY.finalizing;
  return VOICE_COPY.micHold;
}

export function mapSpeechError(code: StreamingSpeechErrorCode): {
  reason: VoiceErrorReason;
  message: string;
} {
  switch (code) {
    case 'no-speech':
      return { reason: 'no_speech', message: VOICE_COPY.noSpeech };
    case 'model-not-ready':
      return { reason: 'model_not_ready', message: VOICE_COPY.modelNotReady };
    case 'model-load-failed':
      return { reason: 'model_failed', message: VOICE_COPY.modelFailed };
    case 'capture-failed':
      return { reason: 'capture_failed', message: VOICE_COPY.captureFailed };
    case 'recognition-failed':
      return { reason: 'recognition_failed', message: VOICE_COPY.recognitionFailed };
    case 'busy':
      return { reason: 'busy', message: VOICE_COPY.busy };
    case 'interrupted':
      return { reason: 'interrupted', message: VOICE_COPY.interrupted };
    default:
      return { reason: 'unknown', message: VOICE_COPY.unknown };
  }
}

/** Owns the visible press → streaming preview → release/finalize state machine. */
export class VoiceSessionController {
  private state = createInitialVoiceSessionState();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private holdActive = false;

  constructor(private readonly speech: StreamingSpeechPort) {}

  getState(): VoiceSessionState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setTypedText(text: string): void {
    if (isFieldEditingDisabled(this.state)) return;
    this.patch({ typedText: text, error: null, notice: null });
  }

  async toggleMicForAccessibility(): Promise<void> {
    if (this.disposed) return;
    if (this.state.phase === 'streaming') {
      await this.stopAndFinalize();
      return;
    }
    if (this.state.phase === 'idle') await this.beginStreaming();
  }

  async pressMic(): Promise<void> {
    if (this.disposed || this.state.phase !== 'idle') return;
    this.holdActive = true;
    await this.beginStreaming(true);
  }

  async releaseMic(): Promise<void> {
    this.holdActive = false;
    if (this.disposed || this.state.phase !== 'streaming') return;
    await this.stopAndFinalize();
  }

  async handleAppBackground(): Promise<void> {
    if (this.state.phase === 'requesting_permission') return;
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    if (this.disposed) return;
    const active = this.state.phase === 'streaming' || this.state.phase === 'finalizing';
    this.holdActive = false;
    this.generation += 1;
    this.patch({ phase: 'idle', partialText: '', error: null, notice: null });
    if (active) await this.ignoreCleanupError(() => this.speech.cancel());
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.cleanup();
    this.listeners.clear();
    this.disposed = true;
  }

  private async beginStreaming(requireActiveHold = false): Promise<void> {
    const generation = ++this.generation;
    this.patch({
      phase: 'requesting_permission',
      partialText: '',
      error: null,
      notice: null,
    });

    if (!this.speech.isAvailable()) {
      this.failIfCurrent(generation, 'model_failed', VOICE_COPY.modelFailed);
      return;
    }

    try {
      const microphoneGranted = await this.ensurePermission();
      if (!this.isCurrent(generation)) return;
      if (!microphoneGranted) {
        this.failIfCurrent(generation, 'permission_denied', VOICE_COPY.permissionDenied);
        return;
      }
      if (requireActiveHold && !this.holdActive) {
        this.patch({ phase: 'idle', notice: VOICE_COPY.holdAgain });
        return;
      }

      await this.speech.start({
        onPartial: (text) => {
          if (this.isCurrent(generation) && this.state.phase === 'streaming') {
            this.patch({ partialText: text.trim() });
          }
        },
        onError: (error) => {
          if (this.isCurrent(generation)) void this.failActiveStream(generation, error);
        },
      });
      if (!this.isCurrent(generation)) {
        await this.ignoreCleanupError(() => this.speech.cancel());
        return;
      }
      if (requireActiveHold && !this.holdActive) {
        await this.ignoreCleanupError(() => this.speech.cancel());
        this.patch({ phase: 'idle', notice: VOICE_COPY.holdAgain });
        return;
      }
      this.patch({ phase: 'streaming' });
    } catch (error) {
      this.failWithError(generation, error, 'capture_failed', VOICE_COPY.captureFailed);
    }
  }

  private async stopAndFinalize(): Promise<void> {
    const generation = this.generation;
    this.patch({ phase: 'finalizing', error: null, notice: null });
    try {
      const transcript = (await this.speech.stop()).trim();
      if (!this.isCurrent(generation)) return;
      if (!transcript) {
        this.patch({
          phase: 'idle',
          partialText: '',
          error: { reason: 'no_speech', message: VOICE_COPY.noSpeech },
        });
        return;
      }
      this.patch({
        phase: 'idle',
        typedText: joinTranscript(this.state.typedText, transcript),
        partialText: '',
        error: null,
        notice: null,
      });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      if (error instanceof StreamingSpeechError && error.code === 'aborted') {
        this.patch({ phase: 'idle', partialText: '', error: null });
        return;
      }
      this.failWithError(generation, error, 'recognition_failed', VOICE_COPY.recognitionFailed);
    }
  }

  private async failActiveStream(generation: number, error: StreamingSpeechError): Promise<void> {
    if (!this.isCurrent(generation)) return;
    const mapped = mapSpeechError(error.code);
    this.generation += 1;
    this.holdActive = false;
    this.patch({ phase: 'idle', partialText: '', error: mapped });
    await this.ignoreCleanupError(() => this.speech.cancel());
  }

  private async ensurePermission(): Promise<boolean> {
    const current = await this.speech.getPermissions();
    if (current.granted) return true;
    return (await this.speech.requestPermissions()).granted;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private failWithError(
    generation: number,
    error: unknown,
    fallbackReason: VoiceErrorReason,
    fallbackMessage: string,
  ): void {
    if (!this.isCurrent(generation)) return;
    const mapped =
      error instanceof StreamingSpeechError
        ? mapSpeechError(error.code)
        : { reason: fallbackReason, message: fallbackMessage };
    this.patch({ phase: 'idle', partialText: '', error: mapped });
  }

  private failIfCurrent(generation: number, reason: VoiceErrorReason, message: string): void {
    if (this.isCurrent(generation)) {
      this.patch({ phase: 'idle', partialText: '', error: { reason, message } });
    }
  }

  private async ignoreCleanupError(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      // Cancellation is best effort; no audio file exists to leak.
    }
  }

  private patch(patch: Partial<VoiceSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
