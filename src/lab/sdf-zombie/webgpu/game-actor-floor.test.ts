// src/lab/sdf-zombie/webgpu/game-actor-floor.test.ts
//
// Bodies stand on the floor under them (sector levels 3a, Task 4), at the actor: a body built
// standing on a 1 m floor and handed that ground walks exactly like the same body on y = 0, lifted
// 1 m: not 2 m (the spawn floor is in the built body AND in MotionState.floorY), and not sinking.
import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { ROOMS, wanderBounds, spawnPoints } from './game-level';
import { FLAT_GROUND, type LevelGround } from './level-ground';
import type { Vec3 } from '../types';

const stubView = () => ({ setRootShift: () => {}, update: () => {}, setHeadRotation: () => {}, setTime: () => {} });

function actorAt(start: Vec3, ground?: LevelGround) {
  const doc = parseBlob(zombieBlobSrc);
  const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
  const room = ROOMS[0]!;
  return createZombieActor({
    id: 1, room: room.id, body: translateBody(built, start), view: stubView() as never,
    start, seed: 1337, bounds: wanderBounds(room), furniture: [],
    ...(ground ? { ground } : {}),
  });
}

describe('an actor on a sector floor', () => {
  it('walks exactly like the flat body, lifted by the floor', () => {
    const [x, , z] = spawnPoints(ROOMS[0]!)[0]!;
    const flat = actorAt([x, 0, z]);
    const up = actorAt([x, 1, z], { ...FLAT_GROUND, floorAt: () => 1 });
    for (let f = 0; f < 240; f++) { flat.step(1 / 60); up.step(1 / 60); }
    expect(up.pose().pos[1]).toBe(1);
    expect(flat.pose().pos[1]).toBe(0);
    const a = flat.posed().prims, b = up.posed().prims;
    expect(b.length).toBe(a.length);
    a.forEach((p, i) => {
      expect(b[i]!.a[0]).toBeCloseTo(p.a[0]!, 6);
      expect(b[i]!.a[1]).toBeCloseTo(p.a[1]! + 1, 6);
      expect(b[i]!.a[2]).toBeCloseTo(p.a[2]!, 6);
    });
  });

  it('keeps standing on its floor when the ground answers NaN (off the map)', () => {
    const [x, , z] = spawnPoints(ROOMS[0]!)[0]!;
    const flat = actorAt([x, 0, z]);
    const up = actorAt([x, 0.5, z], { ...FLAT_GROUND, floorAt: () => NaN });
    for (let f = 0; f < 120; f++) { flat.step(1 / 60); up.step(1 / 60); }
    expect(up.pose().pos[1]).toBe(0.5);
    const lo = (prims: ReturnType<typeof flat.posed>['prims']) => Math.min(...prims.map(p => Math.min(p.a[1]!, p.b[1]!)));
    expect(lo(up.posed().prims)).toBeCloseTo(lo(flat.posed().prims) + 0.5, 6);
  });

  // Plan 3b Task 6: a collapsed body meets the floor under each rig point, never climbing more than
  // FALL_DROP_M: a corpse at a pit's lip hangs into it; one against a high ledge wall lies as on flat.
  it('a corpse hangs into a pit beside it and ignores a ledge wall higher than FALL_DROP_M', () => {
    const [x, , z] = spawnPoints(ROOMS[0]!)[0]!;
    const ring = (inside: number, outside: number) => ({ ...FLAT_GROUND,
      floorAt: (px: number, pz: number) => (Math.hypot(px - x, pz - z) > 0.3 ? outside : inside) });
    const flat = actorAt([x, 0, z], ring(0, 0));
    const pit = actorAt([x, 0, z], ring(0, -2));
    const wall = actorAt([x, 0, z], ring(0, 2));
    const all = [flat, pit, wall];
    for (const a of all) a.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
    for (let f = 0; f < 240; f++) for (const a of all) a.step(1 / 60);
    for (const a of all) expect(a.debug().phase).not.toBe('standing');
    const lo = (a: typeof flat) => Math.min(...a.posed().prims.map(p => Math.min(p.a[1]!, p.b[1]!)));
    expect(lo(pit)).toBeLessThan(lo(flat) - 0.3);
    expect(wall.posed().prims.map(p => [...p.a, ...p.b])).toEqual(flat.posed().prims.map(p => [...p.a, ...p.b]));
  });
});
