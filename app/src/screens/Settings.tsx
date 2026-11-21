import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { composioState, modelState } from '../settingsSummary';
import { COMPOSIO_URL, type Api, type ModelOption, type Status } from '../api';
import { GoalModal } from '../GoalModal';
import { useRefresh } from '../refresh';
import { ToolList } from '../ToolList';
import { Button, Card, display, ErrorNote, Field, message, Screen, Section, Title, useColors, F } from '../ui';

const DOTS = '••••••••••••';

function KeyRow({ name, label, state, hint, getKeyUrl, getKeyLabel, optional, onSave, onRemove }: {
  name: string; label: string; state: Status['composio']; hint: string | null; getKeyUrl?: string; getKeyLabel?: string; optional?: boolean;
  onSave(key: string): Promise<unknown>; onRemove(): Promise<unknown>;
}) {
  const c = useColors();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setValue('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={{ color: c.text, fontSize: 16, fontFamily: F.sansMedium }}>{name}</Text>
      <>
          <Field
            label={label}
            value={value}
            onChangeText={setValue}
            secureTextEntry
            placeholder={hint ? `${DOTS}${hint}` : 'Paste your key'}
            {...(hint ? { placeholderTextColor: c.text } : {})}
            hint={state ? 'Saved in this phone’s Keychain. Paste a new key to replace it.' : 'Kept in this phone’s Keychain.'}
          />
          <ErrorNote message={error} />
          {!state && getKeyUrl ? <Button label={getKeyLabel ?? `Open ${name}`} {...(optional ? { variant: 'secondary' as const } : {})} onPress={() => void Linking.openURL(getKeyUrl)} /> : null}
          {value.trim() ? <Button label={state ? 'Replace key' : 'Save key'} variant="secondary" busy={busy} disabled={value.trim().length < 8} onPress={() => void run(() => onSave(value.trim()))} /> : null}
          {state ? <Button label="Remove key" variant="danger" disabled={busy} onPress={() => void run(onRemove)} /> : null}
      </>
    </Card>
  );
}

/** What stays on this phone, and a way to erase it. */
function DataSection({ api, onErased }: { api: Api; onErased(): void }) {
  const c = useColors();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const erase = async () => {
    try {
      await api.eraseEverything();
      setConfirm(false);
      onErased();
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 15, lineHeight: 22 }}>
        OS runs on this phone. Your keys are in its Keychain, and your goals, updates and briefs are in its own storage. It sends requests only to Composio, to read your tools, and to OpenRouter, to write the brief.
      </Text>
      <ErrorNote message={error} />
      {confirm ? (
        <>
          <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontFamily: F.sans, fontSize: 15, lineHeight: 21 }}>Erase your keys, goals, updates, briefs and schedules from this phone? This can't be undone. Your Composio connections stay in your Composio account.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Erase" variant="danger" onPress={() => void erase()} /></View>
            <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={() => setConfirm(false)} /></View>
          </View>
        </>
      ) : <Button label="Erase everything on this phone" variant="danger" onPress={() => setConfirm(true)} />}
    </View>
  );
}

/** Recommended models are few, so they all show. The full list can run to hundreds. */
const MODELS_SHOWN = 12;
const ALL_MODELS_SHOWN = 60;

