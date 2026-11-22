// src/lab/sdf-zombie/characters/imp-blob.test.ts
//
// The imp (imp.blob): it builds clean on the butcher's digitigrade leg chain, the zigzag survives walking through the
// real motion pipeline at its quick cruise (butcher-blob.test.ts's pin, for a new body and gait speed), and the
// throw is wired: the fireball leaves the right hand. Whether it reads is a question for frames, not this file.
import { describe, it, expect } from 'vitest';
import src from './imp.blob?raw';
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

describe('imp', () => {
  it('builds clean, with a hand bone for the socket and the zombie leg chain', () => {
    expect(body.errors).toEqual([]);
    for (const b of ['hand.l', 'hand.r', 'thigh.l', 'shin.l', 'foot.l']) expect(body.bones.has(b), b).toBe(true);
  });

  it('the digitigrade zigzag survives its quick prowl through the real motion pipeline', () => {
    const m = makeActorMotion(body, { seed: 7 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('imp').profile;
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
    expect(minKnee, 'knee never folds backward').toBeGreaterThan(0.03);
    expect(maxHock, 'hock never folds forward').toBeLessThan(-0.03);
  });

  it('throws fireballs from the right hand, and is quicker than the flayer', () => {
    const p = characterEntry('imp').profile;
    expect(p.throws).toBe('fireball');
    expect(p.spit?.from).toBe('handTipR');
    expect(p.cruise).toBeGreaterThan(characterEntry('flayer').profile.cruise);
    expect(p.gunner, 'not the soldier brain').toBeUndefined();
  });
});
