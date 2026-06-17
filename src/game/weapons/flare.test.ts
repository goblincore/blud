import { describe, it, expect, vi } from 'vitest';
import {
  flareArcPosition,
  isProjectileActive,
  raisingComplete,
  FlareGun,
} from './flare';
import type { FrameCtx } from './types';
import type { Vec3 } from '../gibs/particles';
import { FLARE_GUN } from '../gibs/tuning';

describe('flareArcPosition', () => {
  it('returns spawn position at t=0', () => {
    const pos = flareArcPosition(
      { x: 1, y: 2, z: 3 },
      { x: 10, y: 5, z: 0 },
      0,
      9.81,
    );
    expect(pos.x).toBeCloseTo(1, 5);
    expect(pos.y).toBeCloseTo(2, 5);
    expect(pos.z).toBeCloseTo(3, 5);
  });

  it('applies gravity to Y only', () => {
    const pos = flareArcPosition(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 20, z: 0 },
      2,
      10,
    );
    // y = 0 + 20*2 - 0.5*10*4 = 40 - 20 = 20
    expect(pos.y).toBeCloseTo(20, 5);
    expect(pos.x).toBeCloseTo(0, 5);
  });

  it('horizontal position is unaffected by gravity', () => {
    const pos = flareArcPosition(
      { x: 0, y: 0, z: 0 },
      { x: 25, y: 0, z: 0 },
      1,
      9.81,
    );
    expect(pos.x).toBeCloseTo(25, 5);
    expect(pos.y).toBeCloseTo(-4.905, 5); // 0 + 0 - 0.5*9.81*1
  });

  it('parabolic arc: Y peaks and then descends', () => {
    const spawn = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 10, z: 0 };
    const g = 10;
    // y = 10t - 5t². Peak at t=1 (dy/dt = 10 - 10t = 0), y = 5
    const y0 = flareArcPosition(spawn, vel, 0, g).y;
    const y05 = flareArcPosition(spawn, vel, 0.5, g).y;
    const y1 = flareArcPosition(spawn, vel, 1, g).y;
    const y2 = flareArcPosition(spawn, vel, 2, g).y;
    expect(y0).toBeCloseTo(0, 5);
    expect(y05).toBeCloseTo(3.75, 5); // 10*0.5 - 5*0.25 = 5 - 1.25 = 3.75
    expect(y1).toBeCloseTo(5, 5);     // 10*1 - 5*1 = 5
    expect(y2).toBeCloseTo(0, 5);     // 10*2 - 5*4 = 20 - 20 = 0
  });
});

describe('isProjectileActive', () => {
  it('true only for projectile phase', () => {
    expect(isProjectileActive('projectile')).toBe(true);
    expect(isProjectileActive('idle')).toBe(false);
    expect(isProjectileActive('raising')).toBe(false);
  });
});

describe('raisingComplete', () => {
  it('true at and after raisingMs', () => {
    expect(raisingComplete(300, 300)).toBe(true);
    expect(raisingComplete(301, 300)).toBe(true);
  });

  it('false before raisingMs', () => {
    expect(raisingComplete(0, 300)).toBe(false);
    expect(raisingComplete(299, 300)).toBe(false);
  });
});

// ——— FSM tests ———————————————————————————————————————

function makeCtx(now: number): FrameCtx {
  return {
    world: {
      createRigidBody: () => ({} as any),
      createCollider: () => {},
      removeRigidBody: () => {},
    } as any,
    player: {
      pos: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      handPos: { x: 0, y: 1.5, z: 0 },
      takeDamage: () => {},
    },
    gibs: {
      spawnExplosion: () => {},
      registerDude: () => {},
      unregisterDude: () => {},
    } as any,
    now,
  };
}

