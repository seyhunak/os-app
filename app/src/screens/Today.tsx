import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, useWindowDimensions, View, type TextStyle } from 'react-native';
import type { Api, Brief, Kind, Source } from '../api';
import { Markdown } from '../Markdown';
import { parseBrief, type Goal, type GoalStatus, type NoiseItem, type Priority } from '../parseBrief';
import { Button, ErrorNote, F, Loading, message, Screen, useColors, type Colors } from '../ui';

const TWO_COLUMNS_AT = 860;
const PAGE_WIDTH = 1040;

const edition = (kind: Kind) => (kind === 'morning' ? 'Morning edition' : 'Evening edition');
// Built from parts, because iOS orders a combined weekday and date oddly ("6 November 2026 Friday").
const part = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString(undefined, options);
const longDate = (iso: string) => `${part(iso, { weekday: 'long' })}, ${part(iso, { day: 'numeric', month: 'long', year: 'numeric' })}`;
const shortDate = (iso: string) => `${part(iso, { weekday: 'short' })}, ${part(iso, { day: 'numeric', month: 'short' })}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const STATUS_LABEL: Record<Exclude<GoalStatus, null>, string> = {
  'on-track': 'On track',
  attention: 'Needs attention',
  'at-risk': 'At risk',
  unknown: 'Not enough evidence',
};

const statusColor = (status: GoalStatus, c: Colors) =>
  status === 'at-risk' ? c.danger : status === 'on-track' ? c.accent : status === 'attention' ? c.text : c.muted;

function Rule({ heavy }: { heavy?: boolean }) {
  const c = useColors();
  return <View style={{ height: heavy ? 3 : 1, backgroundColor: heavy ? c.text : c.line }} />;
}

function SectionTitle({ children }: { children: string }) {
  const c = useColors();
  return <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 22, lineHeight: 28 }}>{children}</Text>;
}

/** A section you can open and close. The summary stays visible while it's closed. */
function Collapsible({ title, summary, defaultOpen, children }: { title: string; summary?: string; defaultOpen: boolean; children: ReactNode }) {
  const c = useColors();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ gap: 14 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 24, lineHeight: 30 }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {summary ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>{summary}</Text> : null}
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{open ? 'Collapse' : 'Expand'}</Text>
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where a signal came from, how it ranked, and which goal it serves. */
function Kicker({ priority }: { priority: Priority }) {
  const c = useColors();
  const label = priority.level === 'critical' ? 'Critical' : priority.level === 'supporting' ? 'Supporting' : null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 }}>
      {priority.source ? <Text style={{ color: c.text, fontFamily: F.sansBold, fontSize: 13, lineHeight: 18 }}>{priority.source}</Text> : null}
      {label ? <Text style={{ color: priority.level === 'critical' ? c.danger : c.muted, fontFamily: F.sansMedium, fontSize: 13, lineHeight: 18 }}>{label}</Text> : null}
      {priority.score !== null ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>Score {priority.score}</Text> : null}
    </View>
  );
}

function GoalLine({ priority }: { priority: Priority }) {
  const c = useColors();
  if (!priority.goal && !priority.unaligned) return null;
  return (
    <Text style={{ color: priority.goal ? c.accent : c.muted, fontFamily: F.sansMedium, fontSize: 14, lineHeight: 20 }}>
      {priority.goal ? `For your goal: ${priority.goal}` : 'Not tied to any of your goals'}
    </Text>
  );
}

/** Everything read from one source, so you can see what the brief drew on. */
function SourceList({ source }: { source: Source }) {
  const c = useColors();
  const contents = source.contents ?? [];
  const hidden = source.items - contents.length;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 }}>
        <Text style={{ color: c.text, fontFamily: F.bold, fontSize: 18, lineHeight: 25 }}>{source.name}</Text>
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 25 }}>{count(source.items, 'item')}{source.label ? `, ${source.label.toLowerCase()}` : ''}</Text>
      </View>
      {source.detail ? <Text style={{ color: c.danger, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>{source.detail}</Text> : null}
      {contents.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 16, lineHeight: 23 }}>•</Text>
          <Text style={{ flex: 1, color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 23 }}>{item}</Text>
        </View>
      ))}
      {hidden > 0 ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>and {hidden} more</Text> : null}
    </View>
  );
}

/** The top priority is the front page's headline. */
function LeadStory({ priority, wide }: { priority: Priority; wide: boolean }) {
  const c = useColors();
  const size = wide ? 54 : priority.headline.length > 70 ? 32 : 40;
  return (
    <View style={{ gap: 12 }}>
      <Kicker priority={priority} />
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: size, lineHeight: size * 1.08, letterSpacing: -0.6 }}>{priority.headline}</Text>
      {priority.action ? <Text style={{ color: c.text, fontFamily: F.italic, fontSize: wide ? 25 : 21, lineHeight: wide ? 34 : 29 }}>{priority.action}</Text> : null}
      <GoalLine priority={priority} />
    </View>
  );
}

function Story({ priority }: { priority: Priority }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Kicker priority={priority} />
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.2 }}>{priority.headline}</Text>
      {priority.action ? <Text style={{ color: c.text, fontFamily: F.text, fontSize: 18, lineHeight: 27 }}>{priority.action}</Text> : null}
      <GoalLine priority={priority} />
    </View>
  );
}

/** Noise, struck through as an editor would cut it. */
function LeftOut({ items }: { items: NoiseItem[] }) {
  const c = useColors();
  return (
    <View style={{ gap: 12 }}>
      {items.map((n, i) => (
        <View key={i} style={{ gap: 2 }}>
          <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 17, lineHeight: 24, textDecorationLine: 'line-through' }}>{n.item}</Text>
          {n.reason ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>{n.reason}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function GoalRow({ goal }: { goal: Goal }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      {goal.status ? <Text style={{ color: statusColor(goal.status, c), fontFamily: F.sansBold, fontSize: 13, lineHeight: 18 }}>{STATUS_LABEL[goal.status]}</Text> : null}
      <Text style={{ color: c.text, fontFamily: F.bold, fontSize: 19, lineHeight: 25 }}>{goal.goal}</Text>
      {goal.evidence && !/^insufficient evidence\.?$/i.test(goal.evidence) ? <Text style={{ color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 24 }}>{goal.evidence}</Text> : null}
      {goal.action ? <Text style={{ color: c.text, fontFamily: F.italic, fontSize: 16, lineHeight: 24 }}>Next: {goal.action}</Text> : null}
    </View>
  );
}

function Masthead({ brief, wide }: { brief: Brief; wide: boolean }) {
  const c = useColors();
  const small: TextStyle = { color: c.text, fontFamily: F.sansMedium, fontSize: 13, lineHeight: 18 };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', justifyContent: 'space-between', alignItems: wide ? 'baseline' : 'flex-start', gap: wide ? 12 : 0 }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: wide ? 30 : 26, lineHeight: wide ? 36 : 32 }}>{edition(brief.kind)}</Text>
        <Text style={small}>{longDate(brief.createdAt)}</Text>
      </View>
      <Rule heavy />
      <Text style={{ ...small, color: c.muted, fontFamily: F.sans }}>
        {brief.trigger === 'schedule' ? `Written on schedule at ${clock(brief.createdAt)}` : `Written at ${clock(brief.createdAt)}`}
      </Text>
    </View>
  );
}

function FrontPage({ brief, wide }: { brief: Brief; wide: boolean }) {
  const c = useColors();
  const parsed = parseBrief(brief.markdown, brief.sources.map((s) => s.name));

  if (!parsed.structured) {
    return (
      <View style={{ gap: 20 }}>
        <Masthead brief={brief} wide={wide} />
        <Markdown source={brief.markdown} />
      </View>
    );
  }

  const [lead, ...others] = parsed.priorities;
  const signals = (
    <View style={{ gap: 22 }}>
      {parsed.notice ? <Text style={{ color: c.muted, fontFamily: F.italic, fontSize: 17, lineHeight: 25 }}>{parsed.notice}</Text> : null}
      <SectionTitle>Signals</SectionTitle>
      {lead ? <LeadStory priority={lead} wide={wide} /> : null}
      {parsed.prioritiesText ? <Markdown source={parsed.prioritiesText} /> : null}
      {others.map((p, i) => (
        <View key={i} style={{ gap: 22 }}>
          <Rule />
          <Story priority={p} />
        </View>
      ))}
    </View>
  );

  const goals = parsed.goals.length || parsed.goalsText ? (
    <Collapsible title="Goals" {...(parsed.goals.length ? { summary: count(parsed.goals.length, 'goal') } : {})} defaultOpen>
      <View style={{ gap: 16 }}>
        {parsed.goals.map((g, i) => <GoalRow key={i} goal={g} />)}
        {parsed.goalsText ? <Markdown source={parsed.goalsText} /> : null}
      </View>
    </Collapsible>
  ) : null;

  // Older briefs have no saved contents, so they show their source table instead.
  const listed = brief.sources.length > 0 && brief.sources.every((s) => s.contents);
  const read = brief.sources.reduce((total, s) => total + s.items, 0);

  return (
    <View style={{ gap: 22 }}>
      <Masthead brief={brief} wide={wide} />
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 32, alignItems: 'flex-start' }}>
          <View style={{ flex: 2 }}>{signals}</View>
          <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: c.line }} />
          <View style={{ flex: 1 }}>{goals}</View>
        </View>
      ) : (
        <>
          {signals}
          {goals ? <Rule /> : null}
          {goals}
        </>
      )}
      {listed || parsed.sources ? (
        <>
          <Rule />
          <Collapsible title="Sources" {...(listed ? { summary: count(read, 'item') } : {})} defaultOpen>
            {listed ? (
              <View style={{ gap: 18 }}>{brief.sources.map((s) => <SourceList key={s.toolkit} source={s} />)}</View>
            ) : <Markdown source={parsed.sources ?? ''} />}
          </Collapsible>
        </>
      ) : null}
      {parsed.noise.length ? (
        <>
          <Rule />
          <Collapsible title="Left out" summary={count(parsed.noise.length, 'item')} defaultOpen={false}>
            <LeftOut items={parsed.noise} />
          </Collapsible>
        </>
      ) : null}
      {parsed.note ? (
        <View style={{ gap: 10, borderTopWidth: 3, borderColor: c.accent, paddingTop: 14 }}>
          <Text accessibilityRole="header" style={{ color: c.accent, fontFamily: F.sansBold, fontSize: 13, lineHeight: 18 }}>Note for next brief</Text>
          <Text style={{ color: c.text, fontFamily: F.italic, fontSize: 21, lineHeight: 29 }}>{parsed.note}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function TodayScreen({ api, hasSchedules, onSchedule }: { api: Api; hasSchedules: boolean; onSchedule(): void }) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const wide = width >= TWO_COLUMNS_AT;
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busy, setBusy] = useState<Kind | 'refresh' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBriefs((await api.briefs()).briefs);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async (kind: Kind, refresh = false) => {
    setBusy(refresh ? 'refresh' : kind);
    setError(null);
    try {
      const brief = await api.generateBrief(kind, refresh);
      setBriefs((list) => [brief, ...(list ?? [])]);
      setOpenId(brief.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  if (!briefs) {
    return error ? <Screen><ErrorNote message={error} /><Button label="Try again" onPress={() => void load()} /></Screen> : <Loading label="Loading your briefs…" />;
  }

  const current = briefs.find((b) => b.id === openId) ?? briefs[0];
  const earlier = briefs.filter((b) => b.id !== current?.id);

  return (
    <Screen maxWidth={PAGE_WIDTH}>
      {current ? <FrontPage brief={current} wide={wide} /> : <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 18 }}>No briefs yet. Write your first one below.</Text>}

      {!hasSchedules ? (
        <View style={{ gap: 10 }}>
          <Rule />
          <Text style={{ color: c.text, fontFamily: F.text, fontSize: 18, lineHeight: 27 }}>Want this without asking? Choose a schedule and your server writes it for you.</Text>
          <Button label="Choose a schedule" onPress={onSchedule} />
        </View>
      ) : null}

      <ErrorNote message={error} />

      <View style={{ gap: 12 }}>
        <Rule heavy />
        <SectionTitle>New brief</SectionTitle>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 10 }}>
          <View style={wide ? { flex: 1 } : null}><Button label="New morning brief" variant="secondary" busy={busy === 'morning'} disabled={busy !== null} onPress={() => void generate('morning')} /></View>
          <View style={wide ? { flex: 1 } : null}><Button label="New evening brief" variant="secondary" busy={busy === 'evening'} disabled={busy !== null} onPress={() => void generate('evening')} /></View>
          <View style={wide ? { flex: 1 } : null}><Button label="Refetch tools, then write" variant="secondary" busy={busy === 'refresh'} disabled={busy !== null} onPress={() => void generate('morning', true)} /></View>
        </View>
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>
          OS reads each tool once a day and reuses that data, which keeps API use low. Refetch is for when something just changed.
        </Text>
      </View>

      {earlier.length ? (
        <View style={{ gap: 4 }}>
          <SectionTitle>Earlier editions</SectionTitle>
          {earlier.map((b) => (
            <Pressable key={b.id} accessibilityRole="button" onPress={() => setOpenId(b.id)} style={{ minHeight: 44, justifyContent: 'center', borderTopWidth: 1, borderColor: c.line }}>
              <Text style={{ color: c.text, fontFamily: F.text, fontSize: 17 }}>{edition(b.kind)}, {shortDate(b.createdAt)}, {clock(b.createdAt)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
