import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Schedule } from '../src/core/db';
import { dueSchedule, nextRun, reminders } from '../src/core/schedule';

// Local-time dates, so these hold in any timezone. 2026-11-19 is a Thursday (day 4).
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: 1, kind: 'morning', time: '08:00', days: [1, 2, 3, 4, 5], timezone: 'UTC', enabled: true, lastRunAt: null, lastStatus: null, ...over,
});

describe('next run', () => {
  it('is later today when the time has not come yet', () => {
    assert.deepEqual(nextRun(schedule(), at(19, 7)), at(19, 8));
  });

  it('skips to the next chosen day once today has passed', () => {
    // Thursday after 8: Friday. Friday after 8: Monday.
    assert.deepEqual(nextRun(schedule(), at(19, 9)), at(20, 8));
    assert.deepEqual(nextRun(schedule(), at(20, 9)), at(23, 8));
  });

  it('is a week out when the only day is today and it has passed', () => {
    assert.deepEqual(nextRun(schedule({ days: [4] }), at(19, 9)), at(26, 8));
  });

  it('is null when paused', () => {
    assert.equal(nextRun(schedule({ enabled: false }), at(19, 7)), null);
  });
});

describe('due schedule', () => {
  it('is due once its time has passed today, and not before', () => {
    assert.equal(dueSchedule([schedule()], at(19, 7, 59)), null);
    assert.equal(dueSchedule([schedule()], at(19, 8))?.id, 1);
  });

  it('is not due again once it has run since that time', () => {
    assert.equal(dueSchedule([schedule({ lastRunAt: at(19, 8, 1).toISOString() })], at(19, 12)), null);
  });

  it('a run from yesterday does not count for today', () => {
    assert.equal(dueSchedule([schedule({ lastRunAt: at(18, 8, 1).toISOString() })], at(19, 12))?.id, 1);
  });

  it('only counts today, so missed days are not caught up', () => {
    assert.equal(dueSchedule([schedule({ days: [3] })], at(19, 12)), null);
  });

  it('picks the latest when several are due', () => {
    const morning = schedule({ id: 1, time: '08:00' });
    const afternoon = schedule({ id: 2, kind: 'afternoon', time: '13:00' });
    assert.equal(dueSchedule([morning, afternoon], at(19, 14))?.id, 2);
  });

  it('skips paused schedules', () => {
    assert.equal(dueSchedule([schedule({ enabled: false })], at(19, 12)), null);
  });
});

describe('reminders', () => {
  it('sets one per enabled schedule and day, counting Sunday as 1', () => {
    assert.deepEqual(reminders([schedule({ days: [0, 4], time: '07:30' }), schedule({ id: 2, enabled: false })]), [
      { scheduleId: 1, kind: 'morning', weekday: 1, hour: 7, minute: 30 },
      { scheduleId: 1, kind: 'morning', weekday: 5, hour: 7, minute: 30 },
    ]);
  });
});
