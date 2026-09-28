import { describe, expect, it } from 'vitest';
import { createZombieActor } from './game-actor';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { worldHitToWound, woundWorldPos } from '../damage';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';

/** A fresh actor that has never stepped — the frozen gate/capture case. */
function freshActor() {
  const body = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
  const view = { update() {}, setRootShift() {}, setHeadRotation() {}, setTime() {}, setWounds() {} };
  return createZombieActor({ id: 1, room: 0, body, view: view as never, start: [0, 0, 0], seed: 3,
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, furniture: [] });
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The FIRST wound on an actor that had never stepped read back 2-12 cm off its
// stamp point (flail gate, 2026-09-28): posed() was the rest body, whose
// rigid-head prims have no orient, so the stamp took damage.ts's axis frame;
// the hit's own applyRig then gave those prims orient and the read took the
// orient frame. See game-actor.ts `let posed`.
describe('first wound on a never-stepped actor', () => {
  it('a stamped wound reads back where it was stamped, on every solid prim', () => {
    const n = freshActor().posed().prims.length;
    const off: string[] = [];
    for (let i = 0; i < n; i++) {
      const actor = freshActor();
      const posed = actor.posed();
      const p = posed.prims[i]!;
      if (p.op === 'sub' || p.op === 'groove' || p.dead) continue;
      const hit: Vec3 = [p.a[0], p.a[1], p.a[2] + p.radius * 0.9];
      const yaw = actor.pose().yaw;
      const w = worldHitToWound(posed.prims, hit, 0.04, 'blast', yaw, q => sdBody(q, posed));
      actor.stampBlast([w]);
      const back = woundWorldPos(actor.posed().prims, actor.wounds()[0]!, actor.pose().yaw);
      if (dist(back, hit) > 1e-4) off.push(`prim ${w.primIdx} (${p.limb}) ${(dist(back, hit) * 100).toFixed(2)} cm`);
    }
    expect(off).toEqual([]);
  });

  // hitSlug (woundFromSlug), the shotgun's woundFromPellet and the flail all
  // stamp on posed(): it must already carry the frame state the next applyRig
  // produces. (A live slug can't pin this by read-back: its shove moves the body.)
  it('posed() of a fresh actor already matches the re-pose a hit runs', () => {
    const actor = freshActor();
    const before = actor.posed();
    const t = before.prims.findIndex(p => p.limb === 'torso' && p.op === 'add');
    actor.stampBlast([{ primIdx: t, local: [0.1, 0, 0], radius: 0.04, type: 'blast', ageSec: 0 }]);
    expect(actor.posed().prims.map(p => p.orient ?? null)).toEqual(before.prims.map(p => p.orient ?? null));
  });
});
