// src/lab/sdf-zombie/gore-tuning.ts
//
// PER-CHARACTER GORE (owner, 2026-10-24, on the teratoma: "when I shoot him it isn't as satisfying as I would have
// thought since he is a giant meatball ... the wounds should feel more visceral ... the blood spray, and chunks coming
// off it"). The shared gun wounds are sized for a man: a pellet bites 5.5 cm, a slug 16 cm (game-weapon.ts), which
// on a ball 1.2 m across is a pock mark inside the outline. A character opts in with MotionProfile.gore:
//
//   craterScale  multiplies a gun crater's radius (pellet and slug), so the bite is big enough to notch the
//                silhouette. The carve is a sphere centred on the hit (wounds.wgsl.ts), so its depth grows with it.
//   blood        a DensityPack per hit kind for the impact gout (blood-sim.ts spawnImpactGout): more, bigger, wider
//                and faster droplets.
//   chunks       FLESH BITS (flesh-bits.ts) thrown off a gun crater, through the flail's chunk path
//                (onGoreDispatch -> spawnChunkPiece, tag 'flesh'): a pellet throws [lo, hi] bits, a slug more and
//                bigger ones. Fractional `lo` is a chance (a shotgun shot is a volley of pellets).
//
// Absent = the shared look exactly: every number below multiplies or adds nothing for a profile without `gore`.
// Pure: no THREE, no game state; randomness comes in as a function.
import type { DensityPack } from './blood-sim';
import type { Wound } from './damage';

export type GunHitKind = 'pellet' | 'slug';

export interface GoreTuning {
  /** Gun crater radius multiplier (pellet and slug). */
  craterScale: number;
  /** Impact gout density per hit kind. */
  blood?: Partial<Record<GunHitKind, DensityPack>>;
  /** Flesh bits thrown per hit: a [lo, hi] count range (lo < 1: a chance of `hi` bits, see chunkCount) and a size scale. */
  chunks?: Partial<Record<GunHitKind, { count: readonly [number, number]; scale: number }>>;
}

/** Scales a freshly stamped gun crater in place (sever radius is the caller's).
 *
 *  THE DEPTH CAP. damage.ts stamps `carveDepth` = 0.45 x the flesh behind the hit, but probes that flesh only out to
 *  radius / 0.45 of the ORIGINAL radius (the point past which the slab cannot bind), so on thick flesh carveDepth comes
 *  back as exactly the original radius: "the probe ran out", not "the flesh ends". Left alone it would hold the
 *  scaled crater to the old depth: wide and shallow. So a cap at (about) the old radius rises with the radius; a
 *  smaller cap is real thin flesh (a grazing hit, an arm) and stays. */
export function scaleGunCrater(wound: Wound, gore: GoreTuning | null | undefined): Wound {
  if (!gore || gore.craterScale === 1) return wound;
  const old = wound.radius;
  wound.radius *= gore.craterScale;
  if (wound.carveDepth !== undefined && wound.carveDepth >= old * 0.98) wound.carveDepth = wound.radius;
  return wound;
}

/** The impact gout's pack for a hit kind, or undefined (the shared gout). */
export function goutPack(gore: GoreTuning | null | undefined, kind: GunHitKind | 'stump'): DensityPack | undefined {
  return kind === 'stump' ? undefined : gore?.blood?.[kind];
}

/** How many flesh bits a hit throws: 0 without chunks. A [lo, hi] range with lo >= 1 is a uniform count; with lo < 1
 *  it is a CHANCE: `hi` bits with probability lo, else none (one pellet of a volley). */
export function chunkCount(gore: GoreTuning | null | undefined, kind: GunHitKind, rand: () => number): number {
  const c = gore?.chunks?.[kind];
  if (!c) return 0;
  const [lo, hi] = c.count;
  if (hi <= 0) return 0;
  if (lo < 1) return rand() < Math.max(0, lo) ? Math.max(1, Math.round(hi)) : 0;
  return lo + Math.min(hi - lo, Math.floor(rand() * (hi - lo + 1)));
}
