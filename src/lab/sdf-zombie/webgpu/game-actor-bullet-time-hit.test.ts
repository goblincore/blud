// src/lab/sdf-zombie/webgpu/game-actor-bullet-time-hit.test.ts
//
// A standing body shot in bullet time keeps its shape (rig.ts KEEP-OUTS ADD NO SPEED). Owner clip 2026-11-12: a
// zombie under shotgun fire at 0.2x whipped its head and arms about and stretched out of shape. One 10-pellet volley
// left its bones 3% out of length at a 1/60 s step and 29-42% out at a 1/300 s step, with joints at 116-170 m/s:
// about a quarter second after the volley the arm keep-outs' speed doubled every step.
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { ROOMS, wanderBounds, spawnPoints } from './game-level';
import type { Vec3 } from '../types';

const stubView = () => ({ setRootShift: () => {}, update: () => {}, setHeadRotation: () => {}, setTime: () => {} });

function zombie() {
  const doc = parseBlob(zombieBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  const room = ROOMS[0]!;
  const start = spawnPoints(room)[0]! as Vec3;
  const a = createZombieActor({
    id: 1, room: room.id, body: translateBody(built, start), view: stubView() as never,
    start, seed: 1337, bounds: wanderBounds(room), furniture: [],
  });
  for (let i = 0; i < 30; i++) a.step(1 / 60);
  return a;
}

/** Fires one volley of `pellets` at the `where` of a standing zombie, the pellets landing over `overFrames` frames,
 *  then steps a second of sim time in frames of `dt`. Returns the most any bone left its length (a fraction of it). */
function worstStretch(dt: number, where: 'torso' | 'head', pellets: number, overFrames: number): number {
  const a = zombie();
  let s = 7;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let worst = 0;
  for (let frame = 0; frame < Math.round(1 / dt); frame++) {
    const n = frame < overFrames ? Math.round(pellets * (frame + 1) / overFrames) - Math.round(pellets * frame / overFrames) : 0;
    if (n) {
      a.beginHits();
      for (let i = 0; i < n; i++) {
        const c = a.posed().clusters.find(k => k.limb === where)!.center;
        a.hit([c[0] + (rng() - 0.5) * 0.2, c[1] + (rng() - 0.5) * 0.25, c[2] + 0.1], [0, 0, -1]);
      }
      a.endHits();
    }
    a.step(dt);
    expect(a.debug().phase, 'the volley does not kill: the body is judged standing').toBe('standing');
    const rig = a.boundRig().rig;
    for (const c of rig.constraints) {
      if (c.rest <= 0.03) continue;
      const A = rig.points[c.a]!.pos, B = rig.points[c.b]!.pos;
      worst = Math.max(worst, Math.abs(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) - c.rest) / c.rest);
    }
  }
  return worst;
}

describe('a standing zombie shot in bullet time keeps its shape', () => {
  for (const where of ['torso', 'head'] as const) {
    it(`a volley into the ${where}: bones stay within 15% of their length at 0.2x, as at full speed`, () => {
      expect(worstStretch(1 / 60, where, 10, 1)).toBeLessThan(0.15);
      expect(worstStretch(1 / 300, where, 10, 1)).toBeLessThan(0.15);
      // The pellets fly at half speed in bullet time and land over several frames.
      expect(worstStretch(1 / 300, where, 10, 8)).toBeLessThan(0.15);
    });
  }
});