describe('FlareGun FSM', () => {
  it('starts idle with full ammo', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0); // lazy init
    expect(f.phase()).toBe('idle');
    expect(f.ammo).toBe(FLARE_GUN.ammoMax);
  });

  it('onPress from idle → raising', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    expect(f.phase()).toBe('raising');
  });

  it('ammo unchanged during raising', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    expect(f.ammo).toBe(FLARE_GUN.ammoMax);
  });

  it('onPress while raising is a no-op', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    const ammoBefore = f.ammo;
    f.onPress(makeCtx(1.1)); // still raising — second press ignored
    expect(f.ammo).toBe(ammoBefore);
  });

  it('onPress while projectile is a no-op', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    // Advance past raisingMs
    f.onFrame(makeCtx(1.4), 0.4);
    expect(f.phase()).toBe('projectile');
    const ammoAfterFire = f.ammo;
    f.onPress(makeCtx(1.5)); // projectile still flying — ignored
    expect(f.ammo).toBe(ammoAfterFire);
  });

  it('after raisingMs, transitions to projectile and decrements ammo', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    // Advance 400ms → past raisingMs (300ms)
    f.onFrame(makeCtx(1.4), 0.4);
    expect(f.phase()).toBe('projectile');
    expect(f.ammo).toBe(FLARE_GUN.ammoMax - 1);
  });

  it('projectile collision calls spawnStuckFlare with hit pos + body, returns to idle', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);

    let hitPos: any = null;
    let hitBody: any = null;
    f.spawnStuckFlare = (pos, body) => { hitPos = pos; hitBody = body; };

    const hitResult = { pos: { x: 10, y: 0, z: -15 }, body: { handle: 42 } as any };
    f.raycastFn = () => hitResult;

    f.onPress(makeCtx(1));
    f.onFrame(makeCtx(1.4), 0.4); // past raisingMs → projectile

    // Projectile is now in flight. Advance a frame — the raycast should detect hit.
    f.onFrame(makeCtx(1.5), 0.1);

    expect(hitPos).toEqual({ x: 10, y: 0, z: -15 });
    expect(hitBody).toEqual(hitResult.body);
    expect(f.phase()).toBe('idle');
    expect(f.hasProjectile()).toBe(false);
  });

  it('returns to idle after projectile expires (world-bounds)', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.raycastFn = () => null; // no hit
    f.onPress(makeCtx(1));
    f.onFrame(makeCtx(1.4), 0.4); // → projectile

    // After several seconds, projectile should be out of bounds (FLARE_MAX_RANGE_M = 60)
    // At 25 m/s, 3 seconds = 75m > 60m. But the check is against dist from spawn
    // which accumulates over time. Let's advance enough frames.
    for (let t = 1.5; t < 4.0; t += 0.1) {
      f.onFrame(makeCtx(t), 0.1);
      if (f.phase() === 'idle') break;
    }
    expect(f.phase()).toBe('idle');
  });

  it('onRelease during raising is a no-op (flare commits once raising starts)', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    f.onRelease(makeCtx(1.1));
    // Should still be raising, onFrame at 1.4s marks raising complete
    f.onFrame(makeCtx(1.4), 0.4);
    expect(f.phase()).toBe('projectile'); // still fires despite release
  });

  it('onPress with 0 ammo is no-op', () => {
    const f = new FlareGun();
    f.ammo = 0;
    f.onFrame(makeCtx(0), 0);
    f.onPress(makeCtx(1));
    expect(f.phase()).toBe('idle');
  });

  it('chargeFraction returns 0 (no charge mechanic)', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    expect(f.chargeFraction()).toBe(0);
    f.onPress(makeCtx(1));
    expect(f.chargeFraction()).toBe(0); // even during raising
  });
});

// ——— Per-frame segment-sweep collision (2026-06-17 flare-stuck fix) —————————
// Regression: flares fired upward that hit nothing used to freeze midair
// because collision was a single spawn→current chord raycast. Once the arc
// passed its apex and the chord stopped pointing at the floor, the flare
// sailed through the ground and never resolved. Fix: per-frame segment sweep
// (prevPos→newPos), mirroring NotBlood MoveMissile's frame-by-frame clipmove.

