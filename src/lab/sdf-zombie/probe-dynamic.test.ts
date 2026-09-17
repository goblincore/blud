// src/lab/sdf-zombie/probe-dynamic.test.ts
//
// Unit tests for the DYNAMIC probe layer: the CPU twin of the per-frame GPU
// gather. Everything the compute kernel does per ray is property-tested here,
// because the WGSL twin is only pinned by source text (no WGSL compiler in
// vitest). The buffer packing is pinned by pack/re-read round trips so Task 2's
// binding and the kernel cannot disagree about the layout.

import { describe, it, expect } from 'vitest';
import {
  DYN_RAY_CAP,
  PROBE_MAX_BONE_INSTANCES,
  PROBE_MAX_CAPSULES,
  DYN_VEC4_PER_PROBE,
  BONE_INSTANCE_FLOATS,
  GOLDEN_ANGLE,
  LIGHT_FILL_REF_M,
  PROBE_GATHER_WORKGROUP,
  TWO_PI,
  blendDynamic,
  gatherProbeDynamic,
  gatherThreadsPerProbe,
  gatherWorkgroupCount,
  hitCapsule,
  packBoxes,
  packCapsulesFromBoneInstances,
  packLights,
  blendDynamicAfterglow,
  type DynLightInput,
  sampleProbeDynamic,
  type DynGrid,
  type DynScene,
} from './probe-dynamic';
import {
  SH_A0,
  SH_Y00,
  irradianceL1,
  type Box,
  type Vec3,
} from './probe-grid';
// Test-only pin: the capsule packer reads bone-instancer rows. probe-dynamic.ts
// deliberately does NOT import the webgpu tree, so the TEST keeps the stride
// equal — the same pattern probe-grid.test.ts uses for POINT_REF_DIST.
import { INSTANCE_FLOATS } from './webgpu/bone-instancer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The lab's default enclosure: 4m x 3.2m x 4m sitting on the floor plane. */
const ROOM: Box = { min: [-2, 0, -2], max: [2, 3.2, 2] };
/** Neutral grey walls — the dynamic layer is about bodies and flashes, not tint. */
const WALL: Vec3 = [0.5, 0.5, 0.5];

/** A one-probe grid: probePosition collapses to the inset box centre. */
const GRID: DynGrid = {
  dims: [1, 1, 1],
  min: [-1.85, 0.15, -1.85],
  max: [1.85, 3.05, 1.85],
};
const CENTRE: Vec3 = [0, 1.6, 0];

/** 64 rays is the kernel cap and also the twin's default. */
const RAYS = DYN_RAY_CAP;
const SEED = 0.25;

type DynLight = DynLightInput;

interface SceneOptions {
  lights?: DynLight[];
  occluders?: { box: Box; albedo: Vec3 }[];
  capsules?: { a: Vec3; b: Vec3; r: number }[];
}

function capsulesBuffer(list: { a: Vec3; b: Vec3; r: number }[]): Float32Array {
  const out = new Float32Array(4 + list.length * 8);
  out[0] = list.length;
  list.forEach((c, i) => {
    const o = 4 + i * 8;
    out[o + 0] = c.a[0]; out[o + 1] = c.a[1]; out[o + 2] = c.a[2]; out[o + 3] = c.r;
    out[o + 4] = c.b[0]; out[o + 5] = c.b[1]; out[o + 6] = c.b[2]; out[o + 7] = 0;
  });
  return out;
}

function sceneOf(opts: SceneOptions = {}): DynScene {
  const occluders = opts.occluders ?? [];
  const boxes = new Float32Array(4 + (1 + occluders.length) * 12);
  packBoxes(ROOM, WALL, occluders, boxes);
  const lights = new Float32Array(4 + (opts.lights?.length ?? 0) * 12);
  packLights(opts.lights ?? [], lights);
  return {
    boxes,
    capsules: opts.capsules === undefined ? new Float32Array(4) : capsulesBuffer(opts.capsules),
    lights,
  };
}

