// src/lab/sdf-zombie/webgpu/impact-splash.test.ts
//
// CPU-only tests for the procedural impact crown (reference-directed slug
// impact splash, 2026-09-13). Nothing here needs a GPU: the geometry builder
// is pure, and the layer's event bookkeeping + `sync` fill CPU-side buffers.
//
// What these prove: seed stability, the origin/direction transform (including
// rigid translation and the outward orientation for wall vs floor normals),
// finite positions and unit normals, bounded lifetime/budget cleanup, a
// material-space mask that does not move with the world, and — the explicit
// isolation requirement — that using this module never mutates the shipped
// IMPACT_GOUT/WOUND_BLEED tables that the "Current" slug depends on.

import { describe, it, expect } from 'vitest';
import type * as THREE from 'three/webgpu';
import {
  IMPACT_SPLASH_MAX_DROPLETS, IMPACT_SPLASH_MAX_EVENTS, IMPACT_SPLASH_MAX_LOBES,
  IMPACT_SPLASH_TUNING,
  buildImpactSplashFrame, createImpactSplashEvent, createImpactSplashLayer,
  impactSplashBasis, impactSplashLobeCount, splashHash01, stepImpactSplashEvent,
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
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    const c = frame(999, UP, 0.3);
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });

  it('keeps the material mask attached to the sheet, not the world', () => {
    // Same seed/direction at two different origins: the mask and UVs are
    // identical, so the tear cells cannot swim when the effect moves.
    const evA = createImpactSplashEvent([0, 0, 0], UP, 777);
    const evB = createImpactSplashEvent([5, -2, 9], UP, 777);
    evA.time = 0.3; evB.time = 0.3;
    const a = buildImpactSplashFrame(evA)!;
    const b = buildImpactSplashFrame(evB)!;
    expect(Array.from(a.masks)).toEqual(Array.from(b.masks));
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
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

  it('uses several unequal lobes whose count varies with the seed', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const n = impactSplashLobeCount(seed);
      expect(n).toBeGreaterThanOrEqual(IMPACT_SPLASH_TUNING.lobesMin);
      expect(n).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_LOBES);
      counts.add(n);
    }
    // Not a fixed single-lobe card and not always the same count.
    expect(counts.size).toBeGreaterThan(1);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(4);
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
    expect(Array.from(fa.normals)).toEqual(Array.from(fb.normals));
    expect(Array.from(fa.masks)).toEqual(Array.from(fb.masks));
  });

  it('sprays out along the impact normal for up, sideways and diagonal impacts', () => {
    // UP (floor-like): the crown leaves along +Y, sideways spread is small.
    const fUp = frame(55, UP, 0.25);
    const cUp = centroid(fUp);
    expect(cUp.y - ORIGIN[1]).toBeGreaterThan(0.05);
    expect(Math.abs(cUp.x - ORIGIN[0])).toBeLessThan(Math.abs(cUp.y - ORIGIN[1]));
    expect(Math.abs(cUp.z - ORIGIN[2])).toBeLessThan(Math.abs(cUp.y - ORIGIN[1]));

    // RIGHT (wall/body-like): the same effect points along +X, not world-up.
    const fRight = frame(55, RIGHT, 0.25);
    const cRight = centroid(fRight);
    expect(cRight.x - ORIGIN[0]).toBeGreaterThan(0.05);
    expect(Math.abs(cRight.z - ORIGIN[2])).toBeLessThan(Math.abs(cRight.x - ORIGIN[0]));

    // Diagonal: the projection on the (normalised) direction dominates.
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
    const f = frame(21, RIGHT, 0.25);
    let maxR = 0;
    for (let i = 0; i < f.positions.length; i += 3) {
      const dx = f.positions[i]! - ORIGIN[0];
      const dy = f.positions[i + 1]! - ORIGIN[1];
      const dz = f.positions[i + 2]! - ORIGIN[2];
      maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
    }
    expect(maxR).toBeGreaterThan(0.15); // visible
    expect(maxR).toBeLessThan(1.0);     // not a room-filling blast
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
    // The first half of the expansion adds more than the second half.
    expect(dMid - dEarly).toBeGreaterThan(dLate - dMid);
  });
});

