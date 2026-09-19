// src/lab/sdf-zombie/webgpu/fire-volume-pack.ts
//
// PACKS THE VOLUMETRIC FIRE FIELD's per-frame sources (burning-feedback round 2,
// task 4b). Pure and allocation-free after boot: the host keeps one preallocated
// Float32Array and passes it back every frame, so the render loop allocates
// nothing. The layout is the contract the march WGSL reads, and the lag formula
// below is mirrored in that WGSL (the string test pins them together).

import type { Vec3 } from '../types';
import type { FireCapsule } from './fire-capsules';
import { FIRE_VOLUME_TUNING } from './fire-volume-tuning';

/** Bodies the field carries; beyond this, a body gets cards only. */
export const FIRE_VOLUME_MAX_BODIES = 8;
/** Floats per capsule: a.xyz, radius, b.xyz, burn, vel.xyz, pad. */
export const FIRE_CAPSULE_STRIDE = 12;
/** Capsule slots in the preallocated buffer. */
export const FIRE_VOLUME_MAX_CAPSULES = FIRE_VOLUME_MAX_BODIES * 16;

/** One body's contribution to the field. */
export interface FireVolumeBody {
  capsules: readonly Pick<FireCapsule, 'a' | 'b' | 'radius'>[];
  /** Midpoint velocity per capsule (capsuleVelocities' output). */
  velocities: readonly Vec3[];
  /** 0..1 burn level; <= 0 is dropped. */
  burn: number;
  /** World centre used for the nearest-first ranking. */
  centre: Vec3;
}

export interface FireVolumePack {
  /** The Float32Array holding the capsules (the caller's `out` when given). */
  readonly data: Float32Array;
  /** Capsules written. */
  readonly capsuleCount: number;
  /** Bodies accepted (burn > 0, within the max). */
  readonly bodyCount: number;
  /** AABB around every accepted capsule, padded for the rise. */
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
}

/**
 * Trailing offset for a sample `height` metres above a source moving at `vel`:
 * `-vel * lag * height`, length-clamped to `maxM`. Zero height (a sample at the
 * source) never moves. The WGSL march implements the identical formula.
 */
export function fireLagOffset(vel: Vec3, height: number, lag: number, maxM: number): Vec3 {
  const h = Math.max(0, height);
  let x = -vel[0] * lag * h;
  let y = -vel[1] * lag * h;
  let z = -vel[2] * lag * h;
  const len = Math.hypot(x, y, z);
  if (len > maxM && len > 1e-6) {
    const k = maxM / len;
    x *= k; y *= k; z *= k;
  }
  return [x, y, z];
}

function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Rank the burning bodies nearest-first, pack their capsules into `out` (or a
 * fresh buffer when omitted), and return the buffer plus the AABB the march
 * intersects. The bounds are padded SIDEWAYS by the capsule radius PLUS the
 * flame's own reach (coreR) and the smoke column's widening, and upward by
 * `rise + sootRise`. Round 2b added the reach padding: without it a fatter
 * flame (coreR > the capsule radius) was CLIPPED by the AABB and read as a
 * hard-edged box, which is why raising coreR changed nothing on screen.
 */
export function packFireVolume(
  bodies: readonly FireVolumeBody[],
  eye: Vec3,
  out?: Float32Array,
  tuning: { rise: number; sootRise: number; coreR?: number; smokeSpread?: number } = FIRE_VOLUME_TUNING,
): FireVolumePack {
  const data = out ?? new Float32Array(FIRE_VOLUME_MAX_CAPSULES * FIRE_CAPSULE_STRIDE);
  const coreR = Math.max(0, tuning.coreR ?? 0.15);
  const smokeSpread = Math.max(0, tuning.smokeSpread ?? 0);
  // The smoke's radial falloff widens with height above 0.4*rise; pad to where
  // it has faded to a few percent of its peak (3 e-foldings of the widest
  // denominator). At 1.5 the column hit the AABB side and cut a hard vertical
  // seam down the plume (visible in the first shipping capture).
  const smokeReach = 3.0 * smokeSpread * Math.max(0, tuning.sootRise - 0.4 * tuning.rise);
  const sidePad = coreR + smokeReach;
  // Rank by squared distance to the eye; the stable index tiebreak keeps two
  // equidistant bodies in a deterministic order.
  const ranked = bodies
    .map((b, i) => ({ b, i }))
    .filter(x => x.b.burn > 0)
    .sort((x, y) => distanceSq(x.b.centre, eye) - distanceSq(y.b.centre, eye) || x.i - y.i)
    .slice(0, FIRE_VOLUME_MAX_BODIES);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let capsuleCount = 0;
  let write = 0;
  for (const { b } of ranked) {
    for (let ci = 0; ci < b.capsules.length; ci++) {
      if (capsuleCount >= FIRE_VOLUME_MAX_CAPSULES) break;
      const c = b.capsules[ci]!;
      const v = b.velocities[ci] ?? [0, 0, 0];
      data[write] = c.a[0];
      data[write + 1] = c.a[1];
      data[write + 2] = c.a[2];
      data[write + 3] = c.radius;
      data[write + 4] = c.b[0];
      data[write + 5] = c.b[1];
      data[write + 6] = c.b[2];
      data[write + 7] = b.burn;
      data[write + 8] = v[0];
      data[write + 9] = v[1];
      data[write + 10] = v[2];
      data[write + 11] = 0;   // pad (round 3: body smoke)
      write += FIRE_CAPSULE_STRIDE;
      capsuleCount++;
      const r = c.radius + sidePad;
      // Capsule endpoints with the reach as a sideways/downward pad; the rise
      // pad goes only upward (fire climbs, it does not sink).
      for (const p of [c.a, c.b]) {
        if (p[0] - r < minX) minX = p[0] - r;
        if (p[0] + r > maxX) maxX = p[0] + r;
        if (p[1] - r < minY) minY = p[1] - r;
        if (p[2] - r < minZ) minZ = p[2] - r;
        if (p[2] + r > maxZ) maxZ = p[2] + r;
        const top = p[1] + sidePad + tuning.rise + tuning.sootRise;
        if (top > maxY) maxY = top;
      }
    }
  }
  if (capsuleCount === 0) {
    return { data, capsuleCount: 0, bodyCount: 0, boundsMin: [0, 0, 0], boundsMax: [0, 0, 0] };
  }
  return {
    data, capsuleCount, bodyCount: ranked.length,
    boundsMin: [minX, minY, minZ], boundsMax: [maxX, maxY, maxZ],
  };
}
