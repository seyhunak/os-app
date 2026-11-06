import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError, createApi, type LedgerEntry } from './api';
import type { Connection } from './storage';

const OFFLINE_CHECK_MS = 10_000;
const ONLINE_SYNC_MS = 300_000;
const RESUME_SYNC_MS = 60_000;
const SAVED_BRIEFS = 30;

export interface ConnectionState {
  online: boolean;
  syncing: boolean;
  /** Changes on this device waiting to reach the server. */
  pending: number;
  savedAt: string | null;
  /** Goes up when synced data changed, so screens know to reload. */
  refreshKey: number;
}

interface QueuedUpdate {
  clientId: string;
  text: string;
  createdAt: string;
}

const isOffline = (error: unknown) => error instanceof ApiError && error.status === 0;

/**
 * The server API, plus a copy on this device. Reads fall back to the copy when the server is
 * out of reach, and updates wait in a queue until it's back. Each server gets its own copy,
 * so connecting to a different one can't mix them up.
 */
export function createOfflineApi(connection: Connection) {
  const api = createApi(connection);
  const prefix = `os.offline.${connection.url}`;
  const keys = { outbox: `${prefix}:outbox`, goals: `${prefix}:pendingGoals`, savedAt: `${prefix}:savedAt` };

  const load = async <T>(name: string): Promise<T | undefined> => {
    const raw = await AsyncStorage.getItem(name).catch(() => null);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  };
  const save = (name: string, value: unknown) => AsyncStorage.setItem(name, JSON.stringify(value)).catch(() => undefined);

  let state: ConnectionState = { online: true, syncing: false, pending: 0, savedAt: null, refreshKey: 0 };
  const listeners = new Set<() => void>();
  const update = (change: Partial<ConnectionState>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };

  let syncInFlight: Promise<void> | null = null;
  let flushInFlight: Promise<void> | null = null;
  let lastSync = 0;

  const setOnline = (online: boolean) => {
    if (online === state.online) return;
    update({ online });
    // Back in touch with the server: send what's waiting and fetch what's new.
    if (online) void sync(true);
  };

  /** Fetches and saves a copy, or returns the saved copy if the server is out of reach. */
  async function read<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
    try {
      const value = await fetcher();
      await save(`${prefix}:${name}`, value);
      setOnline(true);
      return value;
    } catch (error) {
      if (isOffline(error)) {
        setOnline(false);
        const saved = await load<T>(`${prefix}:${name}`);
        if (saved !== undefined) return saved;
      }
      throw error;
    }
  }

  const countPending = async () => {
    const [outbox, goals] = await Promise.all([load<QueuedUpdate[]>(keys.outbox), load<string>(keys.goals)]);
    update({ pending: (outbox?.length ?? 0) + (goals === undefined ? 0 : 1) });
  };

  /** Sends what's queued, oldest first. It stops at the first outage and tries again later. */
  function flush(): Promise<void> {
    flushInFlight ??= (async () => {
      for (;;) {
        const [next] = (await load<QueuedUpdate[]>(keys.outbox)) ?? [];
        if (!next) break;
        try {
          await api.addUpdate(next.text, { clientId: next.clientId, createdAt: next.createdAt });
        } catch (error) {
          if (isOffline(error)) setOnline(false);
          // Offline or signed out: keep it. Anything else the server has refused for good.
          if (isOffline(error) || (error instanceof ApiError && error.status === 401)) return;
        }
        const rest = (await load<QueuedUpdate[]>(keys.outbox)) ?? [];
        await save(keys.outbox, rest.filter((u) => u.clientId !== next.clientId));
      }
      const goals = await load<string>(keys.goals);
      if (goals !== undefined) {
        try {
          await api.saveGoals(goals);
        } catch (error) {
          if (isOffline(error)) setOnline(false);
          if (isOffline(error) || (error instanceof ApiError && error.status === 401)) return;
        }
        // Only clear it if no newer edit arrived while sending.
        if ((await load<string>(keys.goals)) === goals) await AsyncStorage.removeItem(keys.goals);
      }
    })().finally(() => {
      flushInFlight = null;
      void countPending();
    });
    return flushInFlight;
  }

  async function runSync(reconnected: boolean) {
    update({ syncing: true });
    try {
      await flush();
      const before = (await load<{ briefs: Array<{ id: number }> }>(`${prefix}:briefs`))?.briefs[0]?.id;
      const briefs = await read('briefs', async () => {
        const result = await api.briefs();
        return { briefs: result.briefs.slice(0, SAVED_BRIEFS) };
      });
      await Promise.all([read('status', api.status), read('schedules', api.schedules), read('goals', api.goals), read('ledger', api.ledger)]);
      const savedAt = new Date().toISOString();
      await save(keys.savedAt, savedAt);
      lastSync = Date.now();
      update({ savedAt, ...(reconnected || briefs.briefs[0]?.id !== before ? { refreshKey: state.refreshKey + 1 } : {}) });
    } catch {
      // Still unreachable, or a read failed. The next check tries again, and saved content stays put.
    } finally {
      update({ syncing: false });
    }
  }

  function sync(reconnected = false): Promise<void> {
    syncInFlight ??= runSync(reconnected).finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  /** Looks for the server at its saved address. */
  const check = async () => {
    try {
      await api.status();
      setOnline(true);
    } catch (error) {
      if (isOffline(error)) setOnline(false);
    }
  };

  return {
    ...api,
    status: () => read('status', api.status),
    briefs: () => read('briefs', async () => {
      const result = await api.briefs();
      return { briefs: result.briefs.slice(0, SAVED_BRIEFS) };
    }),
    schedules: () => read('schedules', api.schedules),
    toolkits: (fresh = false) => read('toolkits', () => api.toolkits(fresh)),

    goals: async () => {
      const pending = await load<string>(keys.goals);
      const saved = await read('goals', api.goals);
      return pending === undefined ? saved : { goals: pending };
    },
    /** Saved here first, so a dropped connection can't lose the edit. */
    saveGoals: async (goals: string) => {
      await save(keys.goals, goals);
      await save(`${prefix}:goals`, { goals });
      await flush();
      return { goals };
    },

    ledger: async () => {
      const { entries } = await read('ledger', api.ledger);
      const outbox = (await load<QueuedUpdate[]>(keys.outbox)) ?? [];
      const waiting: LedgerEntry[] = outbox.map((u, i) => ({ id: -1 - i, text: u.text, createdAt: u.createdAt, pending: true }));
      return { entries: [...waiting.reverse(), ...entries] };
    },
    /** Queued first, then sent. The id means a retry can't save it twice. */
    addUpdate: async (text: string): Promise<LedgerEntry> => {
      const entry: QueuedUpdate = { clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`, text, createdAt: new Date().toISOString() };
      await save(keys.outbox, [...((await load<QueuedUpdate[]>(keys.outbox)) ?? []), entry]);
      await countPending();
      await flush();
      const stillWaiting = ((await load<QueuedUpdate[]>(keys.outbox)) ?? []).some((u) => u.clientId === entry.clientId);
      return { id: -Date.now(), text, createdAt: entry.createdAt, ...(stillWaiting ? { pending: true } : {}) };
    },

    sync: () => check().then(() => sync()),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,

    /** Keeps looking for the server, and stays up to date while it's reachable. Returns a stop function. */
    start: () => {
      void Promise.all([load<string>(keys.savedAt), countPending()]).then(([savedAt]) => {
        if (savedAt) update({ savedAt });
        void sync();
      });
      const timer = setInterval(() => {
        if (!state.online) void check();
        else if (Date.now() - lastSync > ONLINE_SYNC_MS) void sync();
      }, OFFLINE_CHECK_MS);
      const appState = AppState.addEventListener('change', (next) => {
        if (next !== 'active') return;
        if (!state.online) void check();
        else if (Date.now() - lastSync > RESUME_SYNC_MS) void sync();
      });
      const onNetwork = () => void check();
      if (Platform.OS === 'web') window.addEventListener('online', onNetwork);
      return () => {
        clearInterval(timer);
        appState.remove();
        if (Platform.OS === 'web') window.removeEventListener('online', onNetwork);
      };
    },

    /** Removes everything saved on this device for this server. */
    forgetDevice: async () => {
      const all = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(all.filter((key) => key.startsWith(prefix)));
    },
  };
}

export type OfflineApi = ReturnType<typeof createOfflineApi>;

export const ConnectionContext = createContext<ConnectionState | null>(null);

const ALWAYS_ONLINE: ConnectionState = { online: true, syncing: false, pending: 0, savedAt: null, refreshKey: 0 };
export const useConnection = () => useContext(ConnectionContext) ?? ALWAYS_ONLINE;
