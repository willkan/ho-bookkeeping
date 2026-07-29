import type { ProviderConfig } from './provider-config';

type ChatCreate = (...args: unknown[]) => Promise<unknown>;

type OpenAiLikeClient = {
  chat: {
    completions: {
      create: ChatCreate;
    };
  };
};

/**
 * Narrow factory for the official OpenAI JS SDK on a personal BYOK mobile client.
 *
 * Client-environment opt-in:
 * The SDK refuses non-Node environments unless `dangerouslyAllowBrowser` is set.
 * This is an **explicitly accepted** personal single-device BYOK app: the user pastes
 * their own key into the device. The flag is isolated here only — never set from UI
 * or application services. Keys are not bundled; they come from secure store via config.
 *
 * Prefer Chat Completions over Responses helpers so OpenAI-compatible providers
 * (e.g. DeepSeek) that implement `/chat/completions` work.
 *
 * The `openai` package is required at call time so Node unit tests that only import
 * transport types / fakes do not need the full SDK graph unless the factory runs.
 */
export function createOpenAiCompatibleClient(config: ProviderConfig): OpenAiLikeClient {
  // Lazy require keeps vitest collection free of optional native/browser shims.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OpenAI = require('openai').default as new (opts: {
    apiKey: string;
    baseURL: string;
    dangerouslyAllowBrowser: boolean;
    timeout: number;
    maxRetries: number;
  }) => OpenAiLikeClient;
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    // Durable SQLite jobs own retry truth; the SDK must not add invisible retries.
    timeout: 30_000,
    maxRetries: 0,
    // BYOK personal client only — see module doc above.
    dangerouslyAllowBrowser: true,
  });
}

export type OpenAiClientFactory = (config: ProviderConfig) => OpenAiLikeClient;
