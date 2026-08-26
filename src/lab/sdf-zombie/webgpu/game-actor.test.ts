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
import { sdBody } from '../validate';
import { woundWorldPos } from '../damage';
import { mulberry32 } from './game-weapon';
import type { Vec3 } from '../types';

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

describe('pellet hits flow through the existing damage pipeline', () => {
  /** A real translated zombie + actor, exactly like the page spawns it. */
  function makeActor(id: number) {
    const doc = parseBlob(zombieBlobSrc);
    const face = compileFace(doc);
    const room = ROOMS[0]!;
    const start = spawnPoints(room)[0]!;
    const built = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS, {});
    const placed = translateBody(built, start);
    const severs: { limb: string; origin: Vec3; primCount: number }[] = [];
    const actor = createZombieActor({
      id, room: room.id, body: placed, view: stubView() as never,
      start, seed: 1337 + (id + 1) * 101,
      bounds: wanderBounds(room), furniture: [],
      onSever: (piece) => severs.push({
        limb: piece.limb, origin: piece.origin, primCount: piece.prims.length,
      }),
    });
    for (let f = 0; f < 60; f++) actor.step(1 / 60); // settle into a walk
    return { actor, severs };
  }

  /** Raycast the posed field from `origin` along `dir` — lab-main's march. */
  function raycast(actor: ReturnType<typeof makeActor>['actor'], origin: Vec3, dir: Vec3): Vec3 | null {
    let t = 0;
    for (let i = 0; i < 128 && t < 20; i++) {
      const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      if (sdBody(p, actor.posed()) < 0.002) return p;
      t += Math.max(sdBody(p, actor.posed()), 0.002);
    }
    return null;
  }

  it('a wound lands where the pellet hit and rides the posed body', () => {
    const { actor } = makeActor(1);
    const torso = actor.posed().clusters.find(c => c.limb === 'torso')!.center;
    const hit = raycast(actor, [torso[0], torso[1], torso[2] + 4], [0, 0, -1]);
    expect(hit).not.toBeNull();
    const yaw = actor.pose().yaw;
    const before = actor.posed(); // the pose the wound was STAMPED on
    actor.hit(hit!, [0, 0, -1]);
    expect(actor.wounds().length).toBe(1);
    // Exact gate on the STAMP pose: the wound anchors at the impact point.
    // (After the impulse shove the pose moves ~5 cm and the anchor rides it
    // — that is the wound staying ON the flesh, working as designed.)
    const w = actor.wounds()[0]!;
    // Yaw 0 — the actor stamps on posed (world-space) prims; see game-actor's
    // refreshWounds note. Passing the walk yaw here would double-rotate.
    const back = woundWorldPos(before.prims, w, 0);
    expect(Math.hypot(back[0] - hit![0], back[1] - hit![1], back[2] - hit![2]))
      .toBeLessThan(1e-6);
    // And it RIDES the body: after a second of walking, the anchor moves with
    // the flesh rather than staying at the stamp point.
    for (let f = 0; f < 60; f++) actor.step(1 / 60);
    const after = woundWorldPos(actor.posed().prims, w, actor.pose().yaw);
    const torsoNow = actor.posed().clusters.find(c => c.limb === 'torso')!.center;
    expect(Math.hypot(after[0] - torsoNow[0], after[2] - torsoNow[2]))
      .toBeLessThan(0.8); // torso-local offset, not a world-fixed hole
  });

  it('a pellet storm on one shoulder takes the arm off and reports a world-placed piece', () => {
    const { actor, severs } = makeActor(2);
    // Find which side the arm hangs on from the posed clusters, then pour
    // pellets into that shoulder joint region until it goes.
    // Aim at the SHOULDER JOINT — the arm's highest endpoint, where the
    // attachment neck cutLimbs samples actually runs — and scatter the way
    // the spread cone does. Measured on the rest body (scratch probe): a
    // tight ±3 cm cluster never severs (one carve sphere covers one side of
    // the section disc); the CONE'S NATURAL SPREAD is what cuts — ±9 cm
    // severs within 14 pellets.
    const armL = actor.posed().clusters.find(c => c.limb === 'armL')!;
    let shoulder: Vec3 = [0, 0, 0];
    let bestY = -Infinity;
    for (let i = armL.start; i < armL.start + armL.count; i++) {
      const p = actor.posed().prims[i]!;
      if (p.op === 'sub' || p.dead) continue;
      for (const e of [p.a, p.b]) {
        if (e[1] > bestY) { bestY = e[1]; shoulder = [...e] as Vec3; }
      }
    }
    const rng = mulberry32(20260826);
    let fired = 0;
    while (
      actor.posed().clusters.find(c => c.limb === 'armL')!.alive && fired < 40
    ) {
      // Re-aim every shot: the body wanders while we pour.
      const cl = actor.posed().clusters.find(c => c.limb === 'armL')!;
      let top: Vec3 = shoulder;
      let y = -Infinity;
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const p = actor.posed().prims[i]!;
        if (p.op === 'sub' || p.dead) continue;
        for (const e of [p.a, p.b]) if (e[1] > y) { y = e[1]; top = [...e] as Vec3; }
      }
      shoulder = top;
      const j: Vec3 = [
        shoulder[0] + (rng() - 0.5) * 2 * 0.09,
        shoulder[1] + (rng() - 0.5) * 2 * 0.09,
        shoulder[2] + (rng() - 0.5) * 2 * 0.09,
      ];
      actor.hit(j, [0, -0.1, -1]);
      fired++;
    }
    const gone = !actor.posed().clusters.find(c => c.limb === 'armL')!.alive;
    expect(gone, `arm still attached after ${fired} point-blank pellets`).toBe(true);
    expect(severs.some(s => s.limb === 'armL')).toBe(true);
    const piece = severs.find(s => s.limb === 'armL')!;
    // The piece is placed where the RENDERED arm hung — near the body's own
    // extent, not back at the spawn/origin-space rest pose.
    const b = posedBounds(actor.posed().prims);
    expect(piece.origin[0]).toBeGreaterThan(b.lo[0]! - 0.6);
    expect(piece.origin[0]).toBeLessThan(b.hi[0]! + 0.6);
    expect(piece.primCount).toBeGreaterThan(0);
  });
});
