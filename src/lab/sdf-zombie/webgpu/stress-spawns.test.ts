// src/lab/sdf-zombie/webgpu/stress-spawns.test.ts
import { describe, expect, it } from 'vitest';
import { stressSpawns } from './stress-spawns';

const src = [{ kind: 'zombie', pos: [0, 0, 0] as const }, { kind: 'soldier', pos: [20, 1, 0] as const }];
const flat = (_x: number, _z: number, y: number) => y;

describe('stressSpawns', () => {
  it('adds n extras, kinds round robin, 1.2-4 m from their source, at least 0.9 m apart', () => {
    const out = stressSpawns(src, 10, flat, 7);
    expect(out).toHaveLength(10);
    expect(out.filter(s => s.kind === 'soldier')).toHaveLength(5);
    for (const s of out) {
      const o = src[s.from]!;
      const d = Math.hypot(s.pos[0] - o.pos[0], s.pos[2] - o.pos[2]);
      expect(d).toBeGreaterThanOrEqual(1.2); expect(d).toBeLessThanOrEqual(4.0001);
      expect(s.pos[1]).toBe(o.pos[1]);
    }
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++)
      expect(Math.hypot(out[i]!.pos[0] - out[j]!.pos[0], out[i]!.pos[2] - out[j]!.pos[2])).toBeGreaterThanOrEqual(0.9);
  });
  it('is seeded (same seed, same cast) and respects the floor test', () => {
    expect(stressSpawns(src, 6, flat, 3)).toEqual(stressSpawns(src, 6, flat, 3));
    const onlyEast = stressSpawns(src, 6, (x, _z, y) => (x > 0 && x < 20 ? y : null), 3);
    expect(onlyEast.every(s => s.pos[0] > 0 && s.pos[0] < 20)).toBe(true);
  });
  it('stops when no source has room', () => {
    expect(stressSpawns(src, 5, () => null)).toEqual([]);
  });
});
