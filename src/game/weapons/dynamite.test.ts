import { describe, it, expect } from 'vitest';
import { chargeFraction, throwVelocityMps, remainingFuse, throwVector, Dynamite, resetProjectiles } from './dynamite';
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
// ———————————————————————————————————————————————————————————————————————

function makeCtx(now: number): FrameCtx {
  const stubBody = {
    setLinvel: () => {},
    setAngvel: () => {},
    translation: () => ({ x: 0, y: 0, z: 0 }),
  };
  return {
    world: {
      createRigidBody: () => stubBody,
      createCollider: () => {},
      removeRigidBody: () => {},
    } as any,
    player: {
      pos: { x: 0, y: 0, z: 0 },
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
  resetProjectiles(makeCtx(0).world);
  const d = new Dynamite();
  d.onFrame(makeCtx(0), 0);        // lazy-init: enters 'equipping', phaseEnteredAt=0
  d.onFrame(makeCtx(0.45), 0.45);  // equippingMs=420ms elapsed → idle
  return { d, equipEnd: 0.45 };
}

describe('Dynamite FSM', () => {
  it('starts in EQUIPPING (before any onFrame)', () => {
    resetProjectiles(makeCtx(0).world);
    const d = new Dynamite();
    expect(d.phase()).toBe('equipping');
    expect(d.isFuseLit()).toBe(false);
  });

  it('EQUIPPING auto-advances to IDLE after equippingMs', () => {
    resetProjectiles(makeCtx(0).world);
    const d = new Dynamite();
    d.onFrame(makeCtx(0), 0);        // lazy-init
    d.onFrame(makeCtx(0.45), 0.45);  // past equippingMs=420ms
    expect(d.phase()).toBe('idle');
    expect(d.isFuseLit()).toBe(true);
  });

  it('onPress during EQUIPPING is a no-op (player can\'t shoot during equip)', () => {
    resetProjectiles(makeCtx(0).world);
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
});
