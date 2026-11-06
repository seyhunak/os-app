import { describe, expect, it } from 'vitest';
import { parseBrief, parseGoal, parsePriority } from '../../app/src/parseBrief.ts';

describe('parsePriority', () => {
  it('reads a full line', () => {
    expect(parsePriority('🔥 [Gmail] Contract redlines → Confirm by Friday | Score: 85')).toEqual({
      source: 'Gmail', goal: null, unaligned: false, headline: 'Contract redlines', action: 'Confirm by Friday', score: 85, level: 'critical',
    });
  });

  it('copes with lines the model writes differently', () => {
    expect(parsePriority('⚡ **Beta login** -> Fix it')).toMatchObject({ source: null, headline: 'Beta login', action: 'Fix it', level: 'supporting', score: null });
    expect(parsePriority('Just some text')).toMatchObject({ headline: 'Just some text', action: null, level: null });
  });
});

describe('signal goals', () => {
  it('reads the goal in each form the model writes it', () => {
    expect(parsePriority('🔥 [Gmail] Contract → Reply | Goal: Land customers | Score: 88')).toMatchObject({ source: 'Gmail', goal: 'Land customers', action: 'Reply', score: 88 });
    expect(parsePriority('🔥 [Gmail] Contract → Reply | Score: 88 | Goal: Land customers')).toMatchObject({ goal: 'Land customers', action: 'Reply', score: 88 });
    expect(parsePriority('⚡ [Gmail] Survey → Skim | Goal: [UNALIGNED] | Score: 61')).toMatchObject({ goal: null, unaligned: true, action: 'Skim' });
    expect(parsePriority('⚡ [Gmail] Survey → Skim | [UNALIGNED] | Score: 61')).toMatchObject({ goal: null, unaligned: true, action: 'Skim' });
  });
});

describe('model habits', () => {
  it('uses the bracket as the headline when nothing else is left', () => {
    expect(parsePriority('⚡ [Customer call with Sam] → Prepare | Goal: Land customers | Score: 68')).toMatchObject({ source: null, headline: 'Customer call with Sam', action: 'Prepare', goal: 'Land customers' });
  });

  it('recognises the tool name without brackets', () => {
    const known = ['Gmail', 'Google Calendar'];
    expect(parsePriority('🔥 Gmail Contract redlines → Reply | Score: 85', known)).toMatchObject({ source: 'Gmail', headline: 'Contract redlines' });
    expect(parsePriority('🔥 Gmail [Contract redlines] → Reply | Score: 85', known)).toMatchObject({ source: 'Gmail', headline: 'Contract redlines' });
    expect(parsePriority('🔥 Google Calendar Call with Sam → Prepare', known)).toMatchObject({ source: 'Google Calendar', headline: 'Call with Sam' });
    expect(parsePriority('🔥 Gmailing the team → Do it', known)).toMatchObject({ source: null, headline: 'Gmailing the team' });
  });

  it('removes a stray goal label from a goal line', () => {
    expect(parseGoal('🟢 on track: Ship → Bug fixed → Confirm | Goal: Ship')).toEqual({ goal: 'Ship', status: 'on-track', evidence: 'Bug fixed', action: 'Confirm' });
  });

  it("doesn't repeat signals under Left Out", () => {
    const parsed = parseBrief('### Signals\n- 🔥 [Sam] Contract redlines → Reply | Score: 88\n### Left Out\n- [Sam] Contract redlines → 88 | already included as signal\n- Digest → 40 | no goal\n- Other → 90 | Already listed');
    expect(parsed.noise).toEqual([{ item: 'Digest', reason: 'no goal' }]);
  });
});

describe('new layout', () => {
  it('sorts signals by score and reads Left Out', () => {
    const parsed = parseBrief('### Signals\n- ⚡ [A] Low → x | Score: 61\n- 🔥 [B] High → y | Score: 90\n### Goals\n- ⚪ G\n### Sources\nx\n### Left Out\n- Noise → score 5 | spam\n### Note for Next Brief\nN');
    expect(parsed.structured).toBe(true);
    expect(parsed.priorities.map((p) => p.headline)).toEqual(['High', 'Low']);
    expect(parsed.noise).toEqual([{ item: 'Noise', reason: 'spam' }]);
    expect(parsed.note).toBe('N');
  });
});

describe('parseGoal', () => {
  it('reads each way the model writes a goal', () => {
    expect(parseGoal('🟡 needs attention: Ship the beta → Login bug blocks testers → Fix login')).toEqual({ goal: 'Ship the beta', status: 'attention', evidence: 'Login bug blocks testers', action: 'Fix login' });
    expect(parseGoal('🟢 on track: Land customers → Awaiting Sam | next action: reply by Friday | Score: 85')).toEqual({ goal: 'Land customers', status: 'on-track', evidence: 'Awaiting Sam', action: 'reply by Friday' });
    expect(parseGoal('⚪ Pass the exam')).toEqual({ goal: 'Pass the exam', status: 'unknown', evidence: null, action: null });
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
    expect(parsed.structured).toBe(true);
    expect(parsed.priorities.map((p) => p.headline)).toEqual(['Contract', 'Call']);
    expect(parsed.noise).toEqual([{ item: 'Newsletter', reason: 'irrelevant' }]);
    expect(parsed.goals[0]).toMatchObject({ goal: 'Ship', status: 'attention' });
    expect(parsed.sources).toContain('- **Gmail:** 2 items');
    expect(parsed.note).toBe('Check the contract.');
    expect(parsed.notice).toBeNull();
  });

  it('turns the source table in an older brief into plain lines', () => {
    const parsed = parseBrief('### Signals\n- ⚡ [A] x → y | Score: 61\n### Sources\n| Source | Items | Status |\n|---|---|---|\n| Gmail | 5 | Pulled today |\n| Slack | 1 | Failed |');
    expect(parsed.sources).toBe('- **Gmail:** 5 items, Pulled today\n- **Slack:** 1 item, Failed');
    expect(parseBrief('### Signals\n- x\n### Sources\n- **Gmail:** Fine').sources).toBe('- **Gmail:** Fine');
  });

  it('reads the focus, and goes without one in older briefs', () => {
    expect(parseBrief('### Focus\nReply to **Sam**\nfirst.\n### Signals\n- ⚡ [A] x → y | Score: 61').focus).toBe('Reply to Sam first.');
    expect(parseBrief('### Signals\n- ⚡ [A] x → y | Score: 61').focus).toBeNull();
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
    expect(parsed.notice).toContain('Unranked digest');
    expect(parsed.priorities).toEqual([]);
    expect(parsed.prioritiesText).toContain('Sam');
    expect(parsed.goals).toHaveLength(1);
    expect(parsed.goalsText).toContain('Fixed the bug');
  });

  it('marks older briefs as unstructured, so nothing is lost', () => {
    expect(parseBrief('# Good morning\n### 1. Signals / Eliminated\n- Old').structured).toBe(false);
  });

  it('handles a day with no signals', () => {
    const parsed = parseBrief("### Today's Priorities\nNo signals today.\n### Goals\nNo goals set yet.");
    expect(parsed.priorities).toEqual([]);
    expect(parsed.prioritiesText).toBe('No signals today.');
    expect(parsed.goalsText).toBe('No goals set yet.');
  });
});