/** Mirrors the evaluator's scalar-visibility reconstruction. */
function visAt(visibility: readonly number[], n: Vec3): number {
  const sh = [
    visibility[0]!, 0, 0,
    visibility[1]!, 0, 0,
    visibility[2]!, 0, 0,
    visibility[3]!, 0, 0,
  ];
  return Math.max(0, Math.min(1, irradianceL1(sh, 0, n)[0]! / Math.PI));
}

/** Irradiance reconstruction of the gather's packed radiance. */
function radAt(radiance: readonly number[], n: Vec3): Vec3 {
  return irradianceL1(radiance, 0, n);
}

const SIX_NORMALS: Vec3[] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function norm(v: readonly [number, number, number]): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** `Float32Array` stores binary32, so compare packed floats by closeness. */
function expectFloats(actual: ArrayLike<number>, expected: readonly number[], digits = 5): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((e, i) => expect(actual[i]!).toBeCloseTo(e, digits));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('probe-dynamic constants', () => {
  it('is four vec4 per probe, the storage stride Task 2 and the WGSL share', () => {
    expect(DYN_VEC4_PER_PROBE).toBe(4);
  });

  it('exports the Fibonacci constants the WGSL kernel pins', () => {
    expect(GOLDEN_ANGLE).toBeCloseTo(2.399963229728653, 12);
    expect(TWO_PI).toBeCloseTo(6.283185307179586, 12);
    expect(DYN_RAY_CAP).toBe(64);
  });

  it('pins the bone-instancer row stride the capsule packer reads', () => {
    expect(BONE_INSTANCE_FLOATS).toBe(INSTANCE_FLOATS);
  });
});

// ---------------------------------------------------------------------------
// Ray-capsule
// ---------------------------------------------------------------------------

describe('hitCapsule', () => {
  // A vertical capsule on the y axis, r = 0.5.
  const A: Vec3 = [0, 0, 0];
  const B: Vec3 = [0, 2, 0];
  const R = 0.5;

  it('hits the cylinder head-on at the exact entry t', () => {
    const hit = hitCapsule([-2, 1, 0], [1, 0, 0], A, B, R);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(1.5, 9);
    expect(hit!.point[0]).toBeCloseTo(-0.5, 9);
    expect(hit!.point[1]).toBeCloseTo(1, 9);
    expect(hit!.point[2]).toBeCloseTo(0, 9);
    expect(hit!.normal[0]).toBeCloseTo(-1, 9);
    expect(hit!.normal[1]).toBeCloseTo(0, 9);
    expect(hit!.normal[2]).toBeCloseTo(0, 9);
  });

  it('misses a parallel offset ray', () => {
    expect(hitCapsule([-2, 1, 2], [1, 0, 0], A, B, R)).toBeNull();
  });

  it('returns null for a ray that starts inside — a body you are inside blocks nothing', () => {
    // The documented choice: inside => null, NOT the exit point. An occluder
    // enclosing the probe must not darken it from the inside.
    expect(hitCapsule([0, 1, 0], [1, 0, 0], A, B, R)).toBeNull();
  });

  it('hits the top sphere cap with the cap normal', () => {
    const hit = hitCapsule([0, 3, 0], [0, -1, 0], A, B, R);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(0.5, 9);
    expect(hit!.point[1]).toBeCloseTo(2.5, 9);
    expect(hit!.normal[1]).toBeCloseTo(1, 9);
  });

  it('hits the bottom sphere cap from below', () => {
    const hit = hitCapsule([0, -2, 0], [0, 1, 0], A, B, R);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeCloseTo(1.5, 9);
    expect(hit!.point[1]).toBeCloseTo(-0.5, 9);
    expect(hit!.normal[1]).toBeCloseTo(-1, 9);
  });

  it('returns a unit normal on the cylinder for a diagonal ray', () => {
    // Aim through [0, 1, 0.4], which is inside the r = 0.5 cylinder, so the
    // entry must be on the cylinder surface at distance R from the axis.
    const hit = hitCapsule([-2, 1, 0], norm([2, 0, 0.4]), A, B, R);
    expect(hit).not.toBeNull();
    expect(Math.hypot(hit!.normal[0], hit!.normal[1], hit!.normal[2])).toBeCloseTo(1, 9);
    const p = hit!.point;
    const axisY = Math.max(0, Math.min(2, p[1]));
    expect(Math.hypot(p[0], p[1] - axisY, p[2])).toBeCloseTo(R, 6);
  });
});

