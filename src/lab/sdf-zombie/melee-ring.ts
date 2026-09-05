// src/lab/sdf-zombie/melee-ring.ts
//
// Who may swing at the player this frame, and which way the ones who may not
// should shuffle. Crowd-level and stateless: the whole claimant set goes in,
// a verdict comes out, and the per-body state machine (brain.ts) consumes it.
//
// WHY THIS EXISTS. Separation (crowd.ts) treats a body as a 0.35 m circle, so
// two engaged zombies settle 0.70 m apart and separation reports itself
// satisfied — but an arm reaches ~0.6 m, so at 0.70 m two facing bodies have
// half a metre of mutual arm overlap. The circles never touch; the arms
// always do (owner's screenshot, 2026-09-04). Widening the circle would fix
// it and destroy the crowding that makes the encounter work. Not everyone
// attacks at once, and the ones who do are angularly spaced.
//
// ANGLES ARE BEARINGS, NOT SLOTS. The obvious design — fixed slots at 0/90
// degrees around the player — rotates the whole ring when the player turns,
// so bodies would orbit as he looks around. Here a claimant's angle is simply
// its CURRENT bearing from him: nobody walks to a slot, they attack from
// where they already are, and this module only decides who may.
//
// Pure: no RNG, no clock, no THREE. Ties break on ascending id, so the same
// input always yields the same verdict.
import { wrapPi } from './wander';

export interface RingPoint { x: number; z: number }

export interface RingClaimant {
  id: number;
  x: number;
  z: number;
  /** Mid-swing: the ring may NOT revoke this body's token. */
  committed: boolean;
  /** Held a token on the previous frame. */
  incumbent: boolean;
}

export interface RingVerdict {
  /** Bodies granted a token this frame. */
  holders: Set<number>;
  /** Tangential shuffle direction per body: -1, 0 or +1. Holders get 0. */
  drift: Map<number, -1 | 0 | 1>;
}

export const RING_TUNING = {
  /** How many bodies may be swinging at once. Owner's call: with no player
   *  health yet, more attackers add noise, not danger. */
  tokens: 2,
  /** Minimum angular separation between two token holders (rad). At 90 deg
   *  and a 1.0 m melee radius two holders are 1.41 m apart — clear of two
   *  0.6 m arm reaches with 0.2 m of margin. 75 deg gives 1.22 m, which
   *  clears by 2 cm, which is not clearing. */
  minSlotAngle: Math.PI / 2,
} as const;

export type RingTuning = typeof RING_TUNING;

/** Bearing from `from` to `to`, in the wander heading convention (0 = +z,
 *  positive clockwise seen from above). */
export function bearingTo(from: RingPoint, to: RingPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function arbitrate(
  player: RingPoint,
  claimants: readonly RingClaimant[],
  tuning: RingTuning = RING_TUNING,
): RingVerdict {
  const holders = new Set<number>();
  const drift = new Map<number, -1 | 0 | 1>();
  if (claimants.length === 0) return { holders, drift };

  const rows = claimants.map(c => ({
    c,
    b: bearingTo(player, c),
    d: Math.hypot(c.x - player.x, c.z - player.z),
  }));

  const held: number[] = [];
  const clears = (b: number) =>
    held.every(h => Math.abs(wrapPi(b - h)) >= tuning.minSlotAngle - 1e-9);
  const grant = (row: { c: RingClaimant; b: number }) => {
    holders.add(row.c.id);
    held.push(row.b);
  };
  const nearestFirst = (
    a: { c: RingClaimant; d: number }, z: { c: RingClaimant; d: number },
  ) => a.d - z.d || a.c.id - z.c.id;

  // 1. Committed bodies keep their token unconditionally. This cannot
  //    overflow the cap: they are a subset of last frame's holders, which was
  //    itself at most `tokens`.
  for (const r of rows.filter(r => r.c.committed).sort((a, z) => a.c.id - z.c.id)) {
    grant(r);
  }
  // 2. Then incumbents, nearest first. INCUMBENCY IS LOAD-BEARING:
  //    re-arbitrating from scratch every frame makes tokens flicker between
  //    bodies at nearly equal distance, and that start-stop is far uglier
  //    than the clipping this module exists to fix.
  for (const r of rows.filter(r => !r.c.committed && r.c.incumbent).sort(nearestFirst)) {
    if (holders.size >= tuning.tokens) break;
    if (clears(r.b)) grant(r);
  }
  // 3. Then everyone else, nearest first.
  for (const r of rows.filter(r => !r.c.committed && !r.c.incumbent).sort(nearestFirst)) {
    if (holders.size >= tuning.tokens) break;
    if (clears(r.b)) grant(r);
  }

  // Drift: the tangential direction toward the nearest bearing that clears
  // EVERY holder. Candidates are each holder's bearing +/- minSlotAngle —
  // the boundaries of the forbidden arcs, which is where the nearest legal
  // bearing always lies.
  for (const r of rows) {
    if (holders.has(r.c.id) || clears(r.b)) {
      drift.set(r.c.id, 0);
      continue;
    }
    let best: number | null = null;
    for (const h of held) {
      for (const cand of [h + tuning.minSlotAngle, h - tuning.minSlotAngle]) {
        if (!clears(cand)) continue;
        const delta = wrapPi(cand - r.b);
        if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
      }
    }
    drift.set(r.c.id, best === null ? 1 : best >= 0 ? 1 : -1);
  }

  return { holders, drift };
}
