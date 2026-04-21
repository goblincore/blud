import { describe, it, expect } from 'vitest';
import { ZombieBrain, ZombieState } from './ai';
import { AXE_ZOMBIE } from '../gibs/tuning';

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
