// src/lab/sdf-zombie/zap.ts
//
// THE ZAP CLOCK (spec 2026-11-17-tesla-arc-design.md). One per body under the tesla arc:
//   zapped      the arc is on it: cook climbs, the glow is on, it jolts;
//   recovering  the arc left: cook falls, the glow and the pose fade over the tier's recoverSec;
//   statue      it cooked through on a tier that dies: held, charred, glow out, for ZAP.statueSec.
// The actor applies the output as an override of its mind's verdict (the burn panic's pattern).
// Pure: no clock of its own, no randomness beyond the seed. stepZap mutates the state it is given.
import type { ZapTier } from './motion-profile';

export const ZAP = Object.freeze({
  /** Cook lost per second off the arc. */
  coolRate: 0.5,
  /** Seconds for the glow and the pose to come fully on. */
  attackSec: 0.06,
  /** Cook at which the flesh starts to char. */
  charFrom: 0.6,
  /** A jolt's length, and the range of the gap to the next (seconds). */
  joltSec: 0.08,
  joltGapSec: [0.25, 0.7] as const,
  /** The glow's floor under the flicker (its ceiling is 1). */
  flickerLo: 0.55,
  /** Seconds a cooked body holds as a statue before it is killed. */
  statueSec: 0.8,
  /** The tremor: how far the chest moves (m) and how fast (Hz). */
  tremorM: 0.012,
  tremorHz: 25,
});

export interface ZapState {
  phase: 'zapped' | 'recovering' | 'statue';
  /** 0..1: how cooked. */
  cook: number;
  cookSec: number;
  /** Seconds since the zap began. */
  t: number;
  seed: number;
  dies: boolean;
  recoverSec: number;
  /** Private clock fields. */
  rng: number;
  env: number;
  charMax: number;
  joltIn: number;
  joltLeft: number;
  variant: number;
  statueT: number;
  phase0: number;
}

export interface ZapOut {
  /** 0..1 body glow, flicker included. 0 on a statue. */
  glow: number;
  /** 0..1 char. Monotonic for the life of the state. */
  char: number;
  /** 0..1 tremor amplitude. */
  tremor: number;
  /** 1 during a jolt, else 0. */
  jolt: number;
  /** 0..2: which star variant to hold. */
  variant: number;
  /** Bones bright on dark flesh, for the length of a jolt. */
  invert: boolean;
  /** 0..1 how far into the pose the body is (the glow's envelope, without the flicker). */
  pose: number;
  /** The recovery has ended: drop the state. */
  done: boolean;
  /** True on the one step the body cooks through (dying tiers only). */
  die: boolean;
  /** The statue has stood for statueSec. */
  statueDone: boolean;
}

const TAU = Math.PI * 2;
/** mulberry32 step on the state's own word: 0..1. */
function next(s: ZapState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let x = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const smooth = (a: number, b: number, v: number) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
const gap = (s: ZapState) => ZAP.joltGapSec[0] + (ZAP.joltGapSec[1] - ZAP.joltGapSec[0]) * next(s);

export function createZap(seed: number, tier: ZapTier): ZapState {
  const s: ZapState = {
    phase: 'zapped', cook: 0, cookSec: 0, t: 0, seed: seed | 0, dies: tier.dies, recoverSec: Math.max(1e-3, tier.recoverSec),
    rng: seed | 0, env: 0, charMax: 0, joltIn: 0, joltLeft: 0, variant: 0, statueT: 0, phase0: 0,
  };
  const [lo, hi] = tier.cookSec;
  s.cookSec = Math.max(0.1, lo + (hi - lo) * next(s));
  s.phase0 = next(s) * TAU;
  s.joltIn = gap(s);
  return s;
}

export function stepZap(s: ZapState, dt: number, arcOn: boolean): ZapOut {
  s.t += dt;
  if (s.phase === 'statue') {
    s.statueT += dt;
    return { glow: 0, char: 1, tremor: 0, jolt: 0, variant: s.variant, invert: false, pose: 1, done: false, die: false, statueDone: s.statueT >= ZAP.statueSec };
  }
  if (arcOn) {
    s.phase = 'zapped';
    s.cook = Math.min(1, s.cook + dt / s.cookSec);
    s.env = Math.min(1, s.env + dt / ZAP.attackSec);
    if (s.joltLeft > 0) s.joltLeft = Math.max(0, s.joltLeft - dt);
    else {
      s.joltIn -= dt;
      if (s.joltIn <= 0) {
        s.joltLeft = ZAP.joltSec;
        s.joltIn = gap(s);
        // One of the OTHER two variants, so every jolt is a visible change.
        s.variant = (s.variant + 1 + Math.floor(next(s) * 2)) % 3;
      }
    }
  } else {
    s.phase = 'recovering';
    s.cook = Math.max(0, s.cook - ZAP.coolRate * dt);
    s.env = Math.max(0, s.env - dt / s.recoverSec);
    s.joltLeft = 0;
  }
  s.charMax = Math.max(s.charMax, smooth(ZAP.charFrom, 1, s.cook));
  if (arcOn && s.dies && s.cook >= 1) {
    s.phase = 'statue';
    s.statueT = 0;
    s.charMax = 1;
    return { glow: 0, char: 1, tremor: 0, jolt: 0, variant: s.variant, invert: false, pose: 1, done: false, die: true, statueDone: false };
  }
  // Two incommensurate rates: never periodic over a zap's length.
  const f = 0.5 + 0.5 * (0.6 * Math.sin(s.t * 17.3 * TAU + s.phase0) + 0.4 * Math.sin(s.t * 29.1 * TAU + s.phase0 * 1.7));
  const jolt = s.joltLeft > 0 ? 1 : 0;
  return {
    glow: s.env * (ZAP.flickerLo + (1 - ZAP.flickerLo) * f),
    char: s.charMax, tremor: s.env, jolt, variant: s.variant, invert: jolt > 0, pose: s.env,
    done: !arcOn && s.env <= 0, die: false, statueDone: false,
  };
}
