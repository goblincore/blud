// src/lab/sdf-zombie/webgpu/game-actor-sector-sight.test.ts
//
// A ranged mind with no encounter order (sector levels 3a, Task 5): its own line of sight runs from
// 1.4 m over its floor to 1.4 m over the player's floor and is blocked by the sector geometry
// (`sectorSight`), so it cannot see — or shoot — the player through a wall.
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import { translateBody } from '../translate';
import cultistSrc from '../characters/cultist.blob?raw';
import { CULTIST_PROFILE } from '../motion-profile';
import { makeSoldierMind } from './enemy-mind';
import { SMG_TUNING } from '../soldier-brain';
import { createZombieActor } from './game-actor';
import { FLAT_GROUND } from './level-ground';
import type { Vec3 } from '../types';

const doc = parseBlob(cultistSrc);
const body = buildBody(compileBlob(doc, compileFace(doc)));

/** A cultist on a 1 m floor with the player 3 m in front (+z); `wall` says what the sector test answers. */
function run(wall: boolean) {
  let fired = 0;
  const asked: [Vec3, Vec3][] = [];
  const start: Vec3 = [0, 1, 0];
  const actor = createZombieActor({
    id: 1, room: 1, seed: 42, start,
    bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
    body: translateBody(body, start),
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as never,
    profile: CULTIST_PROFILE, mind: makeSoldierMind(SMG_TUNING),
    onFire: () => { fired++; },
    character: { wounds: undefined, releaseProp: () => {} } as never,
    ground: { ...FLAT_GROUND, floorAt: () => 1 },
    sectorSight: (a, b) => { asked.push([[...a] as Vec3, [...b] as Vec3]); return wall; },
  });
  for (let i = 0; i < 300; i++) { actor.setBrainInput({ x: 0, z: 3, room: 1 }, true); actor.step(1 / 60); }
  return { fired, asked };
}

describe('a ranged mind\'s own sight on a sector level', () => {
  it('sees and fires through open space, from floor + 1.4 to floor + 1.4', () => {
    const r = run(false);
    expect(r.fired).toBeGreaterThan(0);
    expect(r.asked.length).toBeGreaterThan(0);
    const [a, b] = r.asked[0]!;
    expect(a[1]).toBeCloseTo(2.4, 6);
    expect(b).toEqual([0, 2.4, 3]);
  });
  it('a sector wall between: never fires', () => {
    const r = run(true);
    expect(r.asked.length).toBeGreaterThan(0);
    expect(r.fired).toBe(0);
  });
});
