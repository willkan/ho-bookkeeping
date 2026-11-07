/** PRD §6.6. Limits and projections use integer fen; only the visual ratio uses decimals. */
export const MAX_MONTHLY_BUDGET_MINOR = 99_999_999_999;

export type MonthlyBudget = {
  id: string;
  amountMinor: number;
  createdAt: string;
  updatedAt: string;
};

export type CalendarMonth = { start: string; end: string };

export type MonthlyBudgetSnapshot = {
  budget: MonthlyBudget | null;
  spentMinor: number;
  recordCount: number;
};

export type MonthlyBudgetOverview = MonthlyBudgetSnapshot & {
  month: CalendarMonth;
  remainingMinor: number | null;
  /** Rounded tenths of one percent. Not capped at 100%. */
  usedPercentTenths: number | null;
};

export function parseBudgetAmount(text: string): number {
  const value = text.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('请输入大于 0 的金额，最多两位小数，上限为 999,999,999.99 元');
  }
  const [yuan, fen = ''] = value.split('.');
  const minor = Number(yuan) * 100 + Number(fen.padEnd(2, '0'));
  assertBudgetAmount(minor);
  return minor;
}

export function assertBudgetAmount(minor: number): void {
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > MAX_MONTHLY_BUDGET_MINOR) {
    throw new Error('预算须大于 0，且不超过 999,999,999.99 元');
  }
}

export function calendarMonth(now: Date): CalendarMonth {
  if (!Number.isFinite(now.getTime())) throw new Error('日期无效');
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${prefix}-01`, end: `${prefix}-${lastDay}` };
}

export function projectMonthlyBudget(
  snapshot: MonthlyBudgetSnapshot,
  month: CalendarMonth,
): MonthlyBudgetOverview {
  if (!Number.isSafeInteger(snapshot.spentMinor) || snapshot.spentMinor < 0) {
    throw new Error('本月消费金额超出可计算范围');
  }
  const { budget, spentMinor } = snapshot;
  if (budget) assertBudgetAmount(budget.amountMinor);
  return {
    ...snapshot,
    month,
    remainingMinor: budget ? budget.amountMinor - spentMinor : null,
    usedPercentTenths: budget
      ? Number(
          (BigInt(spentMinor) * 1000n + BigInt(budget.amountMinor) / 2n) /
            BigInt(budget.amountMinor),
        )
      : null,
  };
}
