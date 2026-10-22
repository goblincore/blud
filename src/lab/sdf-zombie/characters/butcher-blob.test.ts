// src/lab/sdf-zombie/characters/butcher-blob.test.ts
//
// Pins the butcher's one structural risk: the DIGITIGRADE LEGS are built on the zombie's three leg bones (thigh,
// shin, foot) purely in rest pose (butcher.blob, THE LEGS). New or renamed leg bones are what broke the twinhead's
// gait, so this checks the two things that approach depends on:
//   * every rig point still maps to a gait joint (makeMotionJoints non-null), so the body walks at all;
//   * the zigzag SURVIVES the walk: through the real motion pipeline (gait + plant IK + Verlet rig) the knee stays
//     forward of the hip-to-hock line and the hock stays BEHIND the knee-to-toe line. The plant IK's pole bias bows
//     the knee forward (ik.ts solvePlantedLeg); a leg whose backward joint were the KNEE would be flipped by it.
// It also pins the arm weapon's wiring (motion-profile.ts armWeapon). Whether it reads as a dog's hind leg is
// a question for frames, not this file.
import { describe, it, expect } from 'vitest';
import src from './butcher.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Signed forward offset (along `fwd`) of `mid` from the straight line a -> b, at mid's height. */
function fold(a: Vec3, mid: Vec3, b: Vec3, fwd: Vec3): number {
  const t = (mid[1] - a[1]) / (b[1] - a[1]);
  const onLine: Vec3 = [a[0] + (b[0] - a[0]) * t, mid[1], a[2] + (b[2] - a[2]) * t];
  const d = sub(mid, onLine);
  return d[0] * fwd[0] + d[2] * fwd[2];
}

describe('butcher — digitigrade legs on the zombie leg bones', () => {
  it('builds clean and keeps the zombie leg chain', () => {
    expect(body.errors).toEqual([]);
    for (const b of ['thigh.l', 'shin.l', 'foot.l', 'thigh.r', 'shin.r', 'foot.r']) expect(body.bones.has(b), b).toBe(true);
  });

  it('rest pose: knee forward of the hip, hock behind it, toe on the floor', () => {
    const thigh = body.bones.get('thigh.l')!, shin = body.bones.get('shin.l')!, foot = body.bones.get('foot.l')!;
    expect(thigh.tail[2] - thigh.head[2], 'knee ahead of the hip').toBeGreaterThan(0.15);
    expect(shin.tail[2] - thigh.head[2], 'hock behind the hip').toBeLessThan(-0.04);
    expect(foot.tail[1], 'toe joint at the floor').toBeLessThan(0.05);
  });

  it('the zigzag survives walking through the real motion pipeline', () => {
    const m = makeActorMotion(body, { seed: 7 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('butcher').profile;
    const rng = makeRng(7);
    let minKnee = Infinity, maxHock = -Infinity;
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      if (i < 60) continue;
      const fwd: Vec3 = [Math.sin(m.lastBodyYaw), 0, Math.cos(m.lastBodyYaw)];
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      for (const s of ['L', 'R'] as const) {
        const hip = P(J[`hip${s}`]!), knee = P(J[`knee${s}`]!), hock = P(J[`foot${s}`]!), toe = P(J[`toe${s}`]!);
        minKnee = Math.min(minKnee, fold(hip, knee, hock, fwd));
        maxHock = Math.max(maxHock, fold(knee, hock, toe, fwd));
      }
    }
    // Rest: knee +0.19 m off the hip-hock line, hock -0.23 m off the knee-toe line.
    expect(minKnee, 'knee never folds backward').toBeGreaterThan(0.05);
    expect(maxHock, 'hock never folds forward').toBeLessThan(-0.05);
  });
});

describe('butcher — the grafted axe', () => {
  it('swings the right arm only and hits harder than a bite', () => {
    const p = characterEntry('butcher').profile;
    expect(p.armWeapon).toEqual({ side: 'R', damage: 25 });
    // No held prop: the axe is kit on foreArm.r, carried by the arm's own swing.
    expect(p.prop).toBeUndefined();
    expect(p.melee).toBeUndefined();
  });
});
