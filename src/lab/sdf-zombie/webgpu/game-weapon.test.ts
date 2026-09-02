// src/lab/sdf-zombie/webgpu/game-weapon.test.ts
//
// Pure grapeshot units: seeded spread pattern, pellet volley shape, ballistic
// integration, segment trace (incl. the no-tunnel case), hit→wound mapping,
// and the rest→posed rigid fit that places severed pieces.

import { describe, expect, it } from 'vitest';
import { WOUND_PROFILES, woundWorldPos } from '../damage';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { ZOMBIE } from '../body';
import { sdBody, sdPrimitive } from '../validate';
import {
  GRAPESHOT, SLUG, applyRigidYaw, expired, fitRestToPose, mulberry32,
  spawnPellets, spawnSlug, spreadDirections, stepProjectiles, traceProjectile,
  woundFromPellet, woundFromSlug,
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
    const ps = [{ pos: [0, 1, 0] as Vec3, vel: [10, 0, 0] as Vec3, ageSec: 0, radius: GRAPESHOT.radius, kind: 'pellet' as const }];
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

  it('bisects to the TRUE surface, not the hitEps shell', () => {
    // The pale-wound root cause (2026-08-27): a hit returned on the eps
    // shell sits up to hitEps OUTSIDE the skin, and the wound stamper's
    // flesh probe measured zero thickness from there — the carve cap then
    // ate the whole radius and every crater went tangent/invisible. The
    // returned point must be ON the flesh (field <= 0) whenever the ray
    // actually penetrates.
    const hit = traceProjectile([0, 0, 2], [0, 0, -2], sphereAt([0, 0, 0]));
    expect(hit).not.toBeNull();
    expect(sphereAt([0, 0, 0])(hit!)).toBeLessThanOrEqual(0);
    // ...and within a millimetre of it (6 halvings of a 0.05 m substep).
    expect(Math.abs(sphereAt([0, 0, 0])(hit!))).toBeLessThan(0.002);
  });

  it('keeps the eps-shell point for a graze that never penetrates', () => {
    // A field whose minimum along the segment is positive-but-under-eps:
    // detection must still fire (the pellet registers) and the bisect must
    // leave hi at the detection point rather than inventing a crossing.
    const strictGraze = (p: Vec3) => Math.abs(p[2] - 0.1) + 0.005; // min +0.005 < eps
    const hit = traceProjectile([0, 0, 2], [0, 0, -2], strictGraze);
    expect(hit).not.toBeNull();
    // field at the returned point is within eps but positive (no crossing):
    expect(strictGraze(hit!)).toBeGreaterThan(0);
    expect(strictGraze(hit!)).toBeLessThanOrEqual(GRAPESHOT.hitEps);
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
    expect(w.radius).toBeCloseTo(GRAPESHOT.woundRadius, 6);
    // The decoupling: the crater is the stock pellet calibre; severing
    // reads its own (larger) radius.
    expect(w.radius).toBeCloseTo(WOUND_PROFILES.pellet.radius, 6);
    expect(w.severRadius).toBeCloseTo(GRAPESHOT.severRadius, 6);
    // Roundtrip through the prim frame lands back on the hit.
    const back = woundWorldPos([prim], w, 0);
    expect(Math.hypot(back[0] - hit[0], back[1] - hit[1], back[2] - hit[2]))
      .toBeLessThan(1e-6);
  });
});