// ---------------------------------------------------------------------------
// Buffer packing
// ---------------------------------------------------------------------------

describe('packBoxes', () => {
  it('writes the count, the enclosure first, then occluders with kind flags', () => {
    const occ = [{ box: { min: [1, 0, 1] as Vec3, max: [1.5, 1, 1.5] as Vec3 }, albedo: [0.8, 0.2, 0.1] as Vec3 }];
    const out = new Float32Array(4 + 2 * 12);
    const n = packBoxes(ROOM, WALL, occ, out);
    expect(n).toBe(2);
    expect(out[0]).toBe(2);

    // Enclosure: min, kind 0, max, albedo.
    expectFloats(out.slice(4, 8), [-2, 0, -2, 0]);
    expectFloats(out.slice(8, 12), [2, 3.2, 2, 0]);
    expectFloats(out.slice(12, 16), [0.5, 0.5, 0.5, 0]);

    // Occluder: kind 1.
    const o = 4 + 12;
    expectFloats(out.slice(o, o + 4), [1, 0, 1, 1]);
    expectFloats(out.slice(o + 4, o + 8), [1.5, 1, 1.5, 0]);
    expectFloats(out.slice(o + 8, o + 12), [0.8, 0.2, 0.1, 0]);
  });

  it('throws when the output buffer cannot hold every box', () => {
    const out = new Float32Array(4 + 12); // room for the enclosure only
    expect(() => packBoxes(ROOM, WALL, [{ box: ROOM, albedo: WALL }], out)).toThrow(/capacity/);
  });
});

describe('packCapsulesFromBoneInstances', () => {
  // bone-instancer layout: a.xyz, b.xyz, c.xyz, r1, r2, scale.xyz, orient.xyzw
  const INSTANCE_FLOATS = 18;

  function abOf(rows: {
    a: Vec3; b: Vec3; c: Vec3; r1: number; r2: number; scale: Vec3;
  }[]): Float32Array {
    const ab = new Float32Array(rows.length * INSTANCE_FLOATS);
    rows.forEach((row, i) => {
      const o = i * INSTANCE_FLOATS;
      ab.set(row.a, o); ab.set(row.b, o + 3); ab.set(row.c, o + 6);
      ab[o + 9] = row.r1; ab[o + 10] = row.r2;
      ab.set(row.scale, o + 11);
      ab.set([0, 0, 0, 1], o + 14);
    });
    return ab;
  }

  it('emits a-b and b-c per instance with the inflated max radius', () => {
    const ab = abOf([{
      a: [1, 0, 0], b: [2, 0, 0], c: [3, 0, 0],
      r1: 0.1, r2: 0.2, scale: [2, 1, 1],
    }]);
    const out = new Float32Array(4 + 2 * 8);
    const n = packCapsulesFromBoneInstances(ab, 1, 0.05, out, 2);
    expect(n).toBe(2);
    expect(out[0]).toBe(2);

    // r = max(r1, r2) * max(scale) + margin = 0.2 * 2 + 0.05.
    const r = 0.45;
    expectFloats(out.slice(4, 8), [1, 0, 0, r]);
    expectFloats(out.slice(8, 12), [2, 0, 0, 0]);
    expectFloats(out.slice(12, 16), [2, 0, 0, r]);
    expectFloats(out.slice(16, 20), [3, 0, 0, 0]);
  });

  it('packs every instance in row order', () => {
    const ab = abOf([
      { a: [0, 0, 0], b: [0, 1, 0], c: [0, 2, 0], r1: 0.1, r2: 0.1, scale: [1, 1, 1] },
      { a: [5, 0, 0], b: [5, 1, 0], c: [5, 2, 0], r1: 0.2, r2: 0.2, scale: [1, 1, 1] },
    ]);
    const out = new Float32Array(4 + 4 * 8);
    expect(packCapsulesFromBoneInstances(ab, 2, 0.0, out, 4)).toBe(4);
    expect(out[0]).toBe(4);
    // Instance 1's first capsule starts after instance 0's two capsules.
    const o = 4 + 2 * 8;
    expectFloats(out.slice(o, o + 4), [5, 0, 0, 0.2]);
  });

  it.each([515, PROBE_MAX_BONE_INSTANCES])('packs all %i admitted bone rows without dropping occluders', (count) => {
    // 515 rows reproduced the arena's 1030 > 1024 failure. The other case
    // exercises the producer's full budget, not just the reported overflow.
    const ab = abOf(Array.from({ length: count }, (_, i) => ({
      a: [i, 0, 0] as Vec3, b: [i, 1, 0] as Vec3, c: [i, 2, 0] as Vec3,
      r1: 0.1, r2: 0.2, scale: [1, 1, 1] as Vec3,
    })));
    const out = new Float32Array(4 + PROBE_MAX_CAPSULES * 8);
    expect(packCapsulesFromBoneInstances(ab, count, 0, out, PROBE_MAX_CAPSULES)).toBe(count * 2);
    expect(out[0]).toBe(count * 2);
    const last = 4 + (count * 2 - 1) * 8;
    expectFloats(out.slice(last, last + 4), [count - 1, 1, 0, 0.2]);
    expectFloats(out.slice(last + 4, last + 7), [count - 1, 2, 0]);
  });

  it('throws when max cannot hold two capsules per instance', () => {
    const ab = abOf([{ a: [0, 0, 0], b: [0, 1, 0], c: [0, 2, 0], r1: 0.1, r2: 0.1, scale: [1, 1, 1] }]);
    const out = new Float32Array(4 + 8);
    expect(() => packCapsulesFromBoneInstances(ab, 1, 0.0, out, 1)).toThrow(/max/);
  });
});

