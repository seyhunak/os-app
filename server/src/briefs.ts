import { toolkitBySlug } from './collectors.ts';
import { RateLimitError, type ComposioGateway, type ConnectedAccount } from './composio.ts';
import { describeComposeError, extractNote, extractSourceSummaries, renderDigest, renderSources, SOURCES_MARKER, STATUS_LABEL, type Composer } from './compose.ts';
import type { Brief, Kind, SourceReport, Store } from './db.ts';
import { redact, redactDeep } from './redact.ts';

export interface BriefDeps {
  store: Store;
  gateway(): ComposioGateway | null;
  accounts(gateway: ComposioGateway, fresh: boolean): Promise<ConnectedAccount[]>;
  composer(): Composer | null;
  now?(): Date;
}

export interface GenerateOptions {
  kind: Kind;
  trigger: Brief['trigger'];
  timezone?: string;
  refresh?: boolean;
}

export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** How far back and how many of the user's updates each brief reads. */
const LEDGER_DAYS = 14;
const LEDGER_ENTRIES = 50;
/** How long to wait before calling a failing tool again. Refetch skips the wait. */
const FAILURE_RETRY_MS = 3_600_000;

export const selectedToolkits = (store: Store): string[] => JSON.parse(store.getSetting('selected_toolkits') ?? '[]');

