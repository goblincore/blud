// src/lab/sdf-zombie/pose.test.ts
//
// The pose layer's pure half (spec docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md): a pose is per-bone absolute
// pitch/tilt overrides resolved through the .blob's own skeleton, keys blend in ANGLE space, and a held pose keeps the feet on the
// ground. Everything runs on the goblin's real skeleton, so the numbers are the ones the Flat's shots will use.
import { describe, it, expect } from 'vitest';
import goblinSrc from './characters/goblin.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { bindRig } from './rig-bind';
import { jointNamesForBody } from './gait';
import { len, sub } from './vec';
import { makePoseRig, poseJoints, type PoseClip } from './pose';
import type { Vec3 } from './types';

const doc = parseBlob(goblinSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const bound = bindRig(body);
const names = jointNamesForBody(body);
const base = bound.rig.restPose as readonly Vec3[];
const rig = makePoseRig(doc, names, base);
const at = (joints: readonly Vec3[], name: string): Vec3 => {
  const i = names.indexOf(name as never);
  if (i < 0) throw new Error(`no joint ${name}`);
  return joints[i]!;
};

const REST: PoseClip = { name: 'rest', keys: [{ t: 0, bones: {} }] };
// The look-dev's held poses (docs/dev-notes/2026-10-01-flat-emergence-lookdev/notes.md), pitch only.
const TYPE_BONES = {
  spine1: { pitch: 20 }, chest: { pitch: 27 }, neck: { pitch: 24 }, skull: { pitch: -6 },
  thigh: { pitch: 86 }, shin: { pitch: -4 }, upperarm: { pitch: 40 }, forearm: { pitch: 80 }, hand: { pitch: 70 },
};
const RECOIL_BONES = {
  spine1: { pitch: -6 }, chest: { pitch: -12 }, neck: { pitch: -2 }, skull: { pitch: -14 },
  thigh: { pitch: 78 }, shin: { pitch: 2 }, upperarm: { pitch: 150 }, forearm: { pitch: 172 }, hand: { pitch: 175 },
};
const TYPE: PoseClip = { name: 'type', keys: [{ t: 0, bones: TYPE_BONES }] };
const RECOIL: PoseClip = { name: 'recoil', keys: [{ t: 0, bones: RECOIL_BONES }] };

// Segment lengths the rig must keep at every pose: the goblin.blob bone lengths.
const SEGMENTS: [string, string, number][] = [
  ['shoulderL', 'elbowL', 0.235], ['elbowL', 'handL', 0.235],
  ['shoulderR', 'elbowR', 0.235], ['elbowR', 'handR', 0.235],
  ['hipL', 'kneeL', 0.290], ['kneeL', 'footL', 0.270],
  ['hipR', 'kneeR', 0.290], ['kneeR', 'footR', 0.270],
];

describe('pose: skeleton kinematics', () => {
  it('a key with no overrides reproduces the rig\'s rest joints, in rig-point order', () => {
    const j = poseJoints(rig, REST, 0);
    expect(j.length).toBe(base.length);
    j.forEach((p, i) => p.forEach((v, k) => expect(v, `${names[i]}[${k}]`).toBeCloseTo(base[i]![k]!, 9)));
  });

  it.each([['type', TYPE], ['recoil', RECOIL]])('%s keeps every limb segment at its bone length', (_n, clip) => {
    const j = poseJoints(rig, clip, 0);
    for (const [a, b, want] of SEGMENTS) expect(len(sub(at(j, b), at(j, a))), `${a}-${b}`).toBeCloseTo(want, 6);
  });

  it('resolves pitches above 90 degrees (the recoil throws the arms up)', () => {
    const j = poseJoints(rig, RECOIL, 0);
    // upperarm 150: the hand end is ABOVE the shoulder, and the forearm (172) carries on up.
    expect(at(j, 'elbowL')[1]).toBeGreaterThan(at(j, 'shoulderL')[1]);
    expect(at(j, 'handL')[1]).toBeGreaterThan(at(j, 'elbowL')[1]);
  });

  it('thigh pitch 86 puts the knee in front of the hip and the shin hangs from it', () => {
    const j = poseJoints(rig, TYPE, 0);
    expect(at(j, 'kneeL')[2] - at(j, 'hipL')[2]).toBeGreaterThan(0.25); // the 0.29 m thigh lies almost flat, forward
    expect(at(j, 'footL')[1]).toBeLessThan(at(j, 'kneeL')[1]);          // shin down
  });
});

describe('pose: blending is in angle space', () => {
  const SWING: PoseClip = {
    name: 'swing',
    keys: [{ t: 0, bones: {} }, { t: 1, bones: { upperarm: { pitch: 90 } }, ease: 'linear' }],
  };

  it('keeps the arm its full length half way through a swing (a position lerp would give 0.707 of it)', () => {
    const j = poseJoints(rig, SWING, 0.5);
    expect(len(sub(at(j, 'elbowL'), at(j, 'shoulderL')))).toBeCloseTo(0.235, 6);
  });

  it('is the first key before it, the last key after it, and the eased fraction between', () => {
    const before = poseJoints(rig, SWING, -3), start = poseJoints(rig, SWING, 0);
    const after = poseJoints(rig, SWING, 9), end = poseJoints(rig, SWING, 1);
    before.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(start[i]![k]!, 12)));
    after.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(end[i]![k]!, 12)));
    const smooth: PoseClip = { ...SWING, keys: [SWING.keys[0]!, { ...SWING.keys[1]!, ease: 'smooth' }] };
    // smoothstep(0.25) = 0.15625: at a quarter of the way the eased arm has moved LESS than the linear one.
    const lin = poseJoints(rig, SWING, 0.25), eased = poseJoints(rig, smooth, 0.25);
    const moved = (j: readonly Vec3[]) => len(sub(at(j, 'elbowL'), at(start, 'elbowL')));
    expect(moved(eased)).toBeLessThan(moved(lin));
  });
});

describe('pose: the feet', () => {
  const groundOf = (j: readonly Vec3[]) => Math.min(at(j, 'footL')[1], at(j, 'footR')[1]);
  const restGround = Math.min(at(base, 'footL')[1], at(base, 'footR')[1]);

  it('ground-locks by default: sitting lowers the pelvis instead of lifting the feet', () => {
    const j = poseJoints(rig, TYPE, 0);
    expect(groundOf(j)).toBeCloseTo(restGround, 9);
    expect(at(j, 'pelvis')[1]).toBeLessThan(at(base, 'pelvis')[1] - 0.15); // seated hips are well below standing hips
  });

  it('leaves the root alone when the key opts out', () => {
    const free: PoseClip = { name: 'free', keys: [{ t: 0, bones: TYPE_BONES, groundLock: false }] };
    const j = poseJoints(rig, free, 0);
    expect(at(j, 'pelvis')[1]).toBeCloseTo(at(base, 'pelvis')[1], 9);
    expect(groundOf(j)).toBeGreaterThan(restGround + 0.05); // the feet end up ABOVE the floor: pitching the legs forward raises them
  });

  it('moves the whole pose by the key\'s root offset', () => {
    const shifted: PoseClip = { name: 'shifted', keys: [{ t: 0, bones: TYPE_BONES, root: { x: 0.1, z: -0.2 } }] };
    const a = poseJoints(rig, TYPE, 0), b = poseJoints(rig, shifted, 0);
    a.forEach((p, i) => {
      expect(b[i]![0]).toBeCloseTo(p[0] + 0.1, 9);
      expect(b[i]![2]).toBeCloseTo(p[2] - 0.2, 9);
    });
  });
});
