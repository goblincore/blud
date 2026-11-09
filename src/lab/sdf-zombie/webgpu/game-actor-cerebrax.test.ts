// The cerebrax through the GAME actor (createZombieActor) on the shooting brain the game gives it (game-spawn.ts: a
// `gunner` profile gets makeSoldierMind on its weapon's GUNNER_TUNING): the chaingun has to reach onFire from the
// under-barrel's muzzle (MotionProfile.spit from the hips' rig point), out in front of the body and below the face,
// in long bursts, and the body has to walk in from beyond its fire range.
import { describe, it, expect } from 'vitest';
import src from '../characters/cerebrax.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { createZombieActor } from './game-actor';
import { makeSoldierMind } from './enemy-mind';
import { CEREBRAX_PROFILE } from '../motion-profile';
import { GUNNER_TUNING } from '../soldier-brain';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
function cerebrax(onFire: (s: { origin: Vec3; direction: Vec3 }) => void) {
  return createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: CEREBRAX_PROFILE, mind: makeSoldierMind(GUNNER_TUNING.chaingun), onFire,
  });
}

describe('cerebrax actor (game path)', () => {
  it('fires its chaingun from the under-barrel at a player 6 m off', () => {
    const shots: { origin: Vec3; direction: Vec3 }[] = [];
    const a = cerebrax(s => shots.push(s));
    for (let i = 0; i < 600; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 6, room: 1 }, true);
      a.step(1 / 60);
    }
    expect(shots.length, 'a burst, not a shot').toBeGreaterThanOrEqual(8);
    const o = shots[0]!.origin;
    // The muzzle (assets-source/cerebrax-kit/make_gun.py): ~0.8 m up, hung under the tilted brain's face, ~1.45 m in
    // front of the hips.
    expect(o[1]).toBeGreaterThan(0.6);
    expect(o[1]).toBeLessThan(1.0);
    expect(o[2], 'out in front of the body, not inside the brain').toBeGreaterThan(1.2);
    expect(shots[0]!.direction[2], 'toward the player').toBeGreaterThan(0.5);
  });

  it('walks in on a player beyond its fire range', () => {
    const a = cerebrax(() => {});
    const z0 = a.pose().pos[2];
    for (let i = 0; i < 600; i++) {
      a.setRingInput(true, 0);
      a.setBrainInput({ x: 0, z: 18, room: 1 }, true);
      a.step(1 / 60);
    }
    expect(a.pose().pos[2] - z0, 'it closes the distance').toBeGreaterThan(2);
  });

  it('breathes in the game, and a shot quivers the brain on its rigid frame', () => {
    // The game actor applied no swell at all (only actor.ts did, for the lab): the brain never pulsed in the arena.
    // And with the frame rigid (MotionProfile.rigidFrame), a hit's jiggle is the flesh ringing (SwellJiggle).
    const a = cerebrax(() => {});
    const core = body.prims.findIndex(p => p.limb === 'torso' && p.core);
    const r = () => (a as any).posed().prims[core].radius as number;
    const sample = (n: number) => { const v: number[] = []; for (let i = 0; i < n; i++) { a.setRingInput(false, 0); a.step(1 / 60); v.push(r()); } return v; };
    const calm = sample(120);
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(span(calm), 'the breath moves the core').toBeGreaterThan(0.004);
    const c = (a as any).posed().prims[core].a as Vec3;
    a.hit([c[0], c[1] + 0.3, c[2] + 0.75], [0, 0, -1]);
    const shot = sample(20);
    expect(span(shot), 'a shot rings it harder than a breath').toBeGreaterThan(span(calm.slice(0, 20)) * 2);
  });
});