describe('FlareGun projectile segment-sweep collision', () => {
  /** makeCtx with a custom (upward) aim. */
  function makeCtxUp(now: number, forward: Vec3): FrameCtx {
    const c = makeCtx(now);
    c.player.forward = forward;
    return c;
  }

  /**
   * Floor raycast modeled as continuous-collision-detection: a hit is only
   * reported when a SHORT per-frame sweep crosses the floor plane. A long
   * spawn→current chord (the bug) is rejected (maxDist too large) — which is
   * exactly why arcing flares missed the floor in production. Matches the
   * production raycastFn signature (from, dir, maxDist) → hit|null.
   */
  function makeFloorRaycast(floorY = 0) {
    return (from: Vec3, dir: Vec3, maxDist: number): { pos: Vec3; body: null } | null => {
      if (maxDist > 3) return null; // reject long chords (CCD sweeps short segments)
      const endY = from.y + dir.y * maxDist;
      if (from.y > floorY && endY <= floorY && dir.y < 0) {
        const frac = (floorY - from.y) / (dir.y * maxDist);
        return {
          pos: {
            x: from.x + dir.x * maxDist * frac,
            y: floorY,
            z: from.z + dir.z * maxDist * frac,
          },
          body: null,
        };
      }
      return null;
    };
  }

  it('arcing flare that hits nothing lands on the floor (segment sweep), not frozen midair', () => {
    const f = new FlareGun();
    // ~60° elevation: horizontal range (~56m) stays under FLARE_MAX_RANGE_M so
    // the world-bounds guard can't steal the despawn — the floor hit must.
    const forward: Vec3 = { x: 0, y: 0.866, z: -0.5 };
    const mkCtx = (now: number) => makeCtxUp(now, forward);

    f.onFrame(mkCtx(0), 0);

    let stuckAt: Vec3 | null = null;
    f.spawnStuckFlare = (pos) => { stuckAt = pos; };
    f.raycastFn = makeFloorRaycast(0);

    f.onPress(mkCtx(1));
    f.onFrame(mkCtx(1.4), 0.4); // past raisingMs → projectile (spawnTime = 1.4)
    expect(f.phase()).toBe('projectile');

    let landedAt = -1;
    for (let t = 1.5; t < 1.4 + FLARE_GUN.maxLifetimeSec; t += 0.05) {
      f.onFrame(mkCtx(t), 0.05);
      if (f.phase() === 'idle') { landedAt = t; break; }
    }

    // It must leave the projectile phase (the bug left it stuck forever)…
    expect(landedAt).toBeGreaterThan(-1);
    // …via collision, well before the lifetime safety net kicks in…
    expect(landedAt).toBeLessThan(1.4 + FLARE_GUN.maxLifetimeSec);
    // …landing on the floor (y≈0), spawning a StuckFlare.
    expect(stuckAt).not.toBeNull();
    expect(stuckAt!.y).toBeCloseTo(0, 1);
    expect(f.hasProjectile()).toBe(false);
  });

  it('lifetime safety net extinguishes a flare that never collides (defense in depth)', () => {
    const f = new FlareGun();
    f.onFrame(makeCtx(0), 0);
    f.raycastFn = () => null; // threads through all geometry — never collides
    let stuck = false;
    f.spawnStuckFlare = () => { stuck = true; };

    f.onPress(makeCtx(1));
    f.onFrame(makeCtx(1.4), 0.4); // → projectile (spawnTime = 1.4)

    // Jump one frame past the max lifetime. The lifetime check runs first in
    // advanceProjectile (before collision/range), so the safety net
    // deterministically extinguishes — a flare can never live forever.
    f.onFrame(makeCtx(1.4 + FLARE_GUN.maxLifetimeSec + 0.5), 0.5);

    expect(f.phase()).toBe('idle');
    expect(f.hasProjectile()).toBe(false);
    expect(stuck).toBe(false); // extinguished, not stuck
  });
});
