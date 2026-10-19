import { describe, it, expect } from 'vitest';
import { GOBLIN_CUES } from './screen-lab-goblin';
import { SHOTS } from './emergence-timeline';
import { GOBLIN_EXPRESSIONS } from '../characters/goblin-expressions';
import { CHANNEL_NAMES, REST_CHANNELS, expressionAt } from '../expression';
import { expressionCues, expressionChannelsAt } from './emergence-expressions';

const cues = expressionCues(GOBLIN_CUES);

describe('emergence expressions', () => {
  it('starts neutral (the rest channels)', () => {
    expect(expressionChannelsAt(0, cues)).toEqual(REST_CHANNELS);
  });
  it('the cues are in order and each names a clip of the goblin library', () => {
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.from).toBeGreaterThan(cues[i - 1]!.from);
    for (const c of cues) expect(GOBLIN_EXPRESSIONS[c.clip], c.clip).toBeDefined();
  });
  it('surprise comes after the flinch starts, the evil grin after he starts to sit up, and nothing before', () => {
    const at = (clip: string) => cues.find(c => c.clip === clip)!.from;
    expect(at('surprise')).toBeGreaterThanOrEqual(GOBLIN_CUES.flinch);
    expect(at('evil-grin')).toBeGreaterThanOrEqual(GOBLIN_CUES.sitUp);
    expect(at('shout')).toBeGreaterThanOrEqual(SHOTS.find(s => s.id === 'crowning')!.start);
  });
  it('holds the evil grin to the end', () => {
    const last = cues[cues.length - 1]!;
    const end = expressionChannelsAt(14.5, cues), want = expressionAt(GOBLIN_EXPRESSIONS[last.clip]!, 14.5 - last.from);
    for (const n of CHANNEL_NAMES) expect(end[n], n).toBeCloseTo(want[n], 6);
  });
  it('is continuous: no channel jumps more than 0.25 in 10 ms (crossfades, not cuts)', () => {
    for (let t = 0; t < 14.5; t += 0.01) {
      const a = expressionChannelsAt(t, cues), b = expressionChannelsAt(t + 0.01, cues);
      for (const n of CHANNEL_NAMES) expect(Math.abs(b[n] - a[n]), `${n} t=${t.toFixed(2)}`).toBeLessThan(0.25);
    }
  });
});
