// src/lab/sdf-zombie/humanoid-sever.ts
//
// Task 4 — the pure sever ownership state layered over the existing
// deterministic gib-chunks.ts stepper. On the sever frame the state:
//
//   1. places the distal root at the posed cut-plane centre (the nearest
//      point of `rightArm.cutPlaneLocal` to the forearm bind origin, posed
//      into world by the current forearm pose);
//   2. freezes the forearm/hand subtree (pose.distalIndices) RELATIVE to
//      that root, so the internal hand-to-forearm relationship rides the
//      chunk rigidly as it tumbles;
//   3. creates `makeChunk('armR', …)` with the inherited linear velocity and
//      then OVERWRITES the generated angVel with the inherited angular
//      velocity — the explicit overwrite the plan prescribes so makeChunk's
//      API stays untouched (the seeded rng still makes the spawn draw
//      deterministic across sever/reset cycles);
//   4. flips the complementary cut masks and detaches the view.
//
// `stepHumanoidSever` delegates translation/rotation/floor behaviour to
// `stepChunk`, detects the airborne→grounded transition with meaningful
// impact speed, and drives a bounded, exponentially decaying jiggle impulse
// that Task 5/6 turn into cap/surface deformation. Pause freezes the
// physics pose while the rest of the page keeps rendering.
//
// Pinned sever constants (manifest.rightArm) are consumed, never invented:
// cutPlaneLocal, cutSeed, irregularityM, rimWidthM. The state additionally
// carries two manifest-derived physics knobs — `forearmRadius` (half the
// forearm's lateral occupied extent) and `severSeed` — because
// severForearm/stepHumanoidSever receive no manifest.

import type { Vec3 } from './types';
import { qMul, qNormalize, qRotate, type Quat } from './vec';
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';
import type { HumanoidVolumeManifest } from './webgpu/humanoid-volume';
import {
  distalBoneIndices,
  type HumanoidBonePose, type HumanoidPoseState,
} from './humanoid-pose';

export type SeverPhase = 'intact' | 'detached';
export type CutMode = 'none' | 'proximal' | 'distal';

/** The renderer-facing cut contract; Tasks 5–7 consume this exact shape. */
export interface SeverRenderState {
  attachedCutMode: CutMode;
  detachedCutMode: CutMode;
  /** [nx, ny, nz, w] in RightForeArm bind-local space (unit normal). */
  cutPlaneLocal: readonly [number, number, number, number];
  detachedVisible: boolean;
  /** Bounded impact-excited deformation amplitude (0..SEVER_JIGGLE_MAX). */
  jiggleImpulse: number;
}

export interface HumanoidSeverState {
  phase: SeverPhase;
  releaseCount: number;
  chunk: Chunk | null;
  /** Distal subtree poses frozen RELATIVE to the chunk root at sever time. */
  frozenDistalBones: readonly HumanoidBonePose[];
  render: SeverRenderState;
  /** Internal physics knobs derived from the manifest at make time. */
  forearmRadius: number;
  severSeed: number;
}

export interface ReleaseVelocity {
  linear: Vec3;
  angular: Vec3;
}

/** Jiggle ceiling — the shader's deformation amplitude saturates here. */
export const SEVER_JIGGLE_MAX = 1;
/** Exponential jiggle decay rate (1/s) toward rest. */
export const SEVER_JIGGLE_DECAY_PER_S = 3;
/** Below this impact speed no jiggle is excited (settling, not impact). */
const SEVER_IMPACT_MIN_SPEED = 0.3;
/** Impulse per m/s of impact speed, capped at SEVER_IMPACT_CAP. */
const SEVER_IMPACT_SCALE = 0.15;
const SEVER_IMPACT_CAP = 0.6;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** Deterministic mulberry32 PRNG, seeded from the manifest cutSeed so the
 *  spawn draw (overwritten anyway) is reproducible across sever/reset. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finiteChunk(c: Chunk): boolean {
  return [...c.pos, ...c.vel, ...c.angVel, ...c.quat, c.squash]
    .every(Number.isFinite);
}

/** Intact state with the sever control parked. Stepping it is a no-op. */
export function makeHumanoidSever(manifest: HumanoidVolumeManifest): HumanoidSeverState {
  const fa = manifest.bones.find(b => b.bone === manifest.rightArm.forearm);
  if (!fa) throw new Error(`humanoid sever: manifest is missing the ${manifest.rightArm.forearm} brick`);
  const spanX = fa.occupiedBoundsMax[0] - fa.occupiedBoundsMin[0];
  const spanZ = fa.occupiedBoundsMax[2] - fa.occupiedBoundsMin[2];
  return {
    phase: 'intact',
    releaseCount: 0,
    chunk: null,
    frozenDistalBones: [],
    forearmRadius: 0.5 * Math.max(spanX, spanZ),
    severSeed: manifest.rightArm.cutSeed,
    render: {
      attachedCutMode: 'none',
      detachedCutMode: 'none',
      cutPlaneLocal: [...manifest.rightArm.cutPlaneLocal],
      detachedVisible: false,
      jiggleImpulse: 0,
    },
  };
}

