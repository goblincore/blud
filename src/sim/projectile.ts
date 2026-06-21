// src/sim/projectile.ts
import { mulfp, fpFromMeters } from './fp';
import { bcos, bsin, BANGLE_FULL } from './trig';
import { TICS_PER_SEC } from './units';
import { stepThing, type ThingState } from './thing';
import type { SimAABB } from './geometry';
import type { SimEvent } from './types';
import { isAirBurstFp } from './explosion';

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

/** A thrown dynamite: a kThing with a fuse + impact behavior. */
export interface ProjectileState extends ThingState {
  fuseTics: number;
  fuseMaxTics: number;
  impactMode: boolean;          // detonate on geometry contact (after grace) vs pure fuse
  spawnTic: number;
  spawnX: number; spawnY: number; spawnZ: number;
}

// Safe-distance squared: must travel at least 0.7 m from spawn before impact-detonation
const _safe = fpFromMeters(0.7);
const IMPACT_SAFE_DIST_SQ_FP = _safe * _safe;

/** Advance all projectiles one tic; detonate (fuse out OR impact) → push explosion
 *  events. `tic` is the current SimState.tic. Mutates `projectiles`. */
export function stepProjectiles(
  projectiles: ProjectileState[],
  geo: SimAABB[],
  tic: number,
  out: SimEvent[],
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]!;
    p.fuseTics -= 1;
    const hitGeo = stepThing(p, geo);

    let detonate = p.fuseTics <= 0;
    if (!detonate && p.impactMode && (tic - p.spawnTic) >= THROW.impactGraceTics && hitGeo) {
      const dx = p.x - p.spawnX, dy = p.y - p.spawnY, dz = p.z - p.spawnZ;
      if (dx * dx + dy * dy + dz * dz >= IMPACT_SAFE_DIST_SQ_FP) detonate = true;
    }

    if (detonate) {
      const air = isAirBurstFp(p.x, p.y, p.z, geo);
      out.push({ kind: 'explosion', x: p.x, y: p.y, z: p.z, air });
      projectiles.splice(i, 1);
    }
  }
}

/** Spawn a thrown dynamite into the sim. */
export function spawnProjectile(
  projectiles: ProjectileState[], x: number, y: number, z: number,
  vel: ThrowVel, fuseTics: number, impactMode: boolean, tic: number,
): void {
  projectiles.push({
    x, y, z, vx: vel.vx, vy: vel.vy, vz: vel.vz,
    radius: fpFromMeters(0.08), elastic: 24576, resting: false,
    fuseTics, fuseMaxTics: fuseTics, impactMode,
    spawnTic: tic, spawnX: x, spawnY: y, spawnZ: z,
  });
}
