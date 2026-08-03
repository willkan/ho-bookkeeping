import { CONTRACT_VERSION } from '@bookkeeping/contracts';
import type { IdGenerator } from '../../application/ports/id-generator';
import type {
  AppSettings,
  ConfirmMode,
  LifecycleStatus,
  ModeTagSnapshot,
  ParseJob,
  RawInput,
} from '../../domain/types';
import { mapParseJob, mapRawInput, type ParseJobRow, type RawInputRow } from './mappers';
import type { SqliteDatabase } from './sqlite-database';

/** Settings, raw inputs, and parse jobs over the single SQLite fact path. */
export class SettingsJobsRepository {
  constructor(
    protected readonly db: SqliteDatabase,
    protected readonly ids: IdGenerator,
  ) {}

  getSettings(): AppSettings {
    const confirm =
      this.db.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'confirm_mode'")
        ?.value ?? 'auto_post';
    return {
      confirmMode: confirm as ConfirmMode,
    };
  }

  setConfirmMode(mode: ConfirmMode): void {
    this.db.run(
      `INSERT INTO app_settings (key, value) VALUES ('confirm_mode', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [mode],
    );
  }

  /**
   * Atomic: save raw input + unique pending parse job in one transaction.
   */
  submitRawInput(input: {
    id: string;
    rawText: string;
    submittedAt: string;
    timezone: string;
    localDate: string;
    confirmMode: ConfirmMode;
    modeIdSnapshot: string | null;
    modeNameSnapshot: string | null;
    defaultTagsSnapshot: ModeTagSnapshot[];
    includeInModeStats: boolean;
    jobId: string;
    clientRequestId: string;
  }): { rawInput: RawInput; job: ParseJob } {
    return this.db.withTransaction(() => {
      const now = input.submittedAt;
      this.db.run(
        `INSERT INTO raw_inputs (
        id, raw_text, submitted_at, timezone, local_date, lifecycle_status, confirm_mode,
        mode_id_snapshot, mode_name_snapshot, default_tags_snapshot_json, include_in_mode_stats,
        parse_error_category, parse_error_message, candidates_json, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 'pending_parse', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`,
        [
          input.id,
          input.rawText,
          input.submittedAt,
          input.timezone,
          input.localDate,
          input.confirmMode,
          input.modeIdSnapshot,
          input.modeNameSnapshot,
          JSON.stringify(input.defaultTagsSnapshot),
          input.includeInModeStats ? 1 : 0,
          now,
          now,
        ],
      );
      const idempotencyKey = `parse:${input.id}`;
      this.db.run(
        `INSERT INTO parse_jobs (
        id, raw_input_id, status, attempts, max_attempts, next_eligible_at,
        last_error_category, last_error_message, client_request_id, idempotency_key,
        model_version, provider_host, config_revision, contract_version, created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, 5, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
        [
          input.jobId,
          input.id,
          now,
          input.clientRequestId,
          idempotencyKey,
          CONTRACT_VERSION,
          now,
          now,
        ],
      );
      const rawInput = this.getRawInput(input.id);
      const job = this.getParseJob(input.jobId);
      if (!rawInput || !job) {
        throw new Error('failed to load submitted raw input / job');
      }
      return { rawInput, job };
    });
  }

  getRawInput(id: string): RawInput | undefined {
    const row = this.db.get<RawInputRow>('SELECT * FROM raw_inputs WHERE id = ?', [id]);
    return row ? mapRawInput(row) : undefined;
  }

  getParseJob(id: string): ParseJob | undefined {
    const row = this.db.get<ParseJobRow>('SELECT * FROM parse_jobs WHERE id = ?', [id]);
    return row ? mapParseJob(row) : undefined;
  }

  getParseJobByRawInputId(rawInputId: string): ParseJob | undefined {
    const row = this.db.get<ParseJobRow>('SELECT * FROM parse_jobs WHERE raw_input_id = ?', [
      rawInputId,
    ]);
    return row ? mapParseJob(row) : undefined;
  }

  /**
   * Reclaim orphaned running jobs after process death.
   * SQLite job row is truth; startup always resumes work that never finished.
   */
  reclaimStaleRunningJobs(nowIso: string, staleBeforeIso: string): number {
    const result = this.db.run(
      `UPDATE parse_jobs
     SET status = 'pending', next_eligible_at = ?, updated_at = ?
     WHERE status = 'running' AND updated_at <= ?`,
      [nowIso, nowIso, staleBeforeIso],
    );
    return result.changes;
  }

  listEligibleJobs(nowIso: string, limit = 10): ParseJob[] {
    const rows = this.db.all<ParseJobRow>(
      `SELECT * FROM parse_jobs
     WHERE status IN ('pending', 'failed_retryable')
       AND next_eligible_at <= ?
     ORDER BY next_eligible_at ASC
     LIMIT ?`,
      [nowIso, limit],
    );
    return rows.map(mapParseJob);
  }

  claimJob(jobId: string, nowIso: string): ParseJob | undefined {
    const result = this.db.run(
      `UPDATE parse_jobs
     SET status = 'running', attempts = attempts + 1, updated_at = ?
     WHERE id = ?
       AND status IN ('pending', 'failed_retryable')
       AND next_eligible_at <= ?`,
      [nowIso, jobId, nowIso],
    );
    if (result.changes === 0) return undefined;
    return this.getParseJob(jobId);
  }

