import { describe, it, expect } from 'vitest';
import { chargeFraction, throwVelocityMps, remainingFuse, fuseFrameIndex, throwVector, Dynamite } from './dynamite';
import type { FrameCtx } from './types';
import { DYNAMITE_COOK } from '../gibs/tuning';

describe('charge math', () => {
  it('chargeFraction is 0 at 0 held time', () => {
    expect(chargeFraction(0)).toBe(0);
  });
  it('chargeFraction is 1 at maxChargeSec', () => {
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec)).toBe(1);
  });
  it('chargeFraction clamps to 1 beyond maxChargeSec', () => {
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec + 1)).toBe(1);
  });
  it('chargeFraction is 0.5 at half maxChargeSec', () => {
    expect(chargeFraction(DYNAMITE_COOK.maxChargeSec / 2)).toBe(0.5);
  });
});

describe('throw velocity', () => {
  it('is min at 0 charge', () => {
    expect(throwVelocityMps(0)).toBeCloseTo(DYNAMITE_COOK.minVelocityMps, 3);
  });
  it('is max at full charge', () => {
    expect(throwVelocityMps(1)).toBeCloseTo(DYNAMITE_COOK.maxVelocityMps, 3);
  });
  it('is linear midway', () => {
    const mid = (DYNAMITE_COOK.minVelocityMps + DYNAMITE_COOK.maxVelocityMps) / 2;
    expect(throwVelocityMps(0.5)).toBeCloseTo(mid, 3);
  });
});

describe('remainingFuse', () => {
  it('is fuseMaxSec when released at 0 cook', () => {
    expect(remainingFuse(0)).toBe(DYNAMITE_COOK.fuseMaxSec);
  });
  it('is 0 when released exactly at fuseMax', () => {
    expect(remainingFuse(DYNAMITE_COOK.fuseMaxSec)).toBe(0);
  });
  it('is negative if released past fuseMax — caller detonates in-flight at 0', () => {
    expect(remainingFuse(DYNAMITE_COOK.fuseMaxSec + 1)).toBeLessThan(0);
  });
});

describe('fuseFrameIndex (Blood SEQ picnum cycle for thrown bundle)', () => {
  it('returns 0 for single-frame degenerate case', () => {
    expect(fuseFrameIndex(1, 2, 1)).toBe(0);
    expect(fuseFrameIndex(0, 2, 1)).toBe(0);
  });
  it('full fuse → frame 0 (fresh)', () => {
    expect(fuseFrameIndex(2.0, 2.0, 4)).toBe(0);
  });
  it('zero fuse → last frame (about to detonate)', () => {
    expect(fuseFrameIndex(0, 2.0, 4)).toBe(3);
  });
  it('negative fuse clamps to last frame', () => {
    expect(fuseFrameIndex(-0.5, 2.0, 4)).toBe(3);
  });
  it('monotone-decreasing: later in flight = higher (or equal) frame index', () => {
    const f = (t: number) => fuseFrameIndex(t, 2.0, 4);
    // t = fuseLeft going 2.0 → 0 means time elapsed 0 → 2.0
    expect(f(2.0)).toBeLessThanOrEqual(f(1.5));
    expect(f(1.5)).toBeLessThanOrEqual(f(1.0));
    expect(f(1.0)).toBeLessThanOrEqual(f(0.5));
    expect(f(0.5)).toBeLessThanOrEqual(f(0));
  });
  it('partitions fuse range evenly across frames', () => {
    // With 4 frames and fuseMax=2.0, each frame covers 0.5s.
    // frac<0.25 → 0, 0.25-0.5 → 1, 0.5-0.75 → 2, 0.75+ → 3
    expect(fuseFrameIndex(2.0, 2.0, 4)).toBe(0);   // frac=1 → elapsed frac=0 → 0
    expect(fuseFrameIndex(1.5, 2.0, 4)).toBe(1);   // elapsed frac=0.25 → 1
    expect(fuseFrameIndex(1.0, 2.0, 4)).toBe(2);   // elapsed frac=0.5 → 2
    expect(fuseFrameIndex(0.5, 2.0, 4)).toBe(3);   // elapsed frac=0.75 → 3
  });
  it('zero fuseMax → last frame (degenerate)', () => {
    expect(fuseFrameIndex(0, 0, 4)).toBe(3);
  });
});

