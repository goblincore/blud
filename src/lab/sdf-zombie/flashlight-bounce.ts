/**
 * Flashlight bounce spot — the CPU side of the beam's lit patch as a disc light.
 *
 * WHY THIS FILE EXISTS. The flashlight is the game's dominant light and it
 * bounces nothing: a zombie's back in front of a lit wall stays black. Full
 * radiosity is out of scope, so this module collapses the beam's own footprint
 * on the level into ONE analytic disc light per frame. `computeBounceSpot`
 * casts the beam axis, finds the first thing it hits (an enclosure wall or an
 * occluder AABB), and turns that patch into a Lambertian emitter.
 * `bounceSpotIrradiance` then evaluates that disc at a shading point — the
 * term the march adds to its ambient.
 *
 * THE HOUSE PATTERN. The maths lives twice: here, where vitest can
 * property-test it, and in `webgpu/flashlight-bounce.wgsl.ts`, where it runs on
 * the GPU. The WGSL is pinned by source-text and parse-contract tests so the
 * two cannot drift silently. Change one, change both.
 *
 * MIRRORS MARCH_BODY_LIGHT. The beam falloff is copied from
 * `webgpu/march.wgsl.ts` (the `if (spotCfg.x > 0.0)` block): on the beam axis
 * `coneFall === 1`, so the irradiance at the patch is
 * `distFall^2 * intensity * keyGain * color * max(N.-axis, 0)` and the patch
 * RADIANCE is `albedo * E / pi` (Lambertian). `keyGain` is the march's
 * `spotCfg2.x`.
 *
 * ZERO FIELD EVALUATIONS. The patch is found with pure slab arithmetic against
 * a handful of AABBs — no SDF taps — so the CPU cost is constant per frame.
 *
 * hitAabbEntry and hitEnclosure are imported from probe-grid.ts (the P3 gather).
 * If/when `probe-grid.ts` gains `hitAabbEntry`, delete the local copy and
 * import it — `hitEnclosure` is already imported from there.
 */

import type { Box, EnclosureWalls, Vec3 } from './ambient';
import { hitEnclosure, hitAabbEntry } from './probe-grid';

/** `Vec3` is readonly; accumulators below are plain mutable triples. */
type Mut3 = [number, number, number];

/**
 * The pi literal shared with the WGSL twin. Kept as an exported number so the
 * pin test can assert the exact text appears in `FLASHLIGHT_BOUNCE_WGSL`.
 */
export const BOUNCE_PI_LITERAL = 3.141592653589793;

/** Occluder-hit albedo: a dark wooden crate, not a wall. */
const DEFAULT_OCCLUDER_ALBEDO: Vec3 = [0.35, 0.33, 0.3];

/** The beam uniforms the spot depends on — the march's spotCfg/spotCfg2. */
export interface BeamParams {
  /** Lamp position, inside the enclosure. */
  pos: Vec3;
  /** Beam direction (need not be normalised). */
  axis: Vec3;
  /** `spotCfg.x`: 0 disables the beam. */
  intensity: number;
  /** `spotCfg.y`: cosine of the inner cone half-angle. */
  cosInner: number;
  /** `spotCfg.z`: cosine of the outer cone half-angle. */
  cosOuter: number;
  /** `spotCfg.w`: beam range in metres. */
  range: number;
  /** `spotCfg2.x`: the beam's key gain. */
  keyGain: number;
  /** `spotColor`, linear RGB. */
  color: Vec3;
}

/** The beam's lit patch, treated as a Lambertian disc light. */
export interface BounceSpot {
  pos: Vec3;
  /** Outward patch normal, pointing back toward the beam. */
  normal: Vec3;
  /** Outgoing radiance of the patch, linear RGB. */
  radiance: Vec3;
  /** Disc radius in metres. */
  radius: number;
}

/** One ray's ENTRY into an occluder AABB from outside. */
interface OccluderHit {
  t: number;
  point: Vec3;
  normal: Vec3;
}

const AXES = [0, 1, 2] as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}


function insideBox(p: Vec3, box: Box): boolean {
  return (
    p[0] >= box.min[0] && p[0] <= box.max[0] &&
    p[1] >= box.min[1] && p[1] <= box.max[1] &&
    p[2] >= box.min[2] && p[2] <= box.max[2]
  );
}

/**
 * The beam's lit patch on the level, or null when the beam is off, out of
 * range, or fired from outside the enclosure.
 *
 * The hit is the nearest of `hitEnclosure` and every occluder's AABB entry.
 * Wall patches take the wall's albedo; occluder patches take the crate grey.
 */
