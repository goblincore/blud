// src/lab/sdf-zombie/characters/goblin-poses.test.ts
//
// The goblin's pose data (goblin-poses.ts) against the real skeleton: every clip resolves, its keys are in order, and no limb
// changes length at ANY sampled time (the angle-space blend's whole point), the feet stay on the ground, and the body stays one piece.
import { describe, it, expect } from 'vitest';
import goblinSrc from './goblin.blob?raw';
import goblinHomeSrc from './goblin-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig } from '../rig-bind';
import { jointNamesForBody } from '../gait';
import { len, sub } from '../vec';
import { makePoseRig, poseJoints } from '../pose';
import { posesFor } from '../pose-library';
import { GOBLIN_POSES } from './goblin-poses';

// The goblin's body, and goblin-home's (the same skeleton plus cloth and bare feet: pose-library.ts gives it the goblin's clips, so the
// clip checks below run on both).
const rigFor = (src: string) => {
  const doc = parseBlob(src);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const names = jointNamesForBody(body);
  const base = bindRig(body).rig.restPose;
  return { doc, names, base, rig: makePoseRig(doc, names, base) };
};
const { doc, names, base, rig } = rigFor(goblinSrc);
const home = rigFor(goblinHomeSrc);
const J = (name: string) => names.indexOf(name as never);
// The segment lengths below are the authored 1.30 m figures; the .blob's `scale` line makes the compiled limbs K times longer.
const K = doc.scale ?? 1;
const SEGMENTS: [string, string, number][] = [
  ['shoulderL', 'elbowL', 0.235], ['elbowL', 'handL', 0.235], ['shoulderR', 'elbowR', 0.235], ['elbowR', 'handR', 0.235],
  ['hipL', 'kneeL', 0.290], ['kneeL', 'footL', 0.270], ['hipR', 'kneeR', 0.290], ['kneeR', 'footR', 0.270],
];
const restGround = Math.min(base[J('footL')]![1], base[J('footR')]![1]);

describe('goblin poses', () => {
  it('are registered for the goblin (and goblin-home, his body in home clothes) and no one else', () => {
    expect(posesFor('goblin')).toBe(GOBLIN_POSES);
    expect(posesFor('goblin-home')).toBe(GOBLIN_POSES);
    expect(Object.keys(GOBLIN_POSES).sort()).toEqual(['jolt', 'reach', 'recoil', 'sit', 'stand', 'touch', 'type']);
    expect(posesFor('zombie')).toEqual({});
  });

  it.each(Object.values(GOBLIN_POSES).map(c => [c.name, c] as const))('%s: keys ascend, limbs keep their length, feet stay on the floor', (_n, clip) => {
    for (let i = 1; i < clip.keys.length; i++) expect(clip.keys[i]!.t).toBeGreaterThan(clip.keys[i - 1]!.t);
    const end = clip.keys[clip.keys.length - 1]!.t;
    for (let k = 0; k <= 10; k++) {
      const j = poseJoints(rig, clip, (end * k) / 10);
      for (const [a, b, want] of SEGMENTS)
        expect(len(sub(j[J(b)]!, j[J(a)]!)), `${clip.name} t=${(end * k) / 10} ${a}-${b}`).toBeCloseTo(want * K, 6);
      expect(Math.min(j[J('footL')]![1], j[J('footR')]![1]), `${clip.name} ground`).toBeCloseTo(restGround, 9);
    }
  });

  it.each(Object.values(GOBLIN_POSES).map(c => [c.name, c] as const))('%s on goblin-home: the same joints as the goblin (the cloth moves no joint), so the same lengths and floor', (_n, clip) => {
    expect(home.names).toEqual(names);
    expect(home.base).toEqual(base);
    const end = clip.keys[clip.keys.length - 1]!.t;
    for (let k = 0; k <= 10; k++) {
      const t = (end * k) / 10;
      expect(poseJoints(home.rig, clip, t)).toEqual(poseJoints(rig, clip, t));
    }
  });

  it('sit starts at the standing rest and ends at the typing pose; stand is its reverse', () => {
    const restJ = poseJoints(rig, { name: 'rest', keys: [{ t: 0, bones: {} }] }, 0);
    const typeJ = poseJoints(rig, GOBLIN_POSES.type!, 0);
    const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
      a.every((p, i) => p.every((v, k) => Math.abs(v - b[i]![k]!) < 1e-9));
    expect(near(poseJoints(rig, GOBLIN_POSES.sit!, 0), restJ)).toBe(true);
    expect(near(poseJoints(rig, GOBLIN_POSES.sit!, 0.8), typeJ)).toBe(true);
    expect(near(poseJoints(rig, GOBLIN_POSES.stand!, 0), typeJ)).toBe(true);
    expect(near(poseJoints(rig, GOBLIN_POSES.stand!, 0.8), restJ)).toBe(true);
  });

  it('touch runs from the recoil pose to the reach pose, and reach lowers the hand below the shoulder and in front of the knee', () => {
    const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
      a.every((p, i) => p.every((v, k) => Math.abs(v - b[i]![k]!) < 1e-9));
    expect(near(poseJoints(rig, GOBLIN_POSES.touch!, 0), poseJoints(rig, GOBLIN_POSES.recoil!, 0))).toBe(true);
    const reachEnd = poseJoints(rig, GOBLIN_POSES.reach!, 0);
    expect(near(poseJoints(rig, GOBLIN_POSES.touch!, GOBLIN_POSES.touch!.keys[GOBLIN_POSES.touch!.keys.length - 1]!.t), reachEnd)).toBe(true);
    expect(reachEnd[J('handL')]![1]).toBeLessThan(reachEnd[J('shoulderL')]![1]);
    expect(reachEnd[J('handL')]![2]).toBeGreaterThan(reachEnd[J('kneeL')]![2] - 0.1);
  });
});
