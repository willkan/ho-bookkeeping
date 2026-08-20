import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { LedgerService } from '../../application/ledger-service';
import { OpenAiCompatibleParseTransport } from '../ai/transport';
import { ManagedPilotParseTransport, SelectedAiParseTransport } from '../ai/managed-pilot';
import { SecureManagedPilotRepository } from '../ai/secure-managed-pilot';
import { SecureProviderConfigRepository } from '../ai/secure-provider-config';
import { openAppDatabase } from '../db/open-app-database';
import { LedgerRepository } from '../db/repositories';
import { ExpoCryptoIdGenerator } from '../ids/expo-crypto-id-generator';
import { ParseJobRunner } from './runner';

/**
 * OS-registered background task name.
 * OS timing is not guaranteed (WorkManager / BGTaskScheduler).
 * SQLite job rows remain formal task truth; this only triggers resume.
 */
export const PARSE_BACKGROUND_TASK_NAME = 'bookkeeping-parse-jobs';

/**
 * Module-level runner coordination for the same process as the UI.
 * Foreground AppState and OS triggers share this single-flight runner when set.
 */
let sharedRunner: ParseJobRunner | null = null;

export function setSharedParseJobRunner(runner: ParseJobRunner | null): void {
  sharedRunner = runner;
}

export function getSharedParseJobRunner(): ParseJobRunner | null {
  return sharedRunner;
}

/**
 * Execute eligible parse jobs using the same encrypted SQLite fact source and runner.
 * Opens its own DB connection when the UI runner is not available (true background process).
 * Uses the same SecureProviderConfigRepository as AppProvider (same secure-store key).
 */
export async function runBackgroundParseJobs(): Promise<number> {
  if (sharedRunner) {
    return sharedRunner.resume();
  }

  const ids = new ExpoCryptoIdGenerator();
  const db = await openAppDatabase();
  try {
    const repo = new LedgerRepository(db, ids);
    const store = new SecureProviderConfigRepository();
    const pilotStore = new SecureManagedPilotRepository();
    const transport = new SelectedAiParseTransport(
      pilotStore,
      new ManagedPilotParseTransport(pilotStore),
      new OpenAiCompatibleParseTransport(store),
    );
    const service = new LedgerService(repo, transport, ids);
    const runner = new ParseJobRunner(service);
    return await runner.resume();
  } finally {
    db.close();
  }
}

let defined = false;

/**
 * Define the OS task once at module load (required by TaskManager before register).
 * Safe to import from app entry; definition is idempotent.
 */
export function defineParseBackgroundTask(): void {
  if (defined) return;
  if (TaskManager.isTaskDefined(PARSE_BACKGROUND_TASK_NAME)) {
    defined = true;
    return;
  }
  TaskManager.defineTask(PARSE_BACKGROUND_TASK_NAME, async () => {
    try {
      await runBackgroundParseJobs();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      // Do not swallow job state — SQLite rows retain failure/retry. Signal OS retry eligibility.
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
  defined = true;
}

export type BackgroundSchedulingRegistration =
  | { status: 'ok'; detail: string }
  | { status: 'degraded'; detail: string };

/**
 * Register supplemental OS scheduling. Does not replace startup/foreground resume.
 * Missing BYOK config does not block registration; jobs fail explicitly via transport.
 * Returns explicit ok/degraded result — callers must surface degradation (never silent success).
 */
export async function registerParseBackgroundTask(): Promise<BackgroundSchedulingRegistration> {
  defineParseBackgroundTask();
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      return {
        status: 'degraded',
        detail: 'OS background task status is Restricted; supplemental scheduling unavailable',
      };
    }
    const registered = await TaskManager.isTaskRegisteredAsync(PARSE_BACKGROUND_TASK_NAME);
    if (!registered) {
      await BackgroundTask.registerTaskAsync(PARSE_BACKGROUND_TASK_NAME, {
        // Minimum interval in minutes; OS may delay further and is not guaranteed.
        minimumInterval: 15,
      });
    }
    return {
      status: 'ok',
      detail: `registered ${PARSE_BACKGROUND_TASK_NAME}`,
    };
  } catch (error) {
    return {
      status: 'degraded',
      detail: `background task registration failed: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    };
  }
}
