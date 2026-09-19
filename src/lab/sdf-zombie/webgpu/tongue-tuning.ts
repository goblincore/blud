// src/lab/sdf-zombie/webgpu/tongue-tuning.ts
//
// THE TONGUE TUNING RECORD for the flame tongues, the exact mirror of
// burn-profiles.ts's role for the surface burn: one frozen default record, one
// bounds record the panel's sliders read their ranges from (so the two cannot
// drift), and one resolve that non-finite input cannot get through. All three
// tongue techniques (screen-space, cards, volumetric) consume the same record,
// so a look tuned on one technique is the same ask on another.

export const TONGUE_TECHNIQUES = ['none', 'screen', 'cards', 'volume'] as const;
export type TongueTechnique = (typeof TONGUE_TECHNIQUES)[number];

export function isTongueTechnique(v: string): v is TongueTechnique {
  return (TONGUE_TECHNIQUES as readonly string[]).includes(v);
}

export interface TongueTuning {
  /** Flame height off the silhouette, in metres at the body. */
  length: number;
  /** How ragged the tongue edge is, 0 smooth .. 1 torn. */
  ragged: number;
  /** Metres per second the flame shape climbs. */
  rise: number;
  /** Emissive gain on the tongues themselves. */
  gain: number;
  /** How much the tongues lean with body motion, 0..1. */
  lean: number;
}

export const TONGUE_TUNING: TongueTuning = Object.freeze({
  // Owner tuning 2026-09-19 (the cards are now accents over the volume).
  length: 0.08, ragged: 0.58, rise: 1.2, gain: 1.75, lean: 0.38,
});

/** The clamp range for every field, as data — the panel reads its slider
 *  ranges from here, exactly as BURN_BOUNDS does for the burn record. */
export const TONGUE_BOUNDS: Readonly<Record<keyof TongueTuning, readonly [number, number]>> = Object.freeze({
  length: [0, 1.5], ragged: [0, 1], rise: [0, 8], gain: [0, 4], lean: [0, 1],
});

const TONGUE_FIELDS = Object.keys(TONGUE_TUNING) as (keyof TongueTuning)[];

export function resolveTongueTuning(p: Partial<TongueTuning> = {}): TongueTuning {
  const out = {} as TongueTuning;
  for (const key of TONGUE_FIELDS) {
    const [min, max] = TONGUE_BOUNDS[key];
    const v = p[key];
    out[key] = v !== undefined && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : TONGUE_TUNING[key];
  }
  return out;
}
