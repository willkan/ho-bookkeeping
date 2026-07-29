import { describe, expect, it, vi } from 'vitest';

describe('background scheduling registration result', () => {
  // Positive: successful registration returns ok (not silent)
  it('registerParseBackgroundTask returns ok when OS allows registration', async () => {
    vi.resetModules();
    vi.doMock('expo-background-task', () => ({
      BackgroundTaskResult: { Success: 1, Failed: 2 },
      BackgroundTaskStatus: { Restricted: 1, Available: 2 },
      getStatusAsync: async () => 2,
      registerTaskAsync: async () => undefined,
    }));
    vi.doMock('expo-task-manager', () => ({
      isTaskDefined: () => false,
      defineTask: () => undefined,
      isTaskRegisteredAsync: async () => false,
    }));
    // Avoid pulling openAppDatabase / native modules for this seam test.
    vi.doMock('../db/open-app-database', () => ({
      openAppDatabase: async () => {
        throw new Error('should not open db during register-only test');
      },
    }));
    vi.doMock('../ids/expo-crypto-id-generator', () => ({
      ExpoCryptoIdGenerator: class {
        createId(p: string) {
          return `${p}_x`;
        }
      },
    }));
    // Avoid expo-secure-store / OpenAI SDK graph for register-only seam.
    vi.doMock('../ai/secure-provider-config', () => ({
      SecureProviderConfigRepository: class {},
    }));
    vi.doMock('../ai/transport', () => ({
      OpenAiCompatibleParseTransport: class {},
    }));
    const { registerParseBackgroundTask } = await import('./background-parse-task');
    const result = await registerParseBackgroundTask();
    expect(result.status).toBe('ok');
    expect(result.detail).toMatch(/registered/);
    vi.doUnmock('expo-background-task');
    vi.doUnmock('expo-task-manager');
    vi.doUnmock('../db/open-app-database');
    vi.doUnmock('../ids/expo-crypto-id-generator');
    vi.doUnmock('../ai/secure-provider-config');
    vi.doUnmock('../ai/transport');
    vi.resetModules();
  });

  // Negative: registration failure is degraded, not success
  it('registerParseBackgroundTask returns degraded when register throws', async () => {
    vi.resetModules();
    vi.doMock('expo-background-task', () => ({
      BackgroundTaskResult: { Success: 1, Failed: 2 },
      BackgroundTaskStatus: { Restricted: 1, Available: 2 },
      getStatusAsync: async () => 2,
      registerTaskAsync: async () => {
        throw new Error('register denied');
      },
    }));
    vi.doMock('expo-task-manager', () => ({
      isTaskDefined: () => false,
      defineTask: () => undefined,
      isTaskRegisteredAsync: async () => false,
    }));
    vi.doMock('../db/open-app-database', () => ({
      openAppDatabase: async () => {
        throw new Error('unused');
      },
    }));
    vi.doMock('../ids/expo-crypto-id-generator', () => ({
      ExpoCryptoIdGenerator: class {
        createId(p: string) {
          return `${p}_x`;
        }
      },
    }));
    vi.doMock('../ai/secure-provider-config', () => ({
      SecureProviderConfigRepository: class {},
    }));
    vi.doMock('../ai/transport', () => ({
      OpenAiCompatibleParseTransport: class {},
    }));
    const { registerParseBackgroundTask } = await import('./background-parse-task');
    const result = await registerParseBackgroundTask();
    expect(result.status).toBe('degraded');
    expect(result.detail).toMatch(/register denied|registration failed/);
    vi.doUnmock('expo-background-task');
    vi.doUnmock('expo-task-manager');
    vi.doUnmock('../db/open-app-database');
    vi.doUnmock('../ids/expo-crypto-id-generator');
    vi.doUnmock('../ai/secure-provider-config');
    vi.doUnmock('../ai/transport');
    vi.resetModules();
  });

  // Negative: Restricted status is degraded, not ok
  it('registerParseBackgroundTask returns degraded when OS status is Restricted', async () => {
    vi.resetModules();
    vi.doMock('expo-background-task', () => ({
      BackgroundTaskResult: { Success: 1, Failed: 2 },
      BackgroundTaskStatus: { Restricted: 1, Available: 2 },
      getStatusAsync: async () => 1,
      registerTaskAsync: async () => undefined,
    }));
    vi.doMock('expo-task-manager', () => ({
      isTaskDefined: () => false,
      defineTask: () => undefined,
      isTaskRegisteredAsync: async () => false,
    }));
    vi.doMock('../db/open-app-database', () => ({
      openAppDatabase: async () => {
        throw new Error('unused');
      },
    }));
    vi.doMock('../ids/expo-crypto-id-generator', () => ({
      ExpoCryptoIdGenerator: class {
        createId(p: string) {
          return `${p}_x`;
        }
      },
    }));
    vi.doMock('../ai/secure-provider-config', () => ({
      SecureProviderConfigRepository: class {},
    }));
    vi.doMock('../ai/transport', () => ({
      OpenAiCompatibleParseTransport: class {},
    }));
    const { registerParseBackgroundTask } = await import('./background-parse-task');
    const result = await registerParseBackgroundTask();
    expect(result.status).toBe('degraded');
    expect(result.detail).toMatch(/Restricted/);
    vi.doUnmock('expo-background-task');
    vi.doUnmock('expo-task-manager');
    vi.doUnmock('../db/open-app-database');
    vi.doUnmock('../ids/expo-crypto-id-generator');
    vi.doUnmock('../ai/secure-provider-config');
    vi.doUnmock('../ai/transport');
    vi.resetModules();
  });
});
