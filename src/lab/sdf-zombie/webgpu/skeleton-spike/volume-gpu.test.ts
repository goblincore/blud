// src/lab/sdf-zombie/webgpu/skeleton-spike/volume-gpu.test.ts
//
// Task 3b host-side tests. Fast by construction: synthetic segment sources
// (sphere fields, ~13³ grids), NOT the full zombie bake (volume.test.ts
// owns that, ~57s). Pins:
//  - packSegmentMeta row layout + segId alignment + overflow ⇒ procedural
//  - sampleAtlasTrilinear (CPU twin of SAMPLE_SEG_VOLUME) parity with
//    sampleSegmentGrid on the same field — validates atlas addressing
//    x + maxNx·(y + maxNy·(z0+z)) and per-segment clamped index pairs
//  - outside-domain ⇒ inside=false + conservative LOWER bound (never an
//    overestimate — hard-min composition would bulge bone through flesh)
//  - writeSegmentPose: live pose rows, sever ⇒ enable=0 same frame
//  - segVolumeToLocal parity with contract toLocal under a rotated pose
//  - WGSL structural pins (the semantic elements the GPU sampler must keep)
import { describe, it, expect } from 'vitest';
import type { BoneFieldSource, Point3, SegmentPose } from './contract';
import { bakeSegmentGrid, buildSegmentAtlas, sampleSegmentGrid } from './volume';
import {
  BONE_SEG_MAX,
  SEG_META_ROW_DIMS,
  SEG_META_ROW_GRID,
  SEG_META_ROW_POSE,
  SEG_META_ROW_QUAT,
  createSegmentAtlasTexture,
  createSegmentMetaTexture,
  packSegmentMeta,
  sampleAtlasTrilinear,
  segVolumeToLocal,
  writeSegmentPose,
} from './volume-gpu';
import { SEG_VOLUME_WGSL } from './volume.wgsl';

/** Synthetic sphere-field source with a mutable pose/live flag. */
function fakeSource(opts: {
  segment: string;
  center?: Point3;
  radius?: number;
  boundsHalf?: number;
  pose?: SegmentPose;
}): BoneFieldSource & { setLive(b: boolean): void; setPose(p: SegmentPose): void } {
  const c = opts.center ?? [0, 0, 0];
  const r = opts.radius ?? 0.05;
  const bh = opts.boundsHalf ?? 0.06;
  let live = true;
  let pose: SegmentPose = opts.pose ?? { origin: [1, 2, 3], quat: [0, 0, 0, 1] };
  const src: BoneFieldSource & { setLive(b: boolean): void; setPose(p: SegmentPose): void } = {
    character: 'synthetic',
    segment: opts.segment,
    revision: `synthetic:${opts.segment}:1:abc`,
    bounds: {
      min: [c[0]! - bh, c[1]! - bh, c[2]! - bh],
      max: [c[0]! + bh, c[1]! + bh, c[2]! + bh],
    },
    distance: (p: Point3) => Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!, p[2]! - c[2]!) - r,
    rigidity: 'rigid',
    primCount: 1,
    pose: () => pose,
    toLocal(p: Point3) {
      const q = pose.quat, o = pose.origin;
      return segVolumeToLocal(p, q, o);
    },
    toWorld(p: Point3) {
      const { origin, quat } = pose;
      const [ux, uy, uz, s] = quat as [number, number, number, number];
      const dt = ux * p[0]! + uy * p[1]! + uz * p[2]!;
      const uu = ux * ux + uy * uy + uz * uz;
      const cx = uy * p[2]! - uz * p[1]!, cy = uz * p[0]! - ux * p[2]!, cz = ux * p[1]! - uy * p[0]!;
      return [
        origin[0]! + 2 * dt * ux + (s * s - uu) * p[0]! + 2 * s * cx,
        origin[1]! + 2 * dt * uy + (s * s - uu) * p[1]! + 2 * s * cy,
        origin[2]! + 2 * dt * uz + (s * s - uu) * p[2]! + 2 * s * cz,
      ];
    },
    poseEndpointError: () => 0,
    isLive: () => live,
    setLive(b: boolean) { live = b; },
    setPose(p: SegmentPose) { pose = p; },
  };
  return src;
}

const CELL = 0.01;

