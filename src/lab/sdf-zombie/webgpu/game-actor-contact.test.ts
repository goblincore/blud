// src/lab/sdf-zombie/webgpu/game-actor-contact.test.ts
//
// A CORPSE MEETS THE WORLD (corpse-contact.ts) through the actor: a zombie shoved dead at 14 m/s stays on its side of
// a 30 cm wall box (opts.colliders) and out of a body standing behind it (setBodyObstacles). Without them the
// same throws put points 70 cm through the wall.
import { describe, expect, it } from 'vitest';
import { setDeathFall } from '../death-fall';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { CORPSE_CONTACT, type BodyObstacle } from '../corpse-contact';
import type { Vec3 } from '../types';

const stubView = () => ({ setRootShift: () => {}, update: () => {}, setHeadRotation: () => {}, setTime: () => {} });
const doc = parseBlob(zombieBlobSrc);
const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
const WALL = { min: [0.5, 0, -5] as Vec3, max: [0.8, 3, 5] as Vec3 };
const mk = (id: number, at: Vec3, seed: number) => createZombieActor({
  id, room: 1, body: translateBody(built, at), view: stubView() as never, start: at, seed,
  bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [], colliders: () => [WALL],
});
/** Shove `a` dead along x at 14 m/s and step it (and `other`) 2 s; `each` sees every step's points. */
function throwDead(a: ReturnType<typeof mk>, other: ReturnType<typeof mk>, dir: 1 | -1, each: (p: Vec3[]) => void) {
  for (let t = 0; t < 0.2; t += 1 / 60) { a.step(1 / 60); other.step(1 / 60); }
  const chest = a.rigJoints().points[a.rigJoints().names.indexOf('chest')]!;
  a.blast({ wounds: [], meterCredit: 0, impulse: { at: chest, vel: [dir * 14, 3, 0] }, reaction: 'none', forceCollapse: true });
  for (let t = 0; t < 2; t += 1 / 60) {
    a.setBodyObstacles!(other.bodyObstacles!());
    a.step(1 / 60); other.step(1 / 60);
    each(a.rigJoints().points);
  }
}

describe('a thrown corpse meets the world', () => {
  it('stays on its side of a wall it is thrown at', () => {
    setDeathFall({ on: false });
    for (const seed of [107, 121, 135]) {
      let past = 0;
      throwDead(mk(1, [0, 0, 0], seed), mk(2, [-3, 0, 0], 9), 1, P => {
        for (const p of P) past = Math.max(past, p[0] - WALL.min[0]);
      });
      expect(past).toBeLessThan(0.02);
    }
  });

  it('stays out of a body standing where it is thrown', () => {
    setDeathFall({ on: false });
    // A body standing 60 cm behind (bodyObstacles' shape, held still so the throw always reaches it).
    const standing: BodyObstacle = { id: 2, kind: 'upright', x: -0.6, z: 0, r: CORPSE_CONTACT.uprightR, y0: 0.35, y1: 1.8 };
    const still = { step: () => {}, bodyObstacles: () => [standing] } as unknown as ReturnType<typeof mk>;
    for (const seed of [100, 114, 128]) {
      // The blast can land a limb inside it; it is out within a few steps and never deep.
      let closest = Infinity, closestLater = Infinity, step = 0;
      throwDead(mk(1, [0, 0, 0], seed), still, -1, P => {
        for (const p of P) if (p[1] > 0.5) {
          const d = Math.hypot(p[0] - standing.x, p[2] - standing.z);
          closest = Math.min(closest, d);
          if (step >= 3) closestLater = Math.min(closestLater, d);
        }
        step++;
      });
      expect(closest).toBeGreaterThan(0.2);
      expect(closestLater).toBeGreaterThan(CORPSE_CONTACT.uprightR);
    }
  });

  it('a standing body offers an upright cylinder at its feet, a corpse its trunk', () => {
    const a = mk(1, [1, 0, 2], 3);
    a.step(1 / 60);
    const [o] = a.bodyObstacles!();
    expect(o).toMatchObject({ id: 1, kind: 'upright' });
    const at = o as Extract<BodyObstacle, { kind: 'upright' }>;
    expect(at.x).toBeCloseTo(1, 2);
    expect(at.z).toBeCloseTo(2, 2);
    a.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
    for (let t = 0; t < 0.5; t += 1 / 60) a.step(1 / 60);
    expect(a.bodyObstacles!().map(b => b.kind)).toEqual(['sphere', 'sphere', 'sphere']);
  });
});
