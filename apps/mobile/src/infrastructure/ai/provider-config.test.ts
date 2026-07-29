import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_BASE_URL,
  DEFAULT_PROVIDER_MODEL,
  InvalidProviderConfigError,
  buildProviderConfigForSave,
  maskApiKey,
  normalizeBaseUrl,
  providerHostFromBaseUrl,
  providerFormValues,
  toPublicConfig,
} from './provider-config';

describe('provider config validation', () => {
  it('provides the current DeepSeek endpoint and model defaults for an unconfigured device', () => {
    expect(providerFormValues(null)).toEqual({
      baseUrl: DEFAULT_PROVIDER_BASE_URL,
      model: DEFAULT_PROVIDER_MODEL,
    });
    expect(DEFAULT_PROVIDER_BASE_URL).toBe('https://api.deepseek.com');
    expect(DEFAULT_PROVIDER_MODEL).toBe('deepseek-v4-flash');
  });

  it('keeps an explicitly saved provider configuration instead of replacing it with defaults', () => {
    expect(
      providerFormValues({
        baseUrl: 'https://provider.example/v1',
        model: 'custom-model',
      }),
    ).toEqual({
      baseUrl: 'https://provider.example/v1',
      model: 'custom-model',
    });
  });

  // Positive: DeepSeek-style HTTPS base URL normalizes without path rewrite
  it('normalizes DeepSeek-style base URL and strips trailing slash', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1');
    expect(providerHostFromBaseUrl('https://api.deepseek.com/v1')).toBe('api.deepseek.com');
  });

  // Positive: loopback HTTP allowed for local dev
  it('allows HTTP only for loopback hosts', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8787/v1')).toBe('http://127.0.0.1:8787/v1');
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  // Negative: remote HTTP rejected
  it('rejects HTTP for non-loopback hosts', () => {
    expect(() => normalizeBaseUrl('http://api.deepseek.com/v1')).toThrow(
      InvalidProviderConfigError,
    );
    expect(() => normalizeBaseUrl('http://example.com')).toThrow(/HTTPS/);
  });

  // Negative: invalid URL rejected
  it('rejects invalid absolute URLs', () => {
    expect(() => normalizeBaseUrl('not-a-url')).toThrow(InvalidProviderConfigError);
    expect(() => normalizeBaseUrl('')).toThrow(/required/);
  });

  // Negative: embedded credentials rejected
  it('rejects URLs with embedded credentials', () => {
    expect(() => normalizeBaseUrl('https://user:pass@api.example.com/v1')).toThrow(/credentials/);
  });

  // Positive: does not silently rewrite path
  it('does not inject or strip /v1 path segments', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com');
    expect(normalizeBaseUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1');
  });

  // Positive: mask never returns full key
  it('masks API keys for display', () => {
    const masked = maskApiKey('sk-fake-deepseek-key-1234567890');
    expect(masked).not.toContain('1234567890');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.includes('…')).toBe(true);
  });

  // Positive: public view has no apiKey field
  it('toPublicConfig never exposes apiKey', () => {
    const pub = toPublicConfig({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-fake-secret-value-zzzz',
      model: 'deepseek-chat',
      configRevision: 2,
      updatedAt: '2026-07-17T00:00:00.000Z',
    });
    expect(pub.hasApiKey).toBe(true);
    expect(JSON.stringify(pub)).not.toMatch(/sk-fake-secret/);
    expect(pub).not.toHaveProperty('apiKey');
  });

  // Positive: save builds revision and reuses key when keepExistingKey
  it('buildProviderConfigForSave increments revision and can keep existing key', () => {
    const first = buildProviderConfigForSave({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-first-key-aaaaaaaa',
      model: 'deepseek-chat',
      existing: null,
      keepExistingKey: false,
      nowIso: '2026-07-17T00:00:00.000Z',
    });
    expect(first.configRevision).toBe(1);
    const second = buildProviderConfigForSave({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: null,
      model: 'deepseek-chat',
      existing: first,
      keepExistingKey: true,
      nowIso: '2026-07-17T01:00:00.000Z',
    });
    expect(second.apiKey).toBe('sk-first-key-aaaaaaaa');
    expect(second.configRevision).toBe(2);
  });

  // Negative: missing model or key fails
  it('buildProviderConfigForSave requires model and key', () => {
    expect(() =>
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: null,
        model: 'deepseek-chat',
        existing: null,
        keepExistingKey: false,
      }),
    ).toThrow(/API Key/);
    expect(() =>
      buildProviderConfigForSave({
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-x',
        model: '  ',
        existing: null,
        keepExistingKey: false,
      }),
    ).toThrow(/Model/);
  });
});
