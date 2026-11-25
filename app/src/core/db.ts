import type { CheckIn, Woop, WoopInput, WoopResult } from './woop';

export type Kind = 'morning' | 'afternoon' | 'evening' | 'night';

/** Evening and night briefs reuse the day's data and never read your tools. */
export const neverPulls = (kind: Kind) => kind === 'evening' || kind === 'night';

export interface SourceReport {
  toolkit: string;
  name: string;
  status: 'live' | 'cache' | 'rate_limited' | 'error' | 'not_connected' | 'no_cache';
  items: number;
  detail?: string;
  /** Plain words for the status, as shown in the source table. */
  label?: string;
  /** A sentence or two about what was read. */
  summary?: string;
  /** Older briefs saved items instead of a summary. */
  contents?: string[];
}

export interface Brief {
  id: number;
  kind: Kind;
  /** 'offline' briefs came from the old server setup, written on a phone while the Mac was out of reach. */
  trigger: 'manual' | 'schedule' | 'offline';
  generator: 'ai' | 'digest';
  markdown: string;
  sources: SourceReport[];
  createdAt: string;
}

export interface LedgerEntry {
  id: number;
  text: string;
  createdAt: string;
}

export interface Schedule {
  id: number;
  kind: Kind;
  time: string;
  days: number[];
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

export interface CachedPull {
  status: 'ok' | 'rate_limited' | 'failed';
  items: unknown[];
  detail?: string;
  fetchedAt?: string;
}

type Row = Record<string, unknown>;
type Param = string | number | null;

/** The few SQLite calls the store makes. expo-sqlite backs it in the app, node:sqlite in tests. */
export interface Sql {
  exec(source: string): void;
  run(source: string, ...params: Param[]): { changes: number; lastInsertRowId: number };
  get(source: string, ...params: Param[]): Row | null;
  all(source: string, ...params: Param[]): Row[];
}

/** Where API keys live: the iOS Keychain or Android Keystore in the app, a Map in tests. */
export interface Secrets {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const CACHE_DAYS = 7;

export class Store {
  constructor(private readonly db: Sql, private readonly secrets: Secrets) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pulls (
        date TEXT NOT NULL, toolkit TEXT NOT NULL, fetched_at TEXT NOT NULL,
        status TEXT NOT NULL, facts TEXT NOT NULL, detail TEXT,
        PRIMARY KEY (date, toolkit));
      CREATE TABLE IF NOT EXISTS briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, trigger TEXT NOT NULL,
        generator TEXT NOT NULL, markdown TEXT NOT NULL, sources TEXT NOT NULL, created_at TEXT NOT NULL,
        archived_at TEXT);
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, time TEXT NOT NULL, days TEXT NOT NULL,
        timezone TEXT NOT NULL, enabled INTEGER NOT NULL, last_run_at TEXT, last_status TEXT);
      CREATE TABLE IF NOT EXISTS woops (
        id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL UNIQUE, wish TEXT NOT NULL,
        outcome TEXT NOT NULL, obstacle TEXT NOT NULL, obstacle_tag TEXT NOT NULL, cue TEXT NOT NULL,
        plan TEXT NOT NULL, created_at TEXT NOT NULL, result TEXT, review_note TEXT, reviewed_at TEXT);
      CREATE TABLE IF NOT EXISTS woop_checkins (
        woop_id INTEGER NOT NULL, date TEXT NOT NULL, progressed INTEGER NOT NULL,
        obstacle_hit INTEGER NOT NULL, plan_used INTEGER NOT NULL, PRIMARY KEY (woop_id, date));
    `);
  }

  getSetting(key: string): string | null {
    const row = this.db.get('SELECT value FROM settings WHERE key = ?', key);
    return row ? String(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  deleteSetting(key: string): void {
    this.db.run('DELETE FROM settings WHERE key = ?', key);
  }

  getSecret(key: string): string | null {
    return this.secrets.get(key);
  }

  setSecret(key: string, value: string): void {
    this.secrets.set(key, value);
  }

  deleteSecret(key: string): void {
    this.secrets.delete(key);
  }

  getPull(date: string, toolkit: string): CachedPull | null {
    const row = this.db.get('SELECT status, facts, detail, fetched_at FROM pulls WHERE date = ? AND toolkit = ?', date, toolkit);
    if (!row) return null;
    return {
      status: row.status as CachedPull['status'],
      items: JSON.parse(String(row.facts)),
      fetchedAt: String(row.fetched_at),
      ...(row.detail ? { detail: String(row.detail) } : {}),
    };
  }

  savePull(date: string, toolkit: string, pull: CachedPull, now = new Date()): void {
    this.db.run(`INSERT INTO pulls (date, toolkit, fetched_at, status, facts, detail) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, toolkit) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, facts = excluded.facts, detail = excluded.detail`,
    date, toolkit, now.toISOString(), pull.status, JSON.stringify(pull.items), pull.detail ?? null);
  }

  /** Cached pulls hold email snippets, so they don't stay on the phone indefinitely. */
  pruneCache(now = new Date()): void {
    const cutoff = new Date(now.getTime() - CACHE_DAYS * 86_400_000).toISOString().slice(0, 10);
    this.db.run('DELETE FROM pulls WHERE date < ?', cutoff);
  }

  addBrief(brief: Omit<Brief, 'id' | 'createdAt'>, now = new Date()): Brief {
    const createdAt = now.toISOString();
    const result = this.db.run('INSERT INTO briefs (kind, trigger, generator, markdown, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      brief.kind, brief.trigger, brief.generator, brief.markdown, JSON.stringify(brief.sources), createdAt);
    return { ...brief, id: result.lastInsertRowId, createdAt };
  }

  listBriefs(limit = 30): Brief[] {
    return this.db.all('SELECT * FROM briefs WHERE archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?', limit).map(toBrief);
  }

  /** Hides these briefs from every list. Unknown or already archived ids are skipped. */
  archiveBriefs(ids: number[], now = new Date()): number {
    return ids.reduce((count, id) => count + this.db.run('UPDATE briefs SET archived_at = ? WHERE id = ? AND archived_at IS NULL', now.toISOString(), id).changes, 0);
  }

  getBrief(id: number): Brief | null {
    const row = this.db.get('SELECT * FROM briefs WHERE id = ? AND archived_at IS NULL', id);
    return row ? toBrief(row) : null;
  }

  latestBrief(): Brief | null {
    return this.listBriefs(1)[0] ?? null;
  }

  /** Append-only: entries are never edited or removed. */
  addLedgerEntry(text: string, createdAt = new Date().toISOString()): LedgerEntry {
    const result = this.db.run('INSERT INTO ledger (text, created_at) VALUES (?, ?)', text, createdAt);
    return { id: result.lastInsertRowId, text, createdAt };
  }

  /** Newest first. */
  listLedger(limit = 30, since?: string): LedgerEntry[] {
    return this.db.all('SELECT * FROM ledger WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?', since ?? '', limit)
      .map((row) => ({ id: Number(row.id), text: String(row.text), createdAt: String(row.created_at) }));
  }

  listSchedules(): Schedule[] {
    return this.db.all('SELECT * FROM schedules ORDER BY time, id').map(toSchedule);
  }

  getSchedule(id: number): Schedule | null {
    const row = this.db.get('SELECT * FROM schedules WHERE id = ?', id);
    return row ? toSchedule(row) : null;
  }

  addSchedule(s: Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>): Schedule {
    const result = this.db.run('INSERT INTO schedules (kind, time, days, timezone, enabled) VALUES (?, ?, ?, ?, ?)',
      s.kind, s.time, JSON.stringify(s.days), s.timezone, s.enabled ? 1 : 0);
    return this.getSchedule(result.lastInsertRowId)!;
  }

  updateSchedule(id: number, s: Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>): Schedule | null {
    this.db.run('UPDATE schedules SET kind = ?, time = ?, days = ?, timezone = ?, enabled = ? WHERE id = ?',
      s.kind, s.time, JSON.stringify(s.days), s.timezone, s.enabled ? 1 : 0, id);
    return this.getSchedule(id);
  }

  deleteSchedule(id: number): boolean {
    return this.db.run('DELETE FROM schedules WHERE id = ?', id).changes > 0;
  }

  recordScheduleRun(id: number, status: string, now = new Date()): void {
    this.db.run('UPDATE schedules SET last_run_at = ?, last_status = ? WHERE id = ?', now.toISOString(), status, id);
  }

  /** One WOOP a week. Saving it again for the same week edits it and keeps its check-ins. */
  saveWoop(weekStart: string, w: WoopInput, now = new Date()): Woop {
    this.db.run(`INSERT INTO woops (week_start, wish, outcome, obstacle, obstacle_tag, cue, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(week_start) DO UPDATE SET wish = excluded.wish, outcome = excluded.outcome, obstacle = excluded.obstacle,
        obstacle_tag = excluded.obstacle_tag, cue = excluded.cue, plan = excluded.plan`,
    weekStart, w.wish, w.outcome, w.obstacle, w.obstacleTag, w.cue, w.plan, now.toISOString());
    return this.woopForWeek(weekStart)!;
  }

  woopForWeek(weekStart: string): Woop | null {
    const row = this.db.get('SELECT * FROM woops WHERE week_start = ?', weekStart);
    return row ? toWoop(row) : null;
  }

  getWoop(id: number): Woop | null {
    const row = this.db.get('SELECT * FROM woops WHERE id = ?', id);
    return row ? toWoop(row) : null;
  }

  /** Newest week first. */
  listWoops(limit = 52): Woop[] {
    return this.db.all('SELECT * FROM woops ORDER BY week_start DESC LIMIT ?', limit).map(toWoop);
  }

  reviewWoop(id: number, result: WoopResult, note: string | null, now = new Date()): boolean {
    return this.db.run('UPDATE woops SET result = ?, review_note = ?, reviewed_at = ? WHERE id = ?', result, note, now.toISOString(), id).changes > 0;
  }

  deleteWoop(id: number): boolean {
    this.db.run('DELETE FROM woop_checkins WHERE woop_id = ?', id);
    return this.db.run('DELETE FROM woops WHERE id = ?', id).changes > 0;
  }

  /** One check-in a day. Checking in again that day replaces it. */
  saveCheckIn(c: CheckIn): void {
    this.db.run(`INSERT INTO woop_checkins (woop_id, date, progressed, obstacle_hit, plan_used) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(woop_id, date) DO UPDATE SET progressed = excluded.progressed, obstacle_hit = excluded.obstacle_hit, plan_used = excluded.plan_used`,
    c.woopId, c.date, c.progressed ? 1 : 0, c.obstacleHit ? 1 : 0, c.obstacleHit && c.planUsed ? 1 : 0);
  }

  listCheckIns(woopIds: number[]): CheckIn[] {
    if (!woopIds.length) return [];
    return this.db.all(`SELECT * FROM woop_checkins WHERE woop_id IN (${woopIds.map(() => '?').join(', ')}) ORDER BY date`, ...woopIds).map((row) => ({
      woopId: Number(row.woop_id),
      date: String(row.date),
      progressed: row.progressed === 1,
      obstacleHit: row.obstacle_hit === 1,
      planUsed: row.plan_used === 1,
    }));
  }

  /** Copies a brief over from the old server setup, keeping its original time. */
  importBrief(brief: Omit<Brief, 'id'>): void {
    this.db.run('INSERT INTO briefs (kind, trigger, generator, markdown, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      brief.kind, brief.trigger, brief.generator, brief.markdown, JSON.stringify(brief.sources), brief.createdAt);
  }

  /** Removes everything OS keeps on this phone: every table's rows and both keys. */
  eraseAll(): void {
    this.db.exec('DELETE FROM settings; DELETE FROM pulls; DELETE FROM briefs; DELETE FROM ledger; DELETE FROM schedules; DELETE FROM woops; DELETE FROM woop_checkins;');
    this.secrets.delete('composio');
    this.secrets.delete('openrouter');
    // Erasing means starting over, not importing the old copy again.
    this.setSetting('migrated_from_server', new Date().toISOString());
  }

  /** Runs `fn` as one transaction, so an import either lands whole or not at all. */
  transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function toBrief(row: Row): Brief {
  return {
    id: Number(row.id),
    kind: row.kind as Kind,
    trigger: row.trigger as Brief['trigger'],
    generator: row.generator as Brief['generator'],
    markdown: String(row.markdown),
    sources: JSON.parse(String(row.sources)),
    createdAt: String(row.created_at),
  };
}

function toSchedule(row: Row): Schedule {
  return {
    id: Number(row.id),
    kind: row.kind as Kind,
    time: String(row.time),
    days: JSON.parse(String(row.days)),
    timezone: String(row.timezone),
    enabled: row.enabled === 1,
    lastRunAt: (row.last_run_at as string | null) ?? null,
    lastStatus: (row.last_status as string | null) ?? null,
  };
}

function toWoop(row: Row): Woop {
  return {
    id: Number(row.id),
    weekStart: String(row.week_start),
    wish: String(row.wish),
    outcome: String(row.outcome),
    obstacle: String(row.obstacle),
    obstacleTag: row.obstacle_tag as Woop['obstacleTag'],
    cue: row.cue as Woop['cue'],
    plan: String(row.plan),
    createdAt: String(row.created_at),
    result: (row.result as WoopResult | null) ?? null,
    reviewNote: (row.review_note as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
  };
}
