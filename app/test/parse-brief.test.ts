import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { currentBlock, parseBrief, parseGoal, parsePlanBlock, parsePriority, toMinutes } from '../src/parseBrief';

function project(actual: unknown, expected: unknown): unknown {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) || !actual || typeof actual !== 'object') return actual;
  return Object.fromEntries(Object.keys(expected).map((k) => [k, project((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k])]));
}
/** Checks only the keys `expected` names, like vitest's toMatchObject. */
const like = (actual: unknown, expected: Record<string, unknown>) => assert.deepEqual(project(actual, expected), expected);

describe('parsePriority', () => {
  it('reads a full line', () => {
    assert.deepEqual(parsePriority('🔥 [Gmail] Contract redlines → Confirm by Friday | Score: 85'), {
      source: 'Gmail', goal: null, unaligned: false, headline: 'Contract redlines', action: 'Confirm by Friday', score: 85, level: 'critical', when: null,
    });
  });

  it('copes with lines the model writes differently', () => {
    like(parsePriority('⚡ **Beta login** -> Fix it'), { source: null, headline: 'Beta login', action: 'Fix it', level: 'supporting', score: null });
    like(parsePriority('Just some text'), { headline: 'Just some text', action: null, level: null });
  });
});

describe('signal goals', () => {
  it('reads the goal in each form the model writes it', () => {
    like(parsePriority('🔥 [Gmail] Contract → Reply | Goal: Land customers | Score: 88'), { source: 'Gmail', goal: 'Land customers', action: 'Reply', score: 88 });
    like(parsePriority('🔥 [Gmail] Contract → Reply | Score: 88 | Goal: Land customers'), { goal: 'Land customers', action: 'Reply', score: 88 });
    like(parsePriority('⚡ [Gmail] Survey → Skim | Goal: [UNALIGNED] | Score: 61'), { goal: null, unaligned: true, action: 'Skim' });
    like(parsePriority('⚡ [Gmail] Survey → Skim | [UNALIGNED] | Score: 61'), { goal: null, unaligned: true, action: 'Skim' });
  });
});

describe('model habits', () => {
  it('uses the bracket as the headline when nothing else is left', () => {
    like(parsePriority('⚡ [Customer call with Sam] → Prepare | Goal: Land customers | Score: 68'), { source: null, headline: 'Customer call with Sam', action: 'Prepare', goal: 'Land customers' });
  });

  it('recognises the tool name without brackets', () => {
    const known = ['Gmail', 'Google Calendar'];
    like(parsePriority('🔥 Gmail Contract redlines → Reply | Score: 85', known), { source: 'Gmail', headline: 'Contract redlines' });
    like(parsePriority('🔥 Gmail [Contract redlines] → Reply | Score: 85', known), { source: 'Gmail', headline: 'Contract redlines' });
    like(parsePriority('🔥 Google Calendar Call with Sam → Prepare', known), { source: 'Google Calendar', headline: 'Call with Sam' });
    like(parsePriority('🔥 Gmailing the team → Do it', known), { source: null, headline: 'Gmailing the team' });
  });

  it('removes a stray goal label from a goal line', () => {
    assert.deepEqual(parseGoal('🟢 on track: Ship → Bug fixed → Confirm | Goal: Ship'), { goal: 'Ship', status: 'on-track', evidence: 'Bug fixed', action: 'Confirm' });
  });

  it("doesn't repeat signals under Left Out", () => {
    const parsed = parseBrief('### Signals\n- 🔥 [Sam] Contract redlines → Reply | Score: 88\n### Left Out\n- [Sam] Contract redlines → 88 | already included as signal\n- Digest → 40 | no goal\n- Other → 90 | Already listed');
    assert.deepEqual(parsed.noise, [{ item: 'Digest', source: null, reason: 'no goal', score: 40 }]);
  });
});

describe('new layout', () => {
  it('sorts signals by score and reads Left Out', () => {
    const parsed = parseBrief('### Signals\n- ⚡ [A] Low → x | Score: 61\n- 🔥 [B] High → y | Score: 90\n### Goals\n- ⚪ G\n### Sources\nx\n### Left Out\n- Noise → score 5 | spam\n### Note for Next Brief\nN');
    assert.equal(parsed.structured, true);
    assert.deepEqual(parsed.priorities.map((p) => p.headline), ['High', 'Low']);
    assert.deepEqual(parsed.noise, [{ item: 'Noise', source: null, reason: 'spam', score: 5 }]);
    assert.equal(parsed.note, 'N');
  });
});

