// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-fit.ts
//
// FITTING THE ANATOMICAL SKULL TO A HEAD'S FLESH, in two stages. Pure: no renderer, no three (the release is a Rust
// port). Metres, in the head segment's frame: x across (the skull's own left is +x), y up, z out of the face.
//
// The skull is one mesh for every humanoid, and a head is whatever its character's flesh makes it. anatomical-skull.ts
// skullFitMatrix sizes the skull to fixed fractions of the head's BONE envelope, which is a loose box about the
// authored bone prims and says little about the flesh: on the zombie that skull has 0.56 of the sculpted skull's box
// volume, and a quarter of the flesh head's width on a head whose bone prims are narrow. The fit here reads the flesh
// itself (head-flesh.ts).
//
// STAGE 1, SIZE AND PLACE (skullAffineFit): a scale along each axis and a translation. The flesh head is measured
// along the three axes through its deepest point; the skull's box aims at `share` of that on each axis, with no axis
// scale more than `limit` times another (a skull squashed to a monster's proportions stops reading as a skull). The
// skull is held by the point midway between its orbits (SkullFitHold): on the head's middle plane, and with `eyes` on
// the head's eye line, so the face of the bone stays behind the face of the flesh whatever the size. It is slid to
// where its worst vertex is best off, and shrunk until no vertex needs more than its pull budget to get under the
// flesh: nothing at all with `pull` 0 (the best a plain affine fit can do), else what stage 2 may move. Each axis is
// then grown by itself as far as the flesh lets it, the width first.
//
// STAGE 2, KEEP IT UNDER THE FLESH (skullWarpPasses): where the sized skull comes within `margin` of the flesh
// surface, that region is pulled in. The pull is a displacement FIELD, a function of the place alone (skullWarpAt), so
//  - two vertices at one place move as one: a seam between plates and a UV split inside a plate stay closed;
//  - a plate's inner surface, a few millimetres under its outer one, moves with it: thickness is kept;
//  - the field has a Jacobian (skullWarpJacobian), and the authored normals are carried by it: a recomputed vertex
//    normal on the indexed mesh would open a shading seam at every UV split.
// A pass takes the worst offender of each small cell as an anchor, to move inward along the flesh's gradient until it
// has its margin; the field is the anchors' moves blended by a smooth falloff of `radius` (passAt). Passes repeat
// until every vertex has its margin: two to seven on the humanoids. Vertices further than the radius from any
// offender do not move, so the teeth and the jaw keep their shape where they have room. A vertex within the radius of
// one is carried with it: on the zombie the cheekbones and the nose move 6 to 10 mm with the forehead above them.
/** A point or a vector the fit may write to; `At` is one it only reads (types.ts Vec3 is that). */
export type V3 = [number, number, number];
type At = readonly [number, number, number];

/** The flesh's distance at a point of the head frame, metres: negative inside (head-flesh.ts HeadFlesh.distance). */
export type FleshField = (p: At) => number;

export interface SkullFitParams {
  /** The skull's box as a share of the flesh head's extent on each axis: what stage 1 aims at. */
  share: number;
  /** Flesh kept over every vertex, metres. */
  margin: number;
  /** The most one axis scale may be of another (largest / smallest). */
  limit: number;
  /** The most stage 2 may move a vertex of the vault (the cranium's plates), as a share of the skull's width. 0: no
   *  stage 2, and stage 1 keeps the margin by itself. */
  pull: number;
  /** The same for a vertex of the face (cheekbones, jaws, teeth, nose), whose shape is what reads as a skull. Both
   *  bound what a vertex LACKS when stage 1 is done, which is what stage 2 has to find for it; a vertex beside a
   *  needier one is carried further than its own lack. */
  facePull: number;
  /** The falloff radius of a pull, as a share of the skull's width. */
  radius: number;
  /** Hold the skull's orbits on the head's eye line (SkullFitHold.at) while it is sized. Without it the skull is put
   *  where it can be largest, which on a head that narrows to its crown is low: the face drops under the flesh's. */
  eyes: boolean;
}

