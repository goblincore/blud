import { describe, it, expect, vi } from 'vitest';
import { ZombieBrain, ZombieState, nextStateGivenBurningContext } from './ai';
import { AXE_ZOMBIE, BURN } from '../gibs/tuning';

const INIT = { hp: AXE_ZOMBIE.hp, speed: AXE_ZOMBIE.speed };

describe('ZombieBrain', () => {
  it('starts in idle', () => {
    const b = new ZombieBrain(INIT);
    expect(b.state).toBe(ZombieState.Idle);
  });

  it('transitions idle → chase on player within aggroRadius', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Chase);
  });

  it('stays idle when player is outside aggroRadius', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }); // > 40 m
    expect(b.state).toBe(ZombieState.Idle);
  });

  it('transitions chase → attack when within meleeRange', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 }); // < 1.5 m
    expect(b.state).toBe(ZombieState.Attack);
  });

  it('emits hit event during attack cooldown once', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.consumeHit()).toBe(true);  // attack starts → registers intent
    expect(b.consumeHit()).toBe(false); // second consume same frame = no
    // Advance past cooldown
    for (let t = 0; t < 1.1; t += 0.016) b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.consumeHit()).toBe(true);  // fresh attack
  });

  it('transitions to dead on hp <= 0', () => {
    const b = new ZombieBrain(INIT);
    b.applyDamage(AXE_ZOMBIE.hp + 5);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Dead);
  });

  it('stagger state blocks attack for staggerMs, then returns to chase', () => {
    const b = new ZombieBrain(INIT);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 }); // enter attack
    b.applyDamage(5); // stagger
    expect(b.state).toBe(ZombieState.Stagger);
    for (let t = 0; t < 0.3; t += 0.016) b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Chase);
  });

  it('desiredVelocity points from self toward player while chasing, scaled by speed', () => {
    const b = new ZombieBrain(INIT);
    const v = b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 });
    // Unit dir (0.6, 0, 0.8) * speed 3 = (1.8, 0, 2.4)
    expect(v.x).toBeCloseTo(AXE_ZOMBIE.speed * 0.6, 3);
    expect(v.y).toBeCloseTo(0, 3);
    expect(v.z).toBeCloseTo(AXE_ZOMBIE.speed * 0.8, 3);
  });

  it('desiredVelocity is zero when not chasing', () => {
    const b = new ZombieBrain(INIT);
    const v = b.desiredVelocity({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 });
    expect(v.x).toBe(0); expect(v.z).toBe(0);
  });
});

describe('nextStateGivenBurningContext', () => {
  it('returns Dead when hp <= 0', () => {
    expect(nextStateGivenBurningContext(ZombieState.Burning, 0, 1, ZombieState.Chase)).toBe(ZombieState.Dead);
    expect(nextStateGivenBurningContext(ZombieState.Idle, 0, 1, ZombieState.Chase)).toBe(ZombieState.Dead);
  });

  it('returns Burning when stuckFlareCount > 0 and hp > 0', () => {
    expect(nextStateGivenBurningContext(ZombieState.Idle, 50, 1, ZombieState.Chase)).toBe(ZombieState.Burning);
    expect(nextStateGivenBurningContext(ZombieState.Chase, 50, 3, ZombieState.Idle)).toBe(ZombieState.Burning);
  });

  it('returns prevState when currently Burning with no flares left', () => {
    expect(nextStateGivenBurningContext(ZombieState.Burning, 50, 0, ZombieState.Chase)).toBe(ZombieState.Chase);
    expect(nextStateGivenBurningContext(ZombieState.Burning, 50, 0, ZombieState.Idle)).toBe(ZombieState.Idle);
  });

  it('returns current when not Burning and no flares', () => {
    expect(nextStateGivenBurningContext(ZombieState.Idle, 50, 0, ZombieState.Chase)).toBe(ZombieState.Idle);
    expect(nextStateGivenBurningContext(ZombieState.Chase, 50, 0, ZombieState.Idle)).toBe(ZombieState.Chase);
  });
});

