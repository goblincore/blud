// src/lab/sdf-zombie/melt.ts
//
// MELT — the zombie liquefies where it stands. Pure: no Date.now, no
// Math.random; identical (state, dt) sequences produce identical states,
// because scripts/melt-capture.mjs steps this frame by frame and its gate
// compares runs.
//
// THE MODEL, and why it is shaped this way (spec
// docs/superpowers/specs/2026-09-03-zombie-melt-design.md):
//
// SAG IS PER-ENDPOINT, NOT PER-PRIM. Every prim is a capsule with two
// endpoints. Giving each endpoint its own progress makes capsules STRETCH as
// the lower end drops away from the upper — arms draw out into strands, the
// torso elongates as the pelvis goes first. Sagging whole prims instead
// slides a rigid body downward, which is a different and much worse effect.
//
// DESCENT IS PACED BY HEIGHT, NOT BY LIMB. A "melt front" rises through the
// body; an endpoint melts as the front reaches it. That is what makes this a
// candle (the feet liquefy and the torso settles onto the puddle) rather than
// a lift (the whole body descending together). The front leads past 1 so the
// crown still reaches full melt by progress 1.
//
// This module owns the SCHEDULE. The prim transform is applyMelt (task 2) and
// the bone release is melt-bones.ts (task 5); both read endpointProgress.

export interface MeltTuning {
  /** Progress per second. 0.625 ≈ 1.6s to full — the spec's timing. */
  rate: number;
  /**
   * How far past the top of the body the melt front travels by progress 1.
   * Must exceed 1 + softness or the crown never finishes: the front has to
   * clear the tallest endpoint by a full softness band.
   */
  frontLead: number;
  /**
   * Height band, in normalised body heights, over which an endpoint goes from
   * untouched to fully melted. Wide fuses neighbours into one flowing mass;
   * narrow reads as a hard scan line moving up the body.
   *
   * 0.65, not 0.45 (task 7 tuning pass): at 0.45 the transition band was
   * barely one prim tall, so the mid-ramp body read as a STACK OF DISCRETE
   * BLOBS — a totem of meatballs standing on the puddle — and the crown did
   * not begin to move until t≈0.65, so the head sat intact on top of a
   * dissolving body. At 0.65 the band covers ~2 prim heights: neighbours
   * flow together and the crown starts descending at t≈0.57, which is what
   * makes the silhouette shorten like a candle instead of unstacking.
   */
  softness: number;
}

export const MELT_TUNING: MeltTuning = {
  // 0.5 (2 s), not 0.625 (owner, 2026-11-14, in the game: it all happened too fast to read). The drip stagger
  // (MeltBodyTuning) also runs every prim a little ahead of the front, which shortened the visible melt further.
  rate: 0.5,
  // 1.75 = 1 + softness + 0.1: the front must clear the crown by a full
  // band or the head never finishes, and the small margin keeps the last
  // 5% of the ramp from being a head-only crawl.
  frontLead: 1.75,
  softness: 0.65,
};

export interface MeltState {
  /** Overall progress 0..1. Frozen at exactly 1. */
  t: number;
  /** Normalised rest height (0 = floor, 1 = tallest endpoint) per endpoint. */
  heights: readonly number[];
  /** The normalisation itself, kept so LATECOMERS can be measured on the
   *  same scale: organs (task 7) are not in the flesh prim array, but the
   *  melt front must reach them at the same ABSOLUTE time it reaches the
   *  torso they live in — normalising them by their own span would melt
   *  them on their own clock, ahead of the flesh around them. */
  floorY: number;
  span: number;
  tuning: MeltTuning;
}

/**
 * @param restY   World-space rest Y of every endpoint, in the index order the
 *                caller will use for the rest of the melt.
 * @param floorY  The floor the body melts onto.
 */
