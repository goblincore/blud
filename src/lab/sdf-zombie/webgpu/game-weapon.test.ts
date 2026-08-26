// src/lab/sdf-zombie/webgpu/game-weapon.test.ts
//
// Pure grapeshot units: seeded spread pattern, pellet volley shape, ballistic
// integration, segment trace (incl. the no-tunnel case), hit→wound mapping,
// and the rest→posed rigid fit that places severed pieces.

import { describe, expect, it } from 'vitest';
import { woundWorldPos } from '../damage';
import {
  GRAPESHOT, applyRigidYaw, expired, fitRestToPose, mulberry32,
  spawnPellets, spreadDirections, stepProjectiles, traceProjectile,
  woundFromPellet,
} from './game-weapon';
import type { Vec3 } from '../types';
import type { Primitive } from '../types';

const FWD: Vec3 = [0, 0, -1];

function angleFrom(a: Vec3, b: Vec3): number {
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
    / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

describe('spreadDirections', () => {
  it('is deterministic under a fixed seed', () => {
    const a = spreadDirections(FWD, 8, 1234);
    const b = spreadDirections(FWD, 8, 1234);
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = spreadDirections(FWD, 8, 1);
    const b = spreadDirections(FWD, 8, 2);
    expect(a).not.toEqual(b);
  });

  it('returns unit directions within the cone half-angle', () => {
    for (const d of spreadDirections(FWD, 64, 99)) {
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      expect(angleFrom(d, FWD)).toBeLessThanOrEqual(GRAPESHOT.spreadRad + 1e-9);
    }
  });

  it('does not collapse onto the axis or clump at one angle band', () => {
    const dirs = spreadDirections(FWD, 64, 7);
    // Flat disc sampling: radii should use the range meaningfully.
    const angles = dirs.map((d) => angleFrom(d, FWD));
    const min = Math.min(...angles);
    const max = Math.max(...angles);
    expect(max - min).toBeGreaterThan(GRAPESHOT.spreadRad * 0.5);
  });
});

describe('mulberry32', () => {
  it('repeats sequences for equal seeds only', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    const seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });
});

describe('spawnPellets', () => {
  it('fires 8 pellets per barrel', () => {
    expect(spawnPellets([0, 0, 0], FWD, 1, 5)).toHaveLength(GRAPESHOT.pelletsPerBarrel);
  });

  it('alt-fire doubles the count with an independent pattern', () => {
    const both = spawnPellets([0, 0, 0], FWD, 2, 5);
    expect(both).toHaveLength(GRAPESHOT.pelletsPerBarrel * 2);
    const single = spawnPellets([0, 0, 0], FWD, 1, 5);
    // First barrel identical; second half a different pattern.
    expect(both.slice(0, 8)).toEqual(single);
    expect(both.slice(8)).not.toEqual(single);
  });

  it('launches every pellet at muzzle speed along its spread direction', () => {
    for (const p of spawnPellets([1, 2, 3], FWD, 2, 11)) {
      expect(Math.hypot(...p.vel)).toBeCloseTo(GRAPESHOT.speed, 4);
      expect(p.ageSec).toBe(0);
      expect(p.pos).toEqual([1, 2, 3]);
      expect(angleFrom(p.vel, FWD)).toBeLessThanOrEqual(GRAPESHOT.spreadRad + 1e-9);
    }
  });
});

describe('stepProjectiles', () => {
  it('integrates position and applies gravity to vy', () => {
    const ps = [{ pos: [0, 1, 0] as Vec3, vel: [10, 0, 0] as Vec3, ageSec: 0 }];
    stepProjectiles(ps, 0.1);
    expect(ps[0]!.pos[0]).toBeCloseTo(1.0, 6);
    // Semi-implicit Euler: v += g·dt THEN move, so Δy over the first step
    // is the full g·dt².
    expect(ps[0]!.pos[1]).toBeCloseTo(1 + GRAPESHOT.gravity * 0.01, 6);
    expect(ps[0]!.vel[1]).toBeCloseTo(GRAPESHOT.gravity * 0.1, 6);
    expect(ps[0]!.ageSec).toBeCloseTo(0.1, 8);
  });

  it('ages pellets out after lifeSec', () => {
    const ps = spawnPellets([0, 50, 0], FWD, 1, 3); // high spawn: floor expiry can't fire early
    const dt = GRAPESHOT.lifeSec / 2;
    stepProjectiles(ps, dt);
    expect(expired(ps[0]!)).toBe(false);
    stepProjectiles(ps, dt);
    stepProjectiles(ps, dt); // strictly past lifeSec — no float-equality edge
    expect(expired(ps[0]!)).toBe(true);
  });
});

