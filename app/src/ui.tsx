import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View,
  type TextInputProps,
} from 'react-native';

/**
 * Hallmark's Lumen theme. Night: a violet-black ground, near-white ink and one molten brass signal.
 * Day: bone under violet ink, with an indigo signal. Heads are Instrument Serif in lowercase over
 * Geist; Geist Mono is the machine speaking (a score, a time, a count). Brass stays rare: the
 * primary action, the focus line, one readout. Ok and bad are for status only.
 */
const light = {
  bg: '#F5F4FA', card: '#EBEAF2', deep: '#E1E0E9', text: '#11101A', ink2: '#32313F', muted: '#5E5B6B',
  line: '#D7D6E0', line2: '#B7B5C4',
  accent: '#2639DB', onAccent: '#F5F4FA', accentSoft: '#D9E4FF',
  cool: '#32313F', coolSoft: '#E1E0E9', ok: '#007840', okSoft: '#D7F4E0',
  danger: '#B63132', dangerSoft: '#FFE4E1',
};
const dark: typeof light = {
  bg: '#060510', card: '#0D0B19', deep: '#161324', text: '#F3F0F8', ink2: '#CFCCD8', muted: '#9C98AA',
  line: '#262436', line2: '#3D3951',
  accent: '#FFA54B', onAccent: '#090714', accentSoft: '#351E07',
  cool: '#CFCCD8', coolSoft: '#161324', ok: '#72D699', okSoft: '#092012',
  danger: '#F47B74', dangerSoft: '#311211',
};

/** Fonts load in App.tsx. Each weight is its own family, because Android ignores fontWeight on custom fonts. */
export const F = {
  /** Instrument Serif is narrow and light: set it a step large, always lowercase (see `display`). */
  display: 'InstrumentSerif_400Regular',
  text: 'Geist_400Regular',
  italic: 'Geist_400Regular',
  bold: 'Geist_500Medium',
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansBold: 'Geist_600SemiBold',
  /** Only for what a tool or the system wrote: a score, a time, a count. Never a label or a button. */
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
};

/** The head voice: serif, lowercase, a hair tight. */
export const display = { fontFamily: F.display, textTransform: 'lowercase', letterSpacing: -0.2 } as const;

/** Hairline wells at 10px, controls and tags as pills. */
export const R = { card: 10, control: 10, chip: 999, pill: 999 };

export type Colors = typeof light;

const ThemeContext = createContext<Colors>(light);
export const useColors = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={useColorScheme() === 'dark' ? dark : light}>{children}</ThemeContext.Provider>;
}

/** Always the night palette, whatever the phone is set to. The WOOP flow is a quiet, dark room. */
export function DarkTheme({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={dark}>{children}</ThemeContext.Provider>;
}

export function Screen({ children, maxWidth = 620 }: { children: ReactNode; maxWidth?: number }) {
  const c = useColors();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={[styles.column, { maxWidth }]}>{children}</View>
    </ScrollView>
  );
}

export function Title({ children, step }: { children: ReactNode; step?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {step ? <Text style={{ color: c.muted, fontSize: 13, fontFamily: F.sansMedium }}>{step}</Text> : null}
      <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 42, lineHeight: 42 }}>{children}</Text>
    </View>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const c = useColors();
  return <Text style={{ color: muted ? c.muted : c.text, fontFamily: F.text, fontSize: 17, lineHeight: 26 }}>{children}</Text>;
}

/**
 * A titled block. Pass `collapsed` to make it open and close, starting closed when true. The
 * summary stays visible while it's closed, so a set-up section says what it's set to.
 */
export function Section({ title, children, collapsed, summary }: { title: string; children: ReactNode; collapsed?: boolean; summary?: string }) {
  const c = useColors();
  const [open, setOpen] = useState(!collapsed);
  const heading = <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 30, lineHeight: 32 }}>{title}</Text>;
  if (collapsed === undefined) {
    return (
      <View style={{ gap: 10 }}>
        {heading}
        {children}
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${summary ? `, ${summary}` : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        {heading}
        <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {summary && !open ? <Text numberOfLines={1} style={{ flexShrink: 1, color: c.muted, fontFamily: F.sans, fontSize: 14 }}>{summary}</Text> : null}
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{open ? 'collapse' : 'expand'}</Text>
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={{ backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: R.card, padding: 16, gap: 12 }}>{children}</View>;
}

interface ButtonProps {
  label: string;
  onPress(): void;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}

export function Button({ label, onPress, variant = 'primary', busy, disabled }: ButtonProps) {
  const c = useColors();
  const primary = variant === 'primary';
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? c.accent : pressed ? c.card : 'transparent', borderColor: primary ? c.accent : variant === 'danger' ? c.danger : c.line2 },
        { opacity: inactive ? 0.55 : pressed && primary ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? c.onAccent : c.text} /> : null}
      <Text style={{ color: primary ? c.onAccent : variant === 'danger' ? c.danger : c.text, fontFamily: F.sansMedium, fontSize: 15, textTransform: 'lowercase' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={c.muted}
        {...input}
        style={[styles.input, { color: c.text, backgroundColor: c.bg, borderColor: c.line2, fontFamily: F.text }, input.multiline ? { minHeight: 150, lineHeight: 25, textAlignVertical: 'top' } : null]}
      />
      {hint ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  const c = useColors();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.dangerSoft, borderRadius: R.control, padding: 12 }}>
      <Text style={{ color: c.danger, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.deep, borderWidth: 1, borderColor: c.line, borderRadius: R.control, padding: 12 }}>
      <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress, accessibilityLabel }: { label: string; selected: boolean; onPress(): void; accessibilityLabel?: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.accentSoft : 'transparent', borderColor: selected ? c.accent : c.line2 }]}
    >
      <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label }: { label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: c.bg }}>
      <ActivityIndicator color={c.accent} />
      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 15 }}>{label}</Text>
    </View>
  );
}

export const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 20, paddingBottom: 48, alignItems: 'center' },
  column: { width: '100%', gap: 24 },
  button: { minHeight: 48, borderRadius: R.pill, borderWidth: 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: R.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null) },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: R.chip, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
