// src/lab/sdf-zombie/webgpu/actor-lod.ts
//
// ENEMY UPDATE LOD (occlusion pass, 2026-10-28; owner: "not rendering or updating enemies that aren't visible").
// Pure policy, no three: per actor and frame, a tier from plain facts, and the sim time its step() gets.
//
//   full     stepped every frame (with any time it is owed). Anything the player could see or that matters now:
//            in the camera's visual set, standing in a sector the portal flood sees, near the player, in combat
//            or seen by the encounter director, or restless (hit, knocked, dying, burning, tearing, collapsed).
//   quarter  an ALERT body far away and out of sight (pursuing, searching, returning): stepped one frame in
//            `period`, staggered by id, with the frames' time accumulated, so it walks the same route at the
//            same speed (motion.ts planSubSteps splits the catch-up into 1/30 s sub-steps; only the per-step
//            pose, view upload and thinking-on-stale-input are saved).
//   sleep    an IDLE body (the director's 'idle' order holds it still) out of sight and not near: not stepped,
//            its time dropped. It wakes the frame any full-tier fact turns true (heard a shot, seen, near).
//
// Nothing snaps on screen: a body is only below full while it is outside the visual set AND in a sector the
// flood does not see, and the frame it comes back it is stepped with what it is owed before it is drawn.
import type { EncounterOrder } from './encounter-director';

export type LodTier = 'full' | 'quarter' | 'sleep';

export const ACTOR_LOD = {
  /** Closer than this (metres, ground plane) a body is always full. */
  nearM: 8,
  /** An alert body farther than this (and unseen) steps at the quarter rate. */
  farM: 18,
  /** The quarter tier steps one frame in this many. */
  period: 4,
} as const;

export interface LodFacts {
  /** In the render's visual set (padded cone + sight) or this frame's march set. */
  inView: boolean;
  /** Its sector is in the portal flood's visible set. */
  sectorVisible: boolean;
  /** Ground distance to the player (metres). */
  distM: number;
  /** The encounter director's order mode for it, or null when it has none. */
  mode: EncounterOrder['mode'] | null;
  /** The director sees the player from it. */
  orderVisible: boolean;
  /** The mind's own alert flag. */
  alert: boolean;
  /** Something transient is going on (damage, knock, death, burn, tear, collapse). */
  restless: boolean;
}

export function lodTier(f: LodFacts, cfg: { nearM: number; farM: number } = ACTOR_LOD): LodTier {
  if (f.inView || f.sectorVisible || f.restless || f.orderVisible || f.distM < cfg.nearM) return 'full';
  if (f.mode === 'combat' || f.mode === 'yield') return 'full';
  const idle = (f.mode === 'idle' || f.mode === null) && !f.alert;
  if (idle) return 'sleep';
  return f.distM >= cfg.farM ? 'quarter' : 'full';
}

/** Per-actor clock: the sim time a quarter-rate body is owed. */
export interface LodClock { owed: number }

/** The dt to step this actor with this frame (0 = do not step). `frame` is a frame counter; `id` staggers the
 *  quarter-rate bodies across frames. Mutates `clock`. */
export function lodStepDt(tier: LodTier, clock: LodClock, dt: number, id: number, frame: number,
  period: number = ACTOR_LOD.period): number {
  if (tier === 'sleep') { clock.owed = 0; return 0; }
  clock.owed += dt;
  if (tier === 'quarter' && (((frame + id) % period) + period) % period !== 0) return 0;
  const out = clock.owed;
  clock.owed = 0;
  return out;
}

/** Counts per tier, for the debug seam. */
export function countTiers(tiers: Iterable<LodTier>): Record<LodTier, number> {
  const out: Record<LodTier, number> = { full: 0, quarter: 0, sleep: 0 };
  for (const t of tiers) out[t]++;
  return out;
}
