import type { CandidateRecord } from '@bookkeeping/contracts';
import { describe, expect, it } from 'vitest';
import { validateAmountsForEdit, validateCandidateList } from './record-validation';

function expense(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    direction: 'expense',
    merchant: null,
    note: null,
    occurred_at: '2026-07-16T10:18:00.000Z',
    timezone: 'Asia/Shanghai',
    local_date: '2026-07-16',
    currency: 'CNY',
    list_price_minor: 10000,
    actual_cost_minor: 10000,
    discount_minor: 0,
    tags: [],
    ...overrides,
  };
}

describe('record amount validation', () => {
  it('accepts paid 300 with coupon deduction 20 as list price 320', () => {
    expect(
      validateCandidateList([
        expense({
          list_price_minor: 32000,
          actual_cost_minor: 30000,
          discount_minor: 2000,
        }),
      ]),
    ).toEqual({ ok: true });
  });

  it('blocks the whole proposal when one record violates paid plus discount', () => {
    const result = validateCandidateList([
      expense(),
      expense({ list_price_minor: 20000, actual_cost_minor: 19000, discount_minor: 500 }),
      expense(),
    ]);
    expect(result.ok).toBe(false);
  });

  it('applies the same amount relation to manual edits', () => {
    expect(validateAmountsForEdit(30000, 28000, 2000)).toEqual({ ok: true });
    expect(validateAmountsForEdit(30000, 29000, 2000).ok).toBe(false);
  });
});