export function computeBounceSpot(
  beam: BeamParams,
  box: Box,
  walls: EnclosureWalls,
  occluders: readonly Box[],
  /** Outdoor v1 §7: an open room — the top face, and walls above `above`, are sky
   *  (no bounce patch there). */
  open?: { above: number },
): BounceSpot | null {
  if (beam.intensity <= 0) return null;
  if (!insideBox(beam.pos, box)) return null;

  const axisLen = Math.hypot(beam.axis[0], beam.axis[1], beam.axis[2]);
  if (axisLen < 1e-12) return null;
  const dir: Vec3 = [beam.axis[0] / axisLen, beam.axis[1] / axisLen, beam.axis[2] / axisLen];

  let bestT = Infinity;
  let bestPoint: Vec3 | null = null;
  let bestNormal: Vec3 | null = null;
  let bestAlbedo: Vec3 | null = null;

  const enc = hitEnclosure(beam.pos, dir, box);
  const encIsSky = enc !== null && open !== undefined && enc.wall !== 'negY'
    && (enc.wall === 'posY' || enc.point[1] > open.above);
  if (enc !== null && !encIsSky) {
    bestT = enc.t;
    bestPoint = enc.point;
    bestNormal = enc.normal;
    bestAlbedo = walls[enc.wall];
  }

  for (const occ of occluders) {
    const oh = hitAabbEntry(beam.pos, dir, occ);
    if (oh !== null && oh.t < bestT) {
      bestT = oh.t;
      bestPoint = oh.point;
      bestNormal = oh.normal;
      bestAlbedo = DEFAULT_OCCLUDER_ALBEDO;
    }
  }

  if (bestPoint === null || bestNormal === null || bestAlbedo === null) return null;

  const dx = bestPoint[0] - beam.pos[0];
  const dy = bestPoint[1] - beam.pos[1];
  const dz = bestPoint[2] - beam.pos[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Mirror of MARCH_BODY_LIGHT: distFall = clamp(1 - dist / max(range, 1e-4)).
  const distFall = clamp(1 - dist / Math.max(beam.range, 1e-4), 0, 1);
  if (distFall <= 0) return null;

  // On the axis coneFall === 1, so the beam irradiance is distFall^2 * keyGain
  // * intensity * color * N.-axis.
  const ndl = Math.max(
    bestNormal[0] * -dir[0] + bestNormal[1] * -dir[1] + bestNormal[2] * -dir[2],
    0,
  );
  const e = distFall * distFall * beam.intensity * beam.keyGain * ndl;

  // Lambertian: the patch reflects albedo * E / pi.
  const radiance: Vec3 = [
    (bestAlbedo[0] * e * beam.color[0]) / BOUNCE_PI_LITERAL,
    (bestAlbedo[1] * e * beam.color[1]) / BOUNCE_PI_LITERAL,
    (bestAlbedo[2] * e * beam.color[2]) / BOUNCE_PI_LITERAL,
  ];

  const outerCos = clamp(beam.cosOuter, -1, 1);
  const radius = clamp(dist * Math.tan(Math.acos(outerCos)), 0.1, 3.0);

  return { pos: bestPoint, normal: bestNormal, radiance, radius };
}

/**
 * Irradiance at `p` for surface normal `n` from the bounce disc.
 *
 *   E = spotRadiance * pi * r^2 * max(N.L, 0) * max(spotNormal.-L, 0)
 *       / (d^2 + r^2)
 *
 * with `L` the unit vector from `p` toward the disc centre and `d` the
 * distance. Both cosines gate the term: a point behind the disc sees nothing,
 * as does a surface facing away. The `d^2 + r^2` denominator keeps the
 * irradiance finite as the point approaches the disc.
 */
export function bounceSpotIrradiance(p: Vec3, n: Vec3, spot: BounceSpot): Vec3 {
  const dx = spot.pos[0] - p[0];
  const dy = spot.pos[1] - p[1];
  const dz = spot.pos[2] - p[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Degenerate: at the disc centre the direction is undefined; the disc emits
  // no directional irradiance there.
  if (d < 1e-9) return [0, 0, 0];

  const lx = dx / d;
  const ly = dy / d;
  const lz = dz / d;

  const ndl = Math.max(n[0] * lx + n[1] * ly + n[2] * lz, 0);
  const snl = Math.max(spot.normal[0] * -lx + spot.normal[1] * -ly + spot.normal[2] * -lz, 0);

  const r = spot.radius;
  const k = (BOUNCE_PI_LITERAL * r * r * ndl * snl) / (d * d + r * r);

  return [spot.radiance[0] * k, spot.radiance[1] * k, spot.radiance[2] * k];
}
