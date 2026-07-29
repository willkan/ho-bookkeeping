import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useMemo } from 'react';
import type {
  CompletedVoiceRecording,
  VoicePermissionResult,
  VoiceRecorderPort,
} from '../../application/ports/voice-recorder';
import { createMobileLogger, sanitizeDiagnosticMessage } from '../logging/mobile-logger';
import { createVoiceRecordingOptions, VOICE_AUDIO_FORMAT } from './voice-audio-format';

const logger = createMobileLogger('voice-recorder');
const VOICE_RECORDING_OPTIONS = createVoiceRecordingOptions(RecordingPresets.HIGH_QUALITY);

class ExpoVoiceRecorder implements VoiceRecorderPort {
  private startedAtMs: number | null = null;

  constructor(private readonly recorder: AudioRecorder) {}

  async getPermissions(): Promise<VoicePermissionResult> {
    const result = await getRecordingPermissionsAsync();
    logger.info('permission_checked', { granted: result.granted });
    return { granted: result.granted };
  }

  async requestPermissions(): Promise<VoicePermissionResult> {
    const result = await requestRecordingPermissionsAsync();
    logger.info('permission_requested', { granted: result.granted });
    return { granted: result.granted };
  }

  async start(): Promise<void> {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        allowsBackgroundRecording: false,
        interruptionMode: 'doNotMix',
      });
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
      this.startedAtMs = Date.now();
      logger.info('recording_started');
    } catch (error) {
      logger.error('recording_start_failed', {
        error_message: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw error;
    }
  }

  async stop(): Promise<CompletedVoiceRecording> {
    try {
      const durationMillis = this.recorder.getStatus().durationMillis;
      await this.recorder.stop();
      const uri = this.recorder.uri;
      if (!uri) throw new Error('Recorder returned no temporary file');
      logger.info('recording_stopped', {
        duration_ms: durationMillis,
        elapsed_ms: this.elapsedMs(),
      });
      return {
        uri,
        durationMillis,
        sampleRate: VOICE_AUDIO_FORMAT.sampleRate,
        audioChannels: VOICE_AUDIO_FORMAT.audioChannels,
      };
    } catch (error) {
      logger.error('recording_stop_failed', {
        elapsed_ms: this.elapsedMs(),
        error_message: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw error;
    } finally {
      this.startedAtMs = null;
      await this.deactivateRecordingMode();
    }
  }

  async cancel(): Promise<void> {
    let uri = this.recorder.uri;
    try {
      if (this.recorder.isRecording) {
        await this.recorder.stop();
        uri = this.recorder.uri;
      }
      logger.info('recording_cancelled', { elapsed_ms: this.elapsedMs() });
    } finally {
      this.startedAtMs = null;
      await this.deactivateRecordingMode();
      if (uri) await this.deleteTemporaryFile(uri);
    }
  }

  async deleteTemporaryFile(uri: string): Promise<void> {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
      logger.info('temporary_audio_deleted');
    } catch (error) {
      logger.warn('temporary_audio_delete_failed', {
        error_message: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw error;
    }
  }

  async cleanupOrphanedFiles(): Promise<void> {
    let deletedCount = 0;
    try {
      for (const entry of Paths.cache.list()) {
        if (entry instanceof File && /^recording-[0-9a-f-]+\.m4a$/i.test(entry.name)) {
          entry.delete();
          deletedCount += 1;
        }
      }
      logger.info('orphaned_audio_cleanup_completed', { deleted_count: deletedCount });
    } catch (error) {
      logger.warn('orphaned_audio_cleanup_failed', {
        error_message: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
      throw error;
    }
  }

  private elapsedMs(): number | null {
    return this.startedAtMs === null ? null : Date.now() - this.startedAtMs;
  }

  private async deactivateRecordingMode(): Promise<void> {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        allowsBackgroundRecording: false,
      });
    } catch (error) {
      logger.warn('audio_mode_reset_failed', {
        error_message: sanitizeDiagnosticMessage(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  }
}

/** React-managed native recorder; the hook keeps the shared native object lifecycle scoped to UI. */
export function useExpoVoiceRecorder(): VoiceRecorderPort {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  return useMemo(() => new ExpoVoiceRecorder(recorder), [recorder]);
}
