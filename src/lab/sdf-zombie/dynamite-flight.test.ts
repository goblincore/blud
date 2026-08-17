// src/lab/sdf-zombie/dynamite-flight.test.ts
import { describe, it, expect } from 'vitest';
import {
  FLIGHT_TUNING,
  detonated,
  makeFlight,
  stepFlight,
  type FlightBounds,
  type FlightState,
} from './dynamite-flight';
import { FPV_TUNING, throwDirection, throwSpeedMps } from './fpv';
import { BALLISTIC_BOUNDS, DYNAMITE_COOK } from '../../game/gibs/tuning';
import type { Vec3 } from './types';

/** Wide-open bounds so walls never interfere with range measurements. */
const HUGE: FlightBounds = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };

/** Runs stepFlight until `pred` or `maxSteps` (1/60 s steps). */
function run(
  f: FlightState,
  pred: (f: FlightState) => boolean,
  maxSteps: number,
  bounds: FlightBounds = BALLISTIC_BOUNDS,
  dt = 1 / 60,
): FlightState {
  for (let i = 0; i < maxSteps && !pred(f); i++) f = stepFlight(f, dt, bounds);
  return f;
}

describe('makeFlight — defaults mirror the game wiring (main.ts)', () => {
  it('impact mode carries the in-flight safety fuse; fuse-only carries the max fuse', () => {
    expect(makeFlight([0, 0, 0], [0, 0, 0]).fuse).toBeCloseTo(DYNAMITE_COOK.impactSafetyFuseSec, 9);
    expect(makeFlight([0, 0, 0], [0, 0, 0], { impactMode: false }).fuse)
      .toBeCloseTo(DYNAMITE_COOK.fuseMaxSec, 9);
    expect(makeFlight([0, 0, 0], [0, 0, 0], { fuseSec: 3.5 }).fuse).toBeCloseTo(3.5, 9);
  });
});

describe('full-charge range — the game-simulated ~68 m', () => {
  /** Full-charge throw, level aim (lob 30°), spawned at eye height. */
  function fullChargeThrow(impactMode: boolean, fuseSec: number | undefined): FlightState {
    const speed = throwSpeedMps(1); // full charge → DYNAMITE_COOK.maxVelocityMps
    const dir = throwDirection(0, 0);
    const origin: Vec3 = [0, FPV_TUNING.eyeHeightM, 0];
    const vel: Vec3 = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
    return makeFlight(origin, vel, { impactMode, fuseSec });
  }

  it('fuse-limited reach lands in the band of the game\'s simulated ~68 m (55-80 m)', () => {
    // Safety-fuse detonation (no impact): the bundle skips, rests, and slides
    // until the 5 s fallback fuse — the same measurement the source sim used
    // to tune the velocity band (which is why the drag is in FLIGHT_TUNING).
    const f = run(
      fullChargeThrow(false, DYNAMITE_COOK.impactSafetyFuseSec),
      detonated,
      60 * 10,
      HUGE,
    );
    expect(detonated(f)).toBe(true);
    expect(f.fuse).toBeLessThanOrEqual(1e-9); // ended by the timer
    const range = Math.hypot(f.pos[0], f.pos[2]);
    console.log(`[range] full-charge flat-ground reach = ${range.toFixed(1)} m (game ~68 m, band 55-80)`);
    expect(range).toBeGreaterThan(55);
    expect(range).toBeLessThan(80);
  });

  it('impact mode detonates at the first qualifying landing — long before the safety fuse', () => {
    const f = run(fullChargeThrow(true, undefined), detonated, 60 * 10, HUGE);
    expect(detonated(f)).toBe(true);
    const range = Math.hypot(f.pos[0], f.pos[2]);
    console.log(`[impact] full-charge first-landing range = ${range.toFixed(1)} m`);
    expect(range).toBeGreaterThan(15);
    expect(range).toBeLessThan(45); // first landing, not the fuse reach
    expect(f.fuse).toBeGreaterThan(3); // ~2 s of the 5 s safety fuse left
  });
});

describe('floor bounce — Blood\'s elastic feel (e = 0.375)', () => {
  it('drops from 2 m and rebounds to ≈ 2·e² = 0.28 m', () => {
    let f = makeFlight([0, 2, 0], [0, 0, 0], { impactMode: false, fuseSec: 30 });
    let prevY = f.pos[1];
    let airborne = false;
    let apex = -Infinity;
    for (let i = 0; i < 60 * 6 && !detonated(f); i++) {
      f = stepFlight(f, 1 / 60, HUGE);
      if (!airborne && prevY <= 0.02 && f.pos[1] > prevY) airborne = true; // left the floor
      if (airborne) apex = Math.max(apex, f.pos[1]);
      prevY = f.pos[1];
    }
    expect(airborne).toBe(true);
    expect(apex).toBeGreaterThan(0.2);
    expect(apex).toBeLessThan(0.36); // 2 · 0.375² = 0.28125, minus airdrag
  });

  it('comes to rest once the bounce falls below the rest speed (and stays put vertically)', () => {
    let f = makeFlight([0, 2, 0], [0, 0, 0], { impactMode: false, fuseSec: 30 });
    f = run(f, (s) => s.resting, 60 * 10, HUGE);
    expect(f.resting).toBe(true);
    expect(f.pos[1]).toBeCloseTo(0, 6);
    expect(Math.abs(f.vel[1])).toBeLessThanOrEqual(FLIGHT_TUNING.restSpeedMps);
  });
});

