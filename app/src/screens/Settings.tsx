import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { composioState, modelState } from '../settingsSummary';
import { COMPOSIO_URL, type Api, type ModelOption, type Status } from '../api';
import { ToolList } from '../ToolList';
import { DEFAULT_ENERGY_PEAK, ENERGY_PEAK_LABEL, ENERGY_PEAK_PROFILE, ENERGY_PEAKS, type EnergyPeak } from '../core/compose';
import { Button, Card, Chip, ErrorNote, Field, message, Screen, Section, Title, useColors, F } from '../ui';

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

/** Your OpenRouter key, and which of today's free models goes first. The rest are fallbacks, best first. */
function ModelSection({ api, status, onChanged }: { api: Api; status: Status; onChanged(): void }) {
  const c = useColors();
  const savedModel = status.openrouterModel ?? status.model ?? '';
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.aiModels().then((r) => { setOptions(r.models); setError(r.error); }, (e) => setError(message(e)));
  }, [api]);

  const choose = async (id: string) => {
    if (id === savedModel) return;
    setBusy(id);
    setError(null);
    try {
      await api.saveAi(id);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  // The saved one first, then the rest best first: the order each brief tests them.
  const ordered = [...options.filter((o) => o.id === savedModel), ...options.filter((o) => o.id !== savedModel)];
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
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
        These are today's free models on OpenRouter, best first. Before each brief OS asks OpenRouter again, tests the first one, and moves down the list until one answers. Tap one to put it first.
      </Text>
      <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 10, backgroundColor: c.card }}>
        {ordered.map((option, i) => (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={`${option.id}, ${i === 0 ? 'used first' : `fallback ${i}`}`}
            accessibilityState={{ selected: i === 0, busy: busy === option.id }}
            disabled={busy !== null}
            onPress={() => void choose(option.id)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: c.line }}
          >
            <Text style={{ width: 22, color: i === 0 ? c.accent : c.muted, fontFamily: F.mono, fontSize: 13 }}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={{ flexShrink: 1, color: i === 0 ? c.accent : c.text, fontFamily: F.sansMedium, fontSize: 15 }}>{option.id}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorNote message={error} />
    </View>
  );
}

/** When energy peaks, so the day plan puts deep work in the sharpest hours. Saved as soon as it's picked. */
function EnergySection({ api, saved, onChanged }: { api: Api; saved: EnergyPeak; onChanged(): void }) {
  const c = useColors();
  const [peak, setPeak] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPeak(saved), [saved]);
  const pick = (next: EnergyPeak) => {
    if (next === peak) return;
    const before = peak;
    setPeak(next);
    setError(null);
    api.saveEnergyPeak(next).then(onChanged, (e) => { setPeak(before); setError(message(e)); });
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.ink2, fontFamily: F.text, fontSize: 15, lineHeight: 22 }}>When you're sharpest. The day plan puts deep work there and light work in your dip.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ENERGY_PEAKS.map((p) => <Chip key={p} label={ENERGY_PEAK_LABEL[p]} selected={p === peak} onPress={() => pick(p)} />)}
      </View>
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{ENERGY_PEAK_PROFILE[peak]}</Text>
      <ErrorNote message={error} />
    </View>
  );
}

export function SettingsScreen({ api, status, onChanged }: { api: Api; status: Status; onChanged(): void }) {
  // Set-up sections start collapsed to keep the page quiet. Anything missing starts open.
  const keys = composioState(status);
  const model = modelState(status);
  const tools = status.selectedToolkits.length;
  return (
    <Screen>
      <Title>Settings</Title>
      <Section title="Energy" collapsed summary={ENERGY_PEAK_LABEL[status.energyPeak ?? DEFAULT_ENERGY_PEAK]}>
        <EnergySection api={api} saved={status.energyPeak ?? DEFAULT_ENERGY_PEAK} onChanged={onChanged} />
      </Section>
      <Section title="Tools" collapsed={tools > 0} summary={tools ? `${tools} ${tools === 1 ? 'tool' : 'tools'} selected` : 'None selected'}>
        <ToolList api={api} />
      </Section>
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
