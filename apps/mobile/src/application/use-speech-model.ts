import { useCallback, useEffect, useState } from 'react';
import type { SpeechModelDownloadSource } from './speech-model';
import type { SpeechModelManager } from './speech-model-manager';

export type SpeechModelUiState =
  | { phase: 'checking'; progress: 0; error: null }
  | { phase: 'missing'; progress: 0; error: null }
  | { phase: 'downloading'; progress: number; error: null }
  | { phase: 'ready'; progress: 1; error: null }
  | { phase: 'error'; progress: number; error: string };

export function useSpeechModel(manager: SpeechModelManager) {
  const [state, setState] = useState<SpeechModelUiState>({
    phase: 'checking',
    progress: 0,
    error: null,
  });

  const refresh = useCallback(async () => {
    const ready = await manager.isReady();
    setState(
      ready
        ? { phase: 'ready', progress: 1, error: null }
        : { phase: 'missing', progress: 0, error: null },
    );
    return ready;
  }, [manager]);

  useEffect(() => {
    void refresh();
    return () => manager.cancel();
  }, [manager, refresh]);

  const download = useCallback(
    async (source: SpeechModelDownloadSource) => {
      setState({ phase: 'downloading', progress: 0, error: null });
      try {
        await manager.download(source, ({ bytesDownloaded, totalBytes }) => {
          setState({
            phase: 'downloading',
            progress: totalBytes > 0 ? bytesDownloaded / totalBytes : 0,
            error: null,
          });
        });
        setState({ phase: 'ready', progress: 1, error: null });
      } catch (error) {
        setState({
          phase: 'error',
          progress: 0,
          error: error instanceof Error ? error.message : '语音模型下载失败',
        });
      }
    },
    [manager],
  );

  const deleteModel = useCallback(async () => {
    await manager.delete();
    setState({ phase: 'missing', progress: 0, error: null });
  }, [manager]);

  return { state, refresh, download, deleteModel };
}
