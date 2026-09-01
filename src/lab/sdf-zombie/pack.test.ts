// src/lab/sdf-zombie/pack.test.ts
import { describe, it, expect } from 'vitest';
import { packBody, PRIM_STRIDE, CLUSTER_STRIDE, GROUP_RADIUS_MAX, W_ADD, W_BONE, W_DEAD } from './pack';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import schoolgirlSrc from './characters/schoolgirl.blob?raw';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';
import type { BuiltBody, Primitive, Vec3 } from './types';

/** Packs into Float32Array, so expected values must be rounded to float32. */
const f32 = (v: number) => Math.fround(v);

describe('packBody', () => {
  const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const packed = packBody(built);

  it('allocates fixed-size arrays matching the shader ceilings', () => {
    expect(packed.primA).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primB).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primScale).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.primQuat).toHaveLength(MAX_PRIMS * PRIM_STRIDE);
    expect(packed.clusterBounds).toHaveLength(MAX_CLUSTERS * CLUSTER_STRIDE);
    expect(packed.clusterRange).toHaveLength(MAX_CLUSTERS * CLUSTER_STRIDE);
  });

  it('reports the live counts', () => {
    expect(packed.primCount).toBe(built.prims.length);
    expect(packed.clusterCount).toBe(built.clusters.length);
  });

  it('packs endpoint A with radius in w', () => {
    const p = built.prims[0]!;
    expect(Array.from(packed.primA.slice(0, 4))).toEqual([...p.a, p.radius].map(f32));
  });

  it('packs endpoint B with blendK in w', () => {
    const p = built.prims[0]!;
    expect(Array.from(packed.primB.slice(0, 4))).toEqual([...p.b, p.blendK].map(f32));
  });

  it('packs cluster range as (start, count, alive) and bounds as (center, radius)', () => {
    const c = built.clusters[0]!;
    expect(Array.from(packed.clusterRange.slice(0, 3))).toEqual([c.start, c.count, 1]);
    expect(Array.from(packed.clusterBounds.slice(0, 4))).toEqual([...c.center, c.radius].map(f32));
  });

  it('writes alive = 0 for a severed cluster without moving any primitive', () => {
    const severed = { ...built, clusters: built.clusters.map((c, i) => i === 2 ? { ...c, alive: false } : c) };
    const p2 = packBody(severed);
    expect(p2.clusterRange[2 * CLUSTER_STRIDE + 2]).toBe(0);
    // Primitive payload is byte-identical — severing never re-packs.
    expect(Array.from(p2.primA)).toEqual(Array.from(packed.primA));
  });

  it('packs an absent orient as the identity quat, and a set one verbatim', () => {
    // The shader branches on |1 - w|, so the identity default must be exact.
    const q: [number, number, number, number] = [0, 0.7071068, 0, 0.7071068];
    const p = packBody({
      prims: [
        { ...built.prims[0]! },
        { ...built.prims[0]!, orient: q },
      ],
      clusters: [{ id: 0, limb: 'head', start: 0, count: 2, center: [0, 0, 0], radius: 1, alive: true }],
      bones: new Map(),
    });
    expect(Array.from(p.primQuat.slice(0, 4))).toEqual([0, 0, 0, 1]);
    expect(Array.from(p.primQuat.slice(4, 8))).toEqual(q.map(f32));
  });

  it('sets the clusterRange.w orient flag only for clusters carrying a real quat', () => {
    // The shader hoists the per-prim quat branch to this flag; a stale or
    // missing flag either pays a textureLoad per prim everywhere or renders
    // a turned head's face world-aligned again.
    const q: [number, number, number, number] = [0, 0.7071068, 0, 0.7071068];
    const mk = (orient?: [number, number, number, number]) => ({
      ...built.prims[0]!, ...(orient ? { orient } : {}),
    });
    const p = packBody({
      prims: [mk(), mk(q), mk([0, 0, 0, 1])],
      clusters: [
        { id: 0, limb: 'head', start: 0, count: 1, center: [0, 0, 0], radius: 1, alive: true },
        { id: 1, limb: 'torso', start: 1, count: 1, center: [0, 0, 0], radius: 1, alive: true },
        { id: 2, limb: 'armL', start: 2, count: 1, center: [0, 0, 0], radius: 1, alive: true },
      ],
      bones: new Map(),
    });
    expect(p.clusterRange[0 * CLUSTER_STRIDE + 3]).toBe(0); // absent orient
    expect(p.clusterRange[1 * CLUSTER_STRIDE + 3]).toBe(1); // real quat
    expect(p.clusterRange[2 * CLUSTER_STRIDE + 3]).toBe(0); // exact identity
  });

  it('reports the largest blendK, which the shader needs as its cull margin', () => {
    expect(packed.maxBlendK).toBe(Math.max(...built.prims.map(p => p.blendK)));
  });

  it('packs the rest rows from the rest body when one is given (task 6)', () => {
    // Two data rows ride alongside the posed endpoints: restA = [a, radius],
    // restB = [b, blendK] of the SAME prim in the authored rest pose.
    const rest = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const shifted = {
      ...rest,
      prims: rest.prims.map(p => ({
        ...p,
        a: [p.a[0] + 1, p.a[1], p.a[2]] as Vec3,
        b: [p.b[0] + 1, p.b[1], p.b[2]] as Vec3,
      })),
    };
    const p = packBody(shifted, rest);
    expect(Array.from(p.restA.slice(0, 4))).toEqual([...rest.prims[0]!.a, rest.prims[0]!.radius].map(f32));
    expect(Array.from(p.restB.slice(0, 4))).toEqual([...rest.prims[0]!.b, rest.prims[0]!.blendK].map(f32));
    // The posed rows carry the shifted endpoints — the two never mix.
    expect(Array.from(p.primA.slice(0, 4))).toEqual([...shifted.prims[0]!.a, shifted.prims[0]!.radius].map(f32));
    // restA.w is the 'written' sentinel: a real radius is always > 0.
    for (let i = 0; i < p.primCount; i++) expect(p.restA[i * PRIM_STRIDE + 3]).toBeGreaterThan(0);
  });

  it('defaults the rest rows to the posed prims (never-rigged bodies)', () => {
    // Crowd statues and chunk views pack no separate rest body; the posed
    // prims double as rest, which keeps their noise anchored exactly as the
    // explicit-rest path would anchor a motionless rig.
    expect(Array.from(packed.restA)).toEqual(Array.from(packed.primA));
    expect(Array.from(packed.restB)).toEqual(Array.from(packed.primB));
  });

  it('packs a missing rest prim as zeros — the shader\'s unwritten sentinel', () => {
    const p = packBody(built, { prims: [], clusters: [], bones: new Map() });
    expect(Array.from(p.restA.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});

it('packs a carve as a negative blend constant', () => {
  const prim = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'head' as const, cluster: 0,
  };
  const p = packBody({
    prims: [prim, { ...prim, op: 'sub' as const }],
    clusters: [{ id: 0, limb: 'head', start: 0, count: 2, center: [0, 0, 0], radius: 0.1, alive: true }],
    bones: new Map(),
  });
  // blendK keeps its magnitude on BOTH; the carve flag rides primScale.w.
  expect(p.primB[3]).toBeCloseTo(0.02, 6);
  expect(p.primB[7]).toBeCloseTo(0.02, 6);
  expect(p.primScale[3]).toBe(0);   // additive
  expect(p.primScale[7]).toBe(1);   // carve
  // The cull margin is a distance, never signed.
  expect(p.maxBlendK).toBeCloseTo(0.02, 6);
  expect(p.carveCount).toBe(1);
});

describe('primColor row', () => {
  it('packs flesh as all zeros, so pre-colour bodies are bit-identical', () => {
    const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const packed = packBody(built);
    let sum = 0;
    for (const v of packed.primColor) sum += Math.abs(v);
    expect(sum).toBe(0);
  });

  // w = 1 + gloss, never 0 for a painted prim: 0 is the shader's "flesh"
  // sentinel, and a black matte prim (rgb 0, gloss 0) would otherwise pack
  // as indistinguishable from no paint at all.
  it('writes linear rgb with w = 1 + gloss, so black matte is still painted', () => {
    const built = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
    const painted = {
      ...built,
      prims: built.prims.map((p, i) =>
        i === 0 ? { ...p, color: [0, 0, 0] as Vec3 } :
        i === 1 ? { ...p, color: [1, 0.2, 0] as Vec3, gloss: 0.8 } : p),
    };
    const c = packBody(painted).primColor;
    expect([...c.slice(0, 4)]).toEqual([0, 0, 0, 1]);
    expect(c[PRIM_STRIDE + 0]).toBeCloseTo(1, 6);
    expect(c[PRIM_STRIDE + 1]).toBeCloseTo(0.2, 6);
    expect(c[PRIM_STRIDE + 3]).toBeCloseTo(1.8, 6);
    expect(c[2 * PRIM_STRIDE + 3]).toBe(0);
  });
});

describe('bound groups (the fold cull unit)', () => {
  const body = () => buildBody(compileBlob(parseBlob(schoolgirlSrc)));

  it('cover every prim of every cluster, contiguously, in fold order', () => {
    const b = body();
    const p = packBody(b);
    // Walk clusters through clusterGroups: each span's groups must tile the
    // cluster's [start, start+count) exactly — fold order is the correctness
    // argument for culling by group at all.
    b.clusters.forEach((c, ci) => {
      const first = p.clusterGroups[ci * 4]!;
      const n = p.clusterGroups[ci * 4 + 1]!;
      let next = c.start;
      for (let g = first; g < first + n; g++) {
        expect(p.groupRange[g * 4]).toBe(next);
        next += p.groupRange[g * 4 + 1]!;
      }
      expect(next).toBe(c.start + c.count);
    });
  });

  it('keeps every group sphere at or under GROUP_RADIUS_MAX unless it is a single prim', () => {
    const p = packBody(body());
    for (let g = 0; g < p.groupCount; g++) {
      if (p.groupRange[g * 4 + 1]! > 1)
        expect(p.groupBounds[g * 4 + 3]).toBeLessThanOrEqual(GROUP_RADIUS_MAX + 1e-6);
    }
  });

  it('contains each member prim inside its group sphere (cull soundness)', () => {
    const b = body();
    const p = packBody(b);
    for (let g = 0; g < p.groupCount; g++) {
      const start = p.groupRange[g * 4]!, n = p.groupRange[g * 4 + 1]!;
      const cx = p.groupBounds[g * 4]!, cy = p.groupBounds[g * 4 + 1]!, cz = p.groupBounds[g * 4 + 2]!, r = p.groupBounds[g * 4 + 3]!;
      for (let i = start; i < start + n; i++) {
        const prim = b.prims[i]!;
        if (prim.op === 'sub') continue; // carves are excluded from the fit, as in clusters
        const reach = Math.max(prim.radius, prim.radiusB ?? prim.radius)
          * Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
        for (const q of [prim.a, prim.b]) {
          const d = Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz);
          expect(d + reach).toBeLessThanOrEqual(r + 1e-6);
        }
      }
    }
  });

  it('singleGroup mirrors the clusters one-to-one (the chunk path)', () => {
    const b = body();
    const p = packBody(b, undefined, { singleGroup: true });
    expect(p.groupCount).toBe(b.clusters.length);
    b.clusters.forEach((c, ci) => {
      expect(p.groupRange[ci * 4]).toBe(c.start);
      expect(p.groupRange[ci * 4 + 1]).toBe(c.count);
      expect(p.groupBounds[ci * 4 + 3]).toBeCloseTo(c.radius, 6);
    });
  });
});

describe('bone prims (wound pass r2)', () => {
  it('encodes op bone as primScale.w = 4', () => {
    const bone: Primitive = {
      a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
      scale: [1, 1, 1], blendK: 0, limb: 'legL', cluster: 0, op: 'bone',
    };
    const flesh: Primitive = { ...bone, radius: 0.08, op: undefined };
    const packed = packBody({
      prims: [flesh, bone],
      clusters: [{ id: 0, limb: 'legL', start: 0, count: 2, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_ADD);
    expect(packed.primScale[PRIM_STRIDE + 3]).toBe(W_BONE);
  });

  it('dead outranks bone, exactly as it outranks carve', () => {
    const bone: Primitive = {
      a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
      scale: [1, 1, 1], blendK: 0, limb: 'legL', cluster: 0,
      op: 'bone', dead: true,
    };
    const packed = packBody({
      prims: [bone],
      clusters: [{ id: 0, limb: 'legL', start: 0, count: 1, center: [0, 0.15, 0], radius: 0.2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_DEAD);
  });
});
