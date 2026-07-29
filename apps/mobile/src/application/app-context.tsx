import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { LedgerService } from './ledger-service';
import { OpenAiCompatibleParseTransport } from '../infrastructure/ai/transport';
import {
  MissingProviderConfigError,
  type ProviderConfigPublic,
} from '../infrastructure/ai/provider-config';
import type { ProviderConfigStore } from '../infrastructure/ai/provider-config-store';
import { SecureProviderConfigRepository } from '../infrastructure/ai/secure-provider-config';
import { openAppDatabase } from '../infrastructure/db/open-app-database';
import { LedgerRepository } from '../infrastructure/db/repositories';
import type { SqliteDatabase } from '../infrastructure/db/sqlite-database';
import { ExpoCryptoIdGenerator } from '../infrastructure/ids/expo-crypto-id-generator';
import {
  registerParseBackgroundTask,
  setSharedParseJobRunner,
  type BackgroundSchedulingRegistration,
} from '../infrastructure/jobs/background-parse-task';
import { ParseJobRunner } from '../infrastructure/jobs/runner';

export type BackgroundSchedulingState = {
  status: 'unknown' | 'ok' | 'degraded';
  detail: string | null;
};

type AppContextValue = {
  ready: boolean;
  error: string | null;
  configError: string | null;
  providerPublic: ProviderConfigPublic | null;
  backgroundScheduling: BackgroundSchedulingState;
  service: LedgerService | null;
  providerConfigStore: ProviderConfigStore | null;
  refresh: () => Promise<void>;
  /** Re-read secure BYOK config for UI warnings; transport already loads config per request. */
  reloadProviderConfig: () => Promise<void>;
  tick: number;
};

const AppContext = createContext<AppContextValue>({
  ready: false,
  error: null,
  configError: null,
  providerPublic: null,
  backgroundScheduling: { status: 'unknown', detail: null },
  service: null,
  providerConfigStore: null,
  refresh: async () => undefined,
  reloadProviderConfig: async () => undefined,
  tick: 0,
});

/**
 * Production composition only.
 * AI path: OpenAiCompatibleParseTransport resolves BYOK config from secure store on each parse.
 * Settings save/clear applies to eligible pending/future jobs without restarting the app.
 * ID generation: ExpoCryptoIdGenerator (same instance path as background task).
 * Background registration is non-blocking; degradation is explicit in context (not silent success).
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [providerPublic, setProviderPublic] = useState<ProviderConfigPublic | null>(null);
  const [backgroundScheduling, setBackgroundScheduling] = useState<BackgroundSchedulingState>({
    status: 'unknown',
    detail: null,
  });
  const [service, setService] = useState<LedgerService | null>(null);
  const [providerConfigStore, setProviderConfigStore] = useState<ProviderConfigStore | null>(null);
  const [tick, setTick] = useState(0);
  const runnerRef = useRef<ParseJobRunner | null>(null);
  const configStoreRef = useRef<SecureProviderConfigRepository | null>(null);

  const syncProviderPublic = useCallback(async () => {
    const store = configStoreRef.current;
    if (!store) return;
    const pub = await store.loadPublic();
    setProviderPublic(pub);
    setConfigError(pub ? null : new MissingProviderConfigError().message);
  }, []);

  useEffect(() => {
    let closed = false;
    let db: SqliteDatabase | null = null;
    (async () => {
      try {
        db = await openAppDatabase();
        const ids = new ExpoCryptoIdGenerator();
        const repo = new LedgerRepository(db, ids);
        const store = new SecureProviderConfigRepository();
        configStoreRef.current = store;

        // Transport always reloads secure config per parse — no env-var gateway path.
        const transport = new OpenAiCompatibleParseTransport(store);
        const ledger = new LedgerService(repo, transport, ids);
        const runner = new ParseJobRunner(ledger);
        runnerRef.current = runner;
        setSharedParseJobRunner(runner);
        const pub = await store.loadPublic();
        const registration: BackgroundSchedulingRegistration = await registerParseBackgroundTask();
        if (!closed) {
          setBackgroundScheduling({
            status: registration.status,
            detail: registration.detail,
          });
          setService(ledger);
          setProviderConfigStore(store);
          setProviderPublic(pub);
          setConfigError(pub ? null : new MissingProviderConfigError().message);
          setReady(true);
          void runner.resume().then(() => {
            if (!closed) setTick((t) => t + 1);
          });
        }
      } catch (e) {
        if (!closed) {
          setError(e instanceof Error ? e.message : 'failed to open database');
          setReady(true);
        }
      }
    })();

    return () => {
      closed = true;
      setSharedParseJobRunner(null);
      db?.close();
      runnerRef.current = null;
      configStoreRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active' && runnerRef.current) {
        void runnerRef.current.resume().then(() => setTick((t) => t + 1));
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const refresh = useCallback(async () => {
    setTick((t) => t + 1);
    const runner = runnerRef.current;
    if (runner) {
      void runner.resume().then(() => setTick((t) => t + 1));
    }
  }, []);

  const reloadProviderConfig = useCallback(async () => {
    await syncProviderPublic();
    const runner = runnerRef.current;
    if (runner) {
      void runner.resume().then(() => setTick((t) => t + 1));
    }
    setTick((t) => t + 1);
  }, [syncProviderPublic]);

  const value = useMemo(
    () => ({
      ready,
      error,
      configError,
      providerPublic,
      backgroundScheduling,
      service,
      providerConfigStore,
      refresh,
      reloadProviderConfig,
      tick,
    }),
    [
      ready,
      error,
      configError,
      providerPublic,
      backgroundScheduling,
      service,
      providerConfigStore,
      refresh,
      reloadProviderConfig,
      tick,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  return useContext(AppContext);
}
