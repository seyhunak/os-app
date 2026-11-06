import { Composio } from '@composio/core';

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

function rethrow(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b|rate.?limit/i.test(message)) throw new RateLimitError(message);
  throw error instanceof Error ? error : new Error(message);
}

export function createComposioGateway(apiKey: string, userId: string): ComposioGateway {
  const client = new Composio({ apiKey, allowTracking: false });

  return {
    async verify() {
      await client.connectedAccounts.list({ limit: 1 });
    },

    async listActiveAccounts() {
      const accounts: ConnectedAccount[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.connectedAccounts.list({
          userIds: [userId],
          statuses: ['ACTIVE'],
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const item of page.items) {
          accounts.push({ id: item.id, toolkit: item.toolkit.slug, label: item.alias || item.toolkit.slug });
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return accounts;
    },

    async authorize(toolkit) {
      const request = await client.toolkits.authorize(userId, toolkit);
      return { redirectUrl: request.redirectUrl ?? null };
    },

    async execute(slug, args, accountId) {
      try {
        const result = await client.tools.execute(slug, {
          userId,
          arguments: args,
          dangerouslySkipVersionCheck: true,
          ...(accountId ? { connectedAccountId: accountId } : {}),
        });
        if (!result.successful) throw new Error(result.error ?? `${slug} failed`);
        return result.data;
      } catch (error) {
        rethrow(error);
      }
    },

    async proxy({ accountId, endpoint, method, query, headers, body }) {
      const parameters = [
        ...Object.entries(query ?? {}).map(([name, value]) => ({ in: 'query' as const, name, value })),
        ...Object.entries(headers ?? {}).map(([name, value]) => ({ in: 'header' as const, name, value })),
      ];
      try {
        const result = await client.tools.proxyExecute({
          endpoint,
          method,
          connectedAccountId: accountId,
          ...(body === undefined ? {} : { body }),
          ...(parameters.length ? { parameters } : {}),
        });
        if (result.status >= 400) throw new Error(`HTTP ${result.status} from ${endpoint}`);
        return result.data;
      } catch (error) {
        rethrow(error);
      }
    },
  };
}
