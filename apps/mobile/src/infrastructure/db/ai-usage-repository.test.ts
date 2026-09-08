import { describe, expect, it } from 'vitest';
import type { AiUsageEvent } from '../../domain/ai-usage';
import { SequenceIdGenerator } from '../ids/sequence-id-generator';
import { AI_USAGE_MAX_ROWS, AI_USAGE_RETENTION_DAYS } from './ai-usage-repository';
import { openTestDatabase } from './open-test-database';
import { LedgerRepository } from './repositories';

function event(
  requestId: string,
  startedAt: string,
  overrides: Partial<AiUsageEvent> = {},
): AiUsageEvent {
  return {
    requestId,
    parseJobId: null,
    attemptNumber: null,
    transport: 'byok',
    providerHost: 'api.example.com',
    model: 'model-1',
    configRevision: 1,
    contractVersion: '2.2.0',
    startedAt,
    completedAt: startedAt,
    latencyMs: 120,
    status: 'succeeded',
    errorCategory: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    promptCacheHitTokens: null,
    promptCacheMissTokens: null,
    ...overrides,
  };
}

describe('AI usage diagnostic retention contract', () => {
  it('persists only safe request metadata and nullable provider token usage', () => {
    const db = openTestDatabase();
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    repo.recordAiUsage(event('req_1', '2026-08-30T00:00:00.000Z'));
    expect(repo.listAiUsage()).toEqual([
      expect.objectContaining({ requestId: 'req_1', promptTokens: null, totalTokens: null }),
    ]);
    db.close();
  });

  it('removes events older than 90 days in the insert transaction', () => {
    const db = openTestDatabase();
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    repo.recordAiUsage(event('old', '2026-01-01T00:00:00.000Z'));
    repo.recordAiUsage(event('current', '2026-08-30T00:00:00.000Z'));
    expect(repo.listAiUsage().map(({ requestId }) => requestId)).toEqual(['current']);
    expect(AI_USAGE_RETENTION_DAYS).toBe(90);
    db.close();
  });

  it('retains only the latest 2000 events after every insert', () => {
    const db = openTestDatabase();
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    for (let index = 0; index <= AI_USAGE_MAX_ROWS; index += 1) {
      repo.recordAiUsage(
        event(`req_${index}`, new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString()),
      );
    }
    expect(db.get<{ count: number }>('SELECT COUNT(*) count FROM ai_usage_events')?.count).toBe(
      AI_USAGE_MAX_ROWS,
    );
    expect(db.get('SELECT 1 FROM ai_usage_events WHERE request_id = ?', ['req_0'])).toBeUndefined();
    db.close();
  });

  it('never removes parse jobs or raw inputs during rotation', () => {
    const db = openTestDatabase();
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    repo.submitRawInput({
      id: 'raw_1',
      rawText: '私密原文',
      submittedAt: '2026-01-01T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-01-01',
      confirmMode: 'auto_post',
      modeIdSnapshot: null,
      modeNameSnapshot: null,
      defaultTagsSnapshot: [],
      includeInModeStats: false,
      jobId: 'job_1',
      clientRequestId: 'old',
    });
    repo.recordAiUsage(event('old', '2026-01-01T00:00:00.000Z'));
    repo.recordAiUsage(event('current', '2026-08-30T00:00:00.000Z'));
    expect(repo.getRawInput('raw_1')?.rawText).toBe('私密原文');
    expect(repo.getParseJob('job_1')).toBeDefined();
    db.close();
  });

  it('rejects negative latency and token values at the SQLite boundary', () => {
    const db = openTestDatabase();
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    expect(() =>
      repo.recordAiUsage(
        event('bad', '2026-08-30T00:00:00.000Z', {
          latencyMs: -1,
          totalTokens: -1,
        }),
      ),
    ).toThrow();
    db.close();
  });

  it('defines no columns for raw text, prompt, merchant, amount, tags, key, or model output', () => {
    const db = openTestDatabase();
    const columns = db
      .all<{ name: string }>('PRAGMA table_info(ai_usage_events)')
      .map(({ name }) => name);
    expect(columns.join(' ')).not.toMatch(/raw|prompt_text|merchant|amount|tag|key|output/);
    db.close();
  });
});
