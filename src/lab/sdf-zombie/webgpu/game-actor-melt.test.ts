// src/lab/sdf-zombie/webgpu/game-actor-melt.test.ts
//
// The melt on a game actor (game-actor.ts beginMelt / stepMelt): a body standing AWAY from the origin, on the
// real actor with a stub view. The lab's melt was written for a body on the origin at y = 0; these are the
// properties that broke the moment it was not.
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor, rollMelt } from './game-actor';
import { ROOMS, wanderBounds, spawnPoints } from './game-level';
import { MELT_TUNING_BODY } from '../melt';
import { BONE_GROUPS, mulberry32 } from '../melt-bones';
import type { Primitive, Vec3 } from '../types';

function actor() {
  const uploads: { melt: number; updates: number } = { melt: 0, updates: 0 };
  const view = {
    setRootShift: () => {}, setHeadRotation: () => {}, setTime: () => {},
    update: () => { uploads.updates++; }, setMelt: (t: number) => { uploads.melt = t; },
    setPackBones: () => {}, setBonesBare: () => {},
  };
  const bones: { group: string; origin: Vec3; bones: Primitive[]; vel: Vec3 }[] = [];
  const doc = parseBlob(zombieBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  const room = ROOMS[0]!;
  const start = spawnPoints(room)[0]! as Vec3;
  const a = createZombieActor({
    id: 1, room: room.id, body: translateBody(built, start), view: view as never,
    start, seed: 1337, bounds: wanderBounds(room), furniture: [],
    onMeltBone: (piece, vel) => bones.push({ ...piece, vel }),
  });
  for (let i = 0; i < 30; i++) a.step(1 / 60);
  return { a, uploads, bones, start };
}

const extent = (prims: readonly Primitive[]) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
  for (const p of prims) for (const e of [p.a, p.b]) {
    x0 = Math.min(x0, e[0]); x1 = Math.max(x1, e[0]); z0 = Math.min(z0, e[2]); z1 = Math.max(z1, e[2]);
    y1 = Math.max(y1, e[1]);
  }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, top: y1 };
};

describe('a game actor melts where it stands', () => {
  it('pools on its own floor about its own axis, and reads as a corpse once it stops', () => {
    const { a, uploads } = actor();
    const at = a.pose().pos;
    expect(Math.hypot(at[0], at[2])).toBeGreaterThan(1);   // the point of the test: not on the origin
    const stood = extent(a.posed().prims);
    expect(a.melting()).toBe(false);
    expect(a.beginMelt()).toBe(true);
    expect(a.beginMelt()).toBe(false);                      // once
    // It walks into its melt: a body with no verbs until its legs go, a corpse from then on.
    expect(a.motionFrame()?.collapsed).toBe(false);
    expect(a.hit([at[0], 1, at[2]], [0, 0, 1])).toBeNull(); // goo takes no wound
    for (let i = 0; i < 4 * 60; i++) { a.stepMelt(1 / 60); a.step(1 / 60); }
    expect(a.motionFrame()?.collapsed).toBe(true);
    expect(a.meltProgress()).toBe(1);
    expect(uploads.melt).toBe(1);
    const pool = extent(a.posed().prims);
    expect(pool.top).toBeLessThanOrEqual(at[1] + MELT_TUNING_BODY.poolHeight + 1e-6);
    // It did not slide off toward the world origin: the pool lies where the body came to a stop (it walks on for
    // the first part of the melt), a short way from where it was hit.
    // (It walks on for the first part of the melt and then slumps as a ragdoll, so the pool lies a step or so from
    // where it was hit; what it must not do is leave for the origin, 10 m away.)
    expect(Math.hypot(pool.cx - stood.cx, pool.cz - stood.cz)).toBeLessThan(1.5);
  });

  it('a hit makes the flesh round it go first', () => {
    const run = (hit: boolean) => {
      const { a } = actor();
      const at = a.pose().pos;
      const chest: Vec3 = [at[0], at[1] + 1.3, at[2]];
      const topBefore = extent(a.posed().prims.filter(p => p.limb === 'torso')).top;
      a.beginMelt(hit ? chest : null);
      for (let i = 0; i < 24; i++) a.stepMelt(1 / 60);   // 0.4 s: the feet are going, the chest is not yet
      return topBefore - extent(a.posed().prims.filter(p => p.limb === 'torso')).top;
    };
    expect(run(true)).toBeGreaterThan(run(false) + 0.02);
  });

  it('a head shot melts from the head down: the head sags before the shins', () => {
    const { a } = actor();
    const at = a.pose().pos;
    const drop = (limb: string, before: number) => before - extent(a.posed().prims.filter(p => p.limb === limb)).top;
    const head0 = extent(a.posed().prims.filter(p => p.limb === 'head')).top;
    const leg0 = extent(a.posed().prims.filter(p => p.limb === 'legL')).top;
    a.beginMelt([at[0], at[1] + 1.62, at[2]]);
    for (let i = 0; i < 30; i++) a.stepMelt(1 / 60);
    expect(drop('head', head0)).toBeGreaterThan(0.05);
    expect(drop('legL', leg0)).toBeLessThan(0.02);
  });

  it('no two melts on a page are the same (rollMelt), and the same seed rolls the same', () => {
    const r = (seed: number) => rollMelt(mulberry32(seed));
    expect(r(1)).toEqual(r(1));
    expect(r(1).rate).not.toBe(r(2).rate);
    expect(r(1).tuning.lean).not.toEqual(r(2).tuning.lean);
    for (let i = 0; i < 50; i++) {
      const x = r(i);
      expect(x.rate).toBeGreaterThan(0.79); expect(x.rate).toBeLessThan(1.26);
      expect(x.slumpAt).toBeGreaterThan(0.33); expect(x.slumpAt).toBeLessThan(0.71);
    }
  });

  it('lets go of every bone group once, low groups first, near the body', () => {
    const { a, bones } = actor();
    const at = a.pose().pos;
    a.beginMelt();
    for (let i = 0; i < 4 * 60; i++) a.stepMelt(1 / 60);
    expect(bones.map(b => b.group).sort()).toEqual([...BONE_GROUPS].sort());
    expect(bones[0]!.group.startsWith('shin')).toBe(true);
    expect(bones[bones.length - 1]!.group).toBe('skull');
    for (const b of bones) {
      expect(Math.hypot(b.origin[0] - at[0], b.origin[2] - at[2])).toBeLessThan(1);
      expect(b.bones.length).toBeGreaterThan(0);
    }
    // The feet go with the shins, not with the ribcage: a cage that reaches the floor never falls.
    const cage = bones.find(b => b.group === 'cage')!;
    expect(Math.min(...cage.bones.flatMap(p => [p.a[1], p.b[1]])) - at[1]).toBeGreaterThan(0.6);
  });

  it('a set puddle costs nothing: no pack, no upload, and the body no longer steps', () => {
    const { a, uploads } = actor();
    a.beginMelt();
    // Through the melt and the pool's afterlife (it creeps on for a couple of seconds after it sets).
    for (let i = 0; i < 8 * 60; i++) { a.stepMelt(1 / 60); a.step(1 / 60); }
    expect(a.meltDone()).toBe(true);
    const n = uploads.updates;
    const pose = JSON.stringify(a.rigJoints().points);
    for (let i = 0; i < 60; i++) { a.stepMelt(1 / 60); a.step(1 / 60); }
    expect(uploads.updates).toBe(n);
    expect(JSON.stringify(a.rigJoints().points)).toBe(pose);
  });
});
