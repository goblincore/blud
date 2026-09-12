import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as npy.test.ts).
import { CLASS_SHARES, DISTANCE_M, ORBIT_DEG, SHOWCASE_COUNTS, cameraPose, forwardOf, mulberry32, pickShowcase, planSequence, splitFor } from './upscale-framing.mjs';

const CHARS = ['zombie', 'soldier', 'imp'];
const ROOMS = [1, 2, 3, 4, 5];

describe('upscale framing planner', () => {
  it('planSequence always draws exactly 12 random numbers (so a resume can replay the stream)', () => {
    for (const u of [0.01, 0.5, 0.99]) {
      let n = 0;
      planSequence(() => { n++; return u; }, 0, CHARS, ROOMS);
      expect(n).toBe(12);
    }
  });

  it('class shares, distance, orbit and look-at follow the spec table', () => {
    const rng = mulberry32(1);
    const counts: Record<string, number> = { close: 0, medium: 0, far: 0 };
    for (let i = 0; i < 20000; i++) {
      const p = planSequence(rng, i, CHARS, ROOMS);
      counts[p.class]++;
      const [d0, d1] = DISTANCE_M[p.class];
      expect(p.distance).toBeGreaterThanOrEqual(d0);
      expect(p.distance).toBeLessThanOrEqual(d1);
      expect(Math.abs(p.orbitDeg)).toBeLessThanOrEqual(ORBIT_DEG[p.class]);
      if (p.class === 'far') expect(p.lookAt).not.toBe('wound');
      if (p.class === 'close') { expect(p.eyeHeight).toBeNull(); expect(Math.abs(p.eyeOffset)).toBeLessThanOrEqual(0.2); }
      else { expect(p.eyeOffset).toBeNull(); expect(p.eyeHeight).toBeGreaterThanOrEqual(1.2); expect(p.eyeHeight).toBeLessThanOrEqual(1.8); }
      expect(p.character).toBe(CHARS[i % CHARS.length]);
      expect(ROOMS).toContain(p.room);
    }
    for (const cls of Object.keys(CLASS_SHARES)) expect(Math.abs(counts[cls]! / 20000 - CLASS_SHARES[cls])).toBeLessThan(0.02);
  });

  it('cameraPose stands `distance` out along the orbited facing and looks at the target', () => {
    const target = [1, 1.5, -2];
    for (const [yaw, orbit] of [[0, 0], [0.7, 45], [-2, -120], [3, 180]]) {
      const p = cameraPose(target, yaw, 2.5, orbit, 1.6, 1);
      expect(Math.hypot(p.x - target[0], p.z - target[2])).toBeCloseTo(2.5, 9);
      const f = forwardOf(p.yaw, p.pitch);
      const v = [target[0] - p.x, target[1] - p.eyeY, target[2] - p.z];
      const len = Math.hypot(v[0], v[1], v[2]);
      expect((f[0] * v[0] + f[1] * v[1] + f[2] * v[2]) / len).toBeCloseTo(1, 9);
    }
  });

  it('orbit 0 puts the camera on the facing side; the facing sign flips it', () => {
    const p = cameraPose([0, 1, 0], 0, 2, 0, 1.6, 1);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(-2, 9);
    expect(cameraPose([0, 1, 0], 0, 2, 0, 1.6, -1).z).toBeCloseTo(2, 9);
  });

  it('splitFor holds out about one sequence in ten, deterministically', () => {
    let val = 0;
    for (let i = 0; i < 4000; i++) if (splitFor(1, i) === 'val') val++;
    expect(val / 4000).toBeGreaterThan(0.07);
    expect(val / 4000).toBeLessThan(0.13);
    expect(splitFor(1, 17)).toBe(splitFor(1, 17));
  });

  it('pickShowcase takes 3 close, 5 medium, 4 far validation pairs, preferring heads and wounds', () => {
    const pairs = [];
    for (const cls of ['close', 'medium', 'far']) {
      for (let k = 0; k < 8; k++) {
        pairs.push({ id: `${cls}-${k}`, split: 'val', class: cls, regions: { heads: k % 2 ? [{}] : [], wounds: k % 4 === 1 ? [{}] : [] } });
        pairs.push({ id: `${cls}-t${k}`, split: 'train', class: cls, regions: { heads: [{}], wounds: [{}] } });
      }
    }
    const ids = pickShowcase(pairs);
    expect(ids).toHaveLength(12);
    for (const [cls, n] of Object.entries(SHOWCASE_COUNTS)) expect(ids.filter((id: string) => id.startsWith(cls)).length).toBe(n);
    expect(ids.every((id: string) => !id.includes('-t'))).toBe(true);
    expect(ids).toContain('medium-1');
  });
});
