import { describe, expect, it } from 'vitest';
import {
  calendarMonth,
  parseBudgetAmount,
  projectMonthlyBudget,
  type MonthlyBudget,
} from './monthly-budget';

describe('monthly budget domain contract — PRD 6.6', () => {
  it.each([
    ['0.01', 1],
    [' 20.1 ', 2010],
    ['20000', 2000000],
    ['999999999.99', 99999999999],
  ])('parses %s exactly as integer fen', (text, minor) =>
    expect(parseBudgetAmount(text)).toBe(minor),
  );
  it.each([
    '',
    ' ',
    '0',
    '0.00',
    '-10',
    '1.001',
    '1e3',
    'NaN',
    'Infinity',
    '1,000',
    '.5',
    '12.',
    '1000000000',
    '9007199254740993',
  ])('rejects invalid budget %s', (text) => expect(() => parseBudgetAmount(text)).toThrow());
  it('projects disabled, unspent, exhausted and overspent budgets without clamping money', () => {
    const month = { start: '2026-09-01', end: '2026-09-30' };
    const budget: MonthlyBudget = {
      id: 'b1',
      amountMinor: 1500000,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    };
    const project = (spentMinor: number, active: MonthlyBudget | null = budget) =>
      projectMonthlyBudget({ budget: active, spentMinor, recordCount: 1 }, month);
    expect(project(100, null)).toMatchObject({ remainingMinor: null, usedPercentTenths: null });
    expect(project(0)).toMatchObject({ remainingMinor: 1500000, usedPercentTenths: 0 });
    expect(project(1500000)).toMatchObject({ remainingMinor: 0, usedPercentTenths: 1000 });
    expect(project(1748781)).toMatchObject({ remainingMinor: -248781, usedPercentTenths: 1166 });
    expect(project(1748781, { ...budget, amountMinor: 2000000 })).toMatchObject({
      remainingMinor: 251219,
      usedPercentTenths: 874,
    });
    expect(project(1, { ...budget, amountMinor: 16 }).usedPercentTenths).toBe(63);
    expect(() => project(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it('uses the device local calendar month including leap February and year rollover', () => {
    expect(calendarMonth(new Date(2024, 1, 29, 23, 59))).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(calendarMonth(new Date(2026, 1, 28))).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(calendarMonth(new Date(2026, 11, 31, 23, 59))).toEqual({
      start: '2026-12-01',
      end: '2026-12-31',
    });
    expect(calendarMonth(new Date(2027, 0, 1))).toEqual({ start: '2027-01-01', end: '2027-01-31' });
  });
});
