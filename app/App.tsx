import { Newsreader_400Regular, Newsreader_400Regular_Italic, Newsreader_600SemiBold } from '@expo-google-fonts/newsreader';
import { LibreFranklin_400Regular, LibreFranklin_500Medium, LibreFranklin_700Bold } from '@expo-google-fonts/libre-franklin';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, createApi, type Status } from './src/api';
import { ComposioScreen, FirstBriefScreen, isOnboarded, PairScreen, ToolsScreen } from './src/screens/Onboarding';
import { SchedulesScreen } from './src/screens/Schedules';
import { SettingsScreen } from './src/screens/Settings';
import { TodayScreen } from './src/screens/Today';
import { UpdateModal } from './src/UpdateModal';
import { clearConnection, loadConnection, type Connection } from './src/storage';
import { Button, ErrorNote, F, Loading, message, Screen, ThemeProvider, Title, useColors } from './src/ui';

type Tab = 'today' | 'schedule' | 'settings';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

function TabBar({ tab, onChange }: { tab: Tab; onChange(tab: Tab): void }) {
  const c = useColors();
  const { bottom } = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.line, backgroundColor: c.card, paddingBottom: bottom }}>
      {TABS.map((t) => (
        <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} onPress={() => onChange(t.id)} style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: tab === t.id ? c.accent : c.muted, fontFamily: tab === t.id ? F.sansBold : F.sansMedium, fontSize: 14 }}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Header({ onUpdate }: { onUpdate(): void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, backgroundColor: c.bg }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 24 }}>OS</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add an update"
        onPress={onUpdate}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: 4, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
      >
        <Text style={{ color: c.onAccent, fontFamily: F.sansMedium, fontSize: 15 }}>Update</Text>
      </Pressable>
    </View>
  );
}

function Root() {
  const c = useColors();
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolsDone, setToolsDone] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const [updating, setUpdating] = useState(false);
  const api = useMemo(() => (connection ? createApi(connection) : null), [connection]);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setStatus(await api.status());
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await clearConnection();
        setConnection(null);
      } else {
        setError(message(e));
      }
    }
  }, [api]);

  useEffect(() => {
    void loadConnection().then(setConnection);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const body = () => {
    if (connection === undefined) return <Loading label="Starting…" />;
    if (!connection || !api) return <PairScreen onPaired={setConnection} />;
    if (!status) {
      return error ? (
        <Screen>
          <Title>Can't reach your server</Title>
          <ErrorNote message={error} />
          <Button label="Try again" onPress={() => void refresh()} />
          <Button label="Use a different server" variant="secondary" onPress={() => void clearConnection().then(() => setConnection(null))} />
        </Screen>
      ) : <Loading label="Connecting…" />;
    }
    if (!isOnboarded(status)) {
      if (!status.composio) return <ComposioScreen api={api} onDone={() => void refresh()} />;
      if (!status.selectedToolkits.length || !toolsDone) return <ToolsScreen api={api} onDone={() => { setToolsDone(true); void refresh(); }} />;
      return <FirstBriefScreen api={api} status={status} onDone={() => { setTab('today'); void refresh(); }} />;
    }
    return (
      <>
        <Header onUpdate={() => setUpdating(true)} />
        <UpdateModal api={api} visible={updating} onClose={() => setUpdating(false)} />
        <View style={{ flex: 1 }}>
          {tab === 'today' ? <TodayScreen api={api} hasSchedules={status.hasSchedules} onSchedule={() => setTab('schedule')} /> : null}
          {tab === 'schedule' ? <SchedulesScreen api={api} onChanged={() => void refresh()} /> : null}
          {tab === 'settings' ? <SettingsScreen api={api} status={status} connection={connection} onChanged={() => void refresh()} onSignOut={() => { setStatus(null); setConnection(null); }} /> : null}
        </View>
        <TabBar tab={tab} onChange={setTab} />
      </>
    );
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      {body()}
    </SafeAreaView>
  );
}

export default function App() {
  // Falls back to system fonts if loading fails, rather than leaving a blank screen.
  const [fontsLoaded, fontError] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_600SemiBold,
    LibreFranklin_400Regular,
    LibreFranklin_500Medium,
    LibreFranklin_700Bold,
  });
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
