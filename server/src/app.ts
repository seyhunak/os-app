import { hostname } from 'node:os';
import { timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { BriefService, selectedToolkits } from './briefs.ts';
import { TOOLKITS, toolkitBySlug } from './collectors.ts';
import type { ComposioGateway, ConnectedAccount } from './composio.ts';
import { briefPrompt, createComposer, DEFAULT_MODEL, listOpenRouterModels, type AiConfig, type Composer, type ModelOption } from './compose.ts';
import type { Schedule, Store } from './db.ts';
import { redact } from './redact.ts';
import { Scheduler } from './scheduler.ts';

export interface AppDeps {
  store: Store;
  token: string;
  env: { COMPOSIO_API_KEY?: string; OPENROUTER_API_KEY?: string; OS_MODEL?: string };
  createGateway(apiKey: string): ComposioGateway;
  createComposer?(config: AiConfig): Composer;
  verifyOpenRouterKey?(apiKey: string): Promise<void>;
  webDir?: string;
  now?(): Date;
}

const sha = (value: string) => createHash('sha256').update(value).digest();

const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const Timezone = z.string().min(1).max(64).refine(validTimezone, 'Unknown timezone');
const ApiKey = z.object({ apiKey: z.string().trim().min(8).max(512) });
const Kind = z.enum(['morning', 'evening']);
// Only OpenRouter now. Older apps still send the provider, so it's accepted and ignored.
const ProviderName = z.literal('openrouter');
const ScheduleBody = z.object({
  kind: Kind,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((d) => [...new Set(d)]),
  timezone: Timezone,
  enabled: z.boolean().default(true),
});

const ACCOUNTS_TTL_MS = 86_400_000;

class HttpError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 502, message: string) {
    super(message);
  }
}

async function parse<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const body = await c.req.json().catch(() => {
    throw new HttpError(400, 'Request body must be JSON');
  });
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? 'Invalid request');
  return result.data;
}

