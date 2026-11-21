import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Api } from './api';
import { Button, ErrorNote, F, R, display, message, useColors } from './ui';

const MAX_LENGTH = 2000;

/** Asks what you want to achieve, and the AI writes it as one OKR: an objective and up to 3 key results. */
export function GoalModal({ api, visible, onClose, onAdded }: { api: Api; visible: boolean; onClose(): void; onAdded(goals: string[]): void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
  }, [visible]);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const { goals } = await api.addGoal(text.trim());
      setText('');
      onAdded(goals);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16, paddingTop: insets.top + 8 }}>
          <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: R.card }}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              <Text accessibilityRole="header" style={{ color: c.text, ...display, fontSize: 30, lineHeight: 32 }}>what do you want to achieve?</Text>
              <TextInput
                accessibilityLabel="Your goal"
                autoFocus
                multiline
                maxLength={MAX_LENGTH}
                editable={!busy}
                value={text}
                onChangeText={setText}
                placeholder="For example: land a senior backend role by March, ideally remote, with a few strong interviews first."
                placeholderTextColor={c.muted}
                style={{ minHeight: 110, borderWidth: 1, borderColor: c.line2, borderRadius: R.control, backgroundColor: c.bg, padding: 14, color: c.text, fontFamily: F.text, fontSize: 17, lineHeight: 25, textAlignVertical: 'top' }}
              />
              <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 13, lineHeight: 18 }}>
                Rough notes are fine. The AI turns them into one objective with up to 3 measurable key results, which you can edit afterwards.
              </Text>
              <ErrorNote message={error} />
              <Button label={busy ? 'Writing your OKR…' : 'Write OKR'} busy={busy} disabled={!text.trim()} onPress={() => void write()} />
              <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
                <Text style={{ color: c.text, fontSize: 15, fontFamily: F.sansMedium, textTransform: 'lowercase' }}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
