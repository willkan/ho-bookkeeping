/**
 * BYOK provider configuration contract (PRD §2.0, TECHNICAL-SELECTION §6).
 * One active OpenAI-compatible Chat Completions profile.
 */

export type ProviderConfig = {
  /** Normalized absolute base URL (no trailing slash). */
  baseUrl: string;
  /** User API key — never log, export, or put in SQLite. */
  apiKey: string;
  /** Explicit model id string (e.g. deepseek-v4-flash). */
  model: string;
  /** Monotonic revision; increments on each successful save. */
  configRevision: number;
  /** ISO timestamp of last successful save. */
  updatedAt: string;
};

export const DEFAULT_PROVIDER_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_PROVIDER_MODEL = 'deepseek-v4-flash';

/** Values shown by the editable form; saved configuration always wins over recommendations. */
export function providerFormValues(
  config: Pick<ProviderConfigPublic, 'baseUrl' | 'model'> | null,
): Pick<ProviderConfigPublic, 'baseUrl' | 'model'> {
  return config
    ? { baseUrl: config.baseUrl, model: config.model }
    : { baseUrl: DEFAULT_PROVIDER_BASE_URL, model: DEFAULT_PROVIDER_MODEL };
}

/** Non-secret view for UI / diagnostics. Never includes apiKey. */
export type ProviderConfigPublic = {
  baseUrl: string;
  model: string;
  configRevision: number;
  updatedAt: string;
  /** Whether a non-empty key is stored. */
  hasApiKey: boolean;
  /** Masked key preview for edit form (e.g. sk-...xxxx). */
  apiKeyMasked: string | null;
  /** Host/origin for diagnostics (no credentials). */
  providerHost: string;
};

export type ProviderConfigInput = {
  baseUrl: string;
  /** New key to set; null/undefined means keep existing when updating. */
  apiKey: string | null;
  model: string;
};

export class InvalidProviderConfigError extends Error {
  readonly code = 'invalid_provider_config' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidProviderConfigError';
  }
}

export class MissingProviderConfigError extends Error {
  readonly code = 'missing_provider_config' as const;

  constructor() {
    super('尚未配置 AI 提供商。请打开设置 → AI 提供商，填写 Endpoint、API Key 与 Model。');
    this.name = 'MissingProviderConfigError';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Normalize base URL once at save time (PRD §2.0.3):
 * 1. trim
 * 2. strip trailing slashes
 * 3. require absolute URL
 * 4. HTTPS for non-loopback; HTTP only for loopback
 * 5. do not rewrite path (no silent /v1 inject/strip)
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidProviderConfigError('Endpoint is required');
  }

  let withoutTrailing = trimmed;
  while (withoutTrailing.endsWith('/')) {
    withoutTrailing = withoutTrailing.slice(0, -1);
  }

  let url: URL;
  try {
    url = new URL(withoutTrailing);
  } catch {
    throw new InvalidProviderConfigError('Endpoint must be a valid absolute URL');
  }

  if (url.username || url.password) {
    throw new InvalidProviderConfigError('Endpoint must not embed credentials');
  }

  const protocol = url.protocol.toLowerCase();
  const host = url.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(host);

  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new InvalidProviderConfigError('Endpoint must use http or https');
  }
  if (protocol === 'http:' && !isLoopback) {
    throw new InvalidProviderConfigError(
      'Endpoint must use HTTPS for remote hosts; HTTP is only allowed for local loopback',
    );
  }

  // Reconstruct without trailing slash; preserve path as user entered (minus trailing /).
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const search = url.search;
  return `${url.protocol}//${url.host}${path}${search}`;
}

export function providerHostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'unknown';
  }
}

export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return '';
  if (key.length <= 8) {
    return '••••';
  }
  const head = key.slice(0, 3);
  const tail = key.slice(-4);
  return `${head}…${tail}`;
}

export function toPublicConfig(config: ProviderConfig): ProviderConfigPublic {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    configRevision: config.configRevision,
    updatedAt: config.updatedAt,
    hasApiKey: config.apiKey.trim().length > 0,
    apiKeyMasked: config.apiKey.trim() ? maskApiKey(config.apiKey) : null,
    providerHost: providerHostFromBaseUrl(config.baseUrl),
  };
}

/**
 * Validate and build a full config for save.
 * @param existingKey when input.apiKey is null/empty and keepExistingKey, reuse existing.
 */
export function buildProviderConfigForSave(input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  existing: ProviderConfig | null;
  keepExistingKey: boolean;
  nowIso?: string;
}): ProviderConfig {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = input.model.trim();
  if (!model) {
    throw new InvalidProviderConfigError('Model is required');
  }
  if (model.length > 200) {
    throw new InvalidProviderConfigError('Model is too long');
  }

  let apiKey = (input.apiKey ?? '').trim();
  if (!apiKey && input.keepExistingKey && input.existing?.apiKey) {
    apiKey = input.existing.apiKey;
  }
  if (!apiKey) {
    throw new InvalidProviderConfigError('API Key is required');
  }
  if (apiKey.length > 512) {
    throw new InvalidProviderConfigError('API Key is too long');
  }

  const prevRevision = input.existing?.configRevision ?? 0;
  return {
    baseUrl,
    apiKey,
    model,
    configRevision: prevRevision + 1,
    updatedAt: input.nowIso ?? new Date().toISOString(),
  };
}

export function assertCompleteProviderConfig(
  config: ProviderConfig | null | undefined,
): asserts config is ProviderConfig {
  if (!config?.baseUrl?.trim() || !config.apiKey?.trim() || !config.model?.trim()) {
    throw new MissingProviderConfigError();
  }
}
