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
  ManagedPilotParseTransport,
  SelectedAiParseTransport,
  managedPilotPublic,
  type ManagedPilotPublic,
  type ManagedPilotStore,
} from '../infrastructure/ai/managed-pilot';
import { SecureManagedPilotRepository } from '../infrastructure/ai/secure-managed-pilot';
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
  managedPilotPublic: ManagedPilotPublic | null;
  backgroundScheduling: BackgroundSchedulingState;
  service: LedgerService | null;
  providerConfigStore: ProviderConfigStore | null;
  managedPilotStore: ManagedPilotStore | null;
  refresh: () => Promise<void>;
  /** Re-read secure BYOK config for UI warnings; transport already loads config per request. */
  reloadProviderConfig: () => Promise<void>;
  reloadManagedPilot: () => Promise<void>;
  tick: number;
};

const AppContext = createContext<AppContextValue>({
  ready: false,
  error: null,
  configError: null,
  providerPublic: null,
  managedPilotPublic: null,
  backgroundScheduling: { status: 'unknown', detail: null },
  service: null,
  providerConfigStore: null,
  managedPilotStore: null,
  refresh: async () => undefined,
  reloadProviderConfig: async () => undefined,
  reloadManagedPilot: async () => undefined,
  tick: 0,
});

/**
 * Production composition only.
 * AI path: a saved pilot credential explicitly selects managed pilot; otherwise BYOK is selected.
 * An active pilot failure never falls back to BYOK.
 * Settings save/clear applies to eligible pending/future jobs without restarting the app.
 * ID generation: ExpoCryptoIdGenerator (same instance path as background task).
 * Background registration is non-blocking; degradation is explicit in context (not silent success).
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [providerPublic, setProviderPublic] = useState<ProviderConfigPublic | null>(null);
  const [managedPilotPublicValue, setManagedPilotPublic] = useState<ManagedPilotPublic | null>(
    null,
  );
  const [backgroundScheduling, setBackgroundScheduling] = useState<BackgroundSchedulingState>({
    status: 'unknown',
    detail: null,
  });
  const [service, setService] = useState<LedgerService | null>(null);
  const [providerConfigStore, setProviderConfigStore] = useState<ProviderConfigStore | null>(null);
  const [managedPilotStore, setManagedPilotStore] = useState<ManagedPilotStore | null>(null);
  const [tick, setTick] = useState(0);
  const runnerRef = useRef<ParseJobRunner | null>(null);
  const configStoreRef = useRef<SecureProviderConfigRepository | null>(null);
  const pilotStoreRef = useRef<SecureManagedPilotRepository | null>(null);

  const syncAiPublic = useCallback(async () => {
    const providerStore = configStoreRef.current;
    const pilotStore = pilotStoreRef.current;
    if (!providerStore || !pilotStore) return;
    const [provider, pilotCredential] = await Promise.all([
      providerStore.loadPublic(),
      pilotStore.load(),
    ]);
    const pilot = managedPilotPublic(pilotCredential);
    setProviderPublic(provider);
    setManagedPilotPublic(pilot);
    setConfigError(provider || pilot ? null : new MissingProviderConfigError().message);
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
        const pilotStore = new SecureManagedPilotRepository();
        configStoreRef.current = store;
        pilotStoreRef.current = pilotStore;

        // Selection is secure-store state. Pilot errors do not fall back to BYOK.
        const byokTransport = new OpenAiCompatibleParseTransport(store);
        const pilotTransport = new ManagedPilotParseTransport(pilotStore);
        const transport = new SelectedAiParseTransport(pilotStore, pilotTransport, byokTransport);
        const ledger = new LedgerService(repo, transport, ids);
        const runner = new ParseJobRunner(ledger);
        runnerRef.current = runner;
        setSharedParseJobRunner(runner);
        const [pub, pilotCredential] = await Promise.all([store.loadPublic(), pilotStore.load()]);
        const pilot = managedPilotPublic(pilotCredential);
        const registration: BackgroundSchedulingRegistration = await registerParseBackgroundTask();
        if (!closed) {
          setBackgroundScheduling({
            status: registration.status,
            detail: registration.detail,
          });
          setService(ledger);
          setProviderConfigStore(store);
          setManagedPilotStore(pilotStore);
          setProviderPublic(pub);
          setManagedPilotPublic(pilot);
          setConfigError(pub || pilot ? null : new MissingProviderConfigError().message);
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
      pilotStoreRef.current = null;
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
    await syncAiPublic();
    const runner = runnerRef.current;
    if (runner) {
      void runner.resume().then(() => setTick((t) => t + 1));
    }
    setTick((t) => t + 1);
  }, [syncAiPublic]);

  const reloadManagedPilot = reloadProviderConfig;

  const value = useMemo(
    () => ({
      ready,
      error,
      configError,
      providerPublic,
      managedPilotPublic: managedPilotPublicValue,
      backgroundScheduling,
      service,
      providerConfigStore,
      managedPilotStore,
      refresh,
      reloadProviderConfig,
      reloadManagedPilot,
      tick,
    }),
    [
      ready,
      error,
      configError,
      providerPublic,
      managedPilotPublicValue,
      backgroundScheduling,
      service,
      providerConfigStore,
      managedPilotStore,
      refresh,
      reloadProviderConfig,
      reloadManagedPilot,
      tick,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  return useContext(AppContext);
}
