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
import soldierSrc from '../characters/soldier.blob?raw';
import { SOLDIER_PROFILE } from '../motion-profile';
import { makeSoldierMind } from './enemy-mind';

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
    const ring = (inside: number, outside: number, r = 0.3) => ({ ...FLAT_GROUND,
      floorAt: (px: number, pz: number) => (Math.hypot(px - x, pz - z) > r ? outside : inside) });
    const flat = actorAt([x, 0, z], ring(0, 0));
    const pit = actorAt([x, 0, z], ring(0, -2));
    // A wall a standing body clears (its disc is 0.34 m), taller than any point plus FALL_DROP_M.
    const wall = actorAt([x, 0, z], ring(0, 3, 0.45));
    const all = [flat, pit, wall];
    for (const a of all) a.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
    for (let f = 0; f < 240; f++) for (const a of all) a.step(1 / 60);
    for (const a of all) expect(a.debug().phase).not.toBe('standing');
    const lo = (a: typeof flat) => Math.min(...a.posed().prims.map(p => Math.min(p.a[1]!, p.b[1]!)));
    expect(lo(pit)).toBeLessThan(lo(flat) - 0.3);
    expect(wall.posed().prims.map(p => [...p.a, ...p.b])).toEqual(flat.posed().prims.map(p => [...p.a, ...p.b]));
  });

  // Review fix 1: the rise is judged per point, not against the root's floor. A corpse settled on a
  // ledge whose root then goes over the lip (a knock) keeps the points lying on the ledge on it.
  it('points lying on a ledge stay on it when the root drops into a pit', () => {
    const [x, , z] = spawnPoints(ROOMS[0]!)[0]!;
    let hole: [number, number] | null = null;
    const ground = { ...FLAT_GROUND, floorAt: (px: number, pz: number) =>
      (hole && Math.hypot(px - hole[0], pz - hole[1]) < 0.2 ? -3 : 0) };
    const a = actorAt([x, 0, z], ground);
    a.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
    for (let f = 0; f < 180; f++) a.step(1 / 60);
    const root = a.pose().pos;
    hole = [root[0], root[2]];
    for (let f = 0; f < 120; f++) a.step(1 / 60);
    const ends = a.posed().prims.flatMap(p => [p.a, p.b])
      .filter(p => Math.hypot(p[0]! - hole![0], p[2]! - hole![1]) > 0.5);
    expect(ends.length).toBeGreaterThan(10);
    for (const p of ends) expect(p[1]).toBeGreaterThan(-0.3);
  });

  // Review fix 2: a soldier's structural fall pose lies every target on the root's plane at rest pull
  // 1; over a pit those targets are released and the corpse falls in, not flat in mid-air.
  it('a downed soldier at a pit lip falls into it', () => {
    const doc = parseBlob(soldierSrc);
    const mk = (pit: number) => createZombieActor({
      id: 1, room: 1, seed: 42, start: [0, 0, 0], bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, furniture: [],
      body: buildBody(compileBlob(doc)), view: stubView() as never, profile: SOLDIER_PROFILE, mind: makeSoldierMind(),
      ground: { ...FLAT_GROUND, floorAt: (px: number, pz: number) => (Math.hypot(px, pz) > 0.3 ? pit : 0) },
    });
    const flat = mk(0), pit = mk(-3);
    for (const a of [flat, pit]) a.blast({ wounds: [], meterCredit: 0, impulse: null, reaction: 'none', forceCollapse: true });
    for (let f = 0; f < 240; f++) for (const a of [flat, pit]) a.step(1 / 60);
    expect(pit.motionFrame()!.collapsed).toBe(true);
    expect(pit.motionFrame()!.restRelease?.length).toBeGreaterThan(0);
    expect(flat.motionFrame()!.restRelease).toBeUndefined();
    const lo = (a: typeof flat) => Math.min(...a.posed().prims.map(p => Math.min(p.a[1]!, p.b[1]!)));
    const hi = (a: typeof flat) => Math.max(...a.posed().prims.map(p => Math.max(p.a[1]!, p.b[1]!)));
    expect(lo(flat)).toBeGreaterThan(-0.2);
    expect(lo(pit)).toBeLessThan(-1.5);
    expect(hi(pit)).toBeLessThan(0.6);
  });

  // Review fix 4: motion reads the disc floor (floorUnder, navigation's rule) when the ground has
  // one, and a rise over SECTOR_STEP_M is a wall: the body keeps its floor.
  it('stands on floorUnder (the disc floor) and never eases up a wall', () => {
    const [x, , z] = spawnPoints(ROOMS[0]!)[0]!;
    const disc = actorAt([x, 0, z], { ...FLAT_GROUND, floorAt: () => -3, floorUnder: () => 0 });
    const wall = actorAt([x, 0, z], { ...FLAT_GROUND, floorAt: () => 2 });
    const step = actorAt([x, 0, z], { ...FLAT_GROUND, floorAt: () => 0.5 });
    for (let f = 0; f < 120; f++) for (const a of [disc, wall, step]) a.step(1 / 60);
    expect(disc.pose().pos[1]).toBe(0);
    expect(wall.pose().pos[1]).toBe(0);
    expect(step.pose().pos[1]).toBe(0.5);
  });
});
