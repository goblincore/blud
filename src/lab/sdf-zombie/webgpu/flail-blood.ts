// src/lab/sdf-zombie/webgpu/flail-blood.ts
//
// BLOOD ON THE FLAIL (spec §14.1 item 7, v1.5a Task 29): each hit adds blood to the ball, chain and
// haft; it dries slowly (a 120 s time constant) and persists between swings. Pure: a single level
// 0..1. The look (a wet dark red, glossy, pooled on the spikes and streaked down the haft) is
// game-flail.ts's, driven by this level through one uniform.

export type BloodSide = 'R' | 'L' | 'H';

export const FLAIL_BLOOD = {
  /** Level added per contact (a strike that hit something), before the multipliers. */
  perHit: 0.12,
  /** An H swing is the big one. */
  sideMul: { R: 1, L: 1, H: 1.5 } as Record<BloodSide, number>,
  /** A head-region contact. */
  headMul: 1.3,
  /** The drying time constant, seconds of simulated time (unscaled by the hit-stop and slow tail). */
  tauSec: 120,
} as const;

export interface FlailBlood { level: number }

export function makeFlailBlood(): FlailBlood { return { level: 0 }; }

/** The level one contact adds. */
export function bloodPerHit(side: BloodSide, head: boolean): number {
  return FLAIL_BLOOD.perHit * FLAIL_BLOOD.sideMul[side] * (head ? FLAIL_BLOOD.headMul : 1);
}

/** A contact: add blood, clamped at 1. */
export function bloodHit(b: FlailBlood, side: BloodSide, head: boolean): void {
  b.level = Math.min(1, b.level + bloodPerHit(side, head));
}

/** Dry over `dt` seconds (exact exponential: frame-rate independent). Non-positive or non-finite dt is a no-op. */
export function stepBlood(b: FlailBlood, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  b.level *= Math.exp(-dt / FLAIL_BLOOD.tauSec);
}

/** The seam: set the level directly, clamped to 0..1 (NaN → 0). */
export function setBloodLevel(b: FlailBlood, level: number): void {
  b.level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}
