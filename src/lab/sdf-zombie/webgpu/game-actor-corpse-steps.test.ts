// src/lab/sdf-zombie/webgpu/game-actor-corpse-steps.test.ts
//
// A corpse steps a fixed 1/60 s whatever the frame's dt (game-actor.ts FIXED CORPSE STEPS). Stepped
// with short frames (bullet time, a 120 Hz screen) or through the hit-stop's near-zero frames, the
// free ragdoll's per-step shoves became speed: the owner's "breakdancing" corpse threw its legs
// metres into the air (3 m and 242 m/s at quarter speed in the arena, 2026-11-03).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setDeathFall } from '../death-fall';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { ROOMS, wanderBounds, spawnPoints } from './game-level';
import type { Vec3 } from '../types';

const stubView = () => ({ setRootShift: () => {}, update: () => {}, setHeadRotation: () => {}, setTime: () => {} });

function corpse() {
  const doc = parseBlob(zombieBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  const room = ROOMS[0]!;
  const start = spawnPoints(room)[0]! as Vec3;
  const a = createZombieActor({
    id: 1, room: room.id, body: translateBody(built, start), view: stubView() as never,
    start, seed: 1337, bounds: wanderBounds(room), furniture: [],
  });
  a.step(1 / 60);
  a.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
  return a;
}

/** Steps `seconds` of sim time with frame i lasting dtOf(i); returns the highest any rig point
 *  reaches after the first 1.5 s (the fall is over by then). */
function highestAfterFall(dtOf: (i: number) => number, seconds: number): number {
  const a = corpse();
  let t = 0, top = -Infinity;
  for (let i = 0; t < seconds; i++) {
    const dt = dtOf(i);
    a.step(dt);
    t += dt;
    if (t > 1.5) top = Math.max(top, ...a.rigJoints().points.map(p => p[1]!));
  }
  return top;
}

describe('a corpse steps the same at any frame rate', () => {
  beforeAll(() => setDeathFall({ on: false }));
  afterAll(() => setDeathFall({ on: true }));

  it('lies down the same at quarter speed and through the hit-stop as at 60 Hz', () => {
    const base = highestAfterFall(() => 1 / 60, 3);
    expect(base).toBeLessThan(0.8);
    expect(highestAfterFall(() => 1 / 240, 3)).toBeLessThan(0.8);
    expect(highestAfterFall(i => (i % 12) < 4 ? 0.0003 : 1 / 60, 3)).toBeLessThan(0.8);
  });
});

describe('a corpse falls asleep (game-actor.ts CORPSE SLEEP)', () => {
  beforeAll(() => setDeathFall({ on: false }));
  afterAll(() => setDeathFall({ on: true }));
  const pose = (a: ReturnType<typeof corpse>) => a.rigJoints().points.map(p => [...p]);
  const moved = (a: number[][], b: number[][]) => Math.max(...a.map((p, i) => Math.hypot(p[0]! - b[i]![0]!, p[1]! - b[i]![1]!, p[2]! - b[i]![2]!)));

  it('stops moving once it lies still, and an impulse wakes it', () => {
    const a = corpse();
    for (let i = 0; i < 6 * 60; i++) a.step(1 / 60);
    const still = pose(a);
    for (let i = 0; i < 60; i++) a.step(1 / 60);
    expect(moved(pose(a), still)).toBe(0);
    const hand = a.rigJoints().points[0]!;
    a.rigImpulse([hand[0]!, hand[1]!, hand[2]!], [0, 0.05, 0]);
    a.step(1 / 60); a.step(1 / 60);
    expect(moved(pose(a), still)).toBeGreaterThan(1e-3);
  });
});
