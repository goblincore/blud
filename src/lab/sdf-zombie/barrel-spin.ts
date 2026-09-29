// src/lab/sdf-zombie/barrel-spin.ts
//
// The juggernaut's chaingun BARREL SPIN, as plain data. Pure: no three.
//
// The spin IS the telegraph (spec 2026-09-25-juggernaut-design.md): the
// barrels wind up through the brain's `aim` state (CHAINGUN_TUNING.aimSec,
// 0.9 s) before the first round, stay at speed through the stream, and run
// down after it. So the spin follows the MIND's state, not the fire pulses:
// a spin driven by shots would start with the first round, which is exactly
// one telegraph too late.
//
// game-actor.ts steps it once per frame; held-prop.ts rotates the .glb's
// `Barrels` node (make-juggernaut-chaingun.ts) about the bore by `angle`.

export const BARREL_SPIN = {
  /** Full speed, rad/s. ~3 turns a second: fast enough to blur into a
   *  spinning read at game distance, still countable up close. */
  maxRate: 18,
  /** Seconds from rest to full speed. Under CHAINGUN_TUNING.aimSec (0.9) so
   *  he is visibly at speed as the first round leaves. */
  spinUpSec: 0.8,
  /** Seconds from full speed to rest: a heavy rotor coasts. */
  spinDownSec: 1.4,
} as const;

export interface BarrelSpin {
  /** rad/s */
  rate: number;
  /** rad, wrapped to [0, 2pi) */
  angle: number;
}

export const BARREL_REST: BarrelSpin = { rate: 0, angle: 0 };

/** Mind states (soldier-brain.ts) in which the barrels are driven. */
export function barrelsDriven(mindState: string): boolean {
  return mindState === 'aim' || mindState === 'fire' || mindState === 'recover';
}

export function stepBarrelSpin(s: BarrelSpin, driven: boolean, dt: number): BarrelSpin {
  const t = BARREL_SPIN;
  const rate = driven
    ? Math.min(t.maxRate, s.rate + (t.maxRate / t.spinUpSec) * dt)
    : Math.max(0, s.rate - (t.maxRate / t.spinDownSec) * dt);
  const tau = Math.PI * 2;
  // Integrate on the mean rate across the step (trapezoid), then wrap.
  const angle = (((s.angle + 0.5 * (s.rate + rate) * dt) % tau) + tau) % tau;
  return { rate, angle };
}

// THE WARBULL'S LAUNCHER INDEXES instead of spinning: three tubes on one
// spindle, a third of a turn per rocket, so the next loaded tube comes round
// to the muzzle between shots (make-warbull-launcher.ts `Barrels`). The
// cluster chases its target at a fixed rate, snapping round in ~0.2 s: slower
// than the volley's 0.4 s spacing would allow a misfire read, fast enough to
// be seen as a mechanism rather than a drift.
export const LAUNCHER_INDEX = {
  /** rad per rocket: one tube of three. */
  step: (Math.PI * 2) / 3,
  /** rad/s the cluster turns while catching up. */
  rate: 10,
} as const;

export interface BarrelIndex { angle: number; target: number }
export const INDEX_REST: BarrelIndex = { angle: 0, target: 0 };

/** One frame: `fired` advances the target a tube; the angle chases it. The
 *  angle is NOT wrapped (so the chase never takes the long way round); the
 *  renderer only ever reads it through a rotation. */
export function stepBarrelIndex(s: BarrelIndex, fired: boolean, dt: number): BarrelIndex {
  const target = s.target + (fired ? LAUNCHER_INDEX.step : 0);
  const gap = target - s.angle;
  const move = Math.sign(gap) * Math.min(Math.abs(gap), LAUNCHER_INDEX.rate * dt);
  return { angle: s.angle + move, target };
}
