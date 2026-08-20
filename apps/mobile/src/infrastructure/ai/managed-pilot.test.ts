import { CONTRACT_VERSION, type ParseRequest, type ParseResponse } from '@bookkeeping/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ManagedPilotActivationClient,
  ManagedPilotClientError,
  ManagedPilotParseTransport,
  SelectedAiParseTransport,
  type ManagedPilotCredential,
  type ManagedPilotStore,
} from './managed-pilot';
import type { AiParseTransportWithMeta, ParseExecutionMeta } from './transport';

const future = '2099-01-01T00:00:00.000Z';

class MemoryPilotStore implements ManagedPilotStore {
  credential: ManagedPilotCredential | null = null;
  saved: ManagedPilotCredential[] = [];

  async load() {
    return this.credential;
  }
  async save(value: ManagedPilotCredential) {
    this.credential = value;
    this.saved.push(value);
  }
  async clear() {
    this.credential = null;
  }
  async getOrCreateActivationId() {
    return 'install_12345678901234567890';
  }
}

class StubTransport implements AiParseTransportWithMeta {
  calls = 0;
  constructor(
    private readonly response: ParseResponse,
    private readonly meta: ParseExecutionMeta,
  ) {}
  getLastExecutionMeta() {
    return this.meta;
  }
  async parse() {
    this.calls += 1;
    return this.response;
  }
}

function credential(token = 't'.repeat(48)): ManagedPilotCredential {
  return {
    subjectId: 'subject_1',
    accessToken: token,
    accessTokenExpiresAt: future,
    entitlementExpiresAt: future,
    totalLimit: 200,
    dailyLimit: 20,
    consumedTotal: 0,
  };
}

function request(): ParseRequest {
  return {
    contract_version: CONTRACT_VERSION,
    request_id: 'request_1',
    raw_text: '午饭20元',
    submitted_at: '2026-08-20T04:00:00.000Z',
    timezone: 'Asia/Shanghai',
    local_date: '2026-08-20',
    mode_snapshot: {
      mode_id: null,
      mode_name: null,
      default_tags: [],
      include_in_mode_stats: false,
    },
    tag_candidates: [],
  };
}

const okResponse: ParseResponse = {
  contract_version: CONTRACT_VERSION,
  request_id: 'request_1',
  status: 'ok',
  records: [],
};

describe('managed AI pilot mobile transport', () => {
  it('activates one install and stores the short credential through the secure-store port', async () => {
    const store = new MemoryPilotStore();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.body).toContain('invite_1234567890123456');
      expect(init?.body).toContain('install_12345678901234567890');
      return new Response(
        JSON.stringify({
          request_id: 'edge_generated_1',
          subject_id: 'subject_1',
          access_token: 't'.repeat(48),
          access_token_expires_at: future,
          entitlement: {
            expires_at: future,
            total_limit: 200,
            daily_limit: 20,
            consumed_total: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await new ManagedPilotActivationClient(
      store,
      () => 'activate_1',
      fetchImpl,
    ).activate('invite_1234567890123456');

    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.accessToken).toBe('t'.repeat(48));
    expect(JSON.stringify(result)).not.toContain('t'.repeat(48));
  });

  it('uses and validates the pilot parse response when pilot is explicitly active', async () => {
    const store = new MemoryPilotStore();
    store.credential = credential();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect((init?.headers as Record<string, string>).authorization).toBe(
        `Bearer ${'t'.repeat(48)}`,
      );
      return new Response(JSON.stringify(okResponse), { status: 200 });
    });

    await expect(
      new ManagedPilotParseTransport(store, fetchImpl).parse(request()),
    ).resolves.toEqual(okResponse);
  });

  it('rejects malformed pilot responses through the shared parse response schema', async () => {
    const store = new MemoryPilotStore();
    store.credential = credential();
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ status: 'ok', records: [{ amount: 20.5 }] }), {
          status: 200,
        }),
    );

    const result = await new ManagedPilotParseTransport(store, fetchImpl).parse(request());
    expect(result).toMatchObject({ status: 'error', error_category: 'model_output_invalid' });
  });

  it('does not fall back to BYOK when an active pilot request fails', async () => {
    const store = new MemoryPilotStore();
    store.credential = credential();
    const pilot = new StubTransport(
      {
        contract_version: CONTRACT_VERSION,
        request_id: 'request_1',
        status: 'error',
        error_category: 'provider_error',
        message: 'pilot unavailable',
      },
      { providerHost: 'bookkeeping.holic.work', model: 'deepseek-v4-flash', configRevision: 1 },
    );
    const byok = new StubTransport(okResponse, {
      providerHost: 'api.example.com',
      model: 'fallback-must-not-run',
      configRevision: 2,
    });

    const result = await new SelectedAiParseTransport(store, pilot, byok).parse(request());
    expect(result.status).toBe('error');
    expect(pilot.calls).toBe(1);
    expect(byok.calls).toBe(0);
  });

  it('returns to BYOK only after the user explicitly clears the pilot credential', async () => {
    const store = new MemoryPilotStore();
    store.credential = credential();
    await store.clear();
    const pilot = new StubTransport(okResponse, {
      providerHost: 'bookkeeping.holic.work',
      model: 'deepseek-v4-flash',
      configRevision: 1,
    });
    const byok = new StubTransport(okResponse, {
      providerHost: 'api.deepseek.com',
      model: 'deepseek-v4-flash',
      configRevision: 2,
    });

    await new SelectedAiParseTransport(store, pilot, byok).parse(request());
    expect(pilot.calls).toBe(0);
    expect(byok.calls).toBe(1);
  });

  it('never exposes invite or token through activation and transport error messages', async () => {
    const invite = 'invite_secret_1234567890';
    const token = 'secret_token_value_'.repeat(3);
    const store = new MemoryPilotStore();
    const activation = new ManagedPilotActivationClient(
      store,
      () => 'activate_1',
      vi.fn<typeof fetch>(async () => {
        throw new Error(`network leaked ${invite}`);
      }),
    );
    try {
      await activation.activate(invite);
      throw new Error('expected activation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedPilotClientError);
      expect(String(error)).not.toContain(invite);
    }

    store.credential = credential(token);
    const result = await new ManagedPilotParseTransport(
      store,
      vi.fn<typeof fetch>(async () => {
        throw new Error(`network leaked ${token}`);
      }),
    ).parse(request());
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
