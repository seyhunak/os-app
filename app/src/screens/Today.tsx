import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, useWindowDimensions, View, type TextStyle } from 'react-native';
import type { Brief, Kind, LedgerEntry, Source } from '../api';
import { Markdown } from '../Markdown';
import { SwipeRow } from '../SwipeRow';
import { useConnection, type OfflineApi } from '../offline';
import { autoBriefFor, freshness } from '../staleBrief';
import { parseBrief, type Goal, type GoalStatus, type NoiseItem, type ParsedBrief, type Priority } from '../parseBrief';
import { Button, ErrorNote, F, Loading, message, R, Screen, useColors, type Colors } from '../ui';

const TWO_COLUMNS_AT = 860;
const PAGE_WIDTH = 1040;
/** Every brief reads your updates from this many days back. */
const LEDGER_DAYS = 14;
const LEDGER_SHOWN = 5;

const KINDS: Kind[] = ['morning', 'afternoon', 'evening'];
const KIND_LABEL: Record<Kind, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
const edition = (kind: Kind) => `${KIND_LABEL[kind]} brief`;
/** The brief that fits the time of day: before noon, before five, then evening. */
export const kindForHour = (hour: number): Kind => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
// Built from parts, because iOS orders a combined weekday and date oddly ("6 November 2026 Friday").
const part = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString(undefined, options);
const longDate = (iso: string) => `${part(iso, { weekday: 'long' })}, ${part(iso, { day: 'numeric', month: 'long', year: 'numeric' })}`;
const shortDate = (iso: string) => `${part(iso, { weekday: 'short' })}, ${part(iso, { day: 'numeric', month: 'short' })}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (n: number) => String(n).padStart(2, '0');

const STATUS_LABEL: Record<Exclude<GoalStatus, null>, string> = {
  'on-track': 'On track',
  attention: 'Needs attention',
  'at-risk': 'At risk',
  unknown: 'No evidence',
};

/** Ok and bad are for status only; attention and unknown stay neutral. */
const statusTone = (status: GoalStatus, c: Colors) =>
  status === 'at-risk' ? { fg: c.danger, bg: c.dangerSoft } : status === 'on-track' ? { fg: c.ok, bg: c.okSoft } : status === 'attention' ? { fg: c.text, bg: c.deep } : { fg: c.muted, bg: 'transparent' };

/** What a tool's status means for this brief: read, stale, or missing. */
const SCANNED = new Set(['live', 'cache']);
const sourceTone = (status: string, c: Colors) => (SCANNED.has(status) ? c.ok : status === 'error' || status === 'rate_limited' ? c.danger : c.muted);
const SOURCE_STATUS: Record<string, string> = { live: 'Pulled', cache: 'Cached', rate_limited: 'Rate limited', error: 'Failed', not_connected: 'Not connected', no_cache: 'Not read' };

// ——— Building blocks ———————————————————————————————————————————————

function Rule({ strong }: { strong?: boolean }) {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: strong ? c.line2 : c.line }} />;
}

/** A section's head: its name, and a measured aside such as "3 of 11 kept". */
function Head({ children, aside, tone }: { children: string; aside?: string | null; tone?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <Text accessibilityRole="header" style={{ color: tone ?? c.text, fontFamily: F.display, fontSize: 20, lineHeight: 24, letterSpacing: -0.5 }}>{children}</Text>
      {aside ? <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13, lineHeight: 18 }}>{aside}</Text> : null}
    </View>
  );
}

/** Hairline panel: one surface, rows divided by 1px seams. */
function Panel({ children, tone }: { children: ReactNode; tone?: 'deep' }) {
  const c = useColors();
  return (
    <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: R.card, backgroundColor: tone === 'deep' ? c.deep : c.card, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

function Row({ children, first, selected }: { children: ReactNode; first?: boolean; selected?: boolean }) {
  const c = useColors();
  return <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 6, borderTopWidth: first ? 0 : 1, borderColor: c.line, ...(selected ? { borderLeftWidth: 2, borderLeftColor: c.accent } : null) }}>{children}</View>;
}

/** A chip carries state only. */
function Tag({ label, fg, bg, mono }: { label: string; fg: string; bg: string; mono?: boolean }) {
  const c = useColors();
  return (
    <View style={{ borderWidth: 1, borderColor: bg === 'transparent' ? c.line : bg, backgroundColor: bg, borderRadius: R.chip, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ color: fg, fontFamily: mono ? F.mono : F.sansMedium, fontSize: 12, lineHeight: 17 }}>{label}</Text>
    </View>
  );
}

function Collapsible({ title, aside, defaultOpen, children }: { title: string; aside?: string | null; defaultOpen: boolean; children: ReactNode }) {
  const c = useColors();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${aside ? `, ${aside}` : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 20, lineHeight: 24, letterSpacing: -0.5 }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {aside ? <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{aside}</Text> : null}
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{open ? 'Hide' : 'Show'}</Text>
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

// ——— Masthead and summary ————————————————————————————————————————————

function Masthead({ brief, wide }: { brief: Brief; wide: boolean }) {
  const c = useColors();
  const meta: TextStyle = { color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 };
  const how = brief.trigger === 'offline'
    ? `offline draft on this device${brief.pending ? ', syncs when your Mac is back' : ''}`
    : brief.trigger === 'schedule' ? 'on schedule' : 'on request';
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', justifyContent: 'space-between', alignItems: wide ? 'flex-end' : 'flex-start', gap: wide ? 12 : 4 }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: wide ? 40 : 32, lineHeight: wide ? 42 : 34, letterSpacing: -1.2 }}>{edition(brief.kind)}</Text>
        <Text style={{ ...meta, color: c.ink2, fontFamily: F.sansMedium }}>{longDate(brief.createdAt)}</Text>
      </View>
      <Text style={meta}>
        <Text style={{ color: c.cool, fontFamily: F.mono }}>{clock(brief.createdAt)}</Text>
        {`  ·  Written ${how}  ·  ${brief.generator === 'ai' ? 'Ranked by AI' : 'Unranked digest'}`}
      </Text>
    </View>
  );
}

interface Tally { signals: number; cut: number; scanned: number; tools: number; failed: number; atRisk: number; updates: number }

function tallyOf(brief: Brief, parsed: ParsedBrief, updates: number): Tally {
  return {
    signals: parsed.priorities.length,
    cut: parsed.noise.length,
    scanned: brief.sources.filter((s) => SCANNED.has(s.status)).length,
    tools: brief.sources.length,
    failed: brief.sources.filter((s) => s.status === 'error' || s.status === 'rate_limited').length,
    atRisk: parsed.goals.filter((g) => g.status === 'at-risk').length,
    updates,
  };
}

/** The brief at a glance: one figure per cell, measured, never decorated. */
function Summary({ tally, wide }: { tally: Tally; wide: boolean }) {
  const c = useColors();
  const cells: Array<{ label: string; value: string; note?: string; tone?: string }> = [
    { label: 'Signals', value: String(tally.signals), note: tally.signals ? 'worth your time' : 'nothing ranked' },
    { label: 'Left out', value: String(tally.cut), note: 'cut as noise' },
    { label: 'Tools scanned', value: `${tally.scanned}/${tally.tools}`, note: tally.failed ? `${tally.failed} failed` : !tally.tools ? 'none chosen' : tally.scanned < tally.tools ? `${tally.tools - tally.scanned} not read` : 'all read', ...(tally.failed ? { tone: c.danger } : {}) },
    { label: 'Goals at risk', value: String(tally.atRisk), ...(tally.atRisk ? { tone: c.danger } : {}) },
    { label: 'Updates read', value: String(tally.updates), note: `last ${LEDGER_DAYS} days` },
  ];
  const total = tally.signals + tally.cut;
  const kept = total ? Math.round((tally.signals / total) * 100) : 0;
  return (
    <Panel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => (
          <View
            key={cell.label}
            accessibilityLabel={`${cell.label}: ${cell.value}${cell.note ? `, ${cell.note}` : ''}`}
            style={{ flexGrow: 1, flexBasis: wide ? 0 : '50%', paddingHorizontal: 16, paddingVertical: 14, gap: 2, borderColor: c.line, borderLeftWidth: wide && i ? 1 : !wide && i % 2 ? 1 : 0, borderTopWidth: !wide && i > 1 ? 1 : 0 }}
          >
            <Text style={{ color: c.muted, fontFamily: F.sansMedium, fontSize: 12, lineHeight: 16 }}>{cell.label}</Text>
            <Text style={{ color: cell.tone ?? c.text, fontFamily: F.mono, fontSize: 28, lineHeight: 34, letterSpacing: -0.8 }}>{cell.value}</Text>
            {cell.note ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12, lineHeight: 16 }}>{cell.note}</Text> : null}
          </View>
        ))}
      </View>
      {total ? (
        <View style={{ borderTopWidth: 1, borderColor: c.line, paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
          <View accessibilityLabel={`Signal to noise: kept ${tally.signals} of ${total}`} style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: c.deep, gap: 2 }}>
            <View style={{ flex: tally.signals, backgroundColor: c.cool }} />
            <View style={{ flex: tally.cut, backgroundColor: c.line2 }} />
          </View>
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12, lineHeight: 16 }}>
            Signal vs noise: kept <Text style={{ color: c.cool, fontFamily: F.mono }}>{tally.signals}</Text> of <Text style={{ fontFamily: F.mono }}>{total}</Text> scored items (<Text style={{ fontFamily: F.mono }}>{kept}%</Text>). Items under 60 are cut.
          </Text>
        </View>
      ) : null}
    </Panel>
  );
}

/** Where to start. Amber, because it's yours to do. */
function Focus({ text, wide }: { text: string; wide: boolean }) {
  const c = useColors();
  return (
    <View style={{ borderWidth: 1, borderColor: c.line, borderLeftWidth: 3, borderLeftColor: c.accent, borderRadius: R.card, backgroundColor: c.card, padding: wide ? 22 : 16, gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.accent, fontFamily: F.sansBold, fontSize: 13, lineHeight: 18 }}>Focus first</Text>
      <Text style={{ color: c.text, fontFamily: F.display, fontSize: wide ? 28 : 22, lineHeight: wide ? 34 : 28, letterSpacing: -0.7 }}>{text}</Text>
    </View>
  );
}

// ——— Priorities ——————————————————————————————————————————————————————

function PriorityRow({ priority, rank, lead, wide }: { priority: Priority; rank: number; lead: boolean; wide: boolean }) {
  const c = useColors();
  const size = lead ? (wide ? 30 : 24) : 19;
  return (
    <Row first={rank === 1} selected={lead}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <Text style={{ color: lead ? c.accent : c.muted, fontFamily: F.monoMedium, fontSize: 14, lineHeight: 22, width: 22 }}>{pad(rank)}</Text>
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {priority.source ? <Tag label={priority.source} fg={c.cool} bg={c.coolSoft} /> : null}
            {priority.level === 'critical' ? <Tag label="Critical" fg={c.danger} bg={c.dangerSoft} /> : priority.level === 'supporting' ? <Tag label="Supporting" fg={c.muted} bg="transparent" /> : null}
            {priority.score !== null ? <Text style={{ color: c.cool, fontFamily: F.mono, fontSize: 13, lineHeight: 18, marginLeft: 'auto' }}>{priority.score}<Text style={{ color: c.muted }}>/100</Text></Text> : null}
          </View>
          <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: size, lineHeight: size * 1.18, letterSpacing: lead ? -0.8 : -0.3 }}>{priority.headline}</Text>
          {priority.action ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: c.accent, fontFamily: F.sansBold, fontSize: lead ? 17 : 15, lineHeight: lead ? 25 : 22 }}>→</Text>
              <Text style={{ flex: 1, color: c.ink2, fontFamily: F.text, fontSize: lead ? 17 : 15, lineHeight: lead ? 25 : 22 }}>{priority.action}</Text>
            </View>
          ) : null}
          {priority.goal || priority.unaligned ? (
            <Text style={{ color: priority.goal ? c.accent : c.muted, fontFamily: F.sansMedium, fontSize: 13, lineHeight: 18 }}>
              {priority.goal ? `Moves: ${priority.goal}` : 'Not tied to a goal'}
            </Text>
          ) : null}
        </View>
      </View>
    </Row>
  );
}

// ——— Goals ———————————————————————————————————————————————————————————

function GoalRow({ goal, first }: { goal: Goal; first: boolean }) {
  const c = useColors();
  const tone = statusTone(goal.status, c);
  return (
    <Row first={first}>
      {goal.status ? <View style={{ flexDirection: 'row' }}><Tag label={STATUS_LABEL[goal.status]} fg={tone.fg} bg={tone.bg} /></View> : null}
      <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 17, lineHeight: 23 }}>{goal.goal}</Text>
      {goal.evidence && !/^insufficient evidence\.?$/i.test(goal.evidence) ? <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{goal.evidence}</Text> : null}
      {goal.action ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: c.accent, fontFamily: F.sansBold, fontSize: 15, lineHeight: 22 }}>→</Text>
          <Text style={{ flex: 1, color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{goal.action}</Text>
        </View>
      ) : null}
    </Row>
  );
}

// ——— Signal vs noise ———————————————————————————————————————————————

/** Noise, struck through as an editor would cut it, with the score that cut it. */
function LeftOut({ items }: { items: NoiseItem[] }) {
  const c = useColors();
  return (
    <Panel tone="deep">
      {items.map((n, i) => (
        <Row key={i} first={i === 0}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
            <Text style={{ flex: 1, color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22, textDecorationLine: 'line-through' }}>{n.item}</Text>
            {n.score !== null ? <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{n.score}</Text> : null}
          </View>
          {n.reason ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>{n.reason}</Text> : null}
        </Row>
      ))}
    </Panel>
  );
}

// ——— Scanned tools —————————————————————————————————————————————————

/** Older briefs saved items rather than a summary, so a few of those stand in for it. */
const OLD_ITEMS_SHOWN = 5;

function ToolRow({ source, first }: { source: Source; first: boolean }) {
  const c = useColors();
  const old = source.summary === undefined ? (source.contents ?? []).slice(0, OLD_ITEMS_SHOWN) : [];
  const hidden = old.length ? source.items - old.length : 0;
  const tone = sourceTone(source.status, c);
  return (
    <Row first={first}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone }} />
        <Text style={{ flex: 1, color: c.text, fontFamily: F.sansMedium, fontSize: 16, lineHeight: 22 }}>{source.name}</Text>
        <Text style={{ color: c.cool, fontFamily: F.mono, fontSize: 13 }}>{count(source.items, 'item')}</Text>
        <Text style={{ color: tone === c.ok ? c.muted : tone, fontFamily: F.sansMedium, fontSize: 12, minWidth: 74, textAlign: 'right' }}>{SOURCE_STATUS[source.status] ?? source.label ?? source.status}</Text>
      </View>
      {source.summary ? <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22, paddingLeft: 17 }}>{source.summary}</Text> : null}
      {old.map((item, i) => <Text key={i} style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22, paddingLeft: 17 }}>{item}</Text>)}
      {hidden > 0 ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, paddingLeft: 17 }}>and {hidden} more</Text> : null}
      {source.detail ? <Text style={{ color: c.danger, fontFamily: F.sans, fontSize: 13, lineHeight: 18, paddingLeft: 17 }}>{source.detail}</Text> : null}
    </Row>
  );
}

// ——— Ledger ————————————————————————————————————————————————————————

/** Your own log: what this brief read, and what the next one will. Amber, because you wrote it. */
function Ledger({ read, since }: { read: LedgerEntry[]; since: LedgerEntry[] }) {
  const c = useColors();
  const shown = read.slice(0, LEDGER_SHOWN);
  return (
    <View style={{ gap: 12 }}>
      <Head aside={`${count(read.length, 'update')} read`}>Ledger</Head>
      {since.length ? (
        <Text style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 13, lineHeight: 18 }}>
          {count(since.length, 'update')} logged since this brief. The next brief will read {since.length === 1 ? 'it' : 'them'}.
        </Text>
      ) : null}
      {shown.length ? (
        <Panel>
          {shown.map((e, i) => (
            <Row key={e.id} first={i === 0}>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Text style={{ color: c.cool, fontFamily: F.mono, fontSize: 12, lineHeight: 21, minWidth: 92 }}>{`${part(e.createdAt, { day: '2-digit', month: 'short' })} ${clock(e.createdAt)}`}</Text>
                <Text style={{ flex: 1, color: c.text, fontFamily: F.text, fontSize: 15, lineHeight: 21 }}>{e.text}</Text>
              </View>
            </Row>
          ))}
          {read.length > shown.length ? <Row><Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>and {read.length - shown.length} earlier</Text></Row> : null}
        </Panel>
      ) : (
        <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>No updates in the last {LEDGER_DAYS} days. Tap Update to log what you've done, and goals get real evidence.</Text>
      )}
    </View>
  );
}

/** Splits the ledger into what fed this brief (the window before it) and what came after. */
export function ledgerFor(entries: LedgerEntry[], createdAt: string) {
  const at = Date.parse(createdAt);
  const from = at - LEDGER_DAYS * 86_400_000;
  const newestFirst = [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return {
    read: newestFirst.filter((e) => Date.parse(e.createdAt) <= at && Date.parse(e.createdAt) >= from),
    since: newestFirst.filter((e) => Date.parse(e.createdAt) > at),
  };
}

// ——— The page ——————————————————————————————————————————————————————

function FrontPage({ brief, wide, ledger }: { brief: Brief; wide: boolean; ledger: LedgerEntry[] | null }) {
  const c = useColors();
  const parsed = parseBrief(brief.markdown, brief.sources.map((s) => s.name));
  const updates = ledger ? ledgerFor(ledger, brief.createdAt) : null;

  if (!parsed.structured) {
    return (
      <View style={{ gap: 20 }}>
        <Masthead brief={brief} wide={wide} />
        <Markdown source={brief.markdown} />
      </View>
    );
  }

  const tally = tallyOf(brief, parsed, updates?.read.length ?? 0);
  const listed = brief.sources.length > 0 && brief.sources.every((s) => s.summary !== undefined || s.contents);

  const priorities = (
    <View style={{ gap: 12 }}>
      <Head aside={tally.signals ? `top ${tally.signals} by score` : null}>Priorities</Head>
      {parsed.notice ? <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{parsed.notice}</Text> : null}
      {parsed.priorities.length ? (
        <Panel>{parsed.priorities.map((p, i) => <PriorityRow key={i} priority={p} rank={i + 1} lead={i === 0} wide={wide} />)}</Panel>
      ) : parsed.prioritiesText ? <Markdown source={parsed.prioritiesText} /> : (
        <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15 }}>No signals today.</Text>
      )}
    </View>
  );

  const goals = parsed.goals.length || parsed.goalsText ? (
    <View style={{ gap: 12 }}>
      <Head aside={parsed.goals.length ? count(parsed.goals.length, 'goal') : null}>Goals</Head>
      {parsed.goals.length ? <Panel>{parsed.goals.map((g, i) => <GoalRow key={i} goal={g} first={i === 0} />)}</Panel> : null}
      {parsed.goalsText ? <Markdown source={parsed.goalsText} /> : null}
    </View>
  ) : null;

  const tools = listed || parsed.sources ? (
    <Collapsible title="Scanned tools" aside={listed ? `${tally.scanned}/${tally.tools} read` : null} defaultOpen={wide || tally.failed > 0}>
      {listed ? <Panel>{brief.sources.map((s, i) => <ToolRow key={s.toolkit} source={s} first={i === 0} />)}</Panel> : <Markdown source={parsed.sources ?? ''} />}
    </Collapsible>
  ) : null;

  const noise = parsed.noise.length ? (
    <Collapsible title="Left out" aside={`${count(parsed.noise.length, 'item')} cut`} defaultOpen={false}>
      <LeftOut items={parsed.noise} />
    </Collapsible>
  ) : null;

  const ledgerBlock = updates ? <Ledger read={updates.read} since={updates.since} /> : null;
  const note = parsed.note ? (
    <View style={{ gap: 8 }}>
      <Head>Note for next brief</Head>
      <Panel tone="deep"><Row first><Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{parsed.note}</Text></Row></Panel>
    </View>
  ) : null;

  return (
    <View style={{ gap: 24 }}>
      <Masthead brief={brief} wide={wide} />
      <Summary tally={tally} wide={wide} />
      {parsed.focus ? <Focus text={parsed.focus} wide={wide} /> : null}
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
          <View style={{ flex: 3, gap: 28 }}>{priorities}{noise}{tools}</View>
          <View style={{ flex: 2, gap: 28 }}>{goals}{ledgerBlock}{note}</View>
        </View>
      ) : (
        <>
          {priorities}
          {goals}
          {noise}
          {tools}
          {ledgerBlock}
          {note}
        </>
      )}
    </View>
  );
}

/** Shown above a brief from an earlier day: either today's is being written, or it can't be yet. */
function StaleNote({ brief, generating, online }: { brief: Brief; generating: boolean; online: boolean }) {
  const c = useColors();
  const showing = brief.trigger === 'offline' ? 'your offline draft' : shortDate(brief.createdAt);
  const text = generating
    ? online ? `Writing today's brief with fresh tool data… Showing ${showing} until it's ready.` : `Writing today's draft on this device… Showing ${showing} until it's ready.`
    : `Outdated: this brief is from ${shortDate(brief.createdAt)}. Write a new one below.`;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderLeftWidth: 3, borderColor: c.line, borderLeftColor: generating ? c.cool : c.danger, borderRadius: R.control, backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Text style={{ flex: 1, color: c.text, fontFamily: F.sansMedium, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export function TodayScreen({ api, hasSchedules, onSchedule }: { api: OfflineApi; hasSchedules: boolean; onSchedule(): void }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= TWO_COLUMNS_AT;
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState<Kind | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { online, refreshKey } = useConnection();
  const auto = useMemo(() => autoBriefFor(api), [api]);
  const [generating, setGenerating] = useState(() => auto.pending() !== null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      setBriefs((await api.briefs()).briefs);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);

  /** Picks up a brief the Mac saved after this device stopped waiting for it. Keeps the error shown. */
  const reloadQuietly = useCallback(() => {
    api.briefs().then(({ briefs: list }) => setBriefs(list), () => undefined);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Read again whenever the briefs change, so updates logged since show up beside the brief.
  useEffect(() => {
    api.ledger().then(({ entries }) => setLedger(entries), () => setLedger((l) => l ?? []));
  }, [api, briefs, refreshKey]);

  // The newest brief is from an earlier day: ask for today's, once. The guard lives outside this
  // screen, so re-renders, tab switches and reopening the app join the same request.
  useEffect(() => {
    if (!briefs) return;
    const request = auto.maybeGenerate(briefs, online);
    if (!request) {
      setGenerating(false);
      return;
    }
    let live = true;
    setGenerating(true);
    request
      .then((brief) => {
        if (!live) return;
        setBriefs((list) => [brief, ...(list ?? []).filter((b) => b.id !== brief.id)]);
        setOpenId(null);
      })
      .catch((e) => {
        if (!live) return;
        setError(message(e));
        reloadQuietly();
      })
      .finally(() => live && setGenerating(false));
    return () => {
      live = false;
    };
  }, [auto, briefs, online, reloadQuietly]);

  const [confirmAll, setConfirmAll] = useState(false);
  /** Hidden at once. The server archives them now, or when it's back if this device is offline. */
  const archive = async (ids: number[]) => {
    setConfirmAll(false);
    setBriefs((list) => (list ?? []).filter((b) => !ids.includes(b.id)));
    setOpenId((id) => (id !== null && ids.includes(id) ? null : id));
    try {
      await api.archiveBriefs(ids);
    } catch (e) {
      setError(message(e));
      void load();
    }
  };

  const generate = async (kind: Kind, refresh = false) => {
    setBusy(refresh ? 'refresh' : kind);
    setError(null);
    try {
      const brief = online ? await api.generateBrief(kind, refresh) : await api.writeOfflineBrief(kind);
      setBriefs((list) => [brief, ...(list ?? [])]);
      setOpenId(brief.id);
    } catch (e) {
      setError(message(e));
      if (online) reloadQuietly();
    } finally {
      setBusy(null);
    }
  };

  if (!briefs) {
    return error ? <Screen><ErrorNote message={error} /><Button label="Try again" onPress={() => void load()} /></Screen> : <Loading label="Loading your briefs…" />;
  }

  const current = briefs.find((b) => b.id === openId) ?? briefs[0];
  const earlier = briefs.filter((b) => b.id !== current?.id);
  const latest = briefs[0];
  const suggested = kindForHour(new Date().getHours());
  // Evening briefs never pull, so a refetch late in the day writes an afternoon brief instead.
  const refetchKind: Kind = suggested === 'evening' ? 'afternoon' : suggested;
  const stale = current === latest && freshness(briefs, online, new Date()).startsWith('stale');

  return (
    <Screen maxWidth={PAGE_WIDTH}>
      {stale && latest ? <StaleNote brief={latest} generating={generating} online={online} /> : null}
      {current ? <FrontPage brief={current} wide={wide} ledger={ledger} /> : <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 18 }}>No briefs yet. Write your first one below.</Text>}

      {!hasSchedules ? (
        <View style={{ gap: 10 }}>
          <Rule />
          <Text style={{ color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 24 }}>Want this without asking? Choose a schedule and your server writes it for you.</Text>
          <Button label="Choose a schedule" variant="secondary" onPress={onSchedule} />
        </View>
      ) : null}

      <ErrorNote message={error} />

      <View style={{ gap: 12 }}>
        <Rule strong />
        <Head>New brief</Head>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 10 }}>
          {KINDS.map((k) => (
            <View key={k} style={wide ? { flex: 1 } : null}>
              <Button label={`${KIND_LABEL[k]} brief`} variant={k === suggested ? 'primary' : 'secondary'} busy={busy === k} disabled={busy !== null || generating} onPress={() => void generate(k)} />
            </View>
          ))}
        </View>
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>{`${KIND_LABEL[suggested]} fits the time of day, so it's highlighted.`}</Text>
        <Button label="Refetch tools, then write" variant="secondary" busy={busy === 'refresh'} disabled={busy !== null || generating || !online} onPress={() => void generate(refetchKind, true)} />
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>
          {online ? 'OS reads each tool once a day and reuses that data, which keeps API use low. Evening briefs never pull. Refetch is for when something just changed.' : 'Offline, a brief is written on this device from your goals, your updates and the last scan, then synced to your Mac when it’s back. Refetch needs your Mac.'}
        </Text>
      </View>

      {earlier.length ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Head>Earlier briefs</Head>
            {!confirmAll ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete all ${earlier.length} earlier briefs`} onPress={() => setConfirmAll(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: c.danger, fontFamily: F.sansMedium, fontSize: 14 }}>Delete all</Text>
              </Pressable>
            ) : null}
          </View>
          {confirmAll ? (
            <View accessibilityLiveRegion="polite" style={{ gap: 8, paddingBottom: 8 }}>
              <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 15, lineHeight: 21 }}>
                Delete {earlier.length === 1 ? 'this earlier brief' : `all ${earlier.length} earlier briefs`}? The brief you're reading stays. They're archived on your server, not erased.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Button label="Delete all" variant="danger" onPress={() => void archive(earlier.map((b) => b.id))} /></View>
                <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={() => setConfirmAll(false)} /></View>
              </View>
            </View>
          ) : null}
          {earlier.map((b) => {
            const label = `${edition(b.kind)}, ${shortDate(b.createdAt)}, ${clock(b.createdAt)}`;
            return (
              <SwipeRow key={b.id} label={label} onPress={() => setOpenId(b.id)} onDelete={() => void archive([b.id])}>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
                  <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 16 }}>{edition(b.kind)}</Text>
                  <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{`${shortDate(b.createdAt)} ${clock(b.createdAt)}`}</Text>
                </View>
              </SwipeRow>
            );
          })}
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19, paddingTop: 4 }}>Swipe an edition left to delete it.</Text>
        </View>
      ) : null}
    </Screen>
  );
}
