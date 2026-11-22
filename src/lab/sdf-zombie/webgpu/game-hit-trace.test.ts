// @vitest-environment happy-dom
// src/lab/sdf-zombie/webgpu/game-hit-trace.test.ts
//
// traceMeleeHitFrom: the straight, reach-capped ray the rod uses (no gravity, no 60 m march), against stub bodies.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs available in vitest
import { readFileSync } from 'node:fs';
import { chunkCollidersAt, clampSpawnInside, seatChunkSpawn, traceMeleeHitFrom } from './game-hit-trace';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { WALL_SKIN_M } from './sector-debris';
import { makeChunk } from '../gib-chunks';
import { prim } from '../head-pop';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';

/** A torso capsule at x, y 1.0..1.5, radius 0.15, with a cluster sphere around it (the broad phase's input). */
function body(id: number, x: number, z = 0): ZombieActor {
  const posed = () => {
    const torso = prim([x, 1.0, z], [x, 1.5, z], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
    return { prims: [torso], clusters: [{ id: 1, limb: 'torso', start: 0, count: 1, center: [x, 1.25, z] as Vec3, radius: 0.45, alive: true }] };
  };
  return { id, posed } as unknown as ZombieActor;
}
const ctxOf = (...actors: ZombieActor[]) => ({ world: { actors } }) as unknown as GameContext;

describe('traceMeleeHitFrom', () => {
  it('is a straight ray: the hit is exactly on the aim line (no ballistic drop)', () => {
    const r = traceMeleeHitFrom(ctxOf(body(7, 0.4)), [0.4, 1.25, 1.0], [0, 0, -1], 2.2);
    expect(r.actorId).toBe(7);
    expect(r.hit![1]).toBeCloseTo(1.25, 6);
    expect(r.hit![0]).toBeCloseTo(0.4, 6);
    expect(r.hit![2]).toBeCloseTo(0.15, 2);
  });

  it('hits beyond the reach are not found (the ray stops at reach)', () => {
    const r = traceMeleeHitFrom(ctxOf(body(7, 0.4)), [0.4, 1.25, 4.0], [0, 0, -1], 2.2);   // skin 3.85 m away
    expect(r).toEqual({ actorId: -1, hit: null });
    const near = traceMeleeHitFrom(ctxOf(body(7, 0.4)), [0.4, 1.25, 2.0], [0, 0, -1], 2.2);   // skin 1.85 m away
    expect(near.actorId).toBe(7);
  });

  it('the nearest body along the ray wins; a body off the ray is ignored', () => {
    const r = traceMeleeHitFrom(ctxOf(body(8, 0.4, -1), body(7, 0.4, 0), body(9, 3, 0)), [0.4, 1.25, 1.0], [0, 0, -1], 2.2);
    expect(r.actorId).toBe(7);
  });
});


describe('debris spawns on sector levels (plan 3b)', () => {
  const map = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8'))).sectors!;
  const sectorCtx = { world: { colliders: [], level: { def: { sectors: map }, ground: buildSectorGround(map), tunnels: [], rooms: [] } } } as unknown as GameContext;
  const roomCtx = { world: { colliders: [], level: { def: {}, ground: { floorAt: () => 0, ceilAt: () => Infinity }, tunnels: [], rooms: [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5, height: 3 }] } } } as unknown as GameContext;

  it('clampSpawnInside pulls a point past a wall back in; a room level returns the point itself', () => {
    const p = clampSpawnInside(sectorCtx, [0, 1, -1], [0, 1, 0.3], 0.1);
    expect(p[2]).toBeCloseTo(-(WALL_SKIN_M + 0.1), 9);
    const to: Vec3 = [0, 1, 0.3];
    expect(clampSpawnInside(roomCtx, [0, 1, -1], to, 0.1)).toBe(to);
  });
  it('seatChunkSpawn clamps the chunk and seeds floorY with the body floor; a room level returns the chunk itself', () => {
    const c = makeChunk('armL', [0, 1, -3.4], [0, 0, 0], 0.1, [0, 1, 0], () => 0.5);   // inside the column
    const s = seatChunkSpawn(sectorCtx, c, [0, 1, -2]);
    expect(s).not.toBe(c);
    expect(c.pos).toEqual([0, 1, -3.4]);                                             // the original is untouched
    expect(s.pos[2]).toBeCloseTo(-3 + WALL_SKIN_M + 0.1, 9);
    expect(s.floorY).toBe(0);
    const noBody = seatChunkSpawn(sectorCtx, makeChunk('armL', [0, 1, -10], [0, 0, 0], 0.1, [0, 1, 0], () => 0.5));
    expect(noBody.floorY).toBe(0.5);                                                 // the floor under the piece
    expect(seatChunkSpawn(roomCtx, c, [0, 1, -2])).toBe(c);
  });
  it('chunkCollidersAt carries the ground on a sector level only', () => {
    expect(chunkCollidersAt(sectorCtx, [0, 1, -2]).ground).toBeDefined();
    expect('ground' in chunkCollidersAt(roomCtx, [0, 1, 0])).toBe(false);
  });
});
