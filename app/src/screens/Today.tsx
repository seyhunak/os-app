import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, useWindowDimensions, View, type TextStyle } from 'react-native';
import type { Brief, Kind, LedgerEntry, Source } from '../api';
import { BriefProgress, useBriefProgress } from '../BriefProgress';
import { Markdown } from '../Markdown';
import { SwipeRow } from '../SwipeRow';
import type { Api } from '../api';
import { useRefresh } from '../refresh';
import { autoBriefFor, freshness } from '../staleBrief';
import { parseBrief, type Goal, type GoalStatus, type NoiseItem, type ParsedBrief, type Priority } from '../parseBrief';
import { Button, display, ErrorNote, F, Loading, message, R, Screen, useColors, type Colors } from '../ui';

const WIDE_AT = 860;
/** One readable column; the page doesn't spread out on a tablet. */
const PAGE_WIDTH = 720;
/** The newest updates shown beside the note for the next brief. */
const LEDGER_SHOWN = 3;

const KINDS: Kind[] = ['morning', 'afternoon', 'evening', 'night'];
const KIND_LABEL: Record<Kind, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const GREETING: Record<Kind, string> = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good night' };
const edition = (kind: Kind) => `${KIND_LABEL[kind] ?? kind} brief`;
/** The brief that fits the time of day: morning until noon, afternoon until five, evening until nine, then night. */
export const kindForHour = (hour: number): Kind => (hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night');
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
      <Text accessibilityRole="header" style={{ color: tone ?? c.text, ...display, fontSize: 30, lineHeight: 32 }}>{children}</Text>
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
    <View style={{ borderWidth: 1, borderColor: bg === 'transparent' ? c.line : bg, backgroundColor: bg, borderRadius: R.chip, paddingHorizontal: 8, paddingVertical: 1 }}>
      <Text style={{ color: fg, fontFamily: mono ? F.mono : F.sansMedium, fontSize: 12, lineHeight: 17, textTransform: 'lowercase' }}>{label}</Text>
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
        <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 30, lineHeight: 32 }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {aside ? <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{aside}</Text> : null}
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{open ? 'hide' : 'show'}</Text>
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

// ——— Masthead and summary ————————————————————————————————————————————

function Masthead({ brief, greeting, wide }: { brief: Brief; greeting: string; wide: boolean }) {
  const c = useColors();
  const meta: TextStyle = { color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 };
  const how = brief.trigger === 'offline'
    ? 'offline draft'
    : brief.trigger === 'schedule' ? 'on schedule' : 'on request';
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: wide ? 64 : 52, lineHeight: wide ? 62 : 50 }}>{greeting}</Text>
      <Text style={{ ...meta, color: c.ink2, fontFamily: F.sansMedium }}>{`${edition(brief.kind)}, ${longDate(brief.createdAt)}`}</Text>
      <Text style={meta}>
        <Text style={{ color: c.cool, fontFamily: F.mono }}>{clock(brief.createdAt)}</Text>
        {`  Written ${how}. ${brief.generator === 'ai' ? 'Ranked by AI against your goals.' : 'Unranked digest.'}`}
      </Text>
    </View>
  );
}

