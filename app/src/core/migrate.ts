import type { Brief, LedgerEntry, Schedule, Store } from './db';

/**
 * Before OS ran on the phone, the app kept a copy of what it read from your Mac under keys like
 * `os.offline.<server url>:briefs`, plus changes waiting to sync. This moves that copy into the
 * phone's own store, once, so your briefs, updates, goals and schedules carry over.
 */

export interface OldCopy {
  /** Every key the old app saved, with its raw value. */
  entries: Array<[string, string | null]>;
  /** The OpenRouter key the old app kept in the Keychain for offline briefs. */
  openRouterKey: string | null;
}

interface OldStatus {
  selectedToolkits?: string[];
  openrouterModel?: string;
  model?: string;
  timezone?: string | null;
}

type OldOp =
  | { kind?: 'update'; text: string; createdAt: string }
  | { kind: 'archive'; ids: number[] }
  | { kind: 'brief'; draft: Omit<Brief, 'id' | 'trigger'> };

const PREFIX = 'os.offline.';
const DONE = 'migrated_from_server';

const parse = <T>(raw: string | null | undefined): T | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

/** The old keys, grouped by the server they came from. The server with the newest save wins. */
function newestServer(entries: OldCopy['entries']): Map<string, string | null> | null {
  const servers = new Map<string, Map<string, string | null>>();
  for (const [key, value] of entries) {
    if (!key.startsWith(PREFIX)) continue;
    const split = key.lastIndexOf(':');
    if (split <= PREFIX.length) continue;
    const server = key.slice(PREFIX.length, split);
    if (!servers.has(server)) servers.set(server, new Map());
    servers.get(server)!.set(key.slice(split + 1), value);
  }
  let best: Map<string, string | null> | null = null;
  let bestAt = '';
  for (const keys of servers.values()) {
    const at = parse<string>(keys.get('savedAt')) ?? '';
    if (!best || at > bestAt) {
      best = keys;
      bestAt = at;
    }
  }
  return best;
}

/** Imports the old copy into `store`. Safe to call on every start: it runs once, and never over data already here. */
export function migrateOldCopy(store: Store, old: OldCopy): { imported: boolean; briefs: number; updates: number } {
  const none = { imported: false, briefs: 0, updates: 0 };
  if (store.getSetting(DONE)) return none;
  const keys = newestServer(old.entries);
  const hasData = store.latestBrief() !== null || store.listLedger(1).length > 0;
  if (!keys || hasData) {
    store.setSetting(DONE, new Date().toISOString());
    return none;
  }

  const ops = parse<OldOp[]>(keys.get('outbox')) ?? [];
  const archived = new Set(ops.flatMap((op) => (op.kind === 'archive' ? op.ids : [])));
  const briefs: Array<Omit<Brief, 'id'>> = [
    ...(parse<{ briefs: Brief[] }>(keys.get('briefs'))?.briefs ?? []).filter((b) => !archived.has(b.id)),
    ...ops.flatMap((op) => (op.kind === 'brief' ? [{ ...op.draft, trigger: 'offline' as const }] : [])),
  ].map(({ kind, trigger, generator, markdown, sources, createdAt }) => ({ kind, trigger, generator, markdown, sources, createdAt }))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const saved = parse<{ entries: LedgerEntry[] }>(keys.get('ledger'))?.entries ?? [];
  const seen = new Set(saved.map((e) => e.text + e.createdAt));
  const updates = [
    ...saved,
    ...ops.flatMap((op) => (op.kind === undefined || op.kind === 'update' ? [op as { text: string; createdAt: string }] : []))
      .filter((u) => !seen.has(u.text + u.createdAt)),
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const goals = parse<string>(keys.get('pendingGoals')) ?? parse<{ goals: string }>(keys.get('goals'))?.goals;
  const status = parse<OldStatus>(keys.get('status'));
  const schedules = parse<{ schedules: Schedule[] }>(keys.get('schedules'))?.schedules ?? [];

  store.transaction(() => {
    for (const brief of briefs) store.importBrief(brief);
    for (const update of updates) store.addLedgerEntry(update.text, update.createdAt);
    if (goals?.trim()) store.setSetting('goals', goals);
    if (status?.selectedToolkits?.length) store.setSetting('selected_toolkits', JSON.stringify(status.selectedToolkits));
    if (status?.timezone) store.setSetting('timezone', status.timezone);
    for (const s of schedules) store.addSchedule({ kind: s.kind, time: s.time, days: s.days, timezone: s.timezone, enabled: s.enabled });
    store.setSetting(DONE, new Date().toISOString());
  });
  if (old.openRouterKey && !store.getSecret('openrouter')) store.setSecret('openrouter', old.openRouterKey);
  return { imported: true, briefs: briefs.length, updates: updates.length };
}

/** The old keys, which the app removes once they've been imported. */
export const isOldKey = (key: string) => key.startsWith(PREFIX);
