// src/lab/sdf-zombie/webgpu/impact-splash.test.ts
//
// CPU-only tests for the procedural impact crown (reference-directed slug
// impact splash, 2026-09-13; redesigned after the parent's first WebGPU
// visual review). Nothing here needs a GPU: the geometry builder is pure and
// the layer's event bookkeeping + `sync` fill CPU-side buffers.
//
// What these prove: seed stability; the origin/direction transform; CONNECTED
// shells (each ring closes, no azimuthal gaps, no isolated lobes) with many
// narrow rim tips; finite positions, unit normals and unit tangents; a
// material-space mask that does not move with the world; a monotonic dissolve
// ramp and the EXPLICIT alpha plumbing (opacityNode + alphaTest) on the
// installed three material, checked as object properties; ballistic droplets;
// bounded lifetime/budget cleanup; and the explicit isolation requirement that
// using this module never mutates the shipped IMPACT_GOUT/WOUND_BLEED tables
// the "Current" slug depends on.

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three/webgpu';
import {
  IMPACT_SPLASH_DISSOLVE_POINTS, IMPACT_SPLASH_DROPLET_STRIDE, IMPACT_SPLASH_MAX_DROPLETS,
  IMPACT_SPLASH_MAX_EVENTS, IMPACT_SPLASH_MAX_SHELLS, IMPACT_SPLASH_TUNING,
  buildImpactSplashFrame, createImpactSplashEvent, createImpactSplashLayer,
  impactSplashBasis, impactSplashDissolveAt, impactSplashShellCount, splashHash01,
  splashRimNoise, stepImpactSplashEvent,
  type ImpactSplashFrame,
} from './impact-splash';
import { IMPACT_GOUT, WOUND_BLEED } from '../blood-sim';

const ORIGIN = [0, 1.35, 0.55] as const;
const UP = [0, 1, 0] as const;
const RIGHT = [1, 0, 0] as const;

function frame(seed: number, direction: readonly [number, number, number], time: number): ImpactSplashFrame {
  const ev = createImpactSplashEvent(ORIGIN, direction, seed);
  ev.time = time;
  const f = buildImpactSplashFrame(ev);
  if (!f) throw new Error('expected a live frame');
  return f;
}

function centroid(f: ImpactSplashFrame): { x: number; y: number; z: number } {
  let x = 0; let y = 0; let z = 0;
  const n = f.positions.length / 3;
  for (let i = 0; i < n; i++) {
    x += f.positions[i * 3]!; y += f.positions[i * 3 + 1]!; z += f.positions[i * 3 + 2]!;
  }
  return { x: x / n, y: y / n, z: z / n };
}

