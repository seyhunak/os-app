import { RateLimitError, type ComposioGateway, type ConnectedAccount } from './composio.ts';

export interface Toolkit {
  slug: string;
  name: string;
  description: string;
  noAuth?: boolean;
  /** Read-only. Returns distilled facts, never raw API responses. */
  collect(gateway: ComposioGateway, account: ConnectedAccount | null, now: Date, timeZone: string): Promise<unknown[]>;
  /** What a brief may use, including from a pull saved before today's limits, or across several accounts. */
  keep?(items: unknown[], now: Date, timeZone: string): unknown[];
  /** A sentence or two about what was read, used when the AI didn't write one. Never a list of items. */
  summarize(items: Dict[], timeZone: string): string;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {});
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clip = (v: unknown, max = 200): string => {
  const text = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const LAST_EMAILS = 5;
const MEETINGS_NAMED = 3;
const ATTENDEES_KEPT = 8;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const joinNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const distinct = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))];
const senderName = (from: unknown) => clip(from).replace(/\s*<[^>]*>\s*$/, '');

/** The moment next Monday starts in this timezone, which is where "this week" ends. */
export function endOfWeek(now: Date, timeZone: string): Date {
  const parts = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const today = parts(now);
  const daysLeft = 7 - ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(today.weekday!);
  const midnightUtc = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + daysLeft);
  const there = parts(new Date(midnightUtc));
  const offset = Date.UTC(Number(there.year), Number(there.month) - 1, Number(there.day), Number(there.hour), Number(there.minute), Number(there.second)) - midnightUtc;
  return new Date(midnightUtc - offset);
}

const summarizeTasks = (items: Dict[]) => {
  const dated = items.filter((t) => typeof t.due === 'string' && t.due).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const next = dated[0];
  return `${plural(items.length, 'open task')}, ${dated.length} with a due date.${next ? ` Next due: ${clip(next.task, 80)} on ${next.due}.` : ''}`;
};

const RECENT_DAYS = 7;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const keepLastEmails = (items: unknown[]) => {
  const time = (item: unknown) => Date.parse(String(asDict(item).date)) || 0;
  return [...items].sort((a, b) => time(b) - time(a)).slice(0, LAST_EMAILS);
};

const summarizeEmails = (items: Dict[]) => {
  const unread = items.filter((m) => m.unread).length;
  const latest = items[0]!;
  const sender = senderName(latest.from);
  return `${items.length === 1 ? 'Last email' : `Last ${items.length} emails`}, ${unread} unread. Latest: ${clip(latest.subject, 90)}${sender ? ` from ${sender}` : ''}.`;
};

const keepThisWeek = (items: unknown[], now: Date, timeZone: string) => {
  const end = endOfWeek(now, timeZone).getTime();
  return items.filter((item) => !(Date.parse(String(asDict(item).start)) >= end));
};

const summarizeMeetings = (items: Dict[], timeZone: string) => {
  const named = items.slice(0, MEETINGS_NAMED).map((e) => {
    const start = new Date(String(e.start));
    const day = Number.isNaN(start.getTime()) ? '' : ` (${new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(start)})`;
    const people = Array.isArray(e.attendees) ? joinNames(e.attendees as string[]) : '';
    return `${clip(e.title, 60) || 'Untitled'}${day}${people ? ` with ${people}` : ''}`;
  });
  const more = items.length - named.length;
  return `${plural(items.length, 'meeting')} this week: ${named.join('; ')}${more > 0 ? `, and ${more} more` : ''}.`;
};

const summarizeIssues = (items: Dict[]) => {
  const states = new Map<string, number>();
  for (const i of items) states.set(String(i.state || 'No state'), (states.get(String(i.state || 'No state')) ?? 0) + 1);
  const top = [...states].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([state, n]) => `${n} ${state}`);
  return `${plural(items.length, 'issue')}: ${top.join(', ')}.`;
};

