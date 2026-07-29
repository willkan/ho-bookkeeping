import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviderConfigForSave } from './provider-config';
import { MemoryProviderConfigStore } from './provider-config-store';

describe('secure provider config persistence', () => {
  // Positive: memory store round-trip without leaking key in public view
  it('persists config and public view omits key', async () => {
    const store = new MemoryProviderConfigStore();
    const saved = await store.saveFromForm({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-fake-test-key-only',
      model: 'deepseek-chat',
      keepExistingKey: false,
    });
    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('sk-fake-test-key-only');
    const loaded = await store.load();
    expect(loaded?.apiKey).toBe('sk-fake-test-key-only');
    expect(loaded?.model).toBe('deepseek-chat');
  });

  // Positive: clear removes config
  it('clear removes configuration completely', async () => {
    const store = new MemoryProviderConfigStore();
    await store.save(
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-fake-abc',
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    );
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(await store.loadPublic()).toBeNull();
  });

  // Positive: SecureProviderConfigRepository uses expo-secure-store (mocked)
  it('SecureProviderConfigRepository writes JSON to secure store without logging key', async () => {
    const map = new Map<string, string>();
    vi.resetModules();
    vi.doMock('expo-secure-store', () => ({
      getItemAsync: async (k: string) => map.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => {
        map.set(k, v);
      },
      deleteItemAsync: async (k: string) => {
        map.delete(k);
      },
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    }));
    const { SecureProviderConfigRepository, PROVIDER_CONFIG_SECURE_STORE_KEY } = await import(
      './secure-provider-config'
    );
    const repo = new SecureProviderConfigRepository();
    await repo.saveFromForm({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secure-store-fake',
      model: 'deepseek-chat',
      keepExistingKey: false,
    });
    const raw = map.get(PROVIDER_CONFIG_SECURE_STORE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain('sk-secure-store-fake');
    const pub = await repo.loadPublic();
    expect(pub?.hasApiKey).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('sk-secure-store-fake');
    await repo.clear();
    expect(map.has(PROVIDER_CONFIG_SECURE_STORE_KEY)).toBe(false);
  });

  beforeEach(() => {
    vi.resetModules();
  });
});