describe('impact splash — deterministic seeds and material-space mask', () => {
  it('reproduces identical geometry for the same seed and differs for another', () => {
    const a = frame(12345, UP, 0.3);
    const b = frame(12345, UP, 0.3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
    expect(Array.from(a.tangents)).toEqual(Array.from(b.tangents));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(a.dissolve).toBe(b.dissolve);
    const c = frame(999, UP, 0.3);
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });

  it('keeps the material mask attached to the sheet, not the world', () => {
    // Same seed/direction at two different origins: the mask, UVs, tangents
    // and dissolve are identical, so the tear field cannot swim.
    const evA = createImpactSplashEvent([0, 0, 0], UP, 777);
    const evB = createImpactSplashEvent([5, -2, 9], UP, 777);
    evA.time = 0.3; evB.time = 0.3;
    const a = buildImpactSplashFrame(evA)!;
    const b = buildImpactSplashFrame(evB)!;
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
    for (let i = 0; i < a.tangents.length; i++) {
      expect(b.tangents[i]!).toBeCloseTo(a.tangents[i]!, 5);
    }
    expect(a.dissolve).toBe(b.dissolve);
  });

  it('has a stable, pure hash helper', () => {
    expect(splashHash01(42, 7)).toBe(splashHash01(42, 7));
    expect(splashHash01(42, 7)).not.toBe(splashHash01(43, 7));
    for (let i = 0; i < 64; i++) {
      const h = splashHash01(1234, i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('builds several overlapping shells (not a fixed petal fan)', () => {
    expect(impactSplashShellCount()).toBe(IMPACT_SPLASH_TUNING.shells);
    expect(impactSplashShellCount()).toBeGreaterThanOrEqual(2);
    expect(impactSplashShellCount()).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_SHELLS);
    // Three shells worth of vertices really are emitted.
    const f = frame(3, UP, 0.3);
    const rs = IMPACT_SPLASH_TUNING.radialSegments;
    const as = IMPACT_SPLASH_TUNING.angularSegments;
    expect(f.vertexCount).toBe(IMPACT_SPLASH_TUNING.shells * (rs + 1) * (as + 1));
  });
});

describe('impact splash — connected web geometry', () => {
  it('closes every shell ring with no azimuthal gap (connected, not lobes)', () => {
    const f = frame(4242, UP, 0.3);
    const rs = IMPACT_SPLASH_TUNING.radialSegments;
    const as = IMPACT_SPLASH_TUNING.angularSegments;
    const shells = impactSplashShellCount();
    const vertsPerShell = (rs + 1) * (as + 1);
    for (let sh = 0; sh < shells; sh++) {
      for (let i = 0; i <= rs; i++) {
        const row = sh * vertsPerShell + i * (as + 1);
        // Seam: the duplicated last angular vertex coincides with j=0.
        for (const c of [0, 1, 2]) {
          expect(f.positions[(row + as) * 3 + c]).toBeCloseTo(f.positions[row * 3 + c]!, 5);
        }
        // No gap anywhere around the sweep. Measured IN THE PLANE
        // perpendicular to the crown axis: a narrow finger legitimately has a
        // steep axial step between samples, but a lobe fan would show an
        // in-plane gap of order the lobe width (>> 0.1) somewhere.
        const w = impactSplashBasis(UP).w;
        let maxGap = 0;
        for (let j = 0; j < as; j++) {
          const a = (row + j) * 3; const b = (row + j + 1) * 3;
          const dx = f.positions[b]! - f.positions[a]!;
          const dy = f.positions[b + 1]! - f.positions[a + 1]!;
          const dz = f.positions[b + 2]! - f.positions[a + 2]!;
          const along = dx * w[0] + dy * w[1] + dz * w[2];
          const px = dx - along * w[0]; const py = dy - along * w[1]; const pz = dz - along * w[2];
          maxGap = Math.max(maxGap, Math.hypot(px, py, pz));
        }
        expect(maxGap).toBeLessThan(0.12);
      }
    }
  });

  it('has many narrow rim tips rather than a handful of giant petals', () => {
    const f = frame(2026, UP, 0.3);
    const rs = IMPACT_SPLASH_TUNING.radialSegments;
    const as = IMPACT_SPLASH_TUNING.angularSegments;
    const shells = impactSplashShellCount();
    const w = impactSplashBasis(UP).w;
    // Scan the outermost radial row of the FIRST shell.
    const row = rs * (as + 1);
    const r: number[] = [];
    for (let j = 0; j < as; j++) {
      const o = (row + j) * 3;
      const dx = f.positions[o]! - ORIGIN[0];
      const dy = f.positions[o + 1]! - ORIGIN[1];
      const dz = f.positions[o + 2]! - ORIGIN[2];
      const along = dx * w[0] + dy * w[1] + dz * w[2];
      r.push(Math.hypot(dx - along * w[0], dy - along * w[1], dz - along * w[2]));
    }
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) * (b - mean), 0) / r.length);
    let tips = 0;
    for (let j = 0; j < as; j++) {
      const a = r[(j - 1 + as) % as]!; const b = r[j]!; const c = r[(j + 1) % as]!;
      if (b > a && b > c && b > mean + 0.4 * sd) tips++;
    }
    expect(tips).toBeGreaterThanOrEqual(6);
    expect(tips).toBeLessThanOrEqual(80);
    void shells;
  });

  it('emits finite positions with unit normals and unit tangents at every time', () => {
    for (const t of [0, 0.05, 0.2, 0.35, 0.6, 0.9, 1.1]) {
      const f = frame(4321, [0.3, 0.9, -0.2], t);
      expect(f.vertexCount).toBe(f.positions.length / 3);
      for (let i = 0; i < f.positions.length; i++) {
        expect(Number.isFinite(f.positions[i]!)).toBe(true);
      }
      for (let i = 0; i < f.normals.length; i += 3) {
        const l = Math.hypot(f.normals[i]!, f.normals[i + 1]!, f.normals[i + 2]!);
        expect(Number.isFinite(l)).toBe(true);
        expect(l).toBeGreaterThan(0.99);
        expect(l).toBeLessThan(1.01);
      }
      for (let i = 0; i < f.tangents.length; i += 3) {
        const l = Math.hypot(f.tangents[i]!, f.tangents[i + 1]!, f.tangents[i + 2]!);
        expect(Number.isFinite(l)).toBe(true);
        expect(l).toBeGreaterThan(0.99);
        expect(l).toBeLessThan(1.01);
      }
      for (let i = 0; i < f.droplets.length; i++) {
        expect(Number.isFinite(f.droplets[i]!)).toBe(true);
      }
    }
  });

  it('produces genuine curved surface patches (position spread in all axes)', () => {
    const f = frame(77, UP, 0.3);
    let minX = Infinity; let maxX = -Infinity;
    let minZ = Infinity; let maxZ = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < f.positions.length; i += 3) {
      minX = Math.min(minX, f.positions[i]!); maxX = Math.max(maxX, f.positions[i]!);
      minY = Math.min(minY, f.positions[i + 1]!); maxY = Math.max(maxY, f.positions[i + 1]!);
      minZ = Math.min(minZ, f.positions[i + 2]!); maxZ = Math.max(maxZ, f.positions[i + 2]!);
    }
    expect(maxX - minX).toBeGreaterThan(0.1);
    expect(maxZ - minZ).toBeGreaterThan(0.1);
    expect(maxY - minY).toBeGreaterThan(0.02);
  });

  it('makes the rim noise smooth and periodic (no seam in the field itself)', () => {
    for (const seed of [1, 55, 909]) {
      // Periodicity and boundedness.
      expect(splashRimNoise(seed, 6, 0.1)).toBeCloseTo(splashRimNoise(seed, 6, 0.1 + Math.PI * 2), 6);
      for (let i = 0; i < 64; i++) {
        const v = splashRimNoise(seed, 6, (i / 64) * Math.PI * 2);
        expect(v).toBeGreaterThanOrEqual(-1.01);
        expect(v).toBeLessThanOrEqual(1.01);
      }
    }
  });
});

