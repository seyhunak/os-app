import { toolkitBySlug } from './collectors';
import { weekStartOf, woopForBrief } from './woop';
import { RateLimitError, type ComposioGateway, type ConnectedAccount } from './composio';
import { compactNote, DEFAULT_ENERGY_PEAK, isEnergyPeak, describeComposeError, extractNote, extractSourceSummaries, renderDigest, renderSources, SOURCES_MARKER, STATUS_LABEL, type Composer, type OnProgress } from './compose';
import { neverPulls, type Brief, type Kind, type SourceReport, type Store } from './db';
import { redact, redactDeep } from './redact';

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
  /** Told each step as it happens, in plain words, for the progress view. */
  onProgress?: OnProgress;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** How far back and how many of the user's updates each brief reads. */
/**
 * Updates the last AI brief already read are carried by its note, so only newer ones are sent.
 * With no AI brief yet, the last day's. At most this many, each cut to this length, to keep the prompt small.
 */
const UPDATES_SENT = 10;
const UPDATE_CHARS = 280;
const FIRST_UPDATES_MS = 86_400_000;
/** How long to wait before calling a failing tool again. Refetch skips the wait. */
const FAILURE_RETRY_MS = 3_600_000;

type ProgressStateOf = Parameters<OnProgress>[0]['state'];

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
    // A phone's offline draft never read your tools, so it doesn't count as today's brief.
    const latest = store.listBriefs(30).find((b) => b.trigger !== 'offline');
    if (!latest) return null;
    const zone = timezone ?? store.getSetting('timezone') ?? 'UTC';
    const now = this.deps.now?.() ?? new Date();
    return localDate(new Date(latest.createdAt), zone) === localDate(now, zone) ? latest : null;
  }

  private async run({ kind, trigger, timezone, refresh, onProgress }: GenerateOptions): Promise<Brief> {
    const { store } = this.deps;
    const progress: OnProgress = (step) => {
      try {
        onProgress?.(step);
      } catch {
        // The progress view is a nicety; it never stops a brief.
      }
    };
    const now = this.deps.now?.() ?? new Date();
    const zone = timezone ?? store.getSetting('timezone') ?? 'UTC';
    const date = localDate(now, zone);
    store.pruneCache(now);

    progress({ key: 'goals', text: 'Reading your goals and recent updates', state: 'running' });
    // The weekly WOOP is the goal every brief ranks against.
    const goals = woopForBrief(store.woopForWeek(weekStartOf(now)));
    // A digest never read the updates, so the window starts at the last brief an AI wrote.
    const lastRanked = store.listBriefs(30).find((b) => b.generator === 'ai');
    const updates = store.listLedger(UPDATES_SENT, lastRanked?.createdAt ?? new Date(now.getTime() - FIRST_UPDATES_MS).toISOString()).reverse();
    progress({
      key: 'goals',
      text: goals ? `Read this week's WOOP and ${plural(updates.length, 'update')} ${lastRanked ? 'logged since your last brief' : 'from the last day'}` : "No WOOP this week, so nothing can be ranked against it. Set one in the Goals tab",
      state: goals ? 'done' : 'warn',
    });
    const previousNote = compactNote(extractNote(store.latestBrief()?.markdown));
    if (previousNote) progress({ key: 'note', text: 'Picking up the note your last brief left', state: 'done' });

    const { facts, sources } = await this.gather(kind, date, now, zone, Boolean(refresh), progress);
    for (const source of sources) {
      source.label = STATUS_LABEL[source.status];
      const items = (facts[source.toolkit] ?? []) as Array<Record<string, unknown>>;
      const read = source.status === 'live' || source.status === 'cache';
      source.summary = items.length ? toolkitBySlug(source.toolkit)!.summarize(items, zone) : read ? 'Nothing to report.' : '';
    }
    const input = {
      kind,
      date,
      time: new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
      weekday: new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' }).format(now),
      timezone: zone,
      energyPeak: ((peak) => (isEnergyPeak(peak) ? peak : DEFAULT_ENERGY_PEAK))(store.getSetting('energy_peak')),
      goals,
      previousNote,
      updates: updates.map((entry) => ({
        at: new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(entry.createdAt)),
        text: entry.text.length > UPDATE_CHARS ? `${entry.text.slice(0, UPDATE_CHARS)}…` : entry.text,
      })),
      facts,
      sources,
    };

    let body: string;
    let generator: Brief['generator'] = 'digest';
    const read = sources.reduce((n, s) => n + (facts[s.toolkit]?.length ?? 0), 0);
    const unranked = (error: unknown) => {
      progress({ key: 'digest', text: `Couldn't rank: ${describeComposeError(error)}. Writing an unranked digest instead`, state: 'warn' });
      return renderDigest(input, `${describeComposeError(error)}, so this brief was not ranked`);
    };
    // Whatever goes wrong with the AI, a brief is still written: an unranked digest of what was read.
    let composer: Composer | null = null;
    let setupError: unknown = null;
    try {
      composer = this.deps.composer();
    } catch (error) {
      setupError = error;
    }
    if (setupError) {
      body = unranked(setupError);
    } else if (composer) {
      progress({ key: 'weigh', text: `Handing ${plural(read, 'item')} and your goals to the AI, with secrets already stripped out`, state: 'done' });
      try {
        body = await composer(input, progress);
        if (!body?.trim()) throw new Error('the AI model returned an empty brief');
        generator = 'ai';
      } catch (error) {
        body = unranked(error);
      }
    } else {
      progress({ key: 'digest', text: 'No OpenRouter key, so writing an unranked digest of what was read', state: 'skip' });
      body = renderDigest(input, 'no OpenRouter key is set');
    }
    progress({ key: 'finish', text: 'Removing secrets and laying out the brief', state: 'running' });

    const { body: rest, summaries } = extractSourceSummaries(body);
    for (const source of sources) {
      const written = source.items ? summaries.get(source.name.toLowerCase()) : undefined;
      if (written) source.summary = written;
      source.summary = redact(source.summary ?? '');
    }
    body = rest;

    const table = renderSources(sources);
    const markdown = redact(body.includes(SOURCES_MARKER) ? body.replace(SOURCES_MARKER, () => table) : `${body}\n\n### Sources\n${table}`);
    const brief = store.addBrief({ kind, trigger, generator, markdown, sources }, now);
    progress({ key: 'finish', text: 'Brief ready', state: 'done' });
    return brief;
  }

  /**
   * The skill's budget: one live pull per toolkit per day, evening and night briefs never pull, a 429 stops that toolkit for the day.
   * An afternoon brief reads like a morning one: today's cache if there is one, a pull if there isn't.
   */
  private async gather(kind: Kind, date: string, now: Date, timeZone: string, refresh: boolean, progress: OnProgress) {
    const { store } = this.deps;
    const gateway = this.deps.gateway();
    const facts: Record<string, unknown[]> = {};
    const sources: SourceReport[] = [];
    const slugs = selectedToolkits(store);
    if (!slugs.length) progress({ key: 'tools', text: 'No tools selected, so there is nothing to scan', state: 'skip' });

    // Asked for only when a tool really needs reading, so a fully cached brief makes no Composio calls at all.
    let accountList: ReturnType<BriefDeps['accounts']> | null = null;
    const accounts = () => (accountList ??= this.deps.accounts(gateway!, refresh));

    for (const slug of slugs) {
      const toolkit = toolkitBySlug(slug);
      if (!toolkit) continue;
      const key = `tool:${slug}`;
      const name = toolkit.name;
      const report = (status: SourceReport['status'], items = 0, detail?: string) => {
        sources.push({ toolkit: slug, name, status, items, ...(detail ? { detail } : {}) });
        const found = items ? plural(items, 'item') : 'nothing new';
        const step: Record<SourceReport['status'], [string, ProgressStateOf]> = {
          live: [`Scanned ${name}: ${found} pulled fresh`, 'done'],
          cache: [`${name}: reusing today's copy, ${found}`, 'done'],
          rate_limited: [`${name} is rate limited today, so it was skipped${items ? ` after ${found}` : ''}`, 'warn'],
          error: [`${name} couldn't be read${detail ? `: ${detail}` : ''}`, 'warn'],
          not_connected: [`${name} isn't connected${detail ? ` (${detail})` : ''}`, 'skip'],
          no_cache: [`${name}: ${kind} briefs don't pull, and there's no copy from today`, 'skip'],
        };
        progress({ key, text: step[status][0], state: step[status][1] });
      };
      progress({ key, text: `Scanning ${name}…`, state: 'running' });
      const kept = (items: unknown[]) => toolkit.keep?.(items, now, timeZone) ?? items;

      const cached = store.getPull(date, slug);
      if (cached?.status === 'rate_limited') {
        report('rate_limited');
        continue;
      }
      const refetching = refresh && !neverPulls(kind);
      if (cached?.status === 'ok' && !refetching) {
        facts[slug] = kept(cached.items);
        report('cache', facts[slug].length, cached.detail);
        continue;
      }
      // A failing tool is left alone for a while, instead of being called again by every brief.
      if (cached?.status === 'failed' && !refetching && (neverPulls(kind) || now.getTime() - Date.parse(cached.fetchedAt!) < FAILURE_RETRY_MS)) {
        report('error', 0, cached.detail);
        continue;
      }
      if (neverPulls(kind)) {
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
