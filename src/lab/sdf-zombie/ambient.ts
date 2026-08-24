/**
 * Analytic chromatic ambient — the CPU mirror of `AMBIENT_AT` in
 * `webgpu/ambient.wgsl.ts`.
 *
 * WHY THIS FILE EXISTS. Nothing in this repo compiles WGSL during tests, so
 * vitest cannot see a shader bug. The project's answer, established by the
 * march tracer, is to write the maths twice — once in WGSL for the GPU, once
 * here where it can be property-tested — and to pin the WGSL by source-string
 * tests so the two cannot drift silently. If you change one, change both, and
 * update the pins in `ambient.wgsl.test.ts`.
 *
 * THE MODEL. The enclosure is an axis-aligned box with six coloured walls.
 * For each wall we take the closest point on that wall's rectangle to the
 * shading point, treat it as a small light, and accumulate
 * `wallColour * max(dot(n, L), 0) / (1 + (dist/REF)^2)`. That is it: six
 * iterations of pure arithmetic, no field sampling.
 *
 * THE HARD CONSTRAINT. Zero `mapBody` evaluations, ever. Bounce is analytic
 * so that P1 can land without colliding with the raymarcher perf work in
 * flight. The WGSL twin is gated on this by an automated test, not by
 * discipline.
 *
 * THE HOUSE RULE. The accumulated bounce is renormalised to unit luminance
 * before use, so it contributes HUE ONLY and the shadow side keeps exactly
 * the level `fillIntensity` gave it. `practical-hard-key` is 2.4 key against
 * 0.06 fill; lifting that fill is what would spend the look the preset was
 * tuned for. `ambientGain` above 1 breaks the rule on purpose — that is the
 * control for testing whether the direction needs real radiosity lift.
 */

import type { Vec3 } from './types';

// Re-exported so the enclosure (and the panel) can reuse the one Vec3
// definition rather than declaring a second one.
export type { Vec3 };

/**
 * `Vec3` is `readonly [number, number, number]` — reuse it, do not declare a
 * second one. Accumulators below are plain mutable triples for that reason.
 */
type Mut3 = [number, number, number];

/** An axis-aligned enclosure, in world metres. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Linear-RGB albedo of each of the six walls. `posY` is the ceiling. */
export interface EnclosureWalls {
  negX: Vec3;
  posX: Vec3;
  negY: Vec3;
  posY: Vec3;
  negZ: Vec3;
  posZ: Vec3;
}

export interface AmbientOptions {
  /** 0 = flat fill exactly as before, 1 = fully chromatic. */
  probeWeight: number;
  /** Level multiplier once mixed. 1 honours "colour, not brightness". */
  ambientGain: number;
  /** Whether the +Y wall exists. An open-topped arena sets this false. */
  ceiling: boolean;
  /** The preset's `fillIntensity` — the level bounce must preserve. */
  fill: number;
  /** The preset's `keyColor` — what flat fill is tinted by today. */
  keyColor: Vec3;
}

/**
 * Distance at which a wall's contribution has fallen to half, in metres.
 * Tuned so a 4 m room reads as a room: at 1 m the near wall clearly leads,
 * at 3 m the walls even out into a general ambient.
 */
const REF_DIST = 1.6;

/** Rec.709 luminance — the same weights the shader uses. */
export function luminance(c: Vec3): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** One wall: an axis (0=x,1=y,2=z), a side (-1 or +1), and a colour. */
interface Wall {
  axis: 0 | 1 | 2;
  side: -1 | 1;
  color: Vec3;
}

function wallsOf(w: EnclosureWalls, ceiling: boolean): Wall[] {
  const all: Wall[] = [
    { axis: 0, side: -1, color: w.negX },
    { axis: 0, side: 1, color: w.posX },
    { axis: 1, side: -1, color: w.negY },
    { axis: 1, side: 1, color: w.posY },
    { axis: 2, side: -1, color: w.negZ },
    { axis: 2, side: 1, color: w.posZ },
  ];
  return ceiling ? all : all.filter((x) => !(x.axis === 1 && x.side === 1));
}

/**
 * The closest point to `p` on the rectangle of the given wall: clamp `p` into
 * the box on the two axes the wall spans, and pin the third to the wall plane.
 */
function closestOnWall(p: Vec3, box: Box, wall: Wall): Mut3 {
  const out: Mut3 = [
    Math.min(Math.max(p[0], box.min[0]), box.max[0]),
    Math.min(Math.max(p[1], box.min[1]), box.max[1]),
    Math.min(Math.max(p[2], box.min[2]), box.max[2]),
  ];
  out[wall.axis] = wall.side < 0 ? box.min[wall.axis] : box.max[wall.axis];
  return out;
}

/**
 * The chromatic ambient at a point, for a surface normal.
 *
 * Returns a linear-RGB colour that REPLACES the scalar `fillIntensity` term
 * in the shading expression. At `probeWeight === 0` it returns exactly
 * `fill * keyColor`, which makes the substitution algebraically identical to
 * the pre-bounce code — the parity guarantee the whole spike rests on.
 */
export function ambientAt(
  p: Vec3,
  n: Vec3,
  box: Box,
  walls: EnclosureWalls,
  opts: AmbientOptions,
): Vec3 {
  const flat: Mut3 = [
    opts.fill * opts.keyColor[0],
    opts.fill * opts.keyColor[1],
    opts.fill * opts.keyColor[2],
  ];
  // Exact early out. Not an optimisation — the parity test asserts equality
  // to 12 decimal places, which floating-point mixing would not survive.
  if (opts.probeWeight <= 0) return flat;

  const acc: Mut3 = [0, 0, 0];
  for (const wall of wallsOf(walls, opts.ceiling)) {
    const c = closestOnWall(p, box, wall);
    const dx = c[0] - p[0];
    const dy = c[1] - p[1];
    const dz = c[2] - p[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-5) continue;
    const ndl = Math.max((dx * n[0] + dy * n[1] + dz * n[2]) / dist, 0);
    if (ndl <= 0) continue;
    const t = dist / REF_DIST;
    const falloff = 1 / (1 + t * t);
    const w = ndl * falloff;
    acc[0] += wall.color[0] * w;
    acc[1] += wall.color[1] * w;
    acc[2] += wall.color[2] * w;
  }

  // COLOUR, NOT BRIGHTNESS. Renormalise the accumulation to unit luminance,
  // so what survives is purely its hue; the level then comes from `fill`,
  // exactly as it did before bounce existed. A black or unlit-from-every-
  // -angle room has no hue to offer and falls back to the flat term.
  const lum = luminance(acc);
  const tint: Mut3 = lum > 1e-5
    ? [acc[0] / lum, acc[1] / lum, acc[2] / lum]
    : [opts.keyColor[0], opts.keyColor[1], opts.keyColor[2]];

  const w = Math.min(Math.max(opts.probeWeight, 0), 1);
  // COLOUR, NOT BRIGHTNESS, taken literally: the level that survives is the
  // LUMINANCE of the flat term it replaces (`fill * keyColor`), so switching
  // probeWeight moves only hue and the shadow side stays exactly as dark as
  // it is today. `fill * luminance(keyColor)` is luminance(flat); scaling by
  // ambientGain is the deliberate escape hatch that lets bounce add lift.
  const g = opts.fill * luminance(opts.keyColor) * opts.ambientGain;
  return [
    flat[0] * (1 - w) + tint[0] * g * w,
    flat[1] * (1 - w) + tint[1] * g * w,
    flat[2] * (1 - w) + tint[2] * g * w,
  ];
}
