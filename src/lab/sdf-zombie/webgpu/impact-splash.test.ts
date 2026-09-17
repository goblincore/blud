// src/lab/sdf-zombie/webgpu/impact-splash.test.ts
//
// CPU-only tests for the procedural impact burst (reference-directed slug
// impact splash, 2026-09-13; strand-bundle topology after the second WebGPU
// review — the full-2pi swept shells read as an opaque petal fan, so the
// geometry is now tapered TUBES + core + partial sheet flakes). Nothing here
// needs a GPU: the geometry builder is pure and the layer's event
// bookkeeping + `sync` fill CPU-side buffers.
//
// What these prove: seed stability; the origin/direction transform; the
// strand-bundle topology (tube rings close; tips and roots pinch; the crown
// moment has structural azimuthal GAPS — it cannot close into an opaque fan;
// total triangle area collapses late = fragmentation); finite positions,
// unit normals and unit tangents; a material-space mask that does not move
// with the world; a monotonic back-loaded dissolve ramp; the EXPLICIT alpha
// plumbing (opacityNode + alphaTest) on the installed three material;
// ballistic near-round droplets; bounded lifetime/budget cleanup; and the
// explicit isolation requirement that using this module never mutates the
// shipped IMPACT_GOUT/WOUND_BLEED tables the "Current" slug depends on.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  IMPACT_SPLASH_DISSOLVE_POINTS, IMPACT_SPLASH_DROPLET_STRIDE, IMPACT_SPLASH_MAX_DROPLETS,
  IMPACT_SPLASH_MAX_EVENTS, IMPACT_SPLASH_MAX_STRANDS, IMPACT_SPLASH_TUNING,
  buildImpactSplashFrame, createImpactSplashEvent, createImpactSplashLayer,
  impactSplashBasis, impactSplashDissolveAt, impactSplashMaxVerticesPerEvent,
  impactSplashSheetCount, impactSplashStrandCount, splashHash01,
  stepImpactSplashEvent,
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
    const a = frame(12345, UP, 0.30);
    const b = frame(12345, UP, 0.30);
    const c = frame(12346, UP, 0.30);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });

  it('keeps the material mask attached to the surface cells, not the world', () => {
    // Same seed + time but a translated origin: identical per-vertex masks,
    // normals and tangents (only positions move rigidly).
    const evA = createImpactSplashEvent(ORIGIN, UP, 7);
    const evB = createImpactSplashEvent([0.6, 2.2, -1.1], UP, 7);
    evA.time = 0.4; evB.time = 0.4;
    const a = buildImpactSplashFrame(evA)!;
    const b = buildImpactSplashFrame(evB)!;
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(Array.from(a.normals)).toEqual(Array.from(b.normals));
    let moved = 0;
    for (let i = 0; i < a.positions.length; i += 3) {
      if (Math.abs(a.positions[i]! - b.positions[i]!) > 1e-6) moved++;
    }
    expect(moved).toBe(a.positions.length / 3);
  });

  it('has a stable, pure hash helper', () => {
    expect(splashHash01(1, 1)).toBe(splashHash01(1, 1));
    expect(splashHash01(1, 1)).not.toBe(splashHash01(1, 2));
    expect(splashHash01(1, 1)).not.toBe(splashHash01(2, 1));
    for (let i = 0; i < 200; i++) {
      const h = splashHash01(i - 100, i * 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('rolls a bounded strand bundle and a handful of partial sheets', () => {
    expect(impactSplashStrandCount()).toBeGreaterThan(8);
    expect(impactSplashStrandCount()).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_STRANDS);
    expect(impactSplashSheetCount()).toBeLessThanOrEqual(6);
  });
});

describe('impact splash — strand-bundle topology (not a petal fan)', () => {
  const seg = IMPACT_SPLASH_TUNING.strandSegments;
  const sides = IMPACT_SPLASH_TUNING.strandSides;
  const vertsPerStrand = (seg + 1) * (sides + 1);

  it('closes every tube ring (seam sample j=0 equals j=sides)', () => {
    const f = frame(2024, UP, 0.30);
    for (let k = 0; k < impactSplashStrandCount(); k++) {
      for (let i = 0; i <= seg; i++) {
        const a = (k * vertsPerStrand) + i * (sides + 1);
        const b = a + sides;
        const dx = f.positions[a * 3]! - f.positions[b * 3]!;
        const dy = f.positions[a * 3 + 1]! - f.positions[b * 3 + 1]!;
        const dz = f.positions[a * 3 + 2]! - f.positions[b * 3 + 2]!;
        expect(Math.hypot(dx, dy, dz)).toBeLessThan(1e-5);
      }
    }
  });

  it('tapers: tip and root rings pinch far tighter than the mid ring', () => {
    const f = frame(2024, UP, 0.30);
    const ringSpread = (k: number, i: number): number => {
      let minx = Infinity, miny = Infinity, minz = Infinity;
      let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
      for (let j = 0; j <= sides; j++) {
        const o = ((k * vertsPerStrand) + i * (sides + 1) + j) * 3;
        minx = Math.min(minx, f.positions[o]!); maxx = Math.max(maxx, f.positions[o]!);
        miny = Math.min(miny, f.positions[o + 1]!); maxy = Math.max(maxy, f.positions[o + 1]!);
        minz = Math.min(minz, f.positions[o + 2]!); maxz = Math.max(maxz, f.positions[o + 2]!);
      }
      return Math.hypot(maxx - minx, maxy - miny, maxz - minz);
    };
    for (let k = 0; k < 6; k++) {
      const mid = ringSpread(k, Math.round(seg / 2));
      const tip = ringSpread(k, seg);
      const root = ringSpread(k, 0);
      expect(mid).toBeGreaterThan(1e-4); // there IS a tube at mid
      expect(tip).toBeLessThan(mid * 0.35); // clean taper to a fine point
      expect(root).toBeLessThan(mid * 0.5); // pinched root (no disc end)
    }
  });

  it('keeps structural azimuthal gaps at the crown moment (no opaque fan)', () => {
    // Bin the azimuth (around the wound axis) of mid-strand surface samples
    // that sit well away from the axis; a full-revolution skirt covers every
    // bin — the strand bundle must leave gaps.
    const basis = impactSplashBasis(UP);
    const f = frame(2024, UP, 0.30);
    const BINS = 24;
    const covered = new Array<boolean>(BINS).fill(false);
    let counted = 0;
    for (let k = 0; k < impactSplashStrandCount(); k++) {
      const i = Math.round(seg * 0.55);
      for (let j = 0; j <= sides; j++) {
        const vIdx = (k * vertsPerStrand) + i * (sides + 1) + j;
        const x = f.positions[vIdx * 3]! - ORIGIN[0];
        const y = f.positions[vIdx * 3 + 1]! - ORIGIN[1];
        const z = f.positions[vIdx * 3 + 2]! - ORIGIN[2];
        const ru = x * basis.u[0]! + y * basis.u[1]! + z * basis.u[2]!;
        const rv = x * basis.v[0]! + y * basis.v[1]! + z * basis.v[2]!;
        const r = Math.hypot(ru, rv);
        if (r < 0.06) continue; // near-axis bases overlap; ignore
        const az = Math.atan2(rv, ru);
        const bin = Math.floor(((az + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
        covered[bin] = true;
        counted++;
      }
    }
    expect(counted).toBeGreaterThan(40); // the bundle is dense…
    const nCovered = covered.filter(Boolean).length;
    expect(nCovered).toBeGreaterThan(BINS / 3); // …but NOT a closed fan
    expect(nCovered).toBeLessThan(BINS); // gaps are structural
  });

  it('fragments: total triangle area collapses from the crown to late time', () => {
    const area = (f: ImpactSplashFrame): number => {
      let total = 0;
      for (let t = 0; t < f.indices.length; t += 3) {
        const a = f.indices[t]! * 3, b = f.indices[t + 1]! * 3, c = f.indices[t + 2]! * 3;
        const ux = f.positions[b]! - f.positions[a]!, uy = f.positions[b + 1]! - f.positions[a + 1]!, uz = f.positions[b + 2]! - f.positions[a + 2]!;
        const vx = f.positions[c]! - f.positions[a]!, vy = f.positions[c + 1]! - f.positions[a + 1]!, vz = f.positions[c + 2]! - f.positions[a + 2]!;
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        total += 0.5 * Math.hypot(cx, cy, cz);
      }
      return total;
    };
    const crown = area(frame(2024, UP, 0.30));
    const late = area(frame(2024, UP, 1.05));
    expect(crown).toBeGreaterThan(0.004); // a substantial burst at the crown
    expect(late).toBeLessThan(crown * 0.45); // torn into fragments by then
  });

  it('keeps a dense core at the wound mouth at every sampled time', () => {
    for (const t of [0.05, 0.3, 0.7, 1.05]) {
      const f = frame(2024, UP, t);
      let nearOrigin = 0;
      for (let i = 0; i < f.positions.length; i += 3) {
        const d = Math.hypot(
          f.positions[i]! - ORIGIN[0], f.positions[i + 1]! - ORIGIN[1], f.positions[i + 2]! - ORIGIN[2],
        );
        if (d < IMPACT_SPLASH_TUNING.coreRadius * 2.0) nearOrigin++;
      }
      expect(nearOrigin).toBeGreaterThan(20);
    }
  });

  it('emits finite positions with unit normals and unit tangents at every time', () => {
    for (const t of [0.01, 0.15, 0.30, 0.55, 0.80, 1.10]) {
      const f = frame(31, UP, t);
      expect(f.vertexCount).toBe(f.positions.length / 3);
      for (let i = 0; i < f.vertexCount; i++) {
        for (const arr of [f.positions, f.normals, f.tangents]) {
          for (let c = 0; c < 3; c++) expect(Number.isFinite(arr[i * 3 + c]!)).toBe(true);
        }
        const nl = Math.hypot(f.normals[i * 3]!, f.normals[i * 3 + 1]!, f.normals[i * 3 + 2]!);
        expect(nl).toBeGreaterThan(0.99);
        expect(nl).toBeLessThan(1.01);
        const tl = Math.hypot(f.tangents[i * 3]!, f.tangents[i * 3 + 1]!, f.tangents[i * 3 + 2]!);
        expect(tl).toBeGreaterThan(0.99);
        expect(tl).toBeLessThan(1.01);
      }
    }
  });

  it('extends fast first, then slows (burst, not a slow bloom)', () => {
    const reach = (t: number): number => {
      const f = frame(2024, UP, t);
      let maxD = 0;
      for (let i = 0; i < f.positions.length; i += 3) {
        const d = Math.hypot(
          f.positions[i]! - ORIGIN[0], f.positions[i + 1]! - ORIGIN[1], f.positions[i + 2]! - ORIGIN[2],
        );
        if (d > maxD) maxD = d;
      }
      return maxD;
    };
    const early = reach(0.06);
    const crown = reach(0.30);
    const settled = reach(0.60);
    expect(early).toBeGreaterThan(0.02);
    expect(crown).toBeGreaterThan(early * 1.5);
    expect(settled).toBeLessThan(crown * 1.35);
  });
});

describe('impact splash — origin and direction transform', () => {
  it('translates rigidly with the origin (positions only)', () => {
    const evA = createImpactSplashEvent(ORIGIN, UP, 7);
    const evB = createImpactSplashEvent([0.6, 2.2, -1.1], UP, 7);
    evA.time = 0.4; evB.time = 0.4;
    const a = buildImpactSplashFrame(evA)!;
    const b = buildImpactSplashFrame(evB)!;
    const dx = b.positions[0]! - a.positions[0]!;
    const dy = b.positions[1]! - a.positions[1]!;
    const dz = b.positions[2]! - a.positions[2]!;
    for (let i = 0; i < a.positions.length; i += 3) {
      expect(b.positions[i]! - a.positions[i]!).toBeCloseTo(dx, 5);
      expect(b.positions[i + 1]! - a.positions[i + 1]!).toBeCloseTo(dy, 5);
      expect(b.positions[i + 2]! - a.positions[i + 2]!).toBeCloseTo(dz, 5);
    }
  });

  it('sprays out along the impact normal for up, sideways and diagonal impacts', () => {
    for (const dir of [UP, RIGHT, [0.2, 0.9, -0.3] as const]) {
      const f = frame(555, dir, 0.30);
      const basis = impactSplashBasis(dir);
      let alongW = 0;
      const n = f.positions.length / 3;
      for (let i = 0; i < n; i++) {
        const x = f.positions[i * 3]! - ORIGIN[0];
        const y = f.positions[i * 3 + 1]! - ORIGIN[1];
        const z = f.positions[i * 3 + 2]! - ORIGIN[2];
        const w = x * basis.w[0]! + y * basis.w[1]! + z * basis.w[2]!;
        if (w > -0.02) alongW++;
      }
      // Essentially the whole burst leaves on the OUTWARD side of the wound.
      expect(alongW / n).toBeGreaterThan(0.93);
    }
  });

  it('normalises a non-unit direction and falls back to up when degenerate', () => {
    const a = frame(9, [0, 0, 7], 0.3);
    const b = frame(9, [0, 0, 1], 0.3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    const c = frame(9, [0, 0, 0], 0.3);
    const d = frame(9, [0, 1, 0], 0.3);
    expect(Array.from(c.positions)).toEqual(Array.from(d.positions));
  });

  it('reads as a bounded wound burst, not a room-filling explosion', () => {
    for (const t of [0.25, 0.6, 0.95]) {
      const f = frame(12345, UP, t);
      for (let i = 0; i < f.positions.length; i += 3) {
        const d = Math.hypot(
          f.positions[i]! - ORIGIN[0], f.positions[i + 1]! - ORIGIN[1], f.positions[i + 2]! - ORIGIN[2],
        );
        expect(d).toBeLessThan(1.0);
      }
      for (let k = 0; k < f.dropletCount; k++) {
        const o = k * IMPACT_SPLASH_DROPLET_STRIDE;
        const d = Math.hypot(
          f.droplets[o]! - ORIGIN[0], f.droplets[o + 1]! - ORIGIN[1], f.droplets[o + 2]! - ORIGIN[2],
        );
        expect(d).toBeLessThan(1.6);
      }
    }
  });
});

describe('impact splash — dissolve ramp, droplets and material alpha plumbing', () => {
  it('opens the dissolve continuously and monotonically', () => {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const d = impactSplashDissolveAt(p);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeLessThanOrEqual(1);
      last = d;
    }
    expect(impactSplashDissolveAt(0)).toBe(0);
    expect(impactSplashDissolveAt(1)).toBe(1);
  });

  it('shapes the dissolve ramp back-loaded (solid burst, then fragments)', () => {
    const pts = IMPACT_SPLASH_DISSOLVE_POINTS;
    expect(pts.length).toBeGreaterThanOrEqual(5);
    expect(pts[0]![1]).toBe(0);
    expect(pts[pts.length - 1]![1]).toBe(1);
    // At the crown moment (progress ~0.26 = 0.30s / 1.15s) the mass is still
    // mostly connected: dissolve under 0.2.
    expect(impactSplashDissolveAt(0.30 / IMPACT_SPLASH_TUNING.lifetimeSec)).toBeLessThan(0.2);
    // By 0.8 of the lifetime it is mostly gone.
    expect(impactSplashDissolveAt(0.8)).toBeGreaterThan(0.6);
  });

  it('wires the computed alpha to the EXPLICIT opacityNode, not colorNode alone', () => {
    const layer = createImpactSplashLayer();
    try {
      const m = layer.sheetMaterial;
      expect(m.opacityNode).not.toBeNull();
      expect(m.alphaTest).toBe(0.5);
      expect(m.transparent).toBe(false);
      expect(m.depthWrite).toBe(true);
      expect(m.depthTest).toBe(true);
    } finally {
      layer.dispose();
    }
  });

  it('emits many small droplets spread across the tear window (trailing spray)', () => {
    const f = frame(12345, UP, 0.9);
    expect(f.dropletCount).toBeGreaterThanOrEqual(60);
    expect(f.dropletCount).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_DROPLETS);
    for (let k = 0; k < f.dropletCount; k++) {
      const size = f.droplets[k * IMPACT_SPLASH_DROPLET_STRIDE + 3]!;
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(0.02); // fine spray, not beads
    }
    // Early in the event only the first-born droplets exist.
    const early = frame(12345, UP, 0.12);
    expect(early.dropletCount).toBeLessThan(f.dropletCount);
  });

  it('detaches droplets on a damped gravity arc with a recorded launch velocity', () => {
    const t = 0.5;
    const f = frame(777, UP, t);
    expect(f.dropletCount).toBeGreaterThan(0);
    const g = IMPACT_SPLASH_TUNING.dropletGravity;
    const drag = 1.15; // the documented linear-drag model, mirrored here
    for (let k = 0; k < f.dropletCount; k++) {
      const o = k * IMPACT_SPLASH_DROPLET_STRIDE;
      const vx = f.droplets[o + 4]!, vy = f.droplets[o + 5]!, vz = f.droplets[o + 6]!;
      expect(Math.hypot(vx, vy, vz)).toBeGreaterThan(0.2);
      // Reverse the damped ballistic integration: birth = now - age for some
      // age in the tear window, and the reversed position must sit near the
      // burst (the drag decelerates travel, so this converges quickly).
      const px = f.droplets[o]!, py = f.droplets[o + 1]!, pz = f.droplets[o + 2]!;
      let ok = false;
      for (let age = 0.01; age <= t; age += 0.01) {
        const travel = (1 - Math.exp(-drag * age)) / drag;
        const bx = px - vx * travel;
        const by = py - (vy * travel - 0.5 * g * age * age);
        const bz = pz - vz * travel;
        const d = Math.hypot(bx - ORIGIN[0], by - ORIGIN[1], bz - ORIGIN[2]);
        if (d < IMPACT_SPLASH_TUNING.radiusMax * 1.35) { ok = true; break; }
      }
      expect(ok).toBe(true);
    }
  });
});

describe('impact splash — lifetime, cleanup and budget', () => {
  it('dies exactly at the bounded lifetime and never past it', () => {
    const ev = createImpactSplashEvent(ORIGIN, UP, 5);
    expect(stepImpactSplashEvent(ev, 0.5)).toBe(true);
    expect(stepImpactSplashEvent(ev, IMPACT_SPLASH_TUNING.lifetimeSec)).toBe(false);
    expect(ev.time).toBe(IMPACT_SPLASH_TUNING.lifetimeSec);
    expect(buildImpactSplashFrame(ev)).toBeNull();
  });

  it('rejects a non-positive lifetime and negative time', () => {
    // An explicitly non-positive lifetime creates an ALREADY-DEAD event.
    const dead = createImpactSplashEvent(ORIGIN, UP, 5, { lifetime: -1 });
    expect(dead.lifetime).toBe(0);
    expect(stepImpactSplashEvent(dead, 0.1)).toBe(false);
    expect(buildImpactSplashFrame(dead)).toBeNull();
    // A non-finite lifetime falls back to the tuning default.
    const fallback = createImpactSplashEvent(ORIGIN, UP, 5, { lifetime: NaN });
    expect(fallback.lifetime).toBe(IMPACT_SPLASH_TUNING.lifetimeSec);
    const ev = createImpactSplashEvent(ORIGIN, UP, 5);
    ev.time = -0.1;
    expect(buildImpactSplashFrame(ev)).toBeNull();
  });

  it('stays inside the documented vertex/triangle/droplet budgets', () => {
    const cap = impactSplashMaxVerticesPerEvent();
    expect(cap).toBeLessThanOrEqual(8192 + 8);
    for (const t of [0.02, 0.3, 0.7, 1.1]) {
      const f = frame(2024, UP, t);
      expect(f.vertexCount).toBeLessThanOrEqual(cap);
      expect(f.indices.length).toBe(f.triangleCount * 3);
      expect(f.dropletCount).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_DROPLETS);
    }
  });
});

describe('impact splash — layer event API and independent baseline', () => {
  it('emits, caps and cleans up events through the production API', () => {
    const layer = createImpactSplashLayer();
    try {
      layer.sync(new THREE.PerspectiveCamera());
      expect(layer.dropletCount).toBe(0);
      for (let i = 0; i < IMPACT_SPLASH_MAX_EVENTS + 6; i++) layer.emit(ORIGIN, UP, i);
      expect(layer.eventCount).toBe(IMPACT_SPLASH_MAX_EVENTS);
      layer.step(0.55);
      layer.sync(new THREE.PerspectiveCamera());
      expect(layer.vertexCount).toBeGreaterThan(0);
      expect(layer.dropletCount).toBeGreaterThan(0);
      layer.step(IMPACT_SPLASH_TUNING.lifetimeSec);
      expect(layer.eventCount).toBe(0);
      layer.sync(new THREE.PerspectiveCamera());
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
