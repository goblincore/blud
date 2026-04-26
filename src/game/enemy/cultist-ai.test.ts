import { describe, it, expect, vi } from 'vitest';
import { CultistBrain, CultistState, pelletSpread, withinFireRange, pelletEndPos, applyHorizontalJitter } from './cultist-ai';
import { SHOTGUN_CULTIST, SHOTGUN_BLAST, BURN, TOMMY_CULTIST, TOMMY_BULLET } from '../gibs/tuning';

const INIT = { hp: SHOTGUN_CULTIST.hp, speed: SHOTGUN_CULTIST.walkSpeedMps };

// ——— Pure-math fn tests ———————————————————————————

describe('pelletSpread', () => {
  it('returns 0 for single pellet', () => {
    expect(pelletSpread(0, 1, 14)).toBe(0);
  });

  it('fans pellets evenly across [-coneDeg, +coneDeg]', () => {
    // 7 pellets, 14° cone: offsets -14, -9.33, -4.67, 0, 4.67, 9.33, 14
    expect(pelletSpread(0, 7, 14)).toBeCloseTo(-14, 2);
    expect(pelletSpread(3, 7, 14)).toBeCloseTo(0, 2);
    expect(pelletSpread(6, 7, 14)).toBeCloseTo(14, 2);
  });

  it('handles 2-pellet case', () => {
    expect(pelletSpread(0, 2, 10)).toBeCloseTo(-10, 2);
    expect(pelletSpread(1, 2, 10)).toBeCloseTo(10, 2);
  });
});

