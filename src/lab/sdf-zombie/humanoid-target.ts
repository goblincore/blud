// src/lab/sdf-zombie/humanoid-target.ts
//
// Task 10 — click-to-shoot targeting. `traceHumanoidRay` sphere-traces the
// COARSE CPU brick in BIND-LOCAL space. Ray-versus-posed-OBB alone lands the
// hit on a bounding box, so craters float off thin limbs by centimetres; the
// broad phase here only yields the candidate set and an entry `t`, then the
// coarse field decides the nearest surface crossing and the owning bone.
//
// WHY NOT A GPU READBACK. The 33.5 MiB R16F distance atlas is a GPU upload and
// stays one; the coarse f32 brick pack (<=16³ per bone, ~350 KiB) is kept
// CPU-side by the loader precisely for this path. A click runs a handful of
// trilinear samples, no WebGPU round-trip, no readback latency.
//
// OWNER = MINIMAL FIELD, NOT A HEURISTIC. Each candidate bone is sphere-traced
// in its own bind-local frame; the ray's nearest surface crossing (smallest t)
// is the hit, and the bone whose field is minimal AT that hit is the owner —
// the same bone that produced the crossing. This replaces damage.ts's
// nearest-endpoint/occupied-box heuristics: a hit in the 30 mm elbow band is
// attributed by which brick's field the ray actually crossed, not by which
// occupied box or capsule endpoint is nearer.
//
// POSED, NOT BIND. The ray is tested against HumanoidPoseState.bones[i] (and,
// after a sever, chunkRootPose ∘ frozenDistalBones for the distal subtree),
// so elbow flexion — and any future locomotion — displaces the target the ray
// is tested against, exactly as X1.22 task 4 recorded for the procedural path.
//
// PURE. No renderer, no WebGPU, no DOM, no GPU readback. State-in/state-out.

import type { Vec3 } from './types';
import { qNormalize, qRotate, type Quat } from './vec';
import type {
  HumanoidVolumeManifest,
  HumanoidCoarseBricks,
  HumanoidCoarseBrick,
} from './webgpu/humanoid-volume';
import type { HumanoidPoseState, HumanoidBonePose } from './humanoid-pose';
import type { HumanoidSeverState } from './humanoid-sever';
import { chunkBoneWorldPose } from './humanoid-sever';

/** A resolved ray hit: the world surface point, the distance along the ray,
 *  the owning bone (manifest.bones[] array position), the hit in that bone's
 *  BIND-LOCAL frame (for wound keying), and whether it landed on the detached
 *  distal chunk. */
export interface HumanoidRayHit {
  point: Vec3;
  t: number;
  boneIdx: number;
  local: Vec3;
  detached: boolean;
}

// Sphere-trace / refinement budget. The coarse voxel is ~20 mm; the bisection
// after the trace converges the crossing to sub-millimetre (16 halvings of a
// ~20 mm bracket -> ~0.3 um), well inside the 55 mm pellet crater.
const TRACE_MAX_STEPS = 64;
const TRACE_MIN_STEP = 0.002; // 2 mm floor — guards a near-zero step
const BISECT_STEPS = 16;

// -- local math (the same closed-form rigid frame as humanoid-damage.ts) ------

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** world -> bind-local point: `qConj(q) * (world - t)`, q renormalised. */
function worldToLocal(pose: HumanoidBonePose, world: Vec3): Vec3 {
  return qRotate(qConj(qNormalize(pose.quaternion)), sub(world, pose.position));
}

/** world -> bind-local direction (rotation only). Length-preserving, so the
 *  ray parameter t is the true distance in both spaces. */
