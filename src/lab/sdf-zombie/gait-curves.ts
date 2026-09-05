// src/lab/sdf-zombie/gait-curves.ts
//
// A stride SHAPE sampled from a reference clip: per-phase sagittal angles
// and a hip bob, normalised by leg length so proportions cancel. Produced
// once by scripts/gait-from-clip.ts (glb-clip.ts does the work) into
// gait-curves/<name>.ts; consumed by gait.ts's curve mode. Pure data.
export interface LegCurves {
  /** Thigh pitch forward from straight down (rad), per phase sample. */
  thigh: number[];
  /** Knee flexion (rad), 0 = straight, positive = bent. */
  knee: number[];
  /** Foot on the ground at this sample. */
  stance: boolean[];
}

export interface GaitCurves {
  name: string;
  /** Samples per cycle. Phase 0 = LEFT heel strike. */
  n: number;
  /** Stride cycles per second — 1 / clip duration. */
  freq: number;
  /** Stance foot's fore-aft travel relative to the hips per cycle, / leg length. */
  travel: number;
  /** Hips height minus the cycle mean, / leg length. */
  hipsY: number[];
  L: LegCurves;
  R: LegCurves;
}

/** Linear interpolation over a wrapping cycle; phase in [0, 1). */
export function sampleCurve(c: readonly number[], phase: number): number {
  const n = c.length;
  let p = phase - Math.floor(phase);
  const x = p * n;
  const i = Math.floor(x);
  const t = x - i;
  return c[i % n]! * (1 - t) + c[(i + 1) % n]! * t;
}

/** Nearest-sample lookup for the boolean stance track. */
export function sampleStance(s: readonly boolean[], phase: number): boolean {
  const n = s.length;
  const p = phase - Math.floor(phase);
  return s[Math.round(p * n) % n]!;
}

function lerpArr(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((v, i) => v + (b[i]! - v) * t);
}

/** Sample-wise lerp of two tables with the same n. Stance snaps at 0.5. */
export function blendCurves(a: GaitCurves, b: GaitCurves, t: number): GaitCurves {
  if (a.n !== b.n) throw new Error(`blendCurves: ${a.name} n=${a.n} vs ${b.name} n=${b.n}`);
  const near = t < 0.5 ? a : b;
  const leg = (x: LegCurves, y: LegCurves, z: LegCurves): LegCurves => ({
    thigh: lerpArr(x.thigh, y.thigh, t), knee: lerpArr(x.knee, y.knee, t), stance: z.stance.slice(),
  });
  return {
    name: `${a.name}~${b.name}`, n: a.n,
    freq: a.freq + (b.freq - a.freq) * t,
    travel: a.travel + (b.travel - a.travel) * t,
    hipsY: lerpArr(a.hipsY, b.hipsY, t),
    L: leg(a.L, b.L, near.L), R: leg(a.R, b.R, near.R),
  };
}
