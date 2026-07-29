import { SequenceIdGenerator } from '../ids/sequence-id-generator';
import { describe, expect, it } from 'vitest';
import { openBetterSqliteDatabase } from './better-sqlite-adapter';
import { migrate, seedDefaults } from './migrations';
import { LedgerRepository } from './repositories';
import type { SqliteDatabase } from './sqlite-database';

describe('synchronous transaction contract', () => {
  // Positive: withTransaction callback is typed/run as sync and returns T
  it('commits only after synchronous callback completes', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    seedDefaults(db);
    let midCount = -1;
    db.withTransaction(() => {
      db.run(
        `INSERT INTO app_settings (key, value) VALUES ('tx_probe', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
      midCount = db.get<{ c: number }>('SELECT COUNT(*) as c FROM app_settings WHERE key = ?', [
        'tx_probe',
      ])!.c;
    });
    expect(midCount).toBe(1);
    expect(
      db.get<{ c: number }>('SELECT COUNT(*) as c FROM app_settings WHERE key = ?', ['tx_probe'])
        ?.c,
    ).toBe(1);
    db.close();
  });

  // Negative: async callback is not part of the formal interface
  it('withTransaction signature does not accept Promise-returning work as formal contract', () => {
    const db: SqliteDatabase = openBetterSqliteDatabase(':memory:');
    // Type-level: fn: () => T only. Runtime guard: reject thenables if misused.
    const result = db.withTransaction(() => 42);
    expect(result).toBe(42);
    expect(result).not.toBeInstanceOf(Promise);
    db.close();
  });

  // Positive: repository atomic submit is synchronous inside the transaction
  it('submitRawInput completes transaction synchronously before return', () => {
    const db = openBetterSqliteDatabase(':memory:');
    migrate(db);
    seedDefaults(db);
    const repo = new LedgerRepository(db, new SequenceIdGenerator());
    const out = repo.submitRawInput({
      id: 'ri_tx',
      rawText: '午饭100',
      submittedAt: '2026-07-16T12:00:00.000Z',
      timezone: 'Asia/Shanghai',
      localDate: '2026-07-16',
      confirmMode: 'auto_post',
      modeIdSnapshot: null,
      modeNameSnapshot: null,
      defaultTagsSnapshot: [],
      includeInModeStats: false,
      jobId: 'job_tx',
      clientRequestId: 'req_tx',
    });
    expect(out.rawInput.id).toBe('ri_tx');
    expect(repo.getParseJob('job_tx')?.status).toBe('pending');
    // Immediate re-read proves commit already visible (sync transaction).
    expect(repo.getRawInput('ri_tx')?.rawText).toBe('午饭100');
    db.close();
  });
});