describe('wall bounce', () => {
  it('reflects the normal component × elastic and never escapes the bounds', () => {
    const box: FlightBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    // Sliding on the floor toward +X (no vertical velocity → rests immediately,
    // but horizontal keeps sliding — the kThing behavior).
    let f = makeFlight([0, 0, 0], [10, 0, 0], { impactMode: false, fuseSec: 30 });
    let bounced = false;
    for (let i = 0; i < 60 * 5 && !detonated(f); i++) {
      const prev = f;
      f = stepFlight(f, 1 / 60, box);
      // The bounce is the first vx sign flip while near the +X wall (the bundle
      // reflects mid-step, so the post-step position has already left the wall).
      if (!bounced && prev.vel[0] > 0 && f.vel[0] < 0 && f.pos[0] > box.maxX - 2) {
        expect(f.pos[0]).toBeLessThanOrEqual(box.maxX + 1e-9); // clamped, not past
        expect(f.vel[0]).toBeCloseTo(-prev.vel[0] * FLIGHT_TUNING.elastic, 1); // 0.375× damped
        bounced = true;
      }
      expect(f.pos[0]).toBeLessThanOrEqual(box.maxX + 1e-9);
      expect(f.pos[0]).toBeGreaterThanOrEqual(box.minX - 1e-9);
    }
    expect(bounced).toBe(true);
  });
});

describe('fuse — timer and impact rules per the game', () => {
  it('fuse fires on the timer regardless of geometry (fuse-only mode)', () => {
    let f = makeFlight([0, 5, 0], [0, 0, 0], { impactMode: false, fuseSec: 0.5 });
    f = run(f, detonated, 60, BALLISTIC_BOUNDS);
    expect(detonated(f)).toBe(true);
    expect(f.age).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(f.fuse).toBeLessThanOrEqual(1e-9);
  });

  it('impact detonation qualifies only past the grace window AND the safe distance', () => {
    // (a) Contact within the safe distance → spawn protection: bounces/rests,
    // never detonates by impact (mirrors projectile.ts IMPACT_SAFE_DIST_SQ_FP).
    let a = makeFlight([0, 0.3, 0], [0, -2, 0], { impactMode: true });
    a = run(a, detonated, 60 * 3, BALLISTIC_BOUNDS);
    expect(detonated(a)).toBe(false);
    expect(a.resting).toBe(true);

    // (b) A qualifying impact (far from spawn, after grace) detonates on contact.
    let b = makeFlight([0, 2, 0], [0, -20, 0], { impactMode: true });
    b = run(b, detonated, 60 * 3, BALLISTIC_BOUNDS);
    expect(detonated(b)).toBe(true);
    expect(b.fuse).toBeGreaterThan(0); // impact beat the safety fuse
    expect(b.pos[1]).toBeLessThan(0.5); // detonated at the floor
  });

  it('a wall contact is a qualifying impact too', () => {
    const box: FlightBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    // Spawn close to the wall so the bundle reaches it while still airborne
    // (a mid-arena throw would fall to the floor first and detonate there).
    let f = makeFlight([8.5, 1.75, 0], [10, 0, 0], { impactMode: true });
    f = run(f, detonated, 60 * 5, box);
    expect(detonated(f)).toBe(true);
    expect(Math.abs(f.pos[0])).toBeCloseTo(box.maxX, 1); // detonated against the wall
    expect(f.pos[1]).toBeGreaterThan(0.5); // still airborne at the wall
  });
});

describe('prop spin', () => {
  it('advances while airborne and freezes at rest', () => {
    let f = makeFlight([0, 2, 0], [0, 0, 0], { impactMode: false, fuseSec: 30 });
    f = stepFlight(f, 1 / 60, HUGE);
    expect(f.spin).toBeGreaterThan(0);
    f = run(f, (s) => s.resting, 60 * 10, HUGE);
    expect(f.resting).toBe(true);
    const atRest = f.spin;
    for (let i = 0; i < 60; i++) f = stepFlight(f, 1 / 60, HUGE);
    expect(f.spin).toBe(atRest); // frozen while resting
  });
});

describe('determinism', () => {
  it('identical states + dt sequences → identical trajectories', () => {
    const runOnce = (): string => {
      let f = makeFlight([0, 1.75, 0], [3, 5, -7], { impactMode: true });
      const out: FlightState[] = [];
      for (let i = 0; i < 300 && !detonated(f); i++) {
        f = stepFlight(f, 1 / 60, BALLISTIC_BOUNDS);
        out.push(f);
      }
      return JSON.stringify(out);
    };
    expect(runOnce()).toBe(runOnce());
  });
});
