import { Cron } from 'croner';
import type { BriefService } from './briefs.ts';
import type { Schedule, Store } from './db.ts';

export function toCron(schedule: Pick<Schedule, 'time' | 'days'>): string {
  const [hour, minute] = schedule.time.split(':').map(Number);
  return `${minute} ${hour} * * ${[...schedule.days].sort().join(',')}`;
}

export class Scheduler {
  private jobs = new Map<number, Cron>();

  constructor(private readonly store: Store, private readonly briefs: BriefService) {}

  /** Call after any schedule change. */
  sync(): void {
    this.stop();
    for (const schedule of this.store.listSchedules()) {
      if (!schedule.enabled) continue;
      this.jobs.set(schedule.id, new Cron(toCron(schedule), { timezone: schedule.timezone, protect: true }, () => this.fire(schedule.id)));
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  nextRun(id: number): string | null {
    return this.jobs.get(id)?.nextRun()?.toISOString() ?? null;
  }

  async fire(id: number): Promise<void> {
    const schedule = this.store.getSchedule(id);
    if (!schedule) return;
    try {
      const brief = await this.briefs.generate({ kind: schedule.kind, trigger: 'schedule', timezone: schedule.timezone });
      this.store.recordScheduleRun(id, `ok: brief ${brief.id}`);
    } catch (error) {
      this.store.recordScheduleRun(id, `failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
