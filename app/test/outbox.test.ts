import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { after, describe, it } from 'node:test';
import { ApiError, createApi } from '../src/api';
import { archivedIds, createOutbox, queueAndSend, type Op } from '../src/outbox';

const memory = (initial?: unknown[]) => {
  let value = initial as Op[] | undefined;
  return { load: async () => value, save: async (ops: Op[]) => void (value = ops), peek: () => value };
};
const update = (id: string, text = id): Op => ({ kind: 'update', clientId: id, text, createdAt: '2026-11-08T10:00:00.000Z' });
const offline = () => new ApiError('down', 0);

function server() {
  let reachable = false;
  const sent: Op[] = [];
  return {
    sent,
    setReachable: (r: boolean) => (reachable = r),
    send: async (op: Op) => {
      if (!reachable) throw offline();
      sent.push(op);
    },
  };
}

describe('outbox queue', () => {
  it('keeps changes while offline and replays them in order once back', async () => {
    const storage = memory();
    const srv = server();
    const box = createOutbox({ storage, send: srv.send });
    await box.add(update('a'));
    await box.add({ kind: 'archive', clientId: 'b', ids: [3] });
    await box.add(update('c'));
    assert.equal(await box.flush(), 'offline');
    assert.equal((await box.list()).length, 3);
    srv.setReachable(true);
    assert.equal(await box.flush(), 'sent');
    assert.deepEqual(srv.sent.map((o) => o.clientId), ['a', 'b', 'c']);
    assert.deepEqual(await box.list(), []);
  });

  it('survives a restart: a new outbox on the same storage sends what was left', async () => {
    const storage = memory();
    await createOutbox({ storage, send: async () => { throw offline(); } }).add(update('a'));
    const srv = server();
    srv.setReachable(true);
    await createOutbox({ storage, send: srv.send }).flush();
    assert.deepEqual(srv.sent.map((o) => o.clientId), ['a']);
  });

  it('reads updates queued before ops had a kind', async () => {
    const storage = memory([{ clientId: 'old', text: 'legacy', createdAt: '2026-11-01T00:00:00.000Z' }]);
    const srv = server();
    srv.setReachable(true);
    await createOutbox({ storage, send: srv.send }).flush();
    assert.deepEqual(srv.sent, [{ kind: 'update', clientId: 'old', text: 'legacy', createdAt: '2026-11-01T00:00:00.000Z' }]);
  });

  it('adds a client id only once', async () => {
    const box = createOutbox({ storage: memory(), send: async () => { throw offline(); } });
    await box.add(update('a'));
    await box.add(update('a'));
    assert.equal((await box.list()).length, 1);
  });

  it('sends each change once when flushes overlap', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const box = createOutbox({ storage: memory(), send: async () => { calls++; await gate; } });
    await box.add(update('a'));
    const runs = [box.flush(), box.flush(), box.flush()];
    assert.equal(runs[0], runs[1]);
    release();
    await Promise.all(runs);
    assert.equal(calls, 1);
  });

  it('stops at the first outage and keeps the rest', async () => {
    let n = 0;
    const box = createOutbox({ storage: memory(), send: async () => { if (++n > 1) throw offline(); } });
    await box.add(update('a'));
    await box.add(update('b'));
    assert.equal(await box.flush(), 'offline');
    assert.deepEqual((await box.list()).map((o) => o.clientId), ['b']);
  });

  it('drops a change the server refuses for good, so it can\'t block the queue', async () => {
    const sent: string[] = [];
    const box = createOutbox({ storage: memory(), send: async (op) => { if (op.clientId === 'bad') throw new ApiError('too long', 400); sent.push(op.clientId); } });
    await box.add(update('bad'));
    await box.add(update('good'));
    assert.equal(await box.flush(), 'sent');
    assert.deepEqual(sent, ['good']);
  });

  it('keeps everything when signed out', async () => {
    const box = createOutbox({ storage: memory(), send: async () => { throw new ApiError('signed out', 401); } });
    await box.add(update('a'));
    assert.equal(await box.flush(), 'signed-out');
    assert.equal((await box.list()).length, 1);
  });

  it('a change added during a send is kept', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const box = createOutbox({ storage: memory(), send: async () => gate });
    await box.add(update('a'));
    const run = box.flush();
    await box.add(update('b'));
    release();
    await run;
    assert.deepEqual(await box.list(), []);
  });

  it('replays an offline brief and an update in the order they were made, once each', async () => {
    const storage = memory();
    const srv = server();
    const box = createOutbox({ storage, send: srv.send });
    const draft = { clientId: 'brief-1', kind: 'morning' as const, generator: 'digest' as const, markdown: '# Good morning', sources: [], createdAt: '2026-11-08T08:00:00.000Z' };
    await box.add(update('u1'));
    await box.add({ kind: 'brief', clientId: 'brief-1', id: -5, draft });
    await box.add({ kind: 'brief', clientId: 'brief-1', id: -5, draft });
    assert.equal(await box.flush(), 'offline');
    srv.setReachable(true);
    await box.flush();
    await box.flush();
    assert.deepEqual(srv.sent.map((o) => `${o.kind}:${o.clientId}`), ['update:u1', 'brief:brief-1']);
    assert.equal((srv.sent[0] as Extract<Op, { kind: 'update' }>).createdAt, '2026-11-08T10:00:00.000Z');
  });

  it('drops a draft deleted before it synced', async () => {
    const box = createOutbox({ storage: memory(), send: async () => { throw offline(); } });
    const draft = { clientId: 'b', kind: 'morning' as const, generator: 'digest' as const, markdown: 'x', sources: [], createdAt: '2026-11-08T08:00:00.000Z' };
    await box.add({ kind: 'brief', clientId: 'b', id: -9, draft });
    await box.add(update('u'));
    await box.remove((op) => op.kind === 'brief' && op.id === -9);
    assert.deepEqual((await box.list()).map((o) => o.clientId), ['u']);
  });

  it('lists ids waiting to be archived', () => {
    assert.deepEqual([...archivedIds([update('a'), { kind: 'archive', clientId: 'b', ids: [1, 2] }, { kind: 'archive', clientId: 'c', ids: [5] }])], [1, 2, 5]);
  });
});

