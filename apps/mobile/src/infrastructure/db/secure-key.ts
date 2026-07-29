import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { SQLCIPHER_SECURE_STORE_KEY } from './sqlcipher-config';

/**
 * Cryptographic key material for SQLCipher.
 * Uses expo-crypto getRandomBytes only.
 * Non-cryptographic PRNG fallbacks are forbidden; failures throw explicitly.
 * Native boundary: requires expo-crypto linked in a development/production build.
 */
export function generateKeyMaterial(): string {
  let bytes: Uint8Array;
  try {
    bytes = Crypto.getRandomBytes(32);
  } catch (error) {
    throw new Error(
      `SQLCipher key generation failed: cryptographic RNG unavailable (${
        error instanceof Error ? error.message : 'unknown'
      }). expo-crypto must be available; non-cryptographic PRNG fallbacks are forbidden.`,
    );
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error(
      'SQLCipher key generation failed: expo-crypto.getRandomBytes did not return 32 bytes',
    );
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Load or create the SQLCipher key in the system secure store.
 * Never log the key. No plaintext filesystem fallback.
 */
export async function getOrCreateSqlCipherKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SQLCIPHER_SECURE_STORE_KEY);
  if (existing && existing.length >= 16) {
    return existing;
  }
  const key = generateKeyMaterial();
  await SecureStore.setItemAsync(SQLCIPHER_SECURE_STORE_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}