function makeAtlas() {
  const a = fakeSource({ segment: 'axial:0-1' });
  const b = fakeSource({ segment: 'limb:armL:7-9', center: [0.01, -0.01, 0.02], radius: 0.03 });
  const ga = bakeSegmentGrid(a, CELL);
  const gb = bakeSegmentGrid(b, CELL);
  const atlas = buildSegmentAtlas([
    { segId: 1, grid: ga },
    { segId: 3, grid: gb },
  ]);
  return { a, b, ga, gb, atlas };
}

describe('packSegmentMeta', () => {
  it('writes grid/dims rows aligned to segId, leaves other ids zero', () => {
    const { ga, gb, atlas } = makeAtlas();
    const meta = packSegmentMeta(atlas);
    expect(meta.length).toBe(BONE_SEG_MAX * 4 * 4);
    const g1 = (SEG_META_ROW_GRID * BONE_SEG_MAX + 1) * 4;
    // meta is Float32 (as the GPU will read it) — compare at f32 precision.
    [...ga.origin, CELL].forEach((v, k) => expect(meta[g1 + k]!).toBeCloseTo(v, 6));
    const d3 = (SEG_META_ROW_DIMS * BONE_SEG_MAX + 3) * 4;
    expect([...meta.slice(d3, d3 + 4)]).toEqual([...gb.dims, atlas.metas[1]!.z0]);
    // z0 stacking: second grid starts where the first ended.
    expect(atlas.metas[1]!.z0).toBe(ga.dims[2]);
    // An id with no grid: all rows zero ⇒ enable 0 ⇒ procedural fold.
    const p5 = (SEG_META_ROW_POSE * BONE_SEG_MAX + 5) * 4;
    expect([...meta.slice(p5, p5 + 4)]).toEqual([0, 0, 0, 0]);
    expect(SEG_META_ROW_GRID).toBe(0);
  });
});