describe('withinFireRange', () => {
  it('true when self is within range of player', () => {
    expect(withinFireRange({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 12)).toBe(true);
    expect(withinFireRange({ x: 0, y: 0, z: 0 }, { x: 0, y: 12, z: 0 }, 12)).toBe(true);
  });

  it('false when self is outside range', () => {
    expect(withinFireRange({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, 12)).toBe(false);
  });

  it('handles exact boundary', () => {
    expect(withinFireRange({ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }, 12)).toBe(true);
    expect(withinFireRange({ x: 0, y: 0, z: 0 }, { x: 12.01, y: 0, z: 0 }, 12)).toBe(false);
  });
});

describe('pelletEndPos', () => {
  it('moves straight along direction at given speed', () => {
    const result = pelletEndPos(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      0.5,
      55,
    );
    expect(result.x).toBeCloseTo(27.5, 2); // 55 * 0.5 = 27.5
    expect(result.y).toBeCloseTo(0, 2);
    expect(result.z).toBeCloseTo(0, 2);
  });

  it('handles diagonal direction', () => {
    const len = Math.sqrt(2);
    const result = pelletEndPos(
      { x: 0, y: 0, z: 0 },
      { x: 1 / len, y: 0, z: 1 / len },
      1.0,
      55,
    );
    const expected = 55 / len;
    expect(result.x).toBeCloseTo(expected, 2);
    expect(result.z).toBeCloseTo(expected, 2);
  });
});

// ——— Brain FSM tests ——————————————————————————————

describe('CultistBrain', () => {
  it('starts in Idle', () => {
    const b = new CultistBrain(INIT);
    expect(b.state).toBe(CultistState.Idle);
    expect(b.hp).toBe(SHOTGUN_CULTIST.hp);
  });

  it('Idle → Chase when player within aggroRadiusM', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Chase);
  });

  it('stays Idle when player outside aggroRadiusM', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Idle);
  });

  it('Chase → Aim when within fireRangeM + has line of sight', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, true);  // Chase→Aim
    expect(b.state).toBe(CultistState.Aim);
  });

  it('Aim → Fire after fireWindupSec elapsed', () => {
    let fakeNow = 0;
    const b = new CultistBrain(INIT, undefined, () => fakeNow);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim

    expect(b.state).toBe(CultistState.Aim);

    // Not enough time yet
    fakeNow = 0.3;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Aim);

    // After windup
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Recoil); // Fire → Recoil on same frame
  });

  it('Fire triggers onFire hook then transitions to Recoil', () => {
    let fired = false;
    const hooks = {
      onFire: vi.fn((_origin, _dir) => { fired = true; }),
    };
    let fakeNow = 0;
    const b = new CultistBrain(INIT, hooks, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire→Recoil

    expect(fired).toBe(true);
    expect(hooks.onFire).toHaveBeenCalledOnce();
    expect(b.state).toBe(CultistState.Recoil);
  });

  it('Recoil → Chase after recoilDurationSec', () => {
    let fakeNow = 0;
    const b = new CultistBrain(INIT, undefined, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Fire→Recoil

    expect(b.state).toBe(CultistState.Recoil);

    // Not enough time yet
    fakeNow = 0.7;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Recoil);

    // After recoil duration
    fakeNow = 0.9;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Chase);
  });

  it('Chase → Idle when player leaves aggroRadiusM', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    expect(b.state).toBe(CultistState.Chase);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, false); // outside aggro
    expect(b.state).toBe(CultistState.Idle);
  });

  it('Aim aborts back to Chase if player leaves fireRangeM', () => {
    let fakeNow = 0;
    const b = new CultistBrain(INIT, undefined, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    expect(b.state).toBe(CultistState.Aim);

    // Player retreats
    fakeNow = 0.2;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, true); // outside fireRange
    expect(b.state).toBe(CultistState.Chase);
  });

  it('* → Recoil on applyDamage (unless already Dead or Recoil)', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    expect(b.state).toBe(CultistState.Chase);
    b.applyDamage(5);
    expect(b.state).toBe(CultistState.Recoil);
  });

  it('* → Dead when hp <= 0', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.applyDamage(SHOTGUN_CULTIST.hp + 5); // lethal
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Dead);
  });

  it('does not transition to Recoil if already in Recoil', () => {
    const hooks = { onRecoil: vi.fn() };
    const b = new CultistBrain(INIT, hooks);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.applyDamage(5); // → Recoil
    expect(b.state).toBe(CultistState.Recoil);
    const callCount = hooks.onRecoil.mock.calls.length;
    b.applyDamage(5); // still Recoil — should not re-enter
    expect(b.state).toBe(CultistState.Recoil);
    expect(hooks.onRecoil).toHaveBeenCalledTimes(callCount); // no additional call
  });

  it('does not transition to Recoil if Dead', () => {
    const b = new CultistBrain(INIT);
    b.applyDamage(SHOTGUN_CULTIST.hp + 5); // kill directly
    expect(b.state).toBe(CultistState.Dead);
    b.applyDamage(5); // should stay Dead
    expect(b.state).toBe(CultistState.Dead);
  });

  it('desiredVelocity is non-zero only in Chase', () => {
    const b = new CultistBrain(INIT);
    const self = { x: 0, y: 0, z: 0 };
    const player = { x: 3, y: 0, z: 4 };

    // Idle → should be zero
    const v1 = b.desiredVelocity(self, player);
    expect(v1.x).toBe(0);
    expect(v1.z).toBe(0);

    // Chase → should point toward player
    b.update(0.016, self, player, false); // Idle→Chase
    const v2 = b.desiredVelocity(self, player);
    const mag2 = Math.hypot(v2.x, v2.z);
    expect(mag2).toBeCloseTo(SHOTGUN_CULTIST.walkSpeedMps, 3);
    expect(v2.x).toBeGreaterThan(0);
    expect(v2.z).toBeGreaterThan(0);
  });

  it('desiredVelocity zero in Aim/Fire/Recoil/Dead', () => {
    const b = new CultistBrain(INIT);
    const self = { x: 0, y: 0, z: 0 };
    const player = { x: 5, y: 0, z: 0 };

    // Force into Aim
    b.update(0.016, self, player, false); // Idle→Chase
    b.update(0.016, self, player, true);  // Chase→Aim
    expect(b.state).toBe(CultistState.Aim);
    const v = b.desiredVelocity(self, player);
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
  });

  it('desiredVelocity zero when Dead', () => {
    const b = new CultistBrain(INIT);
    b.applyDamage(SHOTGUN_CULTIST.hp + 5);
    const v = b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
  });

  it('triggers onAggroTransition when Idle → Chase', () => {
    const hooks = { onAggroTransition: vi.fn() };
    const b = new CultistBrain(INIT, hooks);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Chase);
    expect(hooks.onAggroTransition).toHaveBeenCalledOnce();
  });

  it('triggers onDeath when hp reaches 0 during update', () => {
    const hooks = { onDeath: vi.fn() };
    const b = new CultistBrain(INIT, hooks);
    b.hp = 0; // force hp to 0
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Dead);
    expect(hooks.onDeath).toHaveBeenCalledOnce();
  });

  // ——— Burning state tests ————————————————————————

  it('enters Burning when stuckFlareCount > 0 and flare is ignited', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    expect(b.state).toBe(CultistState.Chase);
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Burning);
  });

  it('does NOT enter Burning when stuckFlareCount > 0 but flare is NOT ignited', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(false);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Chase); // stays in Chase
  });

  it('Burning → Dead when hp <= 0 (one-way)', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // → Burning
    expect(b.state).toBe(CultistState.Burning);

    b.applyDamage(SHOTGUN_CULTIST.hp + 5); // lethal
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Dead);
  });

  it('Burning → Chase when all flares expire', () => {
    const b = new CultistBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // → Burning
    expect(b.state).toBe(CultistState.Burning);

    b.setStuckFlareCount(0); // flare expired/extinguished
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Chase);
  });

  it('desiredVelocity in Burning is walkSpeedMps * 1.4 toward player', () => {
    const b = new CultistBrain(INIT);
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // → Burning
    expect(b.state).toBe(CultistState.Burning);

    const self = { x: 0, y: 0, z: 0 };
    const player = { x: 3, y: 0, z: 4 };
    const v = b.desiredVelocity(self, player);
    const mag = Math.hypot(v.x, v.z);
    expect(mag).toBeCloseTo(SHOTGUN_CULTIST.walkSpeedMps * BURN.panicSpeedMultiplier, 3);
    expect(v.x).toBeGreaterThan(0); // toward player +X
    expect(v.z).toBeGreaterThan(0); // toward player +Z
  });

  it('does not re-coil when taking damage while Burning', () => {
    const b = new CultistBrain(INIT);
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // → Burning
    expect(b.state).toBe(CultistState.Burning);

    b.applyDamage(5);
    expect(b.state).toBe(CultistState.Burning); // stays Burning, no Recoil
    expect(b.hp).toBe(SHOTGUN_CULTIST.hp - 5);
  });

  it('triggers onCharredDeath when dying from Burning', () => {
    const hooks = { onCharredDeath: vi.fn(), onDeath: vi.fn() };
    const b = new CultistBrain(INIT, hooks);
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // → Burning
    expect(b.state).toBe(CultistState.Burning);

    b.applyDamage(SHOTGUN_CULTIST.hp + 5);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Dead);
    expect(hooks.onCharredDeath).toHaveBeenCalledOnce();
    expect(hooks.onDeath).toHaveBeenCalledOnce();
  });

  it('triggers onBurningStart when entering Burning', () => {
    const hooks = { onBurningStart: vi.fn() };
    const b = new CultistBrain(INIT, hooks);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.setStuckFlareCount(1);
    b.setIsFlareIgnited(true);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Burning);
    expect(hooks.onBurningStart).toHaveBeenCalledOnce();
  });
});

