import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { composioState, modelState } from '../settingsSummary';
import { COMPOSIO_URL, type Api, type ModelOption, type Status } from '../api';
import { useRefresh } from '../refresh';
import { ToolList } from '../ToolList';
import { Button, Card, ErrorNote, Field, message, Screen, Section, Title, useColors, F } from '../ui';

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

const goalLines = (goals: string) => goals.split('\n').map((g) => g.trim()).filter(Boolean);

/** Collapsed to a short summary, because goals can be long once pasted. Empty goals start open. */
function GoalsSection({ api }: { api: Api }) {
  const c = useColors();
  const [goals, setGoals] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { refreshKey } = useRefresh();
  const editing = useRef(false);
  editing.current = expanded;
  useEffect(() => {
    // A reload never replaces goals you're in the middle of editing.
    if (goals !== null && editing.current) return;
    api.goals().then((r) => {
      setGoals(r.goals);
      setExpanded(!r.goals.trim());
    }).catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, refreshKey]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveGoals(goals ?? '');
      setSaved(true);
      if ((goals ?? '').trim()) setExpanded(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const lines = goalLines(goals ?? '');
  const summary = lines.length === 0 ? 'None yet' : lines.length === 1 ? '1 goal' : `${lines.length} goals`;

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Goals, ${summary}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 24, lineHeight: 30 }}>Goals</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>{summary}</Text>
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{expanded ? 'Collapse' : 'Expand'}</Text>
        </View>
      </Pressable>
      <ErrorNote message={error} />
      {expanded && goals !== null ? (
        <>
          <Field
            label="Paste your goals"
            placeholder={'Paste them here, one per line. For example:\nLand 3 paying customers by March\nShip the beta by December 15'}
            value={goals}
            onChangeText={(t) => { setGoals(t); setSaved(false); }}
            multiline
            autoCapitalize="sentences"
            autoCorrect
            hint="A list or notes both work. Your brief ranks everything against your goals."
          />
          <Button label="Save goals" busy={busy} onPress={() => void save()} />
        </>
      ) : null}
      {!expanded && lines.length ? (
        <View style={{ gap: 4 }}>
          {saved ? <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 14 }}>Goals saved.</Text> : null}
          {lines.slice(0, 3).map((line, i) => <Text key={i} numberOfLines={1} style={{ color: c.text, fontFamily: F.text, fontSize: 17, lineHeight: 25 }}>{line}</Text>)}
          {lines.length > 3 ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>and {lines.length - 3} more</Text> : null}
        </View>
      ) : null}
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
      <GoalsSection api={api} />
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
