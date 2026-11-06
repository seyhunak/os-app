import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { deviceTimezone, type Kind, type ScheduleInput } from './api';
import { Button, Card, Chip, ErrorNote, Field, message, useColors, F } from './ui';

const DAYS = [
  { value: 1, short: 'M', name: 'Monday' }, { value: 2, short: 'T', name: 'Tuesday' }, { value: 3, short: 'W', name: 'Wednesday' },
  { value: 4, short: 'T', name: 'Thursday' }, { value: 5, short: 'F', name: 'Friday' }, { value: 6, short: 'S', name: 'Saturday' }, { value: 0, short: 'S', name: 'Sunday' },
];
const DEFAULT_TIME: Record<Kind, string> = { morning: '07:30', evening: '18:30' };

export const describeDays = (days: number[]) => {
  const sorted = [...days].sort().join();
  if (sorted === '0,1,2,3,4,5,6') return 'Every day';
  if (sorted === '1,2,3,4,5') return 'Weekdays';
  if (sorted === '0,6') return 'Weekends';
  return DAYS.filter((d) => days.includes(d.value)).map((d) => d.name.slice(0, 3)).join(', ');
};

function Stepper({ label, value, onChange }: { label: string; value: string; onChange(delta: number): void }) {
  const c = useColors();
  const step = (delta: number, name: string, glyph: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} ${label}`}
      onPress={() => onChange(delta)}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 22 }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {step(-1, 'Decrease', '−')}
      <Text accessibilityLabel={`${label} ${value}`} style={{ color: c.text, fontSize: 28, fontFamily: F.sansBold, minWidth: 42, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{value}</Text>
      {step(1, 'Increase', '+')}
    </View>
  );
}

interface Props {
  initial?: ScheduleInput;
  submitLabel: string;
  onSubmit(input: ScheduleInput): Promise<void>;
  onCancel?(): void;
}

export function ScheduleEditor({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const c = useColors();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'morning');
  const [time, setTime] = useState(initial?.time ?? DEFAULT_TIME.morning);
  const [days, setDays] = useState(initial?.days ?? [1, 2, 3, 4, 5]);
  const [timezone, setTimezone] = useState(initial?.timezone ?? deviceTimezone());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const setClock = (h: number, m: number) => setTime(`${String((h + 24) % 24).padStart(2, '0')}:${String((m + 60) % 60).padStart(2, '0')}`);
  const toggleDay = (day: number) => setDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day]));
  const chooseKind = (next: Kind) => {
    setKind(next);
    if (!initial) setTime(DEFAULT_TIME[next]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ kind, time, days, timezone: timezone.trim(), enabled: initial?.enabled ?? true });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Morning" selected={kind === 'morning'} onPress={() => chooseKind('morning')} />
        <Chip label="Evening" selected={kind === 'evening'} onPress={() => chooseKind('evening')} />
      </View>
      {kind === 'evening' ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14, lineHeight: 19 }}>Evening briefs reuse the day's data and never pull from your tools again, so pair this with a morning brief.</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Stepper label="hour" value={time.slice(0, 2)} onChange={(d) => setClock(hour + d, minute)} />
        <Text style={{ color: c.muted, fontSize: 24, fontFamily: F.sansBold }}>:</Text>
        <Stepper label="minute" value={time.slice(3)} onChange={(d) => setClock(hour, minute + d * 5 - (minute % 5 && d > 0 ? minute % 5 : 0))} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {DAYS.map((d) => <Chip key={d.value} label={d.short} accessibilityLabel={d.name} selected={days.includes(d.value)} onPress={() => toggleDay(d.value)} />)}
      </View>
      <Field label="Timezone" value={timezone} onChangeText={setTimezone} hint="Detected from this device. Example: Europe/Berlin" />
      <ErrorNote message={error} />
      <Button label={submitLabel} busy={busy} disabled={days.length === 0} onPress={() => void submit()} />
      {onCancel ? <Button label="Cancel" variant="secondary" onPress={onCancel} /> : null}
    </Card>
  );
}
