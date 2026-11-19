import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBrief, parseGoal, parsePriority } from '../src/parseBrief';

function project(actual: unknown, expected: unknown): unknown {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) || !actual || typeof actual !== 'object') return actual;
  return Object.fromEntries(Object.keys(expected).map((k) => [k, project((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k])]));
}
/** Checks only the keys `expected` names, like vitest's toMatchObject. */
const like = (actual: unknown, expected: Record<string, unknown>) => assert.deepEqual(project(actual, expected), expected);

describe('parsePriority', () => {
  it('reads a full line', () => {
    assert.deepEqual(parsePriority('🔥 [Gmail] Contract redlines → Confirm by Friday | Score: 85'), {
      source: 'Gmail', goal: null, unaligned: false, headline: 'Contract redlines', action: 'Confirm by Friday', score: 85, level: 'critical',
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
    assert.deepEqual(parsed.noise, [{ item: 'Digest', reason: 'no goal', score: 40 }]);
  });
});

describe('new layout', () => {
  it('sorts signals by score and reads Left Out', () => {
    const parsed = parseBrief('### Signals\n- ⚡ [A] Low → x | Score: 61\n- 🔥 [B] High → y | Score: 90\n### Goals\n- ⚪ G\n### Sources\nx\n### Left Out\n- Noise → score 5 | spam\n### Note for Next Brief\nN');
    assert.equal(parsed.structured, true);
    assert.deepEqual(parsed.priorities.map((p) => p.headline), ['High', 'Low']);
    assert.deepEqual(parsed.noise, [{ item: 'Noise', reason: 'spam', score: 5 }]);
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
    assert.deepEqual(parsed.noise, [{ item: 'Newsletter', reason: 'irrelevant', score: 40 }]);
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
