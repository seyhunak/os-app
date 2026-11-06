import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { COMPOSIO_URL, type Api, type Status } from '../api';
import { clearConnection, type Connection } from '../storage';
import { ToolList } from '../ToolList';
import { Button, Card, ErrorNote, Field, message, Screen, Section, Title, useColors, F } from '../ui';

const DOTS = '••••••••••••';

function KeyRow({ name, label, state, hint, getKeyUrl, onSave, onRemove }: {
  name: string; label: string; state: Status['composio']; hint: string | null; getKeyUrl?: string;
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
            hint={state ? 'Saved and encrypted on your server. Paste a new key to replace it.' : 'Stored encrypted on your server.'}
          />
          <ErrorNote message={error} />
          {!state && getKeyUrl ? <Button label={`Open ${name}`} onPress={() => void Linking.openURL(getKeyUrl)} /> : null}
          {value.trim() ? <Button label={state ? 'Replace key' : 'Save key'} variant="secondary" busy={busy} disabled={value.trim().length < 8} onPress={() => void run(() => onSave(value.trim()))} /> : null}
          {state ? <Button label="Remove key" variant="danger" disabled={busy} onPress={() => void run(onRemove)} /> : null}
        </>
      )}
    </Card>
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

  useEffect(() => {
    api.goals().then((r) => {
      setGoals(r.goals);
      setExpanded(!r.goals.trim());
    }).catch((e) => setError(message(e)));
  }, [api]);

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

export function SettingsScreen({ api, status, connection, onChanged, onSignOut }: {
  api: Api; status: Status; connection: Connection; onChanged(): void; onSignOut(): void;
}) {
  const c = useColors();
  return (
    <Screen>
      <Title>Settings</Title>
      <GoalsSection api={api} />
      <Section title="Tools"><ToolList api={api} /></Section>
      <Section title="Keys">
        <KeyRow name="Composio" label="Composio API key" state={status.composio} hint={status.composioHint} getKeyUrl={COMPOSIO_URL} onSave={(k) => api.saveComposioKey(k).then(onChanged)} onRemove={() => api.removeCredential('composio').then(onChanged)} />
        <KeyRow name="OpenRouter" label="OpenRouter API key" state={status.openrouter} hint={status.openrouterHint} getKeyUrl="https://openrouter.ai/keys" onSave={(k) => api.saveOpenRouterKey(k).then(onChanged)} onRemove={() => api.removeCredential('openrouter').then(onChanged)} />
      </Section>
      <Section title="Server">
        <View style={{ gap: 10 }}>
          <Text selectable style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>{connection.url}</Text>
          <Button label="Disconnect this device" variant="danger" onPress={() => void clearConnection().then(onSignOut)} />
        </View>
      </Section>
    </Screen>
  );
}