describe('ZombieBrain — Burning state', () => {
  it('enters Burning when stuckFlareCount > 0', () => {
    const hooks = { onBurningStart: vi.fn() };
    const b = new ZombieBrain(INIT, hooks);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }); // Chase
    expect(b.state).toBe(ZombieState.Chase);
    b.setStuckFlareCount(1);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Burning);
    expect(hooks.onBurningStart).toHaveBeenCalledOnce();
  });

  it('exits Burning when stuckFlareCount drops to 0, restoring prevState', () => {
    const hooks = { onBurningEnd: vi.fn() };
    const b = new ZombieBrain(INIT, hooks);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }); // Chase
    b.setStuckFlareCount(1);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }); // Burning
    expect(b.state).toBe(ZombieState.Burning);
    b.setStuckFlareCount(0);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Chase); // restored
    expect(hooks.onBurningEnd).toHaveBeenCalledOnce();
  });

  it('exits Burning on death with onCharredDeath hook', () => {
    const hooks = { onCharredDeath: vi.fn() };
    const b = new ZombieBrain(INIT, hooks);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 }); // enter attack
    b.setStuckFlareCount(1);
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 }); // Burning
    expect(b.state).toBe(ZombieState.Burning);
    b.applyDamage(AXE_ZOMBIE.hp + 5); // lethal
    b.update(0.016, { x: 0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Dead);
    expect(hooks.onCharredDeath).toHaveBeenCalledOnce();
  });

  it('Burning state walks toward player at reduced speed (NotBlood: 0.80×)', () => {
    const b = new ZombieBrain(INIT);
    const self = { x: 0, y: 0, z: 0 };
    const player = { x: 10, y: 0, z: 0 };
    b.setStuckFlareCount(1);
    b.update(0.016, self, player);
    expect(b.state).toBe(ZombieState.Burning);

    const v = b.desiredVelocity(self, player);
    // Direction should be toward player (positive x)
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBe(0);
    expect(v.z).toBeCloseTo(0, 5);
    // Magnitude = speed * zombieBurnSpeedMul (0.8), less than normal walk speed
    const mag = Math.hypot(v.x, v.z);
    expect(mag).toBeCloseTo(AXE_ZOMBIE.speed * BURN.zombieBurnSpeedMul, 3);
    expect(mag).toBeLessThan(AXE_ZOMBIE.speed);
    expect(mag).toBeGreaterThan(0);
  });

  it('Burning state velocity scales with player distance (direction, not magnitude)', () => {
    const b = new ZombieBrain(INIT);
    const self = { x: 0, y: 0, z: 0 };
    b.setStuckFlareCount(1);
    b.update(0.016, self, { x: 10, y: 0, z: 0 });
    expect(b.state).toBe(ZombieState.Burning);

    // When player is far, direction points toward player, magnitude is fixed
    const v = b.desiredVelocity(self, { x: 0, y: 0, z: 100 });
    expect(v.z).toBeGreaterThan(0);
    const mag = Math.hypot(v.x, v.z);
    expect(mag).toBeCloseTo(AXE_ZOMBIE.speed * BURN.zombieBurnSpeedMul, 3);
  });

  it('does not stagger out of Burning on non-lethal damage', () => {
    const b = new ZombieBrain(INIT);
    const self = { x: 0, y: 0, z: 0 };
    const player = { x: 10, y: 0, z: 0 };
    b.setStuckFlareCount(1);
    b.update(0.016, self, player);
    expect(b.state).toBe(ZombieState.Burning);

    b.applyDamage(5); // non-lethal
    expect(b.state).toBe(ZombieState.Burning); // stays Burning, not Stagger
  });

  it('stays Burning while flares remain attached across multiple frames', () => {
    const b = new ZombieBrain(INIT);
    const self = { x: 0, y: 0, z: 0 };
    const player = { x: 10, y: 0, z: 0 };
    b.setStuckFlareCount(2);
    b.update(0.016, self, player);
    expect(b.state).toBe(ZombieState.Burning);

    // Many frames, still burning
    for (let t = 0; t < 3.0; t += 0.016) {
      b.setStuckFlareCount(2); // caller re-sets each frame
      b.update(0.016, self, player);
    }
    expect(b.state).toBe(ZombieState.Burning);
  });
});