/** The 3 things to do first. Brass, because they're yours to do. */
function Focus({ items, text, wide }: { items: Priority[]; text: string | null; wide: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: 12 }}>
      <Head aside={items.length ? `${items.length} to do` : null}>focus</Head>
      {items.length ? (
        <Panel>
          {items.map((item, i) => (
            <Row key={i} first={i === 0} selected={i === 0}>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Text style={{ color: i === 0 ? c.accent : c.muted, fontFamily: F.monoMedium, fontSize: 14, lineHeight: 26, width: 22 }}>{pad(i + 1)}</Text>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: i === 0 && wide ? 20 : 18, lineHeight: i === 0 && wide ? 27 : 25 }}>{item.headline}</Text>
                  {item.action ? <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{item.action}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    {item.source ? <Tag label={item.source} fg={c.ink2} bg="transparent" /> : null}
                    {item.goal ? <Text style={{ flexShrink: 1, color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>{`moves ${item.goal}`}</Text> : null}
                  </View>
                </View>
              </View>
            </Row>
          ))}
        </Panel>
      ) : text ? (
        <View style={{ borderWidth: 1, borderColor: c.line, borderLeftWidth: 2, borderLeftColor: c.accent, borderRadius: R.card, backgroundColor: c.card, padding: 16 }}>
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 18, lineHeight: 25 }}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ——— Priorities ——————————————————————————————————————————————————————

function PriorityRow({ priority, rank, lead, wide }: { priority: Priority; rank: number; lead: boolean; wide: boolean }) {
  const c = useColors();
  const size = lead ? (wide ? 20 : 18) : 16;
  return (
    <Row first={rank === 1}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <Text style={{ color: c.muted, fontFamily: F.monoMedium, fontSize: 14, lineHeight: 22, width: 22 }}>{pad(rank)}</Text>
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {priority.source ? <Tag label={priority.source} fg={c.ink2} bg="transparent" /> : null}
            {priority.level === 'critical' ? <Tag label="Critical" fg={c.danger} bg={c.dangerSoft} /> : priority.level === 'supporting' ? <Tag label="Supporting" fg={c.muted} bg="transparent" /> : null}
            {priority.score !== null ? <Text style={{ color: c.cool, fontFamily: F.mono, fontSize: 13, lineHeight: 18, marginLeft: 'auto' }}>{priority.score}<Text style={{ color: c.muted }}>/100</Text></Text> : null}
          </View>
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: size, lineHeight: size * 1.35 }}>{priority.headline}</Text>
          {priority.action ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: c.accent, fontFamily: F.sansBold, fontSize: lead ? 17 : 15, lineHeight: lead ? 25 : 22 }}>→</Text>
              <Text style={{ flex: 1, color: c.ink2, fontFamily: F.text, fontSize: lead ? 17 : 15, lineHeight: lead ? 25 : 22 }}>{priority.action}</Text>
            </View>
          ) : null}
          {priority.goal || priority.unaligned ? (
            <Text style={{ color: priority.goal ? c.ink2 : c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
              {priority.goal ? `against ${priority.goal}` : 'not tied to a goal'}
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
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            {n.source ? <Tag label={n.source} fg={c.muted} bg="transparent" /> : null}
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
        <Text style={{ flex: 1, color: c.text, fontFamily: F.sansMedium, fontSize: 16, lineHeight: 22 }}>{source.name}</Text>
        <Text style={{ color: c.cool, fontFamily: F.mono, fontSize: 13 }}>{count(source.items, 'item')}</Text>
        <Text style={{ color: tone === c.ok ? c.muted : tone, fontFamily: F.sansMedium, fontSize: 12, minWidth: 74, textAlign: 'right' }}>{SOURCE_STATUS[source.status] ?? source.label ?? source.status}</Text>
      </View>
      {source.summary ? <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22, }}>{source.summary}</Text> : null}
      {old.map((item, i) => <Text key={i} style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22, }}>{item}</Text>)}
      {hidden > 0 ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, }}>and {hidden} more</Text> : null}
      {source.detail ? <Text style={{ color: c.danger, fontFamily: F.sans, fontSize: 13, lineHeight: 18, }}>{source.detail}</Text> : null}
    </Row>
  );
}

// ——— Ledger ————————————————————————————————————————————————————————