export function meltInit(
  restY: readonly number[],
  floorY: number,
  tuning: MeltTuning = MELT_TUNING,
): MeltState {
  let top = 0;
  for (const y of restY) top = Math.max(top, y - floorY);
  // A zero-height body would divide by zero; 1 makes every height 0, i.e. the
  // whole body melts at once, which is the only sane degenerate answer.
  const span = top > 1e-6 ? top : 1;
  return {
    t: 0,
    heights: restY.map(y => (y - floorY) / span),
    floorY,
    span,
    tuning,
  };
}

export function stepMelt(s: MeltState, dt: number): MeltState {
  if (s.t >= 1) return s; // frozen — idempotent, per the spec's freeze
  const t = Math.min(1, s.t + s.tuning.rate * dt);
  return { ...s, t };
}

/** 0..1 melt of one endpoint. Monotonic in t; low endpoints lead high ones. */
export function endpointProgress(s: MeltState, index: number): number {
  const h = s.heights[index] ?? 0;
  const front = s.t * s.tuning.frontLead;
  const u = (front - h) / s.tuning.softness;
  return smoothstep(clamp01(u));
}

/** endpointProgress for an arbitrary normalised height (applyMelt's drip offsets). */
export function progressAt(s: MeltState, h: number): number {
  return smoothstep(clamp01((s.t * s.tuning.frontLead - h) / s.tuning.softness));
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Hermite ease. Zero slope at both ends, so the melt starts and stops soft. */
export function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

// ——— THE PRIM TRANSFORM (task 2) ————————————————————————————————————————

import type { Primitive, Vec3 } from './types';

export interface MeltBodyTuning {
  /** Y the pooled goo settles at. A puddle has depth; zero reads as a decal.
   *  0.09 rather than 0.085: the largest pooled radius×crushed-scaleY reaches
   *  ~0.069 (the head blob), and the pool plane must sit above that or pooled
   *  bottoms dip below the floor and the AABB transiently grows mid-ramp. */
  poolHeight: number;
  /** yScale at full melt. 0.22 is a disc that still has a top surface; it was
   *  0.25 until the pixel gate's centroid ratio landed at 0.24-0.25 against a
   *  0.25 threshold — one verlet-settle wobble from red. */
  crush: number;
  /** Metres pushed outward from the body's vertical axis at full melt. */
  spread: number;
  /**
   * blendK at full melt. The authored flesh runs 0.007–0.02, and the march's
   * smin scales k by 4 internally (march.wgsl.ts:878 — "a cluster still
   * bends the surface from 4x the authored blendK away"). The plan's first
   * guess of 0.11 was therefore ~0.44 m of blend support per prim and the
   * union ballooned into one blob metres wide (Task 3's captures).
   *
   * 0.035, not 0.045 (task 6): with every prim crushed onto ONE plane and
   * radius-doubled, the chained smin bulge COMPOUNDS — at 0.045 the CPU
   * field mirror (validate.sdBody) measured the pooled surface at ±1.04 m
   * where the prim AABB ends at ±0.58 m, and the pixel gate read 3.04x
   * against its 3.00 ceiling. 0.035 puts the field at ±0.89 m (≈2.5x) —
   * still ~0.3 m of bulge past the prim edge, which is what keeps the
   * puddle ONE fused surface instead of a heap of sausages.
   */
  fuseK: number;
  /**
   * Fuse for HEAD prims specifically. The head is a handful of small prims —
   * cranium, jaw, brow, nose — and per-endpoint sag pulls them apart faster
   * than the body's fuse can hold them together, so at t ~= 0.65 one drooping
   * mass became a STACK OF BALLS with the painted eyes stranded on the middle
   * one (owner review, watching it live). It needs its own number rather than
   * a global rise: raising fuseK for the whole body re-inflates the puddle,
   * which is the bug task 4 spent its Step 0 fixing.
   */
  headFuseK: number;
  /** Prim progress (0..1) at which blendK peaks at the fuse value (meltBlendK). */
  fusePeakU: number;
  /** blendK of a fully pooled prim (meltBlendK): small, so the pool's field does not balloon. */
  pooledK: number;
  /**
   * How uneven the puddle's edge is, 0..1: each prim's outward push is scaled
   * by 1 ± ragged on a hash of its index, so the pool runs further in some
   * directions than others instead of ending as a perfect disc. Deterministic
   * (no rng: the capture gate compares runs). 0 = the even disc.
   */
  ragged: number;
  /**
   * Exponent of the radius growth as a prim is crushed: r × shrink^-swell.
   * 0.5 keeps each prim's own volume (r² · yScale constant); lower is a
   * smaller pool. 0.3: see applyMelt.
   */
  swell: number;
  /**
   * DRIP (2026-11-14, owner: "the melty flesh needs to be more melty"). Three numbers that make the sag uneven:
   *  - stagger: each prim runs AHEAD of the front by up to this many body heights, on a hash of its index, so the
   *    body does not go down as one even band: parts droop while their neighbours still hold.
   *  - stretch: a prim's LOWER endpoint leads its upper one by this many body heights more, so capsules draw out
   *    into strands before they let go.
   *  - neck: how much a prim's cross-section thins at the middle of its own melt (0..1), on its x/z scale. The
   *    radius is left alone on purpose: the shader reads a prim's melt off its radius (melt.wgsl.ts).
   * All three only ever move a prim EARLIER, so everything still finishes by progress 1.
   */
  stagger: number;
  stretch: number;
  neck: number;
  /** The most a prim's two ends may be pulled apart vertically, as a multiple of its own length (or its width, when
   *  that is larger): past it the upper end lets go and follows the lower one down. Absent = no limit. */
  maxStretch?: number;
  /** Offsets every per-prim hash (the ragged edge, the stagger): a different number is a different-looking melt of
   *  the same body. Absent = 0. */
  seed?: number;
  /** Metres the pooled flesh leans to one side [x, z] (applied with the outward spread): the body pours off in a
   *  direction instead of pooling evenly round its feet. Absent = none. */
  lean?: readonly [number, number];
}

// 2026-11-14 RETUNE (game pass). The notes on the fields above record how the
// first numbers (poolHeight 0.09, crush 0.25, spread 0.16) were reached; they
// moved together when the pool stopped ballooning (meltBlendK): a thinner,
// wider pool with an uneven edge, shallow enough that the skeleton lies IN it
// rather than under it. poolHeight 0.07 is the lowest that keeps the "never
// grows taller" gate (melt-gate.test.ts): below it pooled bottoms dip under
// the floor mid-ramp.
export const MELT_TUNING_BODY: MeltBodyTuning = {
  poolHeight: 0.07,
  crush: 0.16,
  spread: 0.2,
  fuseK: 0.035,
  headFuseK: 0.085,
  fusePeakU: 0.55,
  pooledK: 0.008,
  ragged: 0.9,
  swell: 0.4,
  stagger: 0.18,
  stretch: 0.12,
  neck: 0.25,
  maxStretch: 1.5,
};

/**
 * WHERE the body melts: the vertical axis the goo spreads out from and the
 * floor it pools on. The lab's body stands on the origin at y = 0, which is
 * the default; a body anywhere else (the lab's wander, every body in the game)
 * must pass its own, or the spread pushes it away from the WORLD origin and
 * the pool settles at the world's y = 0.09 instead of on its own floor.
 */
export interface MeltFrame {
  x: number;
  z: number;
  floorY: number;
}

export const MELT_FRAME_ORIGIN: MeltFrame = { x: 0, z: 0, floorY: 0 };

/**
 * The frame of a body standing somewhere: the axis is the mean of its flesh
 * endpoints on the ground plane. Measure it on the UNMELTED prims (the posed
 * body before applyMelt), never on the melted ones — the ragged spread is not
 * symmetric, so an axis read back off its own output would creep.
 */
export function meltFrameOf(prims: readonly Primitive[], floorY: number): MeltFrame {
  let x = 0, z = 0, n = 0;
  for (const p of prims) {
    if (p.dead) continue;
    x += p.a[0] + p.b[0]; z += p.a[2] + p.b[2]; n += 2;
  }
  return n > 0 ? { x: x / n, z: z / n, floorY } : { x: 0, z: 0, floorY };
}

/** Per-prim 0..1 hash for the ragged edge. Index-keyed, so it is the same for
 *  the posed prims and the rest prims of one body (the noise anchor follows). */
export function meltHash(i: number): number {
  const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
}

/** Endpoint Y in the canonical order: prim i contributes 2i (a), 2i+1 (b). */
export function endpointHeights(prims: readonly Primitive[]): number[] {
  const out: number[] = [];
  for (const p of prims) { out.push(p.a[1]); out.push(p.b[1]); }
  return out;
}

/** meltInit for a real body — canonical endpoint order comes from the prims. */
export function meltInitBody(
  prims: readonly Primitive[],
  floorY: number,
  tuning: MeltTuning = MELT_TUNING,
): MeltState {
  return meltInit(endpointHeights(prims), floorY, tuning);
}

/**
 * Rest flesh prims in, melted flesh prims out. Never mutates the input, never
 * reorders (the fold order is load-bearing — see BuiltBody.prims), and never
 * sees a bone prim: bones live in BuiltBody.bonePrims and are handled by
 * melt-bones.ts.
 *
 * Scalar quantities (radius, scale, blendK) use the prim's MEAN endpoint
 * progress, while positions use each endpoint's OWN progress. That split is
 * what produces the stretch: a prim whose lower end has melted and whose
 * upper end has not gets pulled long while it is still only half-fused.
 */
export function applyMelt(
  prims: readonly Primitive[],
  s: MeltState,
  body: MeltBodyTuning = MELT_TUNING_BODY,
  frame: MeltFrame = MELT_FRAME_ORIGIN,
): Primitive[] {
  if (s.t <= 0) return prims.map(p => p);
  const seed = body.seed ?? 0;
  return prims.map((p, i) => {
    // Drip: this prim's lead on the front, and a little more for whichever of its ends hangs lower.
    const lead = body.stagger * meltHash(i + 71 + seed);
    const ha = s.heights[i * 2] ?? 0, hb = s.heights[i * 2 + 1] ?? 0;
    let ua = progressAt(s, ha - lead - (ha < hb ? body.stretch : 0));
    let ub = progressAt(s, hb - lead - (hb < ha ? body.stretch : 0));
    // IT LETS GO (owner, 2026-11-15, in bullet time: "the arms slough off in one big long tube"). A capsule whose
    // lower end has pooled while its upper end still hangs at the shoulder is a metre of pipe. Past maxStretch
    // times its own length the upper end is pulled down after the lower one: the flesh draws out a little, then
    // comes away as a lump and falls.
    if (body.maxStretch !== undefined) {
      const pool = frame.floorY + body.poolHeight;
      const ya = Math.min(p.a[1], lerp(p.a[1], pool, ua)), yb = Math.min(p.b[1], lerp(p.b[1], pool, ub));
      const len = Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]);
      const most = Math.max(len, p.radius * Math.max(p.scale[0], p.scale[2])) * body.maxStretch;
      const pull = (top: number, restTop: number, low: number, uTop: number) =>
        top - low > most && restTop > pool + 1e-6 ? Math.max(uTop, clamp01((restTop - (low + most)) / (restTop - pool))) : uTop;
      if (ya >= yb) ua = pull(ya, p.a[1], yb, ua); else ub = pull(yb, p.b[1], ya, ub);
    }
    const u = (ua + ub) / 2;
    // Thinnest half-way through its own melt, back to full width as it pools.
    const neck = 1 - body.neck * Math.sin(Math.PI * u) * (1 - u);
    const reach = body.spread * (1 + body.ragged * (meltHash(i + seed) * 2 - 1));
    const yScale = lerp(p.scale[1], p.scale[1] * body.crush, u);
    // r ∝ 1/sqrt(yScale) keeps r² · yScale constant — the crushed disc gets
    // wider by exactly what it lost in height. This is the whole reason the
    // puddle ends up broader than the body: the volume has to go somewhere.
    const shrink = yScale / (p.scale[1] || 1);
    // ...tempered by body.swell: the body's prims OVERLAP, so conserving each
    // one's volume separately over-counts the flesh and the fused pool came
    // out ~2 m across and deep enough to drown the skeleton lying in it.
    const swell = Math.pow(shrink || 1, -body.swell);
    return {
      ...p,
      a: meltPoint(p.a, ua, body.poolHeight, reach, frame, body.lean),
      b: meltPoint(p.b, ub, body.poolHeight, reach, frame, body.lean),
      radius: p.radius * swell,
      ...(p.radiusB !== undefined ? { radiusB: p.radiusB * swell } : {}),
      scale: [p.scale[0] * neck, yScale, p.scale[2] * neck] as Vec3,
      blendK: meltBlendK(p.blendK, p.limb === 'head' ? body.headFuseK : body.fuseK, body, u),
    };
  });
}

