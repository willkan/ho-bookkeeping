import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { StreamingSpeechPort } from './ports/streaming-speech';
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
export function useVoiceSession(speech: StreamingSpeechPort) {
  const [controller] = useState(() => new VoiceSessionController(speech));

  const state = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.getState(),
    () => controller.getState(),
  );

  useEffect(() => {
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
    isRecording: state.phase === 'streaming',
    isBusy: state.phase === 'requesting_permission' || state.phase === 'finalizing',
  };
}

function micToggleLabel(state: VoiceSessionState): string {
  if (state.phase === 'streaming') return VOICE_COPY.micToggleStreaming;
  if (state.phase === 'finalizing') return VOICE_COPY.micFinalizing;
  return VOICE_COPY.micToggleIdle;
}
