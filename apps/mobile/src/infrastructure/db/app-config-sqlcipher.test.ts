import { describe, expect, it } from 'vitest';
import appJson from '../../../app.json';
import { assertSqlCipherPluginConfig } from './sqlcipher-config';

describe('app.json SQLCipher plugin contract', () => {
  // Positive: production app config enables SQLCipher
  it('declares expo-sqlite useSQLCipher true', () => {
    expect(() => assertSqlCipherPluginConfig(appJson.expo.plugins)).not.toThrow();
  });

  // Negative: would fail without the flag (documented by assert helper)
  it('rejects plaintext plugin shape', () => {
    expect(() => assertSqlCipherPluginConfig(['expo-sqlite'])).toThrow(/useSQLCipher/);
  });
});