function worldToLocalDir(quaternion: Quat, dir: Vec3): Vec3 {
  return qRotate(qConj(qNormalize(quaternion)), dir);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Trilinearly samples a coarse brick at a BIND-LOCAL point, on the baker's
 * ENDPOINT-INCLUSIVE lattice (`uv * (dims - 1)`), plus the true metric
 * distance to the brick box when the point lies outside it — the exact
 * convention `sampleDistanceBrick` + `mapHumanoidField` use for the dense
 * atlas, so the CPU targeting field and the GPU field never disagree.
 */
export function sampleHumanoidCoarseField(brick: HumanoidCoarseBrick, local: Vec3): number {
  const [nx, ny, nz] = brick.dims;
  const invExt: Vec3 = [
    1 / (brick.boundsMax[0] - brick.boundsMin[0]),
    1 / (brick.boundsMax[1] - brick.boundsMin[1]),
    1 / (brick.boundsMax[2] - brick.boundsMin[2]),
  ];
  const u = clamp01((local[0] - brick.boundsMin[0]) * invExt[0]) * (nx - 1);
  const v = clamp01((local[1] - brick.boundsMin[1]) * invExt[1]) * (ny - 1);
  const w = clamp01((local[2] - brick.boundsMin[2]) * invExt[2]) * (nz - 1);

  const i0 = Math.floor(u), j0 = Math.floor(v), k0 = Math.floor(w);
  const i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, ny - 1), k1 = Math.min(k0 + 1, nz - 1);
  const fu = u - i0, fv = v - j0, fw = w - k0;
  const d = brick.data;
  const idx = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;
  const c000 = d[idx(i0, j0, k0)]!, c100 = d[idx(i1, j0, k0)]!;
  const c010 = d[idx(i0, j1, k0)]!, c110 = d[idx(i1, j1, k0)]!;
  const c001 = d[idx(i0, j0, k1)]!, c101 = d[idx(i1, j0, k1)]!;
  const c011 = d[idx(i0, j1, k1)]!, c111 = d[idx(i1, j1, k1)]!;
  const sd = mix(
    mix(mix(c000, c100, fu), mix(c010, c110, fu), fv),
    mix(mix(c001, c101, fu), mix(c011, c111, fu), fv),
    fw,
  );

  // Outside-box metric distance: clamp-to-edge alone would extrude a phantom
  // limb to infinity (X1.26's lesson, mirrored in mapHumanoidField).
  const extent: Vec3 = [
    brick.boundsMax[0] - brick.boundsMin[0],
    brick.boundsMax[1] - brick.boundsMin[1],
    brick.boundsMax[2] - brick.boundsMin[2],
  ];
  const diffMin: Vec3 = [
    brick.boundsMin[0] - local[0], brick.boundsMin[1] - local[1], brick.boundsMin[2] - local[2],
  ];
  const diffMax: Vec3 = [
    local[0] - (brick.boundsMin[0] + extent[0]),
    local[1] - (brick.boundsMin[1] + extent[1]),
    local[2] - (brick.boundsMin[2] + extent[2]),
  ];
  const outside = Math.hypot(
    Math.max(diffMin[0], diffMax[0], 0),
    Math.max(diffMin[1], diffMax[1], 0),
    Math.max(diffMin[2], diffMax[2], 0),
  );
  return sd + outside;
}

// -- broad phase: ray vs axis-aligned occupied box (bind-local, slab method) --

interface RayBox { tEntry: number; tExit: number }

function rayAabb(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): RayBox | null {
  let tEntry = -Infinity;
  let tExit = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = origin[k]!;
    const d = dir[k]!;
    if (Math.abs(d) < 1e-12) {
      if (o < min[k]! || o > max[k]!) return null; // parallel and outside
      continue;
    }
    let t1 = (min[k]! - o) / d;
    let t2 = (max[k]! - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tEntry = Math.max(tEntry, t1);
    tExit = Math.min(tExit, t2);
  }
  const entry = Math.max(0, tEntry);
  if (tExit < entry) return null; // box entirely behind the ray
  return { tEntry: entry, tExit };
}

// -- narrow phase: sphere trace + bisection -----------------------------------

/** Bisects the bracketed crossing [lo, hi] (field(lo) >= 0, field(hi) < 0) to
 *  a sub-millimetre surface point. */