describe('spawnSlug', () => {
  it('fires ONE projectile straight down the given ray', () => {
    const p = spawnSlug([1, 2, 3], [0, 0, -1]);
    expect(p.kind).toBe('slug');
    expect(p.radius).toBeCloseTo(SLUG.radius, 6);
    expect(p.pos).toEqual([1, 2, 3]);
    expect(p.vel).toEqual([0, 0, -SLUG.speed]);
  });

  it('stamps ONE crater of slug calibre riding the struck prim', () => {
    // ANGLED capsule on purpose — an axis-aligned prim would make a
    // degenerate fixture (the project's dominant failure mode): frame
    // discontinuities and yaw-threading errors cannot show up on it.
    const prim: Primitive = {
      a: [0.3, 0.5, 0.2], b: [-0.4, 1.5, -0.25], radius: 0.2, scale: [1, 1, 1],
      blendK: 0.05, limb: 'torso', cluster: 0,
    };
    // A real field for THIS prim: distance to the segment's swept capsule.
    const ab: Vec3 = [prim.b[0] - prim.a[0], prim.b[1] - prim.a[1], prim.b[2] - prim.a[2]];
    const field = (p: Vec3) => {
      const ap: Vec3 = [p[0] - prim.a[0], p[1] - prim.a[1], p[2] - prim.a[2]];
      const t = Math.max(0, Math.min(1,
        (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0]**2 + ab[1]**2 + ab[2]**2)));
      const cx = prim.a[0] + ab[0] * t - p[0];
      const cy = prim.a[1] + ab[1] * t - p[1];
      const cz = prim.a[2] + ab[2] * t - p[2];
      return Math.hypot(cx, cy, cz) - prim.radius;
    };
    // March a ray onto the surface to find an honest hit point.
    const hit = traceProjectile([-1, 0.9, 1], [1.5, 0.9, -1.2], field);
    expect(hit).not.toBeNull();
    const w = woundFromSlug([prim], hit!, field);
    expect(w.type).toBe('blast');            // blast profile: the tamed lip
    expect(w.radius).toBeCloseTo(SLUG.woundRadius, 6);
    expect(w.severRadius).toBeCloseTo(SLUG.severRadius, 6);
    // THE PLACEMENT GATE (pure form): the surface anchor roundtrips onto the
    // hit through the prim-local frame — within tracing precision.
    const back = woundWorldPos([prim], w, 0);
    expect(Math.hypot(back[0] - hit![0], back[1] - hit![1], back[2] - hit![2]))
      .toBeLessThan(1e-6);
  });
});

describe('cavity flag by damage type (entrails)', () => {
  // The real zombie: the flag's whole point is that it reads the STRUCK
  // prim's limb off the authored body, not off a hand-rolled fixture.
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const field = (p: Vec3) => sdBody(p, body);

  /** First live prim of `limb` with an outward surface point whose arg-min
   *  prim IS that prim (the same arg-min rule worldHitToWound uses), so the
   *  hit genuinely binds where the test claims it does. Stations run along
   *  the axis pushed out +x by the scaled radius (sdPrimitive divides the
   *  sample by scale per axis). */
  function surfaceHitOn(limb: string): { primIdx: number; hit: Vec3 } {
    for (let i = 0; i < body.prims.length; i++) {
      const p = body.prims[i]!;
      if (p.op === 'sub' || p.op === 'groove' || p.dead) continue;
      if (p.limb !== limb) continue;
      const ab: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      for (const t of [0.35, 0.5, 0.65]) {
        const hit: Vec3 = [
          p.a[0] + ab[0] * t + p.radius * p.scale[0],
          p.a[1] + ab[1] * t,
          p.a[2] + ab[2] * t,
        ];
        let bestIdx = -1;
        let best = Infinity;
        body.prims.forEach((q, j) => {
          if (q.op === 'sub' || q.op === 'groove' || q.dead) return;
          const d = sdPrimitive(hit, q);
          if (d < best) { best = d; bestIdx = j; }
        });
        if (bestIdx === i) return { primIdx: i, hit };
      }
    }
    throw new Error(`no self-owned surface hit found on limb ${limb}`);
  }

  const torsoHit = surfaceHitOn('torso');
  const limbHit = surfaceHitOn('legL');

  it('a slug to the torso opens a cavity', () => {
    const w = woundFromSlug(body.prims, torsoHit.hit, field);
    expect(w.primIdx).toBe(torsoHit.primIdx);
    expect(w.cavity).toBe(true);
  });

  it('a pellet never does, even on the torso', () => {
    // A pellet hole is too small to reach a cavity, and that is already the
    // distinction the game draws between pellet and slug.
    const w = woundFromPellet(body.prims, torsoHit.hit, 0, field);
    expect(w.primIdx).toBe(torsoHit.primIdx);
    expect(w.cavity).toBeFalsy();
  });

  it('a slug to a LIMB never does — a thigh is a wall of meat', () => {
    const w = woundFromSlug(body.prims, limbHit.hit, field);
    expect(w.primIdx).toBe(limbHit.primIdx);
    expect(w.cavity).toBeFalsy();
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