/**
 * A prim's blendK through the melt: up to the fuse while it sags (neighbours
 * flow into one mass), then back DOWN to `pooledK` as it reaches the floor.
 *
 * WHY IT COMES BACK DOWN. The march's smin compounds along the fold: every
 * prim within k of the surface pulls it out another k/4, and a finished pool
 * is ~60 prims crushed onto ONE plane, all within k of each other. Held at the
 * fuse value the pooled field ran out past a metre in every direction and the
 * visible "puddle" was simply the render proxy's outline (a square, until the
 * proxy was padded, then a 2 m slab that drowned the skeleton). Crushed discs
 * overlap without any help, so the pool needs almost no blend: at pooledK its
 * edge is the discs' own ragged union.
 */
export function meltBlendK(rest: number, fuse: number, body: MeltBodyTuning, u: number): number {
  const peak = body.fusePeakU;
  if (u <= peak) return lerp(rest, fuse, peak > 0 ? u / peak : 1);
  return lerp(fuse, body.pooledK, smoothstep((u - peak) / (1 - peak)));
}

/**
 * Drop one endpoint toward the pool and push it out from the body axis.
 *
 * The descent is CLAMPED to never rise: an endpoint already below poolHeight
 * (a foot resting under the puddle surface) stays where it stood rather than
 * being lifted up to the pool plane. Goo does not climb out of the floor.
 */
