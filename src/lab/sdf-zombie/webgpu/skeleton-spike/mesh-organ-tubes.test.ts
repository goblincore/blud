// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-organ-tubes.test.ts
//
// The swept organ tubes against the field they stand for. Everything that can run on the real zombie does
// (characters/zombie.blob: 4 bent gut bars, 4 haustra blobs, in two organ segments); the taper, the scale and the
// refusal cases have no authored organ yet and use prims built here.
import { describe, it, expect } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdPrimitive } from '../../validate';
import type { Primitive, Vec3 } from '../../types';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';
import { extractSegmentMesh, ORGAN_MESHES } from './mesh';
import { ORGAN_CREASE_REACH, ORGAN_TUBE_STRIDE, organTubeable, sweepOrganTubes, type OrganTubeMesh } from './mesh-organ-tubes';

const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const organs = createSkeletonSources(body, bindRig(body), { character: 'zombie', organs: true }).filter(s => s.kind === 'organ');
const SPEC = ORGAN_MESHES.tubes;

const prim = (over: Partial<Primitive>): Primitive => ({
  a: [0, 0, 0], b: [0, 0, 0], radius: 0.02, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, ...over,
} as Primitive);
const vert = (m: OrganTubeMesh, i: number): Vec3 => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
const norm = (m: OrganTubeMesh, i: number): Vec3 => [m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Distance from `p` to triangle abc (Ericson, closest point). */
function pointTri(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = (v: number, w: number) => Math.hypot(ap[0] - ab[0] * v - ac[0] * w, ap[1] - ab[1] * v - ac[1] * w, ap[2] - ab[2] * v - ac[2] * w);
  if (d1 <= 0 && d2 <= 0) return at(0, 0);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at(1 - w, w); }
  const den = 1 / (va + vb + vc);
  return at(vb * den, vc * den);
}

