import { describe, expect, it } from 'vitest';
import {
  SQLCIPHER_PLUGIN_CONFIG,
  assertSqlCipherPluginConfig,
  buildPragmaKeyStatement,
} from './sqlcipher-config';

describe('SQLCipher encryption contract', () => {
  // Positive: plugin config requires useSQLCipher true
  it('accepts plugin config with useSQLCipher true', () => {
    expect(() =>
      assertSqlCipherPluginConfig([
        ['expo-sqlite', { useSQLCipher: true, enableFTS: true }],
        'expo-router',
        'expo-secure-store',
      ]),
    ).not.toThrow();
  });

  // Negative: plaintext / missing flag rejected
  it('rejects expo-sqlite without useSQLCipher', () => {
    expect(() => assertSqlCipherPluginConfig(['expo-sqlite'])).toThrow(/useSQLCipher/);
    expect(() => assertSqlCipherPluginConfig([['expo-sqlite', { useSQLCipher: false }]])).toThrow(
      /useSQLCipher must be true/,
    );
  });

  // Positive: PRAGMA key statement escapes quotes
  it('builds PRAGMA key before schema with escaped quotes', () => {
    const stmt = buildPragmaKeyStatement("abc'def-0123456789");
    expect(stmt).toBe("PRAGMA key = 'abc''def-0123456789'");
  });

  // Negative: short keys rejected
  it('rejects short keys', () => {
    expect(() => buildPragmaKeyStatement('short')).toThrow(/16/);
  });

  // Positive: formal constant matches technical selection
  it('exports useSQLCipher true as formal constant', () => {
    expect(SQLCIPHER_PLUGIN_CONFIG.useSQLCipher).toBe(true);
  });
});
