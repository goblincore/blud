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
import { makeZombie } from '../body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { translateBody } from '../translate';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import {
  createZombieActor, avoidPoint, firstBlockingBox, pickAvoidSide, pushOutOfFurniture,
  segmentCrossesBox,
} from './game-actor';
import type { Aabb } from './game-level';
import { ROOMS, FURNITURE, wanderBounds, spawnPoints } from './game-level';
import { sdBody } from '../validate';
import { woundWorldPos } from '../damage';
import { rotateYaw } from '../gait';
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
    expect(id - 1).toBe(ROOMS.reduce((n,r)=>n+r.zombies,0));
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
    // The STAMP yaw: the actor stamps on posed (world-space) prims with the
    // body's applied yaw — damage.ts only uses it to de-yaw the basis (the
    // frame is still world), so stamp and upload must quote the same yaw.
    const back = woundWorldPos(before.prims, w, yaw);
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

// ---------------------------------------------------------------------------
// Heavy-hit choreography (slug = blast-profile wound). The owner: "we need
// more readable stun and hit states … the zombie is really staggered and hit
// by something of substantial force". A stagger that never interrupts
// locomotion reads weightless, so a blast hit HALTS the walk and knocks the
// ROOT back; pellets keep the lab's flinch-and-keep-walking reference.
// ---------------------------------------------------------------------------
describe('heavy-hit choreography (slug vs pellet)', () => {
  /** A real translated zombie + actor, exactly like the page spawns it
   *  (same recipe as the pellet tests above — seeds differ per id). */
  function makeActor(id: number) {
    const doc = parseBlob(zombieBlobSrc);
    const face = compileFace(doc);
    const room = ROOMS[0]!;
    const start = spawnPoints(room)[0]!;
    const built = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS, {});
    const placed = translateBody(built, start);
    const actor = createZombieActor({
      id, room: room.id, body: placed, view: stubView() as never,
      start, seed: 1337 + (id + 1) * 101,
      bounds: wanderBounds(room), furniture: [],
    });
    for (let f = 0; f < 60; f++) actor.step(1 / 60); // settle into a walk
    return { actor };
  }

  /** Path length of pose() over the next `frames` steps. */
  function travel(actor: ReturnType<typeof makeActor>['actor'], frames: number): number {
    let acc = 0;
    let prev = actor.pose().pos;
    for (let f = 0; f < frames; f++) {
      actor.step(1 / 60);
      const p = actor.pose().pos;
      acc += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
      prev = p;
    }
    return acc;
  }

  /** A CHEST-height surface impact straight in front of the body — a real
   *  impact point the way the page's predictor produces one (never a cluster
   *  centre: that sits INSIDE the field and anchors the crater pathologically
   *  — measured: a slug 'hit' at the torso centre severed BOTH hip necks and
   *  collapsed the body, muddying every choreography signal). */
  function chestHit(actor: ReturnType<typeof makeActor>['actor']): Vec3 {
    const torso = actor.posed().clusters.find(c => c.limb === 'torso')!.center;
    const o: Vec3 = [torso[0], 1.3, torso[2] + 4];
    const d: Vec3 = [0, 0, -1];
    let t = 0;
    for (let i = 0; i < 128 && t < 20; i++) {
      const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const s = sdBody(p, actor.posed());
      if (s < 0.002) return p;
      t += Math.max(s, 0.002);
    }
    throw new Error('chest raycast missed the body');
  }

  it('a slug HALTS the walk (locomotion interrupted) where the control keeps striding', () => {
    // Same seed twice: the only difference is the hit. Over the 0.55 s hold
    // the hit body covers knock (~0.17 m) plus the stride's fade-out, far
    // less than the control's cruise stride over the same window.
    const hitRun = makeActor(3);
    const control = makeActor(3);
    const impact = chestHit(hitRun.actor);
    hitRun.actor.hitSlug(impact, [0, 0, -1]);
    hitRun.actor.step(1 / 60); // debug() reports the LAST step's state
    expect(hitRun.actor.debug().holdSecs, 'the slug engages the walk hold').toBeGreaterThan(0);
    const hitTravel = travel(hitRun.actor, 36); // 0.6 s ≥ the 0.55 s hold
    const controlTravel = travel(control.actor, 36);
    expect(hitTravel, 'slug hit should break stride').toBeLessThan(controlTravel * 0.75);
    // And the ROOT actually went BACKWARD along the shot: net z displacement
    // of the hit run vs its pre-hit impact depth is negative while the
    // control roams freely.
    const endZ = hitRun.actor.pose().pos[2] - impact[2];
    expect(endZ, 'root knocked back along -z').toBeLessThan(-0.05);
  });

  it('the knock is bounded: ≈ v0/k of root travel, then the zombie holds, then resumes', () => {
    const { actor } = makeActor(4);
    const impact = chestHit(actor);
    actor.hitSlug(impact, [0, 0, -1]);
    // Immediate knock window (0.25 s): ∫ v0·e^(−kt) = 1.2·(1−e^−1.75)/7 ≈
    // 0.138 m; the hold gates the walk controller, so this is pure knock.
    let prev = actor.pose().pos;
    let early = 0;
    for (let f = 0; f < 15; f++) {
      actor.step(1 / 60);
      const p = actor.pose().pos;
      early += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
      prev = p;
    }
    expect(early, 'knock travel in the first 0.25 s').toBeGreaterThan(0.06);
    expect(early, 'and bounded well under a metre').toBeLessThan(0.3);
    // Total knock converges: over the NEXT 0.35 s the root barely adds
    // (integral tail ≈ 0.03 m) — the shove stops, it does not glide.
    let late = 0;
    for (let f = 0; f < 21; f++) {
      actor.step(1 / 60);
      const p = actor.pose().pos;
      late += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
      prev = p;
    }
    expect(late).toBeLessThan(early * 0.9);
    // Stronger form of the resume gate: over 2.5 s the zombie MUST have
    // covered real ground again (cruise 1.15 m/s minus ramp/idle slack).
    const resumed = makeActor(4);
    resumed.actor.hitSlug(chestHit(resumed.actor), [0, 0, -1]);
    travel(resumed.actor, 33); // burn the hold
    // 5 s: long enough to outlast the wander's own idle pauses (≤ 2.4 s) and
    // show sustained cruising — a staggered-forever zombie covers ~0.
    const after = travel(resumed.actor, 300);
    expect(after, 'zombie resumes wandering after the stagger').toBeGreaterThan(1.0);
  });

  it('a pellet neither halts nor knocks — the shamble continues (lab reference)', () => {
    // pose() is the wander controller; pellet hits touch neither the hold,
    // the knock nor the wander state, so two same-seed runs stay bit-equal.
    const hitRun = makeActor(5);
    const control = makeActor(5);
    hitRun.actor.hit(chestHit(hitRun.actor), [0, 0, -1]);
    for (let f = 0; f < 40; f++) {
      hitRun.actor.step(1 / 60);
      control.actor.step(1 / 60);
      const a = hitRun.actor.pose().pos;
      const b = control.actor.pose().pos;
      expect(a[0]).toBe(b[0]);
      expect(a[2]).toBe(b[2]);
    }
  });
});

