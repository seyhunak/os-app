import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type Kind = 'morning' | 'evening';

export interface SourceReport {
  toolkit: string;
  name: string;
  status: 'live' | 'cache' | 'rate_limited' | 'error' | 'not_connected' | 'no_cache';
  items: number;
  detail?: string;
  /** Plain words for the status, as shown in the source table. */
  label?: string;
  /** One line for each thing read from this source, so you can see what the brief drew on. */
  contents?: string[];
}

export interface Brief {
  id: number;
  kind: Kind;
  trigger: 'manual' | 'schedule';
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

const CACHE_DAYS = 7;
type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string, private readonly encryptionKey: Buffer) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS pulls (
        date TEXT NOT NULL, toolkit TEXT NOT NULL, fetched_at TEXT NOT NULL,
        status TEXT NOT NULL, facts TEXT NOT NULL, detail TEXT,
        PRIMARY KEY (date, toolkit));
      CREATE TABLE IF NOT EXISTS briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, trigger TEXT NOT NULL,
        generator TEXT NOT NULL, markdown TEXT NOT NULL, sources TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, time TEXT NOT NULL, days TEXT NOT NULL,
        timezone TEXT NOT NULL, enabled INTEGER NOT NULL, last_run_at TEXT, last_status TEXT);
    `);
    this.migrateLedger();
  }

  /** Existing databases get the column that lets a device safely retry sending an update. */
  private migrateLedger(): void {
    const columns = this.db.prepare('PRAGMA table_info(ledger)').all() as Row[];
    if (!columns.some((column) => column.name === 'client_id')) this.db.exec('ALTER TABLE ledger ADD COLUMN client_id TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ledger_client_id ON ledger (client_id) WHERE client_id IS NOT NULL');
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getSecret(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM secrets WHERE key = ?').get(key) as Row | undefined;
    if (!row) return null;
    const blob = Buffer.from(row.value as Uint8Array);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
  }

  setSecret(key: string, value: string): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const blob = Buffer.concat([iv, cipher.getAuthTag(), body]);
    this.db.prepare('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, blob);
  }

  deleteSecret(key: string): void {
    this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key);
  }

  getPull(date: string, toolkit: string): CachedPull | null {
    const row = this.db.prepare('SELECT status, facts, detail, fetched_at FROM pulls WHERE date = ? AND toolkit = ?').get(date, toolkit) as Row | undefined;
    if (!row) return null;
    return {
      status: row.status as CachedPull['status'],
      items: JSON.parse(String(row.facts)),
      fetchedAt: String(row.fetched_at),
      ...(row.detail ? { detail: String(row.detail) } : {}),
    };
  }

  savePull(date: string, toolkit: string, pull: CachedPull, now = new Date()): void {
    this.db.prepare(`INSERT INTO pulls (date, toolkit, fetched_at, status, facts, detail) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, toolkit) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, facts = excluded.facts, detail = excluded.detail`)
      .run(date, toolkit, now.toISOString(), pull.status, JSON.stringify(pull.items), pull.detail ?? null);
  }

  /** Cached pulls hold email snippets, so they don't stay on disk indefinitely. */
  pruneCache(): void {
    const cutoff = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString().slice(0, 10);
    this.db.prepare('DELETE FROM pulls WHERE date < ?').run(cutoff);
  }

  addBrief(brief: Omit<Brief, 'id' | 'createdAt'>): Brief {
    const createdAt = new Date().toISOString();
    const result = this.db.prepare('INSERT INTO briefs (kind, trigger, generator, markdown, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(brief.kind, brief.trigger, brief.generator, brief.markdown, JSON.stringify(brief.sources), createdAt);
    return { ...brief, id: Number(result.lastInsertRowid), createdAt };
  }

  listBriefs(limit = 30): Brief[] {
    return (this.db.prepare('SELECT * FROM briefs ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map(toBrief);
  }

  getBrief(id: number): Brief | null {
    const row = this.db.prepare('SELECT * FROM briefs WHERE id = ?').get(id) as Row | undefined;
    return row ? toBrief(row) : null;
  }

  latestBrief(): Brief | null {
    return this.listBriefs(1)[0] ?? null;
  }

  /** Append-only: entries are never edited or removed. */
  addLedgerEntry(text: string, options: { clientId?: string; createdAt?: string } = {}): LedgerEntry {
    if (options.clientId) {
      // A device retrying after a lost reply gets the entry it already created.
      const existing = this.db.prepare('SELECT * FROM ledger WHERE client_id = ?').get(options.clientId) as Row | undefined;
      if (existing) return { id: Number(existing.id), text: String(existing.text), createdAt: String(existing.created_at) };
    }
    const createdAt = options.createdAt ?? new Date().toISOString();
    const result = this.db.prepare('INSERT INTO ledger (text, created_at, client_id) VALUES (?, ?, ?)').run(text, createdAt, options.clientId ?? null);
    return { id: Number(result.lastInsertRowid), text, createdAt };
  }

  /** Newest first. */
  listLedger(limit = 30, since?: string): LedgerEntry[] {
    const rows = this.db.prepare('SELECT * FROM ledger WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?').all(since ?? '', limit) as Row[];
    return rows.map((row) => ({ id: Number(row.id), text: String(row.text), createdAt: String(row.created_at) }));
  }

  listSchedules(): Schedule[] {
    return (this.db.prepare('SELECT * FROM schedules ORDER BY time, id').all() as Row[]).map(toSchedule);
  }

  getSchedule(id: number): Schedule | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Row | undefined;
    return row ? toSchedule(row) : null;
  }

  addSchedule(s: Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>): Schedule {
    const result = this.db.prepare('INSERT INTO schedules (kind, time, days, timezone, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(s.kind, s.time, JSON.stringify(s.days), s.timezone, s.enabled ? 1 : 0);
    return this.getSchedule(Number(result.lastInsertRowid))!;
  }

  updateSchedule(id: number, s: Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>): Schedule | null {
    this.db.prepare('UPDATE schedules SET kind = ?, time = ?, days = ?, timezone = ?, enabled = ? WHERE id = ?')
      .run(s.kind, s.time, JSON.stringify(s.days), s.timezone, s.enabled ? 1 : 0, id);
    return this.getSchedule(id);
  }

  deleteSchedule(id: number): boolean {
    return this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0;
  }

  recordScheduleRun(id: number, status: string): void {
    this.db.prepare('UPDATE schedules SET last_run_at = ?, last_status = ? WHERE id = ?').run(new Date().toISOString(), status, id);
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