describe('impact splash — origin and direction transform', () => {
  it('translates rigidly with the origin (positions only, no mask/normal change)', () => {
    const a = createImpactSplashEvent([0, 0, 0], RIGHT, 314);
    const b = createImpactSplashEvent([2, 3, 4], RIGHT, 314);
    a.time = 0.3; b.time = 0.3;
    const fa = buildImpactSplashFrame(a)!;
    const fb = buildImpactSplashFrame(b)!;
    for (let i = 0; i < fa.positions.length; i += 3) {
      expect(fb.positions[i]! - fa.positions[i]!).toBeCloseTo(2, 5);
      expect(fb.positions[i + 1]! - fa.positions[i + 1]!).toBeCloseTo(3, 5);
      expect(fb.positions[i + 2]! - fa.positions[i + 2]!).toBeCloseTo(4, 5);
    }
    // Normals/tangents are world-space finite differences, so a translation
    // changes the last ulp via floating point; compare with a tolerance.
    for (let i = 0; i < fa.normals.length; i++) {
      expect(fb.normals[i]!).toBeCloseTo(fa.normals[i]!, 5);
      expect(fb.tangents[i]!).toBeCloseTo(fa.tangents[i]!, 5);
    }
    expect(Array.from(fa.masks)).toEqual(Array.from(fb.masks));
  });

  it('sprays out along the impact normal for up, sideways and diagonal impacts', () => {
    const fUp = frame(55, UP, 0.25);
    const cUp = centroid(fUp);
    expect(cUp.y - ORIGIN[1]).toBeGreaterThan(0.05);
    expect(Math.abs(cUp.x - ORIGIN[0])).toBeLessThan(Math.abs(cUp.y - ORIGIN[1]));
    expect(Math.abs(cUp.z - ORIGIN[2])).toBeLessThan(Math.abs(cUp.y - ORIGIN[1]));

    const fRight = frame(55, RIGHT, 0.25);
    const cRight = centroid(fRight);
    expect(cRight.x - ORIGIN[0]).toBeGreaterThan(0.05);
    expect(Math.abs(cRight.z - ORIGIN[2])).toBeLessThan(Math.abs(cRight.x - ORIGIN[0]));

    const dir = [0.6, 0.8, 0] as const;
    const w = impactSplashBasis(dir).w;
    const c = centroid(frame(55, dir, 0.25));
    const along = (c.x - ORIGIN[0]) * w[0] + (c.y - ORIGIN[1]) * w[1] + (c.z - ORIGIN[2]) * w[2];
    expect(along).toBeGreaterThan(0.05);
  });

  it('normalises a non-unit direction and falls back to up when degenerate', () => {
    const unit = frame(9, [0, 1, 0], 0.3);
    const scaled = frame(9, [0, 5, 0], 0.3);
    expect(Array.from(scaled.positions)).toEqual(Array.from(unit.positions));
    const degenerate = frame(9, [0, 0, 0], 0.3);
    expect(Array.from(degenerate.positions)).toEqual(Array.from(unit.positions));
  });

  it('reads as a bounded wound burst, not a room-filling explosion', () => {
    // Including late in the event: the gravity sag must not fling the crown
    // out of its small bounded region.
    for (const t of [0.25, 0.6, 0.95]) {
      const f = frame(21, RIGHT, t);
      let maxR = 0;
      for (let i = 0; i < f.positions.length; i += 3) {
        const dx = f.positions[i]! - ORIGIN[0];
        const dy = f.positions[i + 1]! - ORIGIN[1];
        const dz = f.positions[i + 2]! - ORIGIN[2];
        maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
      }
      expect(maxR).toBeGreaterThan(0.15); // visible
      expect(maxR).toBeLessThan(1.0);     // not a room-filling blast
    }
  });

  it('expands fast first, then slows', () => {
    const early = centroid(frame(8, UP, 0.02));
    const mid = centroid(frame(8, UP, 0.11));
    const late = centroid(frame(8, UP, 0.22));
    const dEarly = Math.hypot(early.x - ORIGIN[0], early.y - ORIGIN[1], early.z - ORIGIN[2]);
    const dMid = Math.hypot(mid.x - ORIGIN[0], mid.y - ORIGIN[1], mid.z - ORIGIN[2]);
    const dLate = Math.hypot(late.x - ORIGIN[0], late.y - ORIGIN[1], late.z - ORIGIN[2]);
    expect(dMid).toBeGreaterThan(dEarly);
    expect(dLate).toBeGreaterThan(dMid);
    expect(dMid - dEarly).toBeGreaterThan(dLate - dMid);
  });
});

