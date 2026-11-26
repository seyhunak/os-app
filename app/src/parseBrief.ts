/** Turns a brief's Markdown into the parts of the front page. Anything it can't read falls back to plain Markdown. */

export type Level = 'critical' | 'supporting' | null;
export type GoalStatus = 'on-track' | 'attention' | 'at-risk' | 'unknown' | null;

export interface Priority {
  source: string | null;
  /** The goal this serves, or null if the model didn't name one. */
  goal: string | null;
  unaligned: boolean;
  headline: string;
  action: string | null;
  score: number | null;
  level: Level;
  /** The day-plan slot it sits in, such as "09:00–10:30". */
  when: string | null;
}

export type Energy = 'high' | 'medium' | 'low' | 'fixed' | null;

/** One block of the day plan: a time slot, the energy it needs, and what gets done in it. */
export interface PlanBlock {
  start: string;
  end: string | null;
  energy: Energy;
  task: string;
  /** Why this slot suits the task. */
  why: string | null;
  goal: string | null;
}

export interface NoiseItem {
  item: string;
  /** The tool it came from, when the model named one. */
  source: string | null;
  reason: string | null;
  /** The score that kept it below the cut, when the model wrote one. */
  score: number | null;
}

export interface Goal {
  goal: string;
  status: GoalStatus;
  evidence: string | null;
  action: string | null;
}

export interface ParsedBrief {
  /** False for older briefs, which render as plain Markdown. */
  structured: boolean;
  notice: string | null;
  /** The brief's own first line, such as "Good morning". */
  greeting: string | null;
  /** The 3 most important things to do, each with its source and the goal it moves. */
  focusItems: Priority[];
  /** Older briefs wrote focus as a sentence or two instead of a list. */
  focus: string | null;
  /** The day, time-blocked by the energy each task needs. Empty for older briefs. */
  plan: PlanBlock[];
  priorities: Priority[];
  /** Used when the priorities section isn't a ranked list, such as an unranked digest. */
  prioritiesText: string | null;
  noise: NoiseItem[];
  goals: Goal[];
  goalsText: string | null;
  sources: string | null;
  note: string | null;
}

const ARROW = /\s*(?:→|->)\s*/;
const clean = (text: string) => text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const bullets = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''));

/** Older briefs kept their sources in a table, which doesn't read well on a phone. */
function sourcesAsText(section: string): string {
  const rows = section.split('\n').map((l) => l.trim());
  if (!rows.some((l) => l.startsWith('|'))) return section;
  return rows
    .filter((l) => l && !/^\|\s*Source\s*\|/i.test(l) && !/^\|[\s:|-]+\|$/.test(l))
    .map((l) => {
      if (!l.startsWith('|')) return l;
      const [name = '', ...rest] = l.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      return `- **${name}:** ${rest.filter(Boolean).map((cell) => (/^\d+$/.test(cell) ? `${cell} ${cell === '1' ? 'item' : 'items'}` : cell)).join(', ')}`;
    })
    .join('\n');
}

function sectionsOf(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{2,6}\s+(.+)$/);
    if (heading) {
      current = heading[1]!.replace(/^\d+\.\s*/, '').replace(/[’']/g, "'").trim().toLowerCase();
      sections.set(current, '');
    } else if (current) {
      sections.set(current, `${sections.get(current)}${line}\n`);
    }
  }
  return sections;
}

export function parsePriority(line: string, knownSources: string[] = []): Priority {
  let text = clean(line);
  const whenMatch = text.match(/\|?\s*When:\s*([^|]+)/i);
  if (whenMatch) text = text.replace(whenMatch[0], ' ').trim();
  const goalMatch = text.match(/\|?\s*\[?Goal:\s*([^|\]→]+)\]?/i);
  if (goalMatch) text = text.replace(goalMatch[0], ' ').trim();
  const named = goalMatch?.[1]?.trim() ?? null;
  const unaligned = /\bUNALIGNED\b/i.test(text) || (named !== null && /UNALIGNED/i.test(named));
  text = text.replace(/\|?\s*\[UNALIGNED\]/i, '').trim();
  const level: Level = text.includes('🔥') ? 'critical' : text.includes('⚡') ? 'supporting' : null;
  text = text.replace(/🔥|⚡️?/gu, '').trim();

  let source = text.match(/^\[([^\]]+)\]\s*/);
  if (source) text = text.slice(source[0].length);
  // The model doesn't always bracket the tool's name, so match the tools this brief really read.
  const known = source ? undefined : knownSources.find((name) => text.toLowerCase().startsWith(`${name.toLowerCase()} `));
  if (known) {
    source = ['', known] as unknown as RegExpMatchArray;
    text = text.slice(known.length).trim();
  }
  const bracketed = text.match(/^\[([^\]]+)\]\s*/);
  if (bracketed && (source || knownSources.length)) text = `${bracketed[1]} ${text.slice(bracketed[0].length)}`.trim();

  const score = text.match(/\|?\s*Score:?\s*(\d{1,3})\b/i);
  if (score) text = text.replace(score[0], '').replace(/[\s|]+$/, '');

  const [first, ...rest] = text.split(ARROW);
  // Sometimes the model puts the whole subject in the brackets, leaving nothing for the headline.
  const headline = first!.trim() || source?.[1]?.trim() || '';
  return {
    source: first!.trim() ? source?.[1]?.trim() ?? null : null,
    goal: unaligned ? null : named?.replace(/^\[|\]$/g, '') || null,
    unaligned,
    headline,
    action: rest.join(' ').replace(/^[\s|]+|[\s|]+$/g, '') || null,
    score: score ? Number(score[1]) : null,
    level,
    when: whenMatch?.[1]?.trim().replace(/\s*[-–—]\s*/, '–') || null,
  };
}

