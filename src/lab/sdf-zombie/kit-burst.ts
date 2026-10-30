// src/lab/sdf-zombie/kit-burst.ts
//
// A KIT THAT OUTLIVES ITS BODY (owner, 2026-10-29: "kit vanishes when a body gibs"). When a body gibs, its skinned kit
// comes apart into rigid pieces that the blast throws and that land on the floor. This file is the pure half: which
// skeleton bone carries which piece (assignBurstSlots) and how one piece flies and lands (stepKitPiece).
//
// WHY PIECES ARE BONES and not baked meshes as kit-damage.ts's shed pieces are: the gib frame must build no pipeline and
// CPU-skin nothing. A baked piece is an unskinned draw, a different render key from the skinned kit, so its materials
// would build on the gib frame (30-80 ms each), and the sculpted kits run to 120k vertices. The kit's own skinned draw
// is already warm, so a piece is a set of vertices re-weighted to ONE bone and moved by writing that bone's matrix: no
// new key, no baking, and no more draw calls than the kit had alive.
// webgpu/kit-burst-mesh.ts does the re-weighting and writes the matrices.
//
// INDEPENDENT OF THE MESH: no piece names and no counts. Whatever the kit's connected islands and bones are decide it.
//
// Pure: no three.js, no DOM.
import { landingFloor, type DebrisGround } from './debris-ground';
import type { Vec3 } from './types';
import { qFromAxisAngle, qFromTo, qMul, qNormalize, qRotate, type Quat } from './vec';

export const KIT_BURST = {
  /** Share of the gib launch a kit piece takes: plate is heavier than meat, so it flies with the gibs but not past them. */
  velGain: 0.8,
  /** Top speed of a piece, m/s: a point-blank burst threw plate 14 m at the gib launch's 16. */
  maxSpeedMps: 9,
  /** On top of the gib launch, each piece's own push out of the body, m/s. The gib launch is one shove with a small
   *  spread, which is right for meat; a suit of plates on it held together and read as an empty suit flying off. */
  burstMps: 2.6,
  /** Vertical share of that push, so it fans out sideways rather than up. */
  burstFlatten: 0.5,
  /** And a seeded scatter: sideways up to this either way, and up to burstUpMps upward. */
  scatterMps: 1.5,
  burstUpMps: 1.4,
  /** The same fall and bounce as kit-damage.ts's shed pieces. */
  gravity: 10,
  restitution: 0.22,
  friction: 0.6,
  /** Below this bounce speed the piece stops hopping and settles. */
  restCutoff: 0.6,
  /** Tumble rate: a base plus a share of the launch speed, jittered by the piece's seed, rad/s. */
  spinBase: 4,
  spinPerSpeed: 0.9,
  spinMax: 16,
  /** The settle: the piece lays itself flat over this long while its slide dies. */
  settleSec: 0.16,
  /** Height a resting piece keeps off the floor, metres. */
  floorPad: 0.01,
  /** Anything still moving after this is stopped where it is (a piece on a crate that floorAt does not know of). */
  maxAgeSec: 6,
  /** A loose island smaller than this (half-diagonal, metres) stays with its bone's largest piece: rivets and buckles
   *  are not worth a bone of their own. */
  minOwnRadiusM: 0.03,
  /** Up to this many index entries a kit is split into its islands on the gib frame (soldier ~3.7k, largest WAM kit
   *  ~12k). Above it (a sculpted kit, 100k+ vertices) the split would be a hitch, so it comes apart by bone. */
  islandIndexLimit: 15000,
} as const;

/** One candidate piece: the bone that weights it most, and how big it is. */
export interface BurstGroup { joint: number; radius: number }

/**
 * Which skeleton bone will carry each group. A bone's largest group keeps that bone. The other groups on it (say a
 * belt and a pouch both on the pelvis) take a bone nothing else uses, biggest first, so they can fly apart; when the
 * spare bones run out, or for a group under minOwnRadiusM, it stays on its bone and flies with the largest one.
 * The skeleton cannot grow: its length is part of the shader, and the point is not to build one.
 */
