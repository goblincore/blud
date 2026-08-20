// src/lab/sdf-zombie/humanoid-target.test.ts
//
// Task 10 — click-to-shoot targeting. `traceHumanoidRay` sphere-traces the
// coarse CPU brick in BIND-LOCAL space, never the bounding box: the broad
// phase is a ray-versus-posed-occupied-OBB that only yields the candidate set
// and an entry `t`, then the coarse field decides the nearest surface crossing
// and the owning bone. These tests pin the four properties the plan Step 1
// demands, plus the detached-piece rule:
//
//   1. a forearm hit lands within 5 mm of the true surface, not on the OBB
//      face (synthetic sphere + cylinder fixtures with analytic ground truth);
//   2. the returned boneIdx comes from the trace — the bone whose coarse field
//      is actually smaller, never a nearest-endpoint/box heuristic;
//   3. rays are tested against the POSED body (a flexed-elbow ray that would
//      hit the bind-pose forearm and misses the flexed one must miss);
//   4. a short secondary refinement converges to a few millimetres;
//   5. after a sever, a ray at the grounded chunk produces a hit routed to the
//      detached piece.
//
// No GPU readback anywhere: the coarse pack is read as CPU f32, exactly as the
// loader exposes it.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  validateHumanoidVolumeManifest,
  type HumanoidVolumeManifest,
  type HumanoidCoarseBricks,
  type HumanoidCoarseBrick,
} from './webgpu/humanoid-volume';
import {
  makeHumanoidPose,
  type HumanoidPoseState,
  type HumanoidBonePose,
} from './humanoid-pose';
import {
  makeHumanoidSever,
  severForearm,
  chunkBoneWorldPose,
  type HumanoidSeverState,
} from './humanoid-sever';
import { traceHumanoidRay, sampleHumanoidCoarseField } from './humanoid-target';
import { add, qNormalize, qRotate, type Quat } from './vec';
import type { Vec3 } from './types';

const realManifest = validateHumanoidVolumeManifest(JSON.parse(
  readFileSync('public/assets/lab/humanoid-sdf/zombie-humanoid.json', 'utf8'),
));

const faIdx = realManifest.bones.findIndex(b => b.bone === 'RightForeArm');
const raIdx = realManifest.bones.findIndex(b => b.bone === 'RightArm');
const handIdx = realManifest.bones.findIndex(b => b.bone === 'RightHand');
if (faIdx < 0 || raIdx < 0 || handIdx < 0) {
  throw new Error('checked-in manifest is missing the right-arm chain');
}

/** The real coarse CPU pack, read exactly as the loader exposes it (f32-le,
 *  x-fastest-y-z, bound to manifest.bones[].boundsMin/Max). */
function loadRealCoarse(manifest: HumanoidVolumeManifest): HumanoidCoarseBricks {
  const buf = readFileSync('public/assets/lab/humanoid-sdf/zombie-coarse.f32');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const bones: HumanoidCoarseBrick[] = manifest.coarse.bones.map((spec, i) => ({
    data: new Float32Array(ab, spec.offset, spec.byteLength / 4),
    dims: spec.dims,
    boundsMin: manifest.bones[i]!.boundsMin,
    boundsMax: manifest.bones[i]!.boundsMax,
  }));
  return {
    bones,
    combinedByteLength: manifest.coarse.combinedByteLength,
    combinedSha256: manifest.coarse.combinedSha256,
    dispose() {},
  };
}
const realCoarse = loadRealCoarse(realManifest);

// -- small local math (mirrors humanoid-damage.ts's closed-form rigid frame) ---

const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const worldToLocal = (pose: HumanoidBonePose, w: Vec3): Vec3 =>
  qRotate(qConj(qNormalize(pose.quaternion)), sub(w, pose.position));
const localToWorld = (pose: HumanoidBonePose, local: Vec3): Vec3 =>
  add(pose.position, qRotate(qNormalize(pose.quaternion), local));
