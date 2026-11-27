import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composioState, modelState, routerHealth } from '../src/settingsSummary';

describe('settings sections', () => {
  it('collapses Composio once a key is saved', () => {
    assert.deepEqual(composioState({ composio: 'saved' }), { configured: true, summary: 'Composio connected' });
    assert.equal(composioState({ composio: null }).configured, false);
  });

  it('collapses OpenRouter once a key is saved, naming the preset', () => {
    assert.deepEqual(modelState({ openrouter: 'saved', preset: 'os-chat' }), { configured: true, summary: 'OpenRouter · os-chat' });
    assert.deepEqual(modelState({ openrouter: null, preset: 'os-chat' }), { configured: false, summary: 'OpenRouter key needed' });
  });

});

describe('router health', () => {
  const NOW = new Date('2026-11-27T12:00:00Z');
  const route = (via: 'preset' | 'backup' | 'free' | 'failed', model: string | null, minutesAgo: number, reason?: string) =>
    ({ via, model, task: 'brief' as const, at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), ...(reason ? { reason } : {}) });
  const base = { lastRoute: null, credit: 4.5, creditError: null, keyRejected: false };

  it('is healthy with credit and the main model answering, and the next request goes to the preset', () => {
    assert.deepEqual(routerHealth({ ...base, lastRoute: route('preset', 'qwen/qwen3-30b-a3b-instruct-2507', 5) }, NOW), {
      level: 'ok', label: 'Healthy',
      next: 'os-chat preset · qwen3-30b-a3b-instruct-2507',
      last: 'qwen3-30b-a3b-instruct-2507 · main model · 5 min ago',
      credit: '$4.50',
    });
    assert.equal(routerHealth(base, NOW).last, 'Not used yet');
  });

  it('warns with no credit, and the next request goes to the free router', () => {
    const h = routerHealth({ ...base, credit: 0.004, lastRoute: route('free', 'meta-llama/llama-3.3-70b-instruct:free', 120) }, NOW);
    assert.deepEqual([h.level, h.label, h.next, h.last, h.credit], ['warn', 'No credit: using free models', 'Free router · no credit for the preset', 'llama-3.3-70b-instruct:free · free router · 2 h ago', '$0.00']);
  });

  it('warns when a backup or a free model answered last, even with credit', () => {
    assert.equal(routerHealth({ ...base, lastRoute: route('backup', 'google/gemma-3-12b-it', 1) }, NOW).label, 'Main model was unavailable last time');
    assert.equal(routerHealth({ ...base, lastRoute: route('free', 'acme/x:free', 1) }, NOW).label, 'Last answer came from a free model');
  });

  it('is down when the key is rejected or the last request failed, with the reason', () => {
    const rejected = routerHealth({ ...base, credit: null, creditError: 'the OpenRouter API key was rejected', keyRejected: true }, NOW);
    assert.deepEqual([rejected.level, rejected.label, rejected.next, rejected.credit], ['down', 'Key rejected', 'Nothing: the key was rejected', "Couldn't check"]);
    const failed = routerHealth({ ...base, lastRoute: route('failed', null, 60 * 26, 'OpenRouter couldn\'t be reached') }, NOW);
    assert.deepEqual([failed.level, failed.last], ['down', "Failed 1 d ago: OpenRouter couldn't be reached"]);
  });

  it("is unknown when credit can't be checked and nothing else is known", () => {
    const h = routerHealth({ ...base, credit: null, creditError: "OpenRouter couldn't be reached" }, NOW);
    assert.deepEqual([h.level, h.label, h.next], ['unknown', "Couldn't check OpenRouter", 'os-chat preset, or the free router without credit']);
  });
});
