import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createComposioGateway, RateLimitError } from '../src/core/composio';

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('Composio over REST', () => {
  it('sends the key header and pages through active accounts', async () => {
    const { calls, impl } = fakeFetch([
      { body: { items: [{ id: 'ca_1', alias: 'Work', toolkit: { slug: 'gmail' } }], next_cursor: 'next' } },
      { body: { items: [{ id: 'ca_2', alias: null, toolkit: { slug: 'github' } }], next_cursor: null } },
    ]);
    const accounts = await createComposioGateway('ak_test_key', 'default', impl).listActiveAccounts();
    assert.deepEqual(accounts, [{ id: 'ca_1', toolkit: 'gmail', label: 'Work' }, { id: 'ca_2', toolkit: 'github', label: 'github' }]);
    assert.equal(calls[0]!.headers['x-api-key'], 'ak_test_key');
    assert.equal(calls[0]!.url, 'https://backend.composio.dev/api/v3.1/connected_accounts?user_ids=default&statuses=ACTIVE&limit=100');
    assert.match(calls[1]!.url, /&cursor=next$/);
  });

  it('executes a tool with the latest version for this user and account', async () => {
    const { calls, impl } = fakeFetch([{ body: { successful: true, data: { messages: [] }, error: null } }]);
    const data = await createComposioGateway('ak_key', 'default', impl).execute('GMAIL_FETCH_EMAILS', { max_results: 5 }, 'ca_1');
    assert.deepEqual(data, { messages: [] });
    assert.equal(calls[0]!.url, 'https://backend.composio.dev/api/v3.1/tools/execute/GMAIL_FETCH_EMAILS');
    assert.deepEqual(calls[0]!.body, { user_id: 'default', arguments: { max_results: 5 }, version: 'latest', connected_account_id: 'ca_1' });
  });

  it('reports a failed tool, and a 429 as a rate limit', async () => {
    const failed = fakeFetch([{ body: { successful: false, error: 'No access' } }]);
    await assert.rejects(createComposioGateway('k'.repeat(10), 'default', failed.impl).execute('X', {}), /No access/);
    const limited = fakeFetch([{ status: 429, body: { error: { message: 'Too many requests' } } }]);
    await assert.rejects(createComposioGateway('k'.repeat(10), 'default', limited.impl).execute('X', {}), RateLimitError);
  });

  it('proxies with query and header parameters as strings', async () => {
    const { calls, impl } = fakeFetch([{ body: { status: 200, data: { ok: true } } }]);
    const data = await createComposioGateway('ak_key', 'default', impl).proxy({ accountId: 'ca_1', endpoint: '/me', method: 'GET', query: { limit: 5 }, headers: { 'X-A': 'b' } });
    assert.deepEqual(data, { ok: true });
    assert.deepEqual(calls[0]!.body, { endpoint: '/me', method: 'GET', connected_account_id: 'ca_1', parameters: [{ name: 'limit', type: 'query', value: '5' }, { name: 'X-A', type: 'header', value: 'b' }] });
  });

  it('treats an error status from the proxied API as a failure', async () => {
    const { impl } = fakeFetch([{ body: { status: 429, data: {} } }]);
    await assert.rejects(createComposioGateway('ak_key', 'default', impl).proxy({ accountId: 'ca_1', endpoint: '/me', method: 'GET' }), RateLimitError);
  });

  it('connects a tool through its existing sign-in config', async () => {
    const { calls, impl } = fakeFetch([{ body: { items: [{ id: 'ac_1' }] } }, { body: { redirect_url: 'https://connect.composio.dev/x' } }]);
    assert.deepEqual(await createComposioGateway('ak_key', 'default', impl).authorize('gmail'), { redirectUrl: 'https://connect.composio.dev/x' });
    assert.match(calls[0]!.url, /\/auth_configs\?toolkit_slug=gmail$/);
    assert.deepEqual(calls[1]!.body, { auth_config_id: 'ac_1', user_id: 'default' });
  });

  it('makes a Composio-managed sign-in config when there is none', async () => {
    const { calls, impl } = fakeFetch([
      { body: { items: [] } },
      { body: { name: 'GitHub' } },
      { body: { auth_config: { id: 'ac_new' } } },
      { body: { redirect_url: 'https://connect.composio.dev/y' } },
    ]);
    await createComposioGateway('ak_key', 'default', impl).authorize('github');
    assert.deepEqual(calls[2]!.body, { toolkit: { slug: 'github' }, auth_config: { type: 'use_composio_managed_auth', name: 'GitHub Auth Config' } });
    assert.equal((calls[3]!.body as { auth_config_id: string }).auth_config_id, 'ac_new');
  });

  it('turns an unreachable network into a plain error', async () => {
    const impl = (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    await assert.rejects(createComposioGateway('ak_key', 'default', impl).verify(), /Couldn't reach Composio/);
  });
});
