import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Text, View } from 'react-native';
import { COMPOSIO_URL, type Api, type Toolkit } from './api';
import { Button, Card, ErrorNote, Loading, message, useColors, F } from './ui';

const POLL_MS = 4000;
const POLL_LIMIT_MS = 180_000;

/** Choose tools and connect them through Composio. Selection saves as you tap. */
export function ToolList({ api, onChange }: { api: Api; onChange?(toolkits: Toolkit[]): void }) {
  const c = useColors();
  const [toolkits, setToolkits] = useState<Toolkit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<{ slug: string; url: string } | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [checking, setChecking] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async (fresh = false) => {
    try {
      const result = await api.toolkits(fresh);
      setToolkits(result.toolkits);
      setError(result.error);
      setNeedsAuth(result.needsAuth);
      onChangeRef.current?.(result.toolkits);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from signing in: check straight away.
  useEffect(() => {
    if (!waitingSince) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(true);
    });
    return () => subscription.remove();
  }, [waitingSince, load]);

  // Sign-in finishes in another tab, so check back until the account shows up.
  useEffect(() => {
    if (!waitingSince) return;
    const timer = setInterval(() => {
      if (Date.now() - waitingSince > POLL_LIMIT_MS) setWaitingSince(null);
      else void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waitingSince, load]);

  const toggle = async (slug: string) => {
    if (!toolkits) return;
    const next = toolkits.map((t) => (t.slug === slug ? { ...t, selected: !t.selected } : t));
    const chosen = next.find((t) => t.slug === slug)!;
    setToolkits(next);
    onChangeRef.current?.(next);
    try {
      await api.selectToolkits(next.filter((t) => t.selected).map((t) => t.slug));
      // Choosing a tool that isn't connected goes straight to its sign-in.
      if (chosen.selected && !chosen.noAuth && chosen.accounts === 0 && !needsAuth) void connect(chosen);
    } catch (e) {
      setError(message(e));
      void load();
    }
  };

  const checkConnections = async () => {
    setChecking(true);
    await load(true);
    setChecking(false);
  };

  const open = async (url: string) => {
    await (Platform.OS === 'web' ? Linking.openURL(url) : WebBrowser.openBrowserAsync(url));
  };

  const connect = async (toolkit: Toolkit) => {
    setConnecting(toolkit.slug);
    setError(null);
    setFallbackUrl(null);
    try {
      const { redirectUrl } = await api.connectToolkit(toolkit.slug);
      if (!redirectUrl?.startsWith('https://')) {
        setError(`Composio didn't return a sign-in page for ${toolkit.name}. You can connect it at composio.dev.`);
        return;
      }
      setFallbackUrl({ slug: toolkit.slug, url: redirectUrl });
      setWaitingSince(Date.now());
      await open(redirectUrl).catch(() => undefined);
      void load(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setConnecting(null);
    }
  };

  if (!toolkits) return error ? <ErrorNote message={error} /> : <Loading label="Checking your tools…" />;

  return (
    <View style={{ gap: 10 }}>
      <ErrorNote message={error} />
      {needsAuth ? <Button label="Open Composio" onPress={() => void open(COMPOSIO_URL)} /> : null}
      {toolkits.map((t) => {
        const connected = t.noAuth || t.accounts > 0;
        return (
          <Card key={t.slug}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Use ${t.name} in briefs`}
              accessibilityState={{ checked: t.selected }}
              onPress={() => void toggle(t.slug)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
            >
              <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: t.selected ? c.accent : c.muted, backgroundColor: t.selected ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {t.selected ? <Text style={{ color: c.onAccent, fontSize: 15, fontFamily: F.sansBold, lineHeight: 18 }}>✓</Text> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.text, fontSize: 16, fontFamily: F.sansMedium }}>{t.name}</Text>
                <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 19 }}>{t.description}</Text>
              </View>
            </Pressable>
            {t.selected ? (
              connected ? (
                <Text style={{ color: c.accent, fontSize: 14, fontFamily: F.sansMedium }}>
                  {t.noAuth ? 'Ready' : `Connected${t.accounts > 1 ? ` (${t.accounts} accounts)` : ''}`}
                </Text>
              ) : (
                <View style={{ gap: 8 }}>
                  <Button label={`Connect ${t.name}`} variant="secondary" busy={connecting === t.slug} disabled={connecting !== null} onPress={() => void connect(t)} />
                  {fallbackUrl?.slug === t.slug ? (
                    <>
                      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 19 }}>Finish signing in, then come back. This updates on its own. If no page opened, use the button below.</Text>
                      <Button label="Open the sign-in page" variant="secondary" onPress={() => void open(fallbackUrl.url)} />
                    </>
                  ) : null}
                </View>
              )
            ) : null}
          </Card>
        );
      })}
      <Button label="Check connections" variant="secondary" busy={checking} onPress={() => void checkConnections()} />
    </View>
  );
}
