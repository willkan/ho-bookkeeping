import { buildParseUserContent, PARSE_SYSTEM_PROMPT } from '@bookkeeping/ai-parse-prompt';
import {
  CONTRACT_VERSION,
  ParseSuccessResponseSchema,
  type ParseRequest,
  type ParseSuccessResponse,
} from '@bookkeeping/contracts';
import OpenAI from 'openai';
import type { PilotConfig } from './config';
import { PilotError } from './errors';
import type { UsageMeta } from './store';

export type UpstreamResult = {
  response: ParseSuccessResponse;
  usage: UsageMeta;
};

export interface ParseUpstream {
  parse(request: ParseRequest, subjectId: string): Promise<UpstreamResult>;
}

export class OpenAiParseUpstream implements ParseUpstream {
  private readonly client: OpenAI;

  constructor(private readonly config: PilotConfig) {
    this.client = new OpenAI({
      apiKey: config.upstreamApiKey,
      baseURL: config.upstreamBaseUrl,
      timeout: config.upstreamTimeoutMs,
      maxRetries: 0,
    });
  }

  async parse(request: ParseRequest, subjectId: string): Promise<UpstreamResult> {
    const started = Date.now();
    try {
      const parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
        user_id: string;
      } = {
        model: this.config.upstreamModel,
        messages: [
          { role: 'system', content: PARSE_SYSTEM_PROMPT },
          { role: 'user', content: buildParseUserContent(request) },
        ],
        response_format: { type: 'json_object' },
        max_tokens: this.config.maxCompletionTokens,
        user_id: subjectId,
      };
      const completion = await this.client.chat.completions.create(parameters);
      const content = completion.choices[0]?.message.content;
      if (!content)
        throw new PilotError('model_output_invalid', 502, 'upstream returned no proposal');
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        throw new PilotError('model_output_invalid', 502, 'upstream returned invalid JSON');
      }
      const records =
        json && typeof json === 'object' && 'records' in json ? json.records : undefined;
      const parsed = ParseSuccessResponseSchema.safeParse({
        contract_version: CONTRACT_VERSION,
        request_id: request.request_id,
        status: 'ok',
        records,
      });
      if (!parsed.success) {
        throw new PilotError('model_output_invalid', 502, 'upstream proposal failed schema');
      }
      if (parsed.data.records.some((record) => record.timezone !== request.timezone)) {
        throw new PilotError(
          'model_output_invalid',
          502,
          'upstream proposal conflicts with request context',
        );
      }
      const usage = completion.usage as
        | (NonNullable<typeof completion.usage> & {
            prompt_cache_hit_tokens?: unknown;
            prompt_cache_miss_tokens?: unknown;
          })
        | undefined;
      return {
        response: parsed.data,
        usage: {
          latencyMs: Date.now() - started,
          promptTokens: tokenCount(usage?.prompt_tokens),
          completionTokens: tokenCount(usage?.completion_tokens),
          totalTokens: tokenCount(usage?.total_tokens),
          promptCacheHitTokens: tokenCount(usage?.prompt_cache_hit_tokens),
          promptCacheMissTokens: tokenCount(usage?.prompt_cache_miss_tokens),
        },
      };
    } catch (error) {
      if (error instanceof PilotError) throw error;
      const status =
        error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      const name = error instanceof Error ? error.name : '';
      if (status === 408 || name === 'AbortError' || name === 'APIConnectionTimeoutError') {
        throw new PilotError('timeout', 504, 'upstream timeout');
      }
      if (status === 429) throw new PilotError('provider_error', 503, 'upstream unavailable');
      throw new PilotError('provider_error', 502, 'upstream request failed');
    }
  }
}

function tokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
