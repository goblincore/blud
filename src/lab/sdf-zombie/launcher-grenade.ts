// src/lab/sdf-zombie/launcher-grenade.ts
//
// The slot-4 launcher's 40 mm GRENADE as plain data. Pure: no three, no clock
// of its own, no world of its own.
//
// The flight is the dynamite bundle's own integrator (dynamite-flight.ts:
// gravity, drag, floor/wall/box bounces, the impact grace and safe distance,
// the fuse) — a grenade is a faster, smaller bundle that leaves a muzzle
// instead of a hand. What is the launcher's own is here: the launch (muzzle
// speed along the aim plus a small lob), the short fuse a grenade that has
// stopped short of anything burns down on, and the body test run at the
// flight's 120 Hz sub-step so a 30 m/s shell cannot tunnel through a torso.
//
// The blast is not here either: the wiring hands the detonation point to the
// dynamite path (game-dynamite-step.ts detonateAt), so a grenade wounds,
// gibs, shoves, lights and shakes exactly as a bundle does.
import type { Vec3 } from './types';
import { FLIGHT_TUNING, makeFlight, stepFlight, type FlightState, type FlightWorld } from './dynamite-flight';

export const GRENADE = {
  /** Muzzle speed, m/s. Under the flight's 25 m/s² a level shot drops ~0.35 m
   *  over 10 m after the lob: an arc you can see, flat enough to aim. */
  speedMps: 30,
  /** Lift added to the aim, radians: the launcher's lob. */
  lobRad: 6 * Math.PI / 180,
  /** Seconds a grenade that hits nothing it may detonate on (a bounce inside
   *  the safe distance, a roll to rest) burns before it goes off. */
  fuseSec: 1.6,
  /** Shell collision radius, m (the bundle's is 0.08). */
  radiusM: 0.03,
  /** The longest frame the step will spend; the flight clamps the same way. */
  maxStepSec: 0.25,
} as const;

/** Unit vector of `v`; the zero vector maps to straight ahead (-Z). */
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, -1];
}

/** The launch velocity for an aim direction: the aim raised by `lobRad` in its
 *  own vertical plane, at `speedMps`. A straight-up or straight-down aim keeps
 *  its direction (there is no horizontal to tilt toward). */
export function grenadeLaunchVelocity(aim: Vec3, speedMps: number = GRENADE.speedMps, lobRad: number = GRENADE.lobRad): Vec3 {
  const d = unit(aim);
  const h = Math.hypot(d[0], d[2]);
  if (h < 1e-6) return [d[0] * speedMps, d[1] * speedMps, d[2] * speedMps];
  const pitch = Math.min(Math.PI / 2, Math.atan2(d[1], h) + lobRad);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [(d[0] / h) * cp * speedMps, sp * speedMps, (d[2] / h) * cp * speedMps];
}

/** A grenade leaving `muzzle` along `aim`: impact mode, the grenade's fuse. */
export function makeGrenade(muzzle: Vec3, aim: Vec3): FlightState {
  return makeFlight(muzzle, grenadeLaunchVelocity(aim), { impactMode: true, fuseSec: GRENADE.fuseSec });
}

export interface GrenadeStep {
  state: FlightState;
  /** Where it went off this step, or null while it still flies. */
  boom: Vec3 | null;
  /** The last open position before the blast: the blast's shield seat hint. */
  lastOpen: Vec3;
  /** 'body' when a body test fired, 'flight' for an impact or the fuse. */
  cause: 'body' | 'flight' | null;
}

/**
 * Advance one grenade by `dt` (clamped to GRENADE.maxStepSec) in the flight's
 * own 120 Hz sub-steps, against `world` (the grenade's radius is applied), with
 * `hitsBody(from, to)` asked about every sub-step's segment. A detonated state
 * stays put. Pure when `hitsBody` is.
 */
export function stepGrenade(
  s: FlightState,
  dt: number,
  world: FlightWorld,
  hitsBody: (from: Vec3, to: Vec3) => boolean,
): GrenadeStep {
  let state = s;
  let lastOpen: Vec3 = s.pos;
  if (state.detonated) return { state, boom: state.pos, lastOpen, cause: 'flight' };
  const w: FlightWorld = { ...world, bundleRadiusM: GRENADE.radiusM };
  let remaining = Math.min(Math.max(0, dt), GRENADE.maxStepSec);
  while (remaining > 1e-9 && !state.detonated) {
    const sub = Math.min(remaining, FLIGHT_TUNING.subStepSec);
    remaining -= sub;
    const from = state.pos;
    lastOpen = from;
    state = stepFlight(state, sub, null, w);
    if (hitsBody(from, state.pos)) return { state, boom: state.pos, lastOpen, cause: 'body' };
  }
  return state.detonated
    ? { state, boom: state.pos, lastOpen, cause: 'flight' }
    : { state, boom: null, lastOpen, cause: null };
}
