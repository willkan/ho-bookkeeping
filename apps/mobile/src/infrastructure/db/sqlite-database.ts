/**
 * Portable SQLite surface used by repositories.
 * Mobile: expo-sqlite adapter. Node tests: better-sqlite3 adapter.
 *
 * Transaction callback is synchronous. Production uses withTransactionSync;
 * async work inside a callback would silently commit early and is forbidden.
 */
export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  run(sql: string, params?: readonly unknown[]): SqliteRunResult;
  get<T>(sql: string, params?: readonly unknown[]): T | undefined;
  all<T>(sql: string, params?: readonly unknown[]): T[];
  /**
   * Run fn inside one SQLite transaction. fn must be synchronous.
   * Returns T immediately (no second async transaction path).
   */
  withTransaction<T>(fn: () => T): T;
  close(): void;
}
