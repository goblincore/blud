// src/lab/sdf-zombie/pellet-falloff.ts
//
// PELLET DAMAGE FALLOFF (owner 2026-10-27: "add logic where the pellets do less damage after a certain range — damage
// falloff; close range = full damage"). The PLAYER's shotgun pellets only: a slug is the aimed long-range round and
// keeps its full weight at any range, and enemy rounds against the player are not touched.
//
// THE DISTANCE is the straight line from where the volley left the muzzle (ShotProvenance `origin`, stamped by the
// player's fire path) to the impact point. Pellets fly almost flat (80 m/s, -1.5 m/s² drop: ~4 cm of sag over 18 m), so
// the chord is the path to well under 1%, and it is exact whatever the frame step, shotDt or bullet time did: nothing
// is integrated.
//
// THE CURVE: factor 1 up to `fullM`, a smoothstep down to `minFactor` at `farM`, flat after.
//
// WHAT IT SCALES (pelletFalloffWound), on the pellet's wound:
//   meterScale   the collapse-meter gain (collapse.ts stepCollapse multiplies by it, beside the toughness divisor);
//   radius       the visible crater, x lerp(craterMin, 1, factor): a far hit reads lighter, never vanishes;
//   carveDepth   the same scale, so the bowl keeps its shape;
//   severRadius  severing: unchanged at full damage, x factor below it, and 0 (never severs) under `severMin`.
// At factor 1 (every hit inside fullM) the wound is left exactly as it was: close-range numbers do not move.
//
// Pure: the live tuning is a plain object the seam and the URL params write (setPelletFalloff).
import type { Vec3 } from './types';
import type { Wound } from './damage';

export interface PelletFalloffTuning {
  /** false = no falloff at any range (the old rule). */
  on: boolean;
  /** Full damage out to here, m. */
  fullM: number;
  /** The falloff reaches `minFactor` here, m, and stays there. */
  farM: number;
  /** The damage factor past `farM`. */
  minFactor: number;
  /** A far crater's radius scale at factor 0 (lerp(craterMin, 1, factor)). */
  craterMin: number;
  /** Below this factor a pellet never severs. */
  severMin: number;
}

export const PELLET_FALLOFF_DEFAULTS: Readonly<PelletFalloffTuning> = {
  on: true, fullM: 5, farM: 18, minFactor: 0.3, craterMin: 0.7, severMin: 0.6,
};

/** The live tuning (the seam and the URL params write it; the game reads it at each impact). */
export const PELLET_FALLOFF: PelletFalloffTuning = { ...PELLET_FALLOFF_DEFAULTS };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Merge a partial tuning into the live one, keeping it sane (0 <= fullM <= farM, factors in 0..1). Returns a copy. */
export function setPelletFalloff(p: Partial<PelletFalloffTuning> = {}): PelletFalloffTuning {
  const t = PELLET_FALLOFF;
  if (typeof p.on === 'boolean') t.on = p.on;
  if (finite(p.fullM)) t.fullM = Math.max(0, p.fullM);
  if (finite(p.farM)) t.farM = Math.max(0, p.farM);
  if (finite(p.minFactor)) t.minFactor = Math.min(1, Math.max(0, p.minFactor));
  if (finite(p.craterMin)) t.craterMin = Math.min(1, Math.max(0, p.craterMin));
  if (finite(p.severMin)) t.severMin = Math.min(1, Math.max(0, p.severMin));
  if (t.farM < t.fullM) t.farM = t.fullM;
  return { ...t };
}

/** Back to the defaults. */
export function resetPelletFalloff(): PelletFalloffTuning {
  Object.assign(PELLET_FALLOFF, PELLET_FALLOFF_DEFAULTS);
  return { ...PELLET_FALLOFF };
}

/** URL params: `pelletFalloff=0` turns it off; `pelletFull`, `pelletFar` (m), `pelletMin` (factor) tune it. */
export function pelletFalloffFromParams(q: URLSearchParams): Partial<PelletFalloffTuning> {
  const out: Partial<PelletFalloffTuning> = {};
  const num = (k: string): number | undefined => {
    const v = q.get(k);
    if (v === null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  if (q.has('pelletFalloff')) out.on = q.get('pelletFalloff') !== '0';
  const full = num('pelletFull'), far = num('pelletFar'), min = num('pelletMin');
  if (full !== undefined) out.fullM = full;
  if (far !== undefined) out.farM = far;
  if (min !== undefined) out.minFactor = min;
  return out;
}

/** The damage factor for a pellet that travelled `distM`: 1 to fullM, smoothstep to minFactor at farM, flat after. */
export function pelletFalloff(distM: number, t: PelletFalloffTuning = PELLET_FALLOFF): number {
  if (!t.on || !(distM > t.fullM)) return 1;
  if (distM >= t.farM || t.farM <= t.fullM) return t.minFactor;
  const u = (distM - t.fullM) / (t.farM - t.fullM);
  const s = u * u * (3 - 2 * u);
  return 1 + (t.minFactor - 1) * s;
}

/** The factor for a pellet landing at `hit`, from its shot's launch point. No origin (an enemy round, a seam's
 *  hand-made shot, a slug) is full damage. */
export function pelletFalloffAt(origin: Vec3 | undefined, hit: Vec3, t: PelletFalloffTuning = PELLET_FALLOFF): number {
  if (!origin) return 1;
  return pelletFalloff(Math.hypot(hit[0] - origin[0], hit[1] - origin[1], hit[2] - origin[2]), t);
}

/** Apply a factor to a freshly stamped pellet wound, in place (see the header). factor >= 1 leaves it untouched. */
export function pelletFalloffWound(wound: Wound, factor: number, t: PelletFalloffTuning = PELLET_FALLOFF): Wound {
  if (!(factor < 1)) return wound;
  const f = Math.max(0, factor);
  wound.meterScale = f;
  const k = t.craterMin + (1 - t.craterMin) * f;
  wound.radius *= k;
  if (wound.carveDepth !== undefined) wound.carveDepth *= k;
  if (f < t.severMin) wound.severRadius = 0;
  else if (wound.severRadius !== undefined && wound.severRadius > 0) wound.severRadius *= f;
  return wound;
}
