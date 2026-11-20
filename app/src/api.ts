import type { Os } from './core/os';

export type Kind = 'morning' | 'afternoon' | 'evening' | 'night';

export type Provider = 'openrouter';

export interface ModelOption {
  id: string;
  note: string | null;
  /** Cheap, and known to write a good brief. */
  recommended?: boolean;
  /** Dollars per million tokens, in plus out. */
  price?: number;
}

export interface Status {
  composio: 'saved' | null;
  openrouter: 'saved' | null;
  composioHint: string | null;
  openrouterHint: string | null;
  provider?: Provider;
  openrouterModel?: string;
  model: string;
  timezone: string | null;
  selectedToolkits: string[];
  hasBriefs: boolean;
  hasSchedules: boolean;
}

export interface Toolkit {
  slug: string;
  name: string;
  description: string;
  noAuth: boolean;
  selected: boolean;
  accounts: number;
}

export interface Source {
  toolkit: string;
  name: string;
  status: string;
  items: number;
  detail?: string;
  label?: string;
  /** A sentence or two about what was read. */
  summary?: string;
  /** Older briefs saved items instead of a summary. */
  contents?: string[];
}

export interface Brief {
  id: number;
  kind: Kind;
  /** 'offline': written on the phone while the old Mac server was out of reach. */
  trigger: 'manual' | 'schedule' | 'offline';
  generator: 'ai' | 'digest';
  markdown: string;
  sources: Source[];
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
  nextRun: string | null;
}

export interface LedgerEntry {
  id: number;
  text: string;
  createdAt: string;
}

export type ScheduleInput = Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>;

/** Everything the app does, run on this phone. */
export type Api = Os;

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Where Composio's docs say to get a key: Settings, then Project Settings, then API Keys. */
export const COMPOSIO_URL = 'https://composio.dev';
