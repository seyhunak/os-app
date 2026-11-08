import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Brief } from '../src/api';
import { createAutoBrief, freshness, isStale, localDay, RETRY_AFTER_FAILURE_MS } from '../src/staleBrief';

// Built with the local-time constructor, so these hold in any timezone the tests run in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const brief = (createdAt: Date, id = 1, trigger: Brief['trigger'] = 'manual'): Brief => ({ id, kind: 'morning', trigger, generator: 'ai', markdown: '', sources: [], createdAt: createdAt.toISOString() });
const draft = (createdAt: Date, id = -1) => brief(createdAt, id, 'offline');
const flush = () => new Promise((r) => setImmediate(r));

describe('date comparison', () => {
  it('uses the local calendar day', () => {
    assert.equal(localDay(at(8, 0, 5)), '2026-11-08');
    assert.equal(localDay(at(8, 23, 55)), '2026-11-08');
  });

  it('is stale from yesterday, even minutes before midnight', () => {
    assert.equal(isStale(at(7, 23, 50).toISOString(), at(8, 0, 10)), true);
    assert.equal(isStale(at(1, 9).toISOString(), at(8, 9)), true);
  });

  it('is fresh from earlier today', () => {
    assert.equal(isStale(at(8, 0, 1).toISOString(), at(8, 23, 59)), false);
  });

  it('is stale across a month boundary', () => {
    assert.equal(isStale(new Date(2026, 9, 31, 22).toISOString(), new Date(2026, 10, 1, 7)), true);
  });

  it('says what to do', () => {
    const now = at(8, 9);
    assert.equal(freshness([], true, now), 'none');
    assert.equal(freshness([brief(at(8, 7))], true, now), 'fresh');
    assert.equal(freshness([brief(at(7, 7))], true, now), 'stale-online');
    assert.equal(freshness([brief(at(7, 7))], false, now), 'stale-offline');
  });

  it("offline, today's draft counts as today's brief", () => {
    assert.equal(freshness([draft(at(8, 7)), brief(at(7, 7))], false, at(8, 9)), 'fresh');
  });

  it("online, today's draft doesn't count, so the server still writes today's real brief", () => {
    assert.equal(freshness([draft(at(8, 7)), brief(at(7, 7))], true, at(8, 9)), 'stale-online');
    assert.equal(freshness([draft(at(8, 7))], true, at(8, 9)), 'stale-online');
  });
});

describe('auto generation', () => {
  function setup(now = at(8, 9)) {
    let clock = now;
    const calls: Array<{ resolve(b: Brief): void; reject(e: Error): void; online: boolean }> = [];
    let count = 0;
    const auto = createAutoBrief({
      generate: (online) => {
        count++;
        return new Promise<Brief>((resolve, reject) => calls.push({ resolve, reject, online }));
      },
      now: () => clock,
    });
    return { auto, calls, count: () => count, setClock: (d: Date) => (clock = d) };
  }

  it('starts once however many times the screen asks', async () => {
    const { auto, calls, count } = setup();
    const stale = brief(at(7, 7));
    const first = auto.maybeGenerate([stale], true);
    for (let i = 0; i < 5; i++) assert.equal(auto.maybeGenerate([stale], true), first);
    assert.equal(count(), 1);
    assert.equal(auto.pending(), first);
    calls[0].resolve(brief(at(8, 9), 2));
    assert.equal((await first)!.id, 2);
    assert.equal(auto.pending(), null);
  });

  it('does not start again the same day once today\'s was written', async () => {
    const { auto, calls, count } = setup();
    const p = auto.maybeGenerate([brief(at(7, 7))], true);
    calls[0].resolve(brief(at(8, 9), 2));
    await p;
    // Even if the list still shows the old one, e.g. the server's day differs from the phone's.
    assert.equal(auto.maybeGenerate([brief(at(7, 7))], true), null);
    assert.equal(count(), 1);
  });

  it('does nothing when today\'s brief already exists', () => {
    const { auto, count } = setup();
    assert.equal(auto.maybeGenerate([brief(at(8, 6))], true), null);
    assert.equal(count(), 0);
  });

  it('offline writes one draft a day, then back online asks the server once', async () => {
    const { auto, calls, count } = setup();
    const offline = auto.maybeGenerate([brief(at(7, 7))], false)!;
    assert.equal(calls[0].online, false);
    calls[0].resolve(draft(at(8, 9)));
    await offline;
    // Reopening offline the same day writes nothing more.
    assert.equal(auto.maybeGenerate([draft(at(8, 9)), brief(at(7, 7))], false), null);
    assert.equal(auto.maybeGenerate([brief(at(7, 7))], false), null);
    // Back online: the draft didn't read tools, so the server writes today's, once.
    const online = auto.maybeGenerate([draft(at(8, 9)), brief(at(7, 7))], true)!;
    assert.equal(calls[1].online, true);
    calls[1].resolve(brief(at(8, 10), 5));
    await online;
    assert.equal(auto.maybeGenerate([draft(at(8, 9)), brief(at(7, 7))], true), null);
    assert.equal(count(), 2);
  });

  it('does nothing without any brief', () => {
    const { auto, count } = setup();
    assert.equal(auto.maybeGenerate([], true), null);
    assert.equal(count(), 0);
  });

  it('waits after a failure instead of retrying on every render', async () => {
    const { auto, calls, count, setClock } = setup();
    const stale = brief(at(7, 7));
    const p = auto.maybeGenerate([stale], true)!;
    calls[0].reject(new Error('boom'));
    await assert.rejects(p);
    await flush();
    assert.equal(auto.maybeGenerate([stale], true), null);
    setClock(new Date(at(8, 9).getTime() + RETRY_AFTER_FAILURE_MS + 1));
    assert.notEqual(auto.maybeGenerate([stale], true), null);
    assert.equal(count(), 2);
  });

  it('starts again on the next day', async () => {
    const { auto, calls, count, setClock } = setup();
    const p = auto.maybeGenerate([brief(at(7, 7))], true);
    calls[0].resolve(brief(at(8, 9), 2));
    await p;
    setClock(at(9, 8));
    assert.notEqual(auto.maybeGenerate([brief(at(8, 9), 2)], true), null);
    assert.equal(count(), 2);
  });
});
