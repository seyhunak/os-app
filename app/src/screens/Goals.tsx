import { useCallback, useContext, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Api } from '../api';
import { ifThen, TAG_LABEL, type WeekSummary, type WoopResult } from '../core/woop';
import { RefreshContext } from '../refresh';
import { WoopFlow } from '../WoopFlow';
import { Button, Card, ErrorNote, F, Loading, R, Screen, display, message, useColors, type Colors } from '../ui';

type WoopView = Awaited<ReturnType<Api['woop']>>;

const DAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const RESULT_LABEL: Record<WoopResult, string> = { achieved: 'Achieved', partial: 'Partly', missed: 'Missed' };
const pct = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** WOOP goals: this week's wish and its if-then plan, today's check-in, your streak, and the weekly review. */
export function GoalsScreen({ api }: { api: Api }) {
  const c = useColors();
  const { refreshKey } = useContext(RefreshContext);
  const [view, setView] = useState<WoopView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<'new' | 'edit' | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.woop());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!view) return error ? <Screen><ErrorNote message={error} /></Screen> : <Loading label="Loading your goals…" />;
  const { current, unreviewed, past, streak, insights, today } = view;
  // The review opens on Friday, so the week can be judged while it's still fresh.
  const reviewOpen = current && !current.woop.result && today >= current.days[4]!.date;

  return (
    <Screen>
      <WoopFlow api={api} visible={flow !== null} editing={flow === 'edit' ? current?.woop ?? null : null} onClose={() => setFlow(null)} onSaved={() => void load()} />
      <ErrorNote message={error} />

      {unreviewed ? <ReviewCard api={api} week={unreviewed} title="how did last week go?" onDone={load} /> : null}

      {current ? (
        <WoopCard week={current} onEdit={() => setFlow('edit')} />
      ) : (
        <Card>
          <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{`week of ${shortDate(view.weekStart)}`}</Text>
          <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 36, lineHeight: 38 }}>one wish this week</Text>
          <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 16, lineHeight: 24 }}>
            Wish, Outcome, Obstacle, Plan. Picture it, name what inside you will get in the way, and decide now what you'll do when it does. Under five minutes.
          </Text>
          <Button label="start this week's woop" onPress={() => setFlow('new')} />
        </Card>
      )}

      {current ? <CheckInCard api={api} week={current} today={today} onDone={load} /> : null}
      {current && reviewOpen ? <ReviewCard api={api} week={current} title="review this week" onDone={load} /> : null}

      <StreakCard streak={streak} />

      {past.length || current ? (
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 30, lineHeight: 32 }}>weekly review</Text>
          <Insights insights={insights} />
          {past.slice(0, 12).map((s) => <PastWeek key={s.woop.id} week={s} />)}
          {!past.length ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>Past weeks show up here, with how often your plan held.</Text> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function WoopCard({ week, onEdit }: { week: WeekSummary; onEdit(): void }) {
  const c = useColors();
  const { woop } = week;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{`this week · from ${shortDate(woop.weekStart)}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit this week's WOOP" onPress={onEdit} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>edit</Text>
        </Pressable>
      </View>
      <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 34, lineHeight: 36 }}>{woop.wish}</Text>
      {woop.outcome ? <Text style={{ color: c.muted, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{`Outcome: ${woop.outcome}`}</Text> : null}
      <View style={{ borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentSoft, borderRadius: R.control, padding: 12, gap: 4 }}>
        <Text style={{ color: c.accent, fontFamily: F.sansBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{`obstacle · ${TAG_LABEL[woop.obstacleTag]} · ${woop.cue}`}</Text>
        <Text style={{ color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 23 }}>{woop.obstacle}</Text>
      </View>
      <Text style={{ color: c.text, ...display, fontSize: 24, lineHeight: 28 }}>{ifThen(woop.obstacle, woop.plan)}</Text>
    </Card>
  );
}

function Toggle({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, opacity: disabled ? 0.45 : 1 }}
    >
      <Text style={{ flexShrink: 1, color: c.text, fontFamily: F.text, fontSize: 16 }}>{label}</Text>
      <View style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: value ? c.accent : c.line2, alignItems: value ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: value ? c.onAccent : c.bg }} />
      </View>
    </Pressable>
  );
}

/** Each tap saves. The week strip shows every day at a glance. */
function CheckInCard({ api, week, today, onDone }: { api: Api; week: WeekSummary; today: string; onDone(): Promise<void> }) {
  const c = useColors();
  const saved = week.days.find((d) => d.date === today)?.checkIn;
  const [error, setError] = useState<string | null>(null);
  const set = async (change: Partial<{ progressed: boolean; obstacleHit: boolean; planUsed: boolean }>) => {
    const next = { progressed: saved?.progressed ?? false, obstacleHit: saved?.obstacleHit ?? false, planUsed: saved?.planUsed ?? false, ...change };
    try {
      await api.checkIn({ woopId: week.woop.id, ...next });
      setError(null);
      await onDone();
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <Card>
      <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 28, lineHeight: 30 }}>today</Text>
      <Toggle label="I moved the wish forward" value={saved?.progressed ?? false} onChange={(v) => void set({ progressed: v })} />
      <Toggle label="The obstacle showed up" value={saved?.obstacleHit ?? false} onChange={(v) => void set({ obstacleHit: v, ...(v ? {} : { planUsed: false }) })} />
      <Toggle label="I followed my plan" value={saved?.planUsed ?? false} disabled={!saved?.obstacleHit} onChange={(v) => void set({ planUsed: v })} />
      <ErrorNote message={error} />
      <WeekStrip week={week} today={today} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat value={`${week.progressedDays}/7`} label="days moved" />
        <Stat value={String(week.obstacleHits)} label="obstacle days" />
        <Stat value={pct(week.planRate)} label="plan held" />
      </View>
    </Card>
  );
}

const dayTone = (c: Colors, d: WeekSummary['days'][number]) => {
  const k = d.checkIn;
  if (!k) return { fill: 'transparent', ring: c.line2 };
  if (k.obstacleHit && !k.planUsed) return { fill: c.dangerSoft, ring: c.danger };
  return { fill: k.progressed ? c.accent : 'transparent', ring: k.obstacleHit ? c.ok : c.accent };
};

function WeekStrip({ week, today }: { week: WeekSummary; today: string }) {
  const c = useColors();
  return (
    <View accessibilityLabel={`This week: moved forward ${week.progressedDays} days, obstacle on ${week.obstacleHits}, plan used ${week.planUsed} times`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 }}>
      {week.days.map((d, i) => {
        const tone = dayTone(c, d);
        return (
          <View key={d.date} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: tone.ring, backgroundColor: tone.fill }} />
            <Text style={{ color: d.date === today ? c.text : c.muted, fontFamily: d.date === today ? F.sansBold : F.sans, fontSize: 12 }}>{DAY_LETTER[i]}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** `words` for a value that's a name, not a number, since mono is only for what the system counts. */
function Stat({ value, label, words }: { value: string; label: string; words?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.deep, borderRadius: R.control, padding: 10, gap: 2 }}>
      <Text numberOfLines={1} style={{ color: c.text, fontFamily: words ? F.sansMedium : F.monoMedium, fontSize: words ? 17 : 20, lineHeight: 26 }}>{value}</Text>
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function ReviewCard({ api, week, title, onDone }: { api: Api; week: WeekSummary; title: string; onDone(): Promise<void> }) {
  const c = useColors();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<WoopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const review = async (result: WoopResult) => {
    setBusy(result);
    try {
      await api.reviewWoop(week.woop.id, result, note);
      await onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 28, lineHeight: 30 }}>{title}</Text>
      <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 16, lineHeight: 23 }}>{week.woop.wish}</Text>
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
        {`Moved it ${week.progressedDays} of 7 days. The obstacle showed up ${week.obstacleHits} times, and the plan held ${week.planUsed}.`}
      </Text>
      <TextInput
        accessibilityLabel="What you learned, optional"
        value={note}
        onChangeText={setNote}
        maxLength={500}
        placeholder="What you learned (optional)"
        placeholderTextColor={c.muted}
        style={{ minHeight: 48, borderWidth: 1, borderColor: c.line2, borderRadius: R.control, backgroundColor: c.bg, paddingHorizontal: 14, color: c.text, fontFamily: F.text, fontSize: 16 }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['achieved', 'partial', 'missed'] as const).map((r) => (
          <View key={r} style={{ flex: 1 }}>
            <Button label={RESULT_LABEL[r]} variant={r === 'achieved' ? 'primary' : 'secondary'} busy={busy === r} disabled={busy !== null} onPress={() => void review(r)} />
          </View>
        ))}
      </View>
      <ErrorNote message={error} />
    </Card>
  );
}

function StreakCard({ streak }: { streak: WoopView['streak'] }) {
  const c = useColors();
  const tone = (state: WoopView['streak']['recent'][number]['state']) =>
    state === 'none' ? c.line : state === 'achieved' ? c.accent : state === 'missed' ? c.danger : state === 'partial' ? c.ink2 : c.muted;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Text accessibilityLabel={`${streak.weeks} week streak`} style={{ color: c.accent, fontFamily: F.monoMedium, fontSize: 40, lineHeight: 44 }}>{streak.weeks}</Text>
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>{streak.weeks === 1 ? 'week in a row' : 'weeks in a row'}</Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text style={{ color: c.text, fontFamily: F.monoMedium, fontSize: 24 }}>{streak.days}</Text>
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>check-in days</Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text style={{ color: c.text, fontFamily: F.monoMedium, fontSize: 24 }}>{streak.best}</Text>
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>best</Text>
        </View>
      </View>
      <View accessibilityLabel="The last 8 weeks" style={{ flexDirection: 'row', gap: 6 }}>
        {streak.recent.map((w) => <View key={w.weekStart} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: tone(w.state) }} />)}
      </View>
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12 }}>Last 8 weeks. Brass: achieved. Grey: set or partly. Red: missed.</Text>
    </Card>
  );
}

function Insights({ insights }: { insights: WoopView['insights'] }) {
  const c = useColors();
  const top = insights.obstacles[0];
  if (!top && !insights.bestPlan) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {top ? <Stat words value={TAG_LABEL[top.tag]} label={`top obstacle, ${top.hits} ${top.hits === 1 ? 'day' : 'days'}`} /> : null}
      <Stat value={pct(insights.achievedRate)} label="weeks achieved" />
      {insights.bestPlan ? (
        <View style={{ flex: 1.4, backgroundColor: c.deep, borderRadius: R.control, padding: 10, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: c.text, fontFamily: F.text, fontSize: 14, lineHeight: 19 }}>{insights.bestPlan.plan}</Text>
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12 }}>{`best plan, held ${pct(insights.bestPlan.rate)}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PastWeek({ week }: { week: WeekSummary }) {
  const c = useColors();
  const { woop } = week;
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: 10, gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 12 }}>{shortDate(woop.weekStart)}</Text>
        <Text style={{ color: woop.result === 'achieved' ? c.accent : woop.result === 'missed' ? c.danger : c.muted, fontFamily: F.sansMedium, fontSize: 12 }}>
          {woop.result ? RESULT_LABEL[woop.result] : 'Not reviewed'}
        </Text>
      </View>
      <Text style={{ color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 22 }}>{woop.wish}</Text>
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
        {`${TAG_LABEL[woop.obstacleTag]} · showed up ${week.obstacleHits} · plan held ${pct(week.planRate)}`}
      </Text>
      {woop.reviewNote ? <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 14, lineHeight: 20 }}>{woop.reviewNote}</Text> : null}
    </View>
  );
}
