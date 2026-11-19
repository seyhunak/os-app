import type { Schedule } from './db';

/**
 * A phone can't run a job at an exact time, so schedules work in two halves: a local notification
 * fires at each time, and the brief is written when you open it, or the app, after that time.
 * Times are in this phone's own timezone.
 */

const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
};

/** The moment `time` falls on the calendar day of `day`, in local time. */
const at = (day: Date, time: string) => {
  const d = new Date(day);
  d.setHours(0, minutesOf(time), 0, 0);
  return d;
};

/** The next time this schedule fires after `now`, or null if it's paused. */
export function nextRun(schedule: Pick<Schedule, 'time' | 'days' | 'enabled'>, now: Date): Date | null {
  if (!schedule.enabled || !schedule.days.length) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    if (!schedule.days.includes(day.getDay())) continue;
    const when = at(day, schedule.time);
    if (when > now) return when;
  }
  return null;
}

/**
 * The schedule that's due now: its time has passed today, and no brief has been written for it
 * since. Only today's runs count, so a phone left closed for a week writes one brief, not seven.
 * When several are due, the latest one wins, since it reads the freshest picture of the day.
 */
export function dueSchedule(schedules: Schedule[], now: Date): Schedule | null {
  let due: { schedule: Schedule; when: Date } | null = null;
  for (const schedule of schedules) {
    if (!schedule.enabled || !schedule.days.includes(now.getDay())) continue;
    const when = at(now, schedule.time);
    if (when > now) continue;
    if (schedule.lastRunAt && Date.parse(schedule.lastRunAt) >= when.getTime()) continue;
    if (!due || when > due.when) due = { schedule, when };
  }
  return due?.schedule ?? null;
}

/** The notifications to set: one weekly reminder per schedule and day. Weekday is 1 for Sunday, as expo-notifications counts. */
export function reminders(schedules: Schedule[]): Array<{ scheduleId: number; kind: Schedule['kind']; weekday: number; hour: number; minute: number }> {
  return schedules.filter((s) => s.enabled).flatMap((s) => {
    const minutes = minutesOf(s.time);
    return s.days.map((day) => ({ scheduleId: s.id, kind: s.kind, weekday: day + 1, hour: Math.floor(minutes / 60), minute: minutes % 60 }));
  });
}