/** The fits a head can be given by name (anatomical-skull.ts SKULL_FIT_NAMES adds 'envelope', the bone-envelope fit
 *  that needs no flesh).
 *  `affine`: stage 1 alone, 6 mm of flesh kept, placed freely: the largest the skull can be with no vertex moved.
 *  `mid`, `snug`, `tight`: both stages, the orbits held on the eye line, 10, 6 and 3 mm of flesh kept. 3 mm is the
 *  least the sculpted skulls keep; a skull the sculpt's size needs it. */
export const SKULL_FITS: Record<'affine' | 'mid' | 'snug' | 'tight', SkullFitParams> = {
  affine: { share: 0.92, margin: 0.006, limit: 1.15, pull: 0, facePull: 0, radius: 0.30, eyes: false },
  mid: { share: 0.88, margin: 0.010, limit: 1.15, pull: 0.10, facePull: 0.03, radius: 0.30, eyes: true },
  snug: { share: 0.92, margin: 0.006, limit: 1.15, pull: 0.10, facePull: 0.03, radius: 0.30, eyes: true },
  tight: { share: 0.95, margin: 0.003, limit: 1.15, pull: 0.10, facePull: 0.04, radius: 0.30, eyes: true },
};

/** Stage 1's result: a point p of the asset goes to scale * p + offset (per axis). */
export interface SkullAffine { scale: V3; offset: V3 }

/** One pass of stage 2: the falloff radius and the anchors, seven floats each: the place, the move wanted there, and
 *  the anchor's weight (one over the falloff's sum over all the pass's anchors at its place: where anchors crowd each
 *  counts for less, so the field's shape does not depend on how many there are). */
export interface SkullWarpPass { radius: number; anchors: Float64Array }
const ANCHOR = 7;

/** A row-major 3 x 3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** The flesh head as stage 1 measures it: its deepest point on the head's middle plane, and how far the flesh
 *  reaches from there along each axis (the lesser of the two sides across; up; down; forward; back). */
export interface FleshExtent { centre: V3; half: number; up: number; down: number; front: number; back: number }

const SLACK = 0.00025;
const MAX_PASSES = 40;

/** How far the flesh reaches from `from` along the unit `dir`, metres: stepped by the field, which never reads
 *  further than the surface is. */
function reach(flesh: FleshField, from: At, dir: At, limit = 1.5): number {
  let t = 0;
  const p: V3 = [0, 0, 0];
  for (let i = 0; i < 2000 && t < limit; i++) {
    p[0] = from[0] + dir[0] * t; p[1] = from[1] + dir[1] * t; p[2] = from[2] + dir[2] * t;
    const d = flesh(p);
    if (d >= 0) break;
    t += Math.max(-d, 0.0005);
  }
  return t;
}

/** Lower `cost` over `start` by a pattern search along `axes` (1: y, 2: z), steps from `from` metres down to 1 mm.
 *  `cost` is told the least found so far: a place that is already worse than that need not be costed to the end. */
function settle(cost: (c: V3, best: number) => number, start: At, axes: readonly number[] = [1, 2], from = 0.016): { at: V3; cost: number } {
  const at: V3 = [start[0], start[1], start[2]];
  let best = cost(at, Infinity);
  for (let step = from; step >= 0.001; step /= 2) {
    for (let moved = 0; moved < 6; moved++) {
      let better = false;
      for (const axis of axes) for (const sign of [1, -1]) {
        const tryAt: V3 = [at[0], at[1], at[2]];
        tryAt[axis] = tryAt[axis]! + sign * step;
        const c = cost(tryAt, best - 1e-7);
        if (c < best - 1e-7) { best = c; at[axis] = tryAt[axis]!; better = true; }
      }
      if (!better) break;
    }
  }
  return { at, cost: best };
}

/** Measure the flesh head about the middle plane x = `middle`, starting the search for its deepest point at `seed`.
 *  `floor`: the flesh is not followed below this height (the bone's own reach downward: a head's flesh that is not
 *  closed under the chin runs on into the neck). */
export function measureFlesh(flesh: FleshField, middle: number, seed: At, floor = -Infinity): FleshExtent {
  const centre = settle(c => flesh(c), [middle, seed[1], seed[2]]).at;
  return {
    centre,
    half: Math.min(reach(flesh, centre, [1, 0, 0]), reach(flesh, centre, [-1, 0, 0])),
    up: reach(flesh, centre, [0, 1, 0]),
    down: Math.min(reach(flesh, centre, [0, -1, 0]), centre[1] - floor),
    front: reach(flesh, centre, [0, 0, 1]),
    back: reach(flesh, centre, [0, 0, -1]),
  };
}