export class BriefService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BriefDeps) {}

  /** Runs one at a time, so a schedule firing during a manual run can't spend the pull budget twice. */
  generate(options: GenerateOptions): Promise<Brief> {
    const run = this.queue.then(() => this.run(options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Writes a brief only if none exists yet for today in the user's timezone; otherwise returns today's.
   * It waits in the same queue, so two apps opening at once get one brief and one set of pulls.
   */
  generateIfStale(options: GenerateOptions): Promise<{ brief: Brief; created: boolean }> {
    const run = this.queue.then(async () => {
      const today = this.todaysBrief(options.timezone);
      return today ? { brief: today, created: false } : { brief: await this.run(options), created: true };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private todaysBrief(timezone?: string): Brief | null {
    const { store } = this.deps;
    const latest = store.latestBrief();
    if (!latest) return null;
    const zone = timezone ?? store.getSetting('timezone') ?? 'UTC';
    const now = this.deps.now?.() ?? new Date();
    return localDate(new Date(latest.createdAt), zone) === localDate(now, zone) ? latest : null;
  }

  private async run({ kind, trigger, timezone, refresh }: GenerateOptions): Promise<Brief> {
    const { store } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const zone = timezone ?? store.getSetting('timezone') ?? 'UTC';
    const date = localDate(now, zone);
    store.pruneCache();

    const { facts, sources } = await this.gather(kind, date, now, zone, Boolean(refresh));
    for (const source of sources) {
      source.label = STATUS_LABEL[source.status];
      const items = (facts[source.toolkit] ?? []) as Array<Record<string, unknown>>;
      const read = source.status === 'live' || source.status === 'cache';
      source.summary = items.length ? toolkitBySlug(source.toolkit)!.summarize(items, zone) : read ? 'Nothing to report.' : '';
    }
    const input = {
      kind,
      date,
      timezone: zone,
      goals: store.getSetting('goals') ?? '',
      previousNote: extractNote(store.latestBrief()?.markdown),
      updates: store.listLedger(LEDGER_ENTRIES, new Date(now.getTime() - LEDGER_DAYS * 86_400_000).toISOString()).reverse().map((entry) => ({
        at: new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt)),
        text: entry.text,
      })),
      facts,
      sources,
    };

    let body: string;
    let generator: Brief['generator'] = 'digest';
    const composer = this.deps.composer();
    if (composer) {
      try {
        body = await composer(input);
        generator = 'ai';
      } catch (error) {
        body = renderDigest(input, `${describeComposeError(error)}, so this brief was not ranked`);
      }
    } else {
      body = renderDigest(input, 'no OpenRouter key is set');
    }

    const { body: rest, summaries } = extractSourceSummaries(body);
    for (const source of sources) {
      const written = source.items ? summaries.get(source.name.toLowerCase()) : undefined;
      if (written) source.summary = written;
      source.summary = redact(source.summary ?? '');
    }
    body = rest;

    const table = renderSources(sources);
    const markdown = redact(body.includes(SOURCES_MARKER) ? body.replace(SOURCES_MARKER, () => table) : `${body}\n\n### Sources\n${table}`);
    return store.addBrief({ kind, trigger, generator, markdown, sources }, now);
  }

  /** The skill's budget: one live pull per toolkit per day, evenings never pull, a 429 stops that toolkit for the day. */
  private async gather(kind: Kind, date: string, now: Date, timeZone: string, refresh: boolean) {
    const { store } = this.deps;
    const gateway = this.deps.gateway();
    const facts: Record<string, unknown[]> = {};
    const sources: SourceReport[] = [];
    const slugs = selectedToolkits(store);

    // Asked for only when a tool really needs reading, so a fully cached brief makes no Composio calls at all.
    let accountList: ReturnType<BriefDeps['accounts']> | null = null;
    const accounts = () => (accountList ??= this.deps.accounts(gateway!, refresh));

    for (const slug of slugs) {
      const toolkit = toolkitBySlug(slug);
      if (!toolkit) continue;
      const report = (status: SourceReport['status'], items = 0, detail?: string) =>
        sources.push({ toolkit: slug, name: toolkit.name, status, items, ...(detail ? { detail } : {}) });
      const kept = (items: unknown[]) => toolkit.keep?.(items, now, timeZone) ?? items;

      const cached = store.getPull(date, slug);
      if (cached?.status === 'rate_limited') {
        report('rate_limited');
        continue;
      }
      const refetching = refresh && kind === 'morning';
      if (cached?.status === 'ok' && !refetching) {
        facts[slug] = kept(cached.items);
        report('cache', facts[slug].length, cached.detail);
        continue;
      }
      // A failing tool is left alone for a while, instead of being called again by every brief.
      if (cached?.status === 'failed' && !refetching && (kind === 'evening' || now.getTime() - Date.parse(cached.fetchedAt!) < FAILURE_RETRY_MS)) {
        report('error', 0, cached.detail);
        continue;
      }
      if (kind === 'evening') {
        report('no_cache');
        continue;
      }
      if (!gateway) {
        report('not_connected', 0, 'Composio is not set up');
        continue;
      }
      let owned: ConnectedAccount[] = [];
      if (!toolkit.noAuth) {
        try {
          owned = (await accounts()).filter((a) => a.toolkit === slug);
        } catch (error) {
          report('error', 0, redact(error instanceof Error ? error.message : String(error)).slice(0, 160));
          continue;
        }
        if (!owned.length) {
          report('not_connected');
          continue;
        }
      }

      const items: unknown[] = [];
      const failures: string[] = [];
      let rateLimited = false;
      for (const account of toolkit.noAuth ? [null] : owned) {
        try {
          items.push(...redactDeep(await toolkit.collect(gateway, account, now, timeZone)));
        } catch (error) {
          if (error instanceof RateLimitError) {
            rateLimited = true;
            break;
          }
          failures.push(redact(error instanceof Error ? error.message : String(error)).slice(0, 160));
        }
      }

      if (rateLimited) {
        store.savePull(date, slug, { status: 'rate_limited', items: [] }, now);
        report('rate_limited', kept(items).length);
        if (items.length) facts[slug] = kept(items);
      } else if (failures.length && !items.length) {
        const detail = failures.join('; ');
        if (cached?.status === 'ok') {
          // A failed refetch keeps the data from earlier today.
          facts[slug] = kept(cached.items);
          report('cache', facts[slug].length, `Refetch failed: ${detail}`);
        } else {
          store.savePull(date, slug, { status: 'failed', items: [], detail }, now);
          report('error', 0, detail);
        }
      } else {
        const detail = failures.length ? `Some accounts failed: ${failures.join('; ')}` : undefined;
        store.savePull(date, slug, { status: 'ok', items, ...(detail ? { detail } : {}) }, now);
        facts[slug] = kept(items);
        report('live', facts[slug].length, detail);
      }
    }
    return { facts, sources };
  }
}
