import { PilotError } from './errors';

export class FixedWindowLimiter {
  private readonly entries = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): void {
    const cutoff = this.now() - 60_000;
    const recent = (this.entries.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit)
      throw new PilotError('rate_limited', 429, 'request rate exceeded');
    recent.push(this.now());
    this.entries.set(key, recent);
  }
}
