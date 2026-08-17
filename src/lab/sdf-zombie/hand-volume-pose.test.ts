// src/lab/sdf-zombie/hand-volume-pose.test.ts
//
// X1.26 task C1 — the baked-hand pose derivation: rigid wrist/forearm
// translation, distal warp residual in the anatomical basis, the 12 mm
// clamp, the volume-safe determinant repair, and input purity.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { bakedHandPose, HAND_WARP_CLAMP_M } from './hand-volume-pose';
import { HAND_PRIM_GROUPS } from './hands';
import type { HandSheetProjection } from './fpv-mode';
import type { Primitive, Vec3 } from './types';

/** The lead (RIGHT) hand's prim order — forearm, wrist, fist, knuckleRidge,
 *  fingerWrap, fingerTips, thumbBase, thumbTip. Midpoints sit on a plausible
 *  axis line; only midpoints matter to the helper. */
function handPrims(): Primitive[] {
  const mids: Vec3[] = [
    [0, -0.15, 0],   // 0 forearm
    [0, -0.05, 0],   // 1 wrist
    [0, 0.00, 0],    // 2 fist (mass)
    [0.010, 0.050, 0], // 3 knuckleRidge (digits)
    [0.000, 0.060, 0], // 4 fingerWrap (digits)
    [-0.010, 0.050, 0], // 5 fingerTips (digits)
    [0.030, 0.020, 0],  // 6 thumbBase
    [0.040, 0.040, 0],  // 7 thumbTip
  ];
  return mids.map(m => ({
    a: [...m] as Vec3, b: [...m] as Vec3,
    radius: 0.01, scale: [1, 1, 1] as Vec3, blendK: 0.01,
    limb: 'armR' as const, cluster: 0,
  }));
}

/** A RIGHT-hand sheet projection: (thumbward, distal, dorsal) is a
 *  LEFT-handed triple, so this basis exercises the determinant repair. */
const RIGHT_HAND_PROJECTION: HandSheetProjection = {
  centre: [0, 0.02, 0],
  basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] },
  halfExtent: [0.08, 0.08, 0.07],
};

/** Prims with `idx` midpoints translated by `d` (world metres). */
function shifted(prims: Primitive[], idx: readonly number[], d: Vec3): Primitive[] {
  return prims.map((p, i) => idx.includes(i) ? {
    ...p,
    a: [p.a[0] + d[0], p.a[1] + d[1], p.a[2] + d[2]] as Vec3,
    b: [p.b[0] + d[0], p.b[1] + d[1], p.b[2] + d[2]] as Vec3,
  } : p);
}

const RIGID = [...HAND_PRIM_GROUPS.lead.forearm, ...HAND_PRIM_GROUPS.lead.wrist];
const DISTAL = [...HAND_PRIM_GROUPS.lead.digits, ...HAND_PRIM_GROUPS.lead.thumb];

/** Applies the pose quaternion to a local unit axis, for basis checks. */
function rotate(
  quaternion: [number, number, number, number], v: [number, number, number],
): THREE.Vector3 {
  const q = new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  return new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q);
}

