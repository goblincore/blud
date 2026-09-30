import { describe, expect, it } from 'vitest';
import { createStains, depositStain, indexTriangles, projectStain, sweepTriangles, clearStains, STAIN_CAP } from './blood-surface';
import { createBloodSim, stepBlood, type Droplet } from './blood-sim';
import type { Vec3 } from './types';

// Up-facing floor and a wall facing -X. The wall is at x=1, not height zero.
const floor = [-2, 0, -2, -2, 0, 2, 2, 0, 2, -2, 0, -2, 2, 0, 2, 2, 0, -2];
const wall = [1, 0, -2, 1, 0, 2, 1, 3, 2, 1, 0, -2, 1, 3, 2, 1, 3, -2];
const index = indexTriangles(new Float32Array([...floor, ...wall]));
const drop = (pos: Vec3, vel: Vec3, life = 5, kind: Droplet['kind'] = 'drop'): Droplet => ({ pos: [...pos], vel: [...vel], life, kind, age: 0, size: 0.05 });

describe('surface blood hits', () => {
  it('returns the first crossed surface and outward normal, even at high speed', () => {
    const hit = sweepTriangles(index, [0, 1, 0], [4, 1, 0], 7)!;
    expect(hit.pos).toEqual([1, 1, 0]); expect(hit.normal).toEqual([-1, 0, 0]);
    expect(hit.receiver).toBe(7); expect(hit.t).toBe(0.25);
    expect(sweepTriangles(index, [0, 2, 0], [0, -2, 0])!.normal).toEqual([0, 1, 0]);
  });
  it('rejects back faces and triangles outside the swept segment', () => {
    expect(sweepTriangles(index, [2, 1, 0], [0, 1, 0])).toBeNull();
    expect(sweepTriangles(index, [0, 4, 0], [4, 4, 0])).toBeNull();
    expect(sweepTriangles(index, [0, 1, 0], [0.5, 1, 0])).toBeNull();
  });
  it('indexes enough triangles to traverse branches, preserving nearest-hit ordering', () => {
    const many = indexTriangles(new Float32Array(Array.from({ length: 40 }, (_, i) => floor.map((x, k) => k % 3 === 1 ? x - i : x)).flat()));
    expect(sweepTriangles(many, [0, 1, 0], [0, -39, 0])!.pos[1]).toBe(0);
  });
  it('kills a wall-hitting droplet and deposits there instead of on the floor', () => {
    const sim = createBloodSim(), hits: Vec3[] = [];
    sim.droplets.push(drop([0.9, 1, 0], [8, 0, 0]));
    stepBlood(sim, 0.05, () => { throw new Error('surface mode must not consume splat RNG'); }, undefined,
      { sweep: (a, b) => sweepTriangles(index, a, b), deposit: h => hits.push(h.pos) });
    expect(hits).toHaveLength(1); expect(hits[0]![0]).toBe(1); expect(hits[0]![1]).toBeGreaterThan(0.9);
    expect(sim.droplets).toHaveLength(0); expect(sim.splats).toHaveLength(0);
  });
  it('expiry in midair produces no stain; mist evaporates and guts remain chain-owned', () => {
    const sim = createBloodSim(), hits: unknown[] = [];
    sim.droplets.push(drop([0, 2, 0], [0, 0, 0], 0.01), drop([0, 0.01, 0], [0, -1, 0], 5, 'mist'), drop([0, 0, 0], [0, -1, 0], 0, 'gut'));
    stepBlood(sim, 0.1, () => 0.5, undefined, { sweep: (a, b) => sweepTriangles(index, a, b), deposit: h => hits.push(h) });
    expect(hits).toEqual([]); expect(sim.splats).toEqual([]); expect(sim.droplets).toHaveLength(1);
    expect(sim.droplets[0]!.kind).toBe('gut'); expect(sim.droplets[0]!.age).toBe(0);
  });
});

describe('stain persistence and projection', () => {
  const hit = { pos: [1, 1, 0] as Vec3, normal: [-1, 0, 0] as Vec3, t: 0.5, receiver: 1 };
  it('clips onto the receiving wall, with no floor or opposite-side triangles', () => {
    const s = createStains(), d = depositStain(s, hit, [3, 0, 1], 0.05);
    const mesh = projectStain(index, d);
    expect(mesh.positions.length).toBeGreaterThan(0);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeCloseTo(0.9985);
      expect(Math.abs(mesh.positions[i + 1]! - 1)).toBeLessThanOrEqual(d.width + d.height);
      expect(mesh.normals[i]).toBe(-1);
    }
    expect(mesh.uvs.every(x => Math.abs(x) <= 1.00001)).toBe(true);
  });
  it('aligns a smear with tangential impact motion', () => {
    const d = depositStain(createStains(), hit, [1, 0, 6], 0.05);
    expect(d.look).toBe('smear'); expect(d.tangent).toEqual([0, 0, 1]);
    expect(d.width / d.height).toBe(2.4);
  });
  it('merges on the same receiver only and persists without particle state', () => {
    const s = createStains(); depositStain(s, hit, [3, 0, 0], 0.05); s.clock = 20;
    depositStain(s, hit, [3, 0, 0], 0.05);
    expect(s.stains).toHaveLength(1); expect(s.merged).toBe(1); expect(s.stains[0]!.born).toBe(20);
    depositStain(s, { ...hit, receiver: 2 }, [3, 0, 0], 0.05); expect(s.stains).toHaveLength(2);
    s.clock = 1000; expect(s.stains).toHaveLength(2);
  });
  it('has deterministic variation and evicts oldest records at the explicit budget', () => {
    const a = createStains(), b = createStains();
    for (let i = 0; i < STAIN_CAP + 10; i++) for (const s of [a, b]) depositStain(s, { ...hit, receiver: i }, [2, 0, 0], 0.1);
    expect(a).toEqual(b); expect(a.stains).toHaveLength(STAIN_CAP); expect(a.evicted).toBe(10);
    clearStains(a); expect(a.stains).toEqual([]);
  });
});