export function meltPoint(
  p: Vec3, u: number, poolHeight: number, spread: number,
  frame: MeltFrame = MELT_FRAME_ORIGIN,
  lean?: readonly [number, number],
): Vec3 {
  const y = Math.min(p[1], lerp(p[1], frame.floorY + poolHeight, u));
  // Outward from the body's own vertical axis (the frame's). A point exactly
  // on the axis has no direction to go, so it stays — which is correct: the
  // spine should pool where it stood.
  const dx = p[0] - frame.x, dz = p[2] - frame.z;
  const r = Math.hypot(dx, dz);
  // DOWN FIRST, OUT LATER (owner, 2026-11-14): the outward push only starts once the point is most of the way to
  // the floor. Pushed out on its whole progress, flesh on an outstretched arm slid ALONG the arm, away from the
  // body, instead of dropping off it.
  const out = smoothstep(clamp01((u - 0.6) / 0.4));
  const push = r > 1e-6 ? (spread * out) / r : 0;
  return [frame.x + dx * (1 + push) + (lean ? lean[0] * out : 0), y, frame.z + dz * (1 + push) + (lean ? lean[1] * out : 0)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ——— ORGANS (task 7) ———————————————————————————————————————————————————

/**
 * Organs melt WITH the flesh but at roughly HALF the sag rate, so they slop
 * out of the draining torso and are briefly visible as distinct shapes
 * before the goo takes them (spec: "the alternative — treating them as
 * ordinary flesh — means they are never seen at all"). They live in
 * BuiltBody.bonePrims beside the bones, but are soft: applyMelt never sees
 * them, and melt-bones.ts never releases them.
 *
 * THE LAG SCHEDULE. An organ state is the flesh state with its progress
 * remapped through t' = t · (rate + (1 − rate) · t): the melt front rises at
 * `rateScale`× the flesh rate at the start and catches up smoothly, so both
 * finish TOGETHER at t = 1. A flat half-rate clock would leave the organs
 * stranded at t = 0.5 forever — half-melted blobs hovering over the puddle.
 *
 * Heights are normalised against the FLESH body's span and floor (kept on
 * MeltState for exactly this), not the organs' own — the front must reach an
 * organ when it reaches the torso around it.
 */
export function applyMeltOrgans(
  prims: readonly Primitive[],
  s: MeltState,
  rateScale = 0.5,
  body: MeltBodyTuning = MELT_TUNING_BODY,
  frame?: MeltFrame,
): Primitive[] {
  if (s.t <= 0) return prims.map(p => p);
  const tOrg = s.t * (rateScale + (1 - rateScale) * s.t);
  // Heights are measured from the floor THESE prims stand on: the frame's when
  // one is given (a posed body in the game), else the flesh state's own.
  const floorY = frame ? frame.floorY : s.floorY;
  const organState: MeltState = {
    ...s,
    t: tOrg,
    heights: endpointHeights(prims).map(y => (y - floorY) / s.span),
  };
  return applyMelt(prims, organState, body, frame);
}

// ——— CLUSTERS (task 4, step 0b) ————————————————————————————————————————

import type { ClusterInfo } from './types';

/**
 * Re-fit each cluster's bounding sphere to the MELTED prims it owns.
 *
 * Clusters are not decoration: fit() sizes the render proxy box from these
 * spheres and the march culls prims against them, so a melted body carrying
 * rest-pose clusters is marched inside a box shaped like the body it used to
 * be — which is exactly the flat-topped cylinder Task 3 captured. id, limb,
 * start, count and alive are carried through untouched; only the sphere moves.
 */
/** Metres of smin bulge past a prim's own surface, per unit of its blendK. */
export const MELT_BULGE_PER_K = 9;

export function remeltClusters(
  clusters: readonly ClusterInfo[],
  prims: readonly Primitive[],
): ClusterInfo[] {
  return clusters.map(c => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = c.start; i < c.start + c.count; i++) {
      const p = prims[i];
      if (!p) continue;
      // PLUS THE FUSE'S BULGE. The march's smin bends the surface from 4x the
      // authored blendK away, and pooled prims chain it: the fused puddle's
      // field reaches ~0.3 m past its prims' own edge (fuseK's note). A box
      // fitted to the bare prims cut the puddle off square.
      const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]) + MELT_BULGE_PER_K * p.blendK;
      for (const e of [p.a, p.b]) {
        x0 = Math.min(x0, e[0] - r); x1 = Math.max(x1, e[0] + r);
        y0 = Math.min(y0, e[1] - r); y1 = Math.max(y1, e[1] + r);
        z0 = Math.min(z0, e[2] - r); z1 = Math.max(z1, e[2] + r);
      }
    }
    if (x1 < x0) return c; // empty cluster — leave it exactly as it was
    const centre: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    // The sphere must CONTAIN the box, so it is the half-diagonal, not the
    // half-width: a half-width sphere leaves the box corners outside it and
    // the march culls the very prims that moved furthest.
    const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
    return { ...c, center: centre, radius };
  });
}
