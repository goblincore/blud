// src/lab/sdf-zombie/flesh-bits.ts
//
// FLYING FLESH CHUNKS (flail v1.5b, spec docs/superpowers/specs/2026-09-26-spike-flail-design.md §14.2;
// plan 2026-09-26-spike-flail.md Task 32). Owner: flesh should feel thicker and more visceral; every flail
// hit now throws a handful of small wet meat bits off the wound — torn meat with a flap of the zombie's own
// skin or a bead of fat on it, glossy, thrown along the blow and out of the wound, that splat and stay.
//
// Pure: world-space GorePieces (head-pop.ts) for the chunk system (game-main onGoreDispatch → spawnChunkPiece,
// tag 'flesh'); randomness comes in as a function. The LIFETIME and EVICTION rules the game leaf applies are
// here too, so they are tested:
//   * a flesh bit is never baked; it lives FLESH_BITS.lifeS, shrinking to nothing over the last shrinkS
//     (a baked bit would stay forever and each one would cost a worker bake + a slot in the bake ring,
//     which would push real gibs' baked meshes out first);
//   * at most FLESH_BITS.cap live at once: a new one over the cap removes the oldest flesh bit;
//   * a full chunk budget evicts live flesh first, then the oldest baked gib, then other live gibs, and a
//     snapped eye last — flesh can never evict an eye.
import { mulberry32 } from './melt-bones';
import { GORE_COLORS, type GorePiece } from './head-pop';
import type { Primitive, Vec3 } from './types';

export const FLESH_BITS = {
  /** Bits per hit: a body crater, a head hit (inclusive ranges); the overhead swing throws ×hMul. */
  body: [3, 5] as const,
  head: [5, 7] as const,
  hMul: 1.5,
  /** A head hit's size scale (fleshBits `scale`): bigger bits, and ×√scale faster. The plan's 1.5 threw 15 cm
   *  lenses that filled the view when one came at the camera (look loop 2026-09-29). */
  headScale: 1.3,
  /** The main meat gob's radius (m, ×scale); it is flattened (MEAT_SCALE) into a torn slab. The plan's 0.02–0.04
   *  read as dark specks at 1.5 m (flesh-body-strip look loop, 2026-09-29): up a centimetre. */
  size: [0.03, 0.05] as const,
  /** Launch speed (m/s, ×√scale). */
  speed: [2, 5] as const,
  /** The throw's axis: the blow's part along the skin, the wound's outward normal and world up; each bit
   *  leaves within `cone` (rad) of it. */
  blowW: 0.7,
  outW: 0.35,
  upW: 1.0,
  cone: 0.7,
  /** Spin (rad/s). */
  spin: [10, 30] as const,
  /** Floor and wall bounce: wet meat splats and stays. */
  restitution: 0.2,
  /** Live flesh bits at once (oldest removed first). */
  cap: 24,
  /** Life (s) and the closing shrink (s, part of the life). */
  lifeS: 15,
  shrinkS: 0.5,
} as const;

