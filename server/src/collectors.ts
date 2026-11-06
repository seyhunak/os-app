import { RateLimitError, type ComposioGateway, type ConnectedAccount } from './composio.ts';

export interface Toolkit {
  slug: string;
  name: string;
  description: string;
  noAuth?: boolean;
  /** Read-only. Returns distilled facts, never raw API responses. */
  collect(gateway: ComposioGateway, account: ConnectedAccount | null, now: Date): Promise<unknown[]>;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {});
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clip = (v: unknown, max = 200): string => {
  const text = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const AI_TERMS = /\b(ai|llm|gpt|claude|anthropic|openai|gemini|mistral|agents?|machine learning|inference|model)\b/i;

export const TOOLKITS: Toolkit[] = [
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Commitments, requests and deadlines from recent mail',
    async collect(gateway, account) {
      const data = await gateway.execute('GMAIL_FETCH_EMAILS', { max_results: 10, query: 'newer_than:3d', user_id: 'me' }, account?.id);
      return asList(data.messages).map((raw) => {
        const m = asDict(raw);
        return {
          account: account?.label,
          from: clip(m.sender, 120),
          subject: clip(m.subject, 160),
          date: clip(m.messageTimestamp, 40),
          unread: asList(m.labelIds).includes('UNREAD'),
          snippet: clip(asDict(m.preview).body ?? m.messageText, 200),
        };
      });
    },
  },
  {
    slug: 'googlecalendar',
    name: 'Google Calendar',
    description: 'Your next 7 days: meetings, conflicts and free time',
    async collect(gateway, account, now) {
      const data = asDict(await gateway.proxy({
        accountId: account!.id,
        endpoint: '/calendars/primary/events',
        method: 'GET',
        query: {
          timeMin: now.toISOString(),
          timeMax: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: 25,
        },
      }));
      return asList(data.items).map((raw) => {
        const e = asDict(raw);
        return {
          account: account?.label,
          title: clip(e.summary, 160),
          start: asDict(e.start).dateTime ?? asDict(e.start).date,
          end: asDict(e.end).dateTime ?? asDict(e.end).date,
          attendees: asList(e.attendees).length,
        };
      });
    },
  },
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Issues and pull requests assigned to you',
    async collect(gateway, account) {
      const data = await gateway.proxy({
        accountId: account!.id,
        endpoint: 'https://api.github.com/issues',
        method: 'GET',
        query: { filter: 'assigned', state: 'open', sort: 'updated', per_page: 20 },
      });
      return asList(data).map((raw) => {
        const i = asDict(raw);
        return {
          repo: clip(asDict(i.repository).full_name, 100),
          title: clip(i.title, 160),
          type: i.pull_request ? 'pull_request' : 'issue',
          updated: i.updated_at,
        };
      });
    },
  },
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Recent messages from channels you belong to',
    async collect(gateway, account) {
      const list = await gateway.execute('SLACK_LIST_CONVERSATIONS', { limit: 50, exclude_archived: true }, account?.id);
      // Slack can leave out is_member, so only skip channels it says you're not in.
      const channels = asList(list.channels).map(asDict).filter((c) => c.is_member !== false).slice(0, 5);
      const facts: unknown[] = [];
      let readable = 0;
      let lastError: unknown;
      for (const channel of channels) {
        try {
          const history = await gateway.execute('SLACK_FETCH_CONVERSATION_HISTORY', { channel: channel.id, limit: 10 }, account?.id);
          readable++;
          for (const raw of asList(history.messages)) {
            facts.push({ channel: clip(channel.name, 80), text: clip(asDict(raw).text), ts: asDict(raw).ts });
          }
        } catch (error) {
          // One private channel shouldn't lose the rest, but a rate limit must still stop this tool.
          if (error instanceof RateLimitError) throw error;
          lastError = error;
        }
      }
      if (channels.length && !readable) throw lastError;
      return facts;
    },
  },
  {
    slug: 'todoist',
    name: 'Todoist',
    description: 'Open tasks, due dates and priorities',
    async collect(gateway, account) {
      const data = asDict(await gateway.proxy({ accountId: account!.id, endpoint: '/api/v1/tasks', method: 'GET', query: { limit: 200 } }));
      return asList(data.results).map((raw) => {
        const t = asDict(raw);
        return { task: clip(t.content, 160), due: asDict(t.due).date ?? null, priority: t.priority };
      });
    },
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Issues and their current state',
    async collect(gateway, account) {
      const query = 'query { issues(first: 50) { nodes { identifier title priority updatedAt state { name type } team { name } } } }';
      const data = asDict(await gateway.proxy({ accountId: account!.id, endpoint: '/graphql', method: 'POST', body: { query } }));
      return asList(asDict(asDict(data.data).issues).nodes).map((raw) => {
        const i = asDict(raw);
        return {
          id: clip(i.identifier, 30),
          title: clip(i.title, 160),
          state: clip(asDict(i.state).name, 40),
          team: clip(asDict(i.team).name, 60),
          priority: i.priority,
          updated: i.updatedAt,
        };
      });
    },
  },
  {
    slug: 'hackernews',
    name: 'Hacker News',
    description: 'AI stories from the front page. No account needed',
    noAuth: true,
    async collect(gateway) {
      const top = await gateway.execute('HACKERNEWS_GET_TOP_STORIES', {});
      // The response wraps the id list under a key that isn't documented, so take the first list found.
      const ids = Object.values(top).map(asList).find((list) => list.length)?.slice(0, 60) ?? [];
      const stories = await Promise.all(ids.map(async (id) => {
        const data = asDict(await gateway.execute('HACKERNEWS_GET_ITEM', { id }));
        return asDict(data.item ?? data.response_data ?? data);
      }));
      return stories
        .filter((s) => typeof s.title === 'string' && AI_TERMS.test(s.title))
        .slice(0, 10)
        .map((s) => ({ title: clip(s.title), score: s.score, url: s.url }));
    },
  },
];

export const toolkitBySlug = (slug: string): Toolkit | undefined => TOOLKITS.find((t) => t.slug === slug);
