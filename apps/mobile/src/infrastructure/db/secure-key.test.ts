import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('SQLCipher secure key crypto contract', () => {
  // Negative: source must never invoke non-crypto PRNG
  it('secure-key.ts never references Math.random identifier', () => {
    const src = readFileSync(join(__dirname, 'secure-key.ts'), 'utf8');
    expect(src.includes('Math.random')).toBe(false);
    expect(src).toMatch(/expo-crypto/);
    expect(src).toMatch(/getRandomBytes/);
    expect(src).toMatch(
      /cryptographic RNG unavailable|non-cryptographic PRNG fallbacks are forbidden/,
    );
  });

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('expo-crypto');
    vi.doUnmock('expo-secure-store');
  });

  // Positive: generateKeyMaterial returns 32-byte hex from mocked expo-crypto
  it('generateKeyMaterial returns 32-byte hex from expo-crypto', async () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) bytes[i] = i + 1;
    vi.doMock('expo-crypto', () => ({
      getRandomBytes: () => bytes,
    }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: async () => null,
      setItemAsync: async () => undefined,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    }));
    const { generateKeyMaterial } = await import('./secure-key');
    const key = generateKeyMaterial();
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key.startsWith('01')).toBe(true);
  });

  // Negative: RNG failure is explicit
  it('generateKeyMaterial throws when getRandomBytes fails', async () => {
    vi.doMock('expo-crypto', () => ({
      getRandomBytes: () => {
        throw new Error('native module missing');
      },
    }));
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: async () => null,
      setItemAsync: async () => undefined,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    }));
    const { generateKeyMaterial } = await import('./secure-key');
    expect(() => generateKeyMaterial()).toThrow(/cryptographic RNG unavailable/);
  });
});
