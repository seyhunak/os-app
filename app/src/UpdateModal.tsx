import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Api, LedgerEntry } from './api';
import { Button, ErrorNote, message, useColors, F } from './ui';

const MAX_LENGTH = 1000;
const RECENT = 3;

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A short note on what you've done. It goes into the ledger, and every brief reads it. */
export function UpdateModal({ api, visible, onClose }: { api: Api; visible: boolean; onClose(): void }) {
  const c = useColors();
  const [text, setText] = useState('');
  const [recent, setRecent] = useState<LedgerEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSaved(false);
    setError(null);
    api.ledger().then((r) => setRecent(r.entries.slice(0, RECENT))).catch(() => setRecent([]));
  }, [api, visible]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const entry = await api.addUpdate(text.trim());
      setRecent((list) => [entry, ...list].slice(0, RECENT));
      setText('');
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Tapping outside doesn't close it, so a half-written update isn't lost. */}
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: c.card, borderRadius: 6 }}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={{ color: c.text, fontFamily: F.display, fontSize: 26, lineHeight: 31 }}>What have you done so far?</Text>
              <TextInput
                accessibilityLabel="Your update"
                autoFocus
                multiline
                maxLength={MAX_LENGTH}
                value={text}
                onChangeText={(value) => { setText(value); setSaved(false); }}
                placeholder="For example: sent the proposal to Sam and fixed the login bug."
                placeholderTextColor={c.muted}
                style={{ minHeight: 110, borderWidth: 1, borderColor: c.line, borderRadius: 4, padding: 14, color: c.text, fontFamily: F.text, fontSize: 18, lineHeight: 26, textAlignVertical: 'top' }}
              />
              {saved ? (
                <Text accessibilityLiveRegion="polite" style={{ color: c.accent, fontSize: 14, fontFamily: F.sansMedium }}>Saved. Your next brief will use this.</Text>
              ) : (
                <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>Saved to your ledger. Every brief reads your updates from the last 14 days. Updates can't be edited later.</Text>
              )}
              <ErrorNote message={error} />
              <Button label="Save update" busy={busy} disabled={!text.trim()} onPress={() => void save()} />
              <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: c.text, fontSize: 16, fontFamily: F.sansMedium }}>{saved ? 'Done' : 'Cancel'}</Text>
              </Pressable>
              {recent.length ? (
                <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.line, paddingTop: 14 }}>
                  <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, fontFamily: F.sansBold }}>Recent updates</Text>
                  {recent.map((entry) => (
                    <View key={entry.id} style={{ gap: 2 }}>
                      <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 12 }}>{when(entry.createdAt)}</Text>
                      <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 14, lineHeight: 20 }}>{entry.text}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