describe('traceProjectile', () => {
  /** Signed distance to a sphere of r=0.25 centred at c. */
  const sphereAt = (c: Vec3, r = 0.25) => (p: Vec3) =>
    Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;

  it('misses return null', () => {
    // Sphere OFF to the side of the segment's path.
    expect(traceProjectile([0, 1, 0], [0, 1, -5], sphereAt([1.5, 1, -3]))).toBeNull();
  });

  it('hits a sphere in the path near its front surface', () => {
    // Segment from z=+2 to z=-2 through a sphere centred on the line —
    // approaching from +z, the front surface is z=+0.25.
    const hit = traceProjectile([0, 0, 2], [0, 0, -2], sphereAt([0, 0, 0]));
    expect(hit).not.toBeNull();
    expect(hit![2]).toBeGreaterThan(0.24);
    expect(hit![2]).toBeLessThan(0.26); // front surface ≈ z=+0.25 (−eps)
  });

  it('does not tunnel a thin target at full pellet speed per frame', () => {
    // 35 m/s × 1/60 s ≈ 0.58 m — longer than a limb girth. A 0.06 m slab
    // mid-segment must still be caught.
    const slab = (p: Vec3) => Math.abs(p[2]) - 0.03;
    const from: Vec3 = [0, 0, 0.3];
    const to: Vec3 = [0, 0, 0.3 - GRAPESHOT.speed / 60];
    const hit = traceProjectile(from, to, slab);
    expect(hit).not.toBeNull();
    if (hit) expect(Math.abs(hit[2])).toBeLessThanOrEqual(0.03 + GRAPESHOT.hitEps + 1e-6);
  });

  it('reports the spawn point when spawned inside flesh', () => {
    const hit = traceProjectile([0, 0, -0.4], [0, 0, -1], sphereAt([0, 0, -0.4]));
    expect(hit).not.toBeNull();
    expect(hit![2]).toBeCloseTo(-0.4, 6);
  });
});

describe('woundFromPellet', () => {
  /** One fat vertical capsule prim: the whole "body". */
  const prim: Primitive = {
    a: [0, 0.4, 0], b: [0, 1.4, 0], radius: 0.22, scale: [1, 1, 1],
    blendK: 0.05, limb: 'torso', cluster: 0,
  };
  const field = (p: Vec3) =>
    Math.hypot(p[0], p[2]) - 0.22 + Math.max(0, Math.abs(p[1] - 0.9) - 0.5);

  it('binds the wound to the struck prim in its local frame', () => {
    const hit: Vec3 = [0.22, 0.9, 0];
    const w = woundFromPellet([prim], hit, 0, field);
    expect(w.primIdx).toBe(0);
    expect(w.type).toBe('pellet');
    expect(w.radius).toBeCloseTo(0.055, 6);
    // Roundtrip through the prim frame lands back on the hit.
    const back = woundWorldPos([prim], w, 0);
    expect(Math.hypot(back[0] - hit[0], back[1] - hit[1], back[2] - hit[2]))
      .toBeLessThan(1e-6);
  });
});

describe('fitRestToPose / applyRigidYaw', () => {
  it('recovers translation + yaw between rest and posed point sets', () => {
    const yaw = 0.7;
    const shift: Vec3 = [3, 0, -2];
    const rest: Vec3[] = [[0.1, 1.0, 0.2], [-0.3, 1.4, 0.1], [0.25, 0.8, -0.15]];
    const posed = rest.map((p) => [
      shift[0] + p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw),
      shift[1] + p[1],
      shift[2] - p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw),
    ] as Vec3);
    const t = fitRestToPose(rest, posed);
    expect(t.yaw).toBeCloseTo(yaw, 6);
    for (let i = 0; i < rest.length; i++) {
      const back = applyRigidYaw(t, rest[i]!);
      expect(Math.hypot(back[0] - posed[i]![0], back[1] - posed[i]![1], back[2] - posed[i]![2]))
        .toBeLessThan(1e-9);
    }
  });

  it('degenerates to pure translation at zero yaw', () => {
    const t = fitRestToPose([[1, 1, 1]], [[2, 1, 4]]);
    const back = applyRigidYaw(t, [1, 1, 1]);
    expect(back).toEqual([2, 1, 4]);
  });
});