describe('saving never hangs', () => {
  const closers: Array<() => void> = [];
  after(() => closers.forEach((c) => c()));

  it('offline: queues and returns at once without waiting on the network', async () => {
    const box = createOutbox({ storage: memory(), send: () => new Promise(() => undefined) });
    const started = Date.now();
    assert.equal(await queueAndSend(box, update('a'), false), true);
    assert.ok(Date.now() - started < 100);
  });

  it('online but the server hangs: falls back to the queue after the save timeout', async () => {
    const box = createOutbox({ storage: memory(), send: () => new Promise(() => undefined) });
    const started = Date.now();
    assert.equal(await queueAndSend(box, update('a'), true, 300), true);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 290 && elapsed < 600, `took ${elapsed} ms`);
    assert.equal((await box.list()).length, 1);
  });

  it('online and the server answers: sent, nothing left queued', async () => {
    const box = createOutbox({ storage: memory(), send: async () => undefined });
    assert.equal(await queueAndSend(box, update('a'), true), false);
  });

  it('a real update send to a tunnel that never answers gives up, so the queue is retried later', async () => {
    const sockets = new Set<Socket>();
    const tcp = createServer((s) => sockets.add(s));
    await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
    closers.push(() => { sockets.forEach((s) => s.destroy()); tcp.close(); });
    const api = createApi({ url: `http://127.0.0.1:${(tcp.address() as AddressInfo).port}`, token: 't' });
    const box = createOutbox({ storage: memory(), send: (op) => api.addUpdate((op as Extract<Op, { kind: 'update' }>).text, { clientId: op.clientId, createdAt: '2026-11-08T10:00:00.000Z' }) });
    const started = Date.now();
    assert.equal(await queueAndSend(box, update('a'), true, 500), true);
    assert.ok(Date.now() - started < 1_000);
    // The send itself has its own limit (8 s), after which the run reports offline and keeps the update.
    assert.equal(await box.flush(), 'offline');
    assert.equal((await box.list()).length, 1);
  });
});
