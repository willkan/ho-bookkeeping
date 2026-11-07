import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import type { MonthlyBudgetOverview } from '../domain/monthly-budget';
import { createMobileLogger } from '../infrastructure/logging/mobile-logger';
import { useApp } from './app-context';

const logger = createMobileLogger('use-monthly-budget');
type BudgetRead =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; overview: MonthlyBudgetOverview };

/** A disposable projection. No second global budget/ledger state. */
export function useMonthlyBudget() {
  const { ready, monthlyBudgetService, tick, refresh } = useApp();
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useFocusEffect(retry);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => sub.remove();
  }, [retry]);

  useEffect(() => {
    // Re-arm at local midnight. At most one day, below the platform timer limit.
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = setTimeout(retry, midnight.getTime() - now.getTime() + 50);
    return () => clearTimeout(timer);
  }, [revision, retry]);

  const state = useMemo<BudgetRead>(() => {
    void tick;
    void revision;
    if (!ready) return { status: 'loading' };
    if (!monthlyBudgetService) return { status: 'error' };
    try {
      return { status: 'ready', overview: monthlyBudgetService.overview() };
    } catch {
      logger.error('read_failed');
      return { status: 'error' };
    }
  }, [ready, monthlyBudgetService, tick, revision]);

  return { state, retry, monthlyBudgetService, refresh };
}
