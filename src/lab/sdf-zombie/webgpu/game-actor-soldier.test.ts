import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import soldierSrc from '../characters/soldier.blob?raw';
import { SOLDIER_PROFILE } from '../motion-profile';
import { makeSoldierMind } from './enemy-mind';
import { createZombieActor, segmentHitsBox, clearCombatMove } from './game-actor';
import { gunPoint, GUN_GRIP } from '../carry';
import { qRotate } from '../vec';
import type { Aabb } from './game-level';

function soldier(furniture: Aabb[] = []) {
  const shots: { age: number; kicks: number; origin: readonly number[]; direction: readonly number[]; expectedOrigin: readonly number[]; expectedDirection: readonly number[] }[] = [];
  const actor = createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, furniture,
    body: buildBody(compileBlob(parseBlob(soldierSrc))),
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: SOLDIER_PROFILE, mind: makeSoldierMind(),
    onFire: (shot) => {
      const frame = actor.motionFrame()!;
      shots.push({ age: actor.sinceFire(), kicks: frame.kicks.length,
        origin: shot?.origin ?? [], direction: shot?.direction ?? [],
        expectedOrigin: frame.gun ? gunPoint(frame.gun, GUN_GRIP.muzzle) : [],
        expectedDirection: frame.gun ? qRotate(frame.gun.quat, [0, 0, 1]) : [],
      });
    },
  });
  return { actor, shots };
}

describe('soldier actor combat wiring', () => {
  it('the released shot, current gun pose, and recoil share the same frame', () => {
    const { actor, shots } = soldier();
    for (let i = 0; i < 600 && shots.length === 0; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]!.age).toBe(0);
    expect(shots[0]!.kicks).toBeGreaterThan(0);
    expect(shots[0]!.origin).toEqual(shots[0]!.expectedOrigin);
    expect(shots[0]!.direction).toEqual(shots[0]!.expectedDirection);
  });

  it('a tall crate interrupts line of sight instead of permitting a shot through it', () => {
    const { actor, shots } = soldier([{ min: [-3, 0, 1], max: [3, 2, 1.5] }]);
    for (let i = 0; i < 480; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(shots).toHaveLength(0);
    expect(actor.pose().pos[2]).toBeLessThan(0.46);
  });
});


describe('solid geometry sight and projectile segments', () => {
  const box: Aabb = { min: [-1, 0, 1], max: [1, 1, 2] };
  it('blocks a shot crossing a thin obstacle even when both endpoints are outside', () => {
    expect(segmentHitsBox([0, 0.5, 0], [0, 0.5, 5], box)).toBe(true);
  });
  it('permits a shot above low cover and rejects a parallel miss', () => {
    expect(segmentHitsBox([0, 1.4, 0], [0, 1.4, 5], box)).toBe(false);
    expect(segmentHitsBox([2, 0.5, 0], [2, 0.5, 5], box)).toBe(false);
  });
});


it('can step away from a crate face but cannot step into it', () => {
  const box: Aabb = { min: [-1, 0, 1], max: [1, 2, 2] };
  expect(clearCombatMove([0, 0, 0.45], [0, 0, -1], [box])).toBe(true);
  expect(clearCombatMove([0, 0, 0.45], [0, 0, 1.5], [box])).toBe(false);
});
