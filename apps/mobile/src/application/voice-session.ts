import {
  SpeechTranscriptionError,
  type SpeechTranscriptionErrorCode,
  type SpeechTranscriberPort,
} from './ports/speech-transcriber';
import type { VoiceRecorderPort } from './ports/voice-recorder';

export const VOICE_COPY = {
  recording: '正在录音，松开结束',
  transcribing: '正在转成文字…',
  permissionDenied: '未获得麦克风权限，可在系统设置中开启后重试',
  noSpeech: '没有识别到语音，可重试',
  modelNotReady: '请先下载离线语音模型',
  modelFailed: '本地语音模型加载失败，可重新下载后重试',
  busy: '语音转写正忙，请稍后再试',
  interrupted: '语音转写被打断，可重试',
  recordingFailed: '录音失败，可重试',
  unknown: '语音转写出错，可重试',
  holdAgain: '权限已开启，请再按住说话',
  disclosure: '录音仅临时保存在本机，转写后删除；识别完全在本机进行',
  micHold: '按住说话',
  micToggleIdle: '开始录音',
  micToggleRecording: '结束录音',
  micTranscribing: '正在转写',
} as const;

export type VoiceErrorReason =
  | 'permission_denied'
  | 'no_speech'
  | 'model_not_ready'
  | 'model_failed'
  | 'busy'
  | 'interrupted'
  | 'recording_failed'
  | 'unknown';

export type VoiceSessionPhase = 'idle' | 'requesting_permission' | 'recording' | 'transcribing';

export type VoiceSessionState = {
  phase: VoiceSessionPhase;
  typedText: string;
  error: { reason: VoiceErrorReason; message: string } | null;
  notice: string | null;
};

export function createInitialVoiceSessionState(typedText = ''): VoiceSessionState {
  return { phase: 'idle', typedText, error: null, notice: null };
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
  return state.typedText;
}

export function isFieldEditingDisabled(state: VoiceSessionState): boolean {
  return state.phase !== 'idle';
}

export function statusMessage(state: VoiceSessionState): string | null {
  if (state.error) return state.error.message;
  if (state.notice) return state.notice;
  if (state.phase === 'recording') return VOICE_COPY.recording;
  if (state.phase === 'transcribing') return VOICE_COPY.transcribing;
  return VOICE_COPY.micHold;
}

export function mapSpeechError(code: SpeechTranscriptionErrorCode): {
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
    case 'busy':
      return { reason: 'busy', message: VOICE_COPY.busy };
    case 'interrupted':
      return { reason: 'interrupted', message: VOICE_COPY.interrupted };
    default:
      return { reason: 'unknown', message: VOICE_COPY.unknown };
  }
}

/** Owns the visible record → stop → transcribe state machine; never submits a ledger input. */
export class VoiceSessionController {
  private state = createInitialVoiceSessionState();
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private activeTemporaryUri: string | null = null;
  private disposed = false;
  private holdActive = false;

