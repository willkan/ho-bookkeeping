import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

let pendingCredential: Promise<string> | undefined;

export function getFeedbackCredential(): Promise<string> {
  if (!pendingCredential) {
    pendingCredential = loadCredential().catch((error: unknown) => {
      pendingCredential = undefined;
      throw error;
    });
  }
  return pendingCredential;
}

async function loadCredential(): Promise<string> {
  const key = 'bookkeeping.feedback.credential_v1';
  const existing = await SecureStore.getItemAsync(key);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const credential = `feedback_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  await SecureStore.setItemAsync(key, credential, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return credential;
}
