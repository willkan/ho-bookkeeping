import { z } from 'zod';
import {
  PILOT_WILLINGNESS,
  type PilotFeedback,
  type PilotFeedbackPort,
  type PilotWillingness,
} from '../../application/ports/pilot-feedback';
import {
  MANAGED_PILOT_BASE_URL,
  ManagedPilotClientError,
  type ManagedPilotCredential,
  type ManagedPilotStore,
} from './managed-pilot';

const FeedbackResponseSchema = z
  .object({
    request_id: z.string().min(1),
    willingness: z.enum(PILOT_WILLINGNESS).nullable(),
    updated_at: z.string().datetime().nullable(),
  })
  .strict();

type Fetch = typeof fetch;

export class ManagedPilotFeedbackClient implements PilotFeedbackPort {
  constructor(
    private readonly store: ManagedPilotStore,
    private readonly createRequestId: () => string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async load(): Promise<PilotFeedback> {
    return this.request('GET');
  }

  async save(willingness: PilotWillingness): Promise<PilotFeedback> {
    return this.request('PUT', willingness);
  }

  private async request(
    method: 'GET' | 'PUT',
    willingness?: PilotWillingness,
  ): Promise<PilotFeedback> {
    const credential = await this.currentCredential();
    let response: Response;
    try {
      response = await this.fetchImpl(`${MANAGED_PILOT_BASE_URL}/feedback`, {
        method,
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          'x-request-id': this.createRequestId(),
          ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'PUT' ? { body: JSON.stringify({ willingness }) } : {}),
      });
    } catch {
      throw new ManagedPilotClientError('无法连接内测服务，请稍后重试');
    }
    if (!response.ok) throw feedbackFailure(response.status);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ManagedPilotClientError('内测服务返回了无效响应');
    }
    const parsed = FeedbackResponseSchema.safeParse(raw);
    if (!parsed.success) throw new ManagedPilotClientError('内测服务返回了无效响应');
    return { willingness: parsed.data.willingness, updatedAt: parsed.data.updated_at };
  }

  private async currentCredential(): Promise<ManagedPilotCredential> {
    const credential = await this.store.load();
    if (!credential || Date.parse(credential.accessTokenExpiresAt) <= Date.now()) {
      throw new ManagedPilotClientError('请先激活或重新激活托管 AI 内测');
    }
    return credential;
  }
}

function feedbackFailure(status: number): ManagedPilotClientError {
  if (status === 401 || status === 403) {
    return new ManagedPilotClientError('内测访问凭证无效或已撤销，请重新激活');
  }
  if (status === 429) return new ManagedPilotClientError('提交过于频繁，请稍后重试');
  return new ManagedPilotClientError('反馈提交失败，请稍后重试');
}