/** The torn-slab flattening of the main gob, and the skin flap's (thin) and the fat bead's. */
const MEAT_SCALE: Vec3 = [1.25, 0.7, 1.0];
const SKIN_SCALE: Vec3 = [1.15, 0.32, 1.05];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : fallback;
};
const lerp = (r: readonly [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;

/** A per-actor flesh stream (own salt: it never shares the head model's per-actor jitter or rngStreams.misc). */
export function fleshRand(actorId: number): () => number {
  let h = (Math.imul(actorId | 0, 0x2c1b3c6d) ^ 0xf1e5b175) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return mulberry32(h);
}

/** The ball's sweep through the target per swing, VIEW space (x right, y up; flail-swing.ts KEYS): R comes down
 *  diagonally to low left, L across the front to the right, H flat right to left. `fwd` is how much of the eye →
 *  hit direction rides along (the ball also drives in). */
export const FLESH_SWEEP = {
  R: [-0.6, -0.8], L: [0.95, -0.3], H: [-1, 0], fwd: 0.35,
} as const;

/** The blow a flesh bit is thrown ALONG: the swing's sweep in world space. `dir` is the strike's eye → hit
 *  direction (StrikeHit.dir, the view's forward at the target): the sweep across the view is what tears
 *  the meat off sideways — dir itself points into the body and would throw everything at the camera. */
export function swingBlow(dir: Vec3, side: 'R' | 'L' | 'H'): Vec3 {
  const f = unit(dir, [0, 0, -1]);
  const right = unit(cross(f, [0, 1, 0]), [1, 0, 0]);
  const up = cross(right, f);
  const [x, y] = FLESH_SWEEP[side];
  return unit(add(add(mul(right, x), mul(up, y)), mul(f, FLESH_SWEEP.fwd)), f);
}

/** How many bits a hit throws: FLESH_BITS.body / head, ×hMul (rounded) on the overhead. */
export function fleshBitCount(target: 'body' | 'head', side: 'R' | 'L' | 'H', rand: () => number): number {
  const [lo, hi] = FLESH_BITS[target];
  const n = lo + Math.min(hi - lo, Math.floor(rand() * (hi - lo + 1)));
  return side === 'H' ? Math.round(n * FLESH_BITS.hMul) : n;
}

/**
 * `count` flesh bits off a wound at `point` (world, on the skin), struck along `blowDir` (world, unit-ish,
 * into the body), the skin's outward `normal` there. `scale` sizes them (and ×√scale their speed).
 */
export function fleshBits(point: Vec3, blowDir: Vec3, normal: Vec3, count: number, rand: () => number, scale = 1): GorePiece[] {
  const b = unit(blowDir, [0, 0, -1]);
  const n = unit(normal, mul(b, -1));
  const tang = unit(add(b, mul(n, -dot(b, n))), [0, 0, 0]);
  const axis = unit(add(add(mul(tang, FLESH_BITS.blowW), mul(n, FLESH_BITS.outW)), [0, FLESH_BITS.upW, 0]), n);
  // A frame round the axis for the cone.
  const u1 = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const u2 = cross(axis, u1);
  // A frame on the skin for the spawn scatter.
  const s1 = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const s2 = cross(n, s1);
  const speedK = Math.sqrt(scale);
  const out: GorePiece[] = [];
  for (let i = 0; i < count; i++) {
    const r = lerp(FLESH_BITS.size, rand()) * scale;
    // Uniform in the cone's solid angle; nudged out if a wide draw would dive back into the body.
    const cosT = 1 - rand() * (1 - Math.cos(FLESH_BITS.cone));
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const ph = rand() * Math.PI * 2;
    let d = unit(add(mul(axis, cosT), add(mul(u1, Math.cos(ph) * sinT), mul(u2, Math.sin(ph) * sinT))));
    if (dot(d, n) < 0.1) d = unit(add(d, mul(n, 0.1 - dot(d, n))));
    const speed = lerp(FLESH_BITS.speed, rand()) * speedK;
    const sc = (rand() - 0.5) * 2 * r, sd = (rand() - 0.5) * 2 * r;
    const o = add(add(point, mul(n, r * 0.7)), add(mul(s1, sc), mul(s2, sd)));
    const shade = 0.8 + 0.4 * rand();
    const meat: Vec3 = mul(GORE_COLORS.meat, shade);
    const prims: Primitive[] = [
      { a: o, b: o, radius: r, scale: MEAT_SCALE, blendK: r * 0.3, limb: 'torso', cluster: 0, color: meat, gloss: 0.7, op: 'add' },
    ];
    // A second, smaller meat lobe off-centre: a lumpy torn gob, not a smooth lens.
    {
      const lobe = unit([rand() - 0.5, (rand() - 0.5) * 0.5, rand() - 0.5], [1, 0, 0]);
      const at = add(o, mul(lobe, r * 0.6));
      prims.push({ a: at, b: at, radius: r * (0.5 + 0.2 * rand()), scale: [1, 0.8, 1], blendK: r * 0.3, limb: 'torso', cluster: 0, color: mul(meat, 0.85), gloss: 0.7, op: 'add' });
    }
    // What rides on the meat: a flap of the zombie's own skin (unpainted: the chunk's template skin), a bead
    // of yellow fat, both, or nothing (a raw lump).
    const roll = rand();
    const side = unit(add(mul(s1, rand() - 0.5), add(mul(s2, rand() - 0.5), [0, 0.6, 0])));
    if (roll < 0.75) {
      const at = add(o, mul(side, r * 0.45));
      prims.push({ a: at, b: at, radius: r * 0.85, scale: SKIN_SCALE, blendK: r * 0.2, limb: 'torso', cluster: 0, gloss: 0.25, op: 'add' });
    }
    if (roll > 0.55) {
      const at = add(o, mul(side, -r * 0.55));
      prims.push({ a: at, b: at, radius: r * 0.42, scale: [1, 1, 1], blendK: r * 0.25, limb: 'torso', cluster: 0, color: GORE_COLORS.fat, gloss: 0.5, op: 'add' });
    }
    const wAx = unit([rand() - 0.5, rand() - 0.5, rand() - 0.5], [1, 0, 0]);
    out.push({
      limb: 'torso', origin: o, prims, tornAt: [], bones: [], kind: 'gob',
      vel: mul(d, speed),
      angVel: mul(wAx, lerp(FLESH_BITS.spin, rand())),
      restitution: FLESH_BITS.restitution, wallRestitution: FLESH_BITS.restitution,
      tag: 'flesh',
    });
  }
  return out;
}

/** A signed-distance field's outward normal at `p` (central differences, 2 mm). */
export function fieldNormal(field: (p: Vec3) => number, p: Vec3): Vec3 {
  const e = 0.002;
  return unit([
    field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
    field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
    field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
  ], [0, 0, 0]);
}

/** A flesh bit's size at `age` seconds: 1 until the closing shrink, then linearly to 0 at lifeS. */
export function fleshShrink(age: number): number {
  const { lifeS, shrinkS } = FLESH_BITS;
  return Math.max(0, Math.min(1, (lifeS - age) / shrinkS));
}

type Tagged = { tag?: 'eye' | 'flesh' };

/** With `cap` or more flesh bits live, the index (in `live`, oldest first) of the oldest flesh bit; else -1. */
export function fleshOverCap(live: readonly Tagged[], cap: number = FLESH_BITS.cap): number {
  let n = 0;
  for (const c of live) if (c.tag === 'flesh') n++;
  return n >= cap ? live.findIndex(c => c.tag === 'flesh') : -1;
}

/** The chunk budget is full: which piece gives up its view. Live flesh first (oldest), then the oldest baked
 *  gib, then the oldest other live gib, an eye last. `live` is oldest first; null: nothing to evict. */
export function fleshEviction(live: readonly Tagged[], baked: number): { from: 'live'; index: number } | { from: 'baked' } | null {
  const f = live.findIndex(c => c.tag === 'flesh');
  if (f >= 0) return { from: 'live', index: f };
  if (baked > 0) return { from: 'baked' };
  const g = live.findIndex(c => c.tag !== 'eye');
  if (g >= 0) return { from: 'live', index: g };
  return live.length > 0 ? { from: 'live', index: 0 } : null;
}

// The flail's switch (gates set it off so their chunk counts and rng streams are the pre-flesh ones).
let fleshOn = true;
export function setFleshBitsOn(on: boolean): void { fleshOn = on; }
export function fleshBitsOn(): boolean { return fleshOn; }
