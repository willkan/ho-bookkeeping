import {
  calendarMonth,
  parseBudgetAmount,
  projectMonthlyBudget,
  type MonthlyBudgetOverview,
} from '../domain/monthly-budget';
import { createMobileLogger } from '../infrastructure/logging/mobile-logger';
import type { IdGenerator } from './ports/id-generator';
import type { MonthlyBudgetStore } from './ports/monthly-budget-store';

const logger = createMobileLogger('monthly-budget-service');

export class MonthlyBudgetService {
  constructor(
    private readonly store: MonthlyBudgetStore,
    private readonly ids: IdGenerator,
  ) {}

  overview(now = new Date()): MonthlyBudgetOverview {
    const month = calendarMonth(now);
    logger.debug('read_requested');
    const overview = projectMonthlyBudget(this.store.readMonth(month), month);
    logger.debug('read_succeeded', { enabled: overview.budget !== null });
    return overview;
  }

  save(amountText: string): void {
    logger.info('save_requested');
    const amountMinor = parseBudgetAmount(amountText);
    this.store.save({
      newId: this.ids.createId('budget'),
      amountMinor,
      now: new Date().toISOString(),
    });
    logger.info('save_succeeded');
  }

  disable(): void {
    logger.info('disable_requested');
    this.store.disable(new Date().toISOString());
    logger.info('disable_succeeded');
  }
}
