import type { CalendarMonth, MonthlyBudgetSnapshot } from '../../domain/monthly-budget';

/** Local budget configuration + one consistent monthly expense projection. */
export interface MonthlyBudgetStore {
  readMonth(month: CalendarMonth): MonthlyBudgetSnapshot;
  save(input: { newId: string; amountMinor: number; now: string }): void;
  /** Soft delete. Throws if there is no active budget. */
  disable(now: string): void;
}
