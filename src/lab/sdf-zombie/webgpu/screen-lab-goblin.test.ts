// src/lab/sdf-zombie/webgpu/screen-lab-goblin.test.ts
//
// The screen lab's clip choice (screen-lab-goblin.ts) against the plan's boundaries and the real goblin skeleton: the clips come in the
// sequence's order, `local` restarts at 0 at every cut and never goes negative, the clip before a cut has finished playing when the cut
// lands, and the POSE does not jump at any cut (each clip starts where the last one ended).
import { describe, it, expect } from 'vitest';
import goblinSrc from '../characters/goblin.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig } from '../rig-bind';
import { jointNamesForBody } from '../gait';
import { makePoseRig, poseJoints } from '../pose';
import { DURATION } from './emergence-timeline';
import { GOBLIN_CUTS, goblinClipAt, measureSeat } from './screen-lab-goblin';
import type { Primitive } from '../types';

const doc = parseBlob(goblinSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const rig = makePoseRig(doc, jointNamesForBody(body), bindRig(body).rig.restPose);
const clipEnd = (c: { keys: { t: number }[] }) => c.keys[c.keys.length - 1]!.t;
const EPS = 1e-6;

describe('goblinClipAt', () => {
  it('plays sit, type, jolt, recoil, touch, reach in that order, cut where the plan says', () => {
    const names: string[] = [];
    for (let t = 0; t <= DURATION; t += 0.01) {
      const n = goblinClipAt(t).clip.name;
      if (names[names.length - 1] !== n) names.push(n);
    }
    expect(names).toEqual(['sit', 'type', 'jolt', 'recoil', 'touch', 'reach']);
    expect(GOBLIN_CUTS.map(c => [c.clip.name, c.start])).toEqual(
      [['sit', 0], ['type', 0.8], ['jolt', 3.0], ['recoil', 6.6], ['touch', 9.4], ['reach', 11.6]]);
  });

  it('the last clip is reach, held past the end', () => {
    expect(goblinClipAt(DURATION).clip.name).toBe('reach');
    expect(goblinClipAt(DURATION + 5).clip.name).toBe('reach');
  });

  it('local is never negative, even before 0', () => {
    for (let t = -1; t <= DURATION + 1; t += 0.05) expect(goblinClipAt(t).local).toBeGreaterThanOrEqual(0);
  });

  it('local runs with the clock inside a clip and restarts at 0 at each cut', () => {
    for (const cut of GOBLIN_CUTS) {
      expect(goblinClipAt(cut.start).clip).toBe(cut.clip);
      expect(goblinClipAt(cut.start).local).toBeCloseTo(0, 9);
      expect(goblinClipAt(cut.start + 0.1).local).toBeCloseTo(0.1, 9);
    }
  });

  it('the clip before each cut has finished by the cut, and the pose is continuous across it', () => {
    for (let i = 1; i < GOBLIN_CUTS.length; i++) {
      const cut = GOBLIN_CUTS[i]!;
      const before = goblinClipAt(cut.start - EPS);
      expect(before.clip).toBe(GOBLIN_CUTS[i - 1]!.clip);
      expect(before.local + EPS).toBeGreaterThanOrEqual(clipEnd(before.clip) - 1e-9);
      const a = poseJoints(rig, before.clip, before.local);
      const b = poseJoints(rig, cut.clip, goblinClipAt(cut.start).local);
      for (let j = 0; j < a.length; j++)
        for (let k = 0; k < 3; k++) expect(Math.abs(a[j]![k]! - b[j]![k]!), `${cut.clip.name} joint ${j}`).toBeLessThan(1e-4);
    }
  });
});

describe('measureSeat', () => {
  const prim = (bone: string, a: [number, number, number], b: [number, number, number], radius: number, radiusB?: number): Primitive =>
    ({ bone, a, b, radius, radiusB, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0 }) as Primitive;
  it('reads the palms, the seat, the knees and the hands off the prims', () => {
    const m = measureSeat([
      prim('hand.l', [0.2, 0.6, 0.7], [0.2, 0.6, 0.7], 0.05), prim('hand.r', [-0.2, 0.62, 0.7], [-0.2, 0.62, 0.7], 0.05),
      prim('thigh.l', [0.08, 0.58, 0], [0.08, 0.55, 0.38], 0.06, 0.04), prim('thigh.r', [-0.08, 0.58, 0], [-0.08, 0.55, 0.38], 0.06, 0.04),
      prim('pelvis', [0, 0.55, -0.06], [0, 0.55, -0.06], 0.07),
      prim('chest', [0, 0.9, 0.1], [0, 0.9, 0.1], 0.2),
    ]);
    expect(m.palmY).toBeCloseTo(0.55, 9);
    expect(m.handZ).toBeCloseTo(0.7, 9);
    expect(m.handHalfSpan).toBeCloseTo(0.2, 9);
    expect(m.seatY).toBeCloseTo(0.48, 9);
    expect(m.seatBackZ).toBeCloseTo(-0.13, 9);
    expect(m.kneeFrontZ).toBeCloseTo(0.44, 9);
    expect(m.kneeTopY).toBeCloseTo(0.59, 9);
  });
  it('refuses a body without hands, thighs or pelvis rather than guessing', () => {
    expect(() => measureSeat([prim('chest', [0, 1, 0], [0, 1, 0], 0.2)])).toThrow();
  });
});
