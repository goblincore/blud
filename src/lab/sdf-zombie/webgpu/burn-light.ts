// src/lab/sdf-zombie/webgpu/burn-light.ts
//
// The per-body fire light, as pure numbers. The flicker is the room practicals'
// two-rate wobble (game-main.ts:1703) because one sine reads as a pulse, two
// read as fire. Char dims the light: a body that is mostly black is mostly out.
import type { Vec3 } from '../types';

/** Multiplier around 1. `depth` is the peak deviation, so 0.4 is +-0.4. */
export function burnLightFlicker(t: number, depth: number, phase: number): number {
  const w = Math.sin(t * 7.3 + phase) * 0.5 + Math.sin(t * 17.1 + phase * 2.3) * 0.25;
  return 1 + w * depth;
}

export function burnLightIntensity(
  burn: number, char: number, peak: number, depth: number, flicker: number,
): number {
  const b = Math.min(1, Math.max(0, burn));
  if (b <= 0) return 0;
  const dim = 1 - 0.55 * Math.min(1, Math.max(0, char));
  return peak * b * dim * (1 + (flicker - 1) * depth);
}

/** Chest height, so the light sits inside the flames rather than at the feet. */
export function burnLightAnchor(pos: Vec3): Vec3 {
  return [pos[0], pos[1] + 1, pos[2]];
}
