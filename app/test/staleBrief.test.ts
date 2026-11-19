import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Brief } from '../src/api';
import { createAutoBrief, freshness, isStale, localDay, RETRY_AFTER_FAILURE_MS } from '../src/staleBrief';

// Built with the local-time constructor, so these hold in any timezone the tests run in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const brief = (createdAt: Date, id = 1): Brief => ({ id, kind: 'morning', trigger: 'manual', generator: 'ai', markdown: '', sources: [], createdAt: createdAt.toISOString() });

describe('date comparison', () => {
  it('uses the local calendar day', () => {
    assert.equal(localDay(at(8, 0, 5)), '2026-11-08');
    assert.equal(localDay(at(8, 23, 55)), '2026-11-08');
  });

  it('is stale from yesterday, even minutes before midnight', () => {
    assert.equal(isStale(at(7, 23, 50).toISOString(), at(8, 0, 10)), true);
  });

  it('is fresh from earlier today', () => {
    assert.equal(isStale(at(8, 0, 1).toISOString(), at(8, 23, 59)), false);
  });

  it('is stale across a month boundary', () => {
    assert.equal(isStale(new Date(2026, 9, 31, 22).toISOString(), new Date(2026, 10, 1, 7)), true);
  });

  it('says what to do', () => {
    const now = at(8, 9);
    assert.equal(freshness([], now), 'none');
    assert.equal(freshness([brief(at(8, 7))], now), 'fresh');
    assert.equal(freshness([brief(at(7, 7))], now), 'stale');
  });
});

describe('automatic brief', () => {
  it('starts once for a stale brief, and joins the running request', async () => {
    let calls = 0;
    const auto = createAutoBrief({ generate: async () => { calls++; return brief(at(8, 9), 2); }, now: () => at(8, 9) });
    const first = auto.maybeGenerate([brief(at(7, 7))]);
    assert.ok(first);
    assert.equal(auto.maybeGenerate([brief(at(7, 7))]), first);
    await first;
    assert.equal(auto.maybeGenerate([brief(at(7, 7))]), null, 'already written today');
    assert.equal(calls, 1);
  });

  it('does nothing with no briefs, or a fresh one', () => {
    const auto = createAutoBrief({ generate: async () => brief(at(8, 9)), now: () => at(8, 9) });
    assert.equal(auto.maybeGenerate([]), null);
    assert.equal(auto.maybeGenerate([brief(at(8, 7))]), null);
  });

  it('waits after a failure before trying again', async () => {
    let now = at(8, 9);
    let calls = 0;
    const auto = createAutoBrief({ generate: async () => { calls++; throw new Error('down'); }, now: () => now });
    await assert.rejects(auto.maybeGenerate([brief(at(7, 7))])!);
    assert.equal(auto.maybeGenerate([brief(at(7, 7))]), null);
    now = new Date(now.getTime() + RETRY_AFTER_FAILURE_MS + 1);
    await assert.rejects(auto.maybeGenerate([brief(at(7, 7))])!);
    assert.equal(calls, 2);
  });
});
