/**
 * Application boundary for client-generated stable IDs.
 * Domain stays pure; production adapter uses expo-crypto.randomUUID.
 * No default generator and no hidden fallback.
 */
export interface IdGenerator {
  createId(prefix: string): string;
}
