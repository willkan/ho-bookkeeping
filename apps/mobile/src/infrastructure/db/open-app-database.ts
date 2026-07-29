import type { SQLiteDatabase as ExpoSqliteDatabase } from 'expo-sqlite';
import type { SqliteDatabase } from './sqlite-database';
import { migrate, seedDefaults } from './migrations';
import { SQLCIPHER_DATABASE_NAME, buildPragmaKeyStatement } from './sqlcipher-config';
import { getOrCreateSqlCipherKey } from './secure-key';

/**
 * Opens the encrypted app database (production / device).
 * SQLCipher key is applied via PRAGMA before any schema read/write.
 * Sole production path: expo-sqlite sync APIs (execSync / runSync / withTransactionSync).
 * No optional/compat branches. Requires development build with useSQLCipher: true.
 */
export async function openAppDatabase(): Promise<SqliteDatabase> {
  const SQLite = await import('expo-sqlite');
  const key = await getOrCreateSqlCipherKey();
  const db: ExpoSqliteDatabase = await SQLite.openDatabaseAsync(SQLCIPHER_DATABASE_NAME);
  // Key before any schema read/write.
  await db.execAsync(buildPragmaKeyStatement(key));
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const adapter: SqliteDatabase = {
    exec(sql: string): void {
      db.execSync(sql);
    },
    run(sql: string, params: readonly unknown[] = []) {
      const result = db.runSync(sql, [...params] as never[]);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowId };
    },
    get<T>(sql: string, params: readonly unknown[] = []) {
      return (db.getFirstSync(sql, [...params] as never[]) as T | null) ?? undefined;
    },
    all<T>(sql: string, params: readonly unknown[] = []) {
      return db.getAllSync(sql, [...params] as never[]) as T[];
    },
    withTransaction<T>(fn: () => T): T {
      let value!: T;
      db.withTransactionSync(() => {
        value = fn();
      });
      return value;
    },
    close(): void {
      void db.closeAsync();
    },
  };

  migrate(adapter);
  seedDefaults(adapter);
  return adapter;
}
