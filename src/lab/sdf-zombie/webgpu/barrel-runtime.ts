// src/lab/sdf-zombie/webgpu/barrel-runtime.ts
//
// BARRELS IN PLAY, THE PURE CORE (plan 2026-10-25-sector-levels-3b Task 13): the level's barrel states over time —
// hits, blast catches, the fuse step, the drums' collider boxes in the level's collider array — and the log the gate
// reads. Everything with a renderer or the game context (the views, the scorch, detonateAt, the player's share,
// telemetry) is the `explode` hook game-barrels.ts passes in; so is the sector-wall shield.
//
// Pure: no three.js, no DOM, no GameContext.
import type { Vec3 } from '../types';
import type { Aabb } from './game-level';
import { BARREL, catchBlast, hitBarrel, makeBarrels, segmentHitsBarrel, stepBarrels, type BarrelHitKind, type BarrelState } from './barrel-state';

export interface BarrelRuntime {
  states: BarrelState[];
  /** Sim seconds since the level loaded; detonations counted for the chain hash. */
  clock: number;
  blasts: number;
  log: { id: string; t: number; cause: 'hit' | 'chain' }[];
  /** The standing barrels' AABBs (pushed into the level's colliders; removed when one goes). */
  liveBoxes(): Aabb[];
  hit(id: string, kind: BarrelHitKind): void;
  /** The nearest standing barrel (intact or lit) the segment meets: its id and t, or null. */
  segmentHit(a: Vec3, b: Vec3, pad?: number): { id: string; t: number } | null;
  /** A blast at `at` (any blast: dynamite, a rocket, another barrel). */
  catchBlast(at: Vec3): void;
  step(dt: number): void;
}

export interface BarrelCoreIo {
  /** Is `to` behind level geometry from the blast at `from`? Absent: nothing shields. */
  shielded?(from: Vec3, to: Vec3): boolean;
  /** A barrel goes up at `at` (its centre; `feet` on its floor). Called from step(), after its box has left the
   *  colliders; a blast it sets off comes back through catchBlast (the chain). */
  explode(id: string, at: Vec3, feet: Vec3): void;
}

/** A barrel's collider: its drum, feet to top. */
export function barrelBox(b: { pos: Vec3 }): Aabb {
  const r = BARREL.radiusM, [x, y, z] = b.pos;
  return { min: [x - r, y, z - r], max: [x + r, y + BARREL.heightM, z + r] };
}

export function createBarrelCore(defs: readonly { id: string; pos: Vec3 }[], colliders: Aabb[], io: BarrelCoreIo): BarrelRuntime {
  const boxes = new Map<string, Aabb>();
  for (const d of defs) {
    const box = barrelBox(d);
    boxes.set(d.id, box);
    colliders.push(box);
  }
  const newlyLit = (before: readonly BarrelState[], after: readonly BarrelState[], cause: 'hit' | 'chain') => {
    for (let i = 0; i < after.length; i++) {
      if (before[i]!.phase !== 'lit' && after[i]!.phase === 'lit') rt.log.push({ id: after[i]!.id, t: rt.clock, cause });
    }
  };
  const rt: BarrelRuntime = {
    states: makeBarrels(defs),
    clock: 0,
    blasts: 0,
    log: [],
    liveBoxes: () => [...boxes.values()],
    hit(id, kind) {
      const i = rt.states.findIndex(b => b.id === id);
      if (i < 0) return;
      const before = rt.states;
      rt.states = before.map((b, k) => (k === i ? hitBarrel(b, kind) : b));
      newlyLit(before, rt.states, 'hit');
    },
    segmentHit(a, b, pad = 0) {
      let best: { id: string; t: number } | null = null;
      for (const s of rt.states) {
        if (s.phase === 'gone') continue;
        const t = segmentHitsBarrel(a, b, s, pad);
        if (t !== null && (best === null || t < best.t)) best = { id: s.id, t };
      }
      return best;
    },
    catchBlast(at) {
      rt.blasts++;
      const before = rt.states;
      rt.states = catchBlast(before, at, rt.blasts, io.shielded);
      newlyLit(before, rt.states, 'chain');
    },
    step(dt) {
      rt.clock += dt;
      const s = stepBarrels(rt.states, dt);
      rt.states = s.barrels;
      for (const d of s.detonations) {
        const box = boxes.get(d.id);
        if (box) {
          boxes.delete(d.id);
          const k = colliders.indexOf(box);
          if (k >= 0) colliders.splice(k, 1);
        }
        const b = rt.states.find(q => q.id === d.id)!;
        io.explode(d.id, d.at, [b.pos[0], b.pos[1], b.pos[2]]);
      }
    },
  };
  return rt;
}