describe('impact splash — finite geometry and smooth normals', () => {
  it('emits finite positions and unit-length normals at every time', () => {
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
    // A flat card would have near-zero extent on one axis; a crown does not.
    expect(maxX - minX).toBeGreaterThan(0.1);
    expect(maxZ - minZ).toBeGreaterThan(0.1);
    expect(maxY - minY).toBeGreaterThan(0.02);
  });

  it('detaches sparse droplets on a pure gravity arc', () => {
    // Fix the birth time so the droplet set is identical at all three sample
    // times, then check the ballistic second difference is exactly gravity on
    // Y and flat on X/Z (no drag in the droplet model).
    const tuning = {
      ...IMPACT_SPLASH_TUNING,
      tearStartSec: 0.05, tearEndSec: 0.05,
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
    expect(a.dropletCount).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_DROPLETS);
    for (let k = 0; k < 6; k++) {
      const y0 = a.droplets[k * 4 + 1]!; const y1 = b.droplets[k * 4 + 1]!; const y2 = c.droplets[k * 4 + 1]!;
      const x0 = a.droplets[k * 4]!; const x1 = b.droplets[k * 4]!; const x2 = c.droplets[k * 4]!;
      const z0 = a.droplets[k * 4 + 2]!; const z1 = b.droplets[k * 4 + 2]!; const z2 = c.droplets[k * 4 + 2]!;
      expect(y2 - 2 * y1 + y0).toBeLessThan(-0.15); // downward acceleration
      expect(Math.abs(x2 - 2 * x1 + x0)).toBeLessThan(1e-3);
      expect(Math.abs(z2 - 2 * z1 + z0)).toBeLessThan(1e-3);
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
    // A huge dt is clamped to the lifetime, so the event cannot overshoot.
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
    const maxVerts = IMPACT_SPLASH_MAX_LOBES * (rs + 1) * (as + 1);
    const maxTris = IMPACT_SPLASH_MAX_LOBES * rs * as * 2;
    for (const seed of [1, 2, 3, 100, 99999]) {
      for (const t of [0.05, 0.25, 0.5, 1.0]) {
        const f = frame(seed, RIGHT, t);
        expect(f.vertexCount).toBeLessThanOrEqual(maxVerts);
        expect(f.triangleCount).toBeLessThanOrEqual(maxTris);
        expect(f.dropletCount).toBeLessThanOrEqual(IMPACT_SPLASH_MAX_DROPLETS);
        expect(f.indices.length).toBe(f.triangleCount * 3);
      }
    }
  });

  it('opens the dissolve mask over the back half of the event', () => {
    const early = frame(3, UP, 0.05);
    const mid = frame(3, UP, 0.7);
    const late = frame(3, UP, 1.1);
    expect(early.dissolve).toBe(0);
    expect(mid.dissolve).toBeGreaterThan(0);
    expect(late.dissolve).toBeGreaterThan(mid.dissolve);
    expect(late.dissolve).toBeLessThanOrEqual(1);
  });
});

describe('impact splash — layer event API and independent baseline', () => {
  it('emits, caps and cleans up events through the production API', () => {
    const layer = createImpactSplashLayer();
    try {
      // A no-event sync first, so the droplet draw count is 0 — the next
      // sync must still be able to add droplets (a regression guard for
      // looping the instance fill against the previous draw count).
      layer.sync({} as THREE.Camera);
      expect(layer.dropletCount).toBe(0);
      for (let i = 0; i < IMPACT_SPLASH_MAX_EVENTS + 6; i++) layer.emit(ORIGIN, UP, i);
      expect(layer.eventCount).toBe(IMPACT_SPLASH_MAX_EVENTS);
      // Build a live frame into the CPU buffers: a crown moment with droplets.
      layer.step(0.35);
      layer.sync({} as THREE.Camera);
      expect(layer.vertexCount).toBeGreaterThan(0);
      expect(layer.dropletCount).toBeGreaterThan(0);
      // Past the lifetime every event is dropped and the buffers go empty.
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
