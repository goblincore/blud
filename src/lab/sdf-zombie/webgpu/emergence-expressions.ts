// src/lab/sdf-zombie/webgpu/emergence-expressions.ts
//
// THE GOBLIN'S FACE through the emergence (spec docs/superpowers/specs/2026-10-16-emergence-in-the-flat-design.md): which of the goblin's
// expression clips plays when, derived from the same cue times as his body (screen-lab-goblin.ts goblinCues), crossfaded. Pure.
import type { Channels } from '../expression';
import { CHANNEL_NAMES, REST_CHANNELS, expressionAt } from '../expression';
import { GOBLIN_EXPRESSIONS } from '../characters/goblin-expressions';
import { SHOTS } from './emergence-timeline';
import type { GoblinCues } from './screen-lab-goblin';

export interface ExpressionCue { from: number; clip: string; fade: number }

const smooth = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

/** First-round values; the owner tunes the face in the lab page. A cue's clip plays from its own start (local time t - from). */
export function expressionCues(c: GoblinCues): ExpressionCue[] {
  const tear = SHOTS.find(s => s.id === 'crowning')!.start;
  return [
    { from: 0, clip: 'neutral', fade: 0 },
    { from: c.flinch, clip: 'surprise', fade: 0.12 },        // the flinch: eyes wide, mouth open (abrupt, like his body)
    { from: tear + 0.3, clip: 'shout', fade: 0.2 },          // the tear opens
    { from: c.land, clip: 'scowl', fade: 0.3 },              // the egg is down
    { from: c.sitUp + 0.3, clip: 'evil-grin', fade: 0.5 },   // he sits up and looks at it
  ];
}

export function expressionChannelsAt(t: number, cues: readonly ExpressionCue[]): Channels {
  const clipAt = (c: ExpressionCue): Channels => expressionAt(GOBLIN_EXPRESSIONS[c.clip]!, Math.max(0, t - c.from));
  let out: Channels = { ...REST_CHANNELS };
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    if (t < c.from) break;
    const w = i === 0 ? 1 : smooth(c.fade <= 0 ? 1 : (t - c.from) / c.fade);
    const here = clipAt(c);
    const mixed = {} as Channels;
    for (const n of CHANNEL_NAMES) mixed[n] = out[n] + (here[n] - out[n]) * w;
    out = mixed;
  }
  return out;
}
