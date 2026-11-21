import { BriefService, selectedToolkits } from './briefs';
import { TOOLKITS, toolkitBySlug } from './collectors';
import type { ComposioGateway, ConnectedAccount } from './composio';
import { createComposer, DEFAULT_MODEL, describeComposeError, draftOkrs, listOpenRouterModels, MAX_GOALS, pickFree, type AiConfig, type Composer, type ModelOption, type OnProgress } from './compose';
import type { Brief, Kind, Schedule, Store } from './db';
import { redact } from './redact';
import { dueSchedule, nextRun } from './schedule';

export interface OsDeps {
  store: Store;
  createGateway(apiKey: string): ComposioGateway;
  createComposer?(config: AiConfig): Composer;
  verifyOpenRouterKey?(apiKey: string): Promise<void>;
  listModels?(apiKey: string): Promise<ModelOption[]>;
  /** Writes OKRs from notes. Defaults to OpenRouter. */
  draftOkrs?(config: AiConfig, notes: string, max: number): Promise<string[]>;
  /** Told whenever schedules change, so the phone can set its reminders again. */
  onSchedulesChanged?(schedules: Schedule[]): void;
  now?(): Date;
}

export type ScheduleInput = Pick<Schedule, 'kind' | 'time' | 'days' | 'timezone' | 'enabled'>;

/** A problem to show as is. Everything else is reported with a general message. */
export class OsError extends Error {}

/** One goal's longest text. An OKR is a few short lines; longer pasted notes get rewritten first. */
const GOAL_LENGTH = 2000;

/** One OKR, tidied: no trailing spaces, no blank lines inside it. */
const tidyGoal = (goal: string) => goal.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

/** What a brief reads: each goal on its own lines, nothing else, to keep the prompt small. */
export const goalsForBrief = (goals: string[]) => goals.map(tidyGoal).filter(Boolean).join('\n');

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
  const openRouterModel = () => store.getSetting('ai_model_openrouter') || DEFAULT_MODEL;
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
  const saveModels = (models: ModelOption[]) => {
    store.setSetting('recommended_models', JSON.stringify(models.filter((m) => m.recommended).map(({ id, price }) => ({ id, price }))));
    store.setSetting('free_models', JSON.stringify(pickFree(models.map((m) => m.id))));
  };
  const goalList = (): string[] => {
    const saved = store.getSetting('goals_list');
    if (saved) return JSON.parse(saved) as string[];
    // Goals from before the list were one block of text, which stays one goal until it's rewritten.
    const legacy = store.getSetting('goals')?.trim();
    return legacy ? [legacy] : [];
  };
  const writeGoals = (list: string[]) => {
    store.setSetting('goals_list', JSON.stringify(list));
    store.setSetting('goals', goalsForBrief(list));
  };
  const okrs = async (notes: string, max: number): Promise<string[]> => {
    const text = notes.trim();
    if (!text) throw new OsError('Write a goal first');
    if (text.length > 20_000) throw new OsError('Keep it under 20,000 characters');
    const config = aiConfig();
    if (!config) throw new OsError('Add your OpenRouter key in Settings, under Model, to write OKRs');
    try {
      return (await (deps.draftOkrs ?? draftOkrs)(config, text, max)).slice(0, max);
    } catch (error) {
      throw new OsError(`Couldn't write the OKR: ${describeComposeError(error)}.`);
    }
  };
  const lastFour = (key: string | null) => (key ? key.slice(-4) : null);

  const briefs = new BriefService({
    store,
    gateway,
    accounts,
    composer: () => {
      const config = aiConfig();
      return config ? (deps.createComposer ? deps.createComposer(config) : createComposer(config, saveModels)) : null;
    },
    now,
  });

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

    async saveAi(model: string) {
      const id = model.trim();
      if (!id || id.length > 200) throw new OsError('Choose a model');
      store.setSetting('ai_model_openrouter', id);
      return { provider: 'openrouter' as const, model: id };
    },

    async aiModels(): Promise<{ models: ModelOption[]; error: string | null }> {
      const key = openRouterKey();
      if (!key) return { models: [], error: 'Add your OpenRouter key above to see your models.' };
      try {
        const models = await (deps.listModels ?? listOpenRouterModels)(key);
        saveModels(models);
        return { models, error: null };
      } catch {
        return { models: [], error: "Couldn't get your models from OpenRouter. You can still type a model name." };
      }
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

    async goals() {
      return { goals: store.getSetting('goals') ?? '' };
    },
    /** Pasted notes, such as from onboarding. They become one goal, which Settings can rewrite as OKRs. */
    async saveGoals(goals: string) {
      if (goals.length > 20_000) throw new OsError('Keep your goals under 20,000 characters');
      store.setSetting('goals_list', JSON.stringify(goals.trim() ? [goals.trim()] : []));
      store.setSetting('goals', goals);
      return { goals };
    },

    /** Your goals, one OKR each, at most five. */
    async goalList() {
      return { goals: goalList(), max: MAX_GOALS };
    },
    async saveGoalList(goals: string[]) {
      const list = goals.map(tidyGoal).filter(Boolean);
      if (list.length > MAX_GOALS) throw new OsError(`Keep it to ${MAX_GOALS} goals, so each one gets attention`);
      if (list.some((g) => g.length > GOAL_LENGTH)) throw new OsError('A goal is too long. Shorten it, or rewrite it as an OKR');
      writeGoals(list);
      return { goals: list, max: MAX_GOALS };
    },
    /** Writes one OKR from what you typed and adds it to your goals. */
    async addGoal(notes: string) {
      const list = goalList();
      if (list.length >= MAX_GOALS) throw new OsError(`You have ${MAX_GOALS} goals, the most OS keeps. Remove one to add another`);
      const [okr] = await okrs(notes, 1);
      writeGoals([...list, okr!]);
      return { goals: goalList(), max: MAX_GOALS };
    },
    /** Rewrites one goal as OKRs. Long pasted notes can become several, up to the free slots. */
    async rewriteGoal(index: number) {
      const list = goalList();
      const goal = list[index];
      if (goal === undefined) throw new OsError('Goal not found');
      const written = await okrs(goal, MAX_GOALS - list.length + 1);
      writeGoals([...list.slice(0, index), ...written, ...list.slice(index + 1)]);
      return { goals: goalList(), max: MAX_GOALS };
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

    /** Erases keys, goals, updates, briefs and schedules from this phone, and its reminders. */
    async eraseEverything() {
      store.eraseAll();
      schedulesChanged();
      return { ok: true };
    },

    /** True when a schedule's time has passed today and its brief isn't written yet. */
    hasDueSchedule: () => dueSchedule(store.listSchedules(), now()) !== null,

    /** Every schedule, for setting the phone's reminders when the app starts. */
    listSchedules: () => store.listSchedules(),
  };
}

export type Os = ReturnType<typeof createOs>;