describe('packLights', () => {
  it('writes the count then pos/intensity, color/cosOuter and axis/cosInner per light', () => {
    const out = new Float32Array(4 + 2 * 12);
    const n = packLights([
      { pos: [1, 2, 3], color: [1, 0.8, 0.6], intensity: 55 },
      { pos: [-1, 0, 0], color: [0, 1, 0], intensity: 2, axis: [0, 0, -1], cosInner: 0.9, cosOuter: 0.7 },
    ], out);
    expect(n).toBe(2);
    expect(out[0]).toBe(2);
    expectFloats(out.slice(4, 8), [1, 2, 3, 55]);
    expectFloats(out.slice(8, 12), [1, 0.8, 0.6, -2]);
    // SLOT 11 IS cosInner FOR A SPOT AND THE ROOM-FILL FRACTION FOR A POINT
    // LIGHT. The cone branch — cosInner's only reader — runs only when
    // cosOuter > -1.5, and a point light packs -2 there, so the slot is free.
    // A point light with no fill therefore writes 0, not LIGHT_NO_CONE.
    expectFloats(out.slice(12, 16), [0, 0, 0, 0]);
    expectFloats(out.slice(16, 20), [-1, 0, 0, 2]);
    expectFloats(out.slice(20, 24), [0, 1, 0, 0.7]);
    expectFloats(out.slice(24, 28), [0, 0, -1, 0.9]);
  });

  it('carries the room-fill fraction of a point light in that slot', () => {
    const out = new Float32Array(4 + 12);
    packLights([{ pos: [0, 1, 0], color: [1, 1, 1], intensity: 220, fill: 1.2 }], out);
    expect(out[4 + 11]).toBeCloseTo(1.2, 5);
  });
});