describe('impact splash — dissolve ramp, droplets and material alpha plumbing', () => {
  it('opens the dissolve continuously and monotonically', () => {
    const ts = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.9, 1.1];
    let prev = -1;
    const vals: number[] = [];
    for (const t of ts) {
      const d = frame(3, UP, t).dissolve;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(d).toBeGreaterThanOrEqual(prev); // monotonic: topology is stable
      prev = d;
      vals.push(d);
    }
    // No holes before the crown (the mass is still continuous), real holes
    // through the crown window, most of the sheet gone by the end.
    expect(vals[0]).toBe(0);
    const crown = frame(3, UP, 0.3).dissolve;
    expect(crown).toBeGreaterThan(0.05);
    expect(crown).toBeLessThan(0.45);
    expect(vals[vals.length - 1]).toBeGreaterThan(0.8);
    // At half the lifetime the crown is still readable, not deleted.
    expect(frame(3, UP, 0.55).dissolve).toBeLessThan(0.6);
  });

  it('shape the dissolve ramp back-loaded (solid crown, then fragments)', () => {
    // The control points are the exported contract; a shift here changes the
    // visual envelope, so pin the endpoints and monotonicity.
    const pts = IMPACT_SPLASH_DISSOLVE_POINTS;
    expect(pts[0]![1]).toBe(0);
    expect(pts[pts.length - 1]![1]).toBe(1);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]![0]).toBeGreaterThan(pts[i - 1]![0]);
      expect(pts[i]![1]).toBeGreaterThanOrEqual(pts[i - 1]![1]);
    }
    // Back-loaded: at 30% of the lifetime less than a quarter of the ramp has
    // run, so the crown is still a connected mass at the representative
    // moment; by 70% most of it has.
    expect(impactSplashDissolveAt(0.3)).toBeLessThan(0.25);
    expect(impactSplashDissolveAt(0.7)).toBeGreaterThan(0.5);
    expect(impactSplashDissolveAt(1)).toBe(1);
    // Total and clamped at the ends.
    expect(impactSplashDissolveAt(-1)).toBe(0);
    expect(impactSplashDissolveAt(2)).toBe(1);
  });

  it('wires the computed alpha to the EXPLICIT opacityNode, not colorNode alone', () => {
    // Validated against three r185 NodeMaterial.setupDiffuseColor: alphaTest
    // discards on colorNode.a * opacityNode; an opaque material then forces
    // the (unused) blend alpha. This asserts the object-level plumbing the
    // renderer reads, without a GPU.
    const layer = createImpactSplashLayer();
    try {
      const m = layer.sheetMaterial;
      expect(m.opacityNode).not.toBeNull();
      expect(m.opacityNode).not.toBeUndefined();
      expect(m.colorNode).not.toBeNull();
      expect(m.alphaTest).toBe(0.5);
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(true);
      expect(m.depthTest).toBe(true);
    } finally {
      layer.dispose();
    }
  });

  it('emits many small droplets spread across the tear window (trailing spray)', () => {
    const early = frame(31, UP, 0.2);
    const mid = frame(31, UP, 0.55);
    const late = frame(31, UP, 1.0);
    expect(early.dropletCount).toBeGreaterThanOrEqual(1);
    expect(mid.dropletCount).toBeGreaterThan(early.dropletCount);
    expect(late.dropletCount).toBeGreaterThanOrEqual(mid.dropletCount);
    expect(late.dropletCount).toBeGreaterThanOrEqual(40);
    for (const f of [early, mid, late]) {
      for (let k = 0; k < f.dropletCount; k++) {
        const size = f.droplets[k * IMPACT_SPLASH_DROPLET_STRIDE + 3]!;
        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('detaches droplets on a pure gravity arc with a recorded launch velocity', () => {
    const tuning = {
      ...IMPACT_SPLASH_TUNING,
      tearStartSec: 0.05, tearEndSec: 0.05,
      dropletBirthStartSec: 0.05, dropletBirthEndSec: 0.05,
      dropletsMin: 6, dropletsMax: 6,
    };
    const at = (t: number): ImpactSplashFrame => {
      const ev = createImpactSplashEvent(ORIGIN, UP, 88);
      ev.time = t;
      const f = buildImpactSplashFrame(ev, tuning);
      if (!f) throw new Error('expected a live frame');
      return f;
    };
    const a = at(0.10);
    const b = at(0.25);
    const c = at(0.40);
    expect(a.dropletCount).toBe(6);
    expect(b.dropletCount).toBe(6);
    expect(c.dropletCount).toBe(6);
    const S = IMPACT_SPLASH_DROPLET_STRIDE;
    for (let k = 0; k < 6; k++) {
      const y0 = a.droplets[k * S + 1]!; const y1 = b.droplets[k * S + 1]!; const y2 = c.droplets[k * S + 1]!;
      const x0 = a.droplets[k * S]!; const x1 = b.droplets[k * S]!; const x2 = c.droplets[k * S]!;
      const z0 = a.droplets[k * S + 2]!; const z1 = b.droplets[k * S + 2]!; const z2 = c.droplets[k * S + 2]!;
      expect(y2 - 2 * y1 + y0).toBeLessThan(-0.15); // downward acceleration
      expect(Math.abs(x2 - 2 * x1 + x0)).toBeLessThan(1e-3);
      expect(Math.abs(z2 - 2 * z1 + z0)).toBeLessThan(1e-3);
      // A recorded, non-zero launch velocity.
      expect(Math.hypot(
        a.droplets[k * S + 4]!, a.droplets[k * S + 5]!, a.droplets[k * S + 6]!,
      )).toBeGreaterThan(0);
    }
  });
});

describe('impact splash — lifetime, cleanup and budget', () => {
  it('dies exactly at the bounded lifetime and never past it', () => {
    const ev = createImpactSplashEvent(ORIGIN, UP, 1);
    expect(buildImpactSplashFrame(ev)).not.toBeNull();
    stepImpactSplashEvent(ev, 0.5);
    expect(ev.time).toBeCloseTo(0.5, 5);
    expect(stepImpactSplashEvent(ev, 0.5)).toBe(true);
    expect(stepImpactSplashEvent(ev, 100)).toBe(false);
    expect(ev.time).toBeCloseTo(ev.lifetime, 5);
    expect(buildImpactSplashFrame(ev)).toBeNull();
  });

  it('rejects a non-positive lifetime and negative time', () => {
    const zero = createImpactSplashEvent(ORIGIN, UP, 1, { lifetime: 0 });
    expect(zero.lifetime).toBe(IMPACT_SPLASH_TUNING.lifetimeSec);
    const ev = createImpactSplashEvent(ORIGIN, UP, 1);
    ev.time = -1;
    expect(buildImpactSplashFrame(ev)).toBeNull();
  });

  it('stays inside the documented vertex/triangle/droplet budgets', () => {
    const rs = IMPACT_SPLASH_TUNING.radialSegments;
    const as = IMPACT_SPLASH_TUNING.angularSegments;
    const shells = impactSplashShellCount();
    const maxVerts = IMPACT_SPLASH_MAX_SHELLS * (rs + 1) * (as + 1);
    const maxTris = IMPACT_SPLASH_MAX_SHELLS * rs * as * 2;
    for (const seed of [1, 2, 3, 100, 99999]) {
      for (const t of [0.05, 0.25, 0.5, 1.0]) {
        const f = frame(seed, RIGHT, t);
        expect(f.vertexCount).toBe(shells * (rs + 1) * (as + 1));
        expect(f.vertexCount).toBeLessThanOrEqual(maxVerts);
        expect(f.triangleCount).toBeLessThanOrEqual(maxTris);
        expect(f.dropletCount).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_DROPLETS);
        expect(f.droplets.length).toBe(f.dropletCount * IMPACT_SPLASH_DROPLET_STRIDE);
        expect(f.indices.length).toBe(f.triangleCount * 3);
      }
    }
  });
});

describe('impact splash — layer event API and independent baseline', () => {
  it('emits, caps and cleans up events through the production API', () => {
    const layer = createImpactSplashLayer();
    try {
      layer.sync({} as THREE.Camera);
      expect(layer.dropletCount).toBe(0);
      for (let i = 0; i < IMPACT_SPLASH_MAX_EVENTS + 6; i++) layer.emit(ORIGIN, UP, i);
      expect(layer.eventCount).toBe(IMPACT_SPLASH_MAX_EVENTS);
      layer.step(0.55);
      layer.sync({} as THREE.Camera);
      expect(layer.vertexCount).toBeGreaterThan(0);
      expect(layer.dropletCount).toBeGreaterThan(0);
      layer.step(IMPACT_SPLASH_TUNING.lifetimeSec);
      expect(layer.eventCount).toBe(0);
      layer.sync({} as THREE.Camera);
      expect(layer.vertexCount).toBe(0);
      expect(layer.dropletCount).toBe(0);
    } finally {
      layer.dispose();
    }
  });

  it('never mutates the shipped IMPACT_GOUT / WOUND_BLEED baselines', () => {
    const goutBefore = JSON.parse(JSON.stringify(IMPACT_GOUT)) as unknown;
    const bleedBefore = JSON.parse(JSON.stringify(WOUND_BLEED)) as unknown;
    const layer = createImpactSplashLayer();
    try {
      for (let seed = 0; seed < 6; seed++) {
        const ev = createImpactSplashEvent([seed, 1, seed * 0.1], [0.2, 0.9, -0.3], seed);
        for (let t = 0; t < IMPACT_SPLASH_TUNING.lifetimeSec; t += 0.05) {
          ev.time = t;
          buildImpactSplashFrame(ev);
        }
        stepImpactSplashEvent(ev, 0.4);
        layer.emit([0, 1, 0], [0, 1, 0], seed);
        layer.step(0.3);
      }
    } finally {
      layer.dispose();
    }
    expect(IMPACT_GOUT).toEqual(goutBefore);
    expect(WOUND_BLEED).toEqual(bleedBefore);
  });
});
