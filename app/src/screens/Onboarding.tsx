import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { COMPOSIO_URL, createApi, deviceTimezone, normalizeServerUrl, type Api, type Brief, type Status, type Toolkit } from '../api';
import { takeLinkToken } from '../linkToken';
import { saveConnection, savePhoneAiKey, type Connection } from '../storage';
import { ToolList } from '../ToolList';
import { Body, Button, ErrorNote, Field, message, Screen, Title } from '../ui';

function defaultServerUrl() {
  if (Platform.OS === 'web' && typeof location !== 'undefined' && location.port !== '8081') return location.origin;
  return process.env.EXPO_PUBLIC_OS_URL || 'http://localhost:8787';
}

export function PairScreen({ onPaired }: { onPaired(connection: Connection): void }) {
  const [url, setUrl] = useState(defaultServerUrl);
  // Web takes the token only from a one-time #token= link, never from the bundle, which is served without a login.
  // Private mobile builds can prefill it at build time.
  const [linkToken] = useState(() => (Platform.OS === 'web' ? takeLinkToken() : null));
  const [token, setToken] = useState(linkToken ?? (Platform.OS === 'web' ? '' : (process.env.EXPO_PUBLIC_OS_TOKEN ?? '')));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (linkToken) void submit(linkToken);
    // Runs once: a link connects on arrival, typing never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (value = token) => {
    setBusy(true);
    setError(null);
    try {
      const connection = { url: normalizeServerUrl(url), token: value.trim() };
      await createApi(connection).status();
      await saveConnection(connection);
      onPaired(connection);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>OS</Title>
      <Body>A short daily brief from your own tools: what matters, what to drop, and what to do next.</Body>
      <Body muted>Connect to your OS server. It keeps your keys and briefs on your own machine.</Body>
      <Field label="Server address" value={url} onChangeText={setUrl} keyboardType="url" autoComplete="off" />
      <Field label="Server token" value={token} onChangeText={setToken} secureTextEntry hint="Printed when the server first starts, and saved in ~/.os-app/token." onSubmitEditing={() => void submit()} />
      <ErrorNote message={error} />
      <Button label="Connect" busy={busy} disabled={!token.trim()} onPress={() => void submit()} />
    </Screen>
  );
}

export function ComposioScreen({ api, onDone }: { api: Api; onDone(): void }) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveComposioKey(apiKey.trim());
      onDone();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title step="Step 1 of 3">Authorize Composio</Title>
      <Body>Composio handles sign-in to Gmail, Calendar and your other tools, so OS never sees those passwords. OS only reads from them.</Body>
      <Button label="Open Composio" variant="secondary" onPress={() => void Linking.openURL(COMPOSIO_URL)} />
      <Body muted>Sign in, go to Settings, then Project Settings, then API Keys. Copy your key and paste it here.</Body>
      <Field label="Composio API key" value={apiKey} onChangeText={setApiKey} secureTextEntry hint="Checked with Composio, then stored encrypted on your server. You only do this once." onSubmitEditing={() => void submit()} />
      <ErrorNote message={error} />
      <Button label="Continue" busy={busy} disabled={apiKey.trim().length < 8} onPress={() => void submit()} />
    </Screen>
  );
}

export function ToolsScreen({ api, onDone }: { api: Api; onDone(): void }) {
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const selected = toolkits.filter((t) => t.selected);
  const ready = selected.filter((t) => t.noAuth || t.accounts > 0);
  const waiting = selected.length - ready.length;
  return (
    <Screen>
      <Title step="Step 2 of 3">Choose your tools</Title>
      <Body muted>Pick what your brief should read. Start with one or two, because you can add more later.</Body>
      <ToolList api={api} onChange={setToolkits} />
      {waiting > 0 && ready.length > 0 ? <Body muted>{waiting === 1 ? '1 tool isn’t' : `${waiting} tools aren’t`} connected yet. You can continue and connect later.</Body> : null}
      <Button label="Continue" disabled={ready.length === 0} onPress={onDone} />
    </Screen>
  );
}

export function FirstBriefScreen({ api, status, onDone }: { api: Api; status: Status; onDone(brief: Brief): void }) {
  const [goals, setGoals] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hour = useMemo(() => new Date().getHours(), []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      if (goals.trim()) await api.saveGoals(goals);
      if (openRouterKey.trim()) {
        await api.saveOpenRouterKey(openRouterKey.trim());
        // The same key writes briefs on this phone when the server is out of reach.
        if (Platform.OS !== 'web') await savePhoneAiKey(openRouterKey.trim()).catch(() => undefined);
      }
      await api.saveTimezone(deviceTimezone());
      onDone(await api.generateBrief('morning'));
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title step="Step 3 of 3">Your first brief</Title>
      <Field
        label="Paste your goals"
        value={goals}
        onChangeText={setGoals}
        multiline
        autoCapitalize="sentences"
        autoCorrect
        placeholder={'Paste them here, one per line. For example:\nLand 3 paying customers by March\nShip the beta by December 15'}
        hint="A list or notes both work. Your brief ranks everything against your goals. You can skip this and add them in Settings."
      />
      {status.openrouter ? null : (
        <Field
          label="OpenRouter API key (optional)"
          value={openRouterKey}
          onChangeText={setOpenRouterKey}
          secureTextEntry
          hint="An AI model ranks your items and writes the brief, and your tool data is sent through OpenRouter to do that. Without a key you get a plain list of what was found."
        />
      )}
      <ErrorNote message={error} />
      <Button label={busy ? 'Reading your tools and writing…' : hour < 16 ? 'Write my morning brief' : 'Write my brief'} busy={busy} onPress={() => void generate()} />
    </Screen>
  );
}

export function isOnboarded(status: Status) {
  return Boolean(status.composio && status.selectedToolkits.length && status.hasBriefs);
}