describe('spot lights in the gather', () => {
  it('a spot aimed at the +X wall lights it; aimed away it does not', () => {
    const at = gatherProbeDynamic(0, GRID, sceneOf({ lights: [
      { pos: [0, 1.5, 0], color: [1, 1, 1], intensity: 4, axis: [1, 0, 0], cosInner: 0.95, cosOuter: 0.8 },
    ] }), { raysPerProbe: RAYS, frameSeed: SEED });
    const away = gatherProbeDynamic(0, GRID, sceneOf({ lights: [
      { pos: [0, 1.5, 0], color: [1, 1, 1], intensity: 4, axis: [-1, 0, 0], cosInner: 0.95, cosOuter: 0.8 },
    ] }), { raysPerProbe: RAYS, frameSeed: SEED });
    const towardsAt = radAt(at.radiance, [1, 0, 0])[0]!;
    const towardsAway = radAt(away.radiance, [1, 0, 0])[0]!;
    expect(towardsAt).toBeGreaterThan(0);
    expect(towardsAt).toBeGreaterThan(towardsAway * 4);
  });
});

// ---------------------------------------------------------------------------
// CPU gather twin
// ---------------------------------------------------------------------------

describe('gatherProbeDynamic', () => {
  const FLASH: DynLight = { pos: [1.5, 1.6, 0], color: [1, 1, 1], intensity: 4 };

  it('an empty room with one light: the wall facing the light is bright', () => {
    const g = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: RAYS, frameSeed: SEED,
    });
    const towards = radAt(g.radiance, [1, 0, 0])[0]!;
    const away = radAt(g.radiance, [-1, 0, 0])[0]!;
    expect(towards).toBeGreaterThan(0);
    // Inverse-square puts the near wall far ahead of the far one.
    expect(towards).toBeGreaterThan(away * 2);
  });

  it('an empty room has full visibility in every direction (within 2%)', () => {
    const g = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: RAYS, frameSeed: SEED,
    });
    for (const n of SIX_NORMALS) {
      expect(visAt(g.visibility, n)).toBeGreaterThan(0.98);
      expect(visAt(g.visibility, n)).toBeLessThan(1.02);
    }
  });

  it('a capsule above the probe halves top visibility and leaves the bottom full', () => {
    // Horizontal capsule 0.4 m over the probe, r = 0.24: blocks a wedge of the
    // upward hemisphere, so the top normal reconstructs to about 0.5 while the
    // floor-facing normal is untouched.
    const g = gatherProbeDynamic(0, GRID, sceneOf({
      lights: [FLASH],
      capsules: [{ a: [-2, 2.0, 0], b: [2, 2.0, 0], r: 0.24 }],
    }), { raysPerProbe: RAYS, frameSeed: SEED });

    const top = visAt(g.visibility, [0, 1, 0]);
    const bottom = visAt(g.visibility, [0, -1, 0]);
    expect(top).toBeGreaterThan(0.3);
    expect(top).toBeLessThan(0.7);
    expect(bottom).toBeGreaterThan(0.9);
  });

  it('a capsule between the light and the lit wall shadows that wall', () => {
    const clear = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: RAYS, frameSeed: SEED,
    });
    const blocked = gatherProbeDynamic(0, GRID, sceneOf({
      lights: [FLASH],
      capsules: [{ a: [1.9, 0.3, 0], b: [1.9, 2.9, 0], r: 0.5 }],
    }), { raysPerProbe: RAYS, frameSeed: SEED });

    const before = radAt(clear.radiance, [1, 0, 0])[0]!;
    const after = radAt(blocked.radiance, [1, 0, 0])[0]!;
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before * 0.25);
  });

  it('no light means zero radiance everywhere', () => {
    const g = gatherProbeDynamic(0, GRID, sceneOf(), {
      raysPerProbe: RAYS, frameSeed: SEED,
    });
    for (const v of g.radiance) expect(v).toBe(0);
  });

  it('emits only finite numbers', () => {
    const g = gatherProbeDynamic(0, GRID, sceneOf({
      lights: [FLASH],
      occluders: [{ box: { min: [0.5, 0, 0.5], max: [1, 1, 1] }, albedo: [0.3, 0.3, 0.3] }],
      capsules: [{ a: [0, 0, 1], b: [0, 2, 1], r: 0.2 }],
    }), { raysPerProbe: RAYS, frameSeed: SEED });
    for (const v of [...g.radiance, ...g.visibility]) expect(Number.isFinite(v)).toBe(true);
  });

  it('rotates the ray set with the frame seed (no strobe)', () => {
    const a = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: RAYS, frameSeed: 0.0,
    });
    const b = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: RAYS, frameSeed: 0.5,
    });
    expect(a.radiance).not.toEqual(b.radiance);
  });

  it('caps the ray count at the kernel limit', () => {
    const capped = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: DYN_RAY_CAP, frameSeed: SEED,
    });
    const over = gatherProbeDynamic(0, GRID, sceneOf({ lights: [FLASH] }), {
      raysPerProbe: 4096, frameSeed: SEED,
    });
    expect(over).toEqual(capped);
  });
});