describe('throwVector (Blood pitch-biased lob port)', () => {
  const SPEED = 10;

  it('magnitude equals speed (pure rotation + scale)', () => {
    const forward = { x: 0, y: 0, z: -1 }; // looking -Z (level)
    const v = throwVector(forward, SPEED, 30);
    const mag = Math.hypot(v.x, v.y, v.z);
    expect(mag).toBeCloseTo(SPEED, 5);
  });

  it('level aim produces upward Y component equal to speed*sin(pitchLob)', () => {
    const forward = { x: 0, y: 0, z: -1 };
    const v = throwVector(forward, SPEED, 30);
    expect(v.y).toBeCloseTo(SPEED * Math.sin((30 * Math.PI) / 180), 5);
    expect(v.y).toBeGreaterThan(0);
  });

  it('preserves forward yaw — throwing at -Z stays in the XZ plane aligned to -Z', () => {
    const forward = { x: 0, y: 0, z: -1 };
    const v = throwVector(forward, SPEED, 30);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.z).toBeLessThan(0);
  });

  it('aiming downward still has a Y-component more upward than the input forward', () => {
    // Aim 45° down: forward = (0, -sin45, -cos45)
    const down = Math.SQRT1_2;
    const forward = { x: 0, y: -down, z: -down };
    const v = throwVector(forward, SPEED, 30);
    // The Y of the thrown vector should be strictly greater than forward.y * speed
    // (i.e., the lob rotates it upward from the aim).
    expect(v.y).toBeGreaterThan(forward.y * SPEED);
  });

  it('aiming level with 0 lob returns forward * speed exactly', () => {
    const forward = { x: 0, y: 0, z: -1 };
    const v = throwVector(forward, SPEED, 0);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(-SPEED, 5);
  });

  it('yaw right — throwing at +X has positive X and positive Y (upward lob)', () => {
    const forward = { x: 1, y: 0, z: 0 };
    const v = throwVector(forward, SPEED, 30);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
    expect(v.z).toBeCloseTo(0, 5);
  });
});

// ———————————————————————————————————————————————————————————————————————
// FSM tests — 4-state machine: equipping → idle → cooking → throwing
//
// Blood's BUNUP2 (dynamite-raise, 420ms) is the weapon-equip animation — hands
// rise, lighter flicks, flame meets wick, bundle settles. It plays ONCE on
// equip, not on every trigger press. Subsequent trigger presses transition
// idle → cooking directly, so there's no weapon-swap animation between shots.
//
// See docs/dev-notes/2026-04-22-notblood-source-reference.md for the canonical
// Blood state machine this mirrors.
//
// NOTE: Projectile body + detonation now live in src/sim/ (plan 3, Task 7).
// FSM tests below check the weapon phase machine and hook invocation only.
// Impact-detonate + displacement grace tests are in src/sim/projectile.test.ts.
// ———————————————————————————————————————————————————————————————————————

