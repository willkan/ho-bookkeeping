import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { SpeechTranscriberPort } from './ports/speech-transcriber';
import type { VoiceRecorderPort } from './ports/voice-recorder';
import {
  displayText,
  isFieldEditingDisabled,
  statusMessage,
  VoiceSessionController,
  type VoiceSessionState,
  VOICE_COPY,
} from './voice-session';

/**
 * React binding for VoiceSessionController.
 * Cleans up on unmount and AppState background.
 */
export function useVoiceSession(recorder: VoiceRecorderPort, transcriber: SpeechTranscriberPort) {
  const [controller] = useState(() => new VoiceSessionController(recorder, transcriber));

  const state = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.getState(),
    () => controller.getState(),
  );

  useEffect(() => {
    void controller.cleanupOrphanedRecordings();
    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active') {
        void controller.handleAppBackground();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      sub.remove();
      void controller.dispose();
    };
  }, [controller]);

  const setTypedText = useCallback(
    (text: string) => {
      controller.setTypedText(text);
    },
    [controller],
  );

  const pressMic = useCallback(() => {
    void controller.pressMic();
  }, [controller]);

  const releaseMic = useCallback(() => {
    void controller.releaseMic();
  }, [controller]);

  const toggleMicForAccessibility = useCallback(() => {
    void controller.toggleMicForAccessibility();
  }, [controller]);

  return {
    state,
    displayValue: displayText(state),
    editingDisabled: isFieldEditingDisabled(state),
    statusMessage: statusMessage(state),
    disclosure: VOICE_COPY.disclosure,
    setTypedText,
    pressMic,
    releaseMic,
    toggleMicForAccessibility,
    micHoldAccessibilityLabel: VOICE_COPY.micHold,
    micToggleAccessibilityLabel: micToggleLabel(state),
    isRecording: state.phase === 'recording',
    isBusy: state.phase === 'requesting_permission' || state.phase === 'transcribing',
  };
}

function micToggleLabel(state: VoiceSessionState): string {
  if (state.phase === 'recording') return VOICE_COPY.micToggleRecording;
  if (state.phase === 'transcribing') return VOICE_COPY.micTranscribing;
  return VOICE_COPY.micToggleIdle;
}
