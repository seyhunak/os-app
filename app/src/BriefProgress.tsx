import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProgressStep } from './core/compose';
import { ErrorNote, F, R, display, useColors } from './ui';

export type { ProgressStep };

/** Collects a brief's steps as they come in. A step with a key already seen replaces its line. */
export function useBriefProgress() {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const onProgress = useCallback((step: ProgressStep) => {
    setSteps((list) => {
      const at = list.findIndex((s) => s.key === step.key);
      return at < 0 ? [...list, step] : list.map((s, i) => (i === at ? step : s));
    });
  }, []);
  const reset = useCallback(() => setSteps([]), []);
  return { steps, onProgress, reset };
}

function Mark({ state }: { state: ProgressStep['state'] }) {
  const c = useColors();
  const box = { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' } as const;
  if (state === 'running') return <View style={box}><ActivityIndicator size="small" color={c.accent} /></View>;
  const glyph = state === 'done' ? '✓' : state === 'warn' ? '!' : '–';
  const color = state === 'done' ? c.ok : state === 'warn' ? c.danger : c.muted;
  return <View style={box}><Text style={{ color, fontFamily: F.monoMedium, fontSize: 15, lineHeight: 20 }}>{glyph}</Text></View>;
}

const elapsed = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * What the brief is doing, step by step: each tool scanned, each model asked, and why one was
 * passed over. It closes itself a moment after the brief is ready. Hiding it doesn't stop the brief.
 */
export function BriefProgress({ visible, title, steps, error, onClose }: {
  visible: boolean; title: string; steps: ProgressStep[]; error: string | null; onClose(): void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const started = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const scroll = useRef<ScrollViewInstance>(null);
  const finished = steps.some((s) => s.key === 'finish' && s.state === 'done');
  const working = !finished && !error;

  useEffect(() => {
    if (!visible) return;
    started.current = Date.now();
    setNow(Date.now());
  }, [visible]);

  useEffect(() => {
    if (!visible || !working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, working]);

  // A short pause on "Brief ready", so the last step is seen before the brief replaces it.
  useEffect(() => {
    if (!visible || !finished) return;
    const timer = setTimeout(onClose, 900);
    return () => clearTimeout(timer);
  }, [visible, finished, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16, paddingTop: insets.top + 8 }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 520, maxHeight: '85%', backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: R.card }}>
          <View style={{ padding: 20, paddingBottom: 12, gap: 4, borderBottomWidth: 1, borderColor: c.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <Text accessibilityRole="header" style={{ flexShrink: 1, color: c.text, ...display, fontSize: 30, lineHeight: 32 }}>{title}</Text>
              <Text style={{ color: c.muted, fontFamily: F.mono, fontSize: 13 }}>{elapsed(now - started.current)}</Text>
            </View>
            <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
              {error ? 'Something went wrong.' : finished ? 'Done. Opening your brief.' : 'Reading your tools, then weighing everything against your goals.'}
            </Text>
          </View>
          <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} contentContainerStyle={{ padding: 20, gap: 12 }}>
            {steps.length ? steps.map((step) => (
              <View key={step.key} accessibilityLiveRegion={step.state === 'running' ? 'polite' : 'none'} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Mark state={step.state} />
                <Text style={{ flex: 1, color: step.state === 'skip' ? c.muted : c.text, fontFamily: step.state === 'running' ? F.sansMedium : F.sans, fontSize: 15, lineHeight: 21 }}>{step.text}</Text>
              </View>
            )) : (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Mark state="running" />
                <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 15 }}>Getting started…</Text>
              </View>
            )}
            <ErrorNote message={error} />
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderColor: c.line }}>
            <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 15, textTransform: 'lowercase' }}>{working ? 'Hide, keep writing' : 'Close'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