/** Which model writes your briefs, through OpenRouter. Cheap models that write well come first. */
function ModelSection({ api, status, onChanged }: { api: Api; status: Status; onChanged(): void }) {
  const c = useColors();
  const savedModel = status.openrouterModel ?? status.model ?? '';

  const [model, setModel] = useState(savedModel);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    setLoading(true);
    setListError(null);
    try {
      const result = await api.aiModels();
      setOptions(result.models);
      setListError(result.error);
    } catch (e) {
      setOptions([]);
      setListError(message(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // A new key can see different models, so the list reloads with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.openrouterHint]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveAi(model.trim());
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const typed = model.trim().toLowerCase();
  const exact = options.find((o) => o.id === model.trim());
  const recommended = options.filter((o) => o.recommended);
  // Models come cheapest first. If none are marked recommended, all show.
  const pool = showAll || !recommended.length ? options : recommended;
  const bestValue = recommended[0]?.id;
  // A chosen model hides the list, until you ask to change it. Typing searches every model.
  const candidates = exact ? (browsing ? pool : []) : typed ? options.filter((o) => o.id.toLowerCase().includes(typed)) : pool;
  const matches = candidates.slice(0, showAll ? ALL_MODELS_SHOWN : MODELS_SHOWN);
  const total = candidates.length;
  const changed = model.trim() !== savedModel;
  const canToggle = recommended.length > 0 && recommended.length < options.length && (browsing || !exact);
  // While you type, the list is search results, so the heading and toggle step aside.
  const browsingList = !typed || Boolean(exact);

  return (
    <View style={{ gap: 10 }}>
      <KeyRow
        name="OpenRouter key"
        label="OpenRouter API key"
        state={status.openrouter}
        hint={status.openrouterHint}
        getKeyUrl="https://openrouter.ai/keys"
        getKeyLabel="Get an OpenRouter key"
        onSave={(k) => api.saveOpenRouterKey(k).then(onChanged)}
        onRemove={() => api.removeCredential('openrouter').then(onChanged)}
      />

      <Field
        label="Model"
        value={model}
        onChangeText={(t) => { setModel(t); setSaved(false); setBrowsing(false); }}
        placeholder={loading ? 'Finding your models…' : 'Type or choose a model'}
        hint={exact ? `${exact.recommended ? 'Recommended. ' : ''}${exact.note ?? ''}`.trim() || undefined : undefined}
      />
      {listError ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 19 }}>{listError}</Text> : null}
      {exact && !browsing && options.length > 1 ? <Button label="See other models" variant="secondary" onPress={() => setBrowsing(true)} /> : null}
      {matches.length > 0 && browsingList ? (
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
          {pool === recommended && !typed ? 'Recommended: cheap models that write a good brief, cheapest first.' : 'Every model your key allows, cheapest first.'}
        </Text>
      ) : null}
      {matches.length ? (
        <View style={{ gap: 0, borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.card }}>
          {matches.map((option, i) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${option.id}${option.recommended ? ', recommended' : ''}`}
              accessibilityState={{ selected: option.id === model.trim() }}
              onPress={() => { setModel(option.id); setSaved(false); setBrowsing(false); }}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 2, borderTopWidth: i ? 1 : 0, borderColor: c.line }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ color: option.id === model.trim() ? c.accent : c.text, fontFamily: F.sansMedium, fontSize: 15, flexShrink: 1 }}>{option.id}</Text>
                {option.id === bestValue ? <Text style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 12 }}>Best value</Text>
                  : option.recommended && pool !== recommended ? <Text style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 12 }}>Recommended</Text> : null}
              </View>
              {option.note ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>{option.note}</Text> : null}
            </Pressable>
          ))}
          {total > matches.length ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, padding: 12, borderTopWidth: 1, borderColor: c.line }}>{total - matches.length} more. Type to narrow the list.</Text> : null}
        </View>
      ) : null}
      {canToggle && browsingList ? (
        <Button
          label={showAll ? 'Show recommended only' : `Show all ${options.length} models, cheapest first`}
          variant="secondary"
          onPress={() => setShowAll((v) => !v)}
        />
      ) : null}
      <ErrorNote message={error} />
      {saved && !changed ? <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 14 }}>Saved. Your next brief uses {model.trim()}.</Text> : null}
      {changed ? <Button label="Use this model" busy={busy} disabled={!model.trim()} onPress={() => void save()} /> : null}
    </View>
  );
}

const isOkr = (goal: string) => /^O\s*\d*\s*:/i.test(goal.trim());
/** A goal's first line without its "O:" label, for the collapsed list. */
const objectiveOf = (goal: string) => goal.trim().split('\n')[0]!.replace(/^O\s*\d*\s*:\s*/i, '');

/**
 * Up to five goals, one OKR each, in its own box. The AI writes each one from your notes, and you
 * can edit it after. Collapsed, it shows only the objectives. Empty goals start open.
 */
function GoalsSection({ api, hasAiKey }: { api: Api; hasAiKey: boolean }) {
  const c = useColors();
  const [saved, setSaved] = useState<string[] | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [max, setMax] = useState(5);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  /** Goals opened in the collapsed summary, to read in full. */
  const [opened, setOpened] = useState<number[]>([]);
  const [busy, setBusy] = useState<'save' | number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { refreshKey } = useRefresh();
  const dirty = saved !== null && JSON.stringify(drafts) !== JSON.stringify(saved);
  const editing = useRef(false);
  editing.current = dirty;

  const apply = (goals: string[], limit = max) => {
    setOpened([]);
    setSaved(goals);
    setDrafts(goals);
    setMax(limit);
  };

  useEffect(() => {
    // A reload never replaces goals you're in the middle of editing.
    if (editing.current) return;
    api.goalList().then((r) => {
      apply(r.goals, r.max);
      if (!r.goals.length) setExpanded(true);
    }).catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, refreshKey]);

  const run = async (which: 'save' | number, work: () => Promise<{ goals: string[]; max: number }>, done: string) => {
    setBusy(which);
    setError(null);
    setNote(null);
    try {
      const r = await work();
      apply(r.goals, r.max);
      setNote(done);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () => run('save', () => api.saveGoalList(drafts), 'Goals saved. Your next brief ranks against them.');
  const remove = (i: number) => run(i, () => api.saveGoalList(drafts.filter((_, j) => j !== i)), 'Goal removed.');
  // Unsaved edits are saved first, so the rewrite works from what you see.
  const rewrite = (i: number) => run(i, async () => {
    if (dirty) await api.saveGoalList(drafts);
    return api.rewriteGoal(i);
  }, 'Rewritten as OKRs. Edit anything that reads wrong.');

  const count = saved?.length ?? 0;
  const full = count >= max;
  const summary = count ? `${count} of ${max}` : 'None yet';

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Goals, ${summary}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 30, lineHeight: 32 }}>Goals</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{summary}</Text>
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{expanded ? 'collapse' : 'expand'}</Text>
        </View>
      </Pressable>

      <Button label={full ? `${max} goals, the most OS keeps` : 'Write a goal with AI'} variant={count ? 'secondary' : 'primary'} disabled={full || !hasAiKey || saved === null} onPress={() => setAdding(true)} />
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
        {!hasAiKey ? 'Add your OpenRouter key under Model to write goals with AI.'
          : full ? 'Remove a goal to add another. Fewer goals make sharper briefs.'
          : `Each goal becomes an OKR: one objective and up to 3 key results. Up to ${max} goals.`}
      </Text>
      <ErrorNote message={error} />
      {note && !dirty ? <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 14 }}>{note}</Text> : null}

      {expanded ? drafts.map((goal, i) => (
        <Card key={i}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{`goal ${String(i + 1).padStart(2, '0')}`}</Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {!isOkr(goal) && hasAiKey ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Rewrite goal ${i + 1} as OKR`} disabled={busy !== null} onPress={() => void rewrite(i)} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 14 }}>{busy === i ? 'rewriting…' : 'rewrite as OKR'}</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove goal ${i + 1}`} disabled={busy !== null} onPress={() => void remove(i)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: c.danger, fontFamily: F.sansMedium, fontSize: 14 }}>remove</Text>
              </Pressable>
            </View>
          </View>
          <Field
            label={isOkr(goal) ? 'Objective and key results' : 'Notes, not yet an OKR'}
            value={goal}
            onChangeText={(t) => setDrafts((list) => list.map((g, j) => (j === i ? t : g)))}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            editable={busy === null}
          />
        </Card>
      )) : null}
      {expanded && dirty ? <Button label="Save goals" busy={busy === 'save'} disabled={busy !== null} onPress={() => void save()} /> : null}

      {!expanded && count ? (
        <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.card }}>
          {saved!.map((goal, i) => {
            const open = opened.includes(i);
            const results = goal.trim().split('\n').slice(1);
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`Goal ${i + 1}: ${objectiveOf(goal)}`}
                accessibilityHint={open ? 'Shows less' : 'Shows the full goal'}
                accessibilityState={{ expanded: open }}
                onPress={() => setOpened((list) => (open ? list.filter((j) => j !== i) : [...list, i]))}
                style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderTopWidth: i ? 1 : 0, borderColor: c.line }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13, lineHeight: 24 }}>{String(i + 1).padStart(2, '0')}</Text>
                  <Text numberOfLines={open ? undefined : 1} style={{ flex: 1, color: c.text, fontFamily: open ? F.sansMedium : F.text, fontSize: 16, lineHeight: 24 }}>{objectiveOf(goal)}</Text>
                  <Text style={{ color: c.muted, fontFamily: F.sansMedium, fontSize: 13, lineHeight: 24 }}>{open ? 'less' : 'more'}</Text>
                </View>
                {open && results.length ? (
                  <View style={{ gap: 4, paddingLeft: 28 }}>
                    {results.map((line, j) => <Text key={j} style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>{line.trim()}</Text>)}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <GoalModal api={api} visible={adding} onClose={() => setAdding(false)} onAdded={(goals) => { apply(goals); setExpanded(true); setNote('Goal added. Edit the OKR if anything reads wrong.'); }} />
    </View>
  );
}

export function SettingsScreen({ api, status, onChanged }: { api: Api; status: Status; onChanged(): void }) {
  // Set-up sections start collapsed to keep the page quiet. Anything missing starts open.
  const keys = composioState(status);
  const model = modelState(status);
  return (
    <Screen>
      <Title>Settings</Title>
      <GoalsSection api={api} hasAiKey={Boolean(status.openrouter)} />
      <Section title="Tools"><ToolList api={api} /></Section>
      <Section title="Keys" collapsed={keys.configured} summary={keys.summary}>
        <KeyRow name="Composio" label="Composio API key" state={status.composio} hint={status.composioHint} getKeyUrl={COMPOSIO_URL} onSave={(k) => api.saveComposioKey(k).then(onChanged)} onRemove={() => api.removeCredential('composio').then(onChanged)} />
      </Section>
      <Section title="Model" collapsed={model.configured} summary={model.summary}>
        <ModelSection api={api} status={status} onChanged={onChanged} />
      </Section>
      <Section title="Your data">
        <DataSection api={api} onErased={onChanged} />
      </Section>
    </Screen>
  );
}