/**
 * Transfers ownership of the distal forearm+hand to a detached chunk at the
 * pose's cut-plane centre. Idempotent: a second call on an already-detached
 * state returns the SAME object (exactly-once transfer). Pure — the input
 * state and pose are not mutated.
 */
export function severForearm(
  state: HumanoidSeverState,
  pose: HumanoidPoseState,
  velocity: ReleaseVelocity,
): HumanoidSeverState {
  if (state.phase === 'detached') return state;

  const faIdx = pose.distalIndices[0];
  if (faIdx === undefined) throw new Error('humanoid sever: pose has no distal bones');
  const faPose = pose.bones[faIdx];
  if (!faPose) throw new Error('humanoid sever: pose is missing the forearm bone');

  // Distal root at the cut-plane centre: the nearest plane point to the
  // forearm bind origin, posed into world by the CURRENT forearm pose.
  const [nx, ny, nz, w] = state.render.cutPlaneLocal;
  const planePoint: Vec3 = [-w * nx, -w * ny, -w * nz];
  const rootPos = add(faPose.position, qRotate(faPose.quaternion, planePoint));

  // The chunk's long axis follows the posed forearm (bind-local +Y is the
  // distal direction), so the severed piece topples flat like a limb.
  const forearmAxis = qRotate(faPose.quaternion, [0, 1, 0]);

  const chunk = makeChunk(
    'armR', rootPos, velocity.linear, state.forearmRadius,
    forearmAxis, mulberry32(state.severSeed), 'limb',
  );
  // Explicit overwrite: preserve the supplied angular velocity without
  // changing makeChunk's API (the plan's prescribed transfer).
  chunk.angVel = velocity.angular;

  // Freeze the distal subtree relative to the root. The root quaternion is
  // identity at release, but compose generally so the recomposition
  // `root ⊕ rel` used by the view is exact under any future root.
  const frozenDistalBones = pose.distalIndices.map(i => {
    const b = pose.bones[i]!;
    return {
      position: qRotate(qConj(chunk.quat), sub(b.position, chunk.pos)),
      quaternion: qNormalize(qMul(qConj(chunk.quat), b.quaternion)),
    };
  });

  return {
    ...state,
    phase: 'detached',
    releaseCount: 1,
    chunk,
    frozenDistalBones,
    render: {
      ...state.render,
      attachedCutMode: 'proximal',
      detachedCutMode: 'distal',
      detachedVisible: true,
      jiggleImpulse: 0,
    },
  };
}

/**
 * Advances the detached chunk by `dt` through the existing gib-chunks
 * stepper, detects the airborne→grounded transition with a meaningful
 * impact speed, and drives the bounded exponentially decaying jiggle
 * impulse. `paused` freezes the physics pose (same chunk values) while the
 * rest of the page keeps rendering. Intact states, dt <= 0 and non-finite
 * dt are no-ops returning the same object. Pure — no input is mutated.
 */
export function stepHumanoidSever(
  state: HumanoidSeverState,
  dt: number,
  paused: boolean,
): HumanoidSeverState {
  if (state.phase !== 'detached' || state.chunk === null) return state;
  if (!Number.isFinite(dt) || dt <= 0 || paused) return state;

  const before = state.chunk;
  let chunk = stepChunk(before, dt);
  if (!finiteChunk(chunk)) {
    // stepChunk's own fallback zeroes velocities but keeps the input pos;
    // if the INPUT was already non-finite, fall back to the pre-step chunk
    // with zeroed spin — deterministic and finite whenever the input was.
    chunk = { ...before, vel: [0, 0, 0], angVel: [0, 0, 0] };
  }

  let jiggleImpulse = state.render.jiggleImpulse;
  const wasAirborne = before.pos[1] > before.radius + 1e-9;
  const impactSpeed = -before.vel[1];
  if (wasAirborne && chunk.pos[1] === chunk.radius && impactSpeed >= SEVER_IMPACT_MIN_SPEED) {
    jiggleImpulse = Math.min(
      SEVER_JIGGLE_MAX,
      jiggleImpulse + Math.min(SEVER_IMPACT_CAP, SEVER_IMPACT_SCALE * impactSpeed),
    );
  }
  jiggleImpulse *= Math.exp(-SEVER_JIGGLE_DECAY_PER_S * dt);
  if (!Number.isFinite(jiggleImpulse) || jiggleImpulse < 0) jiggleImpulse = 0;

  return {
    ...state,
    chunk,
    render: { ...state.render, jiggleImpulse },
  };
}

/** Parks the severed state back to intact. Idempotent: resetting an already
 *  intact state yields an equal state. Pure — no input is mutated. */
export function resetHumanoidSever(state: HumanoidSeverState): HumanoidSeverState {
  return {
    ...state,
    phase: 'intact',
    releaseCount: 0,
    chunk: null,
    frozenDistalBones: [],
    render: {
      ...state.render,
      attachedCutMode: 'none',
      detachedCutMode: 'none',
      detachedVisible: false,
      jiggleImpulse: 0,
    },
  };
}