const dist = (a: Vec3, b: Vec3 = [0, 0, 0]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function occupiedCenter(manifest: HumanoidVolumeManifest, boneIdx: number): Vec3 {
  const b = manifest.bones[boneIdx]!;
  return [
    (b.occupiedBoundsMin[0] + b.occupiedBoundsMax[0]) / 2,
    (b.occupiedBoundsMin[1] + b.occupiedBoundsMax[1]) / 2,
    (b.occupiedBoundsMin[2] + b.occupiedBoundsMax[2]) / 2,
  ];
}

// ---------------------------------------------------------------------------
// Synthetic fixtures — analytic ground truth for the geometric contracts
// ---------------------------------------------------------------------------

/** Samples an analytic SDF onto a f32 coarse brick (x-fastest-y-z). */
function makeSyntheticBrick(
  sdf: (l: Vec3) => number,
  boundsMin: Vec3,
  boundsMax: Vec3,
  dims: [number, number, number] = [16, 16, 16],
): HumanoidCoarseBrick {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const lx = boundsMin[0] + (boundsMax[0] - boundsMin[0]) * (x / (nx - 1));
        const ly = boundsMin[1] + (boundsMax[1] - boundsMin[1]) * (y / (ny - 1));
        const lz = boundsMin[2] + (boundsMax[2] - boundsMin[2]) * (z / (nz - 1));
        data[x + y * nx + z * nx * ny] = sdf([lx, ly, lz]);
      }
    }
  }
  return {
    data,
    dims,
    boundsMin: [boundsMin[0], boundsMin[1], boundsMin[2]],
    boundsMax: [boundsMax[0], boundsMax[1], boundsMax[2]],
  };
}

interface MiniBone {
  name: string;
  occupiedMin: Vec3;
  occupiedMax: Vec3;
  brick: HumanoidCoarseBrick;
}

/** A minimal manifest + coarse pack + pose + sever over the given synthetic
 *  bones — only the fields traceHumanoidRay reads are real. */
function miniEnv(
  bones: MiniBone[],
  poseBones: HumanoidBonePose[],
  distalIndices: number[] = [],
): {
  manifest: HumanoidVolumeManifest;
  coarse: HumanoidCoarseBricks;
  pose: HumanoidPoseState;
  sever: HumanoidSeverState;
} {
  const manifest = {
    bones: bones.map(b => ({
      bone: b.name,
      occupiedBoundsMin: b.occupiedMin,
      occupiedBoundsMax: b.occupiedMax,
    })),
  } as unknown as HumanoidVolumeManifest;
  const coarse: HumanoidCoarseBricks = {
    bones: bones.map(b => b.brick),
    combinedByteLength: 0,
    combinedSha256: '0'.repeat(64),
    dispose() {},
  };
  const pose = { bones: poseBones, distalIndices } as unknown as HumanoidPoseState;
  const sever = {
    phase: 'intact', chunk: null, frozenDistalBones: [],
  } as unknown as HumanoidSeverState;
  return { manifest, coarse, pose, sever };
}

const SPHERE_R = 0.1;
const sphereSdf = (l: Vec3): number => Math.hypot(l[0], l[1], l[2]) - SPHERE_R;

function sphereEnv(center: Vec3 = [0, 0, 0], quaternion: Quat = [0, 0, 0, 1]) {
  const brick = makeSyntheticBrick(
    (l) => Math.hypot(l[0] - center[0], l[1] - center[1], l[2] - center[2]) - SPHERE_R,
    [-0.15, -0.15, -0.15], [0.15, 0.15, 0.15],
  );
  const env = miniEnv(
    [{
      name: 'Sphere',
      occupiedMin: [-SPHERE_R, -SPHERE_R, -SPHERE_R],
      occupiedMax: [SPHERE_R, SPHERE_R, SPHERE_R],
      brick,
    }],
    [{ position: [0, 0, 0], quaternion }],
  );
  return env;
}

