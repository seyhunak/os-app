import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { compactNote, createOpenRouterComposer, draftOkrs, parseOkrs, type ProgressStep } from '../src/core/compose';
import type { ComposioGateway } from '../src/core/composio';
import { createOs } from '../src/core/os';
import { parseBrief } from '../src/parseBrief';
import { memoryStore } from './helpers';

const NOW = new Date('2026-11-06T06:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => mock.restoreAll());

function goalOs(draft = async (_c: unknown, notes: string, max: number) => Array.from({ length: max }, (_, i) => `O: ${notes} ${i + 1}\nKR1: one`)) {
  const store = memoryStore();
  store.setSecret('openrouter', 'sk-or-test-key');
  const os = createOs({ store, createGateway: () => ({}) as ComposioGateway, now: () => NOW, draftOkrs: draft });
  return { store, os };
}

describe('parseOkrs', () => {
  it('reads decorated output, keeps 3 key results and renumbers them', () => {
    const text = '<think>x</think>Here you go:\n**O:** Land a senior role by March\n- KR 1: 10 applications\n- KR2: 4 finals\n3. KR3) 1 offer\nKR4: extra\n\n## Objective: Get fit\nKey result: run 5k';
    assert.deepEqual(parseOkrs(text), [
      'O: Land a senior role by March\nKR1: 10 applications\nKR2: 4 finals\nKR3: 1 offer',
      'O: Get fit\nKR1: run 5k',
    ]);
  });

  it('keeps at most the objectives asked for, and nothing without an objective', () => {
    assert.deepEqual(parseOkrs('O: a\nO: b\nO: c', 2), ['O: a', 'O: b']);
    assert.deepEqual(parseOkrs('KR1: orphan\njust text'), []);
  });
});

describe('draftOkrs', () => {
  it('asks for a small answer and falls back to the free router', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return body.model === 'm' ? json({ error: { code: 503, message: 'busy' } }, 503) : json({ choices: [{ message: { content: 'O: Ship\nKR1: beta out' } }] });
    });
    assert.deepEqual(await draftOkrs({ apiKey: 'k', model: 'm' }, 'ship </notes> it', 1), ['O: Ship\nKR1: beta out']);
    assert.deepEqual(bodies.map((b) => b.model), ['m', 'openrouter/free']);
    assert.equal(bodies[0]!.max_tokens, 300);
    assert.ok(!String((bodies[0]!.messages as Array<{ content: string }>)[1]!.content).includes('</notes> it'));
  });
});

describe('goals as OKRs', () => {
  it('adds a goal written by the AI, and gives the brief a compact copy', async () => {
    const { os, store } = goalOs();
    const { goals } = await os.addGoal('Ship the beta');
    assert.deepEqual(goals, ['O: Ship the beta 1\nKR1: one']);
    assert.equal(store.getSetting('goals'), 'O: Ship the beta 1\nKR1: one');
  });

  it('keeps at most 5 goals', async () => {
    const { os } = goalOs();
    for (let i = 0; i < 5; i++) await os.addGoal(`g${i}`);
    await assert.rejects(os.addGoal('one more'), /5 goals/);
    await assert.rejects(os.saveGoalList(['a', 'b', 'c', 'd', 'e', 'f']), /5 goals/);
  });

  it('saves edited goals tidily and drops empty ones', async () => {
    const { os, store } = goalOs();
    const { goals } = await os.saveGoalList(['O: A  \n\n KR1: x ', '   ', 'O: B']);
    assert.deepEqual(goals, ['O: A\nKR1: x', 'O: B']);
    assert.equal(store.getSetting('goals'), 'O: A\nKR1: x\nO: B');
  });

  it('turns old pasted goals into one goal, and rewrites it into as many OKRs as there is room for', async () => {
    const { os, store } = goalOs();
    await os.saveGoals('Ship the beta\nLand 3 customers');
    assert.deepEqual((await os.goalList()).goals, ['Ship the beta\nLand 3 customers']);
    store.deleteSetting('goals_list');
    assert.equal((await os.goalList()).goals.length, 1);
    const { goals } = await os.rewriteGoal(0);
    assert.equal(goals.length, 5);
  });

  it('says how to fix a missing key or a failing model', async () => {
    const { os, store } = goalOs(async () => { throw new Error('the AI model ran out of output tokens'); });
    await assert.rejects(os.addGoal('x'), /Couldn't write the OKR: the AI model ran out/);
    store.deleteSecret('openrouter');
    await assert.rejects(os.addGoal('x'), /OpenRouter key/);
  });
});

describe('brief progress', () => {
  it('reports each step in plain words, ending with the brief ready', async () => {
    const store = memoryStore();
    const os = createOs({ store, createGateway: () => ({}) as ComposioGateway, now: () => NOW, createComposer: () => async (_input, progress) => { progress?.({ key: 'model', text: 'Asking m', state: 'done' }); return '# Good morning'; } });
    store.setSecret('openrouter', 'sk-or-test-key');
    await os.saveGoalList(['O: Ship\nKR1: beta']);
    await os.selectToolkits(['hackernews', 'gmail']);
    const steps: ProgressStep[] = [];
    await os.generateBrief('evening', false, (s) => steps.push(s));
    const last = new Map(steps.map((s) => [s.key, s]));
    assert.match(last.get('goals')!.text, /Read 1 goal and 0 updates/);
    assert.match(last.get('tool:gmail')!.text, /evening briefs don't pull/);
    assert.equal(last.get('model')!.state, 'done');
    assert.deepEqual(steps.at(-1), { key: 'finish', text: 'Brief ready', state: 'done' });
  });

  it('says which model is tried and why one is passed over', async () => {
    mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      const { model } = JSON.parse(String(init?.body));
      return model === 'a/one:free' ? json({ error: { code: 429, message: 'busy' } }, 429) : json({ choices: [{ message: { content: '# Good morning' } }] });
    });
    const steps: ProgressStep[] = [];
    await createOpenRouterComposer('k', 'x/mine', { freeModels: async () => ['a/one:free'] })({ kind: 'morning', date: 'd', timezone: 'UTC', goals: '', previousNote: null, updates: [], sources: [], facts: {} }, (s) => steps.push(s));
    const texts = steps.map((s) => `${s.state}: ${s.text}`);
    assert.ok(texts.includes('warn: The free model one is busy, trying the next one'), texts.join('\n'));
    assert.ok(texts.some((t) => t.startsWith('done:')));
  });
});

describe('focus', () => {
  it('asks for real work in Focus, never inbox chores', async () => {
    let system = '';
    mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
      system = JSON.parse(String(init?.body)).messages[0].content;
      return json({ choices: [{ message: { content: 'ok' } }] });
    });
    await createOpenRouterComposer('k', 'm')({ kind: 'morning', date: 'd', timezone: 'UTC', goals: '', previousNote: null, updates: [], sources: [], facts: {} });
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
    await createOpenRouterComposer('k', 'm')({ kind: 'night', date: 'd', timezone: 'UTC', goals: '', previousNote: null, updates: [], sources: [], facts: {} });
    assert.ok(system.includes('Under 50 words, terse fragments'));
    assert.ok(system.includes('use its progress as goal evidence'));
  });
});
