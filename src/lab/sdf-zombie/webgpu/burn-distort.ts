// src/lab/sdf-zombie/webgpu/burn-distort.ts
//
// HEAT-HAZE NUMBERS for a burning body, as pure functions — the same
// discipline as blast-refraction.ts: the radius and the strength are computed
// HERE, in TS, and handed to post-aa.ts's blit warp as plain uniform values
// each frame (the warp keeps only the piece that cannot be precomputed, the
// radial waveform for the current pixel). The band RIDES the existing blast
// refraction machinery — the same four vec4 slots, the same projection, the
// same sin^2 ring — with a flag that skips the blast's two behaviours a fire
// must not have: the radius does not expand (the heat band sits on the body,
// it is not a shockwave) and the strength does not decay with age (it comes
// from burn and char, below).
import type { Vec3 } from '../types';

/**
 * Peak UV offset for a body at this burn/char. `0` at burn 0, `peak` at burn
 * 1 with clean skin, scaled down by char exactly the way the fire light is —
 * burn-light.ts's `1 - 0.55 * char` dim; keep them in step (a body that is
 * mostly black is mostly out, and its heat goes with it).
 */
export function burnDistortStrength(burn: number, char: number, peak: number): number {
  const b = Math.min(1, Math.max(0, burn));
  if (b <= 0) return 0;
  const dim = 1 - 0.55 * Math.min(1, Math.max(0, char));
  return peak * b * dim;
}

/**
 * The heat band's WORLD radius for a body of this height: a little over half
 * the height, so the projected ring covers the body and a little of the air
 * above it — where the wall or floor seen THROUGH the rising heat can bend.
 * (The blast's band is born outside its fireball; the heat band's analogue is
 * wrapping the body, not clearing it.)
 */
export function burnDistortRadiusM(bodyHeightM: number): number {
  const h = Number.isFinite(bodyHeightM) ? Math.max(0, bodyHeightM) : 0;
  return h * 0.62;
}

/**
 * A bounded two-rate wobble in [-1, 1], deterministic in `t` and `phase`, so
 * two bodies pushed in the same frame do not shimmer in step. Two rates
 * because one sine reads as a pulse — the room practicals' rule
 * (game-main's flicker, burn-light.ts's burnLightFlicker; keep the shape in
 * the family). The feed multiplies the pushed strength by `1 + k * wobble`,
 * so the haze's amplitude breathes per body — the TS side owns it, exactly
 * as blast-refraction.ts owns the blast's decay, and `post-aa.ts`'s
 * `postAaBlastWarp` mirrors only the ring profile; keep them in step.
 */
export function burnWobble(t: number, phase: number): number {
  const w = Math.sin(t * 5.3 + phase) * 0.6 + Math.sin(t * 13.7 + phase * 2.3) * 0.4;
  return Math.max(-1, Math.min(1, w));
}

/** Re-exported anchor shape: the band rides the fire light's chest-height
 *  anchor (burn-light.ts), so a capture rig reads one position for both. */
export type BurnDistortAnchor = Vec3;
