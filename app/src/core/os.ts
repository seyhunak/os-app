import { BriefService, selectedToolkits } from './briefs';
import { TOOLKITS, toolkitBySlug } from './collectors';
import type { ComposioGateway, ConnectedAccount } from './composio';
import { createComposer, DEFAULT_ENERGY_PEAK, DEFAULT_MODEL, isAllowedModel, isEnergyPeak, type EnergyPeak, describeComposeError, modelOptions, type AiConfig, type Composer, type ModelOption, type OnProgress } from './compose';
import type { Brief, Kind, Schedule, Store } from './db';
import { redact } from './redact';
import { dueSchedule, nextRun } from './schedule';
import {
  addDays, insights, isCue, isObstacleTag, isWoopResult, LIMITS, localDay, plansFromHistory, predictFromHistory, streak, suggestObstacles, suggestPlans,
  summarize, weekStartOf, woopReminders, type CheckIn, type ObstacleContext, type ObstacleSuggestion, type PlanContext, type PlanSuggestion,
  MAX_WISHES, wishesFromGoals, type WoopInput, type WoopReminder, type WoopResult,
} from './woop';

export interface OsDeps {
  store: Store;
  createGateway(apiKey: string): ComposioGateway;
  createComposer?(config: AiConfig): Composer;
  verifyOpenRouterKey?(apiKey: string): Promise<void>;
  /** Told whenever schedules change, so the phone can set its reminders again. */
  onSchedulesChanged?(schedules: Schedule[]): void;
  /** Predicts this week's obstacles. Defaults to OpenRouter. */
  suggestObstacles?(config: AiConfig, ctx: ObstacleContext): Promise<ObstacleSuggestion[]>;
  /** Writes stronger if-then plans. Defaults to OpenRouter. */
  suggestPlans?(config: AiConfig, ctx: PlanContext): Promise<PlanSuggestion[]>;
  /** Told whenever the WOOP reminders change, so the phone can set them again. */
  onWoopChanged?(reminders: WoopReminder[]): void;
  now?(): Date;
}

export type ScheduleInput = Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>;

/** A problem to show as is. Everything else is reported with a general message. */
export class OsError extends Error {}

