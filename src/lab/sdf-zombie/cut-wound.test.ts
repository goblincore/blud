// src/lab/sdf-zombie/cut-wound.test.ts
import { describe, expect, it } from 'vitest';
import { CUT, CUT_SHADE, ROD_CALIBRE, cutCarve, cutExposureSpheres, cutsFromSweep, stampCut } from './cut-wound';
import { woundDirToWorld, woundWorldPos } from './damage';
import { prim } from './head-pop';
import { sdBody } from './validate';
import type { Primitive, Vec3 } from './types';

// A torso-like capsule (cluster 1) and an arm (cluster 2), both along +y.
const torso = prim([0, 1.0, 0], [0, 1.5, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 1 });
const arm = prim([0.4, 1.0, 0], [0.4, 1.5, 0], 0.05, [1, 1, 1], { limb: 'armL', cluster: 2 });
const prims: Primitive[] = [torso, arm];
const body = { prims, clusters: [{ start: 0, count: 1, alive: true }, { start: 1, count: 1, alive: true }] } as unknown as Parameters<typeof sdBody>[1];
const field = (p: Vec3) => sdBody(p, body);
const mid: Vec3 = [0, 1.25, 0.15];
const along: Vec3 = [0, 1, 0], inward: Vec3 = [0, 0, -1];

