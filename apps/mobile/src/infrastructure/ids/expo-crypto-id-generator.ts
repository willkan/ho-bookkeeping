import * as Crypto from 'expo-crypto';
import type { IdGenerator } from '../../application/ports/id-generator';

/**
 * Production ID adapter: expo-crypto.randomUUID only.
 * Throws if crypto is unavailable — non-cryptographic PRNG fallbacks are forbidden.
 */
export class ExpoCryptoIdGenerator implements IdGenerator {
  createId(prefix: string): string {
    let uuid: string;
    try {
      uuid = Crypto.randomUUID();
    } catch (error) {
      throw new Error(
        `ID generation failed: expo-crypto.randomUUID unavailable (${
          error instanceof Error ? error.message : 'unknown'
        }). Non-cryptographic fallbacks are forbidden.`,
      );
    }
    if (!uuid || typeof uuid !== 'string') {
      throw new Error('ID generation failed: expo-crypto.randomUUID returned empty value');
    }
    return `${prefix}_${uuid}`;
  }
}