// ---------------------------------------------------------------------------
// Wounds ride the body yaw (the billboarding regression, owner 2026-09-02).
// A crater stamped on the zombie's BACK rotated round to the FRONT as the
// zombie turned; head wounds behaved, torso and leg wounds did not. Every
// torso blob is an axis-less SPHERE, so its wound frame is a fixed WORLD basis
// unless the body yaw de-yaws it at stamp and re-yaws it at upload
// (damage.ts frame()). The actor stamped AND uploaded at yaw 0, so the frame
// never turned with the flesh. These gates read what refreshWounds actually
// uploads — the shader's sphere centres — not the actor's intent.
// ---------------------------------------------------------------------------
describe('wounds ride the body yaw (billboarding regression)', () => {
  function makeActor(id: number) {
    const doc = parseBlob(zombieBlobSrc);
    const face = compileFace(doc);
    const room = ROOMS[0]!;
    const start = spawnPoints(room)[0]!;
    const built = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS, {});
    const placed = translateBody(built, start);
    const uploads: Vec3[][] = [];
    const severs: string[] = [];
    const view = {
      ...stubView(),
      setWounds: (worldPositions: Vec3[]) => { uploads.push(worldPositions.map(p => [...p] as Vec3)); },
    };
    const actor = createZombieActor({
      id, room: room.id, body: placed, view: view as never,
      start, seed: 1337 + (id + 1) * 101,
      bounds: wanderBounds(room), furniture: [],
      onSever: piece => severs.push(piece.limb),
    });
    for (let f = 0; f < 60; f++) actor.step(1 / 60); // settle into a walk
    return { actor, uploads, severs };
  }

  /** March the posed field from `o` along `d` (lab-main's raycast). */
  function raycast(actor: ReturnType<typeof makeActor>['actor'], o: Vec3, d: Vec3): Vec3 {
    let t = 0;
    for (let i = 0; i < 128 && t < 20; i++) {
      const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const s = sdBody(p, actor.posed());
      if (s < 0.002) return p;
      t += Math.max(s, 0.002);
    }
    throw new Error('raycast missed the body');
  }

  /** The BODY's facing: the zombie is authored facing +z (its face prims sit
   *  at +z) and the motion pipeline turns it by rotateYaw(·, bodyYaw). NOT
   *  the player camera's (sin yaw, -cos yaw) — that convention is mirrored
   *  in x relative to this one. */
  const facing = (yaw: number): Vec3 => rotateYaw([0, 0, 1], yaw);

  /** A hit on a TORSO SPHERE — the prim shape that billboarded. */
  function torsoSphereHit(actor: ReturnType<typeof makeActor>['actor']): Vec3 {
    const torso = actor.posed().clusters.find(c => c.limb === 'torso')!.center;
    // Approach from BEHIND the body so the hit lands on the back, chest
    // height (1.2 m) — a real predictor-style surface hit.
    const fwd = facing(actor.pose().yaw);
    const o: Vec3 = [torso[0] - fwd[0] * 4, 1.2, torso[2] - fwd[2] * 4];
    return raycast(actor, o, fwd);
  }

  it('the uploaded carve centre keeps its BODY-FRAME offset through a turn, and the world offset turns', () => {
    const { actor, uploads } = makeActor(1);
    const hit = torsoSphereHit(actor);
    actor.hit(hit, [0, 0, -1]);
    const w = actor.wounds()[0]!;
    const owner0 = actor.posed().prims[w.primIdx]!;
    expect(owner0.limb, 'fixture: the hit must bind to the torso').toBe('torso');
    expect(owner0.a, 'fixture: the torso prim must be an axis-less sphere').toEqual(owner0.b);
    expect(uploads.length).toBeGreaterThan(0);
    const c0 = uploads[uploads.length - 1]![0]!;
    const yaw0 = actor.pose().yaw;
    // Body-frame offset of the uploaded sphere centre from its owning prim.
    const off0 = rotateYaw([c0[0] - owner0.a[0], c0[1] - owner0.a[1], c0[2] - owner0.a[2]], -yaw0);

    // Walk until the body has turned by more than a radian (up to 40 s).
    let yaw1 = yaw0;
    for (let f = 0; f < 60 * 40; f++) {
      actor.step(1 / 60);
      yaw1 = actor.pose().yaw;
      if (Math.abs(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0))) > 1) break;
    }
    const dYaw = Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0));
    expect(Math.abs(dYaw), 'fixture: the wanderer must actually turn').toBeGreaterThan(1);

    const owner1 = actor.posed().prims[w.primIdx]!;
    const c1 = uploads[uploads.length - 1]![0]!;
    const off1 = rotateYaw([c1[0] - owner1.a[0], c1[1] - owner1.a[1], c1[2] - owner1.a[2]], -yaw1);
    // ON THE FLESH: the body-frame offset is exactly what was stamped.
    expect(Math.hypot(off1[0] - off0[0], off1[1] - off0[1], off1[2] - off0[2])).toBeLessThan(1e-6);
    // NOT BILLBOARDED: the world offset rotated with the body (a viewer-fixed
    // crater would keep the same world offset from its sphere centre).
    const wd0: Vec3 = [c0[0] - owner0.a[0], c0[2] - owner0.a[2], 0];
    const wd1: Vec3 = [c1[0] - owner1.a[0], c1[2] - owner1.a[2], 0];
    expect(Math.hypot(wd1[0] - wd0[0], wd1[1] - wd0[1])).toBeGreaterThan(0.05);
  });

  it('a wound stamped on the back stays on the back: the upload sits behind the torso, never in front', () => {
    const { actor, uploads } = makeActor(2);
    const hit = torsoSphereHit(actor);
    actor.hit(hit, [0, 0, -1]);
    const w = actor.wounds()[0]!;
    for (let f = 0; f < 60 * 40; f++) {
      actor.step(1 / 60);
      const fwd = facing(actor.pose().yaw);
      const owner = actor.posed().prims[w.primIdx]!;
      const c = uploads[uploads.length - 1]![0]!;
      // Behind = against the facing direction. The stamp was a back hit.
      const along = (c[0] - owner.a[0]) * fwd[0] + (c[2] - owner.a[2]) * fwd[2];
      expect(along, `frame ${f}: the back crater surfaced in front`).toBeLessThan(0);
    }
  });

  it('a pellet storm still takes the arm off while the body is turned (yaw != 0)', () => {
    // The old yaw-0 contract was defended by a measured failure ("worst
    // neck-section sample stuck at 0.084 m > 0.055 m sphere radius") — a
    // wound stamped at the walk yaw but resolved against the REST body with
    // that same yaw. Stamp at the live yaw, resolve rest at yaw 0: severs.
    const { actor, severs } = makeActor(1);
    expect(Math.abs(actor.pose().yaw), 'fixture: the body must be turned').toBeGreaterThan(0.5);
    const rng = mulberry32(20260902);
    let fired = 0;
    while (actor.posed().clusters.find(c => c.limb === 'armL')!.alive && fired < 40) {
      const cl = actor.posed().clusters.find(c => c.limb === 'armL')!;
      let top: Vec3 = [0, -Infinity, 0];
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const p = actor.posed().prims[i]!;
        if (p.op === 'sub' || p.dead) continue;
        for (const e of [p.a, p.b]) if (e[1] > top[1]) top = [...e] as Vec3;
      }
      actor.hit([
        top[0] + (rng() - 0.5) * 2 * 0.09,
        top[1] + (rng() - 0.5) * 2 * 0.09,
        top[2] + (rng() - 0.5) * 2 * 0.09,
      ], [0, -0.1, -1]);
      fired++;
    }
    expect(severs, `arm still attached after ${fired} pellets at yaw ${actor.pose().yaw.toFixed(2)}`).toContain('armL');
  });
});

