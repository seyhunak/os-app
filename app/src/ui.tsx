import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View,
  type TextInputProps,
} from 'react-native';

/**
 * Hallmark's Console theme. Graphite by night, its paper colourway by day. Amber stands for you
 * (your focus, your goals, the next step), cool blue for an instrument (a tool, a score, a time).
 * Ok and bad are for status only.
 */
const light = {
  bg: '#FAF8F4', card: '#FFFFFF', deep: '#F2F0EB', text: '#17130F', ink2: '#37322E', muted: '#5D5751',
  line: '#DBD7D0', line2: '#B5B0A9',
  accent: '#A15C00', onAccent: '#FFFBF4', accentSoft: '#F6E6CB',
  cool: '#116BB5', coolSoft: '#DBEEFE', ok: '#137738', okSoft: '#D9F3DD',
  danger: '#B63132', dangerSoft: '#FFE3DF',
};
const dark: typeof light = {
  bg: '#0D1013', card: '#15191C', deep: '#06080B', text: '#ECEFF2', ink2: '#C3C8CC', muted: '#9DA2A8',
  line: '#2D3135', line2: '#484E54',
  accent: '#F7B83D', onAccent: '#1C0E00', accentSoft: '#38280A',
  cool: '#6EBCFC', coolSoft: '#142E43', ok: '#61CB7C', okSoft: '#162519',
  danger: '#F66D67', dangerSoft: '#2F1A18',
};

/** Fonts load in App.tsx. Each weight is its own family, because Android ignores fontWeight on custom fonts. */
export const F = {
  display: 'HostGrotesk_500Medium',
  text: 'HostGrotesk_400Regular',
  /** Console sets everything roman, so the old italic role reads in the regular cut. */
  italic: 'HostGrotesk_400Regular',
  bold: 'HostGrotesk_500Medium',
  sans: 'HostGrotesk_400Regular',
  sansMedium: 'HostGrotesk_500Medium',
  sansBold: 'HostGrotesk_600SemiBold',
  /** Only for what a tool or the system wrote: a score, a time, a count. Never a label or a button. */
  mono: 'AtkinsonHyperlegibleMono_400Regular',
  monoMedium: 'AtkinsonHyperlegibleMono_500Medium',
};

/** Hairline panels at 10px, controls at 6px, chips at 4px. */
export const R = { card: 10, control: 6, chip: 4 };

export type Colors = typeof light;

const ThemeContext = createContext<Colors>(light);
export const useColors = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={useColorScheme() === 'dark' ? dark : light}>{children}</ThemeContext.Provider>;
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
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 34, lineHeight: 36, letterSpacing: -1 }}>{children}</Text>
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
  const heading = <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 22, lineHeight: 26, letterSpacing: -0.5 }}>{title}</Text>;
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
          <Text style={{ color: c.text, fontFamily: F.sansMedium, fontSize: 14 }}>{open ? 'Collapse' : 'Expand'}</Text>
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
        { backgroundColor: primary ? c.accent : c.card, borderColor: primary ? c.accent : variant === 'danger' ? c.danger : c.line2 },
        { opacity: inactive ? 0.55 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? c.onAccent : c.text} /> : null}
      <Text style={{ color: primary ? c.onAccent : variant === 'danger' ? c.danger : c.text, fontFamily: F.sansMedium, fontSize: 15 }}>{label}</Text>
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
        style={[styles.input, { color: c.text, backgroundColor: c.deep, borderColor: c.line, fontFamily: F.text }, input.multiline ? { minHeight: 150, lineHeight: 25, textAlignVertical: 'top' } : null]}
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
  button: { minHeight: 48, borderRadius: R.control, borderWidth: 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: R.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null) },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: R.chip, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
