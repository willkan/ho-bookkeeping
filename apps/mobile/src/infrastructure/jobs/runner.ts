import type { LedgerService } from '../../application/ledger-service';

/**
 * Durable queue executor. Job truth remains in SQLite; this only triggers work.
 * Single-flight: concurrent resume() calls share one run (no duplicate runners).
 */
export class ParseJobRunner {
  private inFlight: Promise<number> | null = null;

  constructor(private readonly service: LedgerService) {}

  /** Startup / AppState active: resume eligible jobs without overlapping runners. */
  resume(nowIso = new Date().toISOString()): Promise<number> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.service
      .processEligibleJobs(nowIso)
      .then((count) => count)
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Test seam: whether a resume is currently executing. */
  isRunning(): boolean {
    return this.inFlight !== null;
  }
}