const TIME = String.raw`\d{1,2}[:.]\d{2}`;
const SLOT = new RegExp(String.raw`^(${TIME})(?:\s*[-–—]\s*(${TIME}))?\s*`);
const ENERGY: Array<[RegExp, Exclude<Energy, null>]> = [
  [/^(?:🔋\s*)?high(?: energy)?$/i, 'high'],
  [/^(?:🔆\s*)?(?:medium|mid)(?: energy)?$/i, 'medium'],
  [/^(?:🪫\s*)?low(?: energy)?$/i, 'low'],
  [/^(?:📌\s*)?(?:fixed|calendar|meeting)$/i, 'fixed'],
];
const hhmm = (t: string) => t.replace('.', ':').padStart(5, '0');

/** Reads "09:00–10:30 | High | German: Lesson 12 → morning focus | Goal: Pass B1". Null if the line has no time. */
export function parsePlanBlock(line: string): PlanBlock | null {
  let text = clean(line);
  const slot = text.match(SLOT);
  if (!slot) return null;
  text = text.slice(slot[0].length).replace(/^[|·:,-]\s*/, '');
  const goalMatch = text.match(/\|?\s*\[?Goal:\s*([^|\]]+)\]?/i);
  if (goalMatch) text = text.replace(goalMatch[0], ' ').trim();
  const parts = text.split('|').map((p) => p.trim()).filter(Boolean);
  const energyAt = parts.findIndex((p) => ENERGY.some(([re]) => re.test(p)));
  const energy = energyAt >= 0 ? ENERGY.find(([re]) => re.test(parts[energyAt]!))![1] : null;
  const rest = parts.filter((_, i) => i !== energyAt).join(' | ');
  const [task, ...why] = rest.split(ARROW);
  const goal = goalMatch?.[1]?.trim() ?? null;
  return {
    start: hhmm(slot[1]!),
    end: slot[2] ? hhmm(slot[2]) : null,
    energy,
    task: task!.replace(/^[\s|]+|[\s|]+$/g, ''),
    why: why.join(' ').replace(/^[\s|]+|[\s|]+$/g, '') || null,
    goal: goal && !/UNALIGNED|^none$|^n\/a$/i.test(goal) ? goal : null,
  };
}

function parseNoise(line: string): NoiseItem {
  let text = clean(line);
  const source = text.match(/^\[([^\]]+)\]\s*/);
  if (source) text = text.slice(source[0].length);
  const [item, ...rest] = text.replace(/[[\]]/g, '').split(ARROW);
  const [scored = '', ...why] = rest.join(' ').split('|');
  const reason = why.join('|').replace(/^\s*reason:\s*/i, '').trim();
  const score = scored.match(/^\s*(?:score:?\s*)?(\d{1,3})\b/i);
  return { item: item!.trim(), source: source?.[1]?.trim() ?? null, reason: reason || null, score: score ? Number(score[1]) : null };
}

const STATUS: Array<[RegExp, Exclude<GoalStatus, null>]> = [
  [/🟢/u, 'on-track'],
  [/🟡/u, 'attention'],
  [/🔴/u, 'at-risk'],
  [/⚪/u, 'unknown'],
];

export function parseGoal(line: string): Goal {
  let text = clean(line);
  const status = STATUS.find(([mark]) => mark.test(text))?.[1] ?? null;
  text = text
    .replace(/🟢|🟡|🔴|⚪️?/gu, '')
    .replace(/^\s*(on track|needs attention|at risk|unknown|not started or unknown)\s*[:|-]?\s*/i, '')
    .replace(/\|?\s*Score:?\s*\d{1,3}\b/i, '')
    .replace(/\|?\s*\[?Goal:\s*[^|\]→]+\]?/i, '')
    .trim();

  const [goal, ...rest] = text.split(ARROW);
  const parts = rest.join(' | ').split('|').map((p) => p.trim()).filter(Boolean);
  const label = /^(?:single\s+)?next (?:action|step)\s*:\s*/i;
  const labelled = parts.findIndex((p) => label.test(p));
  const actionAt = labelled >= 0 ? labelled : parts.length > 1 ? parts.length - 1 : -1;
  return {
    goal: goal!.trim(),
    status,
    evidence: parts.filter((_, i) => i !== actionAt).join(' ') || null,
    action: actionAt >= 0 ? parts[actionAt]!.replace(label, '') : null,
  };
}

