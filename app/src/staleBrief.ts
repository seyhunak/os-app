import type { Brief } from './api';

/** The calendar day on this device, as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when the brief was written on an earlier calendar day than `now`, in local time. */
export function isStale(createdAt: string, now: Date): boolean {
  return localDay(new Date(createdAt)) < localDay(now);
}

export type Freshness = 'none' | 'fresh' | 'stale-online' | 'stale-offline';

/** What the Today screen should do about the newest brief. */
export function freshness(latest: Pick<Brief, 'createdAt'> | undefined, online: boolean, now: Date): Freshness {
  if (!latest) return 'none';
  if (!isStale(latest.createdAt, now)) return 'fresh';
  return online ? 'stale-online' : 'stale-offline';
}

/** After a failed attempt, wait this long before trying again on its own. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export interface AutoBriefOptions {
  /** Asks the server for today's brief. The server returns the existing one if today's already exists. */
  generate(): Promise<Brief>;
  now?(): Date;
}

/**
 * Starts today's brief at most once per day, however often the screen renders or reopens.
 * One of these lives per server connection, so remounting the Today screen keeps the guard.
 */
export function createAutoBrief({ generate, now = () => new Date() }: AutoBriefOptions) {
  let inFlight: Promise<Brief> | null = null;
  let doneDay: string | null = null;
  let failedAt = 0;

  return {
    /**
     * Returns the running or newly started request when today's brief is needed, or null when
     * nothing should happen: the newest brief is today's, there's none at all, the app is
     * offline, today's was already written, or a recent attempt failed.
     */
    maybeGenerate(latest: Pick<Brief, 'createdAt'> | undefined, online: boolean): Promise<Brief> | null {
      if (inFlight) return inFlight;
      const at = now();
      if (freshness(latest, online, at) !== 'stale-online') return null;
      if (doneDay === localDay(at)) return null;
      if (at.getTime() - failedAt < RETRY_AFTER_FAILURE_MS) return null;
      inFlight = generate().then(
        (brief) => {
          doneDay = localDay(at);
          return brief;
        },
        (error) => {
          failedAt = now().getTime();
          throw error;
        },
      ).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    /** The request in progress, if any. A remounted screen uses it to show "generating…". */
    pending: () => inFlight,
  };
}

export type AutoBrief = ReturnType<typeof createAutoBrief>;

const perApi = new WeakMap<object, AutoBrief>();

/** The guard for this connection, created on first use. */
export function autoBriefFor(api: { generateTodayBrief(kind: 'morning'): Promise<Brief> }): AutoBrief {
  let auto = perApi.get(api);
  if (!auto) {
    auto = createAutoBrief({ generate: () => api.generateTodayBrief('morning') });
    perApi.set(api, auto);
  }
  return auto;
}
