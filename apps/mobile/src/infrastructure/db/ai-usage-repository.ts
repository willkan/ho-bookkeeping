import type { AiUsageEvent } from '../../domain/ai-usage';
import type { IdGenerator } from '../../application/ports/id-generator';
import type { SqliteDatabase } from './sqlite-database';

export const AI_USAGE_RETENTION_DAYS = 90;
export const AI_USAGE_MAX_ROWS = 2000;

/** Bounded diagnostic usage facts. This is not a ledger/export/statistics source. */
export class AiUsageRepository {
  constructor(
    protected readonly db: SqliteDatabase,
    protected readonly ids: IdGenerator,
  ) {}

  recordAiUsage(event: AiUsageEvent): void {
    const cutoff = new Date(
      Date.parse(event.completedAt) - AI_USAGE_RETENTION_DAYS * 24 * 60 * 60_000,
    ).toISOString();
    this.db.withTransaction(() => {
      const job = this.db.get<{ id: string; attempts: number }>(
        `SELECT id, attempts FROM parse_jobs WHERE client_request_id = ?`,
        [event.requestId],
      );
      const parseJobId = event.parseJobId ?? job?.id ?? null;
      const attemptNumber = event.attemptNumber ?? (job && job.attempts >= 1 ? job.attempts : null);
      this.db.run(
        `INSERT INTO ai_usage_events (
          id, request_id, parse_job_id, attempt_number, transport, provider_host, model,
          config_revision, contract_version, started_at, completed_at, latency_ms, status,
          error_category, prompt_tokens, completion_tokens, total_tokens,
          prompt_cache_hit_tokens, prompt_cache_miss_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.ids.createId('ai_usage'),
          event.requestId,
          parseJobId,
          attemptNumber,
          event.transport,
          event.providerHost,
          event.model,
          event.configRevision,
          event.contractVersion,
          event.startedAt,
          event.completedAt,
          event.latencyMs,
          event.status,
          event.errorCategory,
          event.promptTokens,
          event.completionTokens,
          event.totalTokens,
          event.promptCacheHitTokens,
          event.promptCacheMissTokens,
        ],
      );
      if (job) {
        this.db.run(
          `UPDATE parse_jobs
           SET model_version = COALESCE(?, model_version),
               provider_host = COALESCE(?, provider_host),
               config_revision = COALESCE(?, config_revision)
           WHERE id = ?`,
          [event.model, event.providerHost, event.configRevision, job.id],
        );
      }
      this.db.run(`DELETE FROM ai_usage_events WHERE started_at < ?`, [cutoff]);
      this.db.run(
        `DELETE FROM ai_usage_events
         WHERE id IN (
           SELECT id FROM ai_usage_events
           ORDER BY started_at DESC, id DESC
           LIMIT -1 OFFSET ?
         )`,
        [AI_USAGE_MAX_ROWS],
      );
    });
  }

  listAiUsage(limit = 200): AiUsageEvent[] {
    return this.db
      .all<{
        request_id: string;
        parse_job_id: string | null;
        attempt_number: number | null;
        transport: AiUsageEvent['transport'];
        provider_host: string | null;
        model: string | null;
        config_revision: number | null;
        contract_version: string;
        started_at: string;
        completed_at: string;
        latency_ms: number;
        status: AiUsageEvent['status'];
        error_category: string | null;
        prompt_tokens: number | null;
        completion_tokens: number | null;
        total_tokens: number | null;
        prompt_cache_hit_tokens: number | null;
        prompt_cache_miss_tokens: number | null;
      }>(`SELECT * FROM ai_usage_events ORDER BY started_at DESC, id DESC LIMIT ?`, [limit])
      .map((row) => ({
        requestId: row.request_id,
        parseJobId: row.parse_job_id,
        attemptNumber: row.attempt_number,
        transport: row.transport,
        providerHost: row.provider_host,
        model: row.model,
        configRevision: row.config_revision,
        contractVersion: row.contract_version,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        latencyMs: row.latency_ms,
        status: row.status,
        errorCategory: row.error_category,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        promptCacheHitTokens: row.prompt_cache_hit_tokens,
        promptCacheMissTokens: row.prompt_cache_miss_tokens,
      }));
  }
}
