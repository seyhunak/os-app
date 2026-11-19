import { timeoutSignal } from './compose';

export interface ConnectedAccount {
  id: string;
  toolkit: string;
  label: string;
}

export interface ProxyRequest {
  accountId: string;
  endpoint: string;
  method: 'GET' | 'POST';
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  body?: unknown;
}

/** The small part of Composio OS relies on. Read-only by construction: collectors only call read tools. */
export interface ComposioGateway {
  verify(): Promise<void>;
  listActiveAccounts(): Promise<ConnectedAccount[]>;
  authorize(toolkit: string): Promise<{ redirectUrl: string | null }>;
  execute(slug: string, args: Record<string, unknown>, accountId?: string): Promise<Record<string, unknown>>;
  proxy(request: ProxyRequest): Promise<unknown>;
}

export class RateLimitError extends Error {}

/** The Composio user your tools are connected under. The old server used the same one, so existing connections carry over. */
export const COMPOSIO_USER_ID = 'default';
const BASE_URL = 'https://backend.composio.dev/api/v3.1';
const TIMEOUT_MS = 60_000;

type Json = Record<string, unknown>;

/**
 * Composio's REST API, called straight from the phone. Their SDK is built for Node, so this does
 * the same few calls with fetch. Only the API key header is needed.
 */
export function createComposioGateway(apiKey: string, userId = COMPOSIO_USER_ID, fetchImpl: typeof fetch = fetch): ComposioGateway {
  async function call<T = Json>(method: 'GET' | 'POST', path: string, options: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    const query = Object.entries(options.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}${query ? `?${query}` : ''}`, {
        method,
        signal: timeoutSignal(TIMEOUT_MS),
        headers: { 'x-api-key': apiKey, Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new Error("Couldn't reach Composio");
    }
    const data = (await response.json().catch(() => null)) as Json | null;
    if (!response.ok) {
      const error = data?.error as Json | string | undefined;
      const detail = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : typeof data?.message === 'string' ? data.message : '';
      const text = `Composio returned ${response.status}${detail ? `: ${detail}` : ''}`;
      if (response.status === 429) throw new RateLimitError(text);
      throw new Error(text);
    }
    return (data ?? {}) as T;
  }

  const rethrow = (error: unknown): never => {
    if (error instanceof RateLimitError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/\b429\b|rate.?limit/i.test(message)) throw new RateLimitError(message);
    throw error instanceof Error ? error : new Error(message);
  };

  return {
    async verify() {
      await call('GET', '/connected_accounts', { query: { limit: 1 } });
    },

    async listActiveAccounts() {
      const accounts: ConnectedAccount[] = [];
      let cursor: string | undefined;
      do {
        const page = await call<{ items?: Array<{ id: string; alias?: string | null; toolkit?: { slug?: string } }>; next_cursor?: string | null }>('GET', '/connected_accounts', {
          query: { user_ids: userId, statuses: 'ACTIVE', limit: 100, cursor },
        });
        for (const item of page.items ?? []) {
          const toolkit = item.toolkit?.slug ?? '';
          accounts.push({ id: item.id, toolkit, label: item.alias || toolkit });
        }
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      return accounts;
    },

    /** Finds or makes a Composio-managed sign-in for the tool, then asks for a link to open in the browser. */
    async authorize(toolkit) {
      const configs = await call<{ items?: Array<{ id: string }> }>('GET', '/auth_configs', { query: { toolkit_slug: toolkit } });
      let authConfigId = configs.items?.[0]?.id;
      if (!authConfigId) {
        const details = await call<{ name?: string }>('GET', `/toolkits/${encodeURIComponent(toolkit)}`);
        const created = await call<{ auth_config?: { id?: string } }>('POST', '/auth_configs', {
          body: { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth', name: `${details.name ?? toolkit} Auth Config` } },
        });
        authConfigId = created.auth_config?.id;
      }
      if (!authConfigId) throw new Error(`No sign-in is set up for ${toolkit} in Composio`);
      const link = await call<{ redirect_url?: string | null }>('POST', '/connected_accounts/link', { body: { auth_config_id: authConfigId, user_id: userId } });
      return { redirectUrl: link.redirect_url ?? null };
    },

    async execute(slug, args, accountId) {
      try {
        const result = await call<{ data?: Json; successful?: boolean; error?: string | null }>('POST', `/tools/execute/${encodeURIComponent(slug)}`, {
          body: { user_id: userId, arguments: args, version: 'latest', ...(accountId ? { connected_account_id: accountId } : {}) },
        });
        if (!result.successful) throw new Error(result.error ?? `${slug} failed`);
        return result.data ?? {};
      } catch (error) {
        return rethrow(error);
      }
    },

    async proxy({ accountId, endpoint, method, query, headers, body }) {
      const parameters = [
        ...Object.entries(query ?? {}).map(([name, value]) => ({ name, type: 'query', value: String(value) })),
        ...Object.entries(headers ?? {}).map(([name, value]) => ({ name, type: 'header', value: String(value) })),
      ];
      try {
        const result = await call<{ status: number; data?: unknown }>('POST', '/tools/execute/proxy', {
          body: { endpoint, method, connected_account_id: accountId, parameters, ...(body === undefined ? {} : { body }) },
        });
        if (result.status >= 400) throw new Error(`HTTP ${result.status} from ${endpoint}`);
        return result.data;
      } catch (error) {
        return rethrow(error);
      }
    },
  };
}