/** Your own log, newest first: the last few updates, and how many the next brief will read. */
function Updates({ entries, since }: { entries: LedgerEntry[]; since: number }) {
  const c = useColors();
  const shown = entries.slice(0, LEDGER_SHOWN);
  return (
    <View style={{ gap: 12 }}>
      <Head aside={entries.length ? `last ${shown.length} of ${entries.length}` : null}>latest updates</Head>
      {since ? (
        <Text style={{ color: c.ink2, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
          {count(since, 'update')} logged since this brief. The next brief will read {since === 1 ? 'it' : 'them'}.
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
        </Panel>
      ) : (
        <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>No updates yet. Tap update to log what you've done, and goals get real evidence.</Text>
      )}
    </View>
  );
}

// ——— The page ——————————————————————————————————————————————————————

const HEALTH_ORDER: Array<Exclude<GoalStatus, null>> = ['on-track', 'attention', 'at-risk', 'unknown'];

/** Goal health in one line, such as "2 on track, 1 at risk". */
const healthOf = (goals: Goal[]) =>
  HEALTH_ORDER.map((status) => [status, goals.filter((g) => g.status === status).length] as const)
    .filter(([, n]) => n)
    .map(([status, n]) => `${n} ${STATUS_LABEL[status].toLowerCase()}`)
    .join(', ') || null;

function FrontPage({ brief, wide, ledger }: { brief: Brief; wide: boolean; ledger: LedgerEntry[] | null }) {
  const c = useColors();
  const parsed = parseBrief(brief.markdown, brief.sources.map((s) => s.name));
  const greeting = parsed.greeting ?? GREETING[brief.kind] ?? edition(brief.kind);

  if (!parsed.structured) {
    return (
      <View style={{ gap: 20 }}>
        <Masthead brief={brief} greeting={greeting} wide={wide} />
        <Markdown source={brief.markdown} />
      </View>
    );
  }

  const newestFirst = [...(ledger ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const since = newestFirst.filter((e) => Date.parse(e.createdAt) > Date.parse(brief.createdAt)).length;
  const listed = brief.sources.length > 0 && brief.sources.every((s) => s.summary !== undefined || s.contents);
  const scanned = brief.sources.filter((s) => SCANNED.has(s.status)).length;

  return (
    <View style={{ gap: 32 }}>
      {/* Section one: the brief. */}
      <View style={{ gap: 32 }}>
        <Masthead brief={brief} greeting={greeting} wide={wide} />
        {parsed.notice ? <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{parsed.notice}</Text> : null}
        {parsed.focusItems.length || parsed.focus ? <Focus items={parsed.focusItems} text={parsed.focus} wide={wide} /> : null}

        <View style={{ gap: 12 }}>
          <Head aside={parsed.priorities.length ? `${count(parsed.priorities.length, 'signal')}, scored against your goals` : null}>signals</Head>
          {parsed.priorities.length ? (
            <Panel>{parsed.priorities.map((p, i) => <PriorityRow key={i} priority={p} rank={i + 1} lead={i === 0} wide={wide} />)}</Panel>
          ) : parsed.prioritiesText ? <Markdown source={parsed.prioritiesText} /> : (
            <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15 }}>No signals today.</Text>
          )}
        </View>

        {parsed.noise.length ? (
          <Collapsible title="noise" aside={`${count(parsed.noise.length, 'item')} left out`} defaultOpen={false}>
            <LeftOut items={parsed.noise} />
          </Collapsible>
        ) : null}

        {parsed.goals.length || parsed.goalsText ? (
          <View style={{ gap: 12 }}>
            <Head aside={healthOf(parsed.goals)}>goal progress</Head>
            {parsed.goals.length ? <Panel>{parsed.goals.map((g, i) => <GoalRow key={i} goal={g} first={i === 0} />)}</Panel> : null}
            {parsed.goalsText ? <Markdown source={parsed.goalsText} /> : null}
          </View>
        ) : null}

        {listed || parsed.sources ? (
          <View style={{ gap: 12 }}>
            <Head aside={listed ? `${scanned} of ${brief.sources.length} read` : null}>sources</Head>
            {listed ? <Panel>{brief.sources.map((s, i) => <ToolRow key={s.toolkit} source={s} first={i === 0} />)}</Panel> : <Markdown source={parsed.sources ?? ''} />}
          </View>
        ) : null}
      </View>

      {/* Section two: what carries over. */}
      <View style={{ gap: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, borderRadius: R.card, padding: wide ? 24 : 16 }}>
        <View style={{ gap: 12 }}>
          <Head>note for next brief</Head>
          <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 16, lineHeight: 24 }}>{parsed.note ?? 'Nothing to carry over.'}</Text>
        </View>
        {ledger ? <Updates entries={newestFirst} since={since} /> : null}
      </View>
    </View>
  );
}

