import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { askSmall, compactNote, createOpenRouterComposer, type ProgressStep } from '../src/core/compose';
import type { ComposioGateway } from '../src/core/composio';
import { createOs } from '../src/core/os';
import { parseBrief } from '../src/parseBrief';
import { memoryStore } from './helpers';

const NOW = new Date('2026-11-06T06:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => mock.restoreAll());

const WOOP = { wish: 'Ship the beta', outcome: '', obstacle: 'I polish forever', obstacleTag: 'perfectionism' as const, cue: 'afternoon' as const, plan: 'ship the rough version' };

describe('goals from before WOOP', () => {
  const osWith = (settings: Record<string, string>) => {
    const store = memoryStore();
    for (const [k, v] of Object.entries(settings)) store.setSetting(k, v);
    const os = createOs({ store, createGateway: () => ({}) as ComposioGateway, now: () => NOW });
    return { store, os };
  };

  it('turn OKRs into saved wishes once, and briefs stop reading them', async () => {
    const { os, store } = osWith({
      goals_list: JSON.stringify(['O: Land a senior role by March\nKR1: 10 applications', 'O: Ship the beta\nKR1: 20 testers', 'O: ship the beta']),
      goals: 'O: Land a senior role by March\nKR1: 10 applications',
    });
    assert.deepEqual((await os.wishes()).wishes, ['Land a senior role by March', 'ship the beta']);
    assert.equal(store.getSetting('goals'), null);
    assert.equal(store.getSetting('goals_list'), null);
  });

  it('turn pasted notes into one wish per line, without bullets', async () => {
    const { os } = osWith({ goals: '- Land 3 paying customers by March\n\n2. Ship the beta by December 15' });
    assert.deepEqual((await os.wishes()).wishes, ['Land 3 paying customers by March', 'Ship the beta by December 15']);
  });

  it('can be removed one by one', async () => {
    const { os } = osWith({ goals: 'A\nB' });
    assert.deepEqual((await os.removeWish(0)).wishes, ['B']);
    await assert.rejects(os.removeWish(5), /not found/);
  });
});

describe('askSmall', () => {
  it('asks the preset for a small answer, and once more if OpenRouter was busy', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return bodies.length === 1 ? json({ error: { code: 503, message: 'busy' } }, 503) : json({ choices: [{ message: { content: 'ok' } }] });
    });
    const out = await askSmall({ apiKey: 'k' }, { system: 's', user: 'u', maxTokens: 300, empty: 'nothing' }, (t) => t || null, { sleep: async () => undefined });
    assert.equal(out, 'ok');
    assert.deepEqual(bodies.map((b) => b.model), ['@preset/os-chat', '@preset/os-chat']);
    assert.equal(bodies[0]!.max_tokens, 300);
  });

  it('gives up with the empty message when the answer has nothing usable', async () => {
    mock.method(globalThis, 'fetch', async () => json({ choices: [{ message: { content: '' } }] }));
    await assert.rejects(askSmall({ apiKey: 'k' }, { system: 's', user: 'u', maxTokens: 300, empty: 'nothing' }, (t) => t || null), /nothing/);
  });
});

describe('brief progress', () => {
  it('reports each step in plain words, ending with the brief ready', async () => {
    const store = memoryStore();
    const os = createOs({ store, createGateway: () => ({}) as ComposioGateway, now: () => NOW, createComposer: () => async (_input, progress) => { progress?.({ key: 'model', text: 'Asking m', state: 'done' }); return '# Good morning'; } });
    store.setSecret('openrouter', 'sk-or-test-key');
    await os.saveWoop(WOOP);
    await os.selectToolkits(['hackernews', 'gmail']);
    const steps: ProgressStep[] = [];
    await os.generateBrief('evening', false, (s) => steps.push(s));
    const last = new Map(steps.map((s) => [s.key, s]));
    assert.match(last.get('goals')!.text, /Read this week's WOOP and 0 updates/);
    assert.match(last.get('tool:gmail')!.text, /evening briefs don't pull/);
    assert.equal(last.get('model')!.state, 'done');
    assert.deepEqual(steps.at(-1), { key: 'finish', text: 'Brief ready', state: 'done' });
  });

  it('says the preset is asked, waits when OpenRouter is busy, and names the model that wrote it', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => (++calls === 1
      ? json({ error: { code: 429, message: 'busy' } }, 429)
      : json({ model: 'qwen/qwen3-30b-a3b-instruct-2507', choices: [{ message: { content: '# Good morning' } }] })));
    const steps: ProgressStep[] = [];
    await createOpenRouterComposer('k', { sleep: async () => undefined })({ kind: 'morning', date: 'd', timezone: 'UTC', goals: '', previousNote: null, updates: [], sources: [], facts: {} }, (s) => steps.push(s));
    const texts = steps.map((s) => `${s.state}: ${s.text}`);
    assert.deepEqual(texts, [
      'running: Asking the os-chat preset to weigh everything against your goals',
      'running: OpenRouter was busy. Waiting a few seconds, then trying again',
      'done: Waited for OpenRouter, trying again',
      'done: Qwen3-30b-a3b-instruct-2507 ranked your day and wrote the brief',
    ]);
  });
});

describe('focus', () => {
  it('asks for real work in Focus, never inbox chores', async () => {
    let system = '';
    mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      system = JSON.parse(String(init?.body)).messages[0].content;
      return json({ choices: [{ message: { content: 'ok' } }] });
    });
    await createOpenRouterComposer('k')({ kind: 'morning', date: 'd', timezone: 'UTC', goals: '', previousNote: null, updates: [], sources: [], facts: {} });
    assert.ok(system.includes('Never triage'));
    assert.ok(system.includes('Never put an [UNALIGNED] item in Focus'));
  });

  it('drops triage and unaligned items the model puts in Focus anyway', () => {
    const parsed = parseBrief([
      '# Good morning', '### Focus',
      '- [Gmail] Check direct recruiter replies → stay responsive | Goal: Land a role (KR2)',
      '- [Gmail] Reply to Sam at Acme with your March start date → final round | Goal: Land a role (KR2)',
      '- [Slack] Plan the offsite → team asked [UNALIGNED]',
      '### Signals', 'No signals today.',
    ].join('\n'));
    assert.deepEqual(parsed.focusItems.map((f) => f.headline), ['Reply to Sam at Acme with your March start date']);
  });
});

describe('note for next brief', () => {
  it('reaches the next prompt as one short line', () => {
    assert.equal(compactNote('- **Reply** to Sam\n- Carry: beta blockers\n\n1. Drop: offsite'), 'Reply to Sam; Carry: beta blockers; Drop: offsite');
    assert.equal(compactNote('Nothing to carry over.'), null);
    const long = compactNote('word '.repeat(200))!;
    assert.ok(long.length <= 401 && long.endsWith('…'));
  });

  it('asks for a terse note that carries progress', async () => {
    let system = '';
    mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      system = JSON.parse(String(init?.body)).messages[0].content;
      return json({ choices: [{ message: { content: 'ok' } }] });
    });
    await createOpenRouterComposer('k')({ kind: 'night', date: 'd', timezone: 'UTC', goals: '', previousNote: null, updates: [], sources: [], facts: {} });
    assert.ok(system.includes('Under 50 words, terse fragments'));
    assert.ok(system.includes('use its progress as goal evidence'));
  });
});