/** Inbox chores, like "Check recruiter replies": reading about work rather than doing it. */
const TRIAGE = /^(?:check|review|read|scan|monitor|look (?:at|through|over)|go through|skim|keep an eye on|stay on top of)\b.*\b(?:inbox|repl(?:y|ies)|e-?mails?|messages?|notifications?|dms?|threads?|mentions?)\b/i;

/** Focus is for work that moves a goal, so unaligned items and inbox chores never make it. */
export const isRealWork = (item: Priority) => !item.unaligned && !TRIAGE.test(item.headline);

export function parseBrief(markdown: string, knownSources: string[] = []): ParsedBrief {
  const sections = sectionsOf(markdown);
  // Older briefs called this section "Today's Priorities" and kept the noise inside it.
  const prioritiesRaw = sections.get('signals') ?? sections.get("today's priorities");
  const goalsRaw = sections.get('goal progress') ?? sections.get('goals');
  const greeting = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const focusRaw = sections.get('focus') ?? '';
  const focusItems = bullets(focusRaw).map((line) => parsePriority(line, [...knownSources, 'Goals'])).filter(isRealWork);
  const notice = markdown.split('\n').find((l) => l.trim().startsWith('>'))?.replace(/^\s*>\s*/, '').trim() ?? null;
  const plan = bullets(sections.get('day plan') ?? '').map(parsePlanBlock).filter((b): b is PlanBlock => b !== null && Boolean(b.task));
  const empty: ParsedBrief = { structured: false, notice, greeting, focusItems: [], focus: null, plan: [], priorities: [], prioritiesText: null, noise: [], goals: [], goalsText: null, sources: null, note: null };
  if (prioritiesRaw === undefined) return empty;

  const noiseAt = prioritiesRaw.search(/^\s*\*{0,2}\s*Noise eliminated/im);
  const signalsPart = noiseAt >= 0 ? prioritiesRaw.slice(0, noiseAt) : prioritiesRaw;
  const noisePart = noiseAt >= 0 ? prioritiesRaw.slice(noiseAt) : '';

  // Highest score first, even if the model wrote them in another order.
  const priorities = bullets(signalsPart).map((line) => parsePriority(line, knownSources)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const ranked = priorities.some((p) => p.level || p.score !== null || p.action);

  const updatesAt = goalsRaw?.search(/^\s*\*\*Your updates/im) ?? -1;
  const goalsPart = goalsRaw && updatesAt >= 0 ? goalsRaw.slice(0, updatesAt) : (goalsRaw ?? '');
  const goals = bullets(goalsPart).map(parseGoal);
  const extras = [goals.length ? '' : goalsPart.trim(), goalsRaw && updatesAt >= 0 ? goalsRaw.slice(updatesAt).trim() : ''].filter(Boolean).join('\n\n');

  return {
    structured: true,
    notice,
    greeting,
    focusItems,
    focus: focusItems.length ? null : clean(focusRaw) || null,
    plan,
    priorities: ranked ? priorities : [],
    prioritiesText: ranked ? null : signalsPart.trim() || null,
    // The model sometimes repeats a signal here, so anything already a signal is dropped.
    noise: bullets(`${noisePart}\n${sections.get('left out') ?? ''}`).map(parseNoise)
      .filter((n) => !/already (included|listed|a signal)/i.test(n.reason ?? '') && !priorities.some((p) => n.item.includes(p.headline))),
    goals,
    goalsText: extras || null,
    sources: sourcesAsText(sections.get('sources')?.trim() ?? '') || null,
    note: sections.get('note for next brief')?.trim() || null,
  };
}

/** Minutes since midnight for "HH:MM". */
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Which block the time `at` (minutes since midnight) falls in. An end at or before the start, such
 * as 23:00–00:00, runs to midnight. A block with no end runs to the next one's start. Between
 * blocks, the next one is marked instead. -1 when the day is over or nothing fits.
 */
export function currentBlock(blocks: Pick<PlanBlock, 'start' | 'end'>[], at: number): { index: number; now: boolean } {
  const span = (b: Pick<PlanBlock, 'start' | 'end'>, i: number) => {
    const start = toMinutes(b.start);
    const next = blocks[i + 1];
    let end = b.end ? toMinutes(b.end) : next ? toMinutes(next.start) : start + 60;
    if (end <= start) end = 24 * 60;
    return { start, end };
  };
  const spans = blocks.map(span);
  const now = spans.findIndex((s) => s.start <= at && at < s.end);
  if (now >= 0) return { index: now, now: true };
  const next = spans.findIndex((s) => s.start > at);
  return { index: next, now: false };
}