  constructor(
    private readonly recorder: VoiceRecorderPort,
    private readonly transcriber: SpeechTranscriberPort,
  ) {}

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
    if (this.state.phase === 'recording') {
      await this.stopAndTranscribe();
      return;
    }
    if (this.state.phase === 'idle') {
      await this.beginRecording();
    }
  }

  async pressMic(): Promise<void> {
    if (this.disposed || this.state.phase !== 'idle') return;
    this.holdActive = true;
    await this.beginRecording(true);
  }

  async releaseMic(): Promise<void> {
    this.holdActive = false;
    if (this.disposed || this.state.phase !== 'recording') return;
    await this.stopAndTranscribe();
  }

  async cleanupOrphanedRecordings(): Promise<void> {
    await this.ignoreCleanupError(() => this.recorder.cleanupOrphanedFiles());
  }

  async handleAppBackground(): Promise<void> {
    // Native permission sheets may briefly background the host. No audio exists yet,
    // so let the permission promise settle instead of invalidating the user's first tap.
    if (this.state.phase === 'requesting_permission') return;
    await this.cleanup();
  }

  async cleanup(): Promise<void> {
    if (this.disposed) return;
    const phase = this.state.phase;
    const uri = this.activeTemporaryUri;
    this.activeTemporaryUri = null;
    this.holdActive = false;
    this.generation += 1;
    this.patch({ phase: 'idle', error: null, notice: null });

    if (phase === 'recording') {
      await this.ignoreCleanupError(() => this.recorder.cancel());
    }
    if (phase === 'transcribing') {
      this.transcriber.cancel();
    }
    if (uri) {
      await this.ignoreCleanupError(() => this.recorder.deleteTemporaryFile(uri));
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.cleanup();
    this.listeners.clear();
    this.disposed = true;
  }

  private async beginRecording(requireActiveHold = false): Promise<void> {
    const generation = ++this.generation;
    this.patch({ phase: 'requesting_permission', error: null, notice: null });

    if (!this.transcriber.isAvailable()) {
      this.failIfCurrent(generation, 'model_failed', VOICE_COPY.modelFailed);
      return;
    }

    try {
      const microphoneGranted = await this.ensurePermission(
        () => this.recorder.getPermissions(),
        () => this.recorder.requestPermissions(),
      );
      if (!this.isCurrent(generation)) return;
      if (!microphoneGranted) {
        this.failIfCurrent(generation, 'permission_denied', VOICE_COPY.permissionDenied);
        return;
      }
      if (requireActiveHold && !this.holdActive) {
        this.patch({ phase: 'idle', notice: VOICE_COPY.holdAgain });
        return;
      }

      await this.recorder.start();
      if (!this.isCurrent(generation)) {
        await this.ignoreCleanupError(() => this.recorder.cancel());
        return;
      }
      if (requireActiveHold && !this.holdActive) {
        await this.ignoreCleanupError(() => this.recorder.cancel());
        this.patch({ phase: 'idle', notice: VOICE_COPY.holdAgain });
        return;
      }
      this.patch({ phase: 'recording' });
    } catch {
      this.failIfCurrent(generation, 'recording_failed', VOICE_COPY.recordingFailed);
    }
  }

  private async stopAndTranscribe(): Promise<void> {
    const generation = this.generation;
    this.patch({ phase: 'transcribing', error: null, notice: null });
    let uri: string | null = null;
    let uriRegisteredForCleanup = false;

    try {
      const recording = await this.recorder.stop();
      uri = recording.uri;
      if (!this.isCurrent(generation)) return;
      this.activeTemporaryUri = uri;
      uriRegisteredForCleanup = true;
      const transcript = (
        await this.transcriber.transcribe({
          uri,
          lang: 'zh-CN',
          sampleRate: recording.sampleRate,
          audioChannels: recording.audioChannels,
        })
      ).trim();
      if (!this.isCurrent(generation)) return;
      if (!transcript) {
        this.patch({
          phase: 'idle',
          error: { reason: 'no_speech', message: VOICE_COPY.noSpeech },
        });
        return;
      }
      this.patch({
        phase: 'idle',
        typedText: joinTranscript(this.state.typedText, transcript),
        error: null,
        notice: null,
      });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      if (error instanceof SpeechTranscriptionError) {
        if (error.code === 'aborted') {
          this.patch({ phase: 'idle', error: null });
        } else {
          const mapped = mapSpeechError(error.code);
          this.patch({ phase: 'idle', error: mapped });
        }
      } else {
        this.patch({
          phase: 'idle',
          error: {
            reason: uri ? 'unknown' : 'recording_failed',
            message: uri ? VOICE_COPY.unknown : VOICE_COPY.recordingFailed,
          },
        });
      }
    } finally {
      const stillOwnsFile =
        Boolean(uri) && (!uriRegisteredForCleanup || this.activeTemporaryUri === uri);
      if (stillOwnsFile && uri) {
        await this.ignoreCleanupError(() => this.recorder.deleteTemporaryFile(uri!));
      }
      if (this.activeTemporaryUri === uri) this.activeTemporaryUri = null;
    }
  }

  private async ensurePermission(
    get: () => Promise<{ granted: boolean }>,
    request: () => Promise<{ granted: boolean }>,
  ): Promise<boolean> {
    const current = await get();
    if (current.granted) return true;
    return (await request()).granted;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private failIfCurrent(generation: number, reason: VoiceErrorReason, message: string): void {
    if (this.isCurrent(generation)) {
      this.patch({ phase: 'idle', error: { reason, message } });
    }
  }

  private async ignoreCleanupError(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      // Cleanup is best effort; the file is in the OS-managed cache.
    }
  }

  private patch(patch: Partial<VoiceSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
