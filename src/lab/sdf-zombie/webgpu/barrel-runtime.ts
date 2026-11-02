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
import { BARREL, barrelSurfacePoint, catchBlast, hitBarrel, makeBarrels, segmentHitsBarrel, stepBarrels, type BarrelHitKind, type BarrelState } from './barrel-state';
import { FLAIL_STRIKE, inStrikeArc } from './flail-strike';

export interface BarrelRuntime {
  states: BarrelState[];
  /** Sim seconds since the level loaded; detonations counted for the chain hash. */
  clock: number;
  blasts: number;
  log: { id: string; t: number; cause: 'hit' | 'chain' }[];
  /** Every detonation in order: the drum and the sim time it went up (log is when it was LIT; the chain's
   *  0.1–0.3 s shows between explosions, plan 3b gate). */
  booms: { id: string; t: number }[];
  /** Every hit that counted (the drum was intact): its kind, sim time and the point on the drum (when the caller
   *  had one). Bounded: each one takes HP off an intact drum. */
  hits: { id: string; kind: BarrelHitKind; t: number; point?: Vec3 }[];
  /** The standing barrels' AABBs (pushed into the level's colliders; removed when one goes). */
  liveBoxes(): Aabb[];
  /** One hit by kind (`point`: where on the drum, for the log). A lit or gone drum ignores it. */
  hit(id: string, kind: BarrelHitKind, point?: Vec3): void;
  /** The nearest standing barrel (intact or lit) the segment meets: its id, t (the segment padded by `pad`, a
   *  projectile's radius) and the contact point ON the drum's own surface; or null. */
  segmentHit(a: Vec3, b: Vec3, pad?: number): BarrelSegmentHit | null;
  /** A blast at `at` (any blast: dynamite, a rocket, another barrel); `inside`: the shield probe's hint
   *  (seatBlastProbe — an open point on the blast's own side). */
  catchBlast(at: Vec3, inside?: Vec3): void;
  step(dt: number): void;
}

export interface BarrelSegmentHit { id: string; t: number; point: Vec3 }

/** THE FLAIL ON BARRELS (plan 3b Task 14): every intact drum whose surface point nearest the eye is within the
 *  strike's reach in 3D (FLAIL_STRIKE.reach — so a player on a ledge cannot flail a drum far below) and in its arc
 *  (flail-strike.ts inStrikeArc on that point: from outside it lies on the eye → centre bearing), and that `blocked`
 *  (a sector wall between the eye and the drum centre) does not hide; each with that point. */
export function barrelsInStrike(states: readonly BarrelState[], eye: Vec3, yaw: number, arcDeg: number,
  blocked?: (from: Vec3, to: Vec3) => boolean): { id: string; point: Vec3 }[] {
  const out: { id: string; point: Vec3 }[] = [];
  for (const b of states) {
    if (b.phase !== 'intact') continue;
    const centre: Vec3 = [b.pos[0], b.pos[1] + BARREL.heightM * 0.5, b.pos[2]];
    const point = barrelSurfacePoint(b, eye);
    if (Math.hypot(point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]) > FLAIL_STRIKE.reach) continue;
    if (!inStrikeArc(eye, yaw, point, arcDeg)) continue;
    if (blocked?.(eye, centre)) continue;
    out.push({ id: b.id, point });
  }
  return out;
}

export interface BarrelCoreIo {
  /** Is `to` behind level geometry from the blast at `from`? Absent: nothing shields. */
  shielded?(from: Vec3, to: Vec3, inside?: Vec3): boolean;
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
    booms: [],
    hits: [],
    liveBoxes: () => [...boxes.values()],
    hit(id, kind, point) {
      const i = rt.states.findIndex(b => b.id === id);
      if (i < 0 || rt.states[i]!.phase !== 'intact') return;
      rt.hits.push(point ? { id, kind, t: rt.clock, point: [point[0], point[1], point[2]] } : { id, kind, t: rt.clock });
      const before = rt.states;
      rt.states = before.map((b, k) => (k === i ? hitBarrel(b, kind) : b));
      newlyLit(before, rt.states, 'hit');
    },
    segmentHit(a, b, pad = 0) {
      let best: { s: BarrelState; t: number } | null = null;
      for (const s of rt.states) {
        if (s.phase === 'gone') continue;
        const t = segmentHitsBarrel(a, b, s, pad);
        if (t !== null && (best === null || t < best.t)) best = { s, t };
      }
      if (!best) return null;
      const t = best.t, at: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      return { id: best.s.id, t, point: barrelSurfacePoint(best.s, at) };
    },
    catchBlast(at, inside) {
      rt.blasts++;
      const before = rt.states;
      const shielded = io.shielded;
      rt.states = catchBlast(before, at, rt.blasts, shielded && ((f: Vec3, t: Vec3) => shielded(f, t, inside)));
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
        rt.booms.push({ id: d.id, t: rt.clock });
        io.explode(d.id, d.at, [b.pos[0], b.pos[1], b.pos[2]]);
      }
    },
  };
  return rt;
}
