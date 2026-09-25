// src/lab/sdf-zombie/webgpu/sky-color.ts
//
// TypeScript twin of SKY_COLOR (sky.wgsl.ts). The WGSL is what draws; this is what
// tests. Change one, change both — sky.wgsl.test.ts pins the shared literals.

import type { Vec3 } from '../types';
import type { SkyPreset } from './outdoor-presets';

export const SKY_GRADIENT_EXP = 0.45;
export const SKY_BAND_FALLOFF = 8.0;
export const SKY_BAND_GAIN = 0.6;
export const SKY_BELOW_GAIN = 0.5;
export const SKY_HALO_GAIN = 0.35;

const DEG = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Stars and clouds are omitted in the twin (they use float hashes that differ between
 *  f32 and f64); tests run with `stars: 0` and `cloud.cover: 0`. */
export function skyColorAt(s: SkyPreset, dir: Vec3): Vec3 {
  const y = dir[1];
  if (y < 0) return [s.horizon[0] * SKY_BELOW_GAIN, s.horizon[1] * SKY_BELOW_GAIN, s.horizon[2] * SKY_BELOW_GAIN];
  const t = Math.pow(clamp01(y), SKY_GRADIENT_EXP);
  const glow = Math.exp(-y * SKY_BAND_FALLOFF) * SKY_BAND_GAIN;
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) c[i] = s.horizon[i]! + (s.zenith[i]! - s.horizon[i]!) * t + s.band[i]! * glow;
  const m = s.moon.dir;
  const cosA = dir[0] * m[0] + dir[1] * m[1] + dir[2] * m[2];
  const disc = smooth(Math.cos(s.moon.discDeg * DEG), Math.cos(s.moon.discDeg * 0.85 * DEG), cosA);
  const halo = Math.pow(Math.max(cosA, 0), 1 / Math.max(1e-4, 1 - Math.cos(s.moon.haloDeg * DEG))) * SKY_HALO_GAIN;
  for (let i = 0; i < 3; i++) c[i] = c[i]! + s.moon.color[i]! * (disc * s.moon.intensity + halo);
  return c;
}
