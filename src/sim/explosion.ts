// src/sim/explosion.ts
import { fpFromMeters, fpToMeters } from './fp';
import type { SimAABB } from './geometry';
import type { PlayerState } from './player';
import type { SimRng } from './rng';

// EXPLOSION_STANDARD (ports tuning.ts): radius 150 BU, scaled for spatial feel.
// Mirror the legacy GibSystem: radiusM = (150/256) * RADIUS_SCALE_FACTOR(8) ≈ 4.69 m.
const RADIUS_FP = fpFromMeters((150 / 256) * 8);
const GROUND_THRESHOLD_FP = fpFromMeters(0.6); // matches GROUND_BURST_THRESHOLD_M
const PLAYER_MAX_DAMAGE = 240; // point-blank (matches DAMAGE_TICK_STACK feel)

/** Air vs ground by floor proximity. floorDistFp = blast Y above the floor; the
 *  arena floor is y=0, so for the flat arena this is just the blast's y. (Kept as
 *  a function so a future multi-floor sim-geometry can do a real downward query.) */
export function isAirBurstFp(_x: number, y: number, _z: number, _geo: SimAABB[]): boolean {
  return y > GROUND_THRESHOLD_FP;
}

/** Deterministic explosion damage to the player (the only sim-resident target this
 *  slice). Linear falloff to the radius edge. `rng` reserved for any future
 *  variance roll (kept in the signature so the harness exercises the RNG path).
 *
 *  NOTE — cross-platform determinism: the falloff uses float meters
 *  (Math.hypot/division) to compute the scalar before writing integer `hp`.
 *  This is deterministic WITHIN a single JS engine (all current peers), but if a
 *  native client or a different JS engine is ever added as a lockstep peer, move
 *  the falloff to integer fp arithmetic to guarantee identical `hp` across
 *  platforms. */
export function applyExplosionToPlayer(
  p: PlayerState, ex: number, ey: number, ez: number, rng: SimRng,
): void {
  void rng;
  const dx = fpToMeters(p.x - ex), dy = fpToMeters(p.y - ey), dz = fpToMeters(p.z - ez);
  const dist = Math.hypot(dx, dy, dz);
  const radiusM = fpToMeters(RADIUS_FP);
  if (dist >= radiusM) return;
  const falloff = 1 - dist / radiusM;
  p.hp -= Math.round(PLAYER_MAX_DAMAGE * falloff);
}
