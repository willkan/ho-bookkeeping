import {
  CONTRACT_VERSION,
  ParseRequestSchema,
  ParseResponseSchema,
  ParseSuccessResponseSchema,
  type ParseRequest,
  type ParseResponse,
} from '@bookkeeping/contracts';
import { buildParseUserContent, PARSE_SYSTEM_PROMPT } from '@bookkeeping/ai-parse-prompt';
import type { AiUsageEvent, AiUsageSink } from '../../domain/ai-usage';
import { createOpenAiCompatibleClient, type OpenAiClientFactory } from './openai-client';
import {
  assertCompleteProviderConfig,
  MissingProviderConfigError,
  providerHostFromBaseUrl,
  type ProviderConfig,
} from './provider-config';
import type { ProviderConfigStore } from './provider-config-store';

/** Reasonable completion budget for multi-record parse proposals (one production path). */
const PARSE_MAX_TOKENS = 4096;

/** Cap Zod issue diagnostics so logs stay small and free of business content. */
const MAX_SCHEMA_ISSUES_LOGGED = 12;

/**
 * AI transport port. Infrastructure adapters implement this.
 * Application layer never constructs the OpenAI client directly.
 */
export interface AiParseTransport {
  parse(request: ParseRequest): Promise<ParseResponse>;
}

/**
 * Production BYOK path: secure config → OpenAI-compatible Chat Completions JSON mode
 * → local JSON parse → transport schema validation. Never synthesizes records.
 */
export class OpenAiCompatibleParseTransport implements AiParseTransport {
  constructor(
    private readonly configStore: ProviderConfigStore,
    private readonly clientFactory: OpenAiClientFactory = createOpenAiCompatibleClient,
    private readonly usageSink?: AiUsageSink,
  ) {}

  async parse(request: ParseRequest): Promise<ParseResponse> {
    const body = ParseRequestSchema.parse(request);
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    let providerHost: string | null = null;
    let model: string | null = null;
    let configRevision: number | null = null;
    let usage = emptyTokenUsage();
    const finish = (response: ParseResponse): ParseResponse => {
      emitUsage(this.usageSink, {
        requestId: body.request_id,
        parseJobId: null,
        attemptNumber: null,
        transport: 'byok',
        providerHost,
        model,
        configRevision,
        contractVersion: body.contract_version,
        startedAt,
        completedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedMs),
        status: response.status === 'ok' ? 'succeeded' : 'failed',
        errorCategory: response.status === 'error' ? response.error_category : null,
        ...usage,
      });
      return response;
    };
    let config: ProviderConfig | null;
    try {
      config = await this.configStore.load();
      assertCompleteProviderConfig(config);
    } catch (error) {
      if (error instanceof MissingProviderConfigError) {
        return finish({
          contract_version: body.contract_version,
          request_id: body.request_id,
          status: 'error',
          error_category: 'invalid_request',
          message: error.message,
        });
      }
      return finish({
        contract_version: body.contract_version,
        request_id: body.request_id,
        status: 'error',
        error_category: 'provider_error',
        message: 'AI 配置读取失败',
      });
    }

    providerHost = providerHostFromBaseUrl(config.baseUrl);
    model = config.model;
    configRevision = config.configRevision;

    // Metadata only — never apiKey, raw text, amounts, merchants.
    console.info('[ai-transport] request', {
      request_id: body.request_id,
      contract_version: body.contract_version,
      provider_host: providerHost,
      model,
      config_revision: configRevision,
      tag_candidate_count: body.tag_candidates.length,
    });

    const client = this.clientFactory(config);
    try {
      const completion = (await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: PARSE_SYSTEM_PROMPT },
          { role: 'user', content: buildParseUserContent(body) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: PARSE_MAX_TOKENS,
      })) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: unknown;
      };
      usage = normalizeTokenUsage(completion.usage);

      const content = completion.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        console.info('[ai-transport] response', {
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          reason: 'empty_content',
          latency_ms: Date.now() - startedMs,
          model: config.model,
          provider_host: providerHost,
          usage,
        });
        return finish({
          contract_version: body.contract_version,
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          message: 'provider returned empty content',
        });
      }

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        console.info('[ai-transport] response', {
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          reason: 'invalid_json',
          latency_ms: Date.now() - startedMs,
          model: config.model,
          provider_host: providerHost,
        });
        return finish({
          contract_version: body.contract_version,
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          message: 'provider returned invalid JSON',
        });
      }

      // Accept either full ParseSuccess shape or bare { records: [...] } from JSON mode.
      const asSuccessCandidate = {
        contract_version: CONTRACT_VERSION,
        request_id: body.request_id,
        status: 'ok' as const,
        records: extractRecordsArray(json),
      };

      const success = ParseSuccessResponseSchema.safeParse(asSuccessCandidate);
      if (!success.success) {
        const schemaIssues = summarizeZodIssues(success.error);
        const pathSummary = formatSchemaIssuePathSummary(schemaIssues);
        console.info('[ai-transport] response', {
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          reason: 'schema_failed',
          latency_ms: Date.now() - startedMs,
          model: config.model,
          provider_host: providerHost,
          // Paths/codes only — never raw model output, amounts, merchants, or keys.
          schema_issues: schemaIssues,
          schema_issue_count: success.error.issues.length,
        });
        return finish({
          contract_version: body.contract_version,
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          message: pathSummary
            ? `provider JSON failed transport schema (${pathSummary})`
            : 'provider JSON failed transport schema',
        });
      }

      const contextIssuePaths = success.data.records.flatMap((record, index) =>
        record.timezone === body.timezone ? [] : [`records.${index}.timezone`],
      );
      if (contextIssuePaths.length > 0) {
        console.info('[ai-transport] response', {
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          reason: 'request_context_failed',
          latency_ms: Date.now() - startedMs,
          model: config.model,
          provider_host: providerHost,
          context_issue_paths: contextIssuePaths.slice(0, MAX_SCHEMA_ISSUES_LOGGED),
          context_issue_count: contextIssuePaths.length,
        });
        return finish({
          contract_version: body.contract_version,
          request_id: body.request_id,
          status: 'error',
          error_category: 'model_output_invalid',
          message: `provider JSON conflicts with request context (${contextIssuePaths
            .slice(0, 6)
            .join(', ')})`,
        });
      }

      console.info('[ai-transport] response', {
        request_id: body.request_id,
        status: 'ok',
        record_count: success.data.records.length,
        latency_ms: Date.now() - startedMs,
        model: config.model,
        provider_host: providerHost,
        config_revision: configRevision,
        usage,
      });
      return finish(success.data);
    } catch (error) {
      const classified = classifyProviderError(error);
      console.info('[ai-transport] response', {
        request_id: body.request_id,
        status: 'error',
        error_category: classified.error_category,
        latency_ms: Date.now() - startedMs,
        model: config.model,
        provider_host: providerHost,
        error_name: error instanceof Error ? error.name : 'Error',
        // Never log error message if it might embed request headers/keys — use category only.
      });
      return finish({
        contract_version: body.contract_version,
        request_id: body.request_id,
        status: 'error',
        error_category: classified.error_category,
        message: classified.message,
      });
    }
  }
}

