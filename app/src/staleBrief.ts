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

type Dated = Pick<Brief, 'createdAt' | 'trigger'>;

/**
 * The brief that decides whether today's is needed. Online, an offline draft doesn't count,
 * because it never read your tools: the server should still write today's real one. Offline,
 * any brief counts, so the device writes at most one draft a day.
 */
export function relevantBrief<T extends Dated>(briefs: T[], online: boolean): T | undefined {
  return online ? briefs.find((b) => b.trigger !== 'offline') : briefs[0];
}

/** What the Today screen should do about the newest brief. Briefs are newest first. */
export function freshness(briefs: Dated[], online: boolean, now: Date): Freshness {
  if (!briefs.length) return 'none';
  const latest = relevantBrief(briefs, online);
  if (latest && !isStale(latest.createdAt, now)) return 'fresh';
  return online ? 'stale-online' : 'stale-offline';
}

/** After a failed attempt, wait this long before trying again on its own. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export interface AutoBriefOptions {
  /** Online: asks the server for today's brief. Offline: writes a draft on this device. */
  generate(online: boolean): Promise<Brief>;
  now?(): Date;
}

/**
 * Starts today's brief at most once per day for each mode, however often the screen renders or
 * reopens. So an offline morning gets one draft, and coming back online gets one real brief.
 * One of these lives per server connection, so remounting the Today screen keeps the guard.
 */
export function createAutoBrief({ generate, now = () => new Date() }: AutoBriefOptions) {
  let inFlight: Promise<Brief> | null = null;
  const doneDay: Record<'online' | 'offline', string | null> = { online: null, offline: null };
  const failedAt: Record<'online' | 'offline', number> = { online: 0, offline: 0 };

  return {
    /**
     * Returns the running or newly started request when today's brief is needed, or null when
     * nothing should happen: there's already one for today, there are no briefs at all yet,
     * today's was already written in this mode, or a recent attempt failed.
     */
    maybeGenerate(briefs: Dated[], online: boolean): Promise<Brief> | null {
      if (inFlight) return inFlight;
      const at = now();
      const mode = online ? 'online' : 'offline';
      const state = freshness(briefs, online, at);
      if (state === 'none' || state === 'fresh') return null;
      if (doneDay[mode] === localDay(at)) return null;
      if (at.getTime() - failedAt[mode] < RETRY_AFTER_FAILURE_MS) return null;
      inFlight = generate(online).then(
        (brief) => {
          doneDay[mode] = localDay(at);
          return brief;
        },
        (error) => {
          failedAt[mode] = now().getTime();
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
export function autoBriefFor(api: { generateTodayBrief(kind: 'morning'): Promise<Brief>; writeOfflineBrief(kind: 'morning'): Promise<Brief> }): AutoBrief {
  let auto = perApi.get(api);
  if (!auto) {
    auto = createAutoBrief({ generate: (online) => (online ? api.generateTodayBrief('morning') : api.writeOfflineBrief('morning')) });
    perApi.set(api, auto);
  }
  return auto;
}