describe('sampleAtlasTrilinear (CPU twin of SAMPLE_SEG_VOLUME)', () => {
  it('matches sampleSegmentGrid in-domain (atlas addressing parity)', () => {
    const { gb, atlas } = makeAtlas();
    const meta = packSegmentMeta(atlas);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const p: Point3 = [
        gb.origin[0]! + Math.random() * (gb.dims[0] - 1) * gb.spacing,
        gb.origin[1]! + Math.random() * (gb.dims[1] - 1) * gb.spacing,
        gb.origin[2]! + Math.random() * (gb.dims[2] - 1) * gb.spacing,
      ];
      const ref = sampleSegmentGrid(gb, p);
      const got = sampleAtlasTrilinear(atlas, meta, 3, p);
      expect(got.inside).toBe(ref.inside);
      worst = Math.max(worst, Math.abs(got.d - ref.d));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('never reads a neighbour slice: segment 1 samples are independent of segment 3 content', () => {
    const { ga, atlas } = makeAtlas();
    const meta = packSegmentMeta(atlas);
    // A query half a cell below the top z-edge of segment 1's grid clamps
    // its index pair WITHIN segment 1 (z0 = nz-2, never zBase+nz), not
    // bleeding into segment 3's first slice. (Half-cell margin: the f32
    // meta domain boundary differs from the f64 grid's by ~1 ulp.)
    const p: Point3 = [
      ga.origin[0]! + 0.5 * ga.spacing,
      ga.origin[1]! + 0.5 * ga.spacing,
      ga.origin[2]! + (ga.dims[2] - 1.5) * ga.spacing,
    ];
    const got = sampleAtlasTrilinear(atlas, meta, 1, p);
    const ref = sampleSegmentGrid(ga, p);
    expect(got.inside).toBe(true);
    expect(got.d).toBeCloseTo(ref.d, 6);
  });

  it('outside-domain: inside=false and d is a conservative LOWER bound', () => {
    const { a, ga, atlas } = makeAtlas();
    const meta = packSegmentMeta(atlas);
    for (let i = 0; i < 500; i++) {
      const p: Point3 = [
        ga.origin[0]! - 0.02 - Math.random() * 0.1,
        ga.origin[1]! + Math.random() * 0.1,
        ga.origin[2]! + Math.random() * 0.1,
      ];
      const got = sampleAtlasTrilinear(atlas, meta, 1, p);
      expect(got.inside).toBe(false);
      // Lower bound: never above the exact procedural distance (an
      // overestimate is the bulge-through-flesh failure).
      expect(got.d).toBeLessThanOrEqual(a.distance(p) + 1e-6);
    }
  });
});

describe('writeSegmentPose', () => {
  it('writes live pose rows and clears enable on sever / missing source', () => {
    const { a, b, atlas } = makeAtlas();
    const meta = packSegmentMeta(atlas);
    const poseA: SegmentPose = { origin: [0.5, -0.25, 2], quat: [0, 0.3826834, 0, 0.9238795] };
    a.setPose(poseA);
    writeSegmentPose(meta, atlas, [a, b]);
    const q1 = (SEG_META_ROW_QUAT * BONE_SEG_MAX + 1) * 4;
    const p1 = (SEG_META_ROW_POSE * BONE_SEG_MAX + 1) * 4;
    [...poseA.quat].forEach((v, k) => expect(meta[q1 + k]!).toBeCloseTo(v, 6));
    [...poseA.origin, 1].forEach((v, k) => expect(meta[p1 + k]!).toBeCloseTo(v, 6));
    // Sever b ⇒ enable cleared the same frame.
    b.setLive(false);
    writeSegmentPose(meta, atlas, [a, b]);
    const p3 = (SEG_META_ROW_POSE * BONE_SEG_MAX + 3) * 4;
    expect(meta[p3 + 3]).toBe(0);
    // A meta whose source vanished entirely (e.g. anatomy re-derive
    // mismatch) also disables.
    writeSegmentPose(meta, atlas, [a]);
    expect(meta[p3 + 3]).toBe(0);
  });

  it('segVolumeToLocal matches contract toLocal under a rotated pose', () => {
    const pose: SegmentPose = { origin: [0.3, -0.7, 1.1], quat: [0.1825742, 0.3651484, 0.5477226, 0.7302967] };
    const s = fakeSource({ segment: 'head', pose });
    for (let i = 0; i < 100; i++) {
      const p: Point3 = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
      const viaContract = s.toLocal(p);
      const viaTwin = segVolumeToLocal(p, pose.quat, pose.origin);
      for (let k = 0; k < 3; k++) expect(viaTwin[k]!).toBeCloseTo(viaContract[k]!, 7);
      // And toWorld∘toLocal is identity.
      const back = s.toWorld(viaContract);
      for (let k = 0; k < 3; k++) expect(back[k]!).toBeCloseTo(p[k]!, 7);
    }
  });
});

describe('texture construction (CPU-side, three Data3DTexture precedent)', () => {
  it('builds an r32float-style 3D atlas texture + a BONE_SEG_MAX×4 meta texture', () => {
    const { atlas } = makeAtlas();
    const tex = createSegmentAtlasTexture(atlas);
    expect([tex.image.width, tex.image.height, tex.image.depth]).toEqual([...atlas.dims]);
    expect(tex.image.data).toBe(atlas.data);
    tex.dispose();
    const meta = packSegmentMeta(atlas);
    const mtex = createSegmentMetaTexture(meta);
    expect([mtex.image.width, mtex.image.height]).toEqual([BONE_SEG_MAX, 4]);
    expect(mtex.image.data).toBe(meta);
    mtex.dispose();
  });
});

describe('SEG_VOLUME_WGSL structural pins', () => {
  it('keeps the semantic elements the GPU sampler contract requires', () => {
    // Manual trilinear over an unfilterable r32float atlas…
    expect(SEG_VOLUME_WGSL).toContain('textureLoad(atlas');
    expect(SEG_VOLUME_WGSL).toContain('texture_3d<f32>');
    // …clamped index pairs (never a neighbour's texel)…
    expect(SEG_VOLUME_WGSL).toContain('nx - 2');
    // …inside/fallback signalling…
    expect(SEG_VOLUME_WGSL).toContain('inside = false');
    // …the conservative Lipschitz lower bound for outside queries…
    expect(SEG_VOLUME_WGSL).toContain('length(pLocal - q) - h');
    // …and the enable gate (organs/severed/missing ⇒ procedural).
    expect(SEG_VOLUME_WGSL).toContain('poseMeta.w < 0.5');
  });
});