describe('parseGoal', () => {
  it('reads each way the model writes a goal', () => {
    assert.deepEqual(parseGoal('🟡 needs attention: Ship the beta → Login bug blocks testers → Fix login'), { goal: 'Ship the beta', status: 'attention', evidence: 'Login bug blocks testers', action: 'Fix login' });
    assert.deepEqual(parseGoal('🟢 on track: Land customers → Awaiting Sam | next action: reply by Friday | Score: 85'), { goal: 'Land customers', status: 'on-track', evidence: 'Awaiting Sam', action: 'reply by Friday' });
    assert.deepEqual(parseGoal('⚪ Pass the exam'), { goal: 'Pass the exam', status: 'unknown', evidence: null, action: null });
  });
});

describe('parseBrief', () => {
  const brief = `# Good morning
### Today's Priorities
- 🔥 [Gmail] Contract → Confirm | Score: 85
- ⚡ [Calendar] Call → Prepare | Score: 65

**Noise eliminated:**
- Newsletter → score 40 | irrelevant

### Goals
- 🟡 needs attention: Ship → Bug → Fix

### Sources
| Source | Items | Status |
|---|---|---|
| Gmail | 2 | Pulled today |

### Note for Next Brief
Check the contract.`;

  it('splits a ranked brief into its parts', () => {
    const parsed = parseBrief(brief);
    assert.equal(parsed.structured, true);
    assert.deepEqual(parsed.priorities.map((p) => p.headline), ['Contract', 'Call']);
    assert.deepEqual(parsed.noise, [{ item: 'Newsletter', source: null, reason: 'irrelevant', score: 40 }]);
    like(parsed.goals[0], { goal: 'Ship', status: 'attention' });
    assert.ok(parsed.sources!.includes('- **Gmail:** 2 items'));
    assert.equal(parsed.note, 'Check the contract.');
    assert.equal(parsed.notice, null);
  });

  it('turns the source table in an older brief into plain lines', () => {
    const parsed = parseBrief('### Signals\n- ⚡ [A] x → y | Score: 61\n### Sources\n| Source | Items | Status |\n|---|---|---|\n| Gmail | 5 | Pulled today |\n| Slack | 1 | Failed |');
    assert.equal(parsed.sources, '- **Gmail:** 5 items, Pulled today\n- **Slack:** 1 item, Failed');
    assert.equal(parseBrief('### Signals\n- x\n### Sources\n- **Gmail:** Fine').sources, '- **Gmail:** Fine');
  });

  it('reads the focus, and goes without one in older briefs', () => {
    assert.equal(parseBrief('### Focus\nReply to **Sam**\nfirst.\n### Signals\n- ⚡ [A] x → y | Score: 61').focus, 'Reply to Sam first.');
    assert.equal(parseBrief('### Signals\n- ⚡ [A] x → y | Score: 61').focus, null);
  });

  it('keeps a digest unranked, including its notice and updates', () => {
    const parsed = parseBrief(`# Good morning

> Unranked digest: no OpenRouter key is set.

### Today's Priorities
**Gmail**
- Sam · Contract · unread

### Goals
- ⚪ Ship the beta

**Your updates:**
- 6 Nov: Fixed the bug

### Sources
| Source | Items | Status |

### Note for Next Brief
Nothing to carry over.`);
    assert.ok(parsed.notice!.includes('Unranked digest'));
    assert.deepEqual(parsed.priorities, []);
    assert.ok(parsed.prioritiesText!.includes('Sam'));
    assert.equal(parsed.goals.length, 1);
    assert.ok(parsed.goalsText!.includes('Fixed the bug'));
  });

  it('marks older briefs as unstructured, so nothing is lost', () => {
    assert.equal(parseBrief('# Good morning\n### 1. Signals / Eliminated\n- Old').structured, false);
  });

  it('handles a day with no signals', () => {
    const parsed = parseBrief("### Today's Priorities\nNo signals today.\n### Goals\nNo goals set yet.");
    assert.deepEqual(parsed.priorities, []);
    assert.equal(parsed.prioritiesText, 'No signals today.');
    assert.equal(parsed.goalsText, 'No goals set yet.');
  });
});

