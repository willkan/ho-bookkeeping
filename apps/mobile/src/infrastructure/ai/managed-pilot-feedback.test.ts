import { describe, expect, it, vi } from 'vitest';
import { ManagedPilotFeedbackClient } from './managed-pilot-feedback';

const credential = `feedback_${'a'.repeat(64)}`;
const identity = async () => credential;
const response = (willingness: string | null) =>
  new Response(
    JSON.stringify({
      request_id: 'feedback_1',
      willingness,
      updated_at: willingness ? '2026-08-20T10:00:00.000Z' : null,
    }),
    { status: 200 },
  );

describe('anonymous feedback client', () => {
  it('reads feedback without an AI activation', async () => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toContain('/anonymous-feedback');
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${credential}`);
      return response('unsure');
    });
    await expect(
      new ManagedPilotFeedbackClient(identity, () => 'feedback_1', transport).load(),
    ).resolves.toMatchObject({ willingness: 'unsure' });
  });
  it('submits only the selected answer', async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ willingness: 'willing' });
      return response('willing');
    });
    await new ManagedPilotFeedbackClient(identity, () => 'feedback_1', transport).save('willing');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('does not expose credentials in errors', async () => {
    const transport = vi.fn<typeof fetch>(async () => {
      throw new Error(credential);
    });
    await expect(
      new ManagedPilotFeedbackClient(identity, () => 'feedback_1', transport).load(),
    ).rejects.not.toThrow(credential);
  });
});
