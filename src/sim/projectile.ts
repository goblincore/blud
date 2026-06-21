// src/sim/projectile.ts
import { mulfp, fpFromMeters } from './fp';
import { bcos, bsin, BANGLE_FULL } from './trig';
import { TICS_PER_SEC } from './units';

/** Throw tuning (ports DYNAMITE_COOK; tics instead of seconds). */
export const THROW = {
  lobAngle: Math.round((30 / 360) * BANGLE_FULL), // 30° lob in Blood units (≈171)
  fuseMaxTics: Math.round(1.5 * TICS_PER_SEC),    // 1.5 s (alt-fire / safety)
  impactGraceTics: Math.round(0.05 * TICS_PER_SEC),
  impactSafetyFuseTics: Math.round(5.0 * TICS_PER_SEC),
} as const;

export interface ThrowVel { vx: number; vy: number; vz: number; }

/**
 * Build the launch velocity (fp/tic) from aim, source-faithful to actFireThing:
 * horizontal direction from yaw, vertical from (pitch + upward lob). At yaw 0 the
 * forward axis is -Z (matching the player movement convention); +Y is up.
 * `speed` is the launch speed in fp/tic.
 *
 * Forward-axis derivation: at yaw 0, stepPlayer forward is -Z (wz uses -bcos(yaw)).
 * fwdX = bsin(yaw), fwdZ = -bcos(yaw) → at yaw 0: (0, -1) = -Z ✓; at yaw 512: (1, 0) = +X ✓.
 */
export function throwVelocity(yaw: number, pitch: number, speed: number): ThrowVel {
  const effPitch = pitch + THROW.lobAngle;       // upward lob on top of aim
  const horiz = bcos(effPitch);                  // 16.16 horizontal scale
  const vy = mulfp(speed, bsin(effPitch));       // vertical component
  const hs = mulfp(speed, horiz);
  const vx = mulfp(hs, bsin(yaw));
  const vz = mulfp(hs, -bcos(yaw));
  return { vx, vy, vz };
}