const ACCOUNTS_TTL_MS = 86_400_000;
const KINDS: Kind[] = ['morning', 'afternoon', 'evening', 'night'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

function checkSchedule(input: ScheduleInput): ScheduleInput {
  if (!KINDS.includes(input.kind)) throw new OsError('Choose morning, afternoon, evening or night');
  if (!TIME.test(input.time)) throw new OsError('Use HH:MM');
  const days = [...new Set(input.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!days.length) throw new OsError('Choose at least one day');
  if (!validTimezone(input.timezone)) throw new OsError('Unknown timezone');
  return { ...input, days, enabled: input.enabled !== false };
}

const checkKey = (apiKey: string) => {
  const key = apiKey.trim();
  if (key.length < 8 || key.length > 512) throw new OsError("That doesn't look like an API key.");
  return key;
};

/**
 * Everything the old server did, run on this phone: keys in the Keychain, data in SQLite, and
 * your tools and the AI called directly. Composio and OpenRouter are the only services it talks to.
 */
export function createOs(deps: OsDeps) {
  const { store } = deps;
  const now = () => deps.now?.() ?? new Date();
  const composioKey = () => store.getSecret('composio');
  const openRouterKey = () => store.getSecret('openrouter');
  /** Your first model. A model saved before the list, such as a paid one, falls back to the default. */
  const openRouterModel = () => {
    const saved = store.getSetting('ai_model_openrouter');
    return saved && isAllowedModel(saved) ? saved : DEFAULT_MODEL;
  };
  const aiConfig = (): AiConfig | null => {
    const apiKey = openRouterKey();
    return apiKey ? { provider: 'openrouter', apiKey, model: openRouterModel() } : null;
  };
  const gateway = () => {
    const key = composioKey();
    return key ? deps.createGateway(key) : null;
  };
  /** The account list changes rarely, so it's reused for a day. Connecting a tool or "Check connections" asks again. */
  const accounts = async (g: ComposioGateway, fresh = false): Promise<ConnectedAccount[]> => {
    const at = now().getTime();
    const cached = store.getSetting('accounts_cache');
    if (cached && !fresh) {
      const saved = JSON.parse(cached) as { at: number; list: ConnectedAccount[] };
      if (at - saved.at < ACCOUNTS_TTL_MS) return saved.list;
    }
    const list = await g.listActiveAccounts();
    store.setSetting('accounts_cache', JSON.stringify({ at, list }));
    return list;
  };
  const forgetAccounts = () => store.deleteSetting('accounts_cache');
  const savedWishes = (): string[] => JSON.parse(store.getSetting('woop_wishes') ?? '[]') as string[];
  /**
   * Goals from before WOOP, the OKRs Settings kept or notes pasted at onboarding, become saved
   * wishes once, and stop being read by briefs. The weekly WOOP is the only goal now.
   */
  const moveOldGoals = () => {
    const list = store.getSetting('goals_list');
    const legacy = store.getSetting('goals');
    if (list === null && legacy === null) return;
    const old = list ? (JSON.parse(list) as string[]) : legacy?.trim() ? [legacy] : [];
    const merged = [...new Map([...savedWishes(), ...wishesFromGoals(old)].map((w) => [w.toLowerCase(), w])).values()].slice(0, MAX_WISHES);
    store.transaction(() => {
      store.setSetting('woop_wishes', JSON.stringify(merged));
      store.deleteSetting('goals_list');
      store.deleteSetting('goals');
    });
  };
  moveOldGoals();
  const lastFour = (key: string | null) => (key ? key.slice(-4) : null);

  const briefs = new BriefService({
    store,
    gateway,
    accounts,
    composer: () => {
      const config = aiConfig();
      return config ? (deps.createComposer ? deps.createComposer(config) : createComposer(config)) : null;
    },
    now,
  });

  const energyPeak = (): EnergyPeak => {
    const saved = store.getSetting('energy_peak');
    return isEnergyPeak(saved) ? saved : DEFAULT_ENERGY_PEAK;
  };
  /** Every past and present week, newest first, with its check-ins. */
  const woopHistory = () => {
    const woops = store.listWoops();
    const checkIns = store.listCheckIns(woops.map((w) => w.id));
    return { woops, checkIns, summaries: woops.map((w) => summarize(w, checkIns)) };
  };
  const currentWoop = () => store.woopForWeek(weekStartOf(now()));
  const woopChanged = () => deps.onWoopChanged?.(woopReminders(currentWoop(), energyPeak(), now(), store.listWoops(1).length > 0));
  const recentUpdates = () => store.listLedger(20, new Date(now().getTime() - 14 * 86_400_000).toISOString()).map((e) => e.text);
  const checkWoop = (input: WoopInput): WoopInput => {
    const clean = (text: unknown, max: number, name: string, required = true) => {
      const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
      if (required && !value) throw new OsError(`Write your ${name} first`);
      if (value.length > max) throw new OsError(`Keep your ${name} under ${max} characters`);
      return value;
    };
    if (!isObstacleTag(input.obstacleTag)) throw new OsError('Choose what kind of obstacle it is');
    if (!isCue(input.cue)) throw new OsError('Choose when it usually shows up');
    return {
      wish: clean(input.wish, LIMITS.wish, 'wish'),
      outcome: clean(input.outcome, LIMITS.outcome, 'outcome', false),
      obstacle: clean(input.obstacle, LIMITS.obstacle, 'obstacle'),
      obstacleTag: input.obstacleTag,
      cue: input.cue,
      plan: clean(input.plan, LIMITS.plan, 'plan'),
    };
  };

  const schedulesChanged = () => deps.onSchedulesChanged?.(store.listSchedules());
  const withNextRun = (s: Schedule) => ({ ...s, nextRun: nextRun(s, now())?.toISOString() ?? null });

  return {
    async status() {
      return {
        composio: composioKey() ? ('saved' as const) : null,
        openrouter: openRouterKey() ? ('saved' as const) : null,
        composioHint: lastFour(composioKey()),
        openrouterHint: lastFour(openRouterKey()),
        provider: 'openrouter' as const,
        model: openRouterModel(),
        openrouterModel: openRouterModel(),
        timezone: store.getSetting('timezone'),
        energyPeak: energyPeak(),
        selectedToolkits: selectedToolkits(store),
        hasBriefs: store.latestBrief() !== null,
        hasSchedules: store.listSchedules().length > 0,
      };
    },

    async saveComposioKey(apiKey: string) {
      const key = checkKey(apiKey);
      try {
        await deps.createGateway(key).verify();
      } catch {
        throw new OsError("Composio didn't accept that key, or couldn't be reached. Check the key and try again.");
      }
      store.setSecret('composio', key);
      forgetAccounts();
      return { composio: 'saved' as const };
    },

    async saveOpenRouterKey(apiKey: string) {
      const key = checkKey(apiKey);
      if (deps.verifyOpenRouterKey) {
        try {
          await deps.verifyOpenRouterKey(key);
        } catch {
          throw new OsError("OpenRouter didn't accept that key, or couldn't be reached. Check the key and try again.");
        }
      }
      store.setSecret('openrouter', key);
      return { openrouter: 'saved' as const };
    },

    async removeCredential(name: 'composio' | 'openrouter') {
      store.deleteSecret(name);
      if (name === 'composio') forgetAccounts();
      return { ok: true };
    },

    /** Chooses which of the listed models goes first. The others stay as fallbacks, in order. */
    async saveAi(model: string) {
      const id = model.trim();
      if (!isAllowedModel(id)) throw new OsError('Choose one of the listed models');
      store.setSetting('ai_model_openrouter', id);
      return { provider: 'openrouter' as const, model: id };
    },

    async aiModels(): Promise<{ models: ModelOption[]; error: string | null }> {
      return { models: modelOptions(), error: null };
    },

    async toolkits(fresh = false) {
      const g = gateway();
      let connected: ConnectedAccount[] = [];
      let error: string | null = null;
      let needsAuth = false;
      if (g) {
        try {
          connected = await accounts(g, fresh);
        } catch (failure) {
          needsAuth = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid.*key/i.test(failure instanceof Error ? failure.message : String(failure));
          error = needsAuth ? "Composio didn't accept your API key. Open Composio to get a new one." : "Couldn't reach Composio to check your connections";
        }
      }
      const selected = selectedToolkits(store);
      return {
        error,
        needsAuth,
        toolkits: TOOLKITS.map((t) => ({
          slug: t.slug,
          name: t.name,
          category: t.category,
          description: t.description,
          noAuth: Boolean(t.noAuth),
          selected: selected.includes(t.slug),
          accounts: t.noAuth ? 1 : connected.filter((a) => a.toolkit === t.slug).length,
        })),
      };
    },

    async selectToolkits(slugs: string[]) {
      const known = [...new Set(slugs)].filter((s) => toolkitBySlug(s));
      store.setSetting('selected_toolkits', JSON.stringify(known));
      return { selectedToolkits: known };
    },

    async connectToolkit(slug: string): Promise<{ redirectUrl: string | null }> {
      const toolkit = toolkitBySlug(slug);
      if (!toolkit) throw new OsError('Unknown tool');
      if (toolkit.noAuth) return { redirectUrl: null };
      const g = gateway();
      if (!g) throw new OsError('Connect Composio first');
      forgetAccounts();
      try {
        return await g.authorize(toolkit.slug);
      } catch {
        throw new OsError(`Composio couldn't start the ${toolkit.name} connection. You can also connect it at composio.dev.`);
      }
    },

    /** Wishes saved from your old goals, offered as one-tap picks when you start a WOOP. */
    async wishes() {
      return { wishes: savedWishes() };
    },
    async removeWish(index: number) {
      const list = savedWishes();
      if (list[index] === undefined) throw new OsError('Wish not found');
      store.setSetting('woop_wishes', JSON.stringify(list.filter((_, i) => i !== index)));
      return { wishes: savedWishes() };
    },

    async saveEnergyPeak(peak: EnergyPeak) {
      if (!isEnergyPeak(peak)) throw new OsError('Unknown energy peak');
      store.setSetting('energy_peak', peak);
      return { energyPeak: peak };
    },

    async saveTimezone(timezone: string) {
      if (!validTimezone(timezone)) throw new OsError('Unknown timezone');
      store.setSetting('timezone', timezone);
      return { timezone };
    },

    async ledger() {
      return { entries: store.listLedger() };
    },
    async addUpdate(text: string) {
      const value = text.trim();
      if (!value) throw new OsError('Write a short update first');
      if (value.length > 1000) throw new OsError('Keep updates under 1,000 characters');
      return store.addLedgerEntry(redact(value), now().toISOString());
    },

    async briefs() {
      return { briefs: store.listBriefs() };
    },
    async archiveBriefs(ids: number[]) {
      return { archived: store.archiveBriefs(ids, now()) };
    },
    generateBrief(kind: Kind, refresh = false, onProgress?: OnProgress): Promise<Brief> {
      return briefs.generate({ kind, trigger: 'manual', refresh, ...(onProgress ? { onProgress } : {}) });
    },
    /** Writes today's first brief, unless one from today already exists, in which case that one comes back. */
    async generateTodayBrief(kind: Kind): Promise<Brief> {
      return (await briefs.generateIfStale({ kind, trigger: 'manual' })).brief;
    },

    async schedules() {
      return { schedules: store.listSchedules().map(withNextRun) };
    },
    async createSchedule(input: ScheduleInput) {
      const schedule = store.addSchedule(checkSchedule(input));
      schedulesChanged();
      return withNextRun(schedule);
    },
    async updateSchedule(id: number, input: ScheduleInput) {
      const schedule = store.updateSchedule(id, checkSchedule(input));
      if (!schedule) throw new OsError('Schedule not found');
      schedulesChanged();
      return withNextRun(schedule);
    },
    async deleteSchedule(id: number) {
      if (!store.deleteSchedule(id)) throw new OsError('Schedule not found');
      schedulesChanged();
      return { ok: true };
    },

    /**
     * Writes the brief for a schedule whose time has passed today, if it hasn't been written yet.
     * Called when the app opens or a reminder is tapped. Returns the brief, or null if none was due.
     */
    async runDueSchedule(): Promise<Brief | null> {
      const schedule = dueSchedule(store.listSchedules(), now());
      if (!schedule) return null;
      // Marked first, so opening the app twice while it's writing can't start a second one.
      store.recordScheduleRun(schedule.id, 'running', now());
      try {
        const brief = await briefs.generate({ kind: schedule.kind, trigger: 'schedule' });
        store.recordScheduleRun(schedule.id, `ok: brief ${brief.id}`, now());
        return brief;
      } catch (error) {
        store.recordScheduleRun(schedule.id, `failed: ${error instanceof Error ? redact(error.message) : 'unknown error'}`, now());
        throw error;
      }
    },

    /** This week's WOOP with its check-ins, the weeks before it, your streak and what history shows. */
    async woop() {
      const { woops, checkIns, summaries } = woopHistory();
      const week = weekStartOf(now());
      const current = summaries.find((s) => s.woop.weekStart === week) ?? null;
      const past = summaries.filter((s) => s.woop.weekStart < week);
      // Last week's review is still open early in the new week, since that's when people do it.
      const unreviewed = past.find((s) => !s.woop.result && s.woop.weekStart === addDays(week, -7));
      return {
        weekStart: week,
        today: localDay(now()),
        current,
        unreviewed: unreviewed ?? null,
        past,
        streak: streak(woops, checkIns, now()),
        insights: insights(summaries),
      };
    },
    /** Saves this week's WOOP, or edits it. Its check-ins stay. */
    async saveWoop(input: WoopInput) {
      const woop = store.saveWoop(weekStartOf(now()), checkWoop(input), now());
      woopChanged();
      return woop;
    },
    async deleteWoop(id: number) {
      if (!store.deleteWoop(id)) throw new OsError('WOOP not found');
      woopChanged();
      return { ok: true };
    },
    /** Today's check-in. A day can be changed until the week ends. */
    async checkIn(input: Omit<CheckIn, 'date'> & { date?: string }) {
      const woop = store.getWoop(input.woopId);
      if (!woop) throw new OsError('WOOP not found');
      const date = input.date ?? localDay(now());
      if (date < woop.weekStart || date > addDays(woop.weekStart, 6) || date > localDay(now())) {
        throw new OsError('Check in on a day of that week, up to today');
      }
      store.saveCheckIn({ woopId: woop.id, date, progressed: Boolean(input.progressed), obstacleHit: Boolean(input.obstacleHit), planUsed: Boolean(input.planUsed) });
      return summarize(woop, store.listCheckIns([woop.id]));
    },
    async reviewWoop(id: number, result: WoopResult, note = '') {
      if (!isWoopResult(result)) throw new OsError('Choose achieved, partly or missed');
      const text = note.trim();
      if (text.length > LIMITS.note) throw new OsError(`Keep the note under ${LIMITS.note} characters`);
      if (!store.reviewWoop(id, result, text ? redact(text) : null, now())) throw new OsError('WOOP not found');
      woopChanged();
      return store.getWoop(id)!;
    },
    /**
     * The likeliest inner obstacles to this wish. The AI reads your past weeks and updates; without
     * a key, or when it fails, the ranking comes from history alone.
     */
    async predictObstacles(wish: string): Promise<{ suggestions: ObstacleSuggestion[]; source: 'ai' | 'history'; note: string | null }> {
      const history = woopHistory().summaries.filter((s) => s.woop.weekStart < weekStartOf(now()));
      const updates = recentUpdates();
      const fromHistory = predictFromHistory(history, updates, energyPeak(), now());
      const config = aiConfig();
      if (!config || !wish.trim()) return { suggestions: fromHistory, source: 'history', note: config ? null : 'Add an OpenRouter key in Settings for AI predictions.' };
      try {
        const ai = await (deps.suggestObstacles ?? suggestObstacles)(config, { wish: wish.trim().slice(0, LIMITS.wish), peak: energyPeak(), history, updates: updates.map(redact), fromHistory });
        return { suggestions: ai, source: 'ai', note: null };
      } catch (error) {
        return { suggestions: fromHistory, source: 'history', note: `AI predictions failed (${describeComposeError(error)}), so these come from your history.` };
      }
    },
    /** Stronger "then I will…" actions, ranked by how past plans held up when the obstacle showed up. */
    async optimizePlan(input: Omit<PlanContext, 'history'>): Promise<{ suggestions: PlanSuggestion[]; source: 'ai' | 'history'; note: string | null }> {
      if (!isObstacleTag(input.tag)) throw new OsError('Choose what kind of obstacle it is');
      const history = woopHistory().summaries.filter((s) => s.woop.weekStart < weekStartOf(now()));
      const fromHistory = plansFromHistory(history, input.tag);
      const config = aiConfig();
      if (!config) return { suggestions: fromHistory, source: 'history', note: 'Add an OpenRouter key in Settings for AI plans.' };
      try {
        const ai = await (deps.suggestPlans ?? suggestPlans)(config, { ...input, history });
        // A plan you've tested keeps its record, and the best proven one stays on the list.
        const proven = fromHistory.filter((p) => p.rate !== null);
        const merged = [...proven.slice(0, 1), ...ai.map((p) => proven.find((h) => h.plan.toLowerCase() === p.plan.toLowerCase()) ?? p)];
        return { suggestions: [...new Map(merged.map((p) => [p.plan.toLowerCase(), p])).values()].slice(0, 3), source: 'ai', note: null };
      } catch (error) {
        return { suggestions: fromHistory, source: 'history', note: `AI plans failed (${describeComposeError(error)}), so these come from your history.` };
      }
    },
    /** Sets the WOOP reminders again, such as when the app opens, since they run out at the week's end. */
    syncWoopReminders: () => woopChanged(),

    /** Erases keys, goals, updates, briefs, schedules and WOOPs from this phone, and its reminders. */
    async eraseEverything() {
      store.eraseAll();
      schedulesChanged();
      woopChanged();
      return { ok: true };
    },

    /** True when a schedule's time has passed today and its brief isn't written yet. */
    hasDueSchedule: () => dueSchedule(store.listSchedules(), now()) !== null,

    /** Every schedule, for setting the phone's reminders when the app starts. */
    listSchedules: () => store.listSchedules(),
  };
}

export type Os = ReturnType<typeof createOs>;
