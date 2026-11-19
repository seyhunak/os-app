import { HostGrotesk_400Regular, HostGrotesk_500Medium, HostGrotesk_600SemiBold } from '@expo-google-fonts/host-grotesk';
import { AtkinsonHyperlegibleMono_400Regular, AtkinsonHyperlegibleMono_500Medium } from '@expo-google-fonts/atkinson-hyperlegible-mono';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import type { Api, Status } from './src/api';
import { openOs } from './src/device';
import { RefreshContext } from './src/refresh';
import { ComposioScreen, FirstBriefScreen, isOnboarded, ToolsScreen } from './src/screens/Onboarding';
import { SchedulesScreen } from './src/screens/Schedules';
import { SettingsScreen } from './src/screens/Settings';
import { TodayScreen } from './src/screens/Today';
import { UpdateModal } from './src/UpdateModal';
import { ErrorNote, F, Loading, message, Screen, ThemeProvider, Title, useColors } from './src/ui';

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
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 22, letterSpacing: -0.6 }}>OS</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add an update"
        onPress={onUpdate}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: 6, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
      >
        <Text style={{ color: c.onAccent, fontFamily: F.sansMedium, fontSize: 15 }}>Update</Text>
      </Pressable>
    </View>
  );
}

/** Says a scheduled brief is being written, so the Today screen's wait makes sense. */
function ScheduledBanner({ writing }: { writing: boolean }) {
  const c = useColors();
  if (!writing) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: 20, paddingVertical: 8, backgroundColor: c.deep, borderBottomWidth: 1, borderColor: c.line }}>
      <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>Writing your scheduled brief…</Text>
    </View>
  );
}

function Root() {
  const c = useColors();
  const [api, setApi] = useState<Api | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolsDone, setToolsDone] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const [updating, setUpdating] = useState(false);
  const [refresh, setRefresh] = useState({ refreshKey: 0, writingScheduled: false });

  useEffect(() => {
    openOs().then(setApi, (e) => setError(message(e)));
  }, []);

  const reload = useCallback(async () => {
    if (!api) return;
    try {
      setStatus(await api.status());
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload, refresh.refreshKey]);

  /** Writes a scheduled brief whose time has passed, when the app opens, comes back, or a reminder is tapped. */
  const running = useRef(false);
  const runDue = useCallback(async () => {
    if (!api || running.current) return;
    running.current = true;
    try {
      if (!api.hasDueSchedule()) return;
      setRefresh((r) => ({ ...r, writingScheduled: true }));
      const brief = await api.runDueSchedule().catch(() => null);
      setRefresh((r) => ({ refreshKey: r.refreshKey + (brief ? 1 : 0), writingScheduled: false }));
    } finally {
      running.current = false;
    }
  }, [api]);
  useEffect(() => {
    if (!api || !status || !isOnboarded(status)) return;
    void runDue();
    const appState = AppState.addEventListener('change', (next) => next === 'active' && void runDue());
    const tapped = Notifications.addNotificationResponseReceivedListener(() => void runDue());
    return () => {
      appState.remove();
      tapped.remove();
    };
    // Starts once onboarding is done; status changes after that don't restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, runDue, status && isOnboarded(status)]);

  const body = () => {
    if (!api || !status) {
      return error ? (
        <Screen>
          <Title>OS couldn't start</Title>
          <ErrorNote message={error} />
        </Screen>
      ) : <Loading label="Starting…" />;
    }
    if (!isOnboarded(status)) {
      if (!status.composio) return <ComposioScreen api={api} onDone={() => void reload()} />;
      if (!status.selectedToolkits.length || !toolsDone) return <ToolsScreen api={api} onDone={() => { setToolsDone(true); void reload(); }} />;
      return <FirstBriefScreen api={api} status={status} onDone={() => { setTab('today'); void reload(); }} />;
    }
    return (
      <>
        <Header onUpdate={() => setUpdating(true)} />
        <ScheduledBanner writing={refresh.writingScheduled} />
        <UpdateModal api={api} visible={updating} onClose={() => setUpdating(false)} />
        <View style={{ flex: 1 }}>
          {tab === 'today' ? <TodayScreen api={api} hasSchedules={status.hasSchedules} onSchedule={() => setTab('schedule')} /> : null}
          {tab === 'schedule' ? <SchedulesScreen api={api} onChanged={() => void reload()} /> : null}
          {tab === 'settings' ? <SettingsScreen api={api} status={status} onChanged={() => void reload()} /> : null}
        </View>
        <TabBar tab={tab} onChange={setTab} />
      </>
    );
  };

  return (
    <RefreshContext.Provider value={refresh}>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
        {body()}
      </SafeAreaView>
    </RefreshContext.Provider>
  );
}

export default function App() {
  // Falls back to system fonts if loading fails, rather than leaving a blank screen.
  const [fontsLoaded, fontError] = useFonts({
    HostGrotesk_400Regular,
    HostGrotesk_500Medium,
    HostGrotesk_600SemiBold,
    AtkinsonHyperlegibleMono_400Regular,
    AtkinsonHyperlegibleMono_500Medium,
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
