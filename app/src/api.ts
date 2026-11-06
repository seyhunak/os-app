import type { Connection } from './storage';

export type Kind = 'morning' | 'evening';

export interface Status {
  composio: 'environment' | 'saved' | null;
  openrouter: 'environment' | 'saved' | null;
  composioHint: string | null;
  openrouterHint: string | null;
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
  contents?: string[];
}

export interface Brief {
  id: number;
  kind: Kind;
  trigger: 'manual' | 'schedule';
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

export function createApi({ url, token }: Connection) {
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    const unreachable = () => new ApiError(`Can't reach your OS server at ${url}. Check that it's running.`, 0);
    // Reads give up quickly so an outage shows saved content. Writing a brief can legitimately take a while.
    const controller = new AbortController();
    const timer = method === 'GET' ? setTimeout(() => controller.abort(), READ_TIMEOUT_MS) : null;
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
    saveComposioKey: (apiKey: string) => request('/credentials/composio', 'PUT', { apiKey }),
    saveOpenRouterKey: (apiKey: string) => request('/credentials/openrouter', 'PUT', { apiKey }),
    removeCredential: (name: 'composio' | 'openrouter') => request(`/credentials/${name}`, 'DELETE'),
    toolkits: (fresh = false) => request<{ toolkits: Toolkit[]; error: string | null; needsAuth: boolean }>(`/toolkits${fresh ? '?fresh=1' : ''}`),
    selectToolkits: (slugs: string[]) => request('/toolkits/selection', 'PUT', { slugs }),
    connectToolkit: (slug: string) => request<{ redirectUrl: string | null }>(`/toolkits/${slug}/connect`, 'POST'),
    goals: () => request<{ goals: string }>('/goals'),
    saveGoals: (goals: string) => request('/goals', 'PUT', { goals }),
    saveTimezone: (timezone: string) => request('/settings/timezone', 'PUT', { timezone }),
    ledger: () => request<{ entries: LedgerEntry[] }>('/ledger'),
    addUpdate: (text: string, meta?: { clientId: string; createdAt: string }) => request<LedgerEntry>('/ledger', 'POST', { text, ...meta }),
    briefs: () => request<{ briefs: Brief[] }>('/briefs'),
    generateBrief: (kind: Kind, refresh = false) => request<Brief>('/briefs', 'POST', { kind, refresh }),
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
