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
import { ZOMBIE_PROFILE } from '../motion-profile';
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

/** Double-barrel volleys into the chest along +x until it drops. */
function shootDead(a: ReturnType<typeof mk>, seed: number) {
  let s = seed;
  const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let v = 0; v < 6 && a.debug().phase === 'standing'; v++) {
    a.beginHits();
    for (let i = 0; i < 20; i++) {
      const c = a.posed().clusters.find(k => k.limb === 'torso')!.center;
      a.hit([c[0] - 0.1, c[1] + (rng() - 0.5) * 0.3, c[2] + (rng() - 0.5) * 0.2], [1, 0, 0],
        { weapon: 'shotgun', origin: [-1.2, 1.4, 0], barrels: 2, shotId: v } as never);
    }
    a.endHits();
    a.step(1 / 60);
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

  // Owner playtest 2026-11-12: "a thrown body cant like knock or displace another body" (game-actor.ts BODY_KNOCK).
  it('strikes the body standing where it is shot dead toward, on arrival, not while it presses on it: ragdoll and authored fall', () => {
    for (const authored of [false, true]) for (const seed of [107, 135]) {
      setDeathFall({ on: authored });
      const standing: BodyObstacle = { id: 2, kind: 'upright', x: 1, z: 0, r: CORPSE_CONTACT.uprightR, y0: 0.35, y1: 1.8 };
      const a = createZombieActor({
        id: 1, room: 1, body: translateBody(built, [0, 0, 0]), view: stubView() as never, start: [0, 0, 0], seed,
        bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [],
        ...(authored ? { profile: { ...ZOMBIE_PROFILE, physicsDeath: false } } : {}),
      });
      for (let i = 0; i < 12; i++) a.step(1 / 60);
      shootDead(a, seed);
      const hits: { id: number; dir: Vec3; speed: number }[] = [];
      for (let i = 0; i < 180; i++) {
        a.setBodyObstacles!([standing]);
        a.step(1 / 60);
        hits.push(...a.takeBodyHits!());
      }
      // An authored fall pulls its joints at the body for as long as it is in the way (120 steps of "10 m/s into
      // it"): still one blow. A ragdoll's limb may flop onto it again half a second later: a blow of its own.
      const what = `authored ${authored}, seed ${seed}`;
      expect(hits.length, what).toBeGreaterThanOrEqual(1);
      expect(hits.length, what).toBeLessThanOrEqual(authored ? 1 : 2);
      expect(hits.every(h => h.id === 2), what).toBe(true);
      expect(hits[0]!.speed, what).toBeGreaterThan(3);
      expect(hits[0]!.dir[0], what).toBeGreaterThan(0.5);
    }
    setDeathFall({ on: true });
  });

  it('a struck body is knocked along the blow and staggers; not twice at once, not by a nudge, not once down', () => {
    const knocked = mk(1, [0, 0, 0], 5), twin = mk(2, [0, 0, 0], 5);
    for (let i = 0; i < 12; i++) { knocked.step(1 / 60); twin.step(1 / 60); }
    expect(knocked.bodyKnock!([1, 0, 0], 2)).toBe(false);
    expect(knocked.bodyKnock!([1, 0, 0], 8)).toBe(true);
    expect(knocked.bodyKnock!([1, 0, 0], 8)).toBe(false);
    for (let i = 0; i < 30; i++) { knocked.step(1 / 60); twin.step(1 / 60); }
    expect(knocked.pose().pos[0] - twin.pose().pos[0]).toBeGreaterThan(0.25);
    expect(knocked.debug().phase).toBe('standing');
    for (let i = 0; i < 30; i++) knocked.step(1 / 60);
    expect(knocked.bodyKnock!([1, 0, 0], 8)).toBe(true);
    knocked.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
    for (let i = 0; i < 60; i++) knocked.step(1 / 60);
    expect(knocked.bodyKnock!([1, 0, 0], 8)).toBe(false);
  });

  // A sector level's walls are lines (LevelGround.blockingNear), not boxes: a corpse met none of them. And an authored
  // fall stopped by a wall went on pulling its pose into it: crushed flat against the face, it thrashed for good
  // (shoulders at 12-15 m/s nine seconds on; game-actor.ts THE FALL GOES LIMP). It lets go and lies down asleep.
  it('a body shot dead beside a sector wall line stays on its side of it, lies down and falls asleep', () => {
    for (const authored of [true, false]) for (const seed of [107, 135]) {
      setDeathFall({ on: authored });
      // One wall along z at x = 0.8, any height; a flat floor.
      const ground = { floorAt: () => 0, ceilAt: () => Infinity, blockingNear: () => [{ ax: 0.8, az: -5, bx: 0.8, bz: 5 }] };
      const a = createZombieActor({
        id: 1, room: 1, body: translateBody(built, [0, 0, 0]), view: stubView() as never, start: [0, 0, 0], seed,
        bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [], ground,
        ...(authored ? { profile: { ...ZOMBIE_PROFILE, physicsDeath: false } } : {}),
      });
      for (let i = 0; i < 12; i++) a.step(1 / 60);
      shootDead(a, seed);
      expect(a.debug().phase, 'the volleys kill it').not.toBe('standing');
      let past = -Infinity;
      for (let i = 0; i < 420; i++) {
        a.step(1 / 60);
        for (const p of a.rigJoints().points) past = Math.max(past, p[0]! - 0.8);
      }
      const what = `authored ${authored}, seed ${seed}`;
      expect(past, what).toBeLessThan(0);
      const still = a.rigJoints().points.map(p => [...p]);
      for (let i = 0; i < 60; i++) a.step(1 / 60);
      const moved = Math.max(...a.rigJoints().points.map((p, i) => Math.hypot(p[0]! - still[i]![0]!, p[1]! - still[i]![1]!, p[2]! - still[i]![2]!)));
      expect(moved, what).toBe(0);
      expect(Math.max(...a.rigJoints().points.map(p => p[1]!)), what).toBeLessThan(0.7);
    }
    setDeathFall({ on: true });
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

  // Owner playtest 2026-11-12: "a 'blown away' body ... clips through walls". An authored 'blown' fall carries its
  // pose 1.6-2.4 m along the shot and pulls every joint after it. A joint resting on the wall's face sank a step
  // into it every other step (corpse-contact.ts THE ENTRY AT THE START), came out the far side from past the middle,
  // and the body followed: 1.5 m past a 30 cm wall, 1.7 m past a 10 cm one.
  it('a body shot dead beside a wall stays on its side of it: authored fall and ragdoll, thick wall and thin', () => {
    for (const authored of [true, false]) for (const thick of [0.3, 0.1]) for (const seed of [107, 135]) {
      setDeathFall({ on: authored });
      const wall = { min: [0.8, 0, -5] as Vec3, max: [0.8 + thick, 3, 5] as Vec3 };
      const a = createZombieActor({
        id: 1, room: 1, body: translateBody(built, [0, 0, 0]), view: stubView() as never, start: [0, 0, 0], seed,
        bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [], colliders: () => [wall],
        ...(authored ? { profile: { ...ZOMBIE_PROFILE, physicsDeath: false } } : {}),
      });
      for (let i = 0; i < 12; i++) a.step(1 / 60);
      shootDead(a, seed);
      expect(a.debug().phase, 'the volleys kill it').not.toBe('standing');
      let past = -Infinity;
      for (let i = 0; i < 180; i++) {
        a.step(1 / 60);
        for (const p of a.rigJoints().points) past = Math.max(past, p[0]! - wall.min[0]);
      }
      expect(past, `authored ${authored}, wall ${thick} m, seed ${seed}`).toBeLessThan(0.02);
    }
    setDeathFall({ on: true });
  });
});
