import Database from 'better-sqlite3';
import type { SqliteDatabase, SqliteRunResult } from './sqlite-database';

/** Node-only adapter for real SQLite integration tests. */
export function openBetterSqliteDatabase(filename = ':memory:'): SqliteDatabase {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    run(sql: string, params: readonly unknown[] = []): SqliteRunResult {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    get<T>(sql: string, params: readonly unknown[] = []): T | undefined {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    all<T>(sql: string, params: readonly unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    withTransaction<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close(): void {
      db.close();
    },
  };
}
