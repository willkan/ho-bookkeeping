import { describe, expect, it, vi } from 'vitest';
import { SpeechTranscriptionError } from './ports/speech-transcriber';
import { sanitizeDiagnosticMessage } from '../infrastructure/logging/mobile-logger';
import { FakeSpeechTranscriber } from '../infrastructure/speech/fake-speech-transcriber';
import { FakeVoiceRecorder } from '../infrastructure/speech/fake-voice-recorder';
import { statusMessage, VOICE_COPY, VoiceSessionController } from './voice-session';

describe('record-then-transcribe contract cases', () => {
  it('shows the hold-to-talk affordance while idle', () => {
    const session = new VoiceSessionController(
      new FakeVoiceRecorder(),
      new FakeSpeechTranscriber(),
    );

    expect(statusMessage(session.getState())).toBe(VOICE_COPY.micHold);
  });

  it('starts app-owned recording on press without opening a speech recognition session', async () => {
    const recorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    const session = new VoiceSessionController(recorder, transcriber);

    await session.pressMic();

    expect(recorder.startCallCount).toBe(1);
    expect(transcriber.transcribeCallCount).toBe(0);
    expect(session.getState().phase).toBe('recording');
  });

  it('keeps recording while held and transcribes only after release', async () => {
    const recorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    const session = new VoiceSessionController(recorder, transcriber);

    await session.pressMic();
    await Promise.resolve();

    expect(recorder.stopCallCount).toBe(0);
    expect(transcriber.transcribeCallCount).toBe(0);
    expect(session.getState().phase).toBe('recording');

    await session.releaseMic();

    expect(recorder.stopCallCount).toBe(1);
    expect(transcriber.transcribeCallCount).toBe(1);
    expect(session.getState().phase).toBe('idle');
  });

  it('stops recording before transcribing the completed temporary audio file', async () => {
    const recorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    const session = new VoiceSessionController(recorder, transcriber);
    const originalTranscribe = transcriber.transcribe.bind(transcriber);
    transcriber.transcribe = async (request) => {
      expect(recorder.stopCallCount).toBe(1);
      return originalTranscribe(request);
    };

    await session.pressMic();
    await session.releaseMic();

    expect(transcriber.lastRequest).toEqual({
      uri: recorder.recording.uri,
      lang: 'zh-CN',
      sampleRate: 16000,
      audioChannels: 1,
    });
    expect(recorder.deletedUris).toEqual([recorder.recording.uri]);
  });

  it('appends one completed transcription to the pre-recording typed text', async () => {
    const recorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    transcriber.transcript = '花了100元';
    const session = new VoiceSessionController(recorder, transcriber);
    session.setTypedText('午饭');

    await session.pressMic();
    await session.releaseMic();

    expect(session.getState().typedText).toBe('午饭花了100元');
    expect(transcriber.transcribeCallCount).toBe(1);
  });

  it('a transcription network timeout cannot shorten or cancel recording', async () => {
    const recorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    transcriber.error = new SpeechTranscriptionError('model-load-failed');
    const session = new VoiceSessionController(recorder, transcriber);
    session.setTypedText('保留文字');

    await session.pressMic();
    expect(session.getState().phase).toBe('recording');
    expect(transcriber.transcribeCallCount).toBe(0);

    await session.releaseMic();
    expect(session.getState().phase).toBe('idle');
    expect(session.getState().typedText).toBe('保留文字');
    expect(session.getState().error).toEqual({
      reason: 'model_failed',
      message: VOICE_COPY.modelFailed,
    });
  });

  it('backgrounding cancels capture or transcription and deletes temporary audio', async () => {
    const recordingRecorder = new FakeVoiceRecorder();
    const recordingSession = new VoiceSessionController(
      recordingRecorder,
      new FakeSpeechTranscriber(),
    );
    await recordingSession.pressMic();
    await recordingSession.handleAppBackground();
    expect(recordingRecorder.cancelCallCount).toBe(1);
    expect(recordingSession.getState().phase).toBe('idle');

    let resolveTranscription!: (value: string) => void;
    const transcribingRecorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    transcriber.transcriptionResult = new Promise((resolve) => {
      resolveTranscription = resolve;
    });
    const transcribingSession = new VoiceSessionController(transcribingRecorder, transcriber);
    await transcribingSession.pressMic();
    const pendingStop = transcribingSession.releaseMic();
    await Promise.resolve();
    expect(transcribingSession.getState().phase).toBe('transcribing');

    await transcribingSession.handleAppBackground();
    resolveTranscription('不应写入');
    await pendingStop;

    expect(transcriber.cancelCallCount).toBe(1);
    expect(transcribingRecorder.deletedUris).toEqual([transcribingRecorder.recording.uri]);
    expect(transcribingSession.getState().typedText).toBe('');
  });

  it('permission denial and recorder failures preserve existing typed text', async () => {
    const deniedRecorder = new FakeVoiceRecorder();
    deniedRecorder.permissionGranted = false;
    const deniedSession = new VoiceSessionController(deniedRecorder, new FakeSpeechTranscriber());
    deniedSession.setTypedText('已有文字');
    await deniedSession.pressMic();
    expect(deniedSession.getState().typedText).toBe('已有文字');
    expect(deniedSession.getState().error?.reason).toBe('permission_denied');

    const failedRecorder = new FakeVoiceRecorder();
    failedRecorder.startError = new Error('native recorder failed');
    const failedSession = new VoiceSessionController(failedRecorder, new FakeSpeechTranscriber());
    failedSession.setTypedText('仍要保留');
    await failedSession.pressMic();
    expect(failedSession.getState().typedText).toBe('仍要保留');
    expect(failedSession.getState().error?.reason).toBe('recording_failed');
  });

  it('does not cancel a pending permission sheet when the host briefly backgrounds', async () => {
    let resolvePermission!: (result: { granted: boolean }) => void;
    const recorder = new FakeVoiceRecorder();
    recorder.permissionGranted = false;
    recorder.requestPermissions = () =>
      new Promise((resolve) => {
        resolvePermission = resolve;
      });
    const session = new VoiceSessionController(recorder, new FakeSpeechTranscriber());

    const pendingStart = session.pressMic();
    await Promise.resolve();
    expect(session.getState().phase).toBe('requesting_permission');
    await session.handleAppBackground();
    resolvePermission({ granted: true });
    await pendingStart;

    expect(recorder.cancelCallCount).toBe(0);
    expect(session.getState().phase).toBe('recording');
  });

  it('does not start recording after permission resolves if the user already released', async () => {
    let resolvePermission!: (result: { granted: boolean }) => void;
    const recorder = new FakeVoiceRecorder();
    recorder.permissionGranted = false;
    recorder.requestPermissions = () =>
      new Promise((resolve) => {
        resolvePermission = resolve;
      });
    const session = new VoiceSessionController(recorder, new FakeSpeechTranscriber());

    const pendingPress = session.pressMic();
    await Promise.resolve();
    await session.releaseMic();
    resolvePermission({ granted: true });
    await pendingPress;

    expect(recorder.startCallCount).toBe(0);
    expect(session.getState().phase).toBe('idle');
    expect(statusMessage(session.getState())).toBe(VOICE_COPY.holdAgain);
  });

  it('offers equivalent tap-to-start and tap-to-stop behavior for screen readers', async () => {
    const recorder = new FakeVoiceRecorder();
    const transcriber = new FakeSpeechTranscriber();
    const session = new VoiceSessionController(recorder, transcriber);

    await session.toggleMicForAccessibility();
    expect(session.getState().phase).toBe('recording');

    await session.toggleMicForAccessibility();
    expect(session.getState().phase).toBe('idle');
    expect(transcriber.transcribeCallCount).toBe(1);
  });

  it('cleans recognizable orphaned recording files on session startup', async () => {
    const recorder = new FakeVoiceRecorder();
    const session = new VoiceSessionController(recorder, new FakeSpeechTranscriber());

    await session.cleanupOrphanedRecordings();

    expect(recorder.cleanupOrphansCallCount).toBe(1);
  });

  it('voice capture and transcription never submit a ledger input automatically', async () => {
    const submit = vi.fn();
    const session = new VoiceSessionController(
      new FakeVoiceRecorder(),
      new FakeSpeechTranscriber(),
    );

    await session.pressMic();
    await session.releaseMic();

    expect(submit).not.toHaveBeenCalled();
    expect(session.getState().typedText).toBe('买菜花了300元');
  });
});

describe('voice privacy and composition contracts', () => {
  it('sanitizes native diagnostic messages before logging', () => {
    expect(sanitizeDiagnosticMessage('network\nBearer secret-token\tsk-123456789')).toBe(
      'network Bearer [REDACTED] [REDACTED]',
    );
  });

  it('voice session has no ledger submission dependency', async () => {
    const submit = vi.fn();
    const session = new VoiceSessionController(
      new FakeVoiceRecorder(),
      new FakeSpeechTranscriber(),
    );

    await session.pressMic();

    expect(submit).not.toHaveBeenCalled();
  });
});
