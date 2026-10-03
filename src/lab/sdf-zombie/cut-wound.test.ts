// src/lab/sdf-zombie/cut-wound.test.ts
import { describe, expect, it } from 'vitest';
import { CUT, ROD_CALIBRE, cutCarve, cutExposureSpheres, cutsFromSweep, stampCut } from './cut-wound';
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

describe('cutsFromSweep', () => {
  const view: Vec3 = [0, 0, -1];
  const sample = (x: number, y: number, z = 0.15) => ({ point: [x, y, z] as Vec3, view });
  it('one segment from first to last sample on one cluster, normal = sweep × view', () => {
    const segs = cutsFromSweep(prims, [sample(0, 1.15), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a[1]).toBeCloseTo(1.15, 9);
    expect(segs[0]!.b[1]).toBeCloseTo(1.35, 9);
    expect(Math.abs(segs[0]!.normal[0])).toBeCloseTo(1, 6);   // (0,1,0) × (0,0,-1) = (-1,0,0)
  });
  it('splits by cluster: a sweep across the arm and the torso is two cuts', () => {
    const segs = cutsFromSweep(prims, [sample(0.4, 1.2, 0.05), sample(0.4, 1.3, 0.05), sample(0, 1.25), sample(0, 1.35)]);
    expect(segs).toHaveLength(2);
  });
  it('drops segments shorter than CUT.minLen and clamps to CUT.maxLen about the midpoint', () => {
    expect(cutsFromSweep(prims, [sample(0, 1.25), sample(0, 1.26)])).toHaveLength(0);
    const long = cutsFromSweep(prims, [sample(0, 0.9), sample(0, 1.6)])[0]!;
    expect(Math.hypot(long.b[0] - long.a[0], long.b[1] - long.a[1], long.b[2] - long.a[2])).toBeCloseTo(CUT.maxLen, 6);
  });
  it('never returns more than CUT.maxPerSlash cuts', () => {
    expect(CUT.maxPerSlash).toBe(3);
  });
});

describe('stampCut', () => {
  const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, normal: [-1, 0, 0] as Vec3 };
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
  });
});

describe('cutExposureSpheres (for the sphere-only bone exposure)', () => {
  it('a chain of spheres along the slot, a single sphere for a crater', () => {
    const seg = { a: [0, 1.15, 0.15] as Vec3, b: [0, 1.35, 0.15] as Vec3, normal: [-1, 0, 0] as Vec3 };
    const w = stampCut(prims, seg, ROD_CALIBRE, 0, field);
    const s = cutExposureSpheres(prims, w, 0);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...s.map(x => x.pos[1]))).toBeLessThan(1.18);
    expect(Math.max(...s.map(x => x.pos[1]))).toBeGreaterThan(1.32);
    const crater = { primIdx: 0, local: w.local, radius: 0.05, type: 'pellet' as const, ageSec: 0, axis0: w.axis0 };
    expect(cutExposureSpheres(prims, crater, 0)).toEqual([{ pos: woundWorldPos(prims, crater, 0), radius: 0.05 }]);
  });
});
