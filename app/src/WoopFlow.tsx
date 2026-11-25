import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Api } from './api';
import {
  CUES, ifThen, LIMITS, OBSTACLE_TAGS, TAG_LABEL, type Cue, type ObstacleSuggestion, type ObstacleTag, type PlanSuggestion, type Woop,
} from './core/woop';
import { Button, DarkTheme, ErrorNote, F, R, display, message, useColors } from './ui';

const STEPS = ['Wish', 'Outcome', 'Obstacle', 'Plan'] as const;
const VISUALIZE_SECONDS = 30;
const TARGET_SECONDS = 5 * 60;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * The four WOOP steps, one screen each, in under five minutes. Always dark, one input per step,
 * and the return key moves on. The obstacle step is the loud one, because it's the one people skip.
 */
export function WoopFlow({ api, visible, editing, onClose, onSaved }: { api: Api; visible: boolean; editing: Woop | null; onClose(): void; onSaved(): void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <DarkTheme>
        {visible ? <Flow api={api} editing={editing} onClose={onClose} onSaved={onSaved} /> : null}
      </DarkTheme>
    </Modal>
  );
}

function Flow({ api, editing, onClose, onSaved }: { api: Api; editing: Woop | null; onClose(): void; onSaved(): void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [wish, setWish] = useState(editing?.wish ?? '');
  const [outcome, setOutcome] = useState(editing?.outcome ?? '');
  const [obstacle, setObstacle] = useState(editing?.obstacle ?? '');
  const [tag, setTag] = useState<ObstacleTag | null>(editing?.obstacleTag ?? null);
  const [cue, setCue] = useState<Cue | null>(editing?.cue ?? null);
  const [plan, setPlan] = useState(editing?.plan ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The whole flow's clock, and the outcome step's 30 seconds.
  const started = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [visualizeLeft, setVisualizeLeft] = useState(VISUALIZE_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (step !== 1) return;
    setVisualizeLeft(VISUALIZE_SECONDS);
    const timer = setInterval(() => setVisualizeLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [step]);

  const [obstacles, setObstacles] = useState<{ list: ObstacleSuggestion[]; source: string; note: string | null } | null>(null);
  const [plans, setPlans] = useState<{ list: PlanSuggestion[]; source: string; note: string | null } | null>(null);
  const [loading, setLoading] = useState<'obstacles' | 'plans' | null>(null);
  const predictedFor = useRef('');
  const plannedFor = useRef('');
  useEffect(() => {
    if (step === 2 && predictedFor.current !== wish) {
      predictedFor.current = wish;
      setLoading('obstacles');
      api.predictObstacles(wish).then((r) => setObstacles({ list: r.suggestions, source: r.source, note: r.note }), () => setObstacles(null)).finally(() => setLoading(null));
    }
    const key = `${obstacle}|${tag}`;
    if (step === 3 && tag && plannedFor.current !== key) {
      plannedFor.current = key;
      setLoading('plans');
      api.optimizePlan({ wish, obstacle, tag, cue: cue ?? 'evening', draft: plan })
        .then((r) => setPlans({ list: r.suggestions, source: r.source, note: r.note }), () => setPlans(null)).finally(() => setLoading(null));
    }
    // Only a step change asks again; typing doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const canNext = [wish.trim(), true, obstacle.trim() && tag && cue, plan.trim()][step];
  const next = async () => {
    if (!canNext) return;
    setError(null);
    if (step < 3) return setStep(step + 1);
    setBusy(true);
    try {
      await api.saveWoop({ wish, outcome, obstacle, obstacleTag: tag!, cue: cue!, plan });
      onSaved();
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (value: string, onChange: (t: string) => void, max: number, placeholder: string, label: string, multiline = false) => (
    <TextInput
      accessibilityLabel={label}
      // The obstacle step opens on its predictions, which the keyboard would cover.
      autoFocus={step !== 2}
      value={value}
      onChangeText={onChange}
      maxLength={max}
      multiline={multiline}
      blurOnSubmit
      returnKeyType={step === 3 ? 'done' : 'next'}
      onSubmitEditing={() => void next()}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      style={{ color: c.text, fontFamily: F.text, fontSize: 22, lineHeight: 30, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.line2, ...(multiline ? { minHeight: 90, textAlignVertical: 'top' } : null) }}
    />
  );

  const over = elapsed > TARGET_SECONDS;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 44 }}>
        <Pressable accessibilityRole="button" onPress={step ? () => setStep(step - 1) : onClose} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 15 }}>{step ? 'back' : 'close'}</Text>
        </Pressable>
        <Text accessibilityLabel={`${Math.floor(elapsed / 60)} minutes in, aim for under 5`} style={{ color: over ? c.danger : c.muted, fontFamily: F.mono, fontSize: 13 }}>{`${clock(elapsed)} / 05:00`}</Text>
      </View>

      <View accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of 4, ${STEPS[step]}`} style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingTop: 8 }}>
        {STEPS.map((name, i) => (
          <View key={name} style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: i <= step ? c.accent : i === 2 ? c.accentSoft : c.line }} />
            <Text style={{ color: i === step ? c.text : i === 2 ? c.accent : c.muted, fontFamily: i === step || i === 2 ? F.sansBold : F.sans, fontSize: 12 }}>{name}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {step === 0 ? (
          <>
            <Head eyebrow="w · wish" title="what do you want this week?" />
            <Hint>One goal, specific and within reach in seven days. Challenging, but doable.</Hint>
            {input(wish, setWish, LIMITS.wish, 'Run three times before Sunday', 'Your wish')}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Head eyebrow="o · outcome" title="picture the best result" />
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
              <Text accessibilityLiveRegion="polite" style={{ color: visualizeLeft ? c.accent : c.muted, fontFamily: F.mono, fontSize: 44 }}>{`0:${String(visualizeLeft).padStart(2, '0')}`}</Text>
              <Hint>{visualizeLeft ? 'Close your eyes. How does it feel when it\'s done? Thirty seconds, no more.' : 'Time. Catch it in one line, then move on.'}</Hint>
            </View>
            {input(outcome, setOutcome, LIMITS.outcome, 'Light, proud, sleeping better', 'Your best outcome', true)}
          </>
        ) : null}

        {step === 2 ? (
          <View style={{ gap: 16, borderWidth: 2, borderColor: c.accent, borderRadius: R.card, backgroundColor: c.accentSoft, padding: 16 }}>
            <Text style={{ color: c.accent, fontFamily: F.sansBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>the step most people skip</Text>
            <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 40, lineHeight: 42 }}>what inside you will get in the way?</Text>
            <Hint>A feeling, habit or belief, not other people. Naming it is what makes WOOP work.</Hint>
            {input(obstacle, setObstacle, LIMITS.obstacle, "I'm too drained after work to start", 'Your obstacle')}

            <View style={{ gap: 8 }}>
              <Label>{obstacles?.source === 'ai' ? 'Likely, from your history (AI)' : 'Likely, from your history'}</Label>
              {loading === 'obstacles' ? <ActivityIndicator color={c.accent} /> : null}
              {obstacles?.list.map((s) => (
                <Suggestion
                  key={s.obstacle + s.tag}
                  title={s.obstacle}
                  detail={`${TAG_LABEL[s.tag]} · ${s.cue} · ${s.reason}`}
                  selected={obstacle === s.obstacle}
                  onPress={() => { setObstacle(s.obstacle); setTag(s.tag); setCue(s.cue); }}
                />
              ))}
              {obstacles?.note ? <Hint>{obstacles.note}</Hint> : null}
            </View>

            <View style={{ gap: 8 }}>
              <Label>What kind</Label>
              <Pills<ObstacleTag> options={OBSTACLE_TAGS} value={tag} label={(t) => TAG_LABEL[t]} onChange={setTag} />
              <Label>When it usually shows up</Label>
              <Pills<Cue> options={CUES} value={cue} label={(t) => t} onChange={setCue} />
              <Hint>Your reminder fires around then, with your plan.</Hint>
            </View>
          </View>
        ) : null}

        {step === 3 ? (
          <>
            <Head eyebrow="p · plan" title="finish the sentence" />
            <Text style={{ color: c.ink2, ...display, fontSize: 28, lineHeight: 32 }}>{ifThen(obstacle, '').replace(/ …\.$/, '')}</Text>
            {input(plan, setPlan, LIMITS.plan, 'put on my shoes and run for 10 minutes', 'Then I will')}
            <View style={{ gap: 8 }}>
              <Label>{plans?.source === 'ai' ? 'Stronger plans (AI, ranked by what worked)' : 'Stronger plans, from what worked'}</Label>
              {loading === 'plans' ? <ActivityIndicator color={c.accent} /> : null}
              {plans?.list.map((p) => (
                <Suggestion
                  key={p.plan}
                  title={p.plan}
                  detail={p.rate !== null ? `${Math.round(p.rate * 100)}% when it showed up · ${p.reason}` : p.reason}
                  selected={plan === p.plan}
                  onPress={() => setPlan(p.plan)}
                />
              ))}
              {plans?.note ? <Hint>{plans.note}</Hint> : null}
            </View>
            {plan.trim() ? (
              <View style={{ borderLeftWidth: 2, borderColor: c.accent, paddingLeft: 12 }}>
                <Text style={{ color: c.text, fontFamily: F.text, fontSize: 17, lineHeight: 25 }}>{ifThen(obstacle, plan)}</Text>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={{ flex: 1 }} />
        <ErrorNote message={error} />
        <Button label={step < 3 ? 'next' : editing ? 'save changes' : 'save my woop'} busy={busy} disabled={!canNext} onPress={() => void next()} />
        {step === 1 && !outcome.trim() ? <Hint>You can skip writing it. The picture is what counts.</Hint> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Head({ eyebrow, title }: { eyebrow: string; title: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 40, lineHeight: 42 }}>{title}</Text>
    </View>
  );
}

function Hint({ children }: { children: string }) {
  const c = useColors();
  return <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{children}</Text>;
}

function Label({ children }: { children: string }) {
  const c = useColors();
  return <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{children}</Text>;
}

function Suggestion({ title, detail, selected, onPress }: { title: string; detail: string; selected: boolean; onPress(): void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use: ${title}. ${detail}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: selected ? c.accent : c.line2, backgroundColor: pressed ? c.deep : c.card, borderRadius: R.control, padding: 12, gap: 4 })}
    >
      <Text style={{ color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 22 }}>{title}</Text>
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12, lineHeight: 16 }}>{detail}</Text>
    </Pressable>
  );
}

function Pills<T extends string>({ options, value, label, onChange }: { options: readonly T[]; value: T | null; label(t: T): string; onChange(t: T): void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === o }}
          onPress={() => onChange(o)}
          style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, justifyContent: 'center', borderColor: value === o ? c.accent : c.line2, backgroundColor: value === o ? c.accent : 'transparent' }}
        >
          <Text style={{ color: value === o ? c.onAccent : c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{label(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