function emptyTokenUsage(): Pick<
  AiUsageEvent,
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'promptCacheHitTokens'
  | 'promptCacheMissTokens'
> {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    promptCacheHitTokens: null,
    promptCacheMissTokens: null,
  };
}

function normalizeTokenUsage(value: unknown): ReturnType<typeof emptyTokenUsage> {
  if (!value || typeof value !== 'object') return emptyTokenUsage();
  const usage = value as Record<string, unknown>;
  return {
    promptTokens: tokenCount(usage.prompt_tokens),
    completionTokens: tokenCount(usage.completion_tokens),
    totalTokens: tokenCount(usage.total_tokens),
    promptCacheHitTokens: tokenCount(usage.prompt_cache_hit_tokens),
    promptCacheMissTokens: tokenCount(usage.prompt_cache_miss_tokens),
  };
}

function tokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function emitUsage(sink: AiUsageSink | undefined, event: AiUsageEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch (error) {
    console.info('[ai-usage] persist_failed', {
      request_id: event.requestId,
      status: event.status,
      error_category: event.errorCategory,
      error_name: error instanceof Error ? error.name : 'Error',
    });
  }
}

function extractRecordsArray(json: unknown): unknown {
  if (json && typeof json === 'object' && 'records' in json) {
    return (json as { records: unknown }).records;
  }
  return undefined;
}

/** Safe Zod issue metadata for logs/diagnostics — path + code only, no values/messages. */
function summarizeZodIssues(error: {
  issues: readonly { path: PropertyKey[]; code: string }[];
}): { path: string; code: string }[] {
  return error.issues.slice(0, MAX_SCHEMA_ISSUES_LOGGED).map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    code: issue.code,
  }));
}

/** Compact path list for user-facing error text (no values). */
function formatSchemaIssuePathSummary(issues: { path: string; code: string }[]): string {
  if (issues.length === 0) return '';
  const uniquePaths = [...new Set(issues.map((i) => i.path))];
  return uniquePaths.slice(0, 6).join(', ').slice(0, 200);
}

function classifyProviderError(error: unknown): {
  error_category: 'provider_error' | 'rate_limited' | 'timeout' | 'model_output_invalid';
  message: string;
} {
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  const name = error instanceof Error ? error.name : '';
  const rawMessage = error instanceof Error ? error.message : 'provider failure';
  // Strip anything that looks like a bearer token from provider error text.
  const message = sanitizeErrorMessage(rawMessage).slice(0, 500);

  if (status === 429 || /rate.?limit/i.test(message)) {
    return { error_category: 'rate_limited', message: 'provider rate limited' };
  }
  if (status === 408 || name === 'APIConnectionTimeoutError' || /timeout/i.test(message)) {
    return { error_category: 'timeout', message: 'provider timeout' };
  }
  if (status === 400 && /json|response_format|response format/i.test(message)) {
    return {
      error_category: 'model_output_invalid',
      message: 'provider rejected JSON mode or returned unusable output',
    };
  }
  return { error_category: 'provider_error', message: message || 'provider failure' };
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'api_key=[redacted]');
}

/**
 * Deterministic fake for unit/integration tests only.
 * Must not be wired into production AppProvider.
 */
export class FakeAiParseTransport implements AiParseTransport {
  constructor(
    private readonly handler: (request: ParseRequest) => ParseResponse | Promise<ParseResponse>,
  ) {}

  async parse(request: ParseRequest): Promise<ParseResponse> {
    ParseRequestSchema.parse(request);
    const response = await this.handler(request);
    return ParseResponseSchema.parse(response);
  }
}

/**
 * Explicit configuration failure transport.
 * Does not call any model and never synthesizes records.
 * Used only when secure config is missing so the ledger can still open.
 */
export class UnconfiguredAiParseTransport implements AiParseTransport {
  async parse(request: ParseRequest): Promise<ParseResponse> {
    const body = ParseRequestSchema.parse(request);
    return {
      contract_version: body.contract_version,
      request_id: body.request_id,
      status: 'error',
      error_category: 'invalid_request',
      message: new MissingProviderConfigError().message,
    };
  }
}