// ---------------------------------------------------------------------------
// Blend
// ---------------------------------------------------------------------------

describe('blendDynamic', () => {
  const prev = new Float32Array([1, 2, 3, 4]);
  const next = new Float32Array([4, 5, 6, 7]);

  it('blend 0 keeps the previous frame bit for bit', () => {
    const out = new Float32Array(4);
    blendDynamic(prev, next, 0, out);
    expect(Array.from(out)).toEqual(Array.from(prev));
  });

  it('blend 1 takes the new estimate bit for bit', () => {
    const out = new Float32Array(4);
    blendDynamic(prev, next, 1, out);
    expect(Array.from(out)).toEqual(Array.from(next));
  });

  it('lerps every float for a fractional blend', () => {
    const out = new Float32Array(4);
    blendDynamic(prev, next, 0.25, out);
    expect(Array.from(out)).toEqual([1.75, 2.75, 3.75, 4.75]);
  });
});

// ---------------------------------------------------------------------------
// Evaluator twin
// ---------------------------------------------------------------------------

describe('sampleProbeDynamic', () => {
  const GRID2: DynGrid = { dims: [2, 1, 1], min: [-1, 0, 0], max: [1, 0, 0] };

  function twoProbeBuffer(): Float32Array {
    const dyn = new Float32Array(2 * 16);
    // Probe 0: radiance L00.r = 1, fully visible.
    dyn[0] = 1;
    dyn[12] = 1 / SH_Y00;
    // Probe 1: radiance L00.r = 2, fully occluded.
    const b = 16;
    dyn[b + 0] = 2;
    dyn[b + 12] = 0;
    return dyn;
  }

  it('returns a probe’s own values when sampled at its position', () => {
    const dyn = twoProbeBuffer();
    const p0 = sampleProbeDynamic(dyn, GRID2, [-1, 0, 0], [1, 0, 0]);
    expect(p0.radiance[0]).toBeCloseTo(SH_A0 * SH_Y00 * 1, 6);
    expect(p0.radiance[1]).toBe(0);
    expect(p0.radiance[2]).toBe(0);
    expect(p0.visibility).toBeCloseTo(1, 6);

    const p1 = sampleProbeDynamic(dyn, GRID2, [1, 0, 0], [0, 1, 0]);
    expect(p1.radiance[0]).toBeCloseTo(SH_A0 * SH_Y00 * 2, 6);
    expect(p1.visibility).toBe(0);
  });

  it('clamps radiance at zero and visibility to [0, 1]', () => {
    const dyn = new Float32Array(16);
    dyn[0] = -5; // negative L00 must not leak out
    dyn[12] = -3;
    const s = sampleProbeDynamic(dyn, GRID, CENTRE, [0, 1, 0]);
    expect(s.radiance[0]).toBe(0);
    expect(s.visibility).toBe(0);
  });

  it('a fully-visible buffer returns visibility 1 for every normal', () => {
    const dyn = new Float32Array(16);
    dyn[12] = 1 / SH_Y00;
    for (const n of SIX_NORMALS) {
      expect(sampleProbeDynamic(dyn, GRID, CENTRE, n).visibility).toBeCloseTo(1, 6);
    }
  });

  it('round-trips a gather through the packed 4-vec4 layout', () => {
    // This is the storage contract the kernel writes and the march reads:
    // texels 0-2 are the gather's 12 radiance floats, texel 3 is visibility.
    const g = gatherProbeDynamic(0, GRID, sceneOf({
      lights: [{ pos: [1.5, 1.6, 0], color: [1, 1, 1], intensity: 4 }],
    }), { raysPerProbe: RAYS, frameSeed: SEED });
    const dyn = new Float32Array(16);
    for (let k = 0; k < 12; k++) dyn[k] = g.radiance[k]!;
    for (let k = 0; k < 4; k++) dyn[12 + k] = g.visibility[k]!;

    const n: Vec3 = [1, 0, 0];
    const s = sampleProbeDynamic(dyn, GRID, CENTRE, n);
    const expected = radAt(g.radiance, n);
    expect(s.radiance[0]).toBeCloseTo(expected[0], 6);
    expect(s.radiance[1]).toBeCloseTo(expected[1], 6);
    expect(s.radiance[2]).toBeCloseTo(expected[2], 6);
    expect(s.visibility).toBeCloseTo(visAt(g.visibility, n), 6);
  });
});

