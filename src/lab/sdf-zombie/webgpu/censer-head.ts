// src/lab/sdf-zombie/webgpu/censer-head.ts
//
// THE CENSER'S HEAD: one point mass on a rope (spec §4.1, decision 3). Pure.
//
// The rope is INEXTENSIBLE BUT SLACK-ABLE: it only ever pulls, and only when
// taut. Fixed-step integration (stepHz) with an accumulator, so the result does
// not depend on how frames split the time — and a 16 m/s head moves under 7 cm
// per substep, below a forearm's width. The anchor (the knot on the haft) is
// interpolated across a frame's substeps, and its velocity is what lets a
// stroke YANK the head: the rope removes only the head's velocity RELATIVE to
// the anchor, along the rope.
//
// The chain is drawn, not simulated (game-censer.ts). A linked chain can
// replace this behind the same functions.

import type { Vec3 } from '../types';

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
} as const;

export interface Box { min: Vec3; max: Vec3 }
export interface HeadWorld { floorY: number; boxes: readonly Box[] }

export interface CenserHead {
  pos: Vec3;
  vel: Vec3;
  /** The anchor the last substep used: where the next frame's interpolation starts. */
  anchor: Vec3;
  /** Unsimulated time carried to the next frame, seconds. */
  acc: number;
}

/** Called after every substep with the head's segment and velocity. A number
 *  return scales the velocity (the energy struck flesh soaked up). */
export type SubstepHook = (from: Vec3, to: Vec3, vel: Vec3) => number | void;

export function makeCenserHead(anchor: Vec3): CenserHead {
  return {
    pos: [anchor[0], anchor[1] - CENSER_HEAD.ropeLen, anchor[2]],
    vel: [0, 0, 0],
    anchor: [anchor[0], anchor[1], anchor[2]],
    acc: 0,
  };
}

/** Push the head sphere out of the floor and any box it entered; kill most of the inbound speed. */
function collide(p: [number, number, number], v: [number, number, number], world: HeadWorld): void {
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
    if (!inside || axis < 0) continue;
    const outward = face > p[axis]! ? 1 : -1;
    p[axis] = face;
    if (v[axis]! * outward < 0) v[axis] = -v[axis]! * e;
  }
}

export function stepCenserHead(
  s: CenserHead, anchor: Vec3, dt: number, world: HeadWorld, hook?: SubstepHook,
): CenserHead {
  const H = CENSER_HEAD;
  const h = 1 / H.stepHz;
  let acc = s.acc + (dt > 0 ? dt : 0);
  let steps = Math.floor(acc / h + 1e-9);
  acc = Math.max(0, acc - steps * h);
  if (steps > H.maxSubsteps) { steps = H.maxSubsteps; acc = 0; }
  if (steps === 0) return { ...s, acc };

  const p: [number, number, number] = [s.pos[0], s.pos[1], s.pos[2]];
  const v: [number, number, number] = [s.vel[0], s.vel[1], s.vel[2]];
  const a0 = s.anchor;
  const decay = Math.exp(-H.drag * h);
  // Anchor velocity is constant across this frame's substeps (linear interpolation).
  const av: [number, number, number] = [
    (anchor[0] - a0[0]) / (steps * h), (anchor[1] - a0[1]) / (steps * h), (anchor[2] - a0[2]) / (steps * h),
  ];
  for (let i = 0; i < steps; i++) {
    const f = (i + 1) / steps;
    const a: [number, number, number] =
      [a0[0] + (anchor[0] - a0[0]) * f, a0[1] + (anchor[1] - a0[1]) * f, a0[2] + (anchor[2] - a0[2]) * f];
    const from: Vec3 = [p[0], p[1], p[2]];
    v[1] += H.gravity * h;
    for (let k = 0; k < 3; k++) { v[k] = v[k]! * decay; p[k] = p[k]! + v[k]! * h; }
    const d: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L > H.ropeLen) {
      const n: [number, number, number] = [d[0] / L, d[1] / L, d[2] / L];
      for (let k = 0; k < 3; k++) p[k] = a[k]! + n[k]! * H.ropeLen;
      const rel = (v[0] - av[0]) * n[0] + (v[1] - av[1]) * n[1] + (v[2] - av[2]) * n[2];
      if (rel > 0) for (let k = 0; k < 3; k++) v[k] = v[k]! - n[k]! * rel;
    }
    collide(p, v, world);
    if (hook) {
      const k = hook(from, [p[0], p[1], p[2]], [v[0], v[1], v[2]]);
      if (typeof k === 'number') for (let j = 0; j < 3; j++) v[j] = v[j]! * k;
    }
  }
  return { pos: [p[0], p[1], p[2]], vel: [v[0], v[1], v[2]], anchor: [anchor[0], anchor[1], anchor[2]], acc };
}
