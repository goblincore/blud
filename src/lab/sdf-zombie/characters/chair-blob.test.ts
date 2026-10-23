// chair.blob — a throne with a man fused into it, walking on four legs. What this pins: it builds and fuses, every
// rig point maps to a gait joint (so it walks at all), all four feet lift through the real motion pipeline, and the
// waddle ROCKS the throne side to side (CHAIR_WADDLE's pace: one side's two legs lift together).
import { describe, it, expect } from 'vitest';
import src from './chair.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../actor';
import { makeRng } from '../wander';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));

describe('chair — a seated man for a throne, on four legs', () => {
  it('builds clean, feet on the floor, the sitter upright over the back of the seat', () => {
    expect(body.errors).toEqual([]);
    expect(body.bones.get('hand.l')!.tail[1]).toBeLessThan(0.03);
    expect(body.bones.get('foot.l')!.tail[1]).toBeLessThan(0.03);
    // The front legs hang from his knees at the seat's front edge, well ahead of the back legs.
    expect(body.bones.get('upperarm.l')!.head[2] - body.bones.get('thigh.l')!.head[2]).toBeGreaterThan(0.3);
    // He sits: the head is over the seat's back half, not out front like the hound's.
    expect(Math.abs(body.bones.get('skull')!.tail[2])).toBeLessThan(0.2);
  });

  it('walks on four feet and rocks side to side', () => {
    const m = makeActorMotion(body, { seed: 3 });
    expect(m.motionJoints, 'every rig point must map to a gait joint').not.toBeNull();
    const J = m.motionJoints!.index;
    const profile = characterEntry('chair').profile;
    const rng = makeRng(3);
    const lifts: Record<string, number> = { handL: 0, handR: 0, footL: 0, footR: 0 };
    const low: Record<string, number> = {};
    let tiltMin = Infinity, tiltMax = -Infinity;
    for (let i = 0; i < 360; i++) {
      stepActorMotion(m, {
        current: body, dt: 1 / 60, wander: true, armStyle: undefined,
        headingFollow: 1, gazeFollow: 1, bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        rng, signals: emptyActorSignals(), profile, forceSpeed: profile.cruise,
      });
      const P = (k: number) => m.bound.rig.points[k]!.pos as Vec3;
      if (i < 90) { for (const n of Object.keys(lifts)) low[n] = Math.min(low[n] ?? Infinity, P(J[n as 'handL']!)[1]); continue; }
      for (const n of Object.keys(lifts)) lifts[n] = Math.max(lifts[n]!, P(J[n as 'handL']!)[1] - low[n]!);
      // The rock: the height difference between the two hip sockets.
      const tilt = P(J.hipL!)[1] - P(J.hipR!)[1];
      tiltMin = Math.min(tiltMin, tilt); tiltMax = Math.max(tiltMax, tilt);
    }
    for (const [n, lift] of Object.entries(lifts)) expect(lift, `${n} lifts`).toBeGreaterThan(0.04);
    expect(tiltMax - tiltMin, 'the throne rocks corner to corner').toBeGreaterThan(0.02);
  });
});
