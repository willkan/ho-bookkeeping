import { describe, expect, it, vi } from 'vitest';
import { ParseJobRunner } from './runner';

describe('ParseJobRunner reentrancy', () => {
  // Positive: concurrent resume shares one in-flight run
  it('does not start a second concurrent processEligibleJobs', async () => {
    let resolveJobs!: (n: number) => void;
    const processEligibleJobs = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveJobs = resolve;
        }),
    );
    const service = {
      processEligibleJobs,
    } as unknown as import('../../application/ledger-service').LedgerService;
    const runner = new ParseJobRunner(service);

    const first = runner.resume('2026-07-16T12:00:00.000Z');
    const second = runner.resume('2026-07-16T12:00:01.000Z');
    expect(runner.isRunning()).toBe(true);
    expect(processEligibleJobs).toHaveBeenCalledTimes(1);

    resolveJobs(2);
    await expect(first).resolves.toBe(2);
    await expect(second).resolves.toBe(2);
    expect(runner.isRunning()).toBe(false);

    // After completion, a new resume may run again.
    processEligibleJobs.mockResolvedValue(0);
    await runner.resume();
    expect(processEligibleJobs).toHaveBeenCalledTimes(2);
  });
});
