import { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { Api, Schedule, ScheduleInput } from '../api';
import { describeDays, ScheduleEditor } from '../ScheduleEditor';
import { Body, Button, Card, ErrorNote, Loading, message, Screen, Title, useColors, F } from '../ui';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
const toInput = ({ kind, time, days, timezone, enabled }: Schedule): ScheduleInput => ({ kind, time, days, timezone, enabled });

export function SchedulesScreen({ api, onChanged }: { api: Api; onChanged(): void }) {
  const c = useColors();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = (await api.schedules()).schedules;
      setSchedules(list);
      setEditing((e) => e ?? (list.length ? null : 'new'));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const after = async (work: Promise<unknown>) => {
    await work;
    setEditing(null);
    await load();
    onChanged();
  };

  const setEnabled = (s: Schedule, enabled: boolean) => {
    after(api.updateSchedule(s.id, { ...toInput(s), enabled })).catch((e) => setError(message(e)));
  };
  const remove = (s: Schedule) => {
    after(api.deleteSchedule(s.id)).catch((e) => setError(message(e)));
  };

  if (!schedules) return error ? <Screen><ErrorNote message={error} /></Screen> : <Loading label="Loading schedules…" />;

  return (
    <Screen>
      <Title>Schedule</Title>
      <Body muted>Your server writes briefs at these times, so it needs to be running then. Open any device to read them.</Body>
      <ErrorNote message={error} />
      {schedules.map((s) => editing === s.id ? (
        <ScheduleEditor key={s.id} initial={toInput(s)} submitLabel="Save changes" onCancel={() => setEditing(null)} onSubmit={(input) => after(api.updateSchedule(s.id, input))} />
      ) : (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.text, fontSize: 20, fontFamily: F.sansBold }}>{s.time} · {s.kind === 'morning' ? 'Morning' : 'Evening'}</Text>
              <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>{describeDays(s.days)} · {s.timezone}</Text>
            </View>
            <Switch accessibilityLabel={`${s.kind} brief at ${s.time} on or off`} value={s.enabled} onValueChange={(v) => setEnabled(s, v)} trackColor={{ true: c.accent }} />
          </View>
          {s.enabled && s.nextRun ? <Text style={{ color: c.text, fontFamily: F.sans, fontSize: 14 }}>Next: {when(s.nextRun)}</Text> : null}
          {!s.enabled ? <Text style={{ color: c.muted, fontFamily: F.sans, fontSize: 14 }}>Paused</Text> : null}
          {s.lastStatus?.startsWith('failed') ? <ErrorNote message={`The last run failed: ${s.lastStatus.slice(8)}`} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button label="Edit" variant="secondary" onPress={() => setEditing(s.id)} /></View>
            <View style={{ flex: 1 }}><Button label="Delete" variant="danger" onPress={() => remove(s)} /></View>
          </View>
        </Card>
      ))}
      {editing === 'new' ? (
        <ScheduleEditor submitLabel="Save schedule" {...(schedules.length ? { onCancel: () => setEditing(null) } : {})} onSubmit={(input) => after(api.createSchedule(input))} />
      ) : (
        <Button label="Add a schedule" variant="secondary" onPress={() => setEditing('new')} />
      )}
    </Screen>
  );
}