/** The points of `points` (xyz triples) that stand furthest from `centre` in their direction: one per cell of a
 *  latitude and longitude grid. Scaling the cloud about `centre` keeps the order along a direction, so these are the
 *  ones that meet the flesh first. Returns indices into the triples. */
export function outermost(points: ArrayLike<number>, centre: At, among?: ArrayLike<number>, rows = 10): number[] {
  const cols = rows * 2;
  const best = new Int32Array(rows * cols).fill(-1), far = new Float64Array(rows * cols);
  const count = among ? among.length : points.length / 3;
  for (let k = 0; k < count; k++) {
    const i = among ? among[k]! : k;
    const x = points[i * 3]! - centre[0], y = points[i * 3 + 1]! - centre[1], z = points[i * 3 + 2]! - centre[2];
    const r = Math.hypot(x, y, z);
    if (r < 1e-9) continue;
    const row = Math.min(rows - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, y / r))) / Math.PI * rows));
    const col = Math.min(cols - 1, Math.floor((Math.atan2(z, x) + Math.PI) / (2 * Math.PI) * cols));
    const cell = row * cols + col;
    if (r > far[cell]!) { far[cell] = r; best[cell] = i; }
  }
  return Array.from(best).filter(i => i >= 0);
}

export interface SkullAffineFit extends SkullAffine {
  /** The flesh head the fit was sized to. */
  flesh: FleshExtent;
  /** The scales stage 1 aimed at (share of the flesh, within the limit), before it shrank to fit. */
  aimed: V3;
  /** The pull budgets in metres: the vault's and the face's. */
  budget: [number, number];
}

/** Where the skull is held while it is sized: `x`, `y` are the point midway between the asset's orbits, in the
 *  asset's frame. Its x is put on the head's middle plane (the middle of the asset's box is not the middle of its
 *  face). With `at`, a height in the head frame, its y is put there, and the skull grows about its orbits: they stay
 *  on the head's eye line whatever the size. Without `at` the skull's height in the head is free. */
export interface SkullFitHold { x: number; y: number; at?: number }

/**
 * Stage 1. `points`: the asset's vertices (xyz triples); `face[i]`: vertex i belongs to a face plate; `box`: the
 * asset's bounds. `envelope`: the head's bone envelope, read for the middle plane and the floor only. `hold`: see
 * SkullFitHold; not given, the skull is held by the middle of its box, its height free.
 */
