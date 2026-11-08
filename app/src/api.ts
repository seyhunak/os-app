import type { Connection } from './storage';
import type { BriefPrompt } from './offlineBrief';

export type Kind = 'morning' | 'evening';

export type Provider = 'openrouter' | 'ollama';

export interface ModelOption {
  id: string;
  note: string | null;
  cloud: boolean;
}

export interface Status {
  /** Missing from a status saved before servers reported it. */
  machine?: string;
  composio: 'environment' | 'saved' | null;
  openrouter: 'environment' | 'saved' | null;
  composioHint: string | null;
  openrouterHint: string | null;
  /** The rest are missing from a status saved before servers reported them. */
  provider?: Provider;
  ollama?: 'environment' | 'saved' | null;
  ollamaHint?: string | null;
  openrouterModel?: string;
  ollamaModel?: string;
  ollamaUrl?: string;
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
  /** 'offline': written on a phone while the server was out of reach. */
  trigger: 'manual' | 'schedule' | 'offline';
  /** An offline draft that hasn't reached the server yet. */
  pending?: boolean;
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
  /** Written while offline, and not on your server yet. */
  pending?: boolean;
}

export interface BriefDraft {
  clientId: string;
  kind: Kind;
  generator: Brief['generator'];
  markdown: string;
  sources: Source[];
  createdAt: string;
}

export type ScheduleInput = Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[::1\]|.*\.local$)/;

/** Returns a cleaned URL, or throws if the token would cross the internet unencrypted. */
export function normalizeServerUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    throw new Error("That doesn't look like a server address.");
  }
  if (url.protocol === 'http:' && !LOCAL_HOST.test(url.hostname)) {
    throw new Error('Use https for a server outside your own network, so your token stays private.');
  }
  return url.origin;
}

const READ_TIMEOUT_MS = 10_000;
/** How long the app waits for your Mac before showing saved content instead. */
export const PROBE_TIMEOUT_MS = 3_000;
/** Queued changes are safe to resend, so their sends give up rather than hang on a dead tunnel. */
export const SEND_TIMEOUT_MS = 8_000;

export function createApi({ url, token }: Connection) {
  async function request<T>(path: string, method = 'GET', body?: unknown, timeoutMs = method === 'GET' ? READ_TIMEOUT_MS : 0): Promise<T> {
    let response: Response;
    const unreachable = () => new ApiError(`Can't reach your OS server at ${url}. Check that it's running.`, 0);
    // Reads give up quickly so an outage shows saved content. Writing a brief can legitimately take a while.
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      response = await fetch(`${url}/api${path}`, {
        method,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw unreachable();
    } finally {
      if (timer) clearTimeout(timer);
    }
    // Tailscale answers with these when the Mac is reachable but OS isn't running.
    if (response.status === 502 || response.status === 503 || response.status === 504) throw unreachable();
    const data = await response.json().catch(() => null);
    if (response.ok && data === null) throw unreachable();
    if (!response.ok) throw new ApiError(data?.error ?? `The server returned an error (${response.status}).`, response.status);
    return data as T;
  }

  return {
    status: () => request<Status>('/status'),
    /** A quick reachability check: gives up after `timeoutMs`, so a dead tunnel can't hold up the app. */
    ping: (timeoutMs = PROBE_TIMEOUT_MS) => request<Status>('/status', 'GET', undefined, timeoutMs),
    saveComposioKey: (apiKey: string) => request('/credentials/composio', 'PUT', { apiKey }),
    saveOpenRouterKey: (apiKey: string) => request('/credentials/openrouter', 'PUT', { apiKey }),
    saveOllamaKey: (apiKey: string) => request('/credentials/ollama', 'PUT', { apiKey }),
    removeCredential: (name: 'composio' | 'openrouter' | 'ollama') => request(`/credentials/${name}`, 'DELETE'),
    saveAi: (input: { provider: Provider; model: string; ollamaUrl?: string }) => request('/ai', 'PUT', input),
    aiModels: (provider: Provider, url?: string) => request<{ models: ModelOption[]; error: string | null }>(`/ai/models?provider=${provider}${url ? `&url=${encodeURIComponent(url)}` : ''}`),
    toolkits: (fresh = false) => request<{ toolkits: Toolkit[]; error: string | null; needsAuth: boolean }>(`/toolkits${fresh ? '?fresh=1' : ''}`),
    selectToolkits: (slugs: string[]) => request('/toolkits/selection', 'PUT', { slugs }),
    connectToolkit: (slug: string) => request<{ redirectUrl: string | null }>(`/toolkits/${slug}/connect`, 'POST'),
    goals: () => request<{ goals: string }>('/goals'),
    saveGoals: (goals: string) => request('/goals', 'PUT', { goals }, SEND_TIMEOUT_MS),
    saveTimezone: (timezone: string) => request('/settings/timezone', 'PUT', { timezone }),
    ledger: () => request<{ entries: LedgerEntry[] }>('/ledger'),
    addUpdate: (text: string, meta?: { clientId: string; createdAt: string }) => request<LedgerEntry>('/ledger', 'POST', { text, ...meta }, meta ? SEND_TIMEOUT_MS : 0),
    /** Hides briefs from every list. They stay in the server's database. */
    briefPrompt: () => request<BriefPrompt>('/brief-prompt'),
    /** Saves a brief written offline. The client id makes a resend return the one already saved. */
    importBrief: (draft: BriefDraft) => request<Brief>('/briefs/import', 'POST', draft, SEND_TIMEOUT_MS),
    archiveBriefs: (ids: number[]) => request<{ archived: number }>('/briefs/archive', 'POST', { ids }, SEND_TIMEOUT_MS),
    briefs: () => request<{ briefs: Brief[] }>('/briefs'),
    generateBrief: (kind: Kind, refresh = false) => request<Brief>('/briefs', 'POST', { kind, refresh }),
    /** Writes today's first brief, unless one from today already exists, in which case the server returns that. */
    generateTodayBrief: (kind: Kind) => request<Brief>('/briefs', 'POST', { kind, ifStale: true }),
    schedules: () => request<{ schedules: Schedule[] }>('/schedules'),
    createSchedule: (input: ScheduleInput) => request<Schedule>('/schedules', 'POST', input),
    updateSchedule: (id: number, input: ScheduleInput) => request<Schedule>(`/schedules/${id}`, 'PUT', input),
    deleteSchedule: (id: number) => request(`/schedules/${id}`, 'DELETE'),
  };
}

export type Api = ReturnType<typeof createApi>;

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Where Composio's docs say to get a key: Settings, then Project Settings, then API Keys. */
export const COMPOSIO_URL = 'https://composio.dev';
