import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError, createApi, PROBE_TIMEOUT_MS, type Brief, type Kind, type LedgerEntry, type Status } from './api';
import { writeOfflineBrief, type BriefPrompt } from './offlineBrief';
import { probe, withTimeout } from './connectivity';
import { archivedIds, createOutbox, isOfflineError, newClientId, queueAndSend, SAVE_WAIT_MS, type Op } from './outbox';
import { clearPhoneAiKey, loadPhoneAiKey, savePhoneAiKey, type Connection } from './storage';

const OFFLINE_CHECK_MS = 10_000;
const ONLINE_CHECK_MS = 30_000;
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

const isOffline = isOfflineError;

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

  const outbox = createOutbox({
    storage: { load: () => load(keys.outbox), save: (ops) => save(keys.outbox, ops) },
    send: (op: Op) =>
      op.kind === 'update' ? api.addUpdate(op.text, { clientId: op.clientId, createdAt: op.createdAt })
        : op.kind === 'brief' ? api.importBrief(op.draft)
          : api.archiveBriefs(op.ids),
    onChange: () => void countPending(),
  });
  let lastSync = 0;
  let lastCheck = 0;

  const setOnline = (online: boolean) => {
    if (online === state.online) return;
    update({ online });
    // Back in touch with the server: send what's waiting and fetch what's new.
    if (online) void sync(true);
  };

  /**
   * Fetches and saves a copy, or returns the saved copy if the server is out of reach.
   * Waits for the startup check first, and while offline goes straight to the saved copy,
   * so a dead tunnel costs at most the 3 second check instead of a 10 second read per screen.
   */
  async function read<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
    await ready();
    if (!state.online) {
      const saved = await load<T>(`${prefix}:${name}`);
      if (saved !== undefined) return saved;
    }
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
    const [ops, goals] = await Promise.all([outbox.list(), load<string>(keys.goals)]);
    update({ pending: ops.length + (goals === undefined ? 0 : 1) });
  };

  /** Sends what's queued, oldest first. It stops at the first outage and tries again later. */
  function flush(): Promise<void> {
    flushInFlight ??= (async () => {
      const result = await outbox.flush();
      if (result === 'offline') setOnline(false);
      if (result !== 'sent') return;
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
    // Reads would only return the saved copy, so there's nothing to sync until the server is back.
    if (!state.online) return;
    update({ syncing: true });
    try {
      await flush();
      const before = (await load<{ briefs: Array<{ id: number }> }>(`${prefix}:briefs`))?.briefs[0]?.id;
      const briefs = await read('briefs', async () => {
        const result = await api.briefs();
        return { briefs: result.briefs.slice(0, SAVED_BRIEFS) };
      });
      await Promise.all([read('status', api.status), read('schedules', api.schedules), read('goals', api.goals), read('ledger', api.ledger)]);
      // The rules for writing a brief offline. An older server doesn't have them, which is fine.
      await read('prompt', api.briefPrompt).catch(() => undefined);
      await syncPhoneKey();
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

  /** Looks for the server at its saved address, giving up after 3 seconds. */
  const check = async () => {
    lastCheck = Date.now();
    setOnline(await probe(() => api.ping(PROBE_TIMEOUT_MS), PROBE_TIMEOUT_MS));
  };

  /** The first check, shared by every read made while the app opens. */
  let startupCheck: Promise<void> | null = null;
  const ready = () => (startupCheck ??= check());

  /**
   * The phone keeps the server's OpenRouter key in its Keychain, so offline briefs use the same key
   * with no second paste. Removing it on the server removes it here. Web has no secure store, so skips it.
   */
  async function syncPhoneKey(): Promise<void> {
    if (Platform.OS === 'web') return;
    const status = await load<Status>(`${prefix}:status`);
    if (!status) return;
    try {
      if (!status.openrouter) {
        if (await loadPhoneAiKey()) await clearPhoneAiKey();
        return;
      }
      const { apiKey } = await api.openRouterKey();
      if (apiKey && apiKey !== (await loadPhoneAiKey())) await savePhoneAiKey(apiKey);
    } catch {
      // An older server without this route, or a blip. The next sync tries again.
    }
  }

  return {
    ...api,
    status: () => read('status', api.status),
    briefs: async () => {
      const { briefs } = await read('briefs', async () => {
        const result = await api.briefs();
        return { briefs: result.briefs.slice(0, SAVED_BRIEFS) };
      });
      const ops = await outbox.list();
      // Archived on this device but not on the server yet.
      const hidden = archivedIds(ops);
      // Written on this device while offline, and not on the server yet.
      const drafts: Brief[] = ops.flatMap((op) => (op.kind === 'brief' ? [{ ...op.draft, id: op.id, trigger: 'offline' as const, pending: true }] : []));
      return { briefs: [...drafts, ...briefs.filter((b) => !hidden.has(b.id))].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) };
    },
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
      const sending = flush();
      if (state.online) await withTimeout(sending, SAVE_WAIT_MS).catch(() => undefined);
      return { goals };
    },

    ledger: async () => {
      const { entries } = await read('ledger', api.ledger);
      const ops = await outbox.list();
      const sent = new Set(entries.map((e) => e.text + e.createdAt));
      const waiting: LedgerEntry[] = ops.flatMap((op, i) =>
        op.kind === 'update' && !sent.has(op.text + op.createdAt) ? [{ id: -1 - i, text: op.text, createdAt: op.createdAt, pending: true }] : []);
      return { entries: [...waiting.reverse(), ...entries] };
    },
    /**
     * Saved on the device first, then sent. It waits at most a few seconds for the server, and not
     * at all while offline, so Save never hangs. The client id means a retry can't save it twice.
     */
    addUpdate: async (text: string): Promise<LedgerEntry> => {
      const op: Op = { kind: 'update', clientId: newClientId(), text, createdAt: new Date().toISOString() };
      const queued = await queueAndSend(outbox, op, state.online);
      return { id: -Date.now(), text, createdAt: op.createdAt, ...(queued ? { pending: true } : {}) };
    },

    /** Hidden here at once, and archived on the server now or when it's back. Returns whether it's still queued. */
    archiveBriefs: async (ids: number[]): Promise<{ archived: number; queued: boolean }> => {
      // A draft that never reached the server is simply dropped from the queue.
      const drafts = ids.filter((id) => id < 0);
      if (drafts.length) await outbox.remove((op) => op.kind === 'brief' && drafts.includes(op.id));
      ids = ids.filter((id) => id > 0);
      if (!ids.length) return { archived: drafts.length, queued: false };
      const saved = await load<{ briefs: Brief[] }>(`${prefix}:briefs`);
      if (saved) await save(`${prefix}:briefs`, { briefs: saved.briefs.filter((b) => !ids.includes(b.id)) });
      const queued = await queueAndSend(outbox, { kind: 'archive', clientId: newClientId(), ids }, state.online);
      return { archived: ids.length, queued };
    },

    /** Server briefs read your tools, so anything this device saved goes first, then the brief is written. */
    generateBrief: async (kind: Kind, refresh = false) => {
      await withTimeout(flush(), SAVE_WAIT_MS).catch(() => undefined);
      return api.generateBrief(kind, refresh);
    },
    generateTodayBrief: async (kind: Kind) => {
      await withTimeout(flush(), SAVE_WAIT_MS).catch(() => undefined);
      return api.generateTodayBrief(kind);
    },

    /**
     * Writes a brief on this device from what it has saved: goals, your updates (synced or not)
     * and the last scan's summaries. No tools are read. It's queued and sent to the server when
     * it's back, where it's stored as is, so no pull budget is spent.
     */
    writeOfflineBrief: async (kind: Kind): Promise<Brief> => {
      const pendingGoals = await load<string>(keys.goals);
      const goals = pendingGoals ?? (await load<{ goals: string }>(`${prefix}:goals`))?.goals ?? '';
      const ledger = (await load<{ entries: LedgerEntry[] }>(`${prefix}:ledger`))?.entries ?? [];
      const ops = await outbox.list();
      const queued = ops.flatMap((op) => (op.kind === 'update' ? [{ text: op.text, createdAt: op.createdAt }] : []));
      const updates = [...ledger, ...queued].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const lastScan = (await load<{ briefs: Brief[] }>(`${prefix}:briefs`))?.briefs.find((b) => b.trigger !== 'offline');
      const status = await load<Status>(`${prefix}:status`);
      const now = new Date();
      const result = await writeOfflineBrief({ kind, now, goals, updates, ...(lastScan ? { lastScan } : {}) }, {
        prompt: await load<BriefPrompt>(`${prefix}:prompt`),
        apiKey: await loadPhoneAiKey(),
        model: status?.openrouterModel ?? status?.model ?? null,
        fallbacks: status?.fallbackModels ?? [],
      });
      const clientId = newClientId();
      const id = -now.getTime();
      const draft = { clientId, kind, generator: result.generator, markdown: result.markdown, sources: result.sources, createdAt: now.toISOString() };
      const stillQueued = await queueAndSend(outbox, { kind: 'brief', clientId, id, draft }, state.online);
      return { ...draft, id, trigger: 'offline', ...(stillQueued ? { pending: true } : {}) };
    },

    sync: () => check().then(() => sync()),
    /** Copies the server's OpenRouter key to this phone now, rather than at the next sync. */
    syncPhoneKey: async () => {
      await read('status', api.status).catch(() => undefined);
      await syncPhoneKey();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,

    /** Keeps looking for the server, and stays up to date while it's reachable. Returns a stop function. */
    start: () => {
      void Promise.all([load<string>(keys.savedAt), countPending(), ready()]).then(([savedAt]) => {
        if (savedAt) update({ savedAt });
        // Offline at startup: saved content is already showing, and the timer keeps checking.
        if (state.online) void sync();
      });
      const timer = setInterval(() => {
        if (!state.online) void check();
        else if (Date.now() - lastSync > ONLINE_SYNC_MS) void sync();
        // Notices a lost server soon, so the status shown in Settings stays true.
        else if (Date.now() - lastCheck > ONLINE_CHECK_MS) void check();
      }, OFFLINE_CHECK_MS);
      // Back in the foreground: check again either way, since the tunnel may have come or gone meanwhile.
      const appState = AppState.addEventListener('change', (next) => {
        if (next !== 'active') return;
        void check().then(() => {
          if (state.online && Date.now() - lastSync > RESUME_SYNC_MS) void sync();
        });
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
