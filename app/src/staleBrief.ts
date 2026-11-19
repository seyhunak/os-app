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

export type Freshness = 'none' | 'fresh' | 'stale';

type Dated = Pick<Brief, 'createdAt'>;

/** What the Today screen should do about the newest brief. Briefs are newest first. */
export function freshness(briefs: Dated[], now: Date): Freshness {
  if (!briefs.length) return 'none';
  return isStale(briefs[0]!.createdAt, now) ? 'stale' : 'fresh';
}

/** After a failed attempt, wait this long before trying again on its own. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export interface AutoBriefOptions {
  /** Writes today's brief: the one a schedule is due for, or else a morning brief. */
  generate(): Promise<Brief>;
  now?(): Date;
}

/**
 * Starts today's brief at most once per day, however often the screen renders or reopens.
 * One of these lives for the app's lifetime, so remounting the Today screen keeps the guard.
 */
export function createAutoBrief({ generate, now = () => new Date() }: AutoBriefOptions) {
  let inFlight: Promise<Brief> | null = null;
  let doneDay: string | null = null;
  let failedAt = 0;

  return {
    /**
     * Returns the running or newly started request when today's brief is needed, or null when
     * nothing should happen: there's already one for today, there are no briefs at all yet,
     * today's was already written, or a recent attempt failed.
     */
    maybeGenerate(briefs: Dated[]): Promise<Brief> | null {
      if (inFlight) return inFlight;
      const at = now();
      if (freshness(briefs, at) !== 'stale') return null;
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

/** The guard for this app, created on first use. */
export function autoBriefFor(api: { generateTodayBrief(kind: 'morning'): Promise<Brief> }): AutoBrief {
  let auto = perApi.get(api);
  if (!auto) {
    auto = createAutoBrief({ generate: () => api.generateTodayBrief('morning') });
    perApi.set(api, auto);
  }
  return auto;
}
