import type { MonthlyBudgetStore } from '../../application/ports/monthly-budget-store';
import {
  assertBudgetAmount,
  type CalendarMonth,
  type MonthlyBudget,
  type MonthlyBudgetSnapshot,
} from '../../domain/monthly-budget';
import type { SqliteDatabase } from './sqlite-database';

export class SqliteMonthlyBudgetRepository implements MonthlyBudgetStore {
  constructor(private readonly db: SqliteDatabase) {}

  readMonth(month: CalendarMonth): MonthlyBudgetSnapshot {
    return this.db.withTransaction(() => {
      const budget = this.db.get<MonthlyBudget>(
        `SELECT id, amount_minor AS amountMinor, created_at AS createdAt, updated_at AS updatedAt
         FROM monthly_budgets WHERE deleted_at IS NULL`,
      );
      const totals = this.db.get<{ spentMinor: number; recordCount: number }>(
        `SELECT COALESCE(SUM(actual_cost_minor), 0) AS spentMinor, COUNT(*) AS recordCount
         FROM consumption_records
         WHERE deleted_at IS NULL AND direction = 'expense' AND currency = 'CNY'
           AND local_date >= ? AND local_date <= ?`,
        [month.start, month.end],
      );
      if (!totals) throw new Error('monthly expense aggregate missing');
      return { budget: budget ?? null, ...totals };
    });
  }

  save(input: { newId: string; amountMinor: number; now: string }): void {
    assertBudgetAmount(input.amountMinor);
    this.db.withTransaction(() => {
      const updated = this.db.run(
        `UPDATE monthly_budgets SET amount_minor = ?, updated_at = ? WHERE deleted_at IS NULL`,
        [input.amountMinor, input.now],
      );
      if (updated.changes === 0) {
        this.db.run(
          `INSERT INTO monthly_budgets (id, amount_minor, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, NULL)`,
          [input.newId, input.amountMinor, input.now, input.now],
        );
      }
    });
  }

  disable(now: string): void {
    const result = this.db.run(
      `UPDATE monthly_budgets SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL`,
      [now, now],
    );
    if (result.changes === 0) throw new Error('预算已关闭');
  }
}