export function assignBurstSlots(groups: readonly BurstGroup[], boneCount: number,
  minOwnRadius: number = KIT_BURST.minOwnRadiusM): number[] {
  const slots = groups.map(g => g.joint);
  const used = new Set(slots);
  const free: number[] = [];
  for (let b = 0; b < boneCount; b++) if (!used.has(b)) free.push(b);
  const largest = new Map<number, number>();
  groups.forEach((g, i) => {
    const best = largest.get(g.joint);
    if (best === undefined || g.radius > groups[best]!.radius) largest.set(g.joint, i);
  });
  const extras = groups.map((_, i) => i)
    .filter(i => largest.get(groups[i]!.joint) !== i && groups[i]!.radius >= minOwnRadius)
    .sort((a, b) => groups[b]!.radius - groups[a]!.radius);
  for (const i of extras) {
    const slot = free.shift();
    if (slot === undefined) break;
    slots[i] = slot;
  }
  return slots;
}

/** One flying piece. Its frame is the kit's bind frame: `quat` turns a bind-space offset from the piece's centre to
 *  world, so a local box in `half` stays tight on a plate however the body stood. Mutated in place (per frame, per piece). */
export interface KitPiece {
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  /** The launch this piece left with (the debris seam). */
  launch: Vec3;
  spinAxis: Vec3;
  spinRate: number;
  /** Half extents of the bounds in the piece's frame, metres. */
  half: Vec3;
  /** The bounds' half-diagonal: what the wall bounce stops at. */
  radius: number;
  floorY: number;
  age: number;
  /** -1 until the piece settles; then 0..1 through the settle. */
  settle: number;
  settleFrom: Quat;
  settleTo: Quat;
  resting: boolean;
}

/**
 * A kit piece's launch: the gib launch `base` (what the blast does to this body), plus the piece's own burst out of the
 * body's centre and a seeded scatter (three stable [0, 1) rolls), so that the kit comes apart as it goes.
 */
export function kitBurstLaunch(base: Vec3, centre: Vec3, torso: Vec3, r01: readonly [number, number, number]): Vec3 {
  let dx = centre[0] - torso[0], dy = (centre[1] - torso[1]) * KIT_BURST.burstFlatten, dz = centre[2] - torso[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-3) { dx = 0; dy = 0; dz = 0; } else { dx /= l; dy /= l; dz /= l; }
  const b = KIT_BURST.burstMps;
  return [
    base[0] + dx * b + (r01[0] * 2 - 1) * KIT_BURST.scatterMps,
    base[1] + dy * b + r01[1] * KIT_BURST.burstUpMps,
    base[2] + dz * b + (r01[2] * 2 - 1) * KIT_BURST.scatterMps,
  ];
}

/** `r01` are three stable [0, 1) rolls for this piece, deciding its spin. */
export function makeKitPiece(pos: Vec3, quat: Quat, half: Vec3, launch: Vec3, r01: readonly [number, number, number],
  floorY: number): KitPiece {
  const k0 = KIT_BURST.velGain, s0 = Math.hypot(launch[0], launch[1], launch[2]) * k0;
  const k = s0 > KIT_BURST.maxSpeedMps ? k0 * KIT_BURST.maxSpeedMps / s0 : k0;
  const v: Vec3 = [launch[0] * k, launch[1] * k, launch[2] * k];
  const speed = Math.min(s0, KIT_BURST.maxSpeedMps);
  const ax: Vec3 = [r01[0] * 2 - 1, r01[1] * 2 - 1, r01[2] * 2 - 1];
  const al = Math.hypot(ax[0], ax[1], ax[2]);
  return {
    pos: [pos[0], pos[1], pos[2]], quat: [quat[0], quat[1], quat[2], quat[3]], vel: v, launch: v,
    spinAxis: al < 1e-3 ? [1, 0, 0] : [ax[0] / al, ax[1] / al, ax[2] / al],
    spinRate: Math.min(KIT_BURST.spinMax, (KIT_BURST.spinBase + speed * KIT_BURST.spinPerSpeed) * (0.75 + 0.5 * r01[0])),
    half: [half[0], half[1], half[2]], radius: Math.hypot(half[0], half[1], half[2]),
    floorY, age: 0, settle: -1, settleFrom: [0, 0, 0, 1], settleTo: [0, 0, 0, 1], resting: false,
  };
}

/** How far the piece's bounds reach below (and above) its centre at this orientation. */
export function kitPieceHalfHeight(q: Quat, half: Vec3): number {
  const [x, y, z, w] = q;
  return Math.abs(2 * (x * y + w * z)) * half[0] + Math.abs(1 - 2 * (x * x + z * z)) * half[1]
    + Math.abs(2 * (y * z - w * x)) * half[2];
}

