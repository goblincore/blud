// src/lab/sdf-zombie/blast-refraction.ts
//
// THE OPTICAL BLAST WAVE — pure scheduling math for the screen-space refraction
// band that post-aa.ts's blit draws.
//
// WHY THIS MODULE EXISTS (owner report 2026-09-16: "blastdistort=1 is
// indistinguishable from off"). The shader was never the problem; the FEED was.
// Two concrete defects, both measurable from the numbers before any strength
// increase was considered:
//
//   1. SIZE. The wave's world radius was `0.3 x burst.heightM` — 0.25 m for the
//      shipped burst, whose rendered half-height is ~0.83 m. The whole band
//      lived INSIDE the opaque fireball, so at the only radii it warped there
//      was no background left to bend. A refraction can only read where the
//      scene behind it is visible: the band must be BORN at the fireball's edge
//      and EXPAND past it.
//   2. LIFE + DECAY. 0.3 s with a squared decay left the band at 25% strength
//      by 0.15 s — gone before the fireball cleared. It now outlives the flash
//      and fades slowly, so the frame where the background becomes visible is
//      also a frame where the band is still real.
//
// The radius, its growth and the decay are computed HERE, in TS, and handed to
// the shader as plain uniform values each frame. That is deliberate:
//   * the projection and the waveform are testable on the CPU;
//   * the band is reprojected every frame from its WORLD position and a growing
//     WORLD radius, so a camera that moves during the wave's ~0.5 s life keeps
//     the band centred on the blast instead of on where the blast used to be.
//
// The shader keeps only the piece that cannot be precomputed: the radial
// waveform for the current pixel. `blastRefractionBand` mirrors it exactly.
import type { Vec3 } from './types';

export interface BlastRefractionTuning {
  /** Seconds the band lives. Must outlast the opaque flash (~0.3 s). */
  lifeSec: number;
  /** World radius at birth, as a multiple of the fireball's rendered
   *  half-height. Above 1 so the band starts OUTSIDE the opaque fireball. */
  birthRadiusK: number;
  /** Growth of the world radius by the end of life, as a multiple again. */
  growthK: number;
  /** Hard ceiling on the band's screen radius, in height fractions. */
  maxScreenRadius: number;
  /** Hard ceiling on the summed UV offset, as a fraction of the screen. */
  maxOffsetUv: number;
  /** Waveform exponent on sin(pi*x). 2 is a broad shell; 4 was a hairline. */
  bandPower: number;
  /** Peak UV offset at zero blast size, before the height term. */
  strengthBase: number;
  /** Additional peak UV offset per metre of fireball half-height. */
  strengthPerHeightM: number;
  /** Absolute cap on the peak UV offset, whatever the blast size. */
  strengthMax: number;
  /** Attack as a fraction of life: the band reaches full strength this fast. */
  attackFrac: number;
}

export const BLAST_REFRACTION: BlastRefractionTuning = {
  // 0.55 s, up from 0.3: the procedural fireball's life is `fxlife` (1.15 s)
  // but its bright opaque core is spent well before that, and the band has to
  // still be there when the background reappears behind it.
  lifeSec: 0.55,
  // 1.25: born a quarter of the fireball's half-height OUTSIDE its surface.
  // The old 0.3 was inside it, which is the whole defect.
  birthRadiusK: 1.25,
  // 2.0: the outer front ends at 3x the birth radius, so the band sweeps from
  // the fireball edge out through the surrounding room rather than staying put.
  growthK: 2.0,
  maxScreenRadius: 0.85,
  // 0.035 (up from 0.02): a wide shell at ~3.5% of the screen visibly bends a
  // background edge, while a near-camera blast still cannot smear the frame.
  maxOffsetUv: 0.035,
  // 2, not 4: sin(pi*x)^2 is a broad bump (half-max spans x 0.25..0.75, half
  // the band). The old sin^4 shell's half-max spanned only a third, and it
  // fell to a quarter of its peak an eighth of the way in, so it read as a
  // hairline against a background edge.
  bandPower: 2,
  strengthBase: 0.020,
  strengthPerHeightM: 0.012,
  strengthMax: 0.035,
  attackFrac: 0.10,
};

/** Seconds the band lives. */
export function blastRefractionLife(tuning: BlastRefractionTuning = BLAST_REFRACTION): number {
  return tuning.lifeSec;
}

/** World radius the band is born at, from the fireball's rendered half-height. */
export function blastRefractionBirthRadiusM(
  heightM: number,
  tuning: BlastRefractionTuning = BLAST_REFRACTION,
): number {
  const h = Number.isFinite(heightM) ? Math.max(0, heightM) : 0;
  return Math.max(0.2, h * tuning.birthRadiusK);
}

/**
 * Peak UV offset for a burst of this rendered half-height. Bounded three ways:
 * a floor so a degenerate burst still registers, a linear height term so a
 * bigger blast reads stronger, and a hard cap so no blast can become a
 * full-frame lens.
 */
