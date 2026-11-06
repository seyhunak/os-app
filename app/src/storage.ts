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