function makeCtx(now: number): FrameCtx {
  return {
    world: {} as any,
    player: {
      pos: { x: 0, y: 1.75, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      handPos: { x: 0, y: 1, z: 0 },
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

/** Construct a Dynamite and drive it past the equip animation so `idle` is reached.
 *  Returns the dynamite and the post-equip time (equipEnd) the caller can start from. */
function equipped(): { d: Dynamite; equipEnd: number } {
  const d = new Dynamite();
  d.onFrame(makeCtx(0), 0);        // lazy-init: enters 'equipping', phaseEnteredAt=0
  d.onFrame(makeCtx(0.45), 0.45);  // equippingMs=420ms elapsed → idle
  return { d, equipEnd: 0.45 };
}

describe('Dynamite FSM', () => {
  it('starts in EQUIPPING (before any onFrame)', () => {
    const d = new Dynamite();
    expect(d.phase()).toBe('equipping');
    expect(d.isFuseLit()).toBe(false);
  });

  it('EQUIPPING auto-advances to IDLE after equippingMs', () => {
    const d = new Dynamite();
    d.onFrame(makeCtx(0), 0);        // lazy-init
    d.onFrame(makeCtx(0.45), 0.45);  // past equippingMs=420ms
    expect(d.phase()).toBe('idle');
    expect(d.isFuseLit()).toBe(true);
  });

  it('onPress during EQUIPPING is a no-op (player can\'t shoot during equip)', () => {
    const d = new Dynamite();
    d.onFrame(makeCtx(0), 0);  // lazy-init, phase=equipping
    d.onPress(makeCtx(0.1));
    expect(d.phase()).toBe('equipping');
  });

  it('onPress during IDLE → COOKING; cook timer starts immediately (no raise replay)', () => {
    const { d, equipEnd } = equipped();
    d.onPress(makeCtx(equipEnd + 0.01));
    expect(d.phase()).toBe('cooking');
    // 1s into cooking → chargeFraction = 0.5 (maxChargeSec = 2s).
    d.onFrame(makeCtx(equipEnd + 0.01 + 1.0), 1.0);
    expect(d.chargeFractionAt(equipEnd + 0.01 + 1.0)).toBeCloseTo(0.5, 1);
  });

  it('onRelease during COOKING → THROWING; ammo decrements', () => {
    const { d, equipEnd } = equipped();
    const ammoBefore = d.ammo;
    d.onPress(makeCtx(equipEnd + 0.01));
    d.onRelease(makeCtx(equipEnd + 0.5));
    expect(d.phase()).toBe('throwing');
    expect(d.ammo).toBe(ammoBefore - 1);
  });

  it('THROWING auto-advances to IDLE after throwingMs (NOT back to equipping)', () => {
    const { d, equipEnd } = equipped();
    d.onPress(makeCtx(equipEnd + 0.01));
    d.onRelease(makeCtx(equipEnd + 0.5));
    d.onFrame(makeCtx(equipEnd + 0.5 + 0.4), 0.4);  // throwingMs=336ms elapsed
    expect(d.phase()).toBe('idle');
    expect(d.isFuseLit()).toBe(true);
  });

  it('second press after throw goes idle → cooking directly (no re-equip)', () => {
    const { d, equipEnd } = equipped();
    d.onPress(makeCtx(equipEnd + 0.01));
    d.onRelease(makeCtx(equipEnd + 0.5));
    d.onFrame(makeCtx(equipEnd + 0.9), 0.4);   // throwing → idle
    d.onPress(makeCtx(equipEnd + 1.0));
    expect(d.phase()).toBe('cooking');          // straight to cooking — no equipping replay
  });

  it('onRelease during IDLE is a no-op', () => {
    const { d, equipEnd } = equipped();
    const ammoBefore = d.ammo;
    d.onRelease(makeCtx(equipEnd + 0.1));
    expect(d.phase()).toBe('idle');
    expect(d.ammo).toBe(ammoBefore);
  });

  it('overcook during COOKING → self-explode, phase returns to IDLE', () => {
    const { d, equipEnd } = equipped();
    const press = equipEnd + 0.01;
    d.onPress(makeCtx(press));
    d.onFrame(makeCtx(press + 2.01), 2.01);  // past fuseMaxSec (2s)
    expect(d.phase()).toBe('idle');
  });

  it('throwHook is called on release with speed and impact=true', () => {
    const { d, equipEnd } = equipped();
    let hookedSpeed = -1;
    let hookedImpact = false;
    d.throwHook = (speedMps, impact) => {
      hookedSpeed = speedMps;
      hookedImpact = impact;
    };
    d.onPress(makeCtx(equipEnd + 0.01));
    d.onRelease(makeCtx(equipEnd + 0.5));
    expect(hookedSpeed).toBeGreaterThan(0);
    expect(hookedImpact).toBe(true);
    expect(d.phase()).toBe('throwing');
  });

  it('throwHook receives charge-proportional speed', () => {
    const { d: d1, equipEnd: e1 } = equipped();
    const { d: d2, equipEnd: e2 } = equipped();
    let speed1 = 0, speed2 = 0;
    d1.throwHook = (s) => { speed1 = s; };
    d2.throwHook = (s) => { speed2 = s; };
    // Minimal charge
    d1.onPress(makeCtx(e1 + 0.01));
    d1.onRelease(makeCtx(e1 + 0.01)); // near 0 cook
    // Full charge
    d2.onPress(makeCtx(e2 + 0.01));
    d2.onRelease(makeCtx(e2 + 0.01 + DYNAMITE_COOK.maxChargeSec + 0.1)); // full cook
    expect(speed2).toBeGreaterThan(speed1);
  });
});