function bisect(lo: number, hi: number, evalAt: (t: number) => number, steps = BISECT_STEPS): number {
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (evalAt(mid) < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Sphere-traces the coarse field along the bind-local ray from `tEntry`
 *  (occupied-box entry) to `tExit` (occupied-box exit). Returns the refined
 *  surface crossing t, or null if the field never changes sign. */
function traceBrick(
  origin: Vec3, dir: Vec3, tEntry: number, tExit: number, sample: (p: Vec3) => number,
): number | null {
  const at = (t: number): Vec3 => [
    origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t,
  ];
  let t = Math.max(0, tEntry);
  let d = sample(at(t));
  if (d < 0) {
    // Started inside (ray origin within the occupied box, or the surface grazes
    // the entry face): the surface lies between the ray origin and t.
    return bisect(0, t, (s) => sample(at(s)));
  }
  let prevT = t;
  for (let i = 0; i < TRACE_MAX_STEPS; i++) {
    d = sample(at(t));
    if (d < 0) return bisect(prevT, t, (s) => sample(at(s)));
    prevT = t;
    t += Math.max(d, TRACE_MIN_STEP);
    if (t > tExit) return null;
  }
  return null;
}

// -- the trace -----------------------------------------------------------------

/**
 * Traces a world-space ray against the POSED humanoid. The broad phase tests
 * each bone's posed occupied-bounds OBB (the ray transformed into bind-local,
 * so the box stays axis-aligned and exact); the narrow phase sphere-traces
 * each candidate's coarse brick from its entry point and refines the nearest
 * surface crossing. The owner is the bone with the nearest crossing (its field
 * is minimal there). After a sever, the distal subtree is posed under
 * `chunkRootPose ∘ frozenDistalBones` and its hits are flagged `detached`.
 *
 * Returns null on a clean miss (no bone's field was crossed).
 */
export function traceHumanoidRay(
  manifest: HumanoidVolumeManifest,
  coarse: HumanoidCoarseBricks,
  pose: HumanoidPoseState,
  sever: HumanoidSeverState,
  origin: Vec3,
  dir: Vec3,
): HumanoidRayHit | null {
  const dLen = Math.hypot(dir[0], dir[1], dir[2]);
  if (!Number.isFinite(dLen) || dLen === 0) return null;
  const rd: Vec3 = [dir[0] / dLen, dir[1] / dLen, dir[2] / dLen];

  const detached = sever.phase === 'detached' && sever.chunk !== null;
  const distalPos = new Map<number, number>(); // bone array idx -> distalIndices position
  if (detached) pose.distalIndices.forEach((bi, k) => distalPos.set(bi, k));

  const boneWorldPose = (i: number): HumanoidBonePose => {
    if (detached && distalPos.has(i)) {
      return chunkBoneWorldPose(sever.chunk!, sever.frozenDistalBones[distalPos.get(i)!]!);
    }
    return pose.bones[i]!;
  };

  interface Crossing { boneIdx: number; detached: boolean; t: number }
  const crossings: Crossing[] = [];

  for (let i = 0; i < manifest.bones.length; i++) {
    const brick = coarse.bones[i];
    const bone = manifest.bones[i];
    if (!brick || !bone) continue;
    const worldPose = boneWorldPose(i);
    const localOrigin = worldToLocal(worldPose, origin);
    const localDir = worldToLocalDir(worldPose.quaternion, rd);
    const box = rayAabb(localOrigin, localDir, bone.occupiedBoundsMin, bone.occupiedBoundsMax);
    if (!box) continue;
    const sample = (p: Vec3) => sampleHumanoidCoarseField(brick, p);
    const tHit = traceBrick(localOrigin, localDir, box.tEntry, box.tExit, sample);
    if (tHit === null) continue;
    crossings.push({ boneIdx: i, detached: distalPos.has(i), t: tHit });
  }

  if (crossings.length === 0) return null;

  // Nearest surface crossing is the hit; a deterministic tie-break (lower
  // boneIdx) makes the result stable.
  crossings.sort((a, b) => a.t - b.t || a.boneIdx - b.boneIdx);
  const owner = crossings[0]!;
  const tMin = owner.t;
  const point: Vec3 = [
    origin[0] + rd[0] * tMin, origin[1] + rd[1] * tMin, origin[2] + rd[2] * tMin,
  ];

  const ownerPose = boneWorldPose(owner.boneIdx);
  const local = worldToLocal(ownerPose, point);

  return {
    point,
    t: tMin,
    boneIdx: owner.boneIdx,
    local,
    detached: owner.detached,
  };
}
