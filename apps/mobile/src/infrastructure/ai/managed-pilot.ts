import {
  ParseRequestSchema,
  ParseResponseSchema,
  type ParseRequest,
  type ParseResponse,
} from '@bookkeeping/contracts';
import { z } from 'zod';
import type { AiParseTransportWithMeta, ParseExecutionMeta } from './transport';

export const MANAGED_PILOT_BASE_URL = 'https://bookkeeping.holic.work' as const;
export const MANAGED_PILOT_MODEL = 'deepseek-v4-flash' as const;

export const ManagedPilotCredentialSchema = z
  .object({
    subjectId: z.string().min(1),
    accessToken: z.string().min(32).max(128),
    accessTokenExpiresAt: z.string().datetime(),
    entitlementExpiresAt: z.string().datetime(),
    totalLimit: z.number().int().positive(),
    dailyLimit: z.number().int().positive(),
    consumedTotal: z.number().int().nonnegative(),
  })
  .strict();

export type ManagedPilotCredential = z.infer<typeof ManagedPilotCredentialSchema>;
export type ManagedPilotPublic = Omit<ManagedPilotCredential, 'accessToken'> & {
  accessTokenCurrent: boolean;
};

const ActivationResponseSchema = z
  .object({
    request_id: z.string().min(1),
    subject_id: z.string().min(1),
    access_token: z.string().min(32).max(128),
    access_token_expires_at: z.string().datetime(),
    entitlement: z
      .object({
        expires_at: z.string().datetime(),
        total_limit: z.number().int().positive(),
        daily_limit: z.number().int().positive(),
        consumed_total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export interface ManagedPilotStore {
  load(): Promise<ManagedPilotCredential | null>;
  save(credential: ManagedPilotCredential): Promise<void>;
  clear(): Promise<void>;
  getOrCreateActivationId(): Promise<string>;
}

export function managedPilotPublic(
  credential: ManagedPilotCredential | null,
): ManagedPilotPublic | null {
  if (!credential) return null;
  const { accessToken: _secret, ...publicValue } = credential;
  return {
    ...publicValue,
    accessTokenCurrent: Date.parse(credential.accessTokenExpiresAt) > Date.now(),
  };
}

export class ManagedPilotClientError extends Error {
  readonly code = 'managed_pilot_error' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ManagedPilotClientError';
  }
}

type Fetch = typeof fetch;

export class ManagedPilotActivationClient {
  constructor(
    private readonly store: ManagedPilotStore,
    private readonly createRequestId: () => string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async activate(inviteCodeInput: string): Promise<ManagedPilotPublic> {
    const inviteCode = inviteCodeInput.trim();
    if (inviteCode.length < 16 || inviteCode.length > 128) {
      throw new ManagedPilotClientError('邀请码格式不正确');
    }
    const requestId = this.createRequestId();
    const activationId = await this.store.getOrCreateActivationId();
    let response: Response;
    try {
      response = await this.fetchImpl(`${MANAGED_PILOT_BASE_URL}/activate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
        },
        body: JSON.stringify({ invite_code: inviteCode, activation_id: activationId }),
      });
    } catch {
      throw new ManagedPilotClientError('无法连接内测服务，请稍后重试');
    }
    if (!response.ok) throw activationFailure(response.status);

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ManagedPilotClientError('内测服务返回了无效响应');
    }
    const parsed = ActivationResponseSchema.safeParse(raw);
    // The edge owns activation correlation IDs and may replace the client header.
    // Parse request IDs remain business idempotency keys and are checked separately below.
    if (!parsed.success) {
      throw new ManagedPilotClientError('内测服务返回了无效响应');
    }
    const credential = ManagedPilotCredentialSchema.parse({
      subjectId: parsed.data.subject_id,
      accessToken: parsed.data.access_token,
      accessTokenExpiresAt: parsed.data.access_token_expires_at,
      entitlementExpiresAt: parsed.data.entitlement.expires_at,
      totalLimit: parsed.data.entitlement.total_limit,
      dailyLimit: parsed.data.entitlement.daily_limit,
      consumedTotal: parsed.data.entitlement.consumed_total,
    });
    await this.store.save(credential);
    return managedPilotPublic(credential)!;
  }
}

function activationFailure(status: number): ManagedPilotClientError {
  if (status === 401 || status === 403 || status === 404) {
    return new ManagedPilotClientError('邀请码无效、已使用或已撤销');
  }
  if (status === 429) return new ManagedPilotClientError('尝试次数过多，请稍后重试');
  return new ManagedPilotClientError('激活失败，请稍后重试');
}

export class ManagedPilotParseTransport implements AiParseTransportWithMeta {
  private lastMeta: ParseExecutionMeta | null = null;

  constructor(
    private readonly store: ManagedPilotStore,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  getLastExecutionMeta(): ParseExecutionMeta | null {
    return this.lastMeta;
  }

  async parse(request: ParseRequest): Promise<ParseResponse> {
    const body = ParseRequestSchema.parse(request);
    const credential = await this.store.load();
    if (!credential) return parseError(body, 'invalid_request', '尚未激活托管 AI 内测');
    if (Date.parse(credential.accessTokenExpiresAt) <= Date.now()) {
      return parseError(body, 'invalid_request', '内测访问凭证已过期，请重新激活');
    }
    this.lastMeta = {
      providerHost: new URL(MANAGED_PILOT_BASE_URL).host,
      model: MANAGED_PILOT_MODEL,
      configRevision: 1,
    };
    let response: Response;
    try {
      response = await this.fetchImpl(`${MANAGED_PILOT_BASE_URL}/parse`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credential.accessToken}`,
          'x-request-id': body.request_id,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return parseError(body, 'provider_error', '托管 AI 服务暂时不可用');
    }
    if (!response.ok) return parseHttpError(body, response.status);

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return parseError(body, 'model_output_invalid', '托管 AI 返回了无效响应');
    }
    const parsed = ParseResponseSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.request_id !== body.request_id ||
      parsed.data.contract_version !== body.contract_version
    ) {
      return parseError(body, 'model_output_invalid', '托管 AI 返回了无效响应');
    }
    return parsed.data;
  }
}

/** Explicit selection: a saved pilot credential selects pilot; errors never fall back to BYOK. */
export class SelectedAiParseTransport implements AiParseTransportWithMeta {
  private selected: AiParseTransportWithMeta | null = null;

  constructor(
    private readonly pilotStore: ManagedPilotStore,
    private readonly pilot: AiParseTransportWithMeta,
    private readonly byok: AiParseTransportWithMeta,
  ) {}

  getLastExecutionMeta(): ParseExecutionMeta | null {
    return this.selected?.getLastExecutionMeta() ?? null;
  }

  async parse(request: ParseRequest): Promise<ParseResponse> {
    this.selected = (await this.pilotStore.load()) ? this.pilot : this.byok;
    return this.selected.parse(request);
  }
}

function parseHttpError(request: ParseRequest, status: number): ParseResponse {
  if (status === 401 || status === 403) {
    return parseError(request, 'invalid_request', '内测访问凭证无效或已撤销');
  }
  if (status === 409) {
    return parseError(request, 'invalid_request', '该解析请求已处理，请勿重复提交');
  }
  if (status === 429) return parseError(request, 'rate_limited', '内测额度已用完或请求过快');
  if (status === 408 || status === 504) return parseError(request, 'timeout', '托管 AI 请求超时');
  return parseError(request, 'provider_error', '托管 AI 服务暂时不可用');
}

function parseError(
  request: ParseRequest,
  category:
    | 'invalid_request'
    | 'provider_error'
    | 'model_output_invalid'
    | 'rate_limited'
    | 'timeout',
  message: string,
): ParseResponse {
  return {
    contract_version: request.contract_version,
    request_id: request.request_id,
    status: 'error',
    error_category: category,
    message,
  };
}
