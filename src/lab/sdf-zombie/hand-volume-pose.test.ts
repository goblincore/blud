// src/lab/sdf-zombie/hand-volume-pose.test.ts
//
// X1.26 task C1 — the baked-hand pose derivation: rigid wrist/forearm
// translation, distal warp residual in the anatomical basis, the 12 mm
// clamp, the volume-safe determinant repair, and input purity.
//
// X1.27 task D2 — bakedDynamitePose: the EXACT held GLB root transform from
// the animated hand volume + the manifest's prop contract (the same values
// the poses were authored against, read from the real checked-in clip).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { bakedHandPose, bakedDynamitePose, applyGripMotion, HAND_WARP_CLAMP_M, type BakedHandPose } from './hand-volume-pose';
import { gripCameraQuaternion, type GripMotionFrame } from './hand-grip-clip';
import { validateHandClipManifest, type DynamitePropContract } from './webgpu/hand-volume-clip';
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

// ——— X1.27 task E2: applyGripMotion ————————————————————————————————————

describe('applyGripMotion', () => {
  /** A posed baked hand in the world with a nonzero warp residue. */
  const BASE: BakedHandPose = {
    centre: [0.31, 1.18, -0.47],
    // 90° about world +X, xyzw
    quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    warpLocal: [0.004, -0.002, 0.001],
  };
  /** The release-marker wrist frame (camera-local offset + euler key). */
  const FRAME: GripMotionFrame = {
    grip01: 0.62,
    wristOffsetCamera: [0.020, 0.085, 0.095],
    wristQuaternionCamera: (() => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0.05, 0.16, 'XYZ'));
      return [q.x, q.y, q.z, q.w] as [number, number, number, number];
    })(),
    releaseNow: false,
    propHeld: true,
  };
  const IDENT: [number, number, number, number] = [0, 0, 0, 1];

  /** THREE chain of the composition contract, from xyzw tuples. */
  function composed(
    camera: readonly [number, number, number, number],
    wrist: readonly [number, number, number, number],
    base: readonly [number, number, number, number],
  ): THREE.Quaternion {
    const qc = new THREE.Quaternion(camera[0], camera[1], camera[2], camera[3]);
    const qw = new THREE.Quaternion(wrist[0], wrist[1], wrist[2], wrist[3]);
    const qb = new THREE.Quaternion(base[0], base[1], base[2], base[3]);
    return qc.clone().multiply(qw).multiply(qc.clone().invert()).multiply(qb).normalize();
  }

  it('an identity camera copies the frame offset verbatim and applies the wrist rotation directly', () => {
    const out = applyGripMotion(BASE, FRAME, IDENT);
    for (let i = 0; i < 3; i++) {
      expect(out.centre[i]).toBeCloseTo(BASE.centre[i]! + FRAME.wristOffsetCamera[i]!, 12);
    }
    const want = composed(IDENT, FRAME.wristQuaternionCamera, BASE.quaternion);
    expect(out.quaternion[0]).toBeCloseTo(want.x, 9);
    expect(out.quaternion[1]).toBeCloseTo(want.y, 9);
    expect(out.quaternion[2]).toBeCloseTo(want.z, 9);
    expect(out.quaternion[3]).toBeCloseTo(want.w, 9);
  });

  it('a 90° camera yaw rotates the offset (and the lab’s gripCameraQuaternion(90°,0) agrees)', () => {
    const cam = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const CAMERA: [number, number, number, number] = [cam.x, cam.y, cam.z, cam.w];
    const out = applyGripMotion(BASE, FRAME, CAMERA);
    // R_y(90°): (x, y, z) → (z, y, −x)
    expect(out.centre[0]).toBeCloseTo(BASE.centre[0] + 0.095, 9);
    expect(out.centre[1]).toBeCloseTo(BASE.centre[1] + 0.085, 9);
    expect(out.centre[2]).toBeCloseTo(BASE.centre[2] - 0.020, 9);
    const want = composed(CAMERA, FRAME.wristQuaternionCamera, BASE.quaternion);
    expect(out.quaternion[0]).toBeCloseTo(want.x, 9);
    expect(out.quaternion[1]).toBeCloseTo(want.y, 9);
    expect(out.quaternion[2]).toBeCloseTo(want.z, 9);
    expect(out.quaternion[3]).toBeCloseTo(want.w, 9);
    // the same numbers through the real lab path
    const viaLab = applyGripMotion(BASE, FRAME, gripCameraQuaternion(Math.PI / 2, 0));
    expect(viaLab.centre[0]).toBeCloseTo(out.centre[0], 9);
    expect(viaLab.centre[1]).toBeCloseTo(out.centre[1], 9);
    expect(viaLab.centre[2]).toBeCloseTo(out.centre[2], 9);
  });

  it('the warp stays in anatomical local coordinates, unchanged by the camera-space motion', () => {
    const out = applyGripMotion(BASE, FRAME, IDENT);
    expect(out.warpLocal).toEqual(BASE.warpLocal);
    const rotated = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 2.1);
    const out2 = applyGripMotion(BASE, FRAME, [rotated.x, rotated.y, rotated.z, rotated.w]);
    expect(out2.warpLocal).toEqual(BASE.warpLocal); // NOT rotated into camera space
  });

  it('normalizes the output quaternion', () => {
    const q = new THREE.Quaternion(...applyGripMotion(BASE, FRAME, IDENT).quaternion);
    expect(q.length()).toBeCloseTo(1, 12);
  });

  it('does not mutate its inputs', () => {
    const base = { ...BASE, centre: [...BASE.centre] as Vec3, quaternion: [...BASE.quaternion] as [number, number, number, number], warpLocal: [...BASE.warpLocal] as Vec3 };
    const frame: GripMotionFrame = { ...FRAME, wristOffsetCamera: [...FRAME.wristOffsetCamera] as Vec3, wristQuaternionCamera: [...FRAME.wristQuaternionCamera] as [number, number, number, number] };
    const camera = [...IDENT] as [number, number, number, number];
    const snap = { base: JSON.parse(JSON.stringify(base)), frame: JSON.parse(JSON.stringify(frame)), camera: [...camera] };
    applyGripMotion(base, frame, camera);
    expect(JSON.parse(JSON.stringify(base))).toEqual(snap.base);
    expect(JSON.parse(JSON.stringify(frame))).toEqual(snap.frame);
    expect([...camera]).toEqual(snap.camera);
  });
});

