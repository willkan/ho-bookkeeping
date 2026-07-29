import * as SecureStore from 'expo-secure-store';
import {
  type ProviderConfig,
  type ProviderConfigPublic,
  assertCompleteProviderConfig,
  buildProviderConfigForSave,
  toPublicConfig,
} from './provider-config';
import type { ProviderConfigStore } from './provider-config-store';

/**
 * Secure storage key for the single active BYOK provider configuration.
 * Entire record (baseUrl, apiKey, model, revision) is atomic JSON for simple semantics.
 * Never mirrored into SQLite.
 */
export const PROVIDER_CONFIG_SECURE_STORE_KEY = 'bookkeeping.ai.provider_config_v1';

const SECURE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

/**
 * Production secure-store repository for BYOK config.
 * API key never leaves this layer into SQLite, logs, or export.
 */
export class SecureProviderConfigRepository implements ProviderConfigStore {
  async load(): Promise<ProviderConfig | null> {
    const raw = await SecureStore.getItemAsync(PROVIDER_CONFIG_SECURE_STORE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ProviderConfig>;
      if (
        typeof parsed.baseUrl !== 'string' ||
        typeof parsed.apiKey !== 'string' ||
        typeof parsed.model !== 'string' ||
        typeof parsed.configRevision !== 'number' ||
        typeof parsed.updatedAt !== 'string'
      ) {
        return null;
      }
      return {
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        model: parsed.model,
        configRevision: parsed.configRevision,
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }

  async save(config: ProviderConfig): Promise<void> {
    assertCompleteProviderConfig(config);
    // Do not log config.apiKey.
    await SecureStore.setItemAsync(
      PROVIDER_CONFIG_SECURE_STORE_KEY,
      JSON.stringify({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        configRevision: config.configRevision,
        updatedAt: config.updatedAt,
      }),
      SECURE_OPTIONS,
    );
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(PROVIDER_CONFIG_SECURE_STORE_KEY);
  }

  async loadPublic(): Promise<ProviderConfigPublic | null> {
    const config = await this.load();
    return config ? toPublicConfig(config) : null;
  }

  async saveFromForm(input: {
    baseUrl: string;
    apiKey: string | null;
    model: string;
    keepExistingKey: boolean;
  }): Promise<ProviderConfigPublic> {
    const existing = await this.load();
    const next = buildProviderConfigForSave({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      existing,
      keepExistingKey: input.keepExistingKey,
    });
    await this.save(next);
    return toPublicConfig(next);
  }
}

export const defaultProviderConfigStore = new SecureProviderConfigRepository();

export type { ProviderConfigStore } from './provider-config-store';
export { MemoryProviderConfigStore } from './provider-config-store';
