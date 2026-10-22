// gibbet.blob — the walking gallows: a frame on four splayed legs, a sac of meat in a cage slung on the `hem`
// pendulum, a head dangling at the front. What this pins: it builds and fuses, every rig point maps to a gait joint
// (so it walks at all), all four feet lift through the real motion pipeline, and the sac SWINGS (GIBBET_STALK's
// hemSwing): without it the Verlet lag alone moved it ~1.5 cm and the hung meat read as rigid.
import { describe, it, expect } from 'vitest';
import src from './gibbet.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));

describe('gibbet — a cage of meat on four legs', () => {
  it('builds clean, toes on the floor, the sac hanging between the legs', () => {
    expect(body.errors).toEqual([]);
    expect(body.bones.get('hand.l')!.tail[1]).toBeLessThan(0.03);
    expect(body.bones.get('foot.l')!.tail[1]).toBeLessThan(0.03);
    const hem = body.bones.get('hem')!;
    expect(hem.tail[1], 'the sac hangs low').toBeLessThan(0.35);
    expect(hem.tail[1], 'but above the toes (bindRig pins the lowest point)').toBeGreaterThan(0.1);
  });

  it('walks on four feet and the sac swings', () => {
    const m = makeActorMotion(body, { seed: 3 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('gibbet').profile;
    const rng = makeRng(3);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const low: Record<string, number> = {};
    let latMin = Infinity, latMax = -Infinity;
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 90) { for (const n of Object.keys(lifts)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - low[n]!);
      const h = P(J.hips!), c = P(J.chest!), s = P(J.hem!);
      const f = Math.hypot(c[0] - h[0], c[2] - h[2]);
      const lat = ((s[0] - h[0]) * (c[2] - h[2]) - (s[2] - h[2]) * (c[0] - h[0])) / f;
      latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts`).toBeGreaterThan(0.05);
    expect(latMax - latMin, 'the sac swings side to side').toBeGreaterThan(0.10);
  });
});