describe('cutCarve (the CPU mirror of the WGSL slot)', () => {
  const at = (a: number, s: number, u: number): Vec3 => [u, mid[1] + a, mid[2] - s];
  it('is inside (positive) along the slot centre down to most of its depth, at the middle', () => {
    expect(cutCarve(at(0, 0.03, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeGreaterThan(0);
  });
  it('is outside past the kerf, past the floor and past the ends', () => {
    expect(cutCarve(at(0, 0.01, 0.02), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
    expect(cutCarve(at(0, 0.07, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
    expect(cutCarve(at(0.11, 0.0, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
  });
  it('is a lens: deepest at the middle, shallow near the ends', () => {
    expect(cutCarve(at(0, 0.05, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeGreaterThan(0);
    expect(cutCarve(at(0.09, 0.05, 0), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
  });
  it('the walls close into a V: wider at the skin than near the floor', () => {
    expect(cutCarve(at(0, 0.005, 0.007), mid, 0.1, along, inward, 0.06, 0.01)).toBeGreaterThan(0);
    expect(cutCarve(at(0, 0.05, 0.007), mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
  });
});

describe('cutCarve: Lipschitz bound and the skin-following depth', () => {
  // Max |grad| of the carve term by one-sided finite differences over a dense grid around the slot.
  const maxGrad = (halfLen: number, depth: number, kerf: number): number => {
    const f = (a: number, s: number, u: number) => cutCarve([u, mid[1] + a, mid[2] - s], mid, halfLen, along, inward, depth, kerf);
    const h = 2e-4, step = 0.001;
    let m = 0;
    for (let a = -halfLen - 0.02; a <= halfLen + 0.02; a += step) {
      for (let s = -0.02; s <= depth + 0.02; s += step) {
        for (let u = -0.03; u <= 0.03; u += step) {
          const f0 = f(a, s, u);
          for (const sg of [1, -1]) {
            const g = Math.hypot((f(a + sg * h, s, u) - f0) / h, (f(a, s + sg * h, u) - f0) / h, (f(a, s, u + sg * h) - f0) / h);
            if (g > m) m = g;
          }
        }
      }
    }
    return m;
  };
  for (const [h, name] of [[0.1, 'long'], [0.05, 'medium'], [0.015, 'short']] as const) {
    it(`max |grad| <= 2.2 for a ${name} slot (halfLen ${h}, depth 0.06, kerf 0.01)`, () => {
      const m = maxGrad(h, 0.06, 0.01);
      console.log(`lipschitz halfLen=${h}: ${m.toFixed(3)}`);
      expect(m).toBeLessThanOrEqual(2.2);
    });
  }
  it('with `below` passed, depth follows the real skin, not the straight inward axis', () => {
    // At |a|/h = 0.7 the slot is shallow (prof 0.51, floor 0.031). A point 0.03 below the real (curved-away) skin but
    // 0.045 along the inward axis: outside by s alone, inside by `below`.
    const p: Vec3 = [0, mid[1] + 0.07, mid[2] - 0.045];
    expect(cutCarve(p, mid, 0.1, along, inward, 0.06, 0.01)).toBeLessThan(0);
    expect(cutCarve(p, mid, 0.1, along, inward, 0.06, 0.01, 0, 0.03)).toBeGreaterThan(0);
  });
});

describe('cutsFromSweep', () => {
  const view: Vec3 = [0, 0, -1];
  const sample = (x: number, y: number, z = 0.15) => ({ point: [x, y, z] as Vec3, view });
  const T = (y: number) => sample(0, y);              // on the torso (cluster 1)
  const A = (y: number) => sample(0.4, y, 0.05);      // on the arm (cluster 2)
  const lenOf = (g: { a: Vec3; b: Vec3 }) => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
  it('one segment from first to last sample on one cluster, carrying the averaged view', () => {
    const segs = cutsFromSweep(prims, [sample(0, 1.15), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a[1]).toBeCloseTo(1.15, 9);
    expect(segs[0]!.b[1]).toBeCloseTo(1.35, 9);
    expect(segs[0]!.view[2]).toBeCloseTo(-1, 6);
    expect('normal' in segs[0]!).toBe(false);
  });
  it('splits by cluster: a sweep across the arm and the torso is two cuts', () => {
    const segs = cutsFromSweep(prims, [sample(0.4, 1.2, 0.05), sample(0.4, 1.3, 0.05), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(2);
  });
  it('drops segments shorter than CUT.minLen and clamps to CUT.maxLen about the midpoint', () => {
    expect(cutsFromSweep(prims, [sample(0, 1.25), sample(0, 1.26)])).toHaveLength(0);
    const long = cutsFromSweep(prims, [sample(0, 0.9), sample(0, 1.6)])[0]!;
    expect(lenOf(long)).toBeCloseTo(CUT.maxLen, 6);
  });
  it('a lone mislabelled sample between two of the same cluster does not split the cut (jitter)', () => {
    // T T A T T A T T A T: the A samples are nearer the arm but sit between torso neighbours.
    const ys = [1.10, 1.13, 1.16, 1.19, 1.22, 1.25, 1.28, 1.31, 1.34, 1.37];
    const lone = new Set([2, 5, 8]);
    const samples = ys.map((y, i) => (lone.has(i) ? sample(0.3, y, 0) : T(y)));
    const segs = cutsFromSweep(prims, samples);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a[1]).toBeCloseTo(1.10, 9);
    expect(segs[0]!.b[1]).toBeCloseTo(1.37, 9);
  });
  it('keeps the longest CUT.maxPerSlash cuts, not the first ones', () => {
    expect(CUT.maxPerSlash).toBe(3);
    const segs = cutsFromSweep(prims, [T(1.10), T(1.15), A(1.10), A(1.15), T(1.20), T(1.25), A(1.10), A(1.30)]);
    expect(segs).toHaveLength(3);
    expect(segs.some(g => Math.abs(lenOf(g) - 0.2) < 1e-6)).toBe(true);
  });
});

describe('stampCut', () => {
  const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, view: [0, 0, -1] as Vec3 };
  const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
  it('is a cut on the torso: midpoint anchor, half-length radius, no sever, wet lip', () => {
    expect(w.shape).toBe('cut');
    expect(w.primIdx).toBe(0);
    expect(w.radius).toBeCloseTo(0.1, 6);
    expect(w.severRadius).toBe(0);
    expect(w.wetLip).toBe(1);
    const p = woundWorldPos(prims, w, 0);
    expect(p[1]).toBeCloseTo(1.25, 3);
    expect(Math.abs(field(p))).toBeLessThan(0.002);           // on the skin
  });
  it('its along direction is the sweep, its inward points into the body, depth is capped', () => {
    const along = woundDirToWorld(prims, w, w.cutDir!, 0);
    expect(Math.abs(along[1])).toBeCloseTo(1, 3);
    const inw = woundDirToWorld(prims, w, w.carveN!, 0);
    expect(inw[2]).toBeLessThan(-0.9);
    expect(w.carveDepth!).toBeLessThanOrEqual(Math.min(ROD_CALIBRE.depth, CUT.maxDepth) + 1e-9);
    expect(w.kerf).toBe(ROD_CALIBRE.kerf);
    expect(w.rimScale).toBe(ROD_CALIBRE.lip);
  });
  it('depth comes from the flesh and obeys the depth/length clamp: a 0.12 m cut gets the full calibre depth, a 0.03 m cut 1.6 x its half-length', () => {
    const cut = (half: number) => stampCut(prims, { a: [0, 1.25 - half, 0.15], b: [0, 1.25 + half, 0.15], view: [0, 0, -1] }, ROD_CALIBRE, 0, field);
    expect(cut(0.06).carveDepth).toBe(ROD_CALIBRE.depth);
    expect(cut(0.015).carveDepth).toBeCloseTo(CUT_SHADE.maxDepthPerHalfLen * 0.015, 9);
    expect(cut(0.015).carveDepth).toBeCloseTo(0.024, 9);
  });
  it('a slash across the arm silhouette (chord midpoint on its axis) anchors on the skin facing the viewer', () => {
    const g = stampCut(prims, { a: [0.35, 1.25, 0], b: [0.45, 1.25, 0], view: [0, 0, -1] }, ROD_CALIBRE, 0, field);
    expect(g.primIdx).toBe(1);
    const p = woundWorldPos(prims, g, 0);
    expect(p[2]).toBeGreaterThan(0.045);
    expect(p[2]).toBeLessThan(0.055);
    expect(p[1]).toBeCloseTo(1.25, 2);
    expect(Math.abs(field(p))).toBeLessThan(0.002);
    const inw = woundDirToWorld(prims, g, g.carveN!, 0);
    expect(inw[2]).toBeLessThan(-0.9);
  });
});

describe('cutExposureSpheres (for the sphere-only bone exposure)', () => {
  it('a chain of spheres along the slot, a single sphere for a crater', () => {
    const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, view: [0, 0, -1] as Vec3 };
    const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
    const s = cutExposureSpheres(prims, w, 0);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...s.map(x => x.pos[1]))).toBeLessThan(1.18);
    expect(Math.max(...s.map(x => x.pos[1]))).toBeGreaterThan(1.32);
    // radius follows the lens, centres sit inward at interior points (z < the skin's 0.15)
    const mids = s.filter(x => Math.abs(x.pos[1] - 1.25) < 0.01);
    expect(mids.length).toBeGreaterThan(0);
    expect(mids[0]!.radius).toBeCloseTo(ROD_CALIBRE.depth, 3);
    expect(mids[0]!.pos[2]).toBeLessThan(0.15 - 0.02);
    expect(s[0]!.radius).toBeCloseTo(2 * ROD_CALIBRE.kerf, 6);
    const crater = { primIdx: 0, local: w.local, radius: 0.05, type: 'pellet' as const, ageSec: 0, axis0: w.axis0 };
    expect(cutExposureSpheres(prims, crater, 0)).toEqual([{ pos: woundWorldPos(prims, crater, 0), radius: 0.05 }]);
  });
});