// ——— X1.27 task D2: bakedDynamitePose ————————————————————————————————————

/** The REAL prop contract the six poses were authored against, read from the
 *  checked-in v2 clip manifest (validated, so the values below are the
 *  authored ones, not a hand-written stand-in). */
const REAL_PROP: DynamitePropContract = validateHandClipManifest(
  JSON.parse(readFileSync('public/assets/lab/hand-sdf-dynamite-grip-r.json', 'utf8')),
).prop;

/** A hand volume at the anatomical origin, unrotated, unwarped. Its
 *  quaternion is xyzw (BakedHandPose's convention). */
const IDENTITY_HAND: BakedHandPose = {
  centre: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  warpLocal: [0, 0, 0],
};

/** (w, x, y, z) pose quaternion → THREE.Quaternion. */
function propQuat(q: readonly [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(q[1], q[2], q[3], q[0]);
}

/** The bundle's world long axis under a prop pose (model +Y rotated). */
function axisOf(pose: { quaternion: [number, number, number, number] }): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(propQuat(pose.quaternion));
}

/** The world grip point reconstructed from a prop pose: the GLB root plus
 *  the GripAnchor's model-local offset (0, modelGripOffsetM, 0) rotated by
 *  the root quaternion — the same relation the pose was built to invert. */
function gripOf(
  pose: { position: Vec3; quaternion: [number, number, number, number] },
  prop: DynamitePropContract,
): THREE.Vector3 {
  return new THREE.Vector3(0, prop.modelGripOffsetM, 0)
    .applyQuaternion(propQuat(pose.quaternion))
    .add(new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]));
}

