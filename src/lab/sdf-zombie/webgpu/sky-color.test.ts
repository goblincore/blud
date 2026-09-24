import { describe, expect, it } from 'vitest';
import { skyColorAt } from './sky-color';
import { SKY_PRESETS } from './outdoor-presets';

const calm = { ...SKY_PRESETS.night, stars: 0, cloud: { ...SKY_PRESETS.night.cloud, cover: 0 } };
const close = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) < eps);
// Straight up still carries a trace of band glow (exp(-8) * 0.6) and moon halo, ~1e-4.

describe('skyColorAt (TS twin of sky.wgsl.ts)', () => {
  it('straight up is the zenith; the horizon is horizon + band glow', () => {
    expect(close(skyColorAt(calm, [0, 1, 0]), calm.zenith, 1e-3)).toBe(true);
    const h = skyColorAt(calm, [1, 0, 0]);
    expect(close(h, [calm.horizon[0] + calm.band[0] * 0.6, calm.horizon[1] + calm.band[1] * 0.6, calm.horizon[2] + calm.band[2] * 0.6])).toBe(true);
  });
  it('the moon disc is brighter than the sky beside it', () => {
    const m = calm.moon.dir;
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const side = [m[0] + 0.3, m[1], m[2] + 0.3];
    const l = Math.hypot(side[0]!, side[1]!, side[2]!);
    expect(lum(skyColorAt(calm, m))).toBeGreaterThan(lum(skyColorAt(calm, [side[0]! / l, side[1]! / l, side[2]! / l])) + 0.3);
  });
  it('below the horizon is a dim haze of the horizon colour', () => {
    expect(close(skyColorAt(calm, [0, -1, 0]), [calm.horizon[0] * 0.5, calm.horizon[1] * 0.5, calm.horizon[2] * 0.5])).toBe(true);
  });
});