/** Shown above a brief from an earlier day: either today's is being written, or it can't be yet. */
function StaleNote({ brief, generating }: { brief: Brief; generating: boolean }) {
  const c = useColors();
  const showing = shortDate(brief.createdAt);
  const text = generating
    ? `Writing today's brief with fresh tool data… Showing ${showing} until it's ready.`
    : `Outdated: this brief is from ${shortDate(brief.createdAt)}. Write a new one below.`;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderLeftWidth: 3, borderColor: c.line, borderLeftColor: generating ? c.cool : c.danger, borderRadius: R.control, backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: 10 }}>
      <Text style={{ flex: 1, color: c.text, fontFamily: F.sansMedium, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export function TodayScreen({ api, hasSchedules, onSchedule }: { api: Api; hasSchedules: boolean; onSchedule(): void }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_AT;
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState<Kind | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshKey } = useRefresh();
  const auto = useMemo(() => autoBriefFor(api), [api]);
  const [generating, setGenerating] = useState(() => auto.pending() !== null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const progress = useBriefProgress();
  const [watching, setWatching] = useState<{ kind: Kind; error: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setBriefs((await api.briefs()).briefs);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);

  /** Reloads the list after a failure, keeping the error shown. */
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
    const request = auto.maybeGenerate(briefs);
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
  }, [auto, briefs, reloadQuietly]);

  const [confirmAll, setConfirmAll] = useState(false);
  /** Hidden at once, then archived in the phone's store. */
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

  const closeProgress = useCallback(() => setWatching(null), []);

  const generate = async (kind: Kind, refresh = false) => {
    setBusy(refresh ? 'refresh' : kind);
    setError(null);
    progress.reset();
    setWatching({ kind, error: null });
    try {
      const brief = await api.generateBrief(kind, refresh, progress.onProgress);
      setBriefs((list) => [brief, ...(list ?? [])]);
      setOpenId(brief.id);
    } catch (e) {
      setError(message(e));
      setWatching((w) => (w ? { ...w, error: message(e) } : w));
      reloadQuietly();
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
  // Evening and night briefs never pull, so a refetch late in the day writes an afternoon brief instead.
  const refetchKind: Kind = suggested === 'evening' || suggested === 'night' ? 'afternoon' : suggested;
  const stale = current === latest && freshness(briefs, new Date()) === 'stale';

  return (
    <Screen maxWidth={PAGE_WIDTH}>
      <BriefProgress
        visible={watching !== null}
        title={watching ? `writing your ${KIND_LABEL[watching.kind].toLowerCase()} brief` : ''}
        steps={progress.steps}
        error={watching?.error ?? null}
        onClose={closeProgress}
      />
      {stale && latest ? <StaleNote brief={latest} generating={generating} /> : null}
      {current ? <FrontPage brief={current} wide={wide} ledger={ledger} /> : <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 18 }}>No briefs yet. Write your first one below.</Text>}

      {!hasSchedules ? (
        <View style={{ gap: 10 }}>
          <Rule />
          <Text style={{ color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 24 }}>Want this without asking? Choose a schedule and this phone reminds you, then writes it when you open the reminder.</Text>
          <Button label="Choose a schedule" variant="secondary" onPress={onSchedule} />
        </View>
      ) : null}

      <ErrorNote message={error} />

      <View style={{ gap: 12 }}>
        <Rule strong />
        <Head>new brief</Head>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {KINDS.map((k) => (
            <View key={k} style={{ flexGrow: 1, flexBasis: wide ? 0 : '45%' }}>
              <Button label={KIND_LABEL[k]} variant={k === suggested ? 'primary' : 'secondary'} busy={busy === k} disabled={busy !== null || generating} onPress={() => void generate(k)} />
            </View>
          ))}
        </View>
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>{`${KIND_LABEL[suggested]} fits the time of day, so it's highlighted.`}</Text>
        <Button label="Refetch tools, then write" variant="secondary" busy={busy === 'refresh'} disabled={busy !== null || generating} onPress={() => void generate(refetchKind, true)} />
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>
          OS reads each tool once a day and reuses that data, which keeps API use low. Evening and night briefs never pull. Refetch is for when something just changed.
        </Text>
      </View>

      {earlier.length ? (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Head>earlier briefs</Head>
            {!confirmAll ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete all ${earlier.length} earlier briefs`} onPress={() => setConfirmAll(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: c.danger, fontFamily: F.sansMedium, fontSize: 14 }}>delete all</Text>
              </Pressable>
            ) : null}
          </View>
          {confirmAll ? (
            <View accessibilityLiveRegion="polite" style={{ gap: 8, paddingBottom: 8 }}>
              <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 15, lineHeight: 21 }}>
                Delete {earlier.length === 1 ? 'this earlier brief' : `all ${earlier.length} earlier briefs`}? The brief you're reading stays.
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