export function skullAffineFit(
  points: ArrayLike<number>, face: ArrayLike<number>, box: { min: At; max: At },
  flesh: FleshField, envelope: { min: readonly number[]; max: readonly number[] }, seed: At, params: SkullFitParams,
  hold?: SkullFitHold,
): SkullAffineFit {
  const size: V3 = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  // The point of the asset the fit scales about, and `centre` below is where it goes.
  const held = hold?.at !== undefined;
  const mid: V3 = [hold?.x ?? (box.min[0] + box.max[0]) / 2, held ? hold!.y : (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const free: readonly number[] = held ? [2] : [1, 2];
  const middle = (envelope.min[0]! + envelope.max[0]!) / 2;
  const head = measureFlesh(flesh, middle, seed, envelope.min[1]!);
  const want: V3 = [
    params.share * 2 * head.half / size[0], params.share * (head.up + head.down) / size[1], params.share * (head.front + head.back) / size[2],
  ];
  const least = Math.min(want[0], want[1], want[2]);
  const aimed = want.map(s => Math.min(s, least * params.limit)) as V3;
  const budget: [number, number] = [params.pull * aimed[0] * size[0], params.facePull * aimed[0] * size[0]];
  // The vertices that can be the worst: the outermost of the vault and of the face, each against its own budget. The
  // search reads a few hundred of them; the last check reads many more (every vertex, when there is no stage 2 to
  // catch what the search let through).
  const count = points.length / 3;
  const vault: number[] = [], faces: number[] = [];
  for (let i = 0; i < count; i++) (face[i] ? faces : vault).push(i);
  const outer = [...outermost(points, mid, vault), ...outermost(points, mid, faces)];
  const p: V3 = [0, 0, 0];
  /** Vertex i's want of flesh beyond its budget at this size and place, metres (<= 0: it is held). */
  const over = (i: number, scale: V3, centre: V3): number => {
    p[0] = centre[0] + (points[i * 3]! - mid[0]) * scale[0];
    p[1] = centre[1] + (points[i * 3 + 1]! - mid[1]) * scale[1];
    p[2] = centre[2] + (points[i * 3 + 2]! - mid[2]) * scale[2];
    return flesh(p) + params.margin - budget[face[i] ? 1 : 0];
  };
  /** The worst of `which`; it stops at the first vertex over `giveUp` and answers that (the worst is then at least
   *  it), and moves that vertex to the front: the next size or place is likely to be stopped by it too. */
  const excess = (scale: V3, centre: V3, which: number[], giveUp = Infinity): number => {
    let worst = -Infinity;
    for (let k = 0; k < which.length; k++) {
      const i = which[k]!, e = over(i, scale, centre);
      if (e > worst) worst = e;
      if (e > giveUp) { which[k] = which[0]!; which[0] = i; return e; }
    }
    return worst;
  };
  const scaled = (f: number): V3 => [aimed[0] * f, aimed[1] * f, aimed[2] * f];
  // Start in the middle of the measured flesh. Then, twice: place it where the worst vertex is best off, and take the
  // largest size at that place that holds.
  const middling: V3 = [middle, held ? hold!.at! : head.centre[1] + (head.up - head.down) / 2, head.centre[2] + (head.front - head.back) / 2];
  let centre: V3 = [middling[0], middling[1], middling[2]];
  let f = 1;
  for (let round = 0; round < 2; round++) {
    const placed = settle((c, best) => excess(scaled(f), c, outer, best), centre, free);
    centre = placed.at;
    if (placed.cost <= 0 && f === 1) break;
    let lo = 0.2, hi = f;
    if (placed.cost <= 0) lo = hi;
    else for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (excess(scaled(m), centre, outer, 0) <= 0) lo = m; else hi = m; }
    f = lo;
  }
  // The uniform size is held by its tightest axis. Grow each axis by itself as far as the limit and the flesh let
  // it, sliding along its own axis to where the room is. The width first, and past its share, up to the flesh's whole
  // width: a head is wider at the face than a skull sized by its cranium reaches, and the face's width is what is
  // seen through an opened head. Then the depth and the height, back toward what was aimed at.
  const scale = scaled(f);
  for (const axis of [0, 2, 1]) {
    const others = Math.min(scale[(axis + 1) % 3]!, scale[(axis + 2) % 3]!);
    const cap = Math.min(axis === 0 ? 2 * head.half / size[0] : aimed[axis]!, params.limit * others);
    if (cap <= scale[axis]! * 1.002) continue;
    let lo = scale[axis]!, hi = cap;
    for (let i = 0; i < 6; i++) {
      const tried: V3 = [scale[0], scale[1], scale[2]], size = (lo + hi) / 2;
      tried[axis] = size;
      const placed = settle((c, best) => excess(tried, c, outer, Math.max(best, 0)), centre, free.includes(axis) ? [axis] : [], 0.008);
      if (placed.cost <= 0) { lo = size; centre = placed.at; } else hi = size;
    }
    scale[axis] = lo;
  }
  // Where the worst vertex is best off is not where the skull sits best: with size to spare it slides down out of the
  // crown, where the head narrows. Of the places that hold, take the one nearest the middle of the flesh, on the line
  // back to it.
  if (excess(scale, middling, outer, 0) <= 0) centre = middling;
  else {
    let lo = 0, hi = 1;
    const toward = (t: number): V3 => [centre[0], centre[1] + (middling[1] - centre[1]) * t, centre[2] + (middling[2] - centre[2]) * t];
    for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (excess(scale, toward(m), outer, 0) <= 0) lo = m; else hi = m; }
    centre = toward(lo);
  }
  // The last check, over the vertices the search did not read.
  const checked = params.pull > 0 ? [...outermost(points, mid, vault, 40), ...outermost(points, mid, faces, 40)] : Array.from({ length: count }, (_, i) => i);
  const close = checked.filter(i => over(i, scale, centre) > -0.003);
  for (let i = 0; i < 60 && excess(scale, centre, close, 0) > 0; i++) for (let k = 0; k < 3; k++) scale[k] = scale[k]! * 0.997;
  return {
    scale, offset: [centre[0] - mid[0] * scale[0], centre[1] - mid[1] * scale[1], centre[2] - mid[2] * scale[2]],
    flesh: head, aimed, budget,
  };
}

