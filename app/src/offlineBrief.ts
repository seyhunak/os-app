import type { Brief, Kind, Source } from './api';

/** The brief rules the server hands out, cached on the device for offline writing. */
export interface BriefPrompt {
  system: Record<Kind, string>;
  maxTokens: number;
  sourcesMarker: string;
}

export interface OfflineBriefInput {
  kind: Kind;
  now: Date;
  goals: string;
  /** Your updates, oldest first, including ones saved on this device that haven't synced yet. */
  updates: Array<{ createdAt: string; text: string }>;
  /** The newest brief written by the server. Its source summaries are the last scan this device has. */
  lastScan?: Pick<Brief, 'sources' | 'createdAt' | 'markdown'>;
}

export interface OfflineBriefResult {
  markdown: string;
  generator: 'ai' | 'digest';
  sources: Source[];
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
/** Offline briefs try the AI for this long, then fall back to the plain version. */
export const OFFLINE_AI_TIMEOUT_MS = 60_000;
/** Waits before the second and third tries when the model is rate limited. */
const RETRY_DELAYS_MS = [2_000, 6_000];
const UPDATE_DAYS = 14;
const MARKER = '{{SOURCES}}';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The last scan's summaries, labelled as such. Nothing is read from your tools offline. */
export function sourcesFromLastScan(lastScan: OfflineBriefInput['lastScan']): Source[] {
  if (!lastScan) return [];
  return lastScan.sources.map((s) => ({
    toolkit: s.toolkit,
    name: s.name,
    status: 'cache',
    items: s.items,
    label: `From the ${day(lastScan.createdAt)} scan. Tools aren't read offline.`,
    ...(s.summary ? { summary: s.summary } : {}),
  }));
}

export function recentUpdates(updates: OfflineBriefInput['updates'], now: Date) {
  const since = now.getTime() - UPDATE_DAYS * 86_400_000;
  return updates.filter((u) => Date.parse(u.createdAt) >= since).map((u) => ({ at: stamp(u.createdAt), text: u.text }));
}

export function extractNote(markdown: string | null | undefined): string | null {
  const match = markdown?.match(/^#{1,6}\s*(?:\d+\.\s*)?Note for Next Brief\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im);
  return match?.[1]?.trim() || null;
}

const escapeTags = (text: string) => text.replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The same layout the server sends the model, built from what this device has saved. */
export function renderUserPrompt(input: OfflineBriefInput): string {
  const updates = recentUpdates(input.updates, input.now).map((u) => `- ${u.at}: ${escapeTags(u.text)}`).join('\n');
  const note = extractNote(input.lastScan?.markdown);
  const facts = Object.fromEntries(sourcesFromLastScan(input.lastScan).filter((s) => s.summary).map((s) => [s.name, [s.summary]]));
  return [
    `Today is ${localDate(input.now)}. Write the ${input.kind} brief.`,
    'This brief is written offline. source_data holds summaries from the last scan, not fresh items, so say so where it matters.',
    `<goals>\n${escapeTags(input.goals.trim()) || 'No goals set yet. Write "insufficient evidence" under Goals and suggest pasting them in Settings.'}\n</goals>`,
    `<updates>\n${updates || 'None yet.'}\n</updates>`,
    note ? `<note_from_last_brief>\n${escapeTags(note)}\n</note_from_last_brief>` : '',
    `<source_data>\n${escapeTags(JSON.stringify(facts, null, 1))}\n</source_data>`,
  ].filter(Boolean).join('\n\n');
}

function renderSources(sources: Source[]): string {
  if (!sources.length) return 'No scan saved on this device yet.';
  return sources.map((s) => `- **${s.name}:** ${s.summary ? `${s.summary.replace(/\s+/g, ' ')} ` : ''}(${s.label})`).join('\n');
}

/** No AI: the brief's layout, from your goals, updates and the last scan, with nothing ranked or guessed. */
export function renderTemplate(input: OfflineBriefInput, reason: string): string {
  const goals = input.goals.split('\n').map((g) => g.trim()).filter(Boolean).map((g) => `- ⚪ ${g.replace(/^[-*]\s*/, '')}`);
  const updates = recentUpdates(input.updates, input.now).map((u) => `- ${u.at}: ${u.text}`);
  const note = extractNote(input.lastScan?.markdown);
  return [
    `# ${input.kind === 'morning' ? 'Good morning' : 'Good evening'}`,
    `> Offline draft, written on this device: ${reason}. Nothing is ranked, and tools weren't read, so sources are from the last scan.`,
    `### Signals\n${note ? `From your last brief: ${note}` : 'Nothing is marked as a signal, because nothing was ranked.'}`,
    `### Goals\n${goals.join('\n') || 'No goals set yet. Paste them in Settings.'}${updates.length ? `\n\n**Your updates:**\n${updates.join('\n')}` : ''}`,
    `### Sources\n${MARKER}`,
    `### Note for Next Brief\n${note ?? 'Nothing to carry over.'}`,
  ].join('\n\n');
}

function finish(body: string, sources: Source[], marker: string): string {
  const withoutSummaries = body.replace(/^#{1,6}\s*(?:\d+\.\s*)?Source Summaries\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im, '');
  const table = renderSources(sources);
  return withoutSummaries.includes(marker) ? withoutSummaries.replace(marker, () => table) : `${withoutSummaries}\n\n### Sources\n${table}`;
}

interface Completion {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
  error?: { message?: string; code?: number };
}

/**
 * Writes a brief without the server. With an OpenRouter key on this device and the cached rules,
 * the AI writes it; otherwise, or if that fails, it's the plain version. Never throws.
 */
export async function writeOfflineBrief(input: OfflineBriefInput, ai: { prompt?: BriefPrompt; apiKey?: string | null; model?: string | null; fallbacks?: string[]; fetchImpl?: typeof fetch; timeoutMs?: number; retryDelaysMs?: number[] } = {}): Promise<OfflineBriefResult> {
  const sources = sourcesFromLastScan(input.lastScan);
  const { prompt, apiKey, model, fallbacks = [], fetchImpl = fetch, timeoutMs = OFFLINE_AI_TIMEOUT_MS, retryDelaysMs = RETRY_DELAYS_MS } = ai;
  let reason = 'no OpenRouter key on this device';
  if (prompt && apiKey && model) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Thinking would spend the output cap before the brief is written, so it's off where the model allows.
      let reasoning: Record<string, boolean> = { enabled: false };
      // A rate-limited model is tried again, then with fallbacks, all within the one time limit.
      for (let attempt = 0; ; attempt++) {
        const others = attempt ? fallbacks.filter((id) => id !== model).slice(0, 2) : [];
        const response = await fetchImpl(`${OPENROUTER_URL}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'OS' },
          body: JSON.stringify({
            model,
            ...(others.length ? { models: [model, ...others] } : {}),
            max_tokens: prompt.maxTokens,
            reasoning,
            provider: { data_collection: 'deny' },
            messages: [
              { role: 'system', content: prompt.system[input.kind] },
              { role: 'user', content: renderUserPrompt(input) },
            ],
          }),
        });
        const data = (await response.json().catch(() => ({}))) as Completion & { model?: string };
        const status = response.ok ? (data.error?.code ?? 200) : response.status;
        if (status === 400 && reasoning.enabled === false && /reasoning/i.test(data.error?.message ?? '')) {
          reasoning = { exclude: true };
          attempt--;
          continue;
        }
        if ((status === 429 || status === 502 || status === 503) && attempt < retryDelaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
          continue;
        }
        const text = (data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (response.ok && !data.error && text && data.choices?.[0]?.finish_reason !== 'length') {
          const by = data.model && data.model !== model && others.includes(data.model) ? ` Written by ${data.model}, because ${model} was rate limited.` : '';
          const notice = `> Offline draft, written on this device. Tools weren't read, so sources are from the last scan.${by}`;
          const body = text.replace(/^(# .*\n)/, `$1\n${notice}\n`);
          return { markdown: finish(body.includes(notice) ? body : `${notice}\n\n${body}`, sources, prompt.sourcesMarker), generator: 'ai', sources };
        }
        reason = status === 429 ? 'the AI model was rate limited, and so were its fallbacks' : response.ok && !data.error ? 'the AI model returned no usable brief' : `OpenRouter returned an error (${status})`;
        break;
      }
    } catch {
      reason = "OpenRouter couldn't be reached";
    } finally {
      clearTimeout(timer);
    }
  } else if (apiKey && !prompt) {
    reason = 'the brief rules haven\'t been saved on this device yet';
  } else if (apiKey && !model) {
    reason = 'no OpenRouter model chosen yet';
  }
  return { markdown: finish(renderTemplate(input, reason), sources, MARKER), generator: 'digest', sources };
}
