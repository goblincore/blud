// src/lab/sdf-zombie/burn-behaviour.ts
//
// WHAT A BURNING BODY DOES, as a pure seeded step. Per type (owner call,
// 2026-09-18): a soldier panics — no shooting, flees the player on an erratic
// heading, faster; a zombie is mindless — keeps chasing, faster, heading
// jittering. Both stumble every stumbleMinSec..stumbleMaxSec. The actor applies
// this as an override of its mind's verdict (the `doomed` pattern), so neither
// brain learns a new state.
import type { Vec3 } from './types';

export const BURN_BEHAVIOUR = Object.freeze({
  /** OFF (owner playtest 2026-09-18): the flee + stumble read as jerky on the
   *  soldier, so a burning soldier keeps behaving exactly as unburnt. The panic
   *  logic below stays for the real flare-gun pass. Zombies are unaffected. */
  soldierPanic: false,
  soldierSpeed: 1.4,
  zombieSpeed: 1.25,
  /** Soldier flee target: this far from self, re-picked every repickMin..Max s. */
  fleeDistM: 4,
  repickMinSec: 1,
  repickMaxSec: 2,
  /** Max heading swing off the away/chase direction, radians. */
  soldierSwingRad: 1.0,
  zombieJitterRad: 0.45,
  /** Zombie jitter rate (Hz of the smooth wobble). */
  zombieJitterHz: 0.7,
  stumbleMinSec: 1.5,
  stumbleMaxSec: 3,
  /** Stagger impulse gain handed to the motion system's lurch. */
  stumbleGain: 0.6,
  /**
   * ARM-FLAIL STAND-IN (see game-actor's `queueBurnFlail`): motion.ts has no
   * additive arm-pose channel, so the flail is the existing burn→shudder
   * stagger re-emitted this often. Gain > 1 makes the 2 cm tuned shudder read
   * as a raised, frantic wave rather than a sub-perceptual tremor.
   *
   * A SOLDIER gets a longer period: any shot signal also starts
   * `stepSoldierStagger`, and an equal-level hit does not restart an active
   * soldier reaction, so a `small` soldier flail (0.42 s) must be re-emitted
   * only after it has lapsed or it fires once and dies.
   */
  flailPeriodSec: 0.35,
  soldierFlailPeriodSec: 0.5,
  flailGain: 1.8,
});

/** STUDY SWITCH (2026-09-22, fire-cost study): false = bodies burn VISUALLY but keep
 *  behaving as unburnt (no speed-up, jitter, stumble or flail), so the fire's render
 *  cost can be compared against the same motion without fire. Ship: true. */
let burnBehaviourOn = true;
export const setBurnBehaviourEnabled = (on: boolean) => { burnBehaviourOn = on; };
export const burnBehaviourEnabled = () => burnBehaviourOn;

export interface BurnPanicState { rng: number; nextRepick: number; swing: number; nextStumble: number; t: number; phase: number }

function next(s: BurnPanicState): number {          // mulberry32
  let x = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function createBurnPanic(seed: number): BurnPanicState {
  const s: BurnPanicState = { rng: seed | 0, nextRepick: 0, swing: 0, nextStumble: 0, t: 0, phase: 0 };
  s.phase = next(s) * Math.PI * 2;
  s.nextStumble = lerp(BURN_BEHAVIOUR.stumbleMinSec, BURN_BEHAVIOUR.stumbleMaxSec, next(s));
  return s;
}

export interface BurnPanicInput { kind: 'zombie' | 'soldier'; self: Vec3; player: Vec3 | null; chaseTarget: Vec3 | null }
export interface BurnPanicOut { target: Vec3 | null; cruiseScale: number; fire: false; stumble: boolean }

function rotateXZ(dx: number, dz: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function stepBurnPanic(s: BurnPanicState, i: BurnPanicInput, dt: number): BurnPanicOut {
  const B = BURN_BEHAVIOUR;
  s.t += dt;
  let stumble = false;
  if (s.t >= s.nextStumble) {
    stumble = true;
    s.nextStumble = s.t + lerp(B.stumbleMinSec, B.stumbleMaxSec, next(s));
  }
  if (i.kind === 'soldier') {
    if (s.t >= s.nextRepick) {
      s.swing = (next(s) * 2 - 1) * B.soldierSwingRad;
      s.nextRepick = s.t + lerp(B.repickMinSec, B.repickMaxSec, next(s));
    }
    const p = i.player ?? [i.self[0] + 1, 0, i.self[2]];
    let dx = i.self[0] - p[0], dz = i.self[2] - p[2];
    const len = Math.hypot(dx, dz) || 1;
    [dx, dz] = rotateXZ(dx / len, dz / len, s.swing);
    return {
      target: [i.self[0] + dx * B.fleeDistM, i.self[1], i.self[2] + dz * B.fleeDistM],
      cruiseScale: B.soldierSpeed, fire: false, stumble,
    };
  }
  const c = i.chaseTarget;
  if (!c) return { target: null, cruiseScale: B.zombieSpeed, fire: false, stumble };
  const dx = c[0] - i.self[0], dz = c[2] - i.self[2];
  const wob = Math.sin(s.t * B.zombieJitterHz * Math.PI * 2 + s.phase)
    + 0.5 * Math.sin(s.t * B.zombieJitterHz * 5.3 + s.phase * 1.7);
  const [rx, rz] = rotateXZ(dx, dz, (wob / 1.5) * B.zombieJitterRad);
  return { target: [i.self[0] + rx, c[1], i.self[2] + rz], cruiseScale: B.zombieSpeed, fire: false, stumble };
}