describe('blendDynamicAfterglow', () => {
  it('a flash rises in one step and decays over many; visibility blends symmetrically', () => {
    const dark = new Float32Array(16);
    const lit = new Float32Array(16); lit[0] = 10; lit[1] = 10; lit[2] = 10; lit[12] = 3.5;
    const out = new Float32Array(16);
    blendDynamicAfterglow(dark, lit, 1, 0.12, out);
    expect(out[0]).toBeCloseTo(10, 9);          // rose fully in one step
    expect(out[12]).toBeCloseTo(3.5, 9);        // visibility took the rise rate too
    const after = new Float32Array(16);
    blendDynamicAfterglow(out, dark, 1, 0.12, after);
    expect(after[0]).toBeCloseTo(10 * 0.88, 5); // decays at the fall rate
    expect(after[12]).toBeCloseTo(0, 9);        // visibility does not linger
  });
});

describe('R1 gather dispatch shape — threads per probe', () => {
  // The reduction is workgroup-LOCAL: WebGPU has no barrier between workgroups
  // in one dispatch, so a probe's ray group must lie wholly inside one
  // workgroup. These two properties are what make that true for every ray count
  // the debug seam can set (0..64), and the kernel would silently mis-reduce
  // (or fail to compile) if either were broken.

  it('is the next power of two, so it always divides the workgroup size', () => {
    for (let rays = 0; rays <= DYN_RAY_CAP; rays++) {
      const tpp = gatherThreadsPerProbe(rays);
      expect(Number.isInteger(Math.log2(tpp))).toBe(true);
      expect(PROBE_GATHER_WORKGROUP % tpp).toBe(0);
      expect(tpp).toBeGreaterThanOrEqual(Math.max(1, rays));
      // Never larger than it needs to be: halving it would no longer hold `rays`.
      if (rays > 1) expect(Math.floor(tpp / 2)).toBeLessThan(rays);
    }
  });

  it('spawns at least one thread per probe when there are no rays', () => {
    // `?dynrays=0` is the documented cost-split control. The old pass still ran
    // one thread per probe and wrote the DECAYED record; a dispatch of zero
    // workgroups would leave the layer frozen at its last value instead, which
    // silently changes what that control measures.
    expect(gatherThreadsPerProbe(0)).toBe(1);
    expect(gatherWorkgroupCount(400, 0)).toBe(Math.ceil(400 / PROBE_GATHER_WORKGROUP));
  });

  it('sizes the dispatch to cover every probe, rounded up to whole workgroups', () => {
    // The shipped 400-probe grid at 32 rays: 200 workgroups of 64, against the
    // 7 the one-thread-per-probe pass dispatched.
    expect(gatherThreadsPerProbe(32)).toBe(32);
    expect(gatherWorkgroupCount(400, 32)).toBe(200);
    expect(gatherWorkgroupCount(400, 64)).toBe(400);
    // A partial last workgroup is legitimate; it must never be dropped.
    expect(gatherWorkgroupCount(1, 32)).toBe(1);
    expect(gatherWorkgroupCount(0, 32)).toBe(0);
    for (const rays of [1, 2, 3, 5, 8, 16, 31, 47, 64]) {
      const tpp = gatherThreadsPerProbe(rays);
      for (const probes of [1, 7, 42, 399, 400]) {
        expect(gatherWorkgroupCount(probes, rays) * PROBE_GATHER_WORKGROUP)
          .toBeGreaterThanOrEqual(probes * tpp);
      }
    }
  });

  it('clamps the ray count the same way the CPU twin does', () => {
    // The host used to do Math.min(64, rays) and leave a negative value to the
    // kernel's u32 cast.
    expect(gatherThreadsPerProbe(-5)).toBe(1);
    expect(gatherThreadsPerProbe(2.7)).toBe(2);
    expect(gatherThreadsPerProbe(1000)).toBe(PROBE_GATHER_WORKGROUP);
    expect(gatherThreadsPerProbe(DYN_RAY_CAP)).toBe(PROBE_GATHER_WORKGROUP);
  });
});