describe('the Lumen brief layout', () => {
  const md = [
    '# Good night',
    '### Focus',
    '- [Gmail] Reply to Pat → the invoice is due Friday | Goal: Get paid on time',
    '- [Goals] Draft the pitch outline → nothing moved it this week | Goal: Raise a seed round',
    '- [Linear] Close the login bug → it blocks the beta | Goal: Ship the beta',
    '### Signals',
    '- 🔥 [Gmail] Invoice question from Pat → Reply with the figures | Goal: Get paid on time | Score: 81',
    '### Left Out',
    '- [Hacker News] A thread on databases → 30 | not tied to a goal',
    '### Goal Progress',
    '- 🔴 Get paid on time → invoice overdue → Reply to Pat',
    '### Sources',
    '- **Gmail:** 5 emails',
    '### Note for Next Brief',
    'Check whether Pat paid.',
  ].join('\n');

  it('reads the greeting, the focus list, noise sources and goal progress', () => {
    const parsed = parseBrief(md, ['Gmail', 'Linear', 'Hacker News']);
    assert.equal(parsed.greeting, 'Good night');
    assert.deepEqual(parsed.focusItems.map((f) => [f.source, f.headline, f.goal]), [
      ['Gmail', 'Reply to Pat', 'Get paid on time'],
      ['Goals', 'Draft the pitch outline', 'Raise a seed round'],
      ['Linear', 'Close the login bug', 'Ship the beta'],
    ]);
    assert.equal(parsed.focus, null);
    assert.deepEqual(parsed.noise, [{ item: 'A thread on databases', source: 'Hacker News', reason: 'not tied to a goal', score: 30 }]);
    assert.equal(parsed.goals[0]?.status, 'at-risk');
    assert.equal(parsed.note, 'Check whether Pat paid.');
  });
});

describe('day plan', () => {
  it('marks the block the time falls in, runs a block ending at 00:00 to midnight, and marks the next one between blocks', () => {
    const day = [
      { start: '07:00', end: '09:00' },
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
      { start: '23:00', end: '00:00' },
    ];
    const at = (hhmm: string) => currentBlock(day, toMinutes(hhmm));
    assert.deepEqual(at('07:00'), { index: 0, now: true });
    assert.deepEqual(at('11:59'), { index: 1, now: true });
    assert.deepEqual(at('12:30'), { index: 2, now: false });
    assert.deepEqual(at('23:45'), { index: 3, now: true });
    assert.deepEqual(at('06:30'), { index: 0, now: false });
    // A block with no end runs to the next one's start.
    assert.deepEqual(currentBlock([{ start: '07:00', end: null }, { start: '10:00', end: '11:00' }], toMinutes('09:30')), { index: 0, now: true });
  });

  it('reads a block with its time, energy, why and goal', () => {
    assert.deepEqual(parsePlanBlock('09:00–10:30 | High | German: finish Lesson 12 and 20 Anki cards → fresh morning focus suits new grammar | Goal: Pass B1 German (KR1)'), {
      start: '09:00', end: '10:30', energy: 'high', task: 'German: finish Lesson 12 and 20 Anki cards', why: 'fresh morning focus suits new grammar', goal: 'Pass B1 German (KR1)',
    });
  });

  it('copes with looser lines and skips ones without a time', () => {
    like(parsePlanBlock('**9.00 - 9.30** Low energy | Inbox replies -> dip'), { start: '09:00', end: '09:30', energy: 'low', task: 'Inbox replies', why: 'dip', goal: null });
    like(parsePlanBlock('13:00–13:45 | Fixed | Call with Pat'), { energy: 'fixed', task: 'Call with Pat', why: null });
    like(parsePlanBlock('12:30–13:00 | Lunch | Goal: none'), { energy: null, task: 'Lunch', goal: null });
    assert.equal(parsePlanBlock('Lunch whenever'), null);
  });

  it('puts the plan and each focus slot on the parsed brief', () => {
    const parsed = parseBrief([
      '# Good morning',
      '### Focus',
      '- [Goals] German Lesson 12 → exam in 3 weeks | Goal: Pass B1 German (KR1) | When: 09:00-10:30',
      '### Day Plan',
      '- 09:00–10:30 | High | German Lesson 12 → morning peak | Goal: Pass B1 German (KR1)',
      '- 14:00–14:30 | Low | Reply to Pat → post-lunch dip',
      '### Signals',
      'No signals today.',
    ].join('\n'));
    like(parsed.focusItems[0]!, { headline: 'German Lesson 12', action: 'exam in 3 weeks', goal: 'Pass B1 German (KR1)', when: '09:00–10:30' });
    assert.deepEqual(parsed.plan.map((b) => [b.start, b.energy]), [['09:00', 'high'], ['14:00', 'low']]);
  });

  it('is empty for briefs written before the plan existed', () => {
    assert.deepEqual(parseBrief('# Good morning\n### Signals\nNo signals today.').plan, []);
  });
});
