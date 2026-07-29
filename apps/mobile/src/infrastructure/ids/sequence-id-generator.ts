import type { IdGenerator } from '../../application/ports/id-generator';

/** Explicit deterministic ID generator for tests only. */
export class SequenceIdGenerator implements IdGenerator {
  private seq = 0;

  createId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_test_${this.seq}`;
  }
}