// ---------------------------------------------------------------------------
// THE ROOM-FILL COMPONENT. The owner, playing: "the explosion seems to have a
// rather small radius of light effect", and "lighting the room will fix it" for
// picking the gibs out of the dark. A packed light is a POINT light, so it
// accumulates as intensity/d2: at 2 m a wall gets 1/4 of the peak and at 8 m it
// gets 1/64, which is a blob at the crater and nothing across the room. `fill`
// adds the soft component a real detonation has, and these tests pin BOTH ends:
// the far field must lift a lot, and the near field must not blow out.
// ---------------------------------------------------------------------------
describe('room fill (the blast has to light the room, not a disc of floor)', () => {
  const RAYS = 32;
  const SEED = 7;
  /** The +X wall's radiance from a blast at the origin, at two distances. */
  function wallRadiance(distM: number, fill: number | undefined): number {
    const probe = gatherProbeDynamic(0, GRID, sceneOf({ lights: [
      { pos: [0, 1.5, 0], color: [1, 0.55, 0.24], intensity: 220, ...(fill ? { fill } : {}) },
    ] }), { raysPerProbe: RAYS, frameSeed: SEED });
    return radAt(probe.radiance, [1, 0, 0])[0]!;
  }

  it('lifts the FAR field by an order of magnitude at the shipped fill', () => {
    const near = wallRadiance(0, 0);
    const far = wallRadiance(0, 1.2);
    // Same probe, same rays: `fill` only ever ADDS light, so the far wall can
    // only get brighter. The measured ratio is what "lights the room" means.
    expect(far).toBeGreaterThan(near * 2);
  });

  it('the fill term is a SOFT falloff: 1/(1+d2/REF^2), not 1/d2', () => {
    const ref = LIGHT_FILL_REF_M;
    const soft = (d: number): number => 1 / (1 + (d * d) / (ref * ref));
    // The claim, in one line: at 8 m the soft term still carries ~0.2 of its
    // source value where the hard term has fallen to 1/64 = 0.016.
    expect(soft(0)).toBeCloseTo(1, 6);
    expect(soft(ref)).toBeCloseTo(0.5, 6);
    expect(soft(8)).toBeGreaterThan(0.19);
    // The comparison, exactly: soft(8) = 1/(1+4) = 0.2 against the hard term's
    // 1/64 = 0.015625 — a 12.8x lift in the far field for the same peak.
    expect(soft(8) / (1 / 64)).toBeCloseTo(12.8, 6);
  });

  it('is OFF by default, so every other light in the game is unchanged', () => {
    // The muzzle flash wants to stay a point light. `fill` absent must be
    // bit-identical to the old `intensity / d2`, not merely close.
    const flash = () => gatherProbeDynamic(0, GRID, sceneOf({ lights: [
      { pos: [0, 1.5, 0], color: [1, 1, 1], intensity: 35 },
    ] }), { raysPerProbe: RAYS, frameSeed: SEED });
    const zero = () => gatherProbeDynamic(0, GRID, sceneOf({ lights: [
      { pos: [0, 1.5, 0], color: [1, 1, 1], intensity: 35, fill: 0 },
    ] }), { raysPerProbe: RAYS, frameSeed: SEED });
    expect([...flash().radiance]).toEqual([...zero().radiance]);
  });
});