const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The orientation nearest `q` that lies flat: a plate on its broad face. Of the piece's thin axes (within 1.35x of the
 *  thinnest, so a cube-ish piece keeps the face it is nearest), the one already nearest vertical is turned to vertical. */
export function layFlat(q: Quat, half: Vec3): Quat {
  const thin = Math.min(half[0], half[1], half[2]);
  let best: Vec3 = [0, 1, 0], bestY = -1;
  for (let i = 0; i < 3; i++) {
    if (half[i]! > thin * 1.35) continue;
    const u = qRotate(q, AXES[i]!);
    if (Math.abs(u[1]) > bestY) { bestY = Math.abs(u[1]); best = u; }
  }
  const up: Vec3 = [0, best[1] >= 0 ? 1 : -1, 0];
  return qNormalize(qMul(qFromTo(best, up), q));
}

function nlerp(a: Quat, b: Quat, k: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return qNormalize([a[0] + (s * b[0] - a[0]) * k, a[1] + (s * b[1] - a[1]) * k, a[2] + (s * b[2] - a[2]) * k,
    a[3] + (s * b[3] - a[3]) * k]);
}

function moveAcross(p: KitPiece, dt: number, ground: DebrisGround): void {
  const start: Vec3 = [p.pos[0], p.pos[1], p.pos[2]];
  p.pos = [p.pos[0] + p.vel[0] * dt, p.pos[1] + p.vel[1] * dt, p.pos[2] + p.vel[2] * dt];
  const b = ground.bounce(start, p.pos, p.vel, KIT_BURST.restitution, KIT_BURST.friction, p.radius);
  if (b) { p.pos = b.pos; p.vel = b.vel; }
}

/** One step of a piece: flight, walls, ceiling, floor bounces, then the settle. A no-op once it rests. */
export function stepKitPiece(p: KitPiece, dt: number, ground: DebrisGround): void {
  if (p.resting || dt <= 0) return;
  p.age += dt;
  if (p.settle >= 0) {
    p.settle = Math.min(1, p.settle + dt / KIT_BURST.settleSec);
    const k = p.settle * p.settle * (3 - 2 * p.settle);
    p.quat = nlerp(p.settleFrom, p.settleTo, k);
    p.vel = [p.vel[0] * (1 - k), 0, p.vel[2] * (1 - k)];
    moveAcross(p, dt, ground);
    p.floorY = landingFloor(ground, p.pos[0], p.pos[2], p.floorY);
    p.pos = [p.pos[0], p.floorY + KIT_BURST.floorPad + kitPieceHalfHeight(p.quat, p.half), p.pos[2]];
    if (p.settle >= 1) { p.resting = true; p.vel = [0, 0, 0]; p.spinRate = 0; }
    return;
  }
  if (p.age >= KIT_BURST.maxAgeSec) { p.resting = true; p.vel = [0, 0, 0]; p.spinRate = 0; return; }
  p.vel = [p.vel[0], p.vel[1] - KIT_BURST.gravity * dt, p.vel[2]];
  moveAcross(p, dt, ground);
  p.quat = qNormalize(qMul(qFromAxisAngle(p.spinAxis, p.spinRate * dt), p.quat));
  const reach = kitPieceHalfHeight(p.quat, p.half);
  const ceil = ground.ceilAt?.(p.pos[0], p.pos[2]) ?? Infinity;
  if (Number.isFinite(ceil) && p.pos[1] + reach > ceil - KIT_BURST.floorPad) {
    p.pos = [p.pos[0], ceil - KIT_BURST.floorPad - reach, p.pos[2]];
    if (p.vel[1] > 0) p.vel = [p.vel[0], -p.vel[1] * KIT_BURST.restitution, p.vel[2]];
  }
  p.floorY = landingFloor(ground, p.pos[0], p.pos[2], p.floorY);
  const rest = p.floorY + KIT_BURST.floorPad + reach;
  if (p.pos[1] < rest) {
    p.pos = [p.pos[0], rest, p.pos[2]];
    p.vel = [p.vel[0] * KIT_BURST.friction, Math.abs(p.vel[1]) * KIT_BURST.restitution, p.vel[2] * KIT_BURST.friction];
    p.spinRate *= 0.65;
    if (p.vel[1] < KIT_BURST.restCutoff) {
      p.settle = 0;
      p.settleFrom = [p.quat[0], p.quat[1], p.quat[2], p.quat[3]];
      p.settleTo = layFlat(p.quat, p.half);
    }
  }
}
