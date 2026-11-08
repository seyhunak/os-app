import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'os.connection';

export interface Connection {
  url: string;
  token: string;
}

export async function loadConnection(): Promise<Connection | null> {
  const raw = Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
  try {
    return raw ? (JSON.parse(raw) as Connection) : null;
  } catch {
    return null;
  }
}

export async function saveConnection(connection: Connection): Promise<void> {
  const raw = JSON.stringify(connection);
  if (Platform.OS === 'web') localStorage.setItem(KEY, raw);
  else await SecureStore.setItemAsync(KEY, raw);
}

export async function clearConnection(): Promise<void> {
  if (Platform.OS === 'web') localStorage.removeItem(KEY);
  else await SecureStore.deleteItemAsync(KEY);
}

const AI_KEY = 'os.offlineOpenRouterKey';

/**
 * An OpenRouter key kept on this phone, in the iOS Keychain or Android Keystore, so it can write a
 * brief while your Mac is out of reach. Not on web, where there's no secure place to keep it.
 */
export async function loadPhoneAiKey(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(AI_KEY).catch(() => null);
}

export async function savePhoneAiKey(key: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Offline writing with AI works in the iPhone and Android apps.');
  await SecureStore.setItemAsync(AI_KEY, key);
}

export async function clearPhoneAiKey(): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(AI_KEY);
}