describe('traceHumanoidRay — sphere-traces the field, not the box', () => {
  it('lands within 5 mm of a sphere surface, not on the OBB face', () => {
    const { manifest, coarse, pose, sever } = sphereEnv();
    // Diagonal ray aimed through the sphere: the occupied-box corner is at
    // sqrt(3)*R ~ 0.173 from the centre, the sphere surface at R = 0.1 — the
    // OBB-only hit would land ~7 cm off the round surface.
    const origin: Vec3 = [-0.5, -0.5, -0.5];
    const dir = norm([1, 1, 1]);
    const hit = traceHumanoidRay(manifest, coarse, pose, sever, origin, dir);
    expect(hit).not.toBeNull();
    expect(Math.abs(dist(hit!.point) - SPHERE_R)).toBeLessThan(0.005);
    // Strictly inside the occupied box — not sitting on its face.
    for (const k of [0, 1, 2]) {
      expect(Math.abs(hit!.point[k]!)).toBeLessThan(SPHERE_R - 0.005);
    }
    expect(hit!.boneIdx).toBe(0);
    expect(hit!.detached).toBe(false);
    // The returned local round-trips to the world hit.
    expect(dist(localToWorld(pose.bones[0]!, hit!.local), hit!.point)).toBeLessThan(1e-6);
  });

  it('lands within 5 mm of a cylinder (limb) side, not on the OBB corner', () => {
    const r = 0.045;
    const halfLen = 0.125;
    const cy = 0.125;
    const brick = makeSyntheticBrick(
      (l) => Math.max(Math.abs(l[1] - cy) - halfLen, Math.hypot(l[0], l[2]) - r),
      [-r - 0.02, -0.02, -r - 0.02], [r + 0.02, 0.27, r + 0.02],
    );
    const env = miniEnv(
      [{
        name: 'ForeArm', occupiedMin: [-r, 0, -r], occupiedMax: [r, 0.25, r], brick,
      }],
      [{ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }],
    );
    // Diagonal ray in XZ at the cylinder's mid-height: the OBB corner is at
    // sqrt(2)*r ~ 0.064 from the axis, the round side at r = 0.045 (~19 mm
    // apart — the "craters float off thin limbs" failure).
    const origin: Vec3 = [-0.5, cy, -0.5];
    const dir = norm([1, 0, 1]);
    const hit = traceHumanoidRay(env.manifest, env.coarse, env.pose, env.sever, origin, dir);
    expect(hit).not.toBeNull();
    expect(Math.abs(Math.hypot(hit!.point[0], hit!.point[2]) - r)).toBeLessThan(0.005);
    expect(Math.abs(hit!.point[0])).toBeLessThan(r - 0.005);
    expect(Math.abs(hit!.point[2])).toBeLessThan(r - 0.005);
  });

  it('refines to a few millimetres, well inside the coarse voxel', () => {
    // Coarse pitch is 0.3 / 15 = 20 mm; the raw trace lands within ~a voxel.
    // The secondary refinement must converge to a few mm of the true surface.
    const { manifest, coarse, pose, sever } = sphereEnv();
    const origin: Vec3 = [-0.4, 0.1, 0.6];
    const dir = norm([0.4, -0.1, -0.6]);
    const hit = traceHumanoidRay(manifest, coarse, pose, sever, origin, dir);
    expect(hit).not.toBeNull();
    expect(Math.abs(dist(hit!.point) - SPHERE_R)).toBeLessThan(0.003);
  });

  it('the nearest surface crossing is the owner — no endpoint heuristic', () => {
    // Two overlapping spheres; the ray crosses A first. The owner must be A,
    // decided by the field's crossing order, not by which centre is nearer.
    const brickA = makeSyntheticBrick(
      (l) => Math.hypot(l[0], l[1], l[2]) - 0.15, [-0.2, -0.2, -0.2], [0.2, 0.2, 0.2],
    );
    const brickB = makeSyntheticBrick(
      (l) => Math.hypot(l[0] - 0.2, l[1], l[2]) - 0.15, [0.0, -0.2, -0.2], [0.4, 0.2, 0.2],
    );
    const env = miniEnv(
      [
        { name: 'A', occupiedMin: [-0.15, -0.15, -0.15], occupiedMax: [0.15, 0.15, 0.15], brick: brickA },
        { name: 'B', occupiedMin: [0.05, -0.15, -0.15], occupiedMax: [0.35, 0.15, 0.15], brick: brickB },
      ],
      [{ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }, { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }],
    );
    const origin: Vec3 = [-2, 0, 0];
    const dir: Vec3 = [1, 0, 0];
    const hit = traceHumanoidRay(env.manifest, env.coarse, env.pose, env.sever, origin, dir);
    expect(hit).not.toBeNull();
    expect(hit!.boneIdx).toBe(0);
    // The coarse trilinear zero-crossing is within a few mm of the analytic
    // surface; the point of this test is the OWNER (A, not B), not sub-mm.
    expect(Math.abs(hit!.point[0] - (-0.15))).toBeLessThan(0.005);
  });

  it('raycasts the POSED body — a rotated-away body must miss', () => {
    // Sphere authored off-centre at bind-local (0.3, 0, 0). At identity pose a
    // +X ray hits it; under a 90° Y-rotation it swings to (0, 0, -0.3) and the
    // same ray (z == 0) misses. A trace that ignored the pose quaternion would
    // still hit the bind-local sphere.
    const center: Vec3 = [0.3, 0, 0];
    const brick = makeSyntheticBrick(
      (l) => Math.hypot(l[0] - center[0], l[1] - center[1], l[2] - center[2]) - SPHERE_R,
      [-0.15, -0.15, -0.15], [0.45, 0.15, 0.15], [16, 8, 8],
    );
    const env = miniEnv(
      [{
        name: 'Sphere',
        occupiedMin: [0.3 - SPHERE_R, -SPHERE_R, -SPHERE_R],
        occupiedMax: [0.3 + SPHERE_R, SPHERE_R, SPHERE_R],
        brick,
      }],
      [{ position: [0, 0, 0], quaternion: [0, 0, 0, 1] }],
    );
    const origin: Vec3 = [-1, 0, 0];
    const dir: Vec3 = [1, 0, 0];
    const hit = traceHumanoidRay(env.manifest, env.coarse, env.pose, env.sever, origin, dir);
    expect(hit).not.toBeNull();
    expect(hit!.boneIdx).toBe(0);

    // 90° about +Y: +X -> -Z.
    const q90y: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const posed = miniEnv(
      [{
        name: 'Sphere',
        occupiedMin: [0.3 - SPHERE_R, -SPHERE_R, -SPHERE_R],
        occupiedMax: [0.3 + SPHERE_R, SPHERE_R, SPHERE_R],
        brick,
      }],
      [{ position: [0, 0, 0], quaternion: q90y }],
    );
    const miss = traceHumanoidRay(posed.manifest, posed.coarse, posed.pose, posed.sever, origin, dir);
    expect(miss).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real asset — owner selection, posed-ray, and the detached piece
// ---------------------------------------------------------------------------

function intactState(deg: number): HumanoidPoseState {
  return makeHumanoidPose(realManifest, { elbowDeg: deg, softness01: 0 });
}

describe('traceHumanoidRay — the real baked humanoid', () => {
  it('keys a mid-forearm hit to RightForeArm', () => {
    const state = intactState(0);
    const sever = makeHumanoidSever(realManifest);
    const world = localToWorld(state.bones[faIdx]!, occupiedCenter(realManifest, faIdx));
    const origin: Vec3 = [0, 1.0, 3];
    const hit = traceHumanoidRay(realManifest, realCoarse, state, sever, origin, norm(sub(world, origin)));
    expect(hit).not.toBeNull();
    expect(hit!.boneIdx).toBe(faIdx);
    expect(hit!.detached).toBe(false);
  });

  it('the elbow band picks the bone whose coarse field is actually smaller', () => {
    const state = intactState(0);
    const sever = makeHumanoidSever(realManifest);
    // Aim at the elbow joint centre (inside both occupied boxes) from directly
    // in front at the same height, so the ray crosses the arm surface in the
    // 30 mm overlap band.
    const elbow = realManifest.joints.find(j => j.child === 'RightForeArm')!.centerModel;
    const origin: Vec3 = [0, elbow[1], 2];
    const hit = traceHumanoidRay(realManifest, realCoarse, state, sever, origin, norm(sub(elbow, origin)));
    expect(hit).not.toBeNull();
    expect([raIdx, faIdx]).toContain(hit!.boneIdx);

    // The owner is the bone whose coarse field at the hit is smaller (more
    // inside), never a nearest-box tie-break.
    const fFa = sampleHumanoidCoarseField(realCoarse.bones[faIdx]!, worldToLocal(state.bones[faIdx]!, hit!.point));
    const fRa = sampleHumanoidCoarseField(realCoarse.bones[raIdx]!, worldToLocal(state.bones[raIdx]!, hit!.point));
    if (hit!.boneIdx === faIdx) {
      expect(fFa).toBeLessThanOrEqual(fRa);
    } else {
      expect(fRa).toBeLessThanOrEqual(fFa);
    }
  });

  it('a flexed-elbow ray that hit the bind forearm misses the flexed one', () => {
    const bind = intactState(0);
    const flexed = intactState(100);
    const sever = makeHumanoidSever(realManifest);
    // Aim at the bind-pose DISTAL forearm (near the wrist). The forearm hangs
    // down (y ~ 1.09..1.16) at rest; under 100° flexion it curls up and back
    // (y ~ 1.16..1.21), vacating the low region the ray crosses.
    const world = localToWorld(bind.bones[faIdx]!, [0, 0.22, 0]);
    const origin: Vec3 = [0, 0.95, 3];
    const dir = norm(sub(world, origin));

    const hitBind = traceHumanoidRay(realManifest, realCoarse, bind, sever, origin, dir);
    expect(hitBind).not.toBeNull();
    expect(bind.distalIndices).toContain(hitBind!.boneIdx);

    // The forearm curled up under flexion; the same ray passes through its old
    // position and must not land on any distal (right-arm) bone.
    const hitFlexed = traceHumanoidRay(realManifest, realCoarse, flexed, sever, origin, dir);
    expect(hitFlexed === null || !flexed.distalIndices.includes(hitFlexed.boneIdx)).toBe(true);
  });

  it('the detached chunk is a target after a sever', () => {
    const state = intactState(0);
    const sever = severForearm(makeHumanoidSever(realManifest), state, { linear: [0, 0, 0], angular: [0, 0, 0] });
    expect(sever.phase).toBe('detached');
    const chunk = sever.chunk!;

    // The hand's world pose under the chunk root (identity at release) is the
    // original hand pose — aim at its occupied centre.
    const handDistalPos = state.distalIndices.indexOf(handIdx);
    const frozenHand = sever.frozenDistalBones[handDistalPos]!;
    const handWorld = localToWorld(chunkBoneWorldPose(chunk, frozenHand), occupiedCenter(realManifest, handIdx));
    const origin: Vec3 = [0, 0.95, 3];
    const hit = traceHumanoidRay(realManifest, realCoarse, state, sever, origin, norm(sub(handWorld, origin)));
    expect(hit).not.toBeNull();
    expect(hit!.detached).toBe(true);
    expect(state.distalIndices).toContain(hit!.boneIdx);
  });
});
