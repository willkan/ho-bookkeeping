import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database';

describe('managed pilot database migrations', () => {
  const directories: string[] = [];
  afterEach(() =>
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true })),
  );

  it('upgrades an existing version-1 database without losing invite or usage rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bookkeeping-pilot-migration-'));
    directories.push(directory);
    const path = join(directory, 'pilot.sqlite');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 1);
      CREATE TABLE invites (
        id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, subject_id TEXT,
        activation_id_hash TEXT, created_at INTEGER NOT NULL, activated_at INTEGER, revoked_at INTEGER
      );
      CREATE TABLE usage_requests (
        subject_id TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
        status TEXT NOT NULL, contract_version TEXT NOT NULL, model TEXT NOT NULL,
        provider_host TEXT NOT NULL, usage_date TEXT NOT NULL, created_at INTEGER NOT NULL,
        reserved_until INTEGER NOT NULL, completed_at INTEGER, latency_ms INTEGER,
        prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, error_category TEXT,
        PRIMARY KEY(subject_id, request_id)
      );
      INSERT INTO invites(id, code_hash, created_at) VALUES ('inv_existing', 'hash', 1);
    `);
    legacy.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id FROM invites').get()).toEqual({ id: 'inv_existing' });
    expect(
      migrated
        .prepare("SELECT 1 ok FROM pragma_table_info('invites') WHERE name='recipient_label'")
        .get(),
    ).toEqual({ ok: 1 });
    expect(
      migrated
        .prepare(
          "SELECT COUNT(*) count FROM pragma_table_info('usage_requests') WHERE name IN ('prompt_cache_hit_tokens','prompt_cache_miss_tokens')",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(
      migrated
        .prepare(
          "SELECT COUNT(*) count FROM pragma_table_info('invites') WHERE name IN ('entitlement_days','entitlement_total_limit','entitlement_daily_limit')",
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(
      migrated
        .prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='pilot_feedback'")
        .get(),
    ).toEqual({ ok: 1 });
    migrated.close();
  });
});
