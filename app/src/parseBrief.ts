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
}

export interface NoiseItem {
  item: string;
  reason: string | null;
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
  /** The one thing to do first and the goal it moves. */
  focus: string | null;
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
  };
}

function parseNoise(line: string): NoiseItem {
  const [item, ...rest] = clean(line).replace(/[[\]]/g, '').split(ARROW);
  const reason = rest.join(' ').split('|').slice(1).join('|').replace(/^\s*reason:\s*/i, '').trim();
  return { item: item!.trim(), reason: reason || null };
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

export function parseBrief(markdown: string, knownSources: string[] = []): ParsedBrief {
  const sections = sectionsOf(markdown);
  // Older briefs called this section "Today's Priorities" and kept the noise inside it.
  const prioritiesRaw = sections.get('signals') ?? sections.get("today's priorities");
  const goalsRaw = sections.get('goals');
  const notice = markdown.split('\n').find((l) => l.trim().startsWith('>'))?.replace(/^\s*>\s*/, '').trim() ?? null;
  const empty: ParsedBrief = { structured: false, notice, focus: null, priorities: [], prioritiesText: null, noise: [], goals: [], goalsText: null, sources: null, note: null };
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
    focus: clean(sections.get('focus') ?? '') || null,
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
