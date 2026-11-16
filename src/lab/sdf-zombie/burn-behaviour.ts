// src/lab/sdf-zombie/burn-behaviour.ts
//
// WHAT A BURNING BODY DOES, as a pure seeded step (spec 2026-11-16-burn-flail-and-death-design.md).
// One clock per burning body, its length rolled from the body's tier (motion-profile.ts BurnTier):
//   panic   it runs from the player on a smoothly wandering heading, flailing (burn-flail.ts);
//   falter  the last stretch: speed and flail ease down, the heading wanders wider, the arms fold;
//   done    the clock is out. `die` is true on that one step when the tier dies.
// The actor applies this as an override of its mind's verdict (the `doomed` pattern), so no brain
// learns a burn state.
import type { Vec3 } from './types';
import { BURN_TIER_DEFAULT, type BurnTier } from './motion-profile';

export const BURN_BEHAVIOUR = Object.freeze({
  /** Flee target: this far from self along the wobbled heading. */
  fleeDistM: 4,
  /** Max heading swing off the away direction (rad) and the wobble's base rate (Hz). */
  wobbleRad: 0.9,
  wobbleHz: 0.45,
  /** The wobble's amplitude scale by the end of falter. */
  falterWobble: 1.5,
  /** Fraction of the clock at which falter begins. */
  falterAt: 0.75,
  /** Speed (as a fraction of the tier's) and flail amplitude at the end of falter. */
  falterSpeed: 0.45,
  falterFlail: 0.35,
  /** BLOCKED (a wall, a crate, a corner): the flee heading is turned off the away direction by this much
   *  (rad), plus up to blockedTurnExtra of it again, to a seeded side; blocked again, it takes the other
   *  side. Never past ~145 degrees with the wobble, so a blocked body runs along the wall, not back at the player. No
   *  second turn for blockedCoolSec. */
  blockedTurnRad: Math.PI / 2,
  blockedTurnExtra: 0.25,
  /** The wobble's scale while a blocked turn is held (the turn is already most of the way round). */
  blockedWobble: 0.4,
  blockedCoolSec: 0.5,
  /** How far along a candidate turn the `clear` probe looks (m). */
  probeM: 1,
  /** The last-resort turn (rad) when the probe finds no sideways way out: most of the way round. */
  blockedTurnBack: 2.4,
});

/** STUDY SWITCH (2026-09-22, fire-cost study): false = bodies burn VISUALLY but keep behaving as
 *  unburnt (no panic, no flail, no burn death), so the fire's render cost can be compared against the
 *  same motion without fire. Ship: true. */
let burnBehaviourOn = true;
export const setBurnBehaviourEnabled = (on: boolean) => { burnBehaviourOn = on; };
export const burnBehaviourEnabled = () => burnBehaviourOn;

export type BurnPhase = 'panic' | 'falter' | 'done';

export interface BurnPanicState {
  rng: number; t: number; phase: number;
  /** Seconds of panic + falter, rolled once. */
  durationSec: number;
  speed: number; dies: boolean;
  /** `die` has been reported. */
  died: boolean;
  /** Standing turn of the flee heading off the away direction (rad), set when the body reports it is blocked. */
  bias: number;
  /** Seconds until a blocked report may turn it again. */
  blockedCool: number;
}

function next(s: BurnPanicState): number {          // mulberry32
  let x = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
const smooth = (u: number) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };

export function createBurnPanic(seed: number, tier: BurnTier = BURN_TIER_DEFAULT): BurnPanicState {
  const s: BurnPanicState = { rng: seed | 0, t: 0, phase: 0, durationSec: 0, speed: tier.speed, dies: tier.dies, died: false, bias: 0, blockedCool: 0 };
  s.phase = next(s) * Math.PI * 2;
  const [lo, hi] = tier.panicSec;
  s.durationSec = Math.max(0.1, lo + (hi - lo) * next(s));
  return s;
}

