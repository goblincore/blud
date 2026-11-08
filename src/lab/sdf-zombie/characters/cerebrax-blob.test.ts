// cerebrax.blob — the boss brain-spider: a brain in a harness ring on four long spider legs. What this pins: it builds
// and fuses at its boss scale, the toes are on the floor, the brain's top stays inside the body normal map's
// -2.5..2.5 m position range (body-normal.wgsl.ts pos16), every rig point maps to a gait joint, all four feet lift
// through the real motion pipeline, and the knees STAY HIGH (GaitProfile.kneePole / elbowPole): a spider's knee rides
// above its hip through the whole stride, never folding under like a dog's.
import { describe, it, expect } from 'vitest';
import src from './cerebrax.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { sdBody } from '../validate';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));

describe('cerebrax — a brain on four spider legs', () => {
  it('builds clean at boss scale, toes on the floor', () => {
    expect(body.errors).toEqual([]);
    for (const b of ['hand.l', 'hand.r', 'foot.l', 'foot.r']) {
      expect(Math.abs(body.bones.get(b)!.tail[1]), `${b} tip on the floor`).toBeLessThan(0.03);
    }
    // A boss: the knees tower over a player's 1.6 m eye line.
    expect(body.bones.get('thigh.l')!.tail[1]).toBeGreaterThan(2.5);
  });

  it('keeps the brain under the normal map\'s 2.5 m ceiling', () => {
    // March straight down the brain's axis from above to find its top.
    const c = body.bones.get('skull')!.head;
    let y = 3.2;
    while (y > c[1] && sdBody([c[0], y, c[2]], body) > 1e-3) y -= 0.002;
    expect(y, 'the brain has a top').toBeGreaterThan(c[1]);
    expect(y, 'under the pos16 range, with room for the swell').toBeLessThan(2.47);
  });

  it('walks on four feet with its knees held high', () => {
    const m = makeActorMotion(body, { seed: 3 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('cerebrax').profile;
    const rng = makeRng(3);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const low: Record<string, number> = {};
    let kneeOverHip = Infinity;
    for (let i = 0; i < 480; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 120) { for (const n of Object.keys(lifts)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - low[n]!);
      for (const [knee, hip] of [['kneeL', 'hipL'], ['kneeR', 'hipR'], ['elbowL', 'shoulderL'], ['elbowR', 'shoulderR']] as const) {
        kneeOverHip = Math.min(kneeOverHip, P(J[knee]!)[1] - P(J[hip]!)[1]);
      }
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts`).toBeGreaterThan(0.10);
    expect(kneeOverHip, 'every knee rides at least 0.6 m over its socket').toBeGreaterThan(0.6);
  });
});