describe('bakedHandPose', () => {
  it('rest identity: no jiggle residue is a zero warp at the projection centre', () => {
    const rest = handPrims();
    const pose = bakedHandPose(rest, rest.map(p => ({ ...p })), RIGHT_HAND_PROJECTION);
    expect(pose.warpLocal).toEqual([0, 0, 0]);
    expect(pose.centre).toEqual(RIGHT_HAND_PROJECTION.centre);
  });

  it('10 mm distal lag: digit residue lands on the anatomical y axis', () => {
    const rest = handPrims();
    // Digits trail 10 mm along world distal (the projection's y basis).
    const lag: Vec3 = [0, 0.010, 0];
    const pose = bakedHandPose(rest, shifted(rest, DISTAL, lag), RIGHT_HAND_PROJECTION);
    expect(pose.warpLocal[0]).toBeCloseTo(0, 12);
    expect(pose.warpLocal[1]).toBeCloseTo(0.010, 12);
    expect(pose.warpLocal[2]).toBeCloseTo(0, 12);
    // The wrist group did not move: no rigid translation.
    expect(pose.centre).toEqual(RIGHT_HAND_PROJECTION.centre);
  });

  it('pinned wrist: wrist/forearm lag is the rigid translation, not warp', () => {
    const rest = handPrims();
    const d: Vec3 = [0.002, -0.001, 0.003];
    // EVERYTHING shifts by d — a rigid camera carry. The distal residual
    // after removing the rigid term must be zero, and the centre rides d.
    const pose = bakedHandPose(rest, shifted(rest, [...RIGID, ...DISTAL], d), RIGHT_HAND_PROJECTION);
    expect(pose.warpLocal[0]).toBeCloseTo(0, 12);
    expect(pose.warpLocal[1]).toBeCloseTo(0, 12);
    expect(pose.warpLocal[2]).toBeCloseTo(0, 12);
    expect(pose.centre[0]).toBeCloseTo(RIGHT_HAND_PROJECTION.centre[0] + d[0], 12);
    expect(pose.centre[1]).toBeCloseTo(RIGHT_HAND_PROJECTION.centre[1] + d[1], 12);
    expect(pose.centre[2]).toBeCloseTo(RIGHT_HAND_PROJECTION.centre[2] + d[2], 12);
  });

  it('basis conversion: a world −X lag reads as local +y under a rotated basis', () => {
    const rest = handPrims();
    // Same 90°-rotated right-hand frame: local +y (distal) is world −X.
    const projection: HandSheetProjection = {
      centre: [0, 0.02, 0],
      basis: { x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, -1] },
      halfExtent: [0.08, 0.08, 0.07],
    };
    const pose = bakedHandPose(rest, shifted(rest, DISTAL, [-0.010, 0, 0]), projection);
    expect(pose.warpLocal[0]).toBeCloseTo(0, 12);
    expect(pose.warpLocal[1]).toBeCloseTo(0.010, 12);
    expect(pose.warpLocal[2]).toBeCloseTo(0, 12);
  });

  it('clamps the warp magnitude to 12 mm, preserving direction', () => {
    const rest = handPrims();
    const pose = bakedHandPose(rest, shifted(rest, DISTAL, [0, 0.030, 0]), RIGHT_HAND_PROJECTION);
    expect(Math.hypot(...pose.warpLocal)).toBeCloseTo(HAND_WARP_CLAMP_M, 12);
    expect(pose.warpLocal[1]).toBeCloseTo(HAND_WARP_CLAMP_M, 12);
    expect(pose.warpLocal[0]).toBeCloseTo(0, 12);
  });

  it('determinant repair: quaternion maps thumbward/distal verbatim and z := x × y', () => {
    const rest = handPrims();
    const pose = bakedHandPose(rest, rest, RIGHT_HAND_PROJECTION);
    const q = new THREE.Quaternion(...pose.quaternion);
    expect(q.length()).toBeCloseTo(1, 12);

    // Local +X (the volume's thumb side) -> the projection's thumbward x.
    const x = rotate(pose.quaternion, [1, 0, 0]);
    expect(x.x).toBeCloseTo(1, 9); expect(x.y).toBeCloseTo(0, 9); expect(x.z).toBeCloseTo(0, 9);
    // Local +Y (distal — the warp ramp's axis) -> the projection's y.
    const y = rotate(pose.quaternion, [0, 1, 0]);
    expect(y.x).toBeCloseTo(0, 9); expect(y.y).toBeCloseTo(1, 9); expect(y.z).toBeCloseTo(0, 9);
    // Local +Z -> x × y = [0, 0, 1] (palmar for this right hand), NOT the
    // left-handed basis's own z [0, 0, -1]: negating x instead would mirror
    // the thumb to the pinky side (the volume-safe repair — see header).
    const z = rotate(pose.quaternion, [0, 0, 1]);
    expect(z.x).toBeCloseTo(0, 9); expect(z.y).toBeCloseTo(0, 9); expect(z.z).toBeCloseTo(1, 9);
  });

  it('a right-handed basis passes through unrepaired', () => {
    const rest = handPrims();
    const projection: HandSheetProjection = {
      centre: [0, 0.02, 0],
      basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, // det > 0
      halfExtent: [0.08, 0.08, 0.07],
    };
    const pose = bakedHandPose(rest, rest, projection);
    const z = rotate(pose.quaternion, [0, 0, 1]);
    expect(z.z).toBeCloseTo(1, 9);
  });

  it('does not mutate its inputs', () => {
    const unjiggled = handPrims();
    const jiggled = shifted(handPrims(), DISTAL, [0, 0.02, 0.004]);
    const projection: HandSheetProjection = {
      centre: [0.01, 0.02, 0.03],
      basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] },
      halfExtent: [0.08, 0.08, 0.07],
    };
    const snap = {
      unjiggled: JSON.parse(JSON.stringify(unjiggled)),
      jiggled: JSON.parse(JSON.stringify(jiggled)),
      projection: JSON.parse(JSON.stringify(projection)),
    };
    bakedHandPose(unjiggled, jiggled, projection);
    expect(JSON.parse(JSON.stringify(unjiggled))).toEqual(snap.unjiggled);
    expect(JSON.parse(JSON.stringify(jiggled))).toEqual(snap.jiggled);
    expect(JSON.parse(JSON.stringify(projection))).toEqual(snap.projection);
  });
});
