// src/lab/sdf-zombie/burn-flail.ts
//
// THE BURNING FLAIL, as a pure pose (spec 2026-11-16-burn-flail-and-death-design.md). A body on fire
// throws its arms overhead and beats at itself. This returns where each hand wants to be and how the
// trunk moves; motion.ts places the arms with solveElbow so no segment stretches.
//
// Hand targets are in SHOULDER coordinates, in units of the arm's full length:
//   [out, up, forward]   out = away from the body's midline (the same sign for both arms).
// Pure: no clock, no randomness beyond the seed.
import type { Vec3 } from './types';

export interface BurnFlailPose {
  handL: Vec3; handR: Vec3;
  /** Trunk pitch (rad, + forward) and side sway (rad, + toward the body's +X). */
  pitch: number; sway: number;
  /** Head toss (rad, + forward) about the neck. */
  headToss: number;
}

/** The hanging arm: slightly out, straight down. */
export const FLAIL_REST: Vec3 = [0.1, -0.95, 0];
/** Hands thrown up, in front of and above the head. */
const RAISED: Vec3 = [0.3, 0.72, 0.38];
/** One hand beating at the chest. */
const BEAT: Vec3 = [-0.05, -0.1, 0.5];
/** Both hands drawn in as the body gives out. */
const FOLDED: Vec3 = [-0.08, -0.28, 0.45];
const SWING: Vec3 = [0.4, 0.3, 0.28];
const REACH = 0.97;
const TAU = Math.PI * 2;

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** Hermite smoothstep of a 0..1 clamp: flat at both ends. */
const smooth01 = (v: number) => { const u = clamp01(v); return u * u * (3 - 2 * u); };
const mix = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
/** A stable 0..1 from a seed and a lane. */
function hash01(seed: number, lane: number): number {
  let x = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(lane + 1, 0x85ebca6b)) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
/** Two sines at incommensurate rates: -1..1, never periodic over a burn's length. */
const wave = (t: number, r1: number, r2: number, p: number) => 0.6 * Math.sin(t * r1 * TAU + p) + 0.4 * Math.sin(t * r2 * TAU + p * 1.7);

function hand(t: number, seed: number, lane: number, beat: number, a: number, f: number): Vec3 {
  const p = (k: number) => hash01(seed, lane * 8 + k) * TAU;
  const centre = mix(mix(RAISED, BEAT, beat), FOLDED, f);
  const live = 1 - 0.6 * f;
  const full: [number, number, number] = [
    centre[0] + SWING[0] * wave(t, 2.0, 3.2, p(0)) * live,
    centre[1] + SWING[1] * wave(t, 2.5, 3.7, p(1)) * live,
    centre[2] + SWING[2] * wave(t, 1.9, 2.9, p(2)) * live,
  ];
  // Folded hands stay below the shoulder line. The cap is blended in over the first fifth of the fold so the pose
  // is continuous in `fold`: switched on at the first non-zero fold it dropped a raised hand by up to a quarter arm.
  const w = smooth01(f / 0.2);
  if (w > 0) full[1] += (Math.min(full[1], 0.72 - 0.62 * f) - full[1]) * w;
  const h = mix(FLAIL_REST, full, a);
  const l = Math.hypot(h[0], h[1], h[2]);
  return l > REACH ? [h[0] * REACH / l, h[1] * REACH / l, h[2] * REACH / l] : h;
}

/**
 * @param t    seconds since the body caught fire
 * @param seed the body's seed
 * @param amp  0..1 flail amplitude (the clock's `flail` times the tier's)
 * @param fold 0..1 across falter: the arms come down to the chest and the trunk pitches forward
 */
export function burnFlailPose(t: number, seed: number, amp: number, fold: number): BurnFlailPose {
  const a = clamp01(amp), f = clamp01(fold);
  if (a === 0) return { handL: FLAIL_REST, handR: FLAIL_REST, pitch: 0, sway: 0, headToss: 0 };
  // A slow alternation: for a stretch one hand drops to beat at the chest, then the other.
  const s = Math.sin(t * 0.31 * TAU + hash01(seed, 99) * TAU);
  const beatL = Math.max(0, s) ** 2 * (1 - f), beatR = Math.max(0, -s) ** 2 * (1 - f);
  const pp = hash01(seed, 97) * TAU;
  return {
    handL: hand(t, seed, 0, beatL, a, f),
    handR: hand(t, seed, 1, beatR, a, f),
    pitch: a * (0.1 + 0.08 * wave(t, 1.3, 2.1, pp)) + f * 0.45,
    sway: a * 0.12 * wave(t, 1.1, 1.9, pp + 1.3) * (1 - 0.5 * f),
    headToss: a * 0.25 * wave(t, 1.7, 2.7, pp + 2.1) * (1 - f),
  };
}

/**
 * Two-bone solve: the elbow and hand for a shoulder, a wanted hand point and the two segment lengths.
 * The hand is pulled in to what the arm can reach; the elbow bends toward `pole` (any length).
 */
export function solveElbow(shoulder: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3): { elbow: Vec3; hand: Vec3 } {
  let dx = target[0] - shoulder[0], dy = target[1] - shoulder[1], dz = target[2] - shoulder[2];
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) { dx = 0; dy = -1; dz = 0; d = 1e-6; }
  const ux = dx / d, uy = dy / d, uz = dz / d;
  const dc = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, d));
  const along = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // The pole, made perpendicular to the arm line; a pole along the arm falls back to another axis.
  const perp = (p: Vec3): Vec3 | null => {
    const k = p[0] * ux + p[1] * uy + p[2] * uz;
    const v: Vec3 = [p[0] - ux * k, p[1] - uy * k, p[2] - uz * k];
    const l = Math.hypot(v[0], v[1], v[2]);
    return l < 1e-6 ? null : [v[0] / l, v[1] / l, v[2] / l];
  };
  const n = perp(pole) ?? perp([0, -1, 0]) ?? perp([1, 0, 0])!;
  return {
    elbow: [shoulder[0] + ux * along + n[0] * h, shoulder[1] + uy * along + n[1] * h, shoulder[2] + uz * along + n[2] * h],
    hand: [shoulder[0] + ux * dc, shoulder[1] + uy * dc, shoulder[2] + uz * dc],
  };
}
