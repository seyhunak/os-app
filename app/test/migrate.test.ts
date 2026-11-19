import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateOldCopy } from '../src/core/migrate';
import { memoryStore } from './helpers';

const server = 'https://mac.tailnet.ts.net:8443';
const key = (name: string) => `os.offline.${server}:${name}`;
const brief = (id: number, createdAt: string) => ({ id, kind: 'morning', trigger: 'manual', generator: 'ai', markdown: `# Brief ${id}`, sources: [], createdAt });
const oldCopy = (over: Record<string, unknown> = {}) => ({
  openRouterKey: 'sk-or-old-key-1234',
  entries: Object.entries({
    savedAt: '2026-11-18T10:00:00.000Z',
    briefs: { briefs: [brief(3, '2026-11-18T08:00:00.000Z'), brief(2, '2026-11-17T08:00:00.000Z'), brief(1, '2026-11-16T08:00:00.000Z')] },
    ledger: { entries: [{ id: 1, text: 'Shipped beta', createdAt: '2026-11-17T12:00:00.000Z' }] },
    goals: { goals: 'Ship the beta' },
    status: { selectedToolkits: ['gmail', 'github'], openrouterModel: 'qwen/qwen3.7-flash', timezone: 'Europe/London' },
    schedules: { schedules: [{ id: 9, kind: 'morning', time: '08:00', days: [1, 2, 3], timezone: 'Europe/London', enabled: true }] },
    outbox: [
      { kind: 'update', clientId: 'a', text: 'Called the bank', createdAt: '2026-11-18T09:00:00.000Z' },
      { kind: 'archive', clientId: 'b', ids: [1] },
      { kind: 'brief', clientId: 'c', id: -5, draft: { clientId: 'c', kind: 'evening', generator: 'digest', markdown: '# Draft', sources: [], createdAt: '2026-11-18T19:00:00.000Z' } },
    ],
    ...over,
  }).map(([name, value]) => [key(name), JSON.stringify(value)] as [string, string]),
});

describe('importing the copy saved from the Mac server', () => {
  it('brings over briefs, updates, goals, tools, model, schedules and the OpenRouter key', () => {
    const store = memoryStore();
    const result = migrateOldCopy(store, oldCopy());
    assert.deepEqual(result, { imported: true, briefs: 3, updates: 2 });
    // Brief 1 was archived while offline, and the offline draft comes along.
    assert.deepEqual(store.listBriefs().map((b) => b.markdown), ['# Draft', '# Brief 3', '# Brief 2']);
    assert.equal(store.listBriefs()[0]!.trigger, 'offline');
    assert.deepEqual(store.listLedger().map((e) => e.text), ['Called the bank', 'Shipped beta']);
    assert.equal(store.getSetting('goals'), 'Ship the beta');
    assert.equal(store.getSetting('selected_toolkits'), '["gmail","github"]');
    assert.equal(store.getSetting('ai_model_openrouter'), 'qwen/qwen3.7-flash');
    assert.equal(store.listSchedules().length, 1);
    assert.equal(store.getSecret('openrouter'), 'sk-or-old-key-1234');
  });

  it('prefers goals edited offline over the saved ones', () => {
    const store = memoryStore();
    migrateOldCopy(store, oldCopy({ pendingGoals: 'Newer goals' }));
    assert.equal(store.getSetting('goals'), 'Newer goals');
  });

  it('runs once', () => {
    const store = memoryStore();
    migrateOldCopy(store, oldCopy());
    assert.equal(migrateOldCopy(store, oldCopy()).imported, false);
    assert.equal(store.listBriefs().length, 3);
  });

  it('never imports over data already on the phone', () => {
    const store = memoryStore();
    store.addLedgerEntry('Already here');
    assert.equal(migrateOldCopy(store, oldCopy()).imported, false);
    assert.deepEqual(store.listLedger().map((e) => e.text), ['Already here']);
  });

  it('does nothing on a fresh install', () => {
    const store = memoryStore();
    assert.equal(migrateOldCopy(store, { entries: [], openRouterKey: null }).imported, false);
    assert.equal(store.latestBrief(), null);
  });

  it('takes the server saved most recently when there were several', () => {
    const store = memoryStore();
    const other = 'http://127.0.0.1:8787';
    const entries: Array<[string, string]> = [
      ...oldCopy().entries,
      [`os.offline.${other}:savedAt`, JSON.stringify('2026-01-01T00:00:00.000Z')],
      [`os.offline.${other}:goals`, JSON.stringify({ goals: 'Old machine' })],
    ];
    migrateOldCopy(store, { entries, openRouterKey: null });
    assert.equal(store.getSetting('goals'), 'Ship the beta');
  });
});