describe('hit batching (beginHits/endHits)', () => {
  function makeCounted(id: number) {
    const doc = parseBlob(zombieBlobSrc);
    const face = compileFace(doc);
    const room = ROOMS[0]!;
    const start = spawnPoints(room)[0]!;
    const built = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS, {});
    const placed = translateBody(built, start);
    const view = stubView() as unknown as { update?: (...a: unknown[]) => void; setWounds?: (...a: unknown[]) => void };
    const counts = { update: 0, setWounds: 0 };
    // The stub has no setWounds (refreshWounds no-ops without one); count
    // both the repack (update) and the wound-row rewrite (setWounds).
    const baseUpdate = view.update?.bind(view);
    view.update = (...a) => { counts.update++; baseUpdate?.(...a); };
    view.setWounds = () => { counts.setWounds++; };
    const actor = createZombieActor({
      id, room: room.id, body: placed, view: view as never,
      start, seed: 1337 + (id + 1) * 101,
      bounds: wanderBounds(room), furniture: [], onSever: () => {},
    });
    for (let f = 0; f < 60; f++) actor.step(1 / 60);
    return { actor, counts };
  }
  function torsoHits(actor: ReturnType<typeof makeCounted>['actor'], n: number): Vec3[] {
    const torso = actor.posed().clusters.find(c => c.limb === 'torso')!.center;
    const out: Vec3[] = [];
    for (let k = 0; k < n; k++) {
      const dx = (k % 4 - 1.5) * 0.03, dy = (Math.floor(k / 4) - 1.5) * 0.03;
      let t = 0; let hit: Vec3 | null = null;
      for (let i = 0; i < 128 && t < 20; i++) {
        const p: Vec3 = [torso[0] + dx, torso[1] + dy, torso[2] + 4 - t];
        const d = sdBody(p, actor.posed());
        if (d < 0.002) { hit = p; break; }
        t += Math.max(d, 0.002);
      }
      if (hit) out.push(hit);
    }
    return out;
  }
  it('16 pellets in one batch = ONE repack/upload and ONE wound-row rewrite; unbatched = one per pellet', () => {
    const a = makeCounted(1);
    const hits = torsoHits(a.actor, 16);
    expect(hits.length).toBeGreaterThanOrEqual(8);
    const u0 = a.counts.update, w0 = a.counts.setWounds;
    a.actor.beginHits();
    for (const h of hits) a.actor.hit(h, [0, 0, -1]);
    expect(a.counts.update - u0).toBe(0);
    expect(a.counts.setWounds - w0).toBe(0);
    a.actor.endHits();
    expect(a.counts.update - u0).toBe(1);
    expect(a.counts.setWounds - w0).toBe(1);
    expect(a.actor.wounds().length).toBe(hits.length);
    const b = makeCounted(2);
    const hb = torsoHits(b.actor, 4);
    const u1 = b.counts.update;
    for (const h of hb) b.actor.hit(h, [0, 0, -1]);
    expect(b.counts.update - u1).toBe(hb.length);
  });
});

