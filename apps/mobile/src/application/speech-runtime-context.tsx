import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { SenseVoiceVadModelArtifacts } from '../infrastructure/speech/sense-voice-vad-model-artifacts';
import { SherpaStreamingSpeech } from '../infrastructure/speech/sherpa-streaming-speech';
import type { StreamingSpeechPort } from './ports/streaming-speech';
import { SpeechModelManager } from './speech-model-manager';
import { useSpeechModel } from './use-speech-model';

type SpeechModelBinding = ReturnType<typeof useSpeechModel>;

type SpeechRuntimeContextValue = {
  speech: StreamingSpeechPort;
  speechModelManager: SpeechModelManager;
  speechModel: SpeechModelBinding;
  deleteSpeechModel(): Promise<void>;
};

const SpeechRuntimeContext = createContext<SpeechRuntimeContextValue | null>(null);

export function SpeechRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [speechModelManager] = useState(
    () => new SpeechModelManager(new SenseVoiceVadModelArtifacts()),
  );
  const [speech] = useState<StreamingSpeechPort>(
    () => new SherpaStreamingSpeech(speechModelManager),
  );
  const speechModel = useSpeechModel(speechModelManager);
  const modelReady = speechModel.state.phase === 'ready';

  const prepare = useCallback(() => {
    if (!modelReady) return;
    // Preparation is deliberately non-blocking. A later user press explicitly retries on failure.
    void speech.prepare().catch(() => undefined);
  }, [modelReady, speech]);

  useEffect(() => {
    if (!modelReady) return;
    const task = InteractionManager.runAfterInteractions(prepare);
    return () => task.cancel();
  }, [modelReady, prepare]);

  useEffect(() => {
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') prepare();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, [prepare]);

  useEffect(
    () => () => {
      void speech.dispose();
    },
    [speech],
  );

  const deleteSpeechModel = useCallback(async () => {
    await speech.dispose();
    await speechModel.deleteModel();
  }, [speech, speechModel]);

  const value = useMemo<SpeechRuntimeContextValue>(
    () => ({ speech, speechModelManager, speechModel, deleteSpeechModel }),
    [deleteSpeechModel, speech, speechModel, speechModelManager],
  );

  return <SpeechRuntimeContext.Provider value={value}>{children}</SpeechRuntimeContext.Provider>;
}

export function useSpeechRuntime(): SpeechRuntimeContextValue {
  const value = useContext(SpeechRuntimeContext);
  if (!value) throw new Error('useSpeechRuntime must be used within SpeechRuntimeProvider');
  return value;
}
