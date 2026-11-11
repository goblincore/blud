import { describe, expect, it } from 'vitest';
import { smax } from './validate';
import {
  WV_FLOOR, applyVolumeSample, chainByte, chainOf, createPrimVolume, sampleVolume, stampCrater, stampReach,
  type StampCrater,
} from './wound-volume-stamp';
import type { Vec3 } from './types';

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** applyWounds' crater steps (march/fields/wounds.wgsl.ts), round craters, in list order. */
function listField(dIn: number, p: Vec3, craters: StampCrater[]): number {
  let d = dIn;
  for (const c of craters) {
    const r = Math.hypot(p[0] - c.centre[0], p[1] - c.centre[1], p[2] - c.centre[2]);
    let carve = c.depth - r;
    if (c.capN && (c.capDepth ?? 0) > 0) carve = Math.min(carve, c.capDepth! - ((p[0] - c.centre[0]) * c.capN[0] + (p[1] - c.centre[1]) * c.capN[1] + (p[2] - c.centre[2]) * c.capN[2]));
    d = smax(d, carve, c.blendK * Math.min(1, Math.max(0.1, c.radius / 0.05)));
    const x = (r - c.depth * c.rimOffset) / Math.max(c.depth * c.rimWidth, 1e-4);
    d -= Math.exp(-x * x) * c.rimAmp * (1 - smoothstep(-c.rimAmp * 0.3, c.rimAmp * 0.7, dIn));
  }
  return d;
}
const crater = (centre: Vec3, radius: number, extra: Partial<StampCrater> = {}): StampCrater => ({
  centre, radius, depth: radius, blendK: 0.015, rimOffset: 1.0, rimWidth: 0.25, rimAmp: radius * 0.55 * 0.45, ...extra,
});
/** A slab of flesh: the skin is the plane z = 0, flesh below it. */
const skin = (p: Vec3) => p[2];

describe('the baked wound volume (pure)', () => {
  it('encodes the floor as zero and steps by a millimetre', () => {
    expect(chainByte(WV_FLOOR)).toBe(0);
    expect(chainByte(-1)).toBe(0);
    expect(chainOf(chainByte(0.013))).toBeCloseTo(0.013, 6);
  });

  it('leaves an unstamped volume, and the layer round a stamped one, empty', () => {
    const v = createPrimVolume([-0.2, -0.2, -0.2], [0.2, 0.2, 0.2], 0.02);
    expect(sampleVolume(v, [0, 0, 0])).toEqual([WV_FLOOR, 0, 0, WV_FLOOR]);
    expect(applyVolumeSample(-0.03, -0.03, sampleVolume(v, [0, 0, 0])!, 0.015)).toBe(-0.03);
    stampCrater(v, crater([0.19, 0, 0], 0.13));
    const [nx, ny, nz] = v.dims;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (const x of [0, nx - 1]) {
      const o = ((z * ny + y) * nx + x) * 4;
      expect(v.shape[o] | v.shape[o + 1] | v.shape[o + 2] | v.shape[o + 3] | v.colour[o]).toBe(0);
    }
    expect(sampleVolume(v, [1, 0, 0])).toBeNull();
  });

  it('reads one crater back as the list makes it, to a few millimetres', () => {
    for (const voxel of [0.01, 0.02]) {
      const v = createPrimVolume([-0.25, -0.25, -0.25], [0.25, 0.25, 0.25], voxel);
      const c = crater([0.01, -0.02, 0], 0.055, { capN: [0, 0, -1], capDepth: 0.04 });
      expect(stampCrater(v, c)).not.toBeNull();
      let worst = 0, moved = 0;
      for (let i = 0; i < 4000; i++) {
        const p: Vec3 = [Math.sin(i * 1.7) * 0.16, Math.cos(i * 2.3) * 0.16, -0.1 + ((i * 37) % 130) / 1000];
        const dIn = skin(p), want = listField(dIn, p, [c]);
        const got = applyVolumeSample(dIn, dIn, sampleVolume(v, p)!, c.blendK);
        if (Math.abs(want - dIn) > 1e-4) moved++;
        worst = Math.max(worst, Math.abs(got - want));
      }
      expect(moved).toBeGreaterThan(400);
      // The cap's edge (plane meets sphere) is a crease, and a crease is where a voxel grid is worst.
      expect(worst).toBeLessThan(voxel === 0.01 ? 0.006 : 0.012);
    }
  });

  it('keeps the order of two overlapping craters: the later one cuts the earlier rim', () => {
    const v = createPrimVolume([-0.25, -0.25, -0.25], [0.25, 0.25, 0.25], 0.01);
    const a = crater([-0.03, 0, 0], 0.055), b = crater([0.04, 0.01, 0], 0.055);
    stampCrater(v, a);
    stampCrater(v, b);
    let worst = 0, worstSwapped = 0;
    for (let i = 0; i < 4000; i++) {
      const p: Vec3 = [Math.sin(i * 1.7) * 0.14, Math.cos(i * 2.3) * 0.1, -0.08 + ((i * 37) % 100) / 1000];
      const dIn = skin(p), got = applyVolumeSample(dIn, dIn, sampleVolume(v, p)!, 0.015);
      worst = Math.max(worst, Math.abs(got - listField(dIn, p, [a, b])));
      worstSwapped = Math.max(worstSwapped, Math.abs(got - listField(dIn, p, [b, a])));
    }
    expect(worst).toBeLessThan(0.005);
    expect(worstSwapped).toBeGreaterThan(worst * 2);
  });

  it('stamps the colour: full at the centre, gone past 1.6 radii, marks only when flagged', () => {
    const v = createPrimVolume([-0.25, -0.25, -0.25], [0.25, 0.25, 0.25], 0.01);
    stampCrater(v, crater([0, 0, 0], 0.05, { cavity: true }));
    stampCrater(v, crater([0.15, 0, 0], 0.03, { tear: true, wetOnly: true }));
    const at = (p: Vec3) => sampleVolume(v, p, 'colour')!;
    expect(at([0, 0, 0])[0]).toBeGreaterThan(0.9);
    expect(at([0, 0, 0])[1]).toBeGreaterThan(0.9);
    expect(at([0, 0, 0])[2]).toBe(0);
    expect(at([0, 0.09, 0])[0]).toBe(0);
    expect(at([0.15, 0, 0])[2]).toBeGreaterThan(0.8);
    expect(at([0.15, 0, 0])[3]).toBeGreaterThan(0.8);
    expect(at([0.15, 0, 0])[1]).toBe(0);
  });

  it('touches only the box inside its reach, and misses a volume it is far from', () => {
    const v = createPrimVolume([-0.25, -0.25, -0.25], [0.25, 0.25, 0.25], 0.02);
    const c = crater([0, 0, 0], 0.055);
    const box = stampCrater(v, c)!;
    const span = (box.hi[0] - box.lo[0] + 1) * v.voxel;
    expect(span).toBeGreaterThanOrEqual(2 * stampReach(c) - 2 * v.voxel);
    expect(span).toBeLessThanOrEqual(2 * stampReach(c) + 2 * v.voxel);
    expect(stampCrater(v, crater([2, 0, 0], 0.055))).toBeNull();
  });
});