  markJobSucceeded(
    jobId: string,
    nowIso: string,
    meta?: {
      modelVersion?: string | null;
      providerHost?: string | null;
      configRevision?: number | null;
    },
  ): void {
    this.db.run(
      `UPDATE parse_jobs
     SET status = 'succeeded',
         model_version = COALESCE(?, model_version),
         provider_host = COALESCE(?, provider_host),
         config_revision = COALESCE(?, config_revision),
         last_error_category = NULL,
         last_error_message = NULL,
         updated_at = ?
     WHERE id = ?`,
      [
        meta?.modelVersion ?? null,
        meta?.providerHost ?? null,
        meta?.configRevision ?? null,
        nowIso,
        jobId,
      ],
    );
  }

  /** Record non-secret execution metadata without changing job status. */
  recordJobExecutionMeta(
    jobId: string,
    nowIso: string,
    meta: {
      modelVersion?: string | null;
      providerHost?: string | null;
      configRevision?: number | null;
    },
  ): void {
    this.db.run(
      `UPDATE parse_jobs
     SET model_version = COALESCE(?, model_version),
         provider_host = COALESCE(?, provider_host),
         config_revision = COALESCE(?, config_revision),
         updated_at = ?
     WHERE id = ?`,
      [
        meta.modelVersion ?? null,
        meta.providerHost ?? null,
        meta.configRevision ?? null,
        nowIso,
        jobId,
      ],
    );
  }

  resetJobForUserRetry(jobId: string, nowIso: string): void {
    this.db.run(
      `UPDATE parse_jobs
     SET status = 'pending', next_eligible_at = ?, last_error_category = NULL,
         last_error_message = NULL, updated_at = ?
     WHERE id = ?`,
      [nowIso, nowIso, jobId],
    );
  }

  markJobFailed(
    jobId: string,
    nowIso: string,
    category: string,
    message: string,
    retryable: boolean,
  ): void {
    const job = this.getParseJob(jobId);
    if (!job) return;
    const exhausted = job.attempts >= job.maxAttempts;
    const status = !retryable || exhausted ? 'failed_terminal' : 'failed_retryable';
    const backoffMs = Math.min(60_000, 1000 * 2 ** Math.max(0, job.attempts - 1));
    const next = new Date(Date.parse(nowIso) + backoffMs).toISOString();
    this.db.run(
      `UPDATE parse_jobs
     SET status = ?, last_error_category = ?, last_error_message = ?,
         next_eligible_at = ?, updated_at = ?
     WHERE id = ?`,
      [status, category, message, next, nowIso, jobId],
    );
  }

  updateRawInputLifecycle(
    rawInputId: string,
    status: LifecycleStatus,
    nowIso: string,
    extras?: {
      parseErrorCategory?: string | null;
      parseErrorMessage?: string | null;
      candidatesJson?: string | null;
    },
  ): void {
    const current = this.getRawInput(rawInputId);
    if (!current) return;
    const parseErrorCategory =
      extras && 'parseErrorCategory' in extras
        ? (extras.parseErrorCategory ?? null)
        : current.parseErrorCategory;
    const parseErrorMessage =
      extras && 'parseErrorMessage' in extras
        ? (extras.parseErrorMessage ?? null)
        : current.parseErrorMessage;
    const candidatesJson =
      extras && 'candidatesJson' in extras
        ? (extras.candidatesJson ?? null)
        : current.candidatesJson;
    this.db.run(
      `UPDATE raw_inputs
     SET lifecycle_status = ?,
         parse_error_category = ?,
         parse_error_message = ?,
         candidates_json = ?,
         updated_at = ?
     WHERE id = ?`,
      [status, parseErrorCategory, parseErrorMessage, candidatesJson, nowIso, rawInputId],
    );
  }

  listUnresolvedRawInputs(): RawInput[] {
    return this.db
      .all<RawInputRow>(
        `SELECT * FROM raw_inputs
       WHERE lifecycle_status IN ('pending_parse', 'pending_confirm', 'parse_failed')
         AND deleted_at IS NULL
       ORDER BY submitted_at DESC, id DESC`,
      )
      .map(mapRawInput);
  }

  listWithdrawnRawInputs(): RawInput[] {
    return this.db
      .all<RawInputRow>(
        `SELECT raw_inputs.* FROM raw_inputs
       WHERE raw_inputs.lifecycle_status = 'posted'
         AND raw_inputs.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM consumption_records
           WHERE consumption_records.raw_input_id = raw_inputs.id
             AND consumption_records.deleted_at IS NULL
         )
       ORDER BY raw_inputs.submitted_at DESC, raw_inputs.id DESC`,
      )
      .map(mapRawInput);
  }

  listRecentRawInputs(limit = 100): RawInput[] {
    return this.db
      .all<RawInputRow>(
        `SELECT * FROM raw_inputs
       WHERE deleted_at IS NULL
       ORDER BY submitted_at DESC
       LIMIT ?`,
        [limit],
      )
      .map(mapRawInput);
  }
}