export interface BurnPanicInput {
  self: Vec3;
  /** Last known player position; null = never seen. */
  player: Vec3 | null;
  /** The body's own forward (unit, ground plane): the heading when no player is known. */
  forward: Vec3;
  /** The body is trying to run and getting nowhere (a wall): turn the flee heading. Absent = false. */
  blocked?: boolean;
  /** Can the body walk from `self` to this point? Asked only on a blocked step, of a point probeM along
   *  each candidate turn; the first clear one is taken. Absent = every direction counts as clear. */
  clear?: (point: Vec3) => boolean;
}
export interface BurnPanicOut {
  target: Vec3;
  cruiseScale: number;
  fire: false;
  phase: BurnPhase;
  /** 0..1 through the whole clock. */
  u: number;
  /** Flail amplitude 0..1 (before the tier's own scale). */
  flail: number;
  /** 0..1 across falter: how far the arms have folded to the chest. */
  fold: number;
  /** True on the one step the clock ends, when the tier dies. */
  die: boolean;
}

export function stepBurnPanic(s: BurnPanicState, i: BurnPanicInput, dt: number): BurnPanicOut {
  const B = BURN_BEHAVIOUR;
  s.t += Math.max(0, dt);
  const u = Math.min(1, s.t / s.durationSec);
  const f = smooth((u - B.falterAt) / (1 - B.falterAt));
  const phase: BurnPhase = u >= 1 ? 'done' : u >= B.falterAt ? 'falter' : 'panic';
  let dx = i.forward[0], dz = i.forward[2];
  if (i.player) { dx = i.self[0] - i.player[0]; dz = i.self[2] - i.player[2]; }
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 0; dz = 1; } else { dx /= len; dz /= len; }
  const turned = (a: number): [number, number] => { const c = Math.cos(a), sn = Math.sin(a); return [dx * c - dz * sn, dx * sn + dz * c]; };
  s.blockedCool = Math.max(0, s.blockedCool - Math.max(0, dt));
  if (i.blocked && s.blockedCool <= 0) {
    // Running straight from the player into a wall reads as a body stuck on the spot: turn hard to
    // one side and hold that turn, so it runs ALONG the wall until it is blocked again. The side is
    // seeded the first time and the other one each time after; with a `clear` probe, the first
    // candidate the body can actually walk wins (a level that rejects a blocked step outright gives
    // no slide, so a blind turn can stand still).
    const side = s.bias === 0 ? (next(s) < 0.5 ? -1 : 1) : -Math.sign(s.bias);
    const wide = B.blockedTurnRad * (1 + B.blockedTurnExtra);
    const turn = B.blockedTurnRad * (1 + B.blockedTurnExtra * next(s));
    let pick = side * turn;
    if (i.clear) {
      // Sideways first at the full probe; then the same turns at half the probe (a nook); last, most
      // of the way round: running past the player beats standing still against a wall.
      const sideways = [side * turn, -side * turn, side * wide, -side * wide, side * B.blockedTurnRad * 0.6, -side * B.blockedTurnRad * 0.6];
      const tries: [number, number][] = [
        ...sideways.map((c): [number, number] => [c, B.probeM]),
        ...sideways.map((c): [number, number] => [c, B.probeM * 0.5]),
        [side * B.blockedTurnBack, B.probeM], [-side * B.blockedTurnBack, B.probeM],
      ];
      for (const [cand, reach] of tries) {
        const [cx, cz] = turned(cand);
        if (i.clear([i.self[0] + cx * reach, i.self[1], i.self[2] + cz * reach])) { pick = cand; break; }
      }
    }
    s.bias = pick;
    s.blockedCool = B.blockedCoolSec;
  }
  const w = 2 * Math.PI * B.wobbleHz * s.t;
  const wob = (Math.sin(w + s.phase) + 0.5 * Math.sin(w * 2.3 + s.phase * 1.7)) / 1.5;
  const [hx, hz] = turned(s.bias + wob * B.wobbleRad * (1 + (B.falterWobble - 1) * f) * (s.bias !== 0 ? B.blockedWobble : 1));
  const die = phase === 'done' && s.dies && !s.died;
  if (die) s.died = true;
  return {
    target: [i.self[0] + hx * B.fleeDistM, i.self[1], i.self[2] + hz * B.fleeDistM],
    cruiseScale: s.speed * (1 + (B.falterSpeed - 1) * f),
    fire: false, phase, u,
    flail: 1 + (B.falterFlail - 1) * f,
    fold: f,
    die,
  };
}