// ——— Tommygun cultist brain tests ——————————————————

const TOMMY_INIT = { hp: TOMMY_CULTIST.hp, speed: TOMMY_CULTIST.walkSpeedMps, fireMode: 'tommy' as const };

describe('TOMMY_CULTIST constant', () => {
  it('has expected tuning values', () => {
    expect(TOMMY_CULTIST.hp).toBe(40);
    expect(TOMMY_CULTIST.walkSpeedMps).toBe(2.3);
    expect(TOMMY_CULTIST.aggroRadiusM).toBe(18);
    expect(TOMMY_CULTIST.fireRangeM).toBe(12);
    expect(TOMMY_CULTIST.fireWindupSec).toBe(0.5);
    expect(TOMMY_CULTIST.recoilDurationSec).toBe(0.4);
  });

  it('TOMMY_BULLET has damage 7', () => {
    expect(TOMMY_BULLET.damage).toBe(7);
  });

  it('TOMMY_BULLET spread half-angle is atan(1200/5120) in degrees', () => {
    const expected = Math.atan(1200 / 5120) * (180 / Math.PI);
    expect(TOMMY_BULLET.spreadHalfAngleDeg).toBeCloseTo(expected, 4);
  });
});

describe('applyHorizontalJitter', () => {
  it('returns original direction when halfAngleDeg is 0', () => {
    const dir = { x: 1, y: 0, z: 0 };
    const result = applyHorizontalJitter(dir, 0);
    expect(result.x).toBeCloseTo(1, 6);
    expect(result.y).toBe(0);
    expect(result.z).toBeCloseTo(0, 6);
  });

  it('returns a direction within the half-angle cone', () => {
    const dir = { x: 1, y: 0, z: 0 };
    const halfAngle = 15; // degrees
    // With rng=1.0 → max positive angle: +15°
    const rightMax = applyHorizontalJitter(dir, halfAngle, () => 1.0);
    // With rng=0.0 → max negative angle: -15°
    const leftMax = applyHorizontalJitter(dir, halfAngle, () => 0.0);

    // Both should be unit vectors (Y=0 plane)
    expect(Math.hypot(rightMax.x, rightMax.z)).toBeCloseTo(1, 6);
    expect(Math.hypot(leftMax.x, leftMax.z)).toBeCloseTo(1, 6);

    // Right max: rotated +15° → z should be positive (sin of +15°)
    expect(rightMax.z).toBeGreaterThan(0);
    // Left max: rotated -15° → z should be negative (sin of -15°)
    expect(leftMax.z).toBeLessThan(0);
  });

  it('produces different directions for different rng values', () => {
    const dir = { x: 1, y: 0, z: 0 };
    const a = applyHorizontalJitter(dir, 30, () => 0.3);
    const b = applyHorizontalJitter(dir, 30, () => 0.9);
    // They should differ on at least one component
    const differs = Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.z - b.z) > 1e-6;
    expect(differs).toBe(true);
  });

  it('preserves Y component', () => {
    const dir = { x: 0.6, y: 0.8, z: 0 };
    const result = applyHorizontalJitter(dir, 20, () => 0.5);
    expect(result.y).toBeCloseTo(0.8, 6);
  });
});

