import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type PilotDatabase = Database.Database;

export function openDatabase(path: string): PilotDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: PilotDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get();
  if (!applied) {
    db.transaction(() => {
      db.exec(`
      CREATE TABLE subjects (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE invites (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        subject_id TEXT UNIQUE REFERENCES subjects(id),
        activation_id_hash TEXT,
        created_at INTEGER NOT NULL,
        activated_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE entitlements (
        subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
        invite_id TEXT NOT NULL UNIQUE REFERENCES invites(id),
        starts_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        total_limit INTEGER NOT NULL CHECK(total_limit > 0),
        daily_limit INTEGER NOT NULL CHECK(daily_limit > 0),
        consumed_total INTEGER NOT NULL DEFAULT 0 CHECK(consumed_total >= 0),
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE access_tokens (
        token_hash TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX access_tokens_subject_idx ON access_tokens(subject_id, expires_at);
      CREATE TABLE usage_requests (
        subject_id TEXT NOT NULL REFERENCES subjects(id),
        request_id TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('reserved', 'succeeded', 'failed')),
        contract_version TEXT NOT NULL,
        model TEXT NOT NULL,
        provider_host TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        reserved_until INTEGER NOT NULL,
        completed_at INTEGER,
        latency_ms INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        error_category TEXT,
        PRIMARY KEY(subject_id, request_id)
      );
      CREATE INDEX usage_requests_status_idx ON usage_requests(status, reserved_until);
      CREATE INDEX usage_requests_created_idx ON usage_requests(created_at);
      CREATE INDEX usage_requests_daily_idx ON usage_requests(subject_id, usage_date, status);
      `);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)').run(
        Date.now(),
      );
    })();
  }

  const usageAccounting = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 2').get();
  if (!usageAccounting) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE invites ADD COLUMN recipient_label TEXT;
        ALTER TABLE usage_requests ADD COLUMN prompt_cache_hit_tokens INTEGER;
        ALTER TABLE usage_requests ADD COLUMN prompt_cache_miss_tokens INTEGER;
      `);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)').run(
        Date.now(),
      );
    })();
  }

  const pilotFeedback = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get();
  if (!pilotFeedback) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE pilot_feedback (
          subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
          willingness TEXT NOT NULL CHECK(willingness IN ('willing', 'unsure', 'not_willing')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)').run(
        Date.now(),
      );
    })();
  }

  const inviteEntitlement = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 4').get();
  if (!inviteEntitlement) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE invites ADD COLUMN entitlement_days INTEGER CHECK(entitlement_days > 0);
        ALTER TABLE invites ADD COLUMN entitlement_total_limit INTEGER CHECK(entitlement_total_limit > 0);
        ALTER TABLE invites ADD COLUMN entitlement_daily_limit INTEGER CHECK(entitlement_daily_limit > 0);
      `);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (4, ?)').run(
        Date.now(),
      );
    })();
  }
}
