import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import soldierSrc from '../characters/soldier.blob?raw';
import { GUN_GRIP, gunPoint } from '../carry';
import { SOLDIER_PROFILE } from '../motion-profile';
import { jointNamesForBody } from '../gait';
import type { Vec3 } from '../types';
import { makeSoldierMind } from './enemy-mind';
import { createZombieActor } from './game-actor';
import { createEncounterNavigation } from './encounter-navigation';
import { ROOMS, type Aabb } from './game-level';

const bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
// The actor starts one millimetre outside the inflated north face.
const crate: Aabb = { min: [-2, 0, -2], max: [2, 2, -.551] };

function subject(mode: 'free' | 'furniture' | 'navigation') {
  const body = buildBody(compileBlob(parseBlob(soldierSrc)));
  const handIndex = jointNamesForBody(body).indexOf('handR');
  let rendered: Vec3 = [0, 0, 0];
  let rejections = 0;
  const nav = createEncounterNavigation([{ ...ROOMS[0]!, ...bounds }], [], [crate], .55);
  const actor = createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0], bounds, body,
    furniture: mode === 'furniture' ? [crate] : [],
    profile: SOLDIER_PROFILE, mind: makeSoldierMind(),
    view: { setRootShift(x: number, z: number) { rendered = [x, 0, z]; },
      update() {}, setHeadRotation() {}, setTime() {} } as any,
    ...(mode === 'navigation' ? { navigation: { ...nav, canTravel(a: Vec3, b: Vec3) {
      const allowed = nav.canTravel(a, b);
      if (!allowed) rejections++;
      return allowed;
    } } } : {}),
  });
  // A real nonfatal slug starts the strong-hit movement through the actor.
  const chest = actor.posed().prims.find(p => p.bone === 'chest' && !p.dead)!;
  actor.hitSlug([chest.a[0], (chest.a[1] + chest.b[1]) / 2, chest.a[2] + chest.radius], [0, 0, -1]);
  return { actor, handIndex, rendered: () => rendered, rejections: () => rejections };
}

describe('actor collision frame correction', () => {
  for (const mode of ['furniture', 'navigation'] as const) {
    it(`${mode} keeps the rendered root and gun with the corrected body during a stumble`, () => {
      const s = subject(mode);
      const free = subject('free');
      for (let i = 0; i < 35; i++) {
        s.actor.step(1 / 60);
        free.actor.step(1 / 60);
        const frame = s.actor.motionFrame()!;
        expect(frame.collapsed).toBe(false);
        expect(s.rendered()[0]).toBeCloseTo(s.actor.pose().pos[0], 9);
        expect(s.rendered()[2]).toBeCloseTo(s.actor.pose().pos[2], 9);
        expect(frame.rootShift[2]).toBeCloseTo(s.actor.pose().pos[2], 9);
        expect(s.actor.pose().pos[2]).toBeGreaterThanOrEqual(-.001000001);
        const hand = s.actor.boundRig().rig.points[s.handIndex]!.pos;
        const grip = gunPoint(frame.gun!, GUN_GRIP.gripHand);
        expect(Math.hypot(...grip.map((v, j) => v - hand[j]!))).toBeLessThan(1e-8);
      }
      // Ensure the collision assertions exercised displacement, not an idle frame.
      expect(free.actor.pose().pos[2]).toBeLessThan(-.02);
      if (mode === 'navigation') expect(s.rejections()).toBeGreaterThan(0);
    });
  }
});
