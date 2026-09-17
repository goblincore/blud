import { describe, expect, it } from 'vitest';
import { capsuleBlocks, hitCapsule } from './probe-dynamic';
import { packProbeCapsuleGroups, PROBE_CAPSULE_GROUP_SIZE, probeCapsuleStorageVec4s } from './probe-capsule-groups';
import type { Vec3 } from './ambient';

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
function groupMiss(p: Float32Array, c: number, origin: Vec3, dir: Vec3, dist: number): boolean {
  const i = (p[1]! + Math.floor(c / PROBE_CAPSULE_GROUP_SIZE)) * 4;
  // Mirror the GPU's f32 broad phase, including its intermediate rounding.
  const f = Math.fround;
  const oc: Vec3 = [f(origin[0] - p[i]!), f(origin[1] - p[i + 1]!), f(origin[2] - p[i + 2]!)];
  const dp = (a: Vec3, b: Vec3) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
  const bq = dp(oc, dir), r = p[i + 3]!;
  const disc = f(f(bq * bq) - f(dp(oc, oc) - f(r * r)));
  if (disc < 0) return true;
  const sq = f(Math.sqrt(disc));
  return f(sq - bq) < 0 || f(-bq - sq) > dist;
}
function capsule(p: Float32Array, c: number): [Vec3, Vec3, number] {
  const i = 4 + c * 8;
  return [[p[i]!, p[i + 1]!, p[i + 2]!], [p[i + 4]!, p[i + 5]!, p[i + 6]!], p[i + 3]!];
}

describe('probe capsule group broad phase', () => {
  it('preserves records, contains complete capsules, and handles partial groups and capacity reuse', () => {
    const max = 2048, p = new Float32Array(probeCapsuleStorageVec4s(max) * 4);
    for (const n of [0, 1, 15, 16, 17, 2047, 2048, 3]) {
      p[0] = n;
      for (let c = 0; c < n; c++) {
        p.set([c * 0.2, c % 5, -c * 0.1, 0.08, c * 0.2 + 0.5, c % 5 + 0.8, -c * 0.1, 0], 4 + c * 8);
      }
      const before = p.slice(4, 4 + n * 8);
      packProbeCapsuleGroups(p, max);
      expect(p.slice(4, 4 + n * 8)).toEqual(before);
      for (let c = 0; c < n; c++) {
        const i = (p[1]! + Math.floor(c / PROBE_CAPSULE_GROUP_SIZE)) * 4;
        const [a, b, r] = capsule(p, c);
        for (const v of [a, b]) {
          expect(Math.hypot(...v.map((x, k) => x - p[i + k]!)) + r).toBeLessThan(p[i + 3]!);
        }
      }
    }
    expect(() => packProbeCapsuleGroups(new Float32Array(4), max)).toThrow(/capacity/);
  });

  it('agrees with an exhaustive nearest-hit scan for randomized bounded rays, including inside/parallel rays', () => {
    let seed = 7721;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    let hits = 0, skipped = 0;
    for (let scene = 0; scene < 24; scene++) {
      const n = 1 + Math.floor(rand() * 170);
      const p = new Float32Array(probeCapsuleStorageVec4s(n) * 4); p[0] = n;
      for (let c = 0; c < n; c++) {
        const group = Math.floor(c / PROBE_CAPSULE_GROUP_SIZE);
        const x = group * 2 + rand(), y = rand() * 2, z = rand() * 2;
        p.set([x, y, z, 0.01 + rand() * 0.2, x + rand() * 0.6, y + rand() * 0.6, z, 0], 4 + c * 8);
      }
      packProbeCapsuleGroups(p, n);
      for (let ray = 0; ray < 240; ray++) {
        const target = capsule(p, Math.floor(rand() * n))[0];
        const origin: Vec3 = ray % 4 === 0 ? target : [rand() * 24 - 3, rand() * 5 - 1, rand() * 8 - 3];
        const dir: Vec3 = ray % 7 === 0 ? [0, 0, 1] : norm([target[0] - origin[0] + 0.1, target[1] - origin[1] + 0.1, target[2] - origin[2] + 0.1]);
        const dist = ray % 3 === 0 ? 1e30 : rand() * 12;
        const expected = Array.from({ length: n }, (_, c) => hitCapsule(origin, dir, ...capsule(p, c), dist)).some(Boolean);
        let actual = false;
        for (let c = 0; c < n; c++) {
          if (c % PROBE_CAPSULE_GROUP_SIZE === 0 && groupMiss(p, c, origin, dir, dist)) {
            skipped++; c += PROBE_CAPSULE_GROUP_SIZE - 1; continue;
          }
          if (capsuleBlocks(origin, dir, ...capsule(p, c), dist)) { actual = true; break; }
        }
        expect(actual, `scene=${scene}, ray=${ray}`).toBe(expected);
        if (expected) hits++;
      }
    }
    expect(hits).toBeGreaterThan(500);
    expect(skipped).toBeGreaterThan(1000);
  });
});
