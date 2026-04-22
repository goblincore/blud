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
// FSM tests — 4-state machine (idle → raising → cooking → throwing)
// Blood's BUNUP2 animation (dynamite-raise, 420ms) handles raise + lighter-flick +
// ignite + bundle reveal as one continuous visual. Fuse is considered lit once
// raising completes; cook timer starts at raising→cooking transition.
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

describe('Dynamite FSM', () => {
  function freshDyn(): Dynamite {
    resetProjectiles(makeCtx(0).world);
    return new Dynamite();
  }

  it('starts in IDLE', () => {
    const d = freshDyn();
    expect(d.phase()).toBe('idle');
  });

  it('onPress IDLE → RAISING; fuse NOT lit yet', () => {
    const d = freshDyn();
    d.onPress(makeCtx(0));
    expect(d.phase()).toBe('raising');
    expect(d.isFuseLit()).toBe(false);
  });

  it('RAISING auto-advances to COOKING after raiseMs; fuse LIT at transition', () => {
    const d = freshDyn();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.45), 0.45); // raiseMs = 420ms + small buffer
    expect(d.phase()).toBe('cooking');
    expect(d.isFuseLit()).toBe(true);
  });

  it('cook timer starts at raising→cooking transition (NOT at press)', () => {
    const d = freshDyn();
    d.onPress(makeCtx(0));           // t=0 press
    d.onFrame(makeCtx(0.45), 0.45);  // t=0.45 raising→cooking (cook timer STARTS here)
    // At t=1.45 (1s into cooking), chargeFraction should be ~0.5 of 2s maxCharge.
    d.onFrame(makeCtx(1.45), 1.0);
    expect(d.chargeFractionAt(1.45)).toBeCloseTo(0.5, 1);
  });

  it('release during RAISING is queued; on raise-end throws at min charge (fuse just lit)', () => {
    const d = freshDyn();
    const ammoBefore = d.ammo;
    d.onPress(makeCtx(0));
    d.onRelease(makeCtx(0.2));       // before raiseMs elapses
    d.onFrame(makeCtx(0.45), 0.25);  // raise completes → queued release fires → throw
    expect(d.phase()).toBe('throwing');
    expect(d.ammo).toBe(ammoBefore - 1);
  });

  it('release during COOKING → THROWING phase', () => {
    const d = freshDyn();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.45), 0.45);  // cooking
    d.onRelease(makeCtx(1.0));
    expect(d.phase()).toBe('throwing');
  });

  it('THROWING phase ends after throwMs → IDLE', () => {
    const d = freshDyn();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.45), 0.45);
    d.onRelease(makeCtx(1.0));
    d.onFrame(makeCtx(1.5), 0.5);    // throwMs ≈ 336ms
    expect(d.phase()).toBe('idle');
  });

  it('overcook during COOKING → self-explode, phase returns to IDLE', () => {
    const d = freshDyn();
    d.onPress(makeCtx(0));
    d.onFrame(makeCtx(0.45), 0.45);       // cooking from t=0.45
    d.onFrame(makeCtx(0.45 + 2.01), 2.01); // past fuseMaxSec (2s)
    expect(d.phase()).toBe('idle');
  });
});
