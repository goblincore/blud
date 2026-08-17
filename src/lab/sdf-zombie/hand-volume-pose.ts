// src/lab/sdf-zombie/hand-volume-pose.ts
//
// X1.26 task C1 — the baked hand's per-frame placement, as a pure CPU
// helper. The baked R16F volume never changes; what moves is WHERE it sits
// in the world and how its digits lag. This module derives both from the
// live right-hand prim set:
//
//   rigid  — the wrist/forearm prims' mean (jiggled − unjiggled) offset
//            translates the whole volume with the hand;
//   warp   — the digit/thumb prims' mean residual AFTER removing the rigid
//            offset, projected into the volume's anatomical basis and
//            clamped to 12 mm, becomes the distal domain-warp the sampler
//            ramps in past the wrist (march.wgsl.ts's volumeWarp).
//
// WHY PRIMS AT ALL — the baked hand replaces them as the RENDERED field, but
// they stay the ANIMATION substrate: the pose/bob/jiggle machinery drives
// prim midpoints, and this helper is the bridge that carries that motion
// onto the volume. The Verlet residue (jiggled fingers trailing the posed
// target) is exactly the "flesh weight" the warp is meant to show, and the
// wrist pin comes free because the wrist/forearm group defines the rigid
// term that the residual subtracts.
//
// THE QUATERNION, AND WHY THE DETERMINANT REPAIR IS NOT setProjection'S.
// fpv-view's setProjection documents the hazard: a left-handed basis fed to
// Matrix4.makeBasis is a REFLECTION, and setFromRotationMatrix extracts a
// meaningless quaternion from it. The sheet repair NEGATES THE X COLUMN and
// mirrors the texture uv back with faceProj.x — legal for a projection,
// ILLEGAL here: the volume's x axis IS the thumb side (the manifest's
// 'thumbward'), and negating it would render the thumb on the pinky side of
// every finger. The volume frame is right-handed BY CONSTRUCTION in the
// baker (scripts/bake_hand_sdf.py: Z := cross(X, Y), which on a true RIGHT
// hand points PALMAR — dorsal_sign −1), so the only repair that preserves
// anatomy is to RECOMPUTE z := x × y when the handedness measures negative.
// That reconstructs the baker's own z column exactly, reflection never
// reaches the quaternion, and no mirror flag exists to go stale.
import * as THREE from 'three/webgpu';
import { HAND_PRIM_GROUPS } from './hands';
import type { Primitive, Vec3 } from './types';
import type { HandSheetProjection } from './fpv-mode';
import type { DynamitePropContract } from './webgpu/hand-volume-clip';

/** The spec's warp ceiling. fpv-view re-clamps defensively; this is the
 *  authority the unit tests pin. */
export const HAND_WARP_CLAMP_M = 0.012;

/** The baked volume's frame placement for one frame, ready for
 *  fpv-view's setVolumePose (plus its warpEnabled flag). */
export interface BakedHandPose {
  /** World position of the volume's LOCAL ORIGIN (the baker's wrist pivot,
   *  where the anatomical axes meet) — the shader's volumePose0.xyz. */
  centre: Vec3;
  /** local-to-world rotation, xyzw — the shader's volumePose1. Columns map
   *  volume +X (thumbward) / +Y (distal) / +Z (cross, palmar on this mesh)
   *  onto the projection basis's x / y / x×y. */
  quaternion: [number, number, number, number];
  /** Distal warp residue in the ANATOMICAL basis (x thumbward, y distal,
   *  z palmar), metres; |warpLocal| ≤ HAND_WARP_CLAMP_M. */
  warpLocal: Vec3;
}

/** The right hand's prim groups — the baked volume is right-only (spec), and
 *  role 'lead' IS the right hand (hands.ts's HAND_SIDE_OF_ROLE). */
const GROUPS = HAND_PRIM_GROUPS.lead;
/** Wrist-side prims: their mean jiggled−unjiggled offset is the RIGID term. */
const RIGID_PRIMS: readonly number[] = [...GROUPS.forearm, ...GROUPS.wrist];
/** Digit-side prims: their mean residual (rigid removed) is the WARP term. */
const DISTAL_PRIMS: readonly number[] = [...GROUPS.digits, ...GROUPS.thumb];