/** The falloff of a pull at squared distance `r2` from its anchor, radius squared `R2`: 1 at the anchor, 0 with a
 *  flat approach at the radius. */
const falloff = (r2: number, R2: number): number => { const u = 1 - r2 / R2; return u <= 0 ? 0 : u * u * u; };

/** One pass's move at `p`, written into `out` (and, when `jac` is given, I + the move's gradient into it): the
 *  anchors' moves, each weighted by its falloff and its weight, over (1 + S^4)^(1/4) for S the sum of those weights.
 *  S is about one inside a patch of anchors and falls to nothing a radius outside it, so the move is near the
 *  anchors' mean inside and fades with the falloff's own profile, however many anchors the patch has. */
function passAt(pass: SkullWarpPass, p: At, out: V3, jac?: Mat3): void {
  const a = pass.anchors, R2 = pass.radius * pass.radius;
  let nx = 0, ny = 0, nz = 0, s = 0;
  // d(numerator)/dp, row-major, and d(sum)/dp.
  let g00 = 0, g01 = 0, g02 = 0, g10 = 0, g11 = 0, g12 = 0, g20 = 0, g21 = 0, g22 = 0, sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < a.length; i += ANCHOR) {
    const dx = p[0] - a[i]!, dy = p[1] - a[i + 1]!, dz = p[2] - a[i + 2]!;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= R2) continue;
    const u = 1 - r2 / R2, weight = a[i + 6]!, w = u * u * u * weight;
    const ux = a[i + 3]!, uy = a[i + 4]!, uz = a[i + 5]!;
    nx += w * ux; ny += w * uy; nz += w * uz; s += w;
    if (jac) {
      // grad w = -6 u^2 (p - a) / R^2
      const k = -6 * u * u * weight / R2, wx = k * dx, wy = k * dy, wz = k * dz;
      g00 += ux * wx; g01 += ux * wy; g02 += ux * wz;
      g10 += uy * wx; g11 += uy * wy; g12 += uy * wz;
      g20 += uz * wx; g21 += uz * wy; g22 += uz * wz;
      sx += wx; sy += wy; sz += wz;
    }
  }
  const s4 = s * s * s * s, den = Math.pow(1 + s4, 0.25);
  out[0] = nx / den; out[1] = ny / den; out[2] = nz / den;
  if (jac) {
    // d(n / den) = dn / den - n * den' * ds / den^2, den' = s^3 (1 + s^4)^(-3/4)
    const k = s * s * s * Math.pow(1 + s4, -0.75) / (den * den);
    jac[0] = 1 + g00 / den - nx * k * sx; jac[1] = g01 / den - nx * k * sy; jac[2] = g02 / den - nx * k * sz;
    jac[3] = g10 / den - ny * k * sx; jac[4] = 1 + g11 / den - ny * k * sy; jac[5] = g12 / den - ny * k * sz;
    jac[6] = g20 / den - nz * k * sx; jac[7] = g21 / den - nz * k * sy; jac[8] = 1 + g22 / den - nz * k * sz;
  }
}

const mul3 = (a: Mat3, b: Mat3): Mat3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

/** Where stage 2 takes the point `p` (already sized and placed): each pass in turn. */
export function skullWarpAt(passes: readonly SkullWarpPass[], p: At): V3 {
  const q: V3 = [p[0], p[1], p[2]], move: V3 = [0, 0, 0];
  for (const pass of passes) { passAt(pass, q, move); q[0] += move[0]; q[1] += move[1]; q[2] += move[2]; }
  return q;
}

/** The Jacobian of skullWarpAt at `p`: how a small step there is carried. */
export function skullWarpJacobian(passes: readonly SkullWarpPass[], p: At): Mat3 {
  const q: V3 = [p[0], p[1], p[2]], move: V3 = [0, 0, 0];
  let total: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const j: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const pass of passes) {
    passAt(pass, q, move, j);
    total = mul3(j, total);
    q[0] += move[0]; q[1] += move[1]; q[2] += move[2];
  }
  return total;
}

