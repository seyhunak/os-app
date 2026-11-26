import { useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { COMPOSIO_URL, deviceTimezone, type Api, type Brief, type Status, type Toolkit } from '../api';
import { BriefProgress, useBriefProgress } from '../BriefProgress';
import { ToolList } from '../ToolList';
import { Body, Button, ErrorNote, Field, message, Screen, Title } from '../ui';

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
      <Body muted>OS runs on this phone. Your keys, goals and briefs stay here, and it talks only to Composio and OpenRouter.</Body>
      <Body>Composio handles sign-in to Gmail, Calendar and your other tools, so OS never sees those passwords. OS only reads from them.</Body>
      <Button label="Open Composio" variant="secondary" onPress={() => void Linking.openURL(COMPOSIO_URL)} />
      <Body muted>Sign in, go to Settings, then Project Settings, then API Keys. Copy your key and paste it here.</Body>
      <Field label="Composio API key" value={apiKey} onChangeText={setApiKey} secureTextEntry hint="Checked with Composio, then kept in this phone’s Keychain. You only do this once." onSubmitEditing={() => void submit()} />
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
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hour = useMemo(() => new Date().getHours(), []);
  const progress = useBriefProgress();
  const [watching, setWatching] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      if (openRouterKey.trim()) await api.saveOpenRouterKey(openRouterKey.trim());
      await api.saveTimezone(deviceTimezone());
      progress.reset();
      setWatching(true);
      const brief = await api.generateBrief('morning', false, progress.onProgress);
      setWatching(false);
      onDone(brief);
    } catch (e) {
      setError(message(e));
      setWatching(false);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <BriefProgress visible={watching} title="writing your first brief" steps={progress.steps} error={null} onClose={() => setWatching(false)} />
      <Title step="Step 3 of 3">Your first brief</Title>
      <Body muted>After this, set your goal for the week in the Goals tab. It takes under five minutes, and every brief ranks against it.</Body>
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