describe('swept organ tubes (organs, low-poly)', () => {
  it('the zombie has two organ segments, and every organ prim can be swept', () => {
    expect(organs.map(s => s.segment)).toEqual(['organ:axial:0-1', 'organ:axial:1-2']);
    for (const s of organs) { expect(s.prims!.length).toBe(s.primCount); expect(s.prims!.every(organTubeable)).toBe(true); }
    expect(organs.reduce((n, s) => n + s.primCount, 0)).toBe(8);
  });

  it('every vertex lies on its own prim, and none lies outside the segment field', () => {
    for (const s of organs) {
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      m.ranges.forEach((range, k) => {
        for (let v = range.start; v < range.start + range.count; v++) {
          // On the prim it was swept from: the envelope is the field's zero set (sdBentCone is approximate by its own
          // account; the worst here is its refinement error).
          expect(Math.abs(sdPrimitive(vert(m, v), s.prims![k]!))).toBeLessThan(2e-4);
          // Never outside the union: the hard min is at most that prim's distance.
          expect(s.distance(vert(m, v))).toBeLessThan(2e-4);
        }
      });
    }
  });

  it('the normal is the field gradient of the vertex prim (analytic, unit)', () => {
    const h = 1e-5;
    for (const s of organs) {
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      m.ranges.forEach((range, k) => {
        const f = (p: Vec3) => sdPrimitive(p, s.prims![k]!);
        for (let v = range.start; v < range.start + range.count; v++) {
          const p = vert(m, v), n = norm(m, v);
          expect(Math.hypot(...n)).toBeCloseTo(1, 6);
          const g: Vec3 = [f([p[0] + h, p[1], p[2]]) - f([p[0] - h, p[1], p[2]]), f([p[0], p[1] + h, p[2]]) - f([p[0], p[1] - h, p[2]]), f([p[0], p[1], p[2] + h]) - f([p[0], p[1], p[2] - h])];
          const l = Math.hypot(...g);
          expect(dot(n, [g[0] / l, g[1] / l, g[2] / l])).toBeGreaterThan(0.995);
        }
      });
    }
  });

  it('faces wind outward; a face that does not is folded inside the solid (the inner side of a tight bend)', () => {
    let folded = 0, faces = 0;
    for (const s of organs) {
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      for (let i = 0; i < m.index.length; i += 3) {
        const [a, b, c] = [m.index[i]!, m.index[i + 1]!, m.index[i + 2]!];
        const fn = cross(sub(vert(m, b), vert(m, a)), sub(vert(m, c), vert(m, a)));
        const out: Vec3 = [norm(m, a)[0] + norm(m, b)[0] + norm(m, c)[0], norm(m, a)[1] + norm(m, b)[1] + norm(m, c)[1], norm(m, a)[2] + norm(m, b)[2] + norm(m, c)[2]];
        faces++;
        if (dot(fn, out) > 0) continue;
        folded++;
        // Where the axis curves tighter than the radius the swept rings cross: that part of the envelope is INSIDE
        // the union of spheres, so the centre of such a face is under the surface, hidden by the faces round it.
        const centre: Vec3 = [(vert(m, a)[0] + vert(m, b)[0] + vert(m, c)[0]) / 3, (vert(m, a)[1] + vert(m, b)[1] + vert(m, c)[1]) / 3, (vert(m, a)[2] + vert(m, b)[2] + vert(m, c)[2]) / 3];
        expect(s.distance(centre)).toBeLessThan(0);
      }
    }
    expect(faces).toBeGreaterThan(0);
    console.log(`  folded faces: ${folded} of ${faces}`);
  });

  it('covers the field: every vertex of the 5 mm extraction is within the chord error of a tube face', () => {
    // The mesh of 2026-10-06 is on the union's surface (mesh.test.ts). Each of its vertices must be near a face of the
    // sweep: nothing of the organ is missing from it. The bound is the tessellation's own sag: an 8-gon inscribed
    // in a 2.6 cm circle is 2.0 mm inside it at a face centre, and the caps and the bends add to that.
    let worst = 0, sum = 0, n = 0;
    for (const s of organs) {
      const fine = extractSegmentMesh(s, undefined, ORGAN_MESHES['nets-5mm']).geometry.getAttribute('position');
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      const tris: [Vec3, Vec3, Vec3][] = [];
      for (let i = 0; i < m.index.length; i += 3) tris.push([vert(m, m.index[i]!), vert(m, m.index[i + 1]!), vert(m, m.index[i + 2]!)]);
      for (let v = 0; v < fine.count; v++) {
        const p: Vec3 = [fine.getX(v), fine.getY(v), fine.getZ(v)];
        let d = Infinity;
        for (const t of tris) d = Math.min(d, pointTri(p, t[0], t[1], t[2]));
        worst = Math.max(worst, d); sum += d; n++;
      }
    }
    console.log(`  5 mm extraction to sweep: worst ${(worst * 1000).toFixed(2)} mm, mean ${(sum / n * 1000).toFixed(2)} mm over ${n} vertices`);
    expect(worst).toBeLessThan(0.004);
    expect(sum / n).toBeLessThan(0.0015);
  });

  it('tube.xyz is the vertex on its tube pulled straight: yz the radius across, x the arc along, each prim on its own stretch', () => {
    for (const s of organs) {
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      m.ranges.forEach((range, k) => {
        const p = s.prims![k]!;
        let lo = Infinity, hi = -Infinity;
        for (let v = range.start; v < range.start + range.count; v++) {
          const [x, y, z] = [m.tube[v * 4]!, m.tube[v * 4 + 1]!, m.tube[v * 4 + 2]!];
          expect(Math.hypot(y, z)).toBeLessThan(p.radius + 1e-6);
          lo = Math.min(lo, x); hi = Math.max(hi, x);
        }
        // From one pole to the other: the axis's arc length and a radius at each end. The arc is at least the chord.
        const chord = Math.hypot(...sub(p.b, p.a));
        expect(lo).toBeCloseTo(k * ORGAN_TUBE_STRIDE - p.radius, 6);   // a Float32Array
        expect(hi - lo).toBeGreaterThanOrEqual(chord + 2 * p.radius - 1e-6);
        expect(hi - lo).toBeLessThan(ORGAN_TUBE_STRIDE);
        // A body ring's vertices are a full radius across.
        const ring0 = range.start;
        expect(Math.hypot(m.tube[ring0 * 4 + 1]!, m.tube[ring0 * 4 + 2]!)).toBeCloseTo(p.radius, 6);
      });
    }
  });

  it('the crease shade is 0 where a vertex touches another prim, 1 clear of them all, and exactly the distance between', () => {
    for (const s of organs) {
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      let creased = 0, clear = 0;
      m.ranges.forEach((range, k) => {
        for (let v = range.start; v < range.start + range.count; v++) {
          let d = Infinity;
          s.prims!.forEach((o, j) => { if (j !== k) d = Math.min(d, sdPrimitive(vert(m, v), o)); });
          const want = s.prims!.length === 1 ? 1 : Math.max(0, Math.min(1, d / ORGAN_CREASE_REACH));
          expect(m.tube[v * 4 + 3]).toBeCloseTo(want, 6);
          if (want === 0) creased++; else if (want === 1) clear++;
        }
      });
      if (s.prims!.length > 1) { expect(creased).toBeGreaterThan(0); expect(clear).toBeGreaterThan(0); }
    }
  });

  it('a tapered straight prim is the round cone: rings off-centre, on the field', () => {
    const p = prim({ a: [0, 0, 0], b: [0, 0.10, 0], radius: 0.03, radiusB: 0.012 });
    const m = sweepOrganTubes([p], SPEC)!;
    for (let v = 0; v < m.positions.length / 3; v++) expect(Math.abs(sdPrimitive(vert(m, v), p))).toBeLessThan(1e-7);   // f32 positions
    // Straight: one segment, two rings; the caps close it.
    expect(m.positions.length / 3).toBe(2 * SPEC.around + 2 * (SPEC.capLats * SPEC.around + 1));
  });

  it('a scaled prim is swept in the scale-divided frame the field measures in', () => {
    const p = prim({ a: [0, 0, 0], b: [0.06, 0, 0], radius: 0.02, scale: [1, 0.6, 1.4], bend: [0, 0.02, 0.01] });
    const m = sweepOrganTubes([p], SPEC)!;
    // sdPrimitive of a scaled prim is a bound, not a distance, but its zero set is exact.
    for (let v = 0; v < m.positions.length / 3; v++) expect(Math.abs(sdPrimitive(vert(m, v), p))).toBeLessThan(2e-4);
  });

  it('a sphere is two caps on one ring, its axis toward its nearest neighbour', () => {
    const a = prim({ a: [0, 0, 0], b: [0, 0, 0], radius: 0.02 }), b = prim({ a: [0, 0.03, 0], b: [0, 0.03, 0], radius: 0.02 });
    const m = sweepOrganTubes([a, b], SPEC)!;
    expect(m.ranges[0]!.count).toBe(SPEC.around + 2 * (SPEC.capLats * SPEC.around + 1));
    // The last vertex of a prim is its end-1 pole: on the axis, toward the neighbour.
    const pole = vert(m, m.ranges[0]!.start + m.ranges[0]!.count - 1);
    expect(pole[0]).toBeCloseTo(0, 6); expect(pole[1]).toBeCloseTo(0.02, 6); expect(pole[2]).toBeCloseTo(0, 6);
    // And that pole is inside the neighbour: a crease.
    expect(m.tube[(m.ranges[0]!.start + m.ranges[0]!.count - 1) * 4 + 3]).toBe(0);
  });

  it('refuses a prim a sweep cannot express, and an empty list', () => {
    expect(sweepOrganTubes([], SPEC)).toBeNull();
    expect(sweepOrganTubes([prim({ box: { round: 0.2 } } as Partial<Primitive>)], SPEC)).toBeNull();
    expect(organTubeable(prim({ orient: [0, 0.3826834, 0, 0.9238795] }))).toBe(false);
    expect(organTubeable(prim({ orient: [0, 0, 0, 1] }))).toBe(true);
  });

  it('the segments along a prim follow its turn; the counts are the spec, exactly', () => {
    for (const s of organs) {
      const m = sweepOrganTubes(s.prims!, SPEC)!;
      const cap = 2 * (SPEC.capLats * SPEC.around + 1);
      m.ranges.forEach((range, k) => {
        const rings = (range.count - cap) / SPEC.around;
        expect(Number.isInteger(rings)).toBe(true);
        if (s.prims![k]!.bend === undefined) expect(rings).toBe(1);
        else { expect(rings).toBeGreaterThan(2); expect(rings - 1).toBeLessThanOrEqual(SPEC.alongMax); }
      });
    }
  });
});