/** A real zombie + actor at `start` (default the origin), following the
 *  file's build recipe: makeZombie -> buildBody -> translateBody to the
 *  spawn, so the flesh sits where motion's wander.pos says it is. Shared by
 *  the two wiring describes below. */
function makeTestActor(over: Partial<Parameters<typeof createZombieActor>[0]> = {}) {
  const start = over.start ?? [0, 0, 0];
  const placed = translateBody(buildBody(makeZombie()), start);
  return createZombieActor({
    id: 1, room: 1, body: placed, view: stubView() as never,
    start, seed: 7,
    bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, furniture: [],
    ...over,
  });
}

// ---------------------------------------------------------------------------
// Burning panic (Task 2): the actor applies the pure burn-behaviour step as an
// override of its mind, so a burning zombie keeps closing on the player.
// ---------------------------------------------------------------------------
describe('createZombieActor — burning panic override', () => {
  it('a burning zombie closes on the player', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.setBrainInput({ x: 8, z: 0, room: 1 }, true);
    for (let i = 0; i < 60; i++) a.step(1 / 60);
    const p0 = a.pose().pos;
    const d0 = Math.hypot(p0[0] - 8, p0[2]);
    a.setBurning(true);
    for (let i = 0; i < 60; i++) a.step(1 / 60);
    const p1 = a.pose().pos;
    const d1 = Math.hypot(p1[0] - 8, p1[2]);
    expect(d1).toBeLessThan(d0);
  });

  it('setBurning is edge-triggered (repeat calls keep the same panic clock)', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    a.setBrainInput({ x: 8, z: 0, room: 1 }, true);
    a.setBurning(true);
    for (let i = 0; i < 30; i++) a.step(1 / 60);
    const first = a.pose().pos;
    a.setBurning(true);   // no-op: must NOT reseed the panic
    for (let i = 0; i < 30; i++) a.step(1 / 60);
    const second = a.pose().pos;
    // The body kept moving in the same direction across the repeat call.
    expect(Math.hypot(second[0] - first[0], second[2] - first[2])).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// The brain and the crowd (zombie-crowd task 5). The actor is the WIRING for
// brain.ts (notice/chase/attack) and crowd.ts (separation nudges): the brain
// steps inside the sub-step loop and its target overrides the wander's; a
// nudge re-applies the room clamp and the furniture rejection so separation
// can never shove a body into a crate. Same offline recipe as every describe
// above — real motion pipeline, stub view. The brain states themselves are
// gated by the ring-wiring describe at the end of this file; the transitions
// live in brain.test.ts.
// ---------------------------------------------------------------------------
describe('createZombieActor — the brain and the crowd', () => {
  it('nudge moves the body on the ground plane', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    const before = a.pose().pos;
    a.nudge(0.1, -0.2);
    const after = a.pose().pos;
    expect(after[0]).toBeCloseTo(before[0] + 0.1, 9);
    expect(after[2]).toBeCloseTo(before[2] - 0.2, 9);
  });

  it('nudge stays inside the wander bounds', () => {
    const a = makeTestActor({ start: [0, 0, 0], bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } });
    a.nudge(50, 50);
    const p = a.pose().pos;
    expect(p[0]).toBeLessThanOrEqual(1);
    expect(p[2]).toBeLessThanOrEqual(1);
  });

  it('nudge refuses to push the body into furniture', () => {
    const a = makeTestActor({
      start: [0, 0, 0],
      furniture: [{ min: [0.4, 0, -1], max: [2, 2, 1] }],
    });
    const before = a.pose().pos;
    a.nudge(0.5, 0);        // straight into the crate + its margin
    expect(a.pose().pos).toEqual(before);
  });

  // --- chase routing (the room-4 doorway deadlock, 2026-09-04) ------------
  describe('chase routing helpers', () => {
    const crate: Aabb = { min: [-1, 0, 2], max: [1, 0.5, 3] };

    it('segmentCrossesBox sees the straight line through the crate', () => {
      expect(segmentCrossesBox([0, 0, 4], [0, 0, 0], crate)).toBe(true);
    });

    it('a line passing beside the crate is clear', () => {
      expect(segmentCrossesBox([-3, 0, 4], [-3, 0, 0], crate)).toBe(false);
    });

    it('an endpoint inside the fattened box reads as blocked', () => {
      // The player hugging a crate parks any point 1 m north of him inside
      // its margin — the exact geometry the gate's doorway pose produced.
      expect(segmentCrossesBox([0, 0, 4], [0, 0, 2.5], crate)).toBe(true);
    });

    it('avoidPoint pushes the goal to the committed side, perpendicular to the chase', () => {
      // Chasing due north (p at the origin, goal at (0, 4)): side +1 puts the
      // way-point 2.5 m to the +x side, side −1 to the −x side.
      expect(avoidPoint([0, 0, 0], [0, 0, 4], 1)[0]).toBeCloseTo(2.5, 9);
      expect(avoidPoint([0, 0, 0], [0, 0, 4], -1)[0]).toBeCloseTo(-2.5, 9);
      // It rides the goal's z, not the body's — it is a way-point near the
      // goal, not a heading.
      expect(avoidPoint([0, 0, 0], [0, 0, 4], 1)[2]).toBeCloseTo(4, 9);
    });

    it('pickAvoidSide commits to the side with the clear first leg', () => {
      // From due north BOTH side legs would cut the crate's corner (the
      // way-point rides the goal's z), so stand off-axis: from the north-west
      // the west way-point is reachable by a clear line and the east one is
      // not — the pick must be that side.
      const side = pickAvoidSide([-3, 0, 4], [0, 0, 0], [crate]);
      const way = avoidPoint([-3, 0, 4], [0, 0, 0], side);
      expect(firstBlockingBox([-3, 0, 4], way, [crate])).toBeNull();
    });

    it('pushOutOfFurniture keeps the tangential component of a face press', () => {
      // Pressed against the crate's fattened north face, nudged 18 mm west
      // and 4.5 mm into it: the z-penetration is corrected, the westward
      // slide survives. A full restore here is what deadlocked the chaser.
      const out = pushOutOfFurniture([-0.878, 0, 3.5455], [crate]);
      expect(out[0]).toBeCloseTo(-0.878, 9);
      expect(out[2]).toBeCloseTo(3.55, 9);
      // And a body clear of every box is left alone.
      const free = pushOutOfFurniture([-3, 0, 4], [crate]);
      expect(free[0]).toBeCloseTo(-3, 9);
      expect(free[2]).toBeCloseTo(4, 9);
    });

    it('a chaser routes AROUND furniture and swings, instead of deadlocking', () => {
      // Shrunk room-4 doorway: the player at the origin, a crate between him
      // and the spawn at (0, 0, 4). The old wiring re-aimed the standoff point
      // every sub-step, so the body walked into the crate, was rejected,
      // restored and re-aimed — frozen ~2 m short of attackRange forever.
      // 12 s is generous: the arc is ~4 m of shamble at cruise 1.15 m/s.
      const a = makeTestActor({
        start: [0, 0, 4],
        room: 4,
        furniture: [{ min: [-1, 0, 2], max: [1, 0.5, 3] }],
      });
      let sawSwing = false;
      for (let i = 0; i < 60 * 12 && !sawSwing; i++) {
        a.setBrainInput({ x: 0, z: 0, room: 4 }, true);   // alerted: skips the cone
        // The brain cannot swing without a melee token (no token = encircle
        // forever, by design) — so the harness plays the ring's answer the
        // way game-main's arbitration will from task 6 on.
        a.setRingInput(true, 0);
        a.step(1 / 60);
        sawSwing = a.mind().debug().state === 'attack' && a.mind().debug().swingT > 0;
      }
      expect(sawSwing).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// The ring wiring (choreography task 5). The melee ring's verdict (melee-ring
// .ts) and a blast-profile hit now reach the brain as INPUTS — hasToken/drift
// and a one-shot blasted flag — instead of the actor gating locomotion with a
// private timer. Four seams prove the wiring: the brain reports its state
// through brain(), the ring verdict engages or encircles, a slug staggers
// through the brain (not a private hold), and debug() carries what the
// capture driver records.
// ---------------------------------------------------------------------------
describe('createZombieActor — the ring wiring', () => {
  const near = { x: 0, z: 1.5, room: 3 };

  it('reports its brain state and takes a ring verdict', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput(near, false);
    a.setRingInput(true, 0);
    a.step(1 / 60);
    expect(a.mind().debug().alert).toBe(true);
    expect(['engage', 'attack']).toContain(a.mind().debug().state);
    expect(a.engagedForCrowd()).toBe(true);
  });

  it('encircles when the ring gives it no token', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput(near, false);
    a.setRingInput(false, 1);
    a.step(1 / 60);
    expect(a.mind().debug().state).toBe('encircle');
    // A waiter takes the wide separation circle too. Measured 2026-09-05: the
    // pair actually interpenetrating in room 4 was an ATTACKER and a WAITER
    // (-0.051 m), so leaving waiters on the 0.35 m walking circle left the
    // owner's defect in place next to a ring that looked clean.
    expect(a.engagedForCrowd()).toBe(true);
  });

  it('a slug hit staggers it through the brain, not a private timer', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    a.setBrainInput(near, false);
    a.setRingInput(true, 0);
    a.step(1 / 60);
    a.hitSlug([0, 1.1, 0.2], [0, 0, 1]);
    a.setBrainInput(near, false);
    a.setRingInput(true, 0);
    a.step(1 / 60);
    expect(a.mind().debug().state).toBe('stagger');
    expect(a.committed()).toBe(false);
  });

  it('debug() carries the state, token and swing for the capture driver', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    for (let i = 0; i < 8; i++) {
      a.setBrainInput({ x: 0, z: 0.6, room: 3 }, true);
      a.setRingInput(true, 0);
      a.step(1 / 60);
    }
    expect(a.debug().state).toBe('attack');
    expect(a.debug().swingT).toBeGreaterThan(0);
    expect(['L', 'R']).toContain(a.debug().side);
  });

  it('reports the swing variant through debug()', () => {
    const a = makeTestActor({ start: [0, 0, 0], room: 3 });
    for (let i = 0; i < 8; i++) {
      a.setBrainInput({ x: 0, z: 0.6, room: 3 }, true);
      a.setRingInput(true, 0);
      a.step(1 / 60);
    }
    expect(a.debug().state).toBe('attack');
    expect(['hook', 'overhead']).toContain(a.debug().variant);
  });

  it('two actors with different seeds do not throw the same swing forever', () => {
    const variants = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const a = makeTestActor({ start: [0, 0, 0], room: 3, seed });
      for (let i = 0; i < 400; i++) {
        a.setBrainInput({ x: 0, z: 0.6, room: 3 }, true);
        a.setRingInput(true, 0);
        a.step(1 / 60);
        if (a.debug().state === 'attack') variants.add(a.debug().variant);
      }
    }
    // Over eight bodies and several swings each, BOTH must appear. A variant
    // that never fires is a selection bug every unit test above would pass.
    expect([...variants].sort()).toEqual(['hook', 'overhead']);
  });
});

// ---------------------------------------------------------------------------
// THE BLAST'S REACTION MUST NOT TEAR THE BODY. Two owner reports came out of
// this, and they are the same defect seen from both ends: "they are like
// teleported outside the screen then animated backwards", and then, once the
// (smaller) `impulseAt` unit bug was fixed, "the upper torso/arms/head fly off
// leaving just the legs and then they rubberband back to the body".
//
// THE MECHANISM: `stagger.ts` turns the shot signal into a pose reaction by
// scaling its `dir` by METRE amplitudes — `lurchAmp` 0.26, `flinchAmp` 0.085 —
// and writing the result into `rootOffset` plus `offsets.chest` / `offsets.neck`
// / the shoulders. `blast()` was handing it the resolver's concussion VELOCITY
// (up to 25.2) instead of a unit direction, so the lurch became
// 0.26 x 25.2 x 1.3(gain) = 8.5 m of chest-and-neck offset. That is the tear.
// ---------------------------------------------------------------------------
describe('blast reaction — the body must not tear in half', () => {
  /** INTRA-BODY distance (a foot to the chest). A body that is walking,
   *  staggering or being knocked across the room does not change this; a body
   *  being torn apart does. A versus-control POSITION differential cannot tell
   *  those apart — the control walks away and every number grows on its own. */
  const span = (a: ReturnType<typeof makeTestActor>, from: string, to: string): number => {
    const p = a.posed().clusters.find(c => c.limb === from)!.center;
    const q = a.posed().clusters.find(c => c.limb === to)!.center;
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };
  const chestOf = (a: ReturnType<typeof makeTestActor>): Vec3 =>
    [...a.posed().clusters.find(c => c.limb === 'torso')!.center] as Vec3;

  it('keeps the chest-to-foot span intact through a point-blank blast', () => {
    const a = makeTestActor({ start: [0, 0, 0] });
    for (let f = 0; f < 30; f++) a.step(1 / 60);
    const before = span(a, 'torso', 'legL');
    // The worst case the resolver ever sends, aimed at the chest.
    a.blast({ wounds: [], meterCredit: 0, impulse: { at: chestOf(a), vel: [0, 25.2, 0] } });
    let worst = 0, worstAt = 0;
    for (let f = 0; f < 40; f++) {
      a.step(1 / 60);
      const d = Math.abs(span(a, 'torso', 'legL') - before);
      if (d > worst) { worst = d; worstAt = f; }
    }
    // THE BUG measured 8.23 m at frame 5. What is left is the DESIGNED reaction:
    // the tuned lurch is 0.26 m of root offset with an upper-body scale on top,
    // so a hit body leans. An order of magnitude below the tear, and bounded.
    expect(worst).toBeLessThan(0.6);
    expect(worstAt).toBeLessThan(40);
  });

  it('still REACTS — the blast is not a no-op', () => {
    const hit = makeTestActor({ start: [0, 0, 0] });
    const control = makeTestActor({ start: [0, 0, 0] });
    for (let f = 0; f < 30; f++) { hit.step(1 / 60); control.step(1 / 60); }
    hit.blast({ wounds: [], meterCredit: 0, impulse: { at: chestOf(hit), vel: [25.2, 0, 0] } });
    for (let f = 0; f < 30; f++) { hit.step(1 / 60); control.step(1 / 60); }
    const a = hit.pose().pos, b = control.pose().pos;
    const travel = Math.hypot(a[0] - b[0], a[2] - b[2]);
    expect(travel).toBeGreaterThan(0.05);   // it was shoved
    expect(travel).toBeLessThan(2.5);       // ...but not launched across the room
  });

  it('the reaction direction is the blast direction, at ANY velocity magnitude', () => {
    // The defect was purely one of SCALE, so the same direction at a tenth of
    // the speed must produce the same reaction up to the envelope. Measured on
    // the root travel of two otherwise identical bodies.
    const slow = makeTestActor({ start: [0, 0, 0] });
    const fast = makeTestActor({ start: [0, 0, 0] });
    for (let f = 0; f < 30; f++) { slow.step(1 / 60); fast.step(1 / 60); }
    slow.blast({ wounds: [], meterCredit: 0, impulse: { at: chestOf(slow), vel: [2.52, 0, 0] } });
    fast.blast({ wounds: [], meterCredit: 0, impulse: { at: chestOf(fast), vel: [25.2, 0, 0] } });
    let worst = 0;
    for (let f = 0; f < 40; f++) {
      slow.step(1 / 60); fast.step(1 / 60);
      const a = slow.posed().clusters.find(c => c.limb === 'head')!.center;
      const b = fast.posed().clusters.find(c => c.limb === 'head')!.center;
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    expect(worst).toBeLessThan(0.5);
  });
});

describe('blast() reaction option (the censer)', () => {
  const chestOf = (a: ReturnType<typeof makeTestActor>): Vec3 =>
    [...a.posed().clusters.find(c => c.limb === 'torso')!.center] as Vec3;
  const travelAfter = (reaction: 'blast' | 'flinch' | 'none') => {
    const hit = makeTestActor({ start: [0, 0, 0] });
    const control = makeTestActor({ start: [0, 0, 0] });
    for (let f = 0; f < 30; f++) { hit.step(1 / 60); control.step(1 / 60); }
    hit.blast({ wounds: [], meterCredit: 0, impulse: { at: chestOf(hit), vel: [6, 0, 0] }, reaction });
    for (let f = 0; f < 30; f++) { hit.step(1 / 60); control.step(1 / 60); }
    const a = hit.pose().pos, b = control.pose().pos;
    return Math.hypot(a[0] - b[0], a[2] - b[2]);
  };

  it("'blast' still knocks the root (today's behaviour)", () => {
    expect(travelAfter('blast')).toBeGreaterThan(0.05);
  });
  it("'flinch' does not knock the root", () => {
    expect(travelAfter('flinch')).toBeLessThan(0.02);
  });
  it("'none' changes nothing", () => {
    expect(travelAfter('none')).toBeLessThan(1e-6);
  });
});
