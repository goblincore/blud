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

  it('breathes in the game, and a shot quivers the brain and convulses the whole frame', () => {
    // The game actor applied no swell at all (only actor.ts did, for the lab): the brain never pulsed in the arena.
    // A hit QUIVERS the flesh (MotionProfile.fleshJiggle) and JUDDERS the whole rigid frame (motion.ts JUDDER).
    const a = cerebrax(() => {});
    const flesh = body.prims.map((p, i) => [p, i] as const).filter(([p]) => p.limb === 'torso' && !p.metal).map(([, i]) => i);
    const core = body.prims.findIndex(p => p.limb === 'torso' && p.core);
    const posed = () => (a as any).posed().prims as { a: Vec3; radius: number }[];
    // Body-local: the actor may wander and turn while it rings.
    const local = (p: Vec3): Vec3 => {
      const { pos, yaw } = a.pose(), x = p[0] - pos[0], z = p[2] - pos[2], c = Math.cos(yaw), s = Math.sin(yaw);
      return [x * c - z * s, p[1], x * s + z * c];
    };
    const step = () => { a.setRingInput(false, 0); a.step(1 / 60); };
    const radii: number[] = [], calmCore: Vec3[] = [];
    for (let i = 0; i < 120; i++) { step(); radii.push(posed()[core]!.radius); calmCore.push(local(posed()[core]!.a)); }
    // How far the core wanders about its mean UNHIT (the gait's bob and sway): the bar a rung-out brain is held to.
    const mean = [0, 1, 2].map(j => calmCore.reduce((t, p) => t + p[j]!, 0) / calmCore.length);
    const calmSpan = Math.max(...calmCore.map(p => Math.hypot(...p.map((v, j) => v - mean[j]!))));
    expect(Math.max(...radii) - Math.min(...radii), 'the breath moves the core').toBeGreaterThan(0.004);
    const before = posed().map(p => local(p.a));
    const c = posed()[core]!.a;
    a.hit([c[0] + 0.4, c[1] + 0.35, c[2] + 0.6], [-0.3, -0.2, -1]);
    let most = 0;
    for (let i = 0; i < 12; i++) {
      step();
      const now = posed().map(p => local(p.a));
      for (const k of flesh) most = Math.max(most, Math.hypot(...now[k]!.map((v, j) => v - before[k]![j]!)));
    }
    expect(most, 'a struck lobe lurches several cm, not a breath').toBeGreaterThan(0.05);
    // ... and it rings out: a few seconds later the flesh is back on its frame.
    for (let i = 0; i < 240; i++) step();
    expect(Math.hypot(...local(posed()[core]!.a).map((v, j) => v - mean[j]!)), 'rung out: back within its unhit bob').toBeLessThan(calmSpan + 0.01);
  });
});
