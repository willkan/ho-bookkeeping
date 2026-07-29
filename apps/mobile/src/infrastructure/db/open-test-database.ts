import { openBetterSqliteDatabase } from './better-sqlite-adapter';
import { migrate, seedDefaults } from './migrations';
import type { SqliteDatabase } from './sqlite-database';

/** Node tests only — better-sqlite3. Never import from app routes. */
export function openTestDatabase(): SqliteDatabase {
  const db = openBetterSqliteDatabase(':memory:');
  migrate(db);
  seedDefaults(db);
  return db;
}
