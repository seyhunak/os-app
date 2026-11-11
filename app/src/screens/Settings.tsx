import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { composioState, modelState } from '../settingsSummary';
import { COMPOSIO_URL, type Api, type ModelOption, type Status } from '../api';
import { useConnection, type OfflineApi } from '../offline';
import { clearConnection, clearPhoneAiKey, loadPhoneAiKey, savePhoneAiKey, type Connection } from '../storage';
import { ToolList } from '../ToolList';
import { Button, Card, ErrorNote, Field, message, Screen, Section, Title, useColors, F } from '../ui';

const DOTS = '••••••••••••';

function KeyRow({ name, label, state, hint, getKeyUrl, getKeyLabel, optional, alsoKept, onSave, onRemove }: {
  name: string; label: string; state: Status['composio']; hint: string | null; getKeyUrl?: string; getKeyLabel?: string; optional?: boolean;
  /** Where else the key is kept, said after "Saved and encrypted on your server". */
  alsoKept?: string;
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
      {state === 'environment' ? (
        <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>Set in the server’s environment, ending in {hint}</Text>
      ) : (
        <>
          <Field
            label={label}
            value={value}
            onChangeText={setValue}
            secureTextEntry
            placeholder={hint ? `${DOTS}${hint}` : 'Paste your key'}
            {...(hint ? { placeholderTextColor: c.text } : {})}
            hint={state ? `Saved and encrypted on your server${alsoKept ?? ''}. Paste a new key to replace it.` : `Stored encrypted on your server${alsoKept ?? ''}.`}
          />
          <ErrorNote message={error} />
          {!state && getKeyUrl ? <Button label={getKeyLabel ?? `Open ${name}`} {...(optional ? { variant: 'secondary' as const } : {})} onPress={() => void Linking.openURL(getKeyUrl)} /> : null}
          {value.trim() ? <Button label={state ? 'Replace key' : 'Save key'} variant="secondary" busy={busy} disabled={value.trim().length < 8} onPress={() => void run(() => onSave(value.trim()))} /> : null}
          {state ? <Button label="Remove key" variant="danger" disabled={busy} onPress={() => void run(onRemove)} /> : null}
        </>
      )}
    </Card>
  );
}

/**
 * Offline writing on the phone uses the same OpenRouter key as the server: it's copied into this
 * phone's Keychain when the app syncs, so there's nothing to paste twice.
 */
function OfflineKeyNote({ api, status, model }: { api: OfflineApi; status: Status; model: string | null }) {
  const c = useColors();
  const [onPhone, setOnPhone] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let live = true;
    const check = () => loadPhoneAiKey().then((key) => live && setOnPhone(Boolean(key) && key!.slice(-4) === status.openrouterHint));
    // A key saved or replaced on another device reaches this one here, without waiting for the next sync.
    void check().then(() => (status.openrouter ? api.syncPhoneKey().then(check) : undefined)).catch(() => undefined);
    return () => { live = false; };
  }, [api, status.openrouter, status.openrouterHint]);
  if (Platform.OS === 'web' || onPhone === undefined) return null;

  const text = !status.openrouter
    ? 'When your Mac is out of reach, this phone writes a plain brief. Add an OpenRouter key above and it’s copied here, so offline briefs use AI too.'
    : onPhone
      ? `When your Mac is out of reach, this phone writes the brief itself with the same key${model ? ` and ${model}` : ''}. The key is kept in this phone’s Keychain and sent only to OpenRouter.`
      : 'Copying your OpenRouter key to this phone for offline briefs. It finishes when your Mac is reachable.';
  return (
    <Card>
      <Text style={{ color: c.text, fontSize: 16, fontFamily: F.sansMedium }}>Offline writing on this phone</Text>
      <Text accessibilityLiveRegion="polite" style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </Card>
  );
}

