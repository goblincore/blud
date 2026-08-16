import { describe, it, expect } from 'vitest';
import { mergeBodies, bodySphere, MAX_BODIES } from './merge-bodies';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { translateBody } from './translate';
import { sdBody } from './validate';
import type { BuiltBody, Vec3 } from './types';

const base = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);
const at = (x: number, z: number): BuiltBody => translateBody(base, [x, 0, z]);

describe('bodySphere', () => {
  it('contains the whole surface, so culling against it cannot clip the body', () => {
    // The invariant the shader depends on. If a sample point outside the
    // sphere could still be near the surface, culling there would carve
    // pieces off the body — and it would show as clipped edges exactly at the
    // blends, which is the hardest artefact to attribute.
    const s = bodySphere(base);
    let checked = 0;
    for (const p of base.prims) {
      for (const end of [p.a, p.b] as Vec3[]) {
        const dx = end[0]! - s.centre[0]!;
        const dy = end[1]! - s.centre[1]!;
        const dz = end[2]! - s.centre[2]!;
        // Every primitive endpoint must sit inside, with its own radius to spare.
        const reach = p.radius * Math.max(p.scale[0]!, p.scale[1]!, p.scale[2]!);
        expect(Math.hypot(dx, dy, dz) + reach).toBeLessThanOrEqual(s.radius + 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reports the surface as far away for points outside the sphere', () => {
    // Sampled directly against the CPU mirror of the field, which is what the
    // shader is culling an evaluation of.
    const s = bodySphere(base);
    const dirs: Vec3[] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [0.577, 0.577, 0.577], [-0.577, 0.577, -0.577],
    ];
    for (const d of dirs) {
      const p: Vec3 = [
        s.centre[0]! + d[0]! * s.radius,
        s.centre[1]! + d[1]! * s.radius,
        s.centre[2]! + d[2]! * s.radius,
      ];
      expect(sdBody(p, base)).toBeGreaterThan(0);
    }
  });

  it('follows the body when it is translated', () => {
    const s0 = bodySphere(base);
    const s1 = bodySphere(at(5, -3));
    expect(s1.centre[0]).toBeCloseTo(s0.centre[0]! + 5, 5);
    expect(s1.centre[2]).toBeCloseTo(s0.centre[2]! - 3, 5);
    expect(s1.radius).toBeCloseTo(s0.radius, 5);
  });

  it('is empty for a body with no live clusters', () => {
    const dead: BuiltBody = { ...base, clusters: base.clusters.map(c => ({ ...c, alive: false })) };
    expect(bodySphere(dead).radius).toBe(0);
  });
});

describe('mergeBodies', () => {
  it('concatenates primitives in body order without reordering within a body', () => {
    // smin is not associative, so any reordering inside a body changes the
    // surface everywhere. Bodies may be concatenated; their contents may not
    // be disturbed.
    const merged = mergeBodies([at(0, 0), at(2, 0)]);
    expect(merged.prims.length).toBe(base.prims.length * 2);
    for (let i = 0; i < base.prims.length; i++) {
      expect(merged.prims[i]!.cluster).toBe(base.prims[i]!.cluster);
      expect(merged.prims[base.prims.length + i]!.cluster).toBe(base.prims[i]!.cluster);
    }
  });

  it('rebases cluster starts onto the merged primitive list', () => {
    const merged = mergeBodies([at(0, 0), at(2, 0)]);
    for (const c of merged.clusters) {
      // Every cluster's slice must still point at primitives that belong to it.
      const slice = merged.prims.slice(c.start, c.start + c.count);
      expect(slice.length).toBe(c.count);
      for (const p of slice) expect(p.cluster).toBe(c.id);
    }
  });

  it('gives each body a contiguous, correctly sized cluster range', () => {
    const merged = mergeBodies([at(0, 0), at(2, 0), at(-2, 1)]);
    expect(merged.bodies.length).toBe(3);
    let expectedStart = 0;
    for (const b of merged.bodies) {
      expect(b.clusterStart).toBe(expectedStart);
      expect(b.clusterCount).toBe(base.clusters.length);
      expectedStart += b.clusterCount;
    }
    expect(expectedStart).toBe(merged.clusters.length);
  });

  it('places each body sphere at that body, not at the merged centroid', () => {
    const merged = mergeBodies([at(0, 0), at(6, 0)]);
    expect(merged.bodies[1]!.centre[0]! - merged.bodies[0]!.centre[0]!).toBeCloseTo(6, 5);
  });

  it('preserves the merged field: a point near one body reads the same as before merging', () => {
    // The whole promise of the merge. Two bodies far enough apart not to blend
    // must each keep their own surface exactly.
    const a = at(0, 0);
    const b = at(8, 0);
    const merged = mergeBodies([a, b]);
    const mergedBody: BuiltBody = { prims: merged.prims, clusters: merged.clusters, bones: a.bones };
    for (const probe of [
      [0, 1.0, 0], [0.1, 1.4, 0.05], [8, 1.0, 0], [8.1, 1.4, 0.05],
    ] as Vec3[]) {
      const before = Math.min(sdBody(probe, a), sdBody(probe, b));
      expect(sdBody(probe, mergedBody)).toBeCloseTo(before, 5);
    }
  });

  it('counts carves across every body', () => {
    const one = mergeBodies([at(0, 0)]);
    const two = mergeBodies([at(0, 0), at(2, 0)]);
    expect(two.carveCount).toBe(one.carveCount * 2);
  });

  it('drops whole bodies past the cap rather than truncating one mid-torso', () => {
    const many = Array.from({ length: MAX_BODIES + 4 }, (_, i) => at(i * 2, 0));
    const merged = mergeBodies(many);
    expect(merged.bodies.length).toBe(MAX_BODIES);
    // Every retained body is complete.
    expect(merged.prims.length).toBe(base.prims.length * MAX_BODIES);
  });

  it('skips fully dead bodies instead of emitting a zero-radius sphere', () => {
    const dead: BuiltBody = { ...base, clusters: base.clusters.map(c => ({ ...c, alive: false })) };
    const merged = mergeBodies([at(0, 0), dead, at(2, 0)]);
    expect(merged.bodies.length).toBe(2);
    for (const b of merged.bodies) expect(b.radius).toBeGreaterThan(0);
  });

  it('handles an empty scene', () => {
    const merged = mergeBodies([]);
    expect(merged.bodies).toEqual([]);
    expect(merged.prims).toEqual([]);
    expect(merged.maxBlendK).toBe(0);
  });
});
