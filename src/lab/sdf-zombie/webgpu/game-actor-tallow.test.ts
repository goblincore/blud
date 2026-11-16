// The tallow through the GAME actor (createZombieActor) on the mind the game gives it (game-spawn.ts: a `volley`
// profile gets makeTallowMind): the volley has to reach onFire from BOTH cannon muzzles in turn (MotionProfile.spit,
// the right hand bone's tail, and spitL, the left), out in front of him at about chest height once the brace has
// raised the cannons level. No turntable shows any of this; a wrong muzzle or an arm style that ignores the brace
// (STOMP's carry arms did, 2026-11-14) only shows up here or in the arena.
import { describe, it, expect } from 'vitest';
import src from '../characters/tallow.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { createZombieActor } from './game-actor';
import { makeTallowMind } from './enemy-mind';
import { TALLOW_PROFILE } from '../motion-profile';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));

describe('tallow actor (game path)', () => {
  it('braces and fires from the right cannon, then the left, from level muzzles out in front of him', () => {
    // Each shot keeps where he stood when it left: after the volley he walks on to club.
    const shots: { origin: Vec3; direction: Vec3; pos: Vec3 }[] = [];
    const a: ReturnType<typeof createZombieActor> = createZombieActor({
      id: 1, room: 1, seed: 7, start: [0, 0, 0],
      bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
      body,
      view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
      profile: TALLOW_PROFILE, mind: makeTallowMind(), onFire: s => shots.push({ ...s, pos: [...a.pose().pos] as Vec3 }),
    });
    for (let i = 0; i < 360; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 9, room: 1 }, true);
      a.step(1 / 60);
    }
    expect(shots.length, 'a volley of four').toBeGreaterThanOrEqual(4);
    // Body-local x (he faces the player at +z, so world x is near enough): his right cannon at -x, left at +x.
    const xs = shots.slice(0, 4).map(s => s.origin[0] - s.pos[0]);
    expect(xs[0], 'first round from the right cannon').toBeLessThan(-0.5);
    expect(xs[1], 'second from the left').toBeGreaterThan(0.5);
    expect(xs[2]).toBeLessThan(-0.5);
    expect(xs[3]).toBeGreaterThan(0.5);
    for (const s of shots.slice(0, 4)) {
      // Braced level: the muzzles at about his chest (hanging, they sit at y ~0.74), well out in front.
      expect(s.origin[1], 'raised by the brace').toBeGreaterThan(1.0);
      expect(s.origin[2] - s.pos[2], 'out in front of him').toBeGreaterThan(0.6);
    }
  });
});