export function blastRefractionStrength(
  heightM: number,
  tuning: BlastRefractionTuning = BLAST_REFRACTION,
): number {
  const h = Number.isFinite(heightM) ? Math.max(0, heightM) : 0;
  const raw = tuning.strengthBase + tuning.strengthPerHeightM * h;
  return Math.max(0, Math.min(tuning.strengthMax, raw));
}

export interface BlastRefractionPhase {
  /** Normalised age 0..1. */
  t: number;
  /** World-radius multiplier at this age: 1 at birth, 1 + growthK at the end. */
  radiusScale: number;
  /** Displacement multiplier at this age: fast attack, then a slow fade. */
  decay: number;
}

/**
 * The band's phase at `age`, or null once spent. Pure and monotonic in the
 * radius: the front only ever moves outward, and the decay only fades.
 *
 * The attack is a short ramp rather than an instant jump so the band does not
 * pop into existence at full offset on the same frame the blast lands — the
 * flash already carries that frame.
 */
export function blastRefractionPhase(
  age: number,
  tuning: BlastRefractionTuning = BLAST_REFRACTION,
): BlastRefractionPhase | null {
  if (!(tuning.lifeSec > 0) || !(age >= 0) || age >= tuning.lifeSec) return null;
  const t = age / tuning.lifeSec;
  const easeOut = 1 - (1 - t) * (1 - t) * (1 - t);
  const attack = tuning.attackFrac > 0 ? Math.min(1, t / tuning.attackFrac) : 1;
  return {
    t,
    radiusScale: 1 + tuning.growthK * easeOut,
    decay: attack * (1 - t),
  };
}

/**
 * The radial waveform, parameterised so `x = 1 - r/R`: 0 at the blast centre
 * (x=1) and at the outer front (x=0), 1 at the middle of the band. Outside the
 * band's own span it is exactly 0, so a pixel outside every live band is
 * untouched and the parity path stays bit-identical.
 *
 * `post-aa.ts`'s `postAaBlastWarp` mirrors this line; keep them in step.
 */
export function blastRefractionBand(
  x: number,
  tuning: BlastRefractionTuning = BLAST_REFRACTION,
): number {
  if (!(x > 0) || !(x < 1)) return 0;
  const s = Math.sin(Math.PI * x);
  return Math.pow(Math.max(0, s), tuning.bandPower);
}

/** The scalar UV displacement at band coordinate `x` for a peak `strengthUv`. */
export function blastRefractionOffset(
  x: number,
  strengthUv: number,
  tuning: BlastRefractionTuning = BLAST_REFRACTION,
): number {
  if (!(strengthUv > 0)) return 0;
  return strengthUv * blastRefractionBand(x, tuning);
}

export interface ProjectedPoint {
  /** Screen UV, 0..1, v up (the blit's pre-flip convention). */
  u: number;
  v: number;
  /** Clip-space w = distance-like view depth; <= 0 is behind the camera. */
  w: number;
}

/**
 * Clip-space projection of a world point with a column-major 4x4 view-projection
 * matrix (THREE.Matrix4.elements). Returns null for non-finite input or a point
 * at/behind the camera — never a mirrored point on the wrong side of the screen.
 */
export function projectBlastPoint(
  world: Vec3,
  viewProj: ArrayLike<number>,
): ProjectedPoint | null {
  const [x, y, z] = world;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const m = viewProj;
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!(cw > 1e-5) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { u: (cx / cw) * 0.5 + 0.5, v: (cy / cw) * 0.5 + 0.5, w: cw };
}

export interface ProjectedBlast {
  u: number;
  v: number;
  /** Screen radius as a fraction of the viewport HEIGHT (the blit's unit). */
  radiusUv: number;
}

/**
 * Project a blast's centre and its WORLD shell radius to screen. The radius is
 * analytic rather than a second projected point: for a symmetric perspective
 * projection `elements[5] = 1/tan(fovY/2)`, so a sphere of radius r at clip
 * depth w covers `0.5 * r * P[5] / w` of the viewport height — exact for the
 * no-roll FPS camera and, unlike projecting a fixed world offset, independent of
 * which way the camera is pitched.
 *
 * Returns null behind the camera. The caller applies the on-screen margin gate.
 */
export function projectBlastRefraction(
  world: Vec3,
  viewProj: ArrayLike<number>,
  worldRadiusM: number,
): ProjectedBlast | null {
  const p = projectBlastPoint(world, viewProj);
  if (!p) return null;
  const proj5 = Math.abs(viewProj[5] ?? 0);
  const r = Number.isFinite(worldRadiusM) ? Math.max(0, worldRadiusM) : 0;
  const radiusUv = Math.max(0.01, 0.5 * proj5 * r / p.w);
  return { u: p.u, v: p.v, radiusUv };
}