export function createApp(deps: AppDeps) {
  const { store, env } = deps;
  const composioKey = () => env.COMPOSIO_API_KEY || store.getSecret('composio');
  const openRouterKey = () => env.OPENROUTER_API_KEY || store.getSecret('openrouter');
  const openRouterModel = () => store.getSetting('ai_model_openrouter') || env.OS_MODEL || DEFAULT_MODEL;
  const aiConfig = (): AiConfig | null => {
    const apiKey = openRouterKey();
    return apiKey ? { provider: 'openrouter', apiKey, model: openRouterModel() } : null;
  };
  const gateway = () => {
    const key = composioKey();
    return key ? deps.createGateway(key) : null;
  };
  const requireGateway = () => {
    const g = gateway();
    if (!g) throw new HttpError(409, 'Connect Composio first');
    return g;
  };
  /** The account list changes rarely, so it's reused for a day. Connecting a tool or "Check connections" asks again. */
  const accounts = async (g: ComposioGateway, fresh = false): Promise<ConnectedAccount[]> => {
    const now = (deps.now?.() ?? new Date()).getTime();
    const cached = store.getSetting('accounts_cache');
    if (cached && !fresh) {
      const { at, list } = JSON.parse(cached) as { at: number; list: ConnectedAccount[] };
      if (now - at < ACCOUNTS_TTL_MS) return list;
    }
    const list = await g.listActiveAccounts();
    store.setSetting('accounts_cache', JSON.stringify({ at: now, list }));
    return list;
  };
  const forgetAccounts = () => store.deleteSetting('accounts_cache');
  const lastFour = (key: string | null | undefined) => (key ? key.slice(-4) : null);

  const briefs = new BriefService({
    store,
    gateway,
    accounts,
    composer: () => {
      const config = aiConfig();
      return config ? (deps.createComposer ?? createComposer)(config) : null;
    },
    ...(deps.now ? { now: deps.now } : {}),
  });
  const scheduler = new Scheduler(store, briefs);
  scheduler.sync();
  const withNextRun = (s: Schedule) => ({ ...s, nextRun: scheduler.nextRun(s.id) });

  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(redact(error.message));
    return c.json({ error: 'Something went wrong on the server' }, 500);
  });

  // Auth is a bearer header, never a cookie, so allowing any origin doesn't open up CSRF.
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use('/api/*', bodyLimit({ maxSize: 256 * 1024 }));
  app.get('/health', (c) => c.json({ ok: true }));
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!timingSafeEqual(sha(given), sha(deps.token))) return c.json({ error: 'Invalid server token' }, 401);
    return next();
  });

  const credentialStatus = (envValue: string | undefined, secret: string) =>
    envValue ? 'environment' : store.getSecret(secret) ? 'saved' : null;

  app.get('/api/status', (c) => c.json({
    // A readable name for this machine, so devices needn't show its full address.
    machine: hostname().replace(/\.(local|lan|home)$/i, '').replace(/[-_]+/g, ' '),
    composio: credentialStatus(env.COMPOSIO_API_KEY, 'composio'),
    openrouter: credentialStatus(env.OPENROUTER_API_KEY, 'openrouter'),
    provider: 'openrouter',
    model: openRouterModel(),
    openrouterModel: openRouterModel(),
    timezone: store.getSetting('timezone'),
    // Only the end of each key is in the status. The OpenRouter key itself has its own route below.
    composioHint: lastFour(composioKey()),
    openrouterHint: lastFour(openRouterKey()),
    selectedToolkits: selectedToolkits(store),
    hasBriefs: store.latestBrief() !== null,
    hasSchedules: store.listSchedules().length > 0,
  }));

  app.put('/api/credentials/composio', async (c) => {
    const { apiKey } = await parse(c, ApiKey);
    try {
      await deps.createGateway(apiKey).verify();
    } catch {
      throw new HttpError(400, "Composio didn't accept that key, or couldn't be reached. Check the key and try again.");
    }
    store.setSecret('composio', apiKey);
    forgetAccounts();
    return c.json({ composio: 'saved' });
  });

  app.put('/api/credentials/openrouter', async (c) => {
    const { apiKey } = await parse(c, ApiKey);
    if (deps.verifyOpenRouterKey) {
      try {
        await deps.verifyOpenRouterKey(apiKey);
      } catch {
        throw new HttpError(400, "OpenRouter didn't accept that key, or couldn't be reached. Check the key and try again.");
      }
    }
    store.setSecret('openrouter', apiKey);
    return c.json({ openrouter: 'saved' });
  });

  /**
   * The OpenRouter key itself, so the phone app can keep the same key in its Keychain and write
   * briefs with AI while this server is out of reach. Needs the device token, like every route.
   */
  app.get('/api/credentials/openrouter', (c) => {
    const apiKey = openRouterKey();
    if (!apiKey) throw new HttpError(404, 'No OpenRouter key saved');
    c.header('Cache-Control', 'no-store');
    return c.json({ apiKey });
  });

  app.put('/api/ai', async (c) => {
    const body = await parse(c, z.object({ provider: ProviderName.optional(), model: z.string().trim().min(1, 'Choose a model').max(200) }));
    store.setSetting('ai_provider', 'openrouter');
    store.setSetting('ai_model_openrouter', body.model);
    return c.json({ provider: 'openrouter', model: body.model });
  });

  app.get('/api/ai/models', async (c) => {
    const name = c.req.query('provider');
    if (name !== undefined && !ProviderName.safeParse(name).success) throw new HttpError(400, 'Unknown provider');
    let models: ModelOption[] = [];
    let error: string | null = null;
    const key = openRouterKey();
    if (key) {
      try {
        models = await listOpenRouterModels(key);
      } catch {
        error = "Couldn't get your models from OpenRouter. You can still type a model name.";
      }
    } else {
      error = 'Add your OpenRouter key above to see your models.';
    }
    return c.json({ models, error });
  });

  app.delete('/api/credentials/:name{composio|openrouter}', (c) => {
    store.deleteSecret(c.req.param('name'));
    if (c.req.param('name') === 'composio') forgetAccounts();
    return c.json({ ok: true });
  });

  app.get('/api/toolkits', async (c) => {
    const g = gateway();
    let connected: ConnectedAccount[] = [];
    let error: string | null = null;
    let needsAuth = false;
    if (g) {
      try {
        connected = await accounts(g, c.req.query('fresh') === '1');
      } catch (failure) {
        needsAuth = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid.*key/i.test(failure instanceof Error ? failure.message : String(failure));
        error = needsAuth ? "Composio didn't accept your API key. Open Composio to get a new one." : "Couldn't reach Composio to check your connections";
      }
    }
    const selected = selectedToolkits(store);
    return c.json({
      error,
      needsAuth,
      toolkits: TOOLKITS.map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        noAuth: Boolean(t.noAuth),
        selected: selected.includes(t.slug),
        accounts: t.noAuth ? 1 : connected.filter((a) => a.toolkit === t.slug).length,
      })),
    });
  });

  app.put('/api/toolkits/selection', async (c) => {
    const { slugs } = await parse(c, z.object({ slugs: z.array(z.string()).max(TOOLKITS.length) }));
    const known = [...new Set(slugs)].filter((s) => toolkitBySlug(s));
    store.setSetting('selected_toolkits', JSON.stringify(known));
    return c.json({ selectedToolkits: known });
  });

  app.post('/api/toolkits/:slug/connect', async (c) => {
    const toolkit = toolkitBySlug(c.req.param('slug'));
    if (!toolkit) throw new HttpError(404, 'Unknown tool');
    if (toolkit.noAuth) return c.json({ redirectUrl: null });
    const g = requireGateway();
    forgetAccounts();
    try {
      return c.json(await g.authorize(toolkit.slug));
    } catch (error) {
      console.error(redact(error instanceof Error ? error.message : String(error)));
      throw new HttpError(502, `Composio couldn't start the ${toolkit.name} connection. You can also connect it at composio.dev.`);
    }
  });

  app.get('/api/goals', (c) => c.json({ goals: store.getSetting('goals') ?? '' }));
  app.put('/api/goals', async (c) => {
    const { goals } = await parse(c, z.object({ goals: z.string().max(20_000) }));
    store.setSetting('goals', goals);
    return c.json({ goals });
  });

  app.get('/api/ledger', (c) => c.json({ entries: store.listLedger() }));
  app.post('/api/ledger', async (c) => {
    const { text, clientId, createdAt } = await parse(c, z.object({
      text: z.string().trim().min(1, 'Write a short update first').max(1000, 'Keep updates under 1,000 characters'),
      clientId: z.string().min(8).max(100).optional(),
      createdAt: z.string().datetime().optional(),
    }));
    // Updates written offline keep the time they were written, but can't claim to be from the future.
    const now = deps.now?.() ?? new Date();
    const when = createdAt && Date.parse(createdAt) < now.getTime() ? new Date(createdAt).toISOString() : now.toISOString();
    return c.json(store.addLedgerEntry(redact(text), { ...(clientId ? { clientId } : {}), createdAt: when }), 201);
  });

  app.put('/api/settings/timezone', async (c) => {
    const { timezone } = await parse(c, z.object({ timezone: Timezone }));
    store.setSetting('timezone', timezone);
    return c.json({ timezone });
  });

  app.get('/api/briefs', (c) => c.json({ briefs: store.listBriefs() }));
  app.get('/api/briefs/:id{[0-9]+}', (c) => {
    const brief = store.getBrief(Number(c.req.param('id')));
    if (!brief) throw new HttpError(404, 'Brief not found');
    return c.json(brief);
  });
  // Archiving, not deleting: the brief is hidden but kept. Sending it twice is harmless, so offline devices can retry.
  app.get('/api/brief-prompt', (c) => c.json(briefPrompt()));
  // A brief a phone wrote while offline. It's stored as is: no tools are read, so no pull budget is spent.
  app.post('/api/briefs/import', async (c) => {
    const body = await parse(c, z.object({
      clientId: z.string().min(8).max(100),
      kind: Kind,
      generator: z.enum(['ai', 'digest']),
      markdown: z.string().min(1).max(60_000),
      sources: z.array(z.object({ toolkit: z.string().max(100), name: z.string().max(100), status: z.string().max(40), items: z.number().int().min(0), label: z.string().max(200).optional(), summary: z.string().max(2000).optional(), detail: z.string().max(500).optional() })).max(50),
      createdAt: z.iso.datetime(),
    }));
    const { brief, created } = store.importBrief(body.clientId, {
      kind: body.kind,
      generator: body.generator,
      markdown: redact(body.markdown),
      sources: body.sources.map((s) => ({ ...s, status: 'cache' as const, ...(s.summary ? { summary: redact(s.summary) } : {}) })),
    }, new Date(body.createdAt));
    return c.json(brief, created ? 201 : 200);
  });
  app.post('/api/briefs/archive', async (c) => {
    const { ids } = await parse(c, z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }));
    return c.json({ archived: store.archiveBriefs(ids) });
  });
  app.delete('/api/briefs/:id{[0-9]+}', (c) => c.json({ archived: store.archiveBriefs([Number(c.req.param('id'))]) }));
  app.post('/api/briefs', async (c) => {
    const { kind, refresh, ifStale } = await parse(c, z.object({ kind: Kind, refresh: z.boolean().default(false), ifStale: z.boolean().default(false) }));
    if (ifStale) {
      // The app asks for this on its own when the newest brief is from an earlier day. Same pull budget as any brief.
      const { brief, created } = await briefs.generateIfStale({ kind, trigger: 'manual' });
      return c.json(brief, created ? 201 : 200);
    }
    return c.json(await briefs.generate({ kind, trigger: 'manual', refresh }), 201);
  });

  app.get('/api/schedules', (c) => c.json({ schedules: store.listSchedules().map(withNextRun) }));
  app.post('/api/schedules', async (c) => {
    const schedule = store.addSchedule(await parse(c, ScheduleBody));
    scheduler.sync();
    return c.json(withNextRun(schedule), 201);
  });
  app.put('/api/schedules/:id{[0-9]+}', async (c) => {
    const schedule = store.updateSchedule(Number(c.req.param('id')), await parse(c, ScheduleBody));
    if (!schedule) throw new HttpError(404, 'Schedule not found');
    scheduler.sync();
    return c.json(withNextRun(schedule));
  });
  app.delete('/api/schedules/:id{[0-9]+}', (c) => {
    if (!store.deleteSchedule(Number(c.req.param('id')))) throw new HttpError(404, 'Schedule not found');
    scheduler.sync();
    return c.json({ ok: true });
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // The server also hosts the web app, once it's been built.
  if (deps.webDir && existsSync(deps.webDir)) {
    const root = deps.webDir;
    app.use('/*', serveStatic({ root }));
    app.get('/*', serveStatic({ root, path: 'index.html' }));
  }

  return { app, scheduler, briefs };
}
