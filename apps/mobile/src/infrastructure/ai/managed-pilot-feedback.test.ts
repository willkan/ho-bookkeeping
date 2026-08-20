import { describe, expect, it, vi } from 'vitest';
import {
  ManagedPilotClientError,
  type ManagedPilotCredential,
  type ManagedPilotStore,
} from './managed-pilot';
import { ManagedPilotFeedbackClient } from './managed-pilot-feedback';

const future = '2099-01-01T00:00:00.000Z';

class MemoryPilotStore implements ManagedPilotStore {
  credential: ManagedPilotCredential | null = {
    subjectId: 'subject_1',
    accessToken: 't'.repeat(48),
    accessTokenExpiresAt: future,
    entitlementExpiresAt: future,
    totalLimit: 200,
    dailyLimit: 20,
    consumedTotal: 0,
  };
  async load() {
    return this.credential;
  }
  async save(value: ManagedPilotCredential) {
    this.credential = value;
  }
  async clear() {
    this.credential = null;
  }
  async getOrCreateActivationId() {
    return 'install_12345678901234567890';
  }
}

function response(willingness: 'willing' | 'unsure' | 'not_willing' | null) {
  return new Response(
    JSON.stringify({
      request_id: 'feedback_1',
      willingness,
      updated_at: willingness ? '2026-08-20T10:00:00.000Z' : null,
    }),
    { status: 200 },
  );
}

describe('managed pilot feedback client', () => {
  it('loads the latest anonymous willingness choice with the pilot credential', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).authorization).toBe(
        `Bearer ${'t'.repeat(48)}`,
      );
      return response('unsure');
    });
    await expect(
      new ManagedPilotFeedbackClient(new MemoryPilotStore(), () => 'feedback_1', fetchImpl).load(),
    ).resolves.toEqual({
      willingness: 'unsure',
      updatedAt: '2026-08-20T10:00:00.000Z',
    });
  });

  it('submits exactly one allowed choice without ledger or payment fields', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(String(init?.body))).toEqual({ willingness: 'willing' });
      expect(String(init?.body)).not.toContain('raw_text');
      expect(String(init?.body)).not.toContain('price');
      return response('willing');
    });
    await new ManagedPilotFeedbackClient(
      new MemoryPilotStore(),
      () => 'feedback_1',
      fetchImpl,
    ).save('willing');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects use when the pilot credential is absent or expired', async () => {
    const store = new MemoryPilotStore();
    store.credential = null;
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      new ManagedPilotFeedbackClient(store, () => 'feedback_1', fetchImpl).load(),
    ).rejects.toBeInstanceOf(ManagedPilotClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps authentication and network failures without exposing response bodies or tokens', async () => {
    const token = 'secret-token-value-'.repeat(3);
    const store = new MemoryPilotStore();
    store.credential = { ...store.credential!, accessToken: token };
    const authClient = new ManagedPilotFeedbackClient(
      store,
      () => 'feedback_1',
      vi.fn<typeof fetch>(async () => new Response(`leaked ${token}`, { status: 401 })),
    );
    await expect(authClient.load()).rejects.not.toThrow(token);
    const networkClient = new ManagedPilotFeedbackClient(
      store,
      () => 'feedback_2',
      vi.fn<typeof fetch>(async () => {
        throw new Error(`leaked ${token}`);
      }),
    );
    await expect(networkClient.save('unsure')).rejects.not.toThrow(token);
  });
});
