// src/lab/sdf-zombie/head-eye.ts
//
// THE POPPED EYE (spec §6). Pure. The zombie's eyes are texels of its face sheet, not prims, so the eye
// positions are the painted eyes' centroids (zombie-face.png, luma >= 0.9) mapped back through the
// sheet's planar projection (faceProj 0.45, 0.58, 0.5, 0.56; forward +1) to head coordinates:
// hs = head-rest position / headAxes. The leaf traces from eyeRayStart toward the head centre to find
// the surface point. The dangling eye hangs on its own small verlet rope (not flail-chain.ts, which is
// hard-wired to the flail): node 0 pinned to the socket, the last node the eyeball.
import { GORE_COLORS, eyeballPrims, prim } from './head-pop';
import { rotate } from './head-deform';
import type { HeadFrame } from './head-deform';
import type { EyeSide } from './head-damage';
import type { Primitive, Vec3 } from './types';

export const HEAD_EYES = { zombie: { L: [-0.498, 0.096] as const, R: [0.451, 0.179] as const } } as const;

export const EYE_STALK = {
  nodes: 6, len: 0.14, stepHz: 120, damping: 3, gravity: 9.81, iterations: 8,
  /** The stalk's radius at the socket and at the eye, metres. */
  r0: 0.009, r1: 0.006,
} as const;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** In front of the face, on the eye's line: the leaf traces from here toward the head centre. */
export function eyeRayStart(frame: HeadFrame, side: EyeSide, z = 1.5 * frame.axes[2]): Vec3 {
  const hs = HEAD_EYES.zombie[side];
  return add(frame.centre, rotate(frame.quat, [hs[0] * frame.axes[0], hs[1] * frame.axes[1], z]));
}

/** The eye whose (face-plane) position is nearer `point`. */
export function nearerEye(frame: HeadFrame, point: Vec3): EyeSide {
  const l = dist(eyeRayStart(frame, 'L', frame.axes[2]), point);
  const r = dist(eyeRayStart(frame, 'R', frame.axes[2]), point);
  return l <= r ? 'L' : 'R';
}

export interface StalkState { p: Vec3[]; prev: Vec3[]; acc: number }

/** Nodes laid along `dir` at the link length; `speed` (m/s) is the kick, folded into the verlet history. */
export function makeStalk(socket: Vec3, dir: Vec3, speed: number): StalkState {
  const n = EYE_STALK.nodes, link = EYE_STALK.len / (n - 1);
  // A zero kick direction would stack every node on the socket: hang it straight down instead.
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const u: Vec3 = l > 1e-9 ? [dir[0] / l, dir[1] / l, dir[2] / l] : [0, -1, 0];
  const p: Vec3[] = [], prev: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const q: Vec3 = [socket[0] + u[0] * link * k, socket[1] + u[1] * link * k, socket[2] + u[2] * link * k];
    p.push(q);
    const kick = k === 0 ? 0 : speed / EYE_STALK.stepHz;
    prev.push([q[0] - u[0] * kick, q[1] - u[1] * kick, q[2] - u[2] * kick]);
  }
  return { p, prev, acc: 0 };
}

export function stepStalk(s: StalkState, socket: Vec3, dt: number): StalkState {
  const { nodes, len, stepHz, damping, gravity, iterations } = EYE_STALK;
  const h = 1 / stepHz, link = len / (nodes - 1), damp = Math.exp(-damping * h);
  const p = s.p.map(v => [...v] as [number, number, number]);
  const prev = s.prev.map(v => [...v] as [number, number, number]);
  let acc = s.acc + (Number.isFinite(dt) && dt > 0 ? dt : 0);
  while (acc >= h) {
    acc -= h;
    for (let k = 1; k < nodes; k++) {
      const q = p[k]!, o = prev[k]!;
      const nx = q[0] + (q[0] - o[0]) * damp;
      const ny = q[1] + (q[1] - o[1]) * damp - gravity * h * h;
      const nz = q[2] + (q[2] - o[2]) * damp;
      o[0] = q[0]; o[1] = q[1]; o[2] = q[2];
      q[0] = nx; q[1] = ny; q[2] = nz;
    }
    p[0] = [socket[0], socket[1], socket[2]]; prev[0] = [socket[0], socket[1], socket[2]];
    for (let it = 0; it < iterations; it++) {
      for (let k = 0; k < nodes - 1; k++) {
        const a = p[k]!, b = p[k + 1]!;
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const l = Math.hypot(dx, dy, dz) || 1e-9;
        const e = (l - link) / l;
        const wa = k === 0 ? 0 : 0.5, wb = k === 0 ? 1 : 0.5;
        a[0] += dx * e * wa; a[1] += dy * e * wa; a[2] += dz * e * wa;
        b[0] -= dx * e * wb; b[1] -= dy * e * wb; b[2] -= dz * e * wb;
      }
      p[0] = [socket[0], socket[1], socket[2]];
    }
    // Follow-the-leader: makes every link exact.
    for (let k = 1; k < nodes; k++) {
      const a = p[k - 1]!, b = p[k]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l = Math.hypot(dx, dy, dz) || 1e-9;
      b[0] = a[0] + dx / l * link; b[1] = a[1] + dy / l * link; b[2] = a[2] + dz / l * link;
    }
  }
  p[0] = [socket[0], socket[1], socket[2]];
  return { p, prev, acc };
}

/** Tapered pink capsules along the rope, and the eyeball at its end (the rope is its nerve). With
 *  `headForward` (world, unit) the eyeball faces normalize(0.7·headForward + 0.3·stalkDir), so the iris
 *  keeps looking out of the face while it dangles (spec §15); without it, straight along the rope. */
export function stalkPrims(s: StalkState, irisColor: Vec3, headForward?: Vec3): Primitive[] {
  const n = s.p.length, out: Primitive[] = [];
  for (let k = 0; k < n - 1; k++) {
    const t0 = k / (n - 1), t1 = (k + 1) / (n - 1);
    out.push(prim(s.p[k]!, s.p[k + 1]!, EYE_STALK.r0 + (EYE_STALK.r1 - EYE_STALK.r0) * t0, GORE_COLORS.stalk,
      { radiusB: EYE_STALK.r0 + (EYE_STALK.r1 - EYE_STALK.r0) * t1, gloss: 0.7, blendK: 0.004, op: 'add' }));
  }
  const last = s.p[n - 1]!, before = s.p[n - 2]!;
  const l = dist(last, before) || 1;
  const along: Vec3 = [(last[0] - before[0]) / l, (last[1] - before[1]) / l, (last[2] - before[2]) / l];
  out.push(...eyeballPrims(last, headForward ? eyeLook(headForward, along) : along, irisColor, false));
  return out;
}

/** The dangling eyeball's facing: normalize(0.7·headForward + 0.3·stalkDir); a degenerate blend (the two
 *  opposed at the 0.7/0.3 balance — impossible for unit inputs) falls back to the head forward. */
export function eyeLook(headForward: Vec3, stalkDir: Vec3): Vec3 {
  const v: Vec3 = [
    0.7 * headForward[0] + 0.3 * stalkDir[0], 0.7 * headForward[1] + 0.3 * stalkDir[1], 0.7 * headForward[2] + 0.3 * stalkDir[2],
  ];
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : headForward;
}