/** Which machine this device talks to. The address and token stay out of sight until asked for. */
function ServerSection({ api, machine, connection, onSignOut }: { api: OfflineApi; machine: string | undefined; connection: Connection; onSignOut(): void }) {
  const c = useColors();
  const { online, pending } = useConnection();
  const [expanded, setExpanded] = useState(false);
  const name = machine || new URL(connection.url).hostname.split('.')[0]!;
  const state = online ? 'Online' : 'Offline';
  const detail = { color: c.text, fontFamily: F.text, fontSize: 16, lineHeight: 23 };
  const label = { color: c.muted, fontFamily: F.sansMedium, fontSize: 13, lineHeight: 18 };

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Server, ${name}, ${state}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.text, fontFamily: F.bold, fontSize: 18, lineHeight: 25 }}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? c.accent : c.danger }} />
            <Text accessibilityLiveRegion="polite" style={{ color: online ? c.accent : c.danger, fontFamily: F.sansMedium, fontSize: 14 }}>{state}</Text>
          </View>
        </View>
        <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{expanded ? 'Collapse' : 'Expand'}</Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 12 }}>
          <View style={{ gap: 2 }}>
            <Text style={label}>Address</Text>
            <Text selectable style={detail}>{connection.url}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={label}>Token</Text>
            <Text selectable style={detail}>{connection.token}</Text>
            <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>Anyone with this token and access to your server can read your briefs.</Text>
          </View>
          <Button label="Disconnect this device" variant="danger" disabled={pending > 0} onPress={() => void api.forgetDevice().then(clearConnection).then(onSignOut)} />
          <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>
            {pending > 0 ? 'Available once your waiting changes have synced, so nothing is lost.' : 'Also removes the briefs and updates saved on this device.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Recommended models are few, so they all show. The full list can run to hundreds. */
const MODELS_SHOWN = 12;
const ALL_MODELS_SHOWN = 60;

const saveKeyEverywhere = (api: OfflineApi, key: string) =>
  api.saveOpenRouterKey(key).then(() => (Platform.OS === 'web' ? undefined : savePhoneAiKey(key).catch(() => undefined)));
const removeKeyEverywhere = (api: OfflineApi) =>
  api.removeCredential('openrouter').then(() => clearPhoneAiKey().catch(() => undefined));

/** Which model writes your briefs, through OpenRouter. Cheap models that write well come first. */
function ModelSection({ api, status, onChanged }: { api: OfflineApi; status: Status; onChanged(): void }) {
  const c = useColors();
  const { online } = useConnection();
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
    if (online) void load();
    // A new key can see different models, so the list reloads with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, status.openrouterHint]);

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
  // The server lists models cheapest first. Older servers mark none as recommended, so all show.
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
        {...(Platform.OS === 'web' ? {} : { alsoKept: ', and on this phone for offline briefs' })}
        onSave={(k) => saveKeyEverywhere(api, k).then(onChanged)}
        onRemove={() => removeKeyEverywhere(api).then(onChanged)}
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
        <View style={{ gap: 0, borderWidth: 1, borderColor: c.line, borderRadius: 4, backgroundColor: c.card }}>
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
      {changed ? <Button label="Use this model" busy={busy} disabled={!online || !model.trim()} onPress={() => void save()} /> : null}
      {changed && !online ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>Your Mac needs to be online to change this.</Text> : null}
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

  const { online, refreshKey } = useConnection();
  const editing = useRef(false);
  editing.current = expanded;
  useEffect(() => {
    // A sync never replaces goals you're in the middle of editing.
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
          {saved ? <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontFamily: F.sansMedium, fontSize: 14 }}>{online ? 'Goals saved.' : 'Saved on this device. Goals sync when your Mac is back.'}</Text> : null}
          {lines.slice(0, 3).map((line, i) => <Text key={i} numberOfLines={1} style={{ color: c.text, fontFamily: F.text, fontSize: 17, lineHeight: 25 }}>{line}</Text>)}
          {lines.length > 3 ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13 }}>and {lines.length - 3} more</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export function SettingsScreen({ api, status, connection, onChanged, onSignOut }: {
  api: OfflineApi; status: Status; connection: Connection; onChanged(): void; onSignOut(): void;
}) {
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
        <OfflineKeyNote api={api} status={status} model={status.openrouterModel ?? status.model ?? null} />
      </Section>
      <Section title="Server">
        <ServerSection api={api} machine={status.machine} connection={connection} onSignOut={onSignOut} />
      </Section>
    </Screen>
  );
}
