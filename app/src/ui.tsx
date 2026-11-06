import { createContext, useContext, type ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View,
  type TextInputProps,
} from 'react-native';

/** Green-tinted newsprint by day, deep forest for the night edition. Red is only for what's urgent. */
const light = {
  bg: '#EEF1EA', card: '#F8FAF5', text: '#16201C', muted: '#56615B', line: '#C6CDC2',
  accent: '#1F5C4D', onAccent: '#F8FAF5', accentSoft: '#DDE7DF', danger: '#A5321F', dangerSoft: '#F4E0DA',
};
const dark: typeof light = {
  bg: '#12201B', card: '#1A2B25', text: '#E8EDE4', muted: '#A3B0A8', line: '#34463E',
  accent: '#8FD3BE', onAccent: '#0F1F19', accentSoft: '#1F3A31', danger: '#F0998A', dangerSoft: '#40241E',
};

/** Fonts load in App.tsx. Each weight is its own family, because Android ignores fontWeight on custom fonts. */
export const F = {
  display: 'Newsreader_600SemiBold',
  text: 'Newsreader_400Regular',
  italic: 'Newsreader_400Regular_Italic',
  bold: 'Newsreader_600SemiBold',
  sans: 'LibreFranklin_400Regular',
  sansMedium: 'LibreFranklin_500Medium',
  sansBold: 'LibreFranklin_700Bold',
};

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
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 36, lineHeight: 41, letterSpacing: -0.5 }}>{children}</Text>
    </View>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const c = useColors();
  return <Text style={{ color: muted ? c.muted : c.text, fontFamily: F.text, fontSize: 18, lineHeight: 27 }}>{children}</Text>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 24, lineHeight: 30 }}>{title}</Text>
      {children}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={{ backgroundColor: c.card, borderColor: c.line, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, padding: 16, gap: 12 }}>{children}</View>;
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
        { backgroundColor: primary ? c.accent : 'transparent', borderColor: primary ? c.accent : variant === 'danger' ? c.danger : c.line },
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
        style={[styles.input, { color: c.text, backgroundColor: c.card, borderColor: c.line, fontFamily: F.text }, input.multiline ? { minHeight: 150, lineHeight: 25, textAlignVertical: 'top' } : null]}
      />
      {hint ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 19 }}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  const c = useColors();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.dangerSoft, borderRadius: 4, padding: 12 }}>
      <Text style={{ color: c.danger, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

export function Note({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.accentSoft, borderRadius: 4, padding: 12 }}>
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
      style={[styles.chip, { backgroundColor: selected ? c.accent : 'transparent', borderColor: selected ? c.accent : c.line }]}
    >
      <Text style={{ color: selected ? c.onAccent : c.text, fontFamily: F.sansMedium, fontSize: 15 }}>{label}</Text>
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
  button: { minHeight: 48, borderRadius: 4, borderWidth: 1, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null) },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
