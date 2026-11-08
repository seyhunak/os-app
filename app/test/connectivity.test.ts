import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { ApiError, createApi, PROBE_TIMEOUT_MS } from '../src/api';
import { probe, TimeoutError, withTimeout } from '../src/connectivity';

const closers: Array<() => void> = [];
after(() => closers.forEach((close) => close()));

/** Accepts the connection and never answers, like a Tailscale route to a Mac that's asleep. */
async function blackHole(): Promise<string> {
  const sockets = new Set<import('node:net').Socket>();
  const server = createTcpServer((socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    sockets.forEach((s) => s.destroy());
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function answering(status: number): Promise<string> {
  const server: Server = createServer((_, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { model: 'x' } : { error: 'nope' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('startup probe', () => {
  it('waits 3 seconds by default', () => {
    assert.equal(PROBE_TIMEOUT_MS, 3_000);
  });

  it('gives up on an unresponsive server after 3 seconds and reports offline', async () => {
    const api = createApi({ url: await blackHole(), token: 't' });
    const started = Date.now();
    const reachable = await probe(() => api.ping());
    const elapsed = Date.now() - started;
    assert.equal(reachable, false);
    assert.ok(elapsed >= 2_900 && elapsed < 3_600, `took ${elapsed} ms`);
  });

  it('reports offline at once when nothing listens at the address', async () => {
    const url = await answering(200);
    closers.pop()!();
    await new Promise((r) => setTimeout(r, 50));
    const api = createApi({ url, token: 't' });
    const started = Date.now();
    assert.equal(await probe(() => api.ping()), false);
    assert.ok(Date.now() - started < 1_000);
  });

  it('treats a 502 from the tunnel as offline', async () => {
    const api = createApi({ url: await answering(502), token: 't' });
    assert.equal(await probe(() => api.ping()), false);
  });

  it('reports online when the server answers, even with an error', async () => {
    const ok = createApi({ url: await answering(200), token: 't' });
    const signedOut = createApi({ url: await answering(401), token: 't' });
    assert.equal(await probe(() => ok.ping()), true);
    assert.equal(await probe(() => signedOut.ping()), true);
  });

  it('enforces the limit even if a request ignores its abort signal', async () => {
    const started = Date.now();
    assert.equal(await probe(() => new Promise(() => undefined), 200), false);
    assert.ok(Date.now() - started < 400);
    await assert.rejects(withTimeout(new Promise(() => undefined), 50), TimeoutError);
  });

  it('counts a network failure as offline', async () => {
    assert.equal(await probe(async () => { throw new ApiError('down', 0); }), false);
  });
});
