import {
  type ProviderConfig,
  type ProviderConfigPublic,
  buildProviderConfigForSave,
  toPublicConfig,
} from './provider-config';

/** Port for BYOK config persistence. Production uses expo-secure-store. */
export interface ProviderConfigStore {
  load(): Promise<ProviderConfig | null>;
  save(config: ProviderConfig): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store for unit tests — never used in production AppProvider. */
export class MemoryProviderConfigStore implements ProviderConfigStore {
  private value: ProviderConfig | null = null;

  async load(): Promise<ProviderConfig | null> {
    return this.value;
  }

  async save(config: ProviderConfig): Promise<void> {
    this.value = { ...config };
  }

  async clear(): Promise<void> {
    this.value = null;
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

  async loadPublic(): Promise<ProviderConfigPublic | null> {
    const config = await this.load();
    return config ? toPublicConfig(config) : null;
  }
}
