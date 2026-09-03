// src/lab/sdf-zombie/bleed-registry.ts
//
// The game page's wound-emitter ledger (bleeding-wounds plan task 2). Pure
// bookkeeping: which wounds on which bodies are bleeding, what calibre, and
// since when. The per-frame anchor recompute lives with the callers — this
// module also provides that helper (`woundEmitAnchorAndNormal`) so the
// anchoring contract has exactly one home and the tests can pin it.
//
// REFERENCES, NOT POSITIONS (the spec's anchoring rule). An entry stores the
// Wound object itself, not an index into the actor's wound ring: pushWound
// evicts from the ring's head at MAX_WOUNDS, so an index silently re-aims at
// the wrong wound the moment anything evicts. The Wound is an immutable
// snapshot (primIdx + prim-local offset) that woundWorldPos consumes against
// the CURRENT posed prims every frame — blood rides the walking, staggering,
// collapsing body for free.

import { WOUND_BLEED, type BleedKind } from './blood-sim';
import { woundCarveNormal, woundWorldPos, type Wound } from './damage';
import type { Primitive, Vec3 } from './types';
import { dot, len, scale, sub } from './vec';

/** A body porcupined with pellets COALESCES: at this many live emitters on
 *  one body, the oldest is evicted for each new one (plan: merge or evict
 *  oldest — evict is the honest one, the old wound has been bleeding longest
 *  and its drip is the least noticeable loss). */
export const PER_BODY_EMITTER_CAP = 6;

export interface BleedEntry {
  readonly bodyId: number;
  /** The wound reference — see the header. */
  readonly wound: Wound;
  readonly kind: BleedKind;
  /** Emitter birth in the caller's sim clock (a deterministic accumulator,
   *  NOT wall time — captures step the world by hand). */
  readonly bornAt: number;
  /** Fractional spawn carry between frames (spawnWoundDroplets' accumulator). */
  acc: number;
}

export class BleedRegistry {
  private entries: BleedEntry[] = [];

  /** Oldest-first insertion order — live() returns a copy in this order. */
  register(bodyId: number, wound: Wound, kind: BleedKind, now: number): void {
    const mine = this.entries.filter(e => e.bodyId === bodyId);
    if (mine.length >= PER_BODY_EMITTER_CAP) {
      let oldest = mine[0]!;
      for (const e of mine) if (e.bornAt < oldest.bornAt) oldest = e;
      this.entries.splice(this.entries.indexOf(oldest), 1);
    }
    this.entries.push({ bodyId, wound, kind, bornAt: now, acc: 0 });
  }

  /** Body removed/gibbed entirely: its emitters die with it. */
  evictForBody(bodyId: number): void {
    this.entries = this.entries.filter(e => e.bodyId !== bodyId);
  }

  /** Live (unexpired) entries, oldest first; expired ones are pruned so the
   *  reported count is the truth about what is still bleeding. */
  live(now: number): BleedEntry[] {
    this.entries = this.entries
      .filter(e => now - e.bornAt <= WOUND_BLEED[e.kind].lifetimeSec);
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}

/**
 * Where blood LEAVES a wound this frame: the surface anchor (recomputed from
 * the current posed prims) and the outward spray direction.
 *
 * Direction: the negated carve normal when the wound carries a depth slab
 * (carveN points INWARD, into the flesh — it is the depth-cap's orientation).
 * Stump wounds (sever.ts) carry no slab, so the fallback is surface-outward
 * from the owning prim's axis through the anchor — for a shoulder stump
 * anchored on the torso that reads as the gush blowing away from the body,
 * which is the read that matters; the cone + gravity arc dominate anyway.
 */
export function woundEmitAnchorAndNormal(
  prims: Primitive[], wound: Wound,
  /** The yaw `prims` are posed at — the actor's live pose().yaw. Sphere-bound
   *  wounds (every torso blob) have no axis to carry the turn, so without it
   *  the anchor stays viewer-fixed while the flesh turns (2026-09-02). */
  bodyYaw = 0,
): { anchor: Vec3; normal: Vec3 } {
  const anchor = woundWorldPos(prims, wound, bodyYaw);
  const inward = woundCarveNormal(prims, wound, bodyYaw);
  if (inward) return { anchor, normal: scale(inward, -1) };
  const prim = prims[wound.primIdx]!;
  const axis: Vec3 = sub(prim.b, prim.a);
  const axisLen = len(axis);
  if (axisLen < 1e-9) return { anchor, normal: [0, 1, 0] };
  const rel = sub(anchor, prim.a);
  const t = Math.max(0, Math.min(axisLen, dot(rel, axis) / axisLen));
  const closest: Vec3 = [
    prim.a[0] + axis[0] * t / axisLen,
    prim.a[1] + axis[1] * t / axisLen,
    prim.a[2] + axis[2] * t / axisLen,
  ];
  const out = sub(anchor, closest);
  const outLen = len(out);
  if (outLen < 1e-6) return { anchor, normal: [0, 1, 0] };
  return { anchor, normal: scale(out, 1 / outLen) };
}
