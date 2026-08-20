import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  ManagedPilotCredentialSchema,
  type ManagedPilotCredential,
  type ManagedPilotStore,
} from './managed-pilot';

export const MANAGED_PILOT_CREDENTIAL_KEY = 'bookkeeping.ai.managed_pilot_v1';
export const MANAGED_PILOT_ACTIVATION_ID_KEY = 'bookkeeping.ai.managed_pilot_activation_id_v1';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class SecureManagedPilotRepository implements ManagedPilotStore {
  async load(): Promise<ManagedPilotCredential | null> {
    const raw = await SecureStore.getItemAsync(MANAGED_PILOT_CREDENTIAL_KEY);
    if (!raw) return null;
    try {
      return ManagedPilotCredentialSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error('托管 AI 安全配置已损坏，请退出内测后重新激活');
    }
  }

  async save(credential: ManagedPilotCredential): Promise<void> {
    const validated = ManagedPilotCredentialSchema.parse(credential);
    await SecureStore.setItemAsync(
      MANAGED_PILOT_CREDENTIAL_KEY,
      JSON.stringify(validated),
      OPTIONS,
    );
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(MANAGED_PILOT_CREDENTIAL_KEY);
  }

  async getOrCreateActivationId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(MANAGED_PILOT_ACTIVATION_ID_KEY);
    if (existing) return existing;
    const created = `install_${Crypto.randomUUID()}`;
    await SecureStore.setItemAsync(MANAGED_PILOT_ACTIVATION_ID_KEY, created, OPTIONS);
    return created;
  }
}
