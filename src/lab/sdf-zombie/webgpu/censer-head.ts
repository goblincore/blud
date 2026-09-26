// src/lab/sdf-zombie/webgpu/censer-head.ts
//
// THE CENSER'S HEAD: one point mass on a rope (spec §4.1, decision 3). Pure.
//
// The rope is INEXTENSIBLE BUT SLACK-ABLE: it only ever pulls, and only when
// taut — callers derive taut/slack themselves as dist(pos, anchor) < ropeLen - eps.
// Fixed-step integration (stepHz) with an accumulator, so the result does not
// depend on how frames split the time — and a 16 m/s head moves under 7 cm per
// substep, below a forearm's width. The anchor (the knot on the haft) is
// interpolated across a frame's substeps BY TIME, not by substep count: the
// anchor's velocity is (anchor - a0) / (time elapsed since a0 was sampled), so
// a lag spike or a variable frame rate can't inflate or deflate the yank. That
// velocity is what lets a stroke YANK the head: the rope removes only the
// head's velocity RELATIVE to the anchor, along the rope.
//
// Collision runs after the rope constraint, on purpose: walls win. That can
// leave a step ending a hair (~1e-5 m) over rope length when a box is in the
// way of the taut direction; the chain renderer tolerates that.
//
// The chain is drawn, not simulated (game-censer.ts). A linked chain can
// replace this behind the same functions.

import type { Vec3 } from '../types';

/** Mutable xyz — Vec3 is readonly; the integrator works in place. */
type Mut3 = [number, number, number];

export const CENSER_HEAD = {
  ropeLen: 0.55,
  /** The thurible's bowl as a sphere: the collision sphere and the contact offset. */
  radius: 0.07,
  gravity: -9.81,
  /** Linear air drag, 1/s. */
  drag: 0.6,
  stepHz: 240,
  /** Bounce kept off a wall or the floor, 0..1. */
  restitution: 0.25,
  /** Backlog cap: a long stall simulates at most this many substeps and drops the rest. */
  maxSubsteps: 24,
  /** An anchor jump past this in one call is a teleport, not a stroke: re-hang instead of flinging the head. */
  snapDist: 1.0,
} as const;

export interface Box { min: Vec3; max: Vec3 }
export interface HeadWorld { floorY: number; boxes: readonly Box[] }

export interface CenserHead {
  pos: Vec3;
  vel: Vec3;
  /** The anchor position the simulation has actually reached: where the next frame's interpolation starts. */
  anchor: Vec3;
  /** Unsimulated time carried to the next frame, seconds. */
  acc: number;
}

/** Called after every substep with the head's segment and velocity. A number
 *  return scales the velocity (the energy struck flesh soaked up); clamped to
 *  [0, 1] since the hook only ever soaks up energy, never adds it. */
export type SubstepHook = (from: Vec3, to: Vec3, vel: Vec3) => number | void;

export function makeCenserHead(anchor: Vec3, ropeLen: number = CENSER_HEAD.ropeLen): CenserHead {
  return {
    pos: [anchor[0], anchor[1] - ropeLen, anchor[2]],
    vel: [0, 0, 0],
    anchor: [anchor[0], anchor[1], anchor[2]],
    acc: 0,
  };
}

/** Push the head sphere out of the floor and any box it entered; kill most of the inbound speed. */
function collide(p: Mut3, v: Mut3, world: HeadWorld): void {
  const r = CENSER_HEAD.radius, e = CENSER_HEAD.restitution;
  if (p[1] - r < world.floorY) {
    p[1] = world.floorY + r;
    if (v[1] < 0) v[1] = -v[1] * e;
  }
  for (const b of world.boxes) {
    let inside = true, best = Infinity, axis = -1, face = 0;
    for (let k = 0; k < 3; k++) {
      const lo = b.min[k]! - r, hi = b.max[k]! + r, pk = p[k]!;
      if (pk <= lo || pk >= hi) { inside = false; break; }
      if (pk - lo < best) { best = pk - lo; axis = k; face = lo; }
      if (hi - pk < best) { best = hi - pk; axis = k; face = hi; }
    }
    if (!inside) continue;
    const outward = face > p[axis]! ? 1 : -1;
    p[axis] = face;
    if (v[axis]! * outward < 0) v[axis] = -v[axis]! * e;
  }
}