describe('CultistBrain — tommy fire mode', () => {
  it('starts in Idle with fireMode tommy', () => {
    const b = new CultistBrain(TOMMY_INIT);
    expect(b.fireMode).toBe('tommy');
    expect(b.state).toBe(CultistState.Idle);
    expect(b.hp).toBe(TOMMY_CULTIST.hp);
  });

  it('defaults to shotgun fireMode when not specified', () => {
    const b = new CultistBrain({ hp: 40, speed: 2.3 });
    expect(b.fireMode).toBe('shotgun');
  });

  it('Aim → Fire (not Recoil) for tommy after windup', () => {
    let fakeNow = 0;
    const b = new CultistBrain(TOMMY_INIT, undefined, () => fakeNow);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    expect(b.state).toBe(CultistState.Aim);

    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire
    expect(b.state).toBe(CultistState.Fire); // NOT Recoil
  });

  it('fires onFire on every update while in Fire state', () => {
    const hooks = { onFire: vi.fn() };
    let fakeNow = 0;
    const b = new CultistBrain(TOMMY_INIT, hooks, () => fakeNow);

    // Navigate to Fire state
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire
    expect(b.state).toBe(CultistState.Fire);

    // Fire 5 more ticks — should call onFire each time
    const callsBefore = hooks.onFire.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      fakeNow += 0.016;
      b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    }
    expect(hooks.onFire.mock.calls.length).toBe(callsBefore + 5);
  });

  it('exits Fire → Chase when player leaves fireRangeM', () => {
    let fakeNow = 0;
    const b = new CultistBrain(TOMMY_INIT, undefined, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire
    expect(b.state).toBe(CultistState.Fire);

    // Player moves out of fire range
    fakeNow = 0.6;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, true);
    expect(b.state).toBe(CultistState.Chase);
  });

  it('exits Fire → Chase when LOS lost', () => {
    let fakeNow = 0;
    const b = new CultistBrain(TOMMY_INIT, undefined, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire
    expect(b.state).toBe(CultistState.Fire);

    // LOS lost
    fakeNow = 0.6;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, false);
    expect(b.state).toBe(CultistState.Chase);
  });

  it('applyDamage forces Recoil while in Fire', () => {
    let fakeNow = 0;
    const b = new CultistBrain(TOMMY_INIT, undefined, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire
    expect(b.state).toBe(CultistState.Fire);

    b.applyDamage(5);
    expect(b.state).toBe(CultistState.Recoil);
  });

  it('applies per-shot jitter (onFire called with varying directions)', () => {
    const dirs: Array<{ x: number; z: number }> = [];
    const hooks = {
      onFire: vi.fn((_origin: any, dir: any) => {
        dirs.push({ x: dir.x, z: dir.z });
      }),
    };
    let fakeNow = 0;
    const b = new CultistBrain(TOMMY_INIT, hooks, () => fakeNow);

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire
    expect(b.state).toBe(CultistState.Fire);

    dirs.length = 0;
    // Fire 3 more ticks — directions should vary (since Math.random is different each time)
    for (let i = 0; i < 3; i++) {
      fakeNow += 0.016;
      b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);
    }

    expect(dirs.length).toBe(3);
    // At least one pair should differ (probabilistic, but 3 samples with float rng
    // is essentially certain to vary — if this flakes, the jitter is broken)
    const allSame = dirs.every(
      d => Math.abs(d.x - dirs[0]!.x) < 1e-6 && Math.abs(d.z - dirs[0]!.z) < 1e-6,
    );
    expect(allSame).toBe(false);
  });

  it('shotgun path unchanged with fireMode=shotgun', () => {
    // Sanity: construct with explicit shotgun fireMode and verify Aim→Fire→Recoil path
    let fakeNow = 0;
    let fired = false;
    const hooks = {
      onFire: vi.fn(() => { fired = true; }),
    };
    const b = new CultistBrain(
      { hp: SHOTGUN_CULTIST.hp, speed: SHOTGUN_CULTIST.walkSpeedMps, fireMode: 'shotgun' },
      hooks,
      () => fakeNow,
    );

    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, false); // Idle→Chase
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Chase→Aim
    fakeNow = 0.5;
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, true);  // Aim→Fire→Recoil

    expect(fired).toBe(true);
    expect(b.state).toBe(CultistState.Recoil); // shotgun path: Fire→Recoil same frame
  });
});
