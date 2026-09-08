export type AiTransportKind = 'byok' | 'managed_pilot' | 'unconfigured' | 'fake';

export type AiUsageEvent = {
  requestId: string;
  parseJobId: string | null;
  attemptNumber: number | null;
  transport: AiTransportKind;
  providerHost: string | null;
  model: string | null;
  configRevision: number | null;
  contractVersion: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  status: 'succeeded' | 'failed';
  errorCategory: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
};

export type AiUsageSink = (event: AiUsageEvent) => void;
