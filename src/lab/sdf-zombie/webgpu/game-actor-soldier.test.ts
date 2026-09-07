import { describe, expect, it, vi } from 'vitest';
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
import { createWoundRing } from './character-view';

function soldier(furniture: Aabb[] = [], releaseProp?: () => void) {
  const shots: { age: number; kicks: number; origin: readonly number[]; direction: readonly number[]; expectedOrigin: readonly number[]; expectedDirection: readonly number[] }[] = [];
  const actor = createZombieActor({
    id: 1, room: 1, seed: 42, start: [0, 0, 0],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, furniture,
    body: buildBody(compileBlob(parseBlob(soldierSrc))),
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: SOLDIER_PROFILE, mind: makeSoldierMind(),
    ...(releaseProp ? { character: { wounds: createWoundRing(), releaseProp } as any } : {}),
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
  const hitLimb = (actor: ReturnType<typeof soldier>['actor'], bone: string, slug = false) => {
    const candidates = actor.posed().prims.filter(p => p.bone === bone && !p.dead);
    const p = candidates.find(p => Math.hypot(...p.a.map((v, i) => v - p.b[i]!)) > 0.01) ?? candidates[0]!;
    const point: [number, number, number] = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2 + p.radius];
    if (bone.startsWith('upperarm')) {
      point[0] += Math.sign(point[0]) * p.radius;
      point[2] -= p.radius;
    }
    return slug ? actor.hitSlug(point, [0, 0, -1]) : actor.hit(point, [0, 0, -1]);
  };

  it('one head pellet causes a terminal fall and prevents all subsequent shots', () => {
    const { actor, shots } = soldier();
    const w = hitLimb(actor, 'skull');
    expect(actor.body.prims[w!.primIdx]!.limb).toBe('head');
    for (let i = 0; i < 180; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(actor.motionFrame()!.collapsed).toBe(true);
    expect(shots).toHaveLength(0);
    expect(hitLimb(actor, 'chest')).not.toBeNull(); // the corpse remains shootable
  });

  it('repeated focused thigh pellets detach the leg and cause a terminal fall', () => {
    const { actor } = soldier();
    for (let i = 0; i < 4; i++) hitLimb(actor, 'thigh.l');
    expect(actor.body.clusters.find(c => c.limb === 'legL')!.alive).toBe(false);
    actor.step(1 / 60);
    expect(actor.motionFrame()!.collapsed).toBe(true);
  });

  it('a severed gun arm cannot leave a firing gun pose behind', () => {
    const release = vi.fn();
    const { actor, shots } = soldier([], release);
    for (let i = 0; i < 4; i++) {
      const w = hitLimb(actor, 'upperarm.r');
      expect(actor.body.prims[w!.primIdx]!.limb).toBe('armR');
    }
    expect(actor.body.clusters.find(c => c.limb === 'armR')!.alive).toBe(false);
    for (let i = 0; i < 180; i++) {
      actor.setBrainInput({ x: 0, z: 2.8, room: 1 }, true);
      actor.step(1 / 60);
    }
    expect(actor.motionFrame()!.gun).toBeNull();
    expect(shots).toHaveLength(0);
    expect(release).toHaveBeenCalled();
  });

  it('a mid-thigh slug causes a strong reaction while the limb remains attached', () => {
    const { actor } = soldier();
    const wound = hitLimb(actor, 'thigh.l', true);
    expect(actor.body.prims[wound!.primIdx]!.limb).toBe('legL');
    actor.step(1 / 60);
    expect(actor.body.clusters.find(c => c.limb === 'legL')!.alive).toBe(true);
    expect(actor.motionFrame()!.collapsed).toBe(false);
    expect(actor.motionFrame()!.staggerKind).toBe('lurch');
  });

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