describe('bakedDynamitePose', () => {
  it('identity hand seats the authored grip point exactly at prop.gripLocal', () => {
    const pose = bakedDynamitePose(IDENTITY_HAND, REAL_PROP);
    const grip = gripOf(pose, REAL_PROP);
    expect(grip.x).toBeCloseTo(REAL_PROP.gripLocal[0], 12);
    expect(grip.y).toBeCloseTo(REAL_PROP.gripLocal[1], 12);
    expect(grip.z).toBeCloseTo(REAL_PROP.gripLocal[2], 12);
    // and the bundle's world axis is the hand-unrotated axisLocal (the
    // manifest values carry f32 bake noise ~1e-8, so 6 digits, not 9)
    const axis = axisOf(pose);
    expect(axis.x).toBeCloseTo(REAL_PROP.axisLocal[0], 6);
    expect(axis.y).toBeCloseTo(REAL_PROP.axisLocal[1], 6);
    expect(axis.z).toBeCloseTo(REAL_PROP.axisLocal[2], 6);
    // the pose quaternion is unit length
    expect(propQuat(pose.quaternion).length()).toBeCloseTo(1, 12);
  });

  it('a 90° hand quaternion rotates BOTH the root position and the bundle axis', () => {
    // 90° about world +Z, xyzw
    const S = Math.SQRT1_2;
    const hand: BakedHandPose = {
      centre: IDENTITY_HAND.centre,
      quaternion: [0, 0, S, S],
      warpLocal: [0, 0, 0],
    };
    const base = bakedDynamitePose(IDENTITY_HAND, REAL_PROP);
    const rotated = bakedDynamitePose(hand, REAL_PROP);
    const rz = new THREE.Quaternion(0, 0, S, S);
    const wantPos = new THREE.Vector3(base.position[0], base.position[1], base.position[2])
      .applyQuaternion(rz);
    expect(rotated.position[0]).toBeCloseTo(wantPos.x, 12);
    expect(rotated.position[1]).toBeCloseTo(wantPos.y, 12);
    expect(rotated.position[2]).toBeCloseTo(wantPos.z, 12);
    const wantAxis = axisOf(base).applyQuaternion(rz);
    const gotAxis = axisOf(rotated);
    expect(gotAxis.x).toBeCloseTo(wantAxis.x, 9);
    expect(gotAxis.y).toBeCloseTo(wantAxis.y, 9);
    expect(gotAxis.z).toBeCloseTo(wantAxis.z, 9);
  });

  it('modelGripOffsetM moves the GLB root opposite model +Y from the world grip', () => {
    const pose = bakedDynamitePose(IDENTITY_HAND, REAL_PROP);
    // world grip under the identity hand = centre + I·gripLocal = gripLocal
    const axis = axisOf(pose);
    expect(pose.position[0]).toBeCloseTo(REAL_PROP.gripLocal[0] - axis.x * REAL_PROP.modelGripOffsetM, 12);
    expect(pose.position[1]).toBeCloseTo(REAL_PROP.gripLocal[1] - axis.y * REAL_PROP.modelGripOffsetM, 12);
    expect(pose.position[2]).toBeCloseTo(REAL_PROP.gripLocal[2] - axis.z * REAL_PROP.modelGripOffsetM, 12);
    // flipping the offset's sign moves the root to the OTHER side of the
    // grip along the same axis — and the grip invariant survives it.
    const flipped: DynamitePropContract = { ...REAL_PROP, modelGripOffsetM: -REAL_PROP.modelGripOffsetM };
    const pose2 = bakedDynamitePose(IDENTITY_HAND, flipped);
    const d = new THREE.Vector3(
      pose2.position[0] - pose.position[0],
      pose2.position[1] - pose.position[1],
      pose2.position[2] - pose.position[2],
    );
    expect(d.length()).toBeCloseTo(Math.abs(2 * REAL_PROP.modelGripOffsetM), 12);
    expect(d.angleTo(axis)).toBeCloseTo(Math.PI, 9); // the OTHER side, along the bundle axis
    const grip2 = gripOf(pose2, flipped);
    expect(grip2.x).toBeCloseTo(flipped.gripLocal[0], 12);
    expect(grip2.y).toBeCloseTo(flipped.gripLocal[1], 12);
    expect(grip2.z).toBeCloseTo(flipped.gripLocal[2], 12);
  });

  it('modelRotationLocal determines roll: position and axis unchanged, quaternion differs', () => {
    // Roll the model 30° about its OWN +Y (the long axis) by appending the
    // rotation after the authored model quaternion — preserves the +Y
    // mapping, changes everything else.
    const qm = propQuat(REAL_PROP.modelRotationLocal);
    const roll = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), Math.PI / 6);
    const rolled = qm.clone().multiply(roll);
    const variant: DynamitePropContract = {
      ...REAL_PROP,
      modelRotationLocal: [rolled.w, rolled.x, rolled.y, rolled.z],
    };
    const base = bakedDynamitePose(IDENTITY_HAND, REAL_PROP);
    const rolledPose = bakedDynamitePose(IDENTITY_HAND, variant);
    expect(rolledPose.position[0]).toBeCloseTo(base.position[0], 12);
    expect(rolledPose.position[1]).toBeCloseTo(base.position[1], 12);
    expect(rolledPose.position[2]).toBeCloseTo(base.position[2], 12);
    const axis = axisOf(rolledPose);
    expect(axis.x).toBeCloseTo(REAL_PROP.axisLocal[0], 6);
    expect(axis.y).toBeCloseTo(REAL_PROP.axisLocal[1], 6);
    expect(axis.z).toBeCloseTo(REAL_PROP.axisLocal[2], 6);
    const qb = propQuat(base.quaternion);
    const qr = propQuat(rolledPose.quaternion);
    expect(qr.length()).toBeCloseTo(1, 12);
    expect(qb.angleTo(qr)).toBeGreaterThan(0.01); // the roll is visible
  });

  it('the distal warp does not move the prop (rigid frame only)', () => {
    const warped: BakedHandPose = { ...IDENTITY_HAND, warpLocal: [0.012, 0, 0] };
    const a = bakedDynamitePose(IDENTITY_HAND, REAL_PROP);
    const b = bakedDynamitePose(warped, REAL_PROP);
    expect(b.position).toEqual(a.position);
    expect(b.quaternion).toEqual(a.quaternion);
  });

  it('does not mutate its inputs', () => {
    const hand: BakedHandPose = {
      centre: [0.01, 0.02, 0.03],
      quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      warpLocal: [0.001, 0.002, 0.003],
    };
    const prop = { ...REAL_PROP };
    const snap = {
      hand: JSON.parse(JSON.stringify(hand)),
      prop: JSON.parse(JSON.stringify(prop)),
    };
    bakedDynamitePose(hand, prop);
    expect(JSON.parse(JSON.stringify(hand))).toEqual(snap.hand);
    expect(JSON.parse(JSON.stringify(prop))).toEqual(snap.prop);
  });

  it('source guard: derives only from the volume frame and contract, not the primitive prop seats', () => {
    const src = readFileSync('src/lab/sdf-zombie/hand-volume-pose.ts', 'utf8');
    expect(src).not.toContain('handPropPoses');
    expect(src).not.toContain('PROP_MESH');
  });
});