export function stepCenserHead(
  s: CenserHead, anchor: Vec3, dt: number, world: HeadWorld, hook?: SubstepHook,
  /** This frame's rope length (the reel, censer-swing.ts ropeLength). A
   *  shorter rope than last frame is taken up by the position projection
   *  alone — it never adds velocity, so reeling in cannot fling the head. */
  ropeLen: number = CENSER_HEAD.ropeLen,
): CenserHead {
  const H = CENSER_HEAD;

  // No time, or a bad dt: nothing moves this call.
  if (!Number.isFinite(dt) || dt <= 0) return s;

  // A teleporting handle (a cut scene, a respawn, a dev-tools warp) is not a
  // stroke — re-hang the head at rest under the new anchor instead of
  // computing an anchor velocity that would fling it at absurd speed.
  const a0In = s.anchor;
  const jump = Math.hypot(anchor[0] - a0In[0], anchor[1] - a0In[1], anchor[2] - a0In[2]);
  if (jump > H.snapDist) return makeCenserHead(anchor, ropeLen);

  const h = 1 / H.stepHz;
  // Real time elapsed since a0 (s.anchor) was sampled — this, not steps*h, is
  // what the anchor's velocity and interpolation fraction must be measured
  // against, or the yank strength depends on frame rate.
  const span = s.acc + dt;
  let steps = Math.floor(span / h + 1e-9);
  let acc = Math.max(0, span - steps * h);
  let capped = false;
  if (steps > H.maxSubsteps) { steps = H.maxSubsteps; acc = 0; capped = true; }
  if (steps === 0) return { ...s, acc };

  const p: Mut3 = [s.pos[0], s.pos[1], s.pos[2]];
  const v: Mut3 = [s.vel[0], s.vel[1], s.vel[2]];
  const a0: Mut3 = [a0In[0], a0In[1], a0In[2]];
  const decay = Math.exp(-H.drag * h);
  // Anchor velocity is constant across this frame's substeps (linear interpolation by time).
  const av: Mut3 = [
    (anchor[0] - a0[0]) / span, (anchor[1] - a0[1]) / span, (anchor[2] - a0[2]) / span,
  ];
  let lastA: Mut3 = [a0[0], a0[1], a0[2]];
  for (let i = 0; i < steps; i++) {
    const f = Math.min(1, ((i + 1) * h) / span);
    const a: Mut3 =
      [a0[0] + (anchor[0] - a0[0]) * f, a0[1] + (anchor[1] - a0[1]) * f, a0[2] + (anchor[2] - a0[2]) * f];
    lastA = a;
    const from: Vec3 = [p[0], p[1], p[2]];
    v[1] += H.gravity * h;
    for (let k = 0; k < 3; k++) { v[k] = v[k]! * decay; p[k] = p[k]! + v[k]! * h; }
    const d: Mut3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L > ropeLen) {
      const n: Mut3 = [d[0] / L, d[1] / L, d[2] / L];
      for (let k = 0; k < 3; k++) p[k] = a[k]! + n[k]! * ropeLen;
      const rel = (v[0] - av[0]) * n[0] + (v[1] - av[1]) * n[1] + (v[2] - av[2]) * n[2];
      if (rel > 0) for (let k = 0; k < 3; k++) v[k] = v[k]! - n[k]! * rel;
    }
    collide(p, v, world);
    if (hook) {
      const raw = hook(from, [p[0], p[1], p[2]], [v[0], v[1], v[2]]);
      if (typeof raw === 'number') {
        const k = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
        for (let j = 0; j < 3; j++) v[j] = v[j]! * k;
      }
    }
  }
  // The backlog cap dropped time outright (acc reset to 0): the anchor
  // position we couldn't afford to simulate through is simply gone, so snap
  // to the actual incoming anchor rather than leaving the head's reference
  // point stuck mid-lerp. Otherwise, store the anchor position the
  // simulation actually reached (steps*h into span), so the next call's
  // interpolation starts from where this one left off, not from a point it
  // never simulated.
  const storedAnchor: Mut3 = capped ? [anchor[0], anchor[1], anchor[2]] : lastA;
  return { pos: [p[0], p[1], p[2]], vel: [v[0], v[1], v[2]], anchor: storedAnchor, acc };
}
