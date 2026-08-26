// src/lab/sdf-zombie/webgpu/game-actor.test.ts
//
// World-space gates for the game page's actors. The dispatch that built the
// ring ran its wander gate on state.wander.pos — clamped by construction, so
// it CANNOT fail — while the rendered bodies sat metres outside the level.
// Everything here asserts on POSED PRIMS (the field the shader actually
// draws), never on the actor's internal intent.
//
// Runs fully offline: createZombieActor only touches the view through four
// methods, which are stubbed. The motion pipeline (stepMotion -> stepRig ->
// applyRig) is the real one.

import { describe, expect, it } from 'vitest';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { createZombieActor } from './game-actor';
import { ROOMS, FURNITURE, wanderBounds, spawnPoints } from './game-level';

const stubView = () => ({
  setRootShift: () => {},
  update: () => {},
  setHeadRotation: () => {},
  setTime: () => {},
});

interface Bounds { lo: [number, number, number]; hi: [number, number, number] }

/** AABB of every posed prim endpoint — the rendered extent of the body. */
function posedBounds(prims: readonly { a: readonly number[]; b: readonly number[] }[]): Bounds {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, p.a[i]!, p.b[i]!);
      hi[i] = Math.max(hi[i]!, p.a[i]!, p.b[i]!);
    }
  }
  return { lo, hi };
}

describe('translateBody', () => {
  it('shifts bones with the flesh — a translated body rigs in ONE frame', () => {
    // THE DISPLACEMENT ROOT CAUSE. bindRig builds points/constraints/restPose
    // and the per-endpoint offsets from body.bones. translateBody once moved
    // only prims+clusters, so any translated-then-rigged body bound a rig near
    // the ORIGIN to flesh in its room; motion then pulled both toward each
    // other and the posed body landed at roughly twice its spawn, heads
    // (rigid-head path, pivot-relative) elsewhere again.
    const doc = parseBlob(zombieBlobSrc);
    const built = buildBody(compileBlob(doc, compileFace(doc)), DEFAULT_BUILD_OPTS, {});
    const off: [number, number, number] = [4.8, 0, -4.8];
    const placed = translateBody(built, off);
    // Direct check: every bone joint is the original + offset.
    for (const [name, bone] of built.bones) {
      const moved = placed.bones.get(name)!;
      expect(moved.head[0]).toBeCloseTo(bone.head[0] + off[0], 6);
      expect(moved.head[1]).toBeCloseTo(bone.head[1] + off[1], 6);
      expect(moved.head[2]).toBeCloseTo(bone.head[2] + off[2], 6);
      expect(moved.tail[2]).toBeCloseTo(bone.tail[2] + off[2], 6);
    }
    // And the rig bind agrees with the flesh: the pelvis-area rest point sits
    // inside the placed body's bounds (it did not before the fix).
    const bounds = posedBounds(placed.prims);
    for (const [, bone] of placed.bones) {
      for (const j of [bone.head, bone.tail]) {
        expect(j[0]).toBeGreaterThanOrEqual(bounds.lo[0]! - 0.35);
        expect(j[0]).toBeLessThanOrEqual(bounds.hi[0]! + 0.35);
        expect(j[1]).toBeGreaterThanOrEqual(bounds.lo[1]! - 0.05);
        expect(j[1]).toBeLessThanOrEqual(bounds.hi[1]! + 0.35);
        expect(j[2]).toBeGreaterThanOrEqual(bounds.lo[2]! - 0.35);
        expect(j[2]).toBeLessThanOrEqual(bounds.hi[2]! + 0.35);
      }
    }
  });
});

describe('wandering zombies stay where the actor thinks they are', () => {
  // Mirrors game-main's spawn exactly: same blob, same build opts,
  // translateBody to the spawn point, seed pattern, room bounds, furniture.
  it('after 360 frames every POSED body is coherent, in its room, on the floor', () => {
    const doc = parseBlob(zombieBlobSrc);
    const face = compileFace(doc);
    let id = 1;
    for (const room of ROOMS) {
      const furniture = FURNITURE
        .filter(f => f.room === room.id)
        .map(f => ({ min: [f.minX, 0, f.minZ] as [number, number, number], max: [f.maxX, f.height, f.maxZ] as [number, number, number] }));
      for (const start of spawnPoints(room)) {
        const built = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS, {});
        const placed = translateBody(built, start);
        const actor = createZombieActor({
          id, room: room.id, body: placed, view: stubView() as never,
          start, seed: 1337 + (id + 1) * 101,
          bounds: wanderBounds(room), furniture,
        });
        for (let f = 0; f < 360; f++) actor.step(1 / 60);

        const posed = actor.posed();
        const ctx = `zombie ${id} (room ${room.id})`;
        const b = posedBounds(posed.prims);

        // 1. Coherent: a ~1.9 m body must not smear across the level. The
        //    pre-fix explosion spanned up to 14 m per axis.
        for (const a of [0, 1, 2]) {
          expect(b.hi[a]! - b.lo[a]!, `${ctx} smeared on axis ${a}`)
            .toBeLessThan(3.5);
        }

        // 2. In its room: the TORSO CENTRE (what a shot raycasts) inside the
        //    wander bounds — not merely equal to wander.pos.
        const torso = posed.clusters.find(c => c.limb === 'torso')!.center;
        const wb = wanderBounds(room);
        expect(torso[0]!, `${ctx} torso x outside room`).toBeGreaterThan(wb.minX - 0.5);
        expect(torso[0]!, `${ctx} torso x outside room`).toBeLessThan(wb.maxX + 0.5);
        expect(torso[2]!, `${ctx} torso z outside room`).toBeGreaterThan(wb.minZ - 0.5);
        expect(torso[2]!, `${ctx} torso z outside room`).toBeLessThan(wb.maxZ + 0.5);

        // 3. Standing: proxy-centre height in a plausible band around the
        //    authored stance (~1.1 m). The pre-fix bodies ranged -0.6..4.6.
        expect(torso[1]!, `${ctx} torso height`).toBeGreaterThan(0.5);
        expect(torso[1]!, `${ctx} torso height`).toBeLessThan(2.2);

        // 4. Head attached: the HEAD CLUSTER centre lies inside the posed
        //    body's own bounding volume (loose margin for pose sway). The
        //    floating-head bug had heads metres outside it, near the ceiling.
        const head = posed.clusters.find(c => c.limb === 'head')!.center;
        expect(head[0]!, `${ctx} head x off-body`).toBeGreaterThanOrEqual(b.lo[0]! - 0.3);
        expect(head[0]!, `${ctx} head x off-body`).toBeLessThanOrEqual(b.hi[0]! + 0.3);
        expect(head[1]!, `${ctx} head below the body`).toBeGreaterThanOrEqual(b.lo[1]! - 0.1);
        expect(head[1]!, `${ctx} head above the body`).toBeLessThanOrEqual(b.hi[1]! + 0.1);
        expect(head[2]!, `${ctx} head z off-body`).toBeGreaterThanOrEqual(b.lo[2]! - 0.3);
        expect(head[2]!, `${ctx} head z off-body`).toBeLessThanOrEqual(b.hi[2]! + 0.3);
        // And above the torso: attached skulls sit at/above chest height.
        expect(head[1]!, `${ctx} head under the torso`).toBeGreaterThan(torso[1]!);

        id++;
      }
    }
    expect(id - 1).toBe(10);
  });
});
