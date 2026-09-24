// src/lab/sdf-zombie/player-hit-feedback.ts
//
// What an enemy melee hit DOES to the player while the game has no player
// health (game-actor.ts: "the game intentionally has no health"): a red
// flash, a camera shake, and a counter. Pure; the game reads `flash` into an
// overlay and `offset` into the camera. Real damage plugs into the same
// onMeleeContact event later.
import type { SwingVariant } from './attack';
import type { Vec3 } from './types';

export const HIT_FEEDBACK = {
  /** Seconds from a hit to a clean screen (flash and shake both at 0). */
  fadeSec: 0.45,
  /** Peak camera offset per variant (m). The heavy sword blows shake most. */
  shake: { cleave: 0.06, sweep: 0.04, lunge: 0.05, hook: 0.03, overhead: 0.03, shove: 0.02 } as Record<SwingVariant, number>,
  /** Shake frequency (Hz); sim time, so a replay shakes identically. */
  shakeHz: 23,
} as const;

export interface HitFeedback {
  /** 0..1 overlay strength. */
  flash: number;
  /** Peak shake amplitude of the live hit (m); 0 at rest. */
  shake: number;
  /** Seconds since the live hit. */
  t: number;
  /** Hits taken this session. Never decays. */
  hits: number;
  /** This frame's camera offset (m, world x/y). */
  offset: Vec3;
}

export const makeHitFeedback = (): HitFeedback => ({ flash: 0, shake: 0, t: 0, hits: 0, offset: [0, 0, 0] });

/** A hit lands: full flash, the variant's shake, the counter ticks. */
export function hitFeedback(s: HitFeedback, variant: SwingVariant): HitFeedback {
  return { ...s, flash: 1, shake: HIT_FEEDBACK.shake[variant], t: 0, hits: s.hits + 1 };
}

/** Advance `dt` seconds. Linear fade to exactly 0 at fadeSec. */
export function stepHitFeedback(s: HitFeedback, dt: number): HitFeedback {
  if (s.flash <= 0 && s.shake <= 0) {
    return s.offset[0] === 0 && s.offset[1] === 0 && s.offset[2] === 0 ? s : { ...s, offset: [0, 0, 0] };
  }
  const t = s.t + Math.max(0, dt);
  const k = Math.max(0, 1 - t / HIT_FEEDBACK.fadeSec);
  if (k === 0) return { ...s, t, flash: 0, shake: 0, offset: [0, 0, 0] };
  const amp = s.shake * k;
  const w = 2 * Math.PI * HIT_FEEDBACK.shakeHz * t;
  return {
    ...s, t, flash: s.flash > 0 ? k : 0,
    offset: [Math.sin(w) * amp, Math.sin(w * 1.37 + 1) * amp * 0.6, 0],
  };
}
