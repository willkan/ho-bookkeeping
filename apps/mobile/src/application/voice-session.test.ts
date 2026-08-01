import { describe, expect, it, vi } from 'vitest';
import { StreamingSpeechError } from './ports/streaming-speech';
import { sanitizeDiagnosticMessage } from '../infrastructure/logging/mobile-logger';
import { FakeStreamingSpeech } from '../infrastructure/speech/fake-streaming-speech';
import { displayText, statusMessage, VOICE_COPY, VoiceSessionController } from './voice-session';

describe('streaming voice input contract cases', () => {
  it('shows the hold-to-talk affordance while idle', () => {
    const session = new VoiceSessionController(new FakeStreamingSpeech());
    expect(statusMessage(session.getState())).toBe(VOICE_COPY.micHold);
  });

  it('starts one microphone and recognizer stream when the press becomes active', async () => {
    const speech = new FakeStreamingSpeech();
    const session = new VoiceSessionController(speech);

    await session.pressMic();

    expect(speech.startCallCount).toBe(1);
    expect(session.getState().phase).toBe('streaming');
  });

  it('shows changing partial text without committing it to typed text', async () => {
    const speech = new FakeStreamingSpeech();
    const session = new VoiceSessionController(speech);
    session.setTypedText('午饭');

    await session.pressMic();
    speech.emitPartial('花了');
    expect(session.getState().partialText).toBe('花了');
    expect(session.getState().typedText).toBe('午饭');
    expect(displayText(session.getState())).toBe('午饭花了');

    speech.emitPartial('花了100元');
    expect(session.getState().partialText).toBe('花了100元');
    expect(session.getState().typedText).toBe('午饭');
    expect(displayText(session.getState())).toBe('午饭花了100元');
  });

  it('stops only on release and commits the final transcript exactly once', async () => {
    const speech = new FakeStreamingSpeech();
    speech.finalTranscript = '花了100元';
    const session = new VoiceSessionController(speech);
    session.setTypedText('午饭');

    await session.pressMic();
    speech.emitPartial('花了');
    expect(speech.stopCallCount).toBe(0);

    await session.releaseMic();
    await session.releaseMic();

    expect(speech.stopCallCount).toBe(1);
    expect(session.getState()).toMatchObject({
      phase: 'idle',
      typedText: '午饭花了100元',
      partialText: '',
    });
  });

  it('does not commit a partial result when finalization fails', async () => {
    const speech = new FakeStreamingSpeech();
    speech.stopError = new StreamingSpeechError('recognition-failed');
    const session = new VoiceSessionController(speech);
    session.setTypedText('已有文字');

    await session.pressMic();
    speech.emitPartial('不应写入');
    await session.releaseMic();

    expect(session.getState().typedText).toBe('已有文字');
    expect(session.getState().partialText).toBe('');
    expect(session.getState().error?.message).toBe(VOICE_COPY.recognitionFailed);
  });

  it('maps an empty final transcript to a recoverable no-speech error', async () => {
    const speech = new FakeStreamingSpeech();
    speech.finalTranscript = '';
    const session = new VoiceSessionController(speech);

    await session.pressMic();
    await session.releaseMic();

    expect(session.getState().error).toEqual({
      reason: 'no_speech',
      message: VOICE_COPY.noSpeech,
    });
  });

  it('cancels the stream on background and ignores late partial or final results', async () => {
    let resolveStop!: (value: string) => void;
    const speech = new FakeStreamingSpeech();
    speech.stopResult = new Promise((resolve) => {
      resolveStop = resolve;
    });
    const session = new VoiceSessionController(speech);

    await session.pressMic();
    const pendingStop = session.releaseMic();
    await Promise.resolve();
    expect(session.getState().phase).toBe('finalizing');

    await session.handleAppBackground();
    speech.emitPartial('不应出现');
    resolveStop('也不应出现');
    await pendingStop;

    expect(speech.cancelCallCount).toBe(1);
    expect(session.getState().typedText).toBe('');
    expect(session.getState().partialText).toBe('');
  });

  it('preserves typed text across permission denial and stream startup failure', async () => {
    const deniedSpeech = new FakeStreamingSpeech();
    deniedSpeech.permissionGranted = false;
    const deniedSession = new VoiceSessionController(deniedSpeech);
    deniedSession.setTypedText('已有文字');
    await deniedSession.pressMic();
    expect(deniedSession.getState().typedText).toBe('已有文字');
    expect(deniedSession.getState().error?.reason).toBe('permission_denied');

    const failedSpeech = new FakeStreamingSpeech();
    failedSpeech.startError = new StreamingSpeechError('model-load-failed');
    const failedSession = new VoiceSessionController(failedSpeech);
    failedSession.setTypedText('仍要保留');
    await failedSession.pressMic();
    expect(failedSession.getState().typedText).toBe('仍要保留');
    expect(failedSession.getState().error?.reason).toBe('model_failed');
  });

  it('does not cancel a pending permission sheet when the host briefly backgrounds', async () => {
    let resolvePermission!: (result: { granted: boolean }) => void;
    const speech = new FakeStreamingSpeech();
    speech.permissionGranted = false;
    speech.requestPermissions = () =>
      new Promise((resolve) => {
        resolvePermission = resolve;
      });
    const session = new VoiceSessionController(speech);

    const pendingStart = session.pressMic();
    await Promise.resolve();
    await session.handleAppBackground();
    resolvePermission({ granted: true });
    await pendingStart;

    expect(speech.cancelCallCount).toBe(0);
    expect(session.getState().phase).toBe('streaming');
  });

  it('does not start after permission resolves if the user already released', async () => {
    let resolvePermission!: (result: { granted: boolean }) => void;
    const speech = new FakeStreamingSpeech();
    speech.permissionGranted = false;
    speech.requestPermissions = () =>
      new Promise((resolve) => {
        resolvePermission = resolve;
      });
    const session = new VoiceSessionController(speech);

    const pendingPress = session.pressMic();
    await Promise.resolve();
    await session.releaseMic();
    resolvePermission({ granted: true });
    await pendingPress;

    expect(speech.startCallCount).toBe(0);
    expect(statusMessage(session.getState())).toBe(VOICE_COPY.holdAgain);
  });

  it('offers equivalent tap-to-start and tap-to-stop behavior for screen readers', async () => {
    const speech = new FakeStreamingSpeech();
    const session = new VoiceSessionController(speech);

    await session.toggleMicForAccessibility();
    expect(session.getState().phase).toBe('streaming');
    await session.toggleMicForAccessibility();

    expect(session.getState().phase).toBe('idle');
    expect(speech.stopCallCount).toBe(1);
  });

  it('reports an asynchronous native stream error and cancels without keeping partial text', async () => {
    const speech = new FakeStreamingSpeech();
    const session = new VoiceSessionController(speech);
    session.setTypedText('保留');
    await session.pressMic();
    speech.emitPartial('临时');

    speech.emitError(new StreamingSpeechError('capture-failed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(speech.cancelCallCount).toBe(1);
    expect(session.getState().typedText).toBe('保留');
    expect(session.getState().partialText).toBe('');
    expect(session.getState().error?.message).toBe(VOICE_COPY.captureFailed);
  });

  it('never submits a ledger input automatically', async () => {
    const submit = vi.fn();
    const session = new VoiceSessionController(new FakeStreamingSpeech());

    await session.pressMic();
    await session.releaseMic();

    expect(submit).not.toHaveBeenCalled();
    expect(session.getState().typedText).toBe('买菜花了300元');
  });
});

describe('voice privacy contract', () => {
  it('sanitizes native diagnostic messages before logging', () => {
    expect(sanitizeDiagnosticMessage('network\nBearer secret-token\tsk-123456789')).toBe(
      'network Bearer [REDACTED] [REDACTED]',
    );
  });

  it('discloses that streaming recognition does not create an audio file', () => {
    expect(VOICE_COPY.disclosure).toContain('不会保存录音');
    expect(VOICE_COPY.disclosure).toContain('本机');
  });
});
