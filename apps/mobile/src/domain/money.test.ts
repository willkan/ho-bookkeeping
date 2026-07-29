import { describe, expect, it } from 'vitest';
import { assertMoneyMinor, formatYuan, sumMoney, yuanToMinor } from './money';

describe('money domain', () => {
  // Positive: integer minor units accepted
  it('accepts integer minor units', () => {
    expect(assertMoneyMinor(100)).toBe(100);
    expect(assertMoneyMinor(0)).toBe(0);
    expect(assertMoneyMinor(-50)).toBe(-50);
  });

  // Negative: floating point money rejected
  it('rejects floating point money', () => {
    expect(() => assertMoneyMinor(10.5)).toThrow(/integer minor unit/);
  });

  // Positive: sum without float
  it('sums minor units without floating point', () => {
    expect(sumMoney([19500, 10000])).toBe(29500);
  });

  // Positive: format yuan from fen
  it('formats yuan from minor units', () => {
    expect(formatYuan(29500)).toBe('295.00');
    expect(formatYuan(5)).toBe('0.05');
  });

  // Positive: yuan conversion rounds to minor
  it('converts yuan to minor units', () => {
    expect(yuanToMinor(1.95)).toBe(195);
  });
});
