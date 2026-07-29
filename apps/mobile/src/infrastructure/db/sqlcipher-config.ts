/**
 * Formal SQLCipher contract for phase-1.
 * Native encryption requires development build (not Expo Go).
 * Key is generated securely and stored in expo-secure-store; applied via PRAGMA before schema.
 */

export const SQLCIPHER_PLUGIN_CONFIG = {
  useSQLCipher: true as const,
  enableFTS: true as const,
};

export const SQLCIPHER_SECURE_STORE_KEY = 'bookkeeping.sqlite.sqlcipher_key_v1';

export const SQLCIPHER_DATABASE_NAME = 'bookkeeping.sqlcipher.db';

/** PRAGMA key must run immediately after open, before any schema read/write. */
export function buildPragmaKeyStatement(key: string): string {
  if (!key || key.length < 16) {
    throw new Error('SQLCipher key must be at least 16 characters');
  }
  // Escape single quotes for SQL string literal.
  const escaped = key.replace(/'/g, "''");
  return `PRAGMA key = '${escaped}'`;
}

export function assertSqlCipherPluginConfig(plugins: unknown): void {
  if (!Array.isArray(plugins)) {
    throw new Error('app config plugins must include expo-sqlite with useSQLCipher');
  }
  const sqlite = plugins.find((p) => {
    if (p === 'expo-sqlite') return true;
    return Array.isArray(p) && p[0] === 'expo-sqlite';
  });
  if (!sqlite) {
    throw new Error('expo-sqlite plugin missing');
  }
  if (typeof sqlite === 'string') {
    throw new Error('expo-sqlite plugin must set useSQLCipher: true');
  }
  const opts = (sqlite as [string, { useSQLCipher?: boolean }])[1];
  if (!opts || opts.useSQLCipher !== true) {
    throw new Error('expo-sqlite useSQLCipher must be true; plaintext SQLite is not allowed');
  }
}