const summarizeCode = (review: string) => (items: Dict[]) => {
  const reviews = items.filter((i) => i.type === review.replaceAll(' ', '_')).length;
  const repos = distinct(items.map((i) => i.repo));
  return `${plural(reviews, review)} and ${plural(items.length - reviews, 'issue')} assigned to you, across ${joinNames(repos.slice(0, 3))}${repos.length > 3 ? ` and ${repos.length - 3} more` : ''}.`;
};

const summarizeEdits = (noun: string) => (items: Dict[]) => `${plural(items.length, noun)} changed in the last ${RECENT_DAYS} days. Latest: ${clip(items[0]!.title, 90) || 'Untitled'}.`;

const AI_TERMS = /\b(ai|llm|gpt|claude|anthropic|openai|gemini|mistral|agents?|machine learning|inference|model)\b/i;

export const TOOLKITS: Toolkit[] = [
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Commitments, requests and deadlines from your last 5 emails',
    async collect(gateway, account) {
      const data = await gateway.execute('GMAIL_FETCH_EMAILS', { max_results: LAST_EMAILS, query: 'newer_than:3d', user_id: 'me' }, account?.id);
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
    keep: keepLastEmails,
    summarize: summarizeEmails,
  },
  {
    slug: 'googlecalendar',
    name: 'Google Calendar',
    description: 'This week: meeting topics and who attends',
    async collect(gateway, account, now, timeZone) {
      const data = asDict(await gateway.proxy({
        accountId: account!.id,
        endpoint: '/calendars/primary/events',
        method: 'GET',
        query: {
          timeMin: now.toISOString(),
          timeMax: endOfWeek(now, timeZone).toISOString(),
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
          // Names only: other people's addresses aren't needed, and rooms and you aren't attendees.
          attendees: asList(e.attendees).map(asDict).filter((a) => !a.self && !a.resource)
            .map((a) => clip(a.displayName, 60) || clip(a.email, 120).split('@')[0]).filter(Boolean).slice(0, ATTENDEES_KEPT),
        };
      });
    },
    keep: keepThisWeek,
    summarize: summarizeMeetings,
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
    summarize: summarizeCode('pull request'),
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
    summarize(items) {
      return `${plural(items.length, 'recent message')} across ${joinNames(distinct(items.map((m) => m.channel)).map((c) => `#${c}`))}.`;
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
    summarize: summarizeTasks,
  },
  {
    slug: 'googletasks',
    name: 'Google Tasks',
    description: 'Open tasks and due dates across your task lists',
    async collect(gateway, account) {
      const base = 'https://tasks.googleapis.com/tasks/v1';
      const lists = asList(asDict(await gateway.proxy({ accountId: account!.id, endpoint: `${base}/users/@me/lists`, method: 'GET', query: { maxResults: 10 } })).items).map(asDict);
      const facts: unknown[] = [];
      for (const list of lists) {
        const data = asDict(await gateway.proxy({
          accountId: account!.id,
          endpoint: `${base}/lists/${encodeURIComponent(String(list.id))}/tasks`,
          method: 'GET',
          query: { showCompleted: 'false', showHidden: 'false', maxResults: 50 },
        }));
        for (const raw of asList(data.items)) {
          const t = asDict(raw);
          if (t.status === 'completed' || !clip(t.title)) continue;
          facts.push({ task: clip(t.title, 160), due: typeof t.due === 'string' ? t.due.slice(0, 10) : null, list: clip(list.title, 60), notes: clip(t.notes) });
        }
      }
      return facts;
    },
    summarize: summarizeTasks,
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
    summarize: summarizeIssues,
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    description: 'Commitments, requests and deadlines from your last 5 emails',
    async collect(gateway, account, now) {
      const data = asDict(await gateway.proxy({
        accountId: account!.id,
        endpoint: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages',
        method: 'GET',
        query: { $top: LAST_EMAILS, $orderby: 'receivedDateTime desc', $filter: `receivedDateTime ge ${daysAgo(now, 3)}`, $select: 'subject,from,receivedDateTime,isRead,bodyPreview' },
      }));
      return asList(data.value).map((raw) => {
        const m = asDict(raw);
        const sender = asDict(asDict(m.from).emailAddress);
        return { account: account?.label, from: clip(sender.name || sender.address, 120), subject: clip(m.subject, 160), date: clip(m.receivedDateTime, 40), unread: m.isRead === false, snippet: clip(m.bodyPreview, 200) };
      });
    },
    keep: keepLastEmails,
    summarize: summarizeEmails,
  },
  {
    slug: 'calendly',
    name: 'Calendly',
    description: 'Calls booked with you this week, and who booked them',
    async collect(gateway, account, now, timeZone) {
      const get = async (endpoint: string, query?: Record<string, string | number>) =>
        asDict(await gateway.proxy({ accountId: account!.id, endpoint: `https://api.calendly.com${endpoint}`, method: 'GET', ...(query ? { query } : {}) }));
      const user = asDict((await get('/users/me')).resource).uri;
      const events = asList((await get('/scheduled_events', {
        user: String(user),
        status: 'active',
        min_start_time: now.toISOString(),
        max_start_time: endOfWeek(now, timeZone).toISOString(),
        sort: 'start_time:asc',
        count: 20,
      })).collection).map(asDict);
      return Promise.all(events.map(async (e) => {
        const id = String(e.uri).split('/').pop();
        const invitees = asList((await get(`/scheduled_events/${encodeURIComponent(String(id))}/invitees`, { count: ATTENDEES_KEPT })).collection).map(asDict);
        return { title: clip(e.name, 160), start: e.start_time, end: e.end_time, attendees: invitees.map((i) => clip(i.name, 60)).filter(Boolean) };
      }));
    },
    keep: keepThisWeek,
    summarize: summarizeMeetings,
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Pages changed in the last 7 days',
    async collect(gateway, account, now) {
      const data = asDict(await gateway.proxy({
        accountId: account!.id,
        endpoint: 'https://api.notion.com/v1/search',
        method: 'POST',
        headers: { 'Notion-Version': '2022-06-28' },
        body: { filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 20 },
      }));
      const since = Date.parse(daysAgo(now, RECENT_DAYS));
      return asList(data.results).map(asDict).filter((p) => Date.parse(String(p.last_edited_time)) >= since).map((p) => {
        const titled = Object.values(asDict(p.properties)).map(asDict).find((v) => v.type === 'title');
        return { title: clip(asList(titled?.title).map((t) => asDict(t).plain_text).join(''), 160), edited: p.last_edited_time };
      });
    },
    summarize: summarizeEdits('page'),
  },
  {
    slug: 'googledrive',
    name: 'Google Drive',
    description: 'Files changed in the last 7 days',
    async collect(gateway, account, now) {
      const data = asDict(await gateway.proxy({
        accountId: account!.id,
        endpoint: 'https://www.googleapis.com/drive/v3/files',
        method: 'GET',
        query: { q: `trashed = false and modifiedTime > '${daysAgo(now, RECENT_DAYS)}'`, orderBy: 'modifiedTime desc', pageSize: 20, fields: 'files(name,modifiedTime,owners(displayName))' },
      }));
      return asList(data.files).map(asDict).map((f) => ({ title: clip(f.name, 160), edited: f.modifiedTime, owner: clip(asDict(asList(f.owners)[0]).displayName, 60) }));
    },
    summarize: summarizeEdits('file'),
  },
  {
    slug: 'asana',
    name: 'Asana',
    description: 'Open tasks assigned to you, and their due dates',
    async collect(gateway, account) {
      const base = 'https://app.asana.com/api/1.0';
      const workspaces = asList(asDict(await gateway.proxy({ accountId: account!.id, endpoint: `${base}/workspaces`, method: 'GET', query: { limit: 10 } })).data).map(asDict);
      const facts: unknown[] = [];
      for (const workspace of workspaces) {
        const data = asDict(await gateway.proxy({
          accountId: account!.id,
          endpoint: `${base}/tasks`,
          method: 'GET',
          query: { assignee: 'me', workspace: String(workspace.gid), completed_since: 'now', opt_fields: 'name,due_on', limit: 50 },
        }));
        for (const raw of asList(data.data)) {
          const t = asDict(raw);
          if (clip(t.name)) facts.push({ task: clip(t.name, 160), due: t.due_on ?? null, list: clip(workspace.name, 60) });
        }
      }
      return facts;
    },
    summarize: summarizeTasks,
  },
  {
    slug: 'trello',
    name: 'Trello',
    description: 'Open cards assigned to you, and their due dates',
    async collect(gateway, account) {
      const data = await gateway.proxy({ accountId: account!.id, endpoint: 'https://api.trello.com/1/members/me/cards', method: 'GET', query: { filter: 'open', fields: 'name,due,dueComplete' } });
      return asList(data).map(asDict).filter((c) => !c.dueComplete && clip(c.name)).map((c) => ({ task: clip(c.name, 160), due: typeof c.due === 'string' ? c.due.slice(0, 10) : null }));
    },
    summarize: summarizeTasks,
  },
  {
    slug: 'jira',
    name: 'Jira',
    description: 'Unresolved issues assigned to you',
    async collect(gateway, account) {
      const data = asDict(await gateway.proxy({
        accountId: account!.id,
        // Relative, because each Jira site has its own address, which Composio fills in.
        endpoint: '/rest/api/3/search/jql',
        method: 'GET',
        query: { jql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC', maxResults: 30, fields: 'summary,status,priority,duedate,updated' },
      }));
      return asList(data.issues).map(asDict).map((i) => {
        const f = asDict(i.fields);
        return { id: clip(i.key, 30), title: clip(f.summary, 160), state: clip(asDict(f.status).name, 40), priority: clip(asDict(f.priority).name, 30), due: f.duedate ?? null, updated: f.updated };
      });
    },
    summarize: summarizeIssues,
  },
  {
    slug: 'gitlab',
    name: 'GitLab',
    description: 'Issues and merge requests assigned to you',
    async collect(gateway, account) {
      const read = async (path: string, type: string) => {
        const data = await gateway.proxy({ accountId: account!.id, endpoint: `https://gitlab.com/api/v4/${path}`, method: 'GET', query: { scope: 'assigned_to_me', state: 'opened', order_by: 'updated_at', per_page: 20 } });
        return asList(data).map(asDict).map((i) => ({ repo: clip(asDict(i.references).full, 100).replace(/[#!]\d+$/, ''), title: clip(i.title, 160), type, updated: i.updated_at }));
      };
      return [...await read('issues', 'issue'), ...await read('merge_requests', 'merge_request')];
    },
    summarize: summarizeCode('merge request'),
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'Open deals and when they should close',
    async collect(gateway, account) {
      const data = asDict(await gateway.proxy({ accountId: account!.id, endpoint: 'https://api.hubapi.com/crm/v3/objects/deals', method: 'GET', query: { limit: 50, properties: 'dealname,dealstage,closedate,amount' } }));
      return asList(data.results).map((raw) => asDict(asDict(raw).properties))
        .filter((d) => !/^closed/i.test(String(d.dealstage)))
        .map((d) => ({ deal: clip(d.dealname, 160), stage: clip(d.dealstage, 60), closes: typeof d.closedate === 'string' ? d.closedate.slice(0, 10) : null, amount: d.amount ?? null }));
    },
    summarize(items) {
      const dated = items.filter((d) => d.closes).sort((a, b) => String(a.closes).localeCompare(String(b.closes)));
      const next = dated[0];
      return `${plural(items.length, 'open deal')}.${next ? ` Next to close: ${clip(next.deal, 80)} on ${next.closes}.` : ''}`;
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
    summarize(items) {
      const top = [...items].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0]!;
      return `${plural(items.length, 'AI story', 'AI stories')} on the front page. Top story: ${clip(top.title, 100)}.`;
    },
  },
];

export const toolkitBySlug = (slug: string): Toolkit | undefined => TOOLKITS.find((t) => t.slug === slug);