/** A prim's capsule midpoint (the jiggle point's own anchor — see
 *  fpv-mode's makeHandJiggle). Missing prims contribute nothing. */
function mid(prims: readonly Primitive[], i: number): Vec3 | null {
  const p = prims[i];
  if (!p) return null;
  return [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
}

/** Mean of `jiggled − unjiggled` midpoints over `idx`, world metres.
 *  Pure index arithmetic; indices absent from either list are skipped. */
function meanDelta(
  unjiggled: readonly Primitive[], jiggled: readonly Primitive[],
  idx: readonly number[],
): Vec3 {
  let x = 0, y = 0, z = 0, n = 0;
  for (const i of idx) {
    const a = mid(unjiggled, i), b = mid(jiggled, i);
    if (!a || !b) continue;
    x += b[0] - a[0]; y += b[1] - a[1]; z += b[2] - a[2]; n++;
  }
  return n === 0 ? [0, 0, 0] : [x / n, y / n, z / n];
}

const bx = new THREE.Vector3();
const by = new THREE.Vector3();
const bz = new THREE.Vector3();
const cross = new THREE.Vector3();
const basisM = new THREE.Matrix4();
const q = new THREE.Quaternion();

/**
 * Derives the baked hand's rigid placement and clamped distal warp from one
 * frame's right-hand prim pair. `unjiggled` is the pose-only field (pose +
 * bob — fpv-mode's posedHandPrims with jiggle points pinned AT the targets);
 * `jiggled` is the same frame with the Verlet residue folded in; both in
 * WORLD space (handPrimsToWorld of each). `projection` is the right hand's
 * world sheet projection (fpv-mode's handSheetProjections().right): its
 * centre seeds the placement and its x/y basis columns are the volume's
 * thumbward/distal axes in world. Pure — no input is mutated.
 */
export function bakedHandPose(
  unjiggled: readonly Primitive[],
  jiggled: readonly Primitive[],
  projection: HandSheetProjection,
): BakedHandPose {
  // Rigid term: the wrist/forearm group's mean lag. The volume's origin
  // rides the projection centre (the posed hand's own centre, so the bake
  // lands where the prim hand sits in frame) translated by this offset.
  const rigid = meanDelta(unjiggled, jiggled, RIGID_PRIMS);
  const centre: Vec3 = [
    projection.centre[0] + rigid[0],
    projection.centre[1] + rigid[1],
    projection.centre[2] + rigid[2],
  ];

  // Orientation: the projection basis is unit/orthogonal by construction
  // (hands.ts's HAND_AXES carried into world); normalize defensively so a
  // drifted input cannot build a scaling quaternion.
  bx.set(projection.basis.x[0], projection.basis.x[1], projection.basis.x[2]).normalize();
  by.set(projection.basis.y[0], projection.basis.y[1], projection.basis.y[2]).normalize();
  bz.set(projection.basis.z[0], projection.basis.z[1], projection.basis.z[2]).normalize();

  // Determinant repair (the volume-safe variant — see the header): a
  // negative triple product means (x, y, z) is a reflection, and the only
  // anatomy-preserving fix is rebuilding z from x×y — the baker's own Z
  // column. On this right hand that is the PALMAR side (dorsal_sign −1),
  // NOT the sheet basis's dorsal z; the thumb stays thumb-side.
  cross.crossVectors(bx, by);
  if (bx.clone().cross(by).dot(bz) < 0) bz.copy(cross);

  basisM.makeBasis(bx, by, bz);
  q.setFromRotationMatrix(basisM);

  // Warp: the digit group's residual after the rigid term, expressed in the
  // anatomical basis, magnitude-clamped to the spec's 12 mm ceiling.
  const raw = meanDelta(unjiggled, jiggled, DISTAL_PRIMS);
  const resid: Vec3 = [raw[0] - rigid[0], raw[1] - rigid[1], raw[2] - rigid[2]];
  let wx = resid[0] * bx.x + resid[1] * bx.y + resid[2] * bx.z;
  let wy = resid[0] * by.x + resid[1] * by.y + resid[2] * by.z;
  let wz = resid[0] * bz.x + resid[1] * bz.y + resid[2] * bz.z;
  const wl = Math.hypot(wx, wy, wz);
  if (wl > HAND_WARP_CLAMP_M) {
    const s = HAND_WARP_CLAMP_M / wl;
    wx *= s; wy *= s; wz *= s;
  }

  return {
    centre,
    quaternion: [q.x, q.y, q.z, q.w],
    warpLocal: [wx, wy, wz],
  };
}

// ——— X1.27 task D2: the held GLB's exact root transform —————————————————
//
// The clip-mode prop is seated from the MANIFEST's authored anchors, never
// from the primitive hand path's prop seats or its procedural prop mesh
// constants: those describe a different bundle, and the spec forbids a
// proxy of a different size. One source of truth composes the transform:
//
//   q_root = q_hand · q_model     (anatomical→world after model→anatomical)
//   grip_world = centre + q_hand · gripLocal
//   root = grip_world − (q_root · ŷ_model) · modelGripOffsetM
//
// The last line inverts the GLB's own GripAnchor placement (the anchor sits
// at model +Y·modelGripOffsetM from the origin/FlightPivot), so seating the
// ROOT at `root` puts the authored grip point on the authored grip seat
// exactly — the same contract the six poses were baked under.
//
// QUATERNION ORDER NOTE — the hand pose arrives xyzw (BakedHandPose's
// convention, above), the manifest's modelRotationLocal arrives (w, x, y,
// z), and the OUTPUT BakedPropPose.quaternion is (w, x, y, z) to match
// dynamite-prop.ts's DynamitePose end to end. This function is the one
// place the two conventions meet.

/** The held GLB's world transform for one animated baked-hand frame. */
export interface BakedPropPose {
  /** The GLB root / FlightPivot in world space, metres. */
  position: Vec3;
  /** (w, x, y, z) — model-local → world for the GLB root. */
  quaternion: [number, number, number, number];
}

// Dedicated scratch (bakedHandPose's are owned by its basis repair).
const dqHand = new THREE.Quaternion();
const dqModel = new THREE.Quaternion();
const dqRoot = new THREE.Quaternion();
const dvGrip = new THREE.Vector3();
const dvAxis = new THREE.Vector3();

/**
 * Derives the exact held-prop transform from one animated baked hand pose
 * and the clip manifest's prop contract. The hand quaternion is the volume's
 * full local-to-world rotation (including any wrist swing a caller composed
 * onto it); `warpLocal` is deliberately IGNORED — the warp is a field-domain
 * sampling warp inside the volume (march.wgsl.ts), not object motion, and
 * the prop rides the rigid frame. Pure — no input is mutated.
 */
export function bakedDynamitePose(
  hand: BakedHandPose,
  prop: DynamitePropContract,
): BakedPropPose {
  // hand: xyzw; modelRotationLocal: (w, x, y, z).
  dqHand.set(hand.quaternion[0], hand.quaternion[1], hand.quaternion[2], hand.quaternion[3]);
  const mr = prop.modelRotationLocal;
  dqModel.set(mr[1], mr[2], mr[3], mr[0]);
  dqRoot.copy(dqHand).multiply(dqModel).normalize();

  // Bundle long axis in world: model +Y under the composed rotation.
  dvAxis.set(0, 1, 0).applyQuaternion(dqRoot);
  // Authored grip seat: anatomical local → world, riding the hand centre.
  dvGrip.set(prop.gripLocal[0], prop.gripLocal[1], prop.gripLocal[2]).applyQuaternion(dqHand);
  // Root sits at −axis·offset from the grip (the GripAnchor inversion).
  const position: Vec3 = [
    hand.centre[0] + dvGrip.x - dvAxis.x * prop.modelGripOffsetM,
    hand.centre[1] + dvGrip.y - dvAxis.y * prop.modelGripOffsetM,
    hand.centre[2] + dvGrip.z - dvAxis.z * prop.modelGripOffsetM,
  ];
  return { position, quaternion: [dqRoot.w, dqRoot.x, dqRoot.y, dqRoot.z] };
}