export const det3 = (m: Readonly<Mat3>): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

/** A normal `n` carried by the map whose Jacobian is `m`: the cofactor matrix times n (the inverse transpose, up to
 *  the determinant, which is positive for a map that turns nothing inside out), unit length. */
export function carryNormal(m: Mat3, n: At): V3 {
  const x = (m[4] * m[8] - m[5] * m[7]) * n[0] + (m[5] * m[6] - m[3] * m[8]) * n[1] + (m[3] * m[7] - m[4] * m[6]) * n[2];
  const y = (m[2] * m[7] - m[1] * m[8]) * n[0] + (m[0] * m[8] - m[2] * m[6]) * n[1] + (m[1] * m[6] - m[0] * m[7]) * n[2];
  const z = (m[1] * m[5] - m[2] * m[4]) * n[0] + (m[2] * m[3] - m[0] * m[5]) * n[1] + (m[0] * m[4] - m[1] * m[3]) * n[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/**
 * Stage 2. `points`: the sized and placed vertices (xyz triples, one per distinct place); they are not changed.
 * Returns the passes that take every one of them to at least `margin` under the flesh, and whether they got there
 * (`settled` false: the pass limit ran out, and the caller has to shrink).
 */
export function skullWarpPasses(
  points: ArrayLike<number>, flesh: FleshField, margin: number, radius: number, centre: At,
): { passes: SkullWarpPass[]; settled: boolean } {
  const count = points.length / 3;
  const at = Float64Array.from(points as ArrayLike<number>);
  const passes: SkullWarpPass[] = [];
  const p: V3 = [0, 0, 0], move: V3 = [0, 0, 0];
  const cell = radius / 4, h = 0.001;
  // What each vertex lacked when the field was last asked, and how far it has moved since. The field changes by no
  // more than the distance moved, so a vertex whose last lack and its travel do not reach zero has its margin still,
  // and is not asked again: after the first pass that is nearly all of them.
  const lack = new Float64Array(count).fill(Infinity), travel = new Float64Array(count);
  for (let round = 0; round <= MAX_PASSES; round++) {
    // The worst offender of each cell.
    const worst = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      if (lack[i]! + travel[i]! <= 0) continue;
      p[0] = at[i * 3]!; p[1] = at[i * 3 + 1]!; p[2] = at[i * 3 + 2]!;
      lack[i] = flesh(p) + margin; travel[i] = 0;
      if (lack[i]! <= 0) continue;
      const key = (Math.floor(p[0] / cell) + 512) * 1048576 + (Math.floor(p[1] / cell) + 512) * 1024 + Math.floor(p[2] / cell) + 512;
      const seen = worst.get(key);
      if (seen === undefined || lack[i]! > lack[seen]!) worst.set(key, i);
    }
    if (worst.size === 0) return { passes, settled: true };
    if (round === MAX_PASSES) break;
    const anchors = new Float64Array(worst.size * ANCHOR);
    let k = 0;
    for (const i of worst.values()) {
      const x = at[i * 3]!, y = at[i * 3 + 1]!, z = at[i * 3 + 2]!, here = lack[i]! - margin;
      // Inward: down the flesh's gradient. Where the field has none to speak of (a crease), toward the skull's centre.
      let gx = flesh([x + h, y, z]) - here, gy = flesh([x, y + h, z]) - here, gz = flesh([x, y, z + h]) - here;
      let g = Math.hypot(gx, gy, gz);
      if (g < 0.2 * h) { gx = x - centre[0]; gy = y - centre[1]; gz = z - centre[2]; g = Math.hypot(gx, gy, gz) || 1; }
      gx /= -g; gy /= -g; gz /= -g;
      // How far along that to go. The lack is a distance where the field is one, and the field of a squashed prim
      // falls slower than distance: step by the lack, look, and correct by the slope found (a secant), three times at
      // most. Never further than three lacks, nor than a third of the radius: a longer move would fold the mesh.
      const need = lack[i]! + SLACK, most = Math.min(3 * need, radius / 3);
      let t = Math.min(need, most), from = 0, left = need;
      for (let turn = 0; turn < 3 && t < most; turn++) {
        const still = flesh([x + gx * t, y + gy * t, z + gz * t]) + margin + SLACK;
        if (still <= 0) break;
        const slope = Math.max((left - still) / (t - from), 0.25);
        from = t; left = still;
        t = Math.min(t + still / slope, most);
      }
      anchors.set([x, y, z, gx * t, gy * t, gz * t, 1], k); k += ANCHOR;
    }
    // Each anchor's weight: one over the falloff's sum at its place.
    const R2 = radius * radius;
    for (let a = 0; a < anchors.length; a += ANCHOR) {
      let sum = 0;
      for (let b = 0; b < anchors.length; b += ANCHOR)
        sum += falloff((anchors[a]! - anchors[b]!) ** 2 + (anchors[a + 1]! - anchors[b + 1]!) ** 2 + (anchors[a + 2]! - anchors[b + 2]!) ** 2, R2);
      anchors[a + 6] = 1 / sum;
    }
    // Blended, an anchor's move is watered down by its neighbours' smaller ones. Strengthen each until the field
    // moves it as far as it wants, along its own direction: never weaken one, so a neighbour only ever follows.
    const want = Float64Array.from(anchors);
    for (let turn = 0; turn < 2; turn++) {
      const pass = { radius, anchors };
      const next = Float64Array.from(anchors);
      for (let a = 0; a < anchors.length; a += ANCHOR) {
        const wx = want[a + 3]!, wy = want[a + 4]!, wz = want[a + 5]!, w2 = wx * wx + wy * wy + wz * wz;
        p[0] = anchors[a]!; p[1] = anchors[a + 1]!; p[2] = anchors[a + 2]!;
        passAt(pass, p, move);
        const got = (move[0] * wx + move[1] * wy + move[2] * wz) / w2;
        const more = Math.min(Math.max(1 / Math.max(got, 1e-3), 1), 1.3);
        next[a + 3] = anchors[a + 3]! * more; next[a + 4] = anchors[a + 4]! * more; next[a + 5] = anchors[a + 5]! * more;
      }
      anchors.set(next);
    }
    const pass = { radius, anchors };
    passes.push(pass);
    for (let i = 0; i < count; i++) {
      p[0] = at[i * 3]!; p[1] = at[i * 3 + 1]!; p[2] = at[i * 3 + 2]!;
      passAt(pass, p, move);
      at[i * 3] = p[0] + move[0]; at[i * 3 + 1] = p[1] + move[1]; at[i * 3 + 2] = p[2] + move[2];
      travel[i] = travel[i]! + Math.hypot(move[0], move[1], move[2]);
    }
  }
  return { passes, settled: false };
}

/** One plate of the asset as the fit reads it. */
export interface SkullFitPlate { positions: ArrayLike<number>; normals: ArrayLike<number>; face: boolean }

export interface SkullFitResult {
  /** The fitted vertices and normals, plate by plate, in the plates' own vertex order. */
  positions: Float32Array[];
  normals: Float32Array[];
  affine: SkullAffineFit;
  passes: SkullWarpPass[];
  /** A uniform shrink about the skull's centre applied after stage 2 because its passes ran out (1: none). */
  shrunk: number;
  /** What stage 2 did: the furthest a vertex moved (m), the share of the vertices that moved more than 0.1 mm, and
   *  the least and greatest of the Jacobian's determinant over the vertices (1: volume kept; <= 0: turned inside
   *  out). */
  warp: { maxMove: number; moved: number; detMin: number; detMax: number };
  /** Wall time of the whole fit, milliseconds. */
  ms: number;
}

/**
 * Both stages over the asset's `plates`. `envelope`: the head's bone envelope (the middle plane, and the floor of the
 * flesh's measure); `seed`: where to start looking for the flesh head's deepest point; `hold`: skullAffineFit's.
 */
export function fitSkull(
  plates: readonly SkullFitPlate[], flesh: FleshField, envelope: { min: readonly number[]; max: readonly number[] }, seed: At,
  params: SkullFitParams, hold?: SkullFitHold,
): SkullFitResult {
  const t0 = performance.now();
  // One entry per distinct place: the field is asked once for it, and every vertex there is given the one answer.
  const index = new Map<string, number>();
  const places: number[] = [], faceOf: number[] = [];
  const slotOf = plates.map(plate => {
    const n = plate.positions.length / 3, slots = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const x = plate.positions[i * 3]!, y = plate.positions[i * 3 + 1]!, z = plate.positions[i * 3 + 2]!;
      const key = `${x},${y},${z}`;
      let slot = index.get(key);
      if (slot === undefined) { slot = places.length / 3; index.set(key, slot); places.push(x, y, z); faceOf.push(plate.face ? 1 : 0); }
      // A place shared by a face plate and a vault plate is held to the face's budget.
      else if (plate.face) faceOf[slot] = 1;
      slots[i] = slot;
    }
    return slots;
  });
  const count = places.length / 3;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < places.length; i++) { const k = i % 3; if (places[i]! < min[k]!) min[k] = places[i]!; if (places[i]! > max[k]!) max[k] = places[i]!; }
  const affine = skullAffineFit(places, faceOf, { min, max }, flesh, envelope, seed, params, hold);
  const sized = new Float64Array(places.length);
  for (let i = 0; i < places.length; i++) sized[i] = places[i]! * affine.scale[i % 3]! + affine.offset[i % 3]!;
  const centre: V3 = [0, 1, 2].map(k => (min[k]! + max[k]!) / 2 * affine.scale[k]! + affine.offset[k]!) as V3;
  let passes: SkullWarpPass[] = [], shrunk = 1;
  if (params.pull > 0) {
    const width = (max[0] - min[0]) * affine.scale[0];
    const warped = skullWarpPasses(sized, flesh, params.margin, params.radius * width, centre);
    passes = warped.passes;
    if (!warped.settled) shrunk = -1;
  }
  const fitted = new Float64Array(places.length);
  const jacobians: Mat3[] = [];
  const warp = { maxMove: 0, moved: 0, detMin: Infinity, detMax: -Infinity };
  for (let i = 0; i < count; i++) {
    const p: V3 = [sized[i * 3]!, sized[i * 3 + 1]!, sized[i * 3 + 2]!];
    const q = passes.length ? skullWarpAt(passes, p) : p;
    const j: Mat3 = passes.length ? skullWarpJacobian(passes, p) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    fitted.set(q, i * 3);
    const moved = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (moved > warp.maxMove) warp.maxMove = moved;
    if (moved > 0.0001) warp.moved++;
    const d = det3(j);
    if (d < warp.detMin) warp.detMin = d;
    if (d > warp.detMax) warp.detMax = d;
    // The whole map's Jacobian: the warp's times the scale.
    jacobians.push([j[0] * affine.scale[0], j[1] * affine.scale[1], j[2] * affine.scale[2], j[3] * affine.scale[0], j[4] * affine.scale[1],
      j[5] * affine.scale[2], j[6] * affine.scale[0], j[7] * affine.scale[1], j[8] * affine.scale[2]]);
  }
  warp.moved /= count;
  if (shrunk < 0) {
    // The passes ran out: shrink the warped skull about its centre until the margin holds.
    const holds = (f: number): boolean => {
      const p: V3 = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) p[k] = centre[k]! + (fitted[i * 3 + k]! - centre[k]!) * f;
        if (flesh(p) + params.margin > 0) return false;
      }
      return true;
    };
    shrunk = 1;
    while (shrunk > 0.3 && !holds(shrunk)) shrunk *= 0.99;
    for (let i = 0; i < fitted.length; i++) fitted[i] = centre[i % 3]! + (fitted[i]! - centre[i % 3]!) * shrunk;
  }
  const positions = plates.map((plate, k) => {
    const out = new Float32Array(plate.positions.length), slots = slotOf[k]!;
    for (let i = 0; i < slots.length; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = fitted[slots[i]! * 3 + c]!;
    return out;
  });
  const normals = plates.map((plate, k) => {
    const out = new Float32Array(plate.normals.length), slots = slotOf[k]!;
    for (let i = 0; i < slots.length; i++) out.set(carryNormal(jacobians[slots[i]!]!, [plate.normals[i * 3]!, plate.normals[i * 3 + 1]!, plate.normals[i * 3 + 2]!]), i * 3);
    return out;
  });
  return { positions, normals, affine, passes, shrunk, warp, ms: performance.now() - t0 };
}
