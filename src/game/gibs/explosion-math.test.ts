import { describe, it, expect } from 'vitest';
import { falloffDamage, falloffImpulse, radialImpulseVector } from './index';
import { EXPLOSION_STANDARD } from './tuning';

describe('explosion damage falloff', () => {
  it('at distance 0, damage is full (damage + damageRange)', () => {
    const d = falloffDamage(0, EXPLOSION_STANDARD);
    expect(d).toBe(EXPLOSION_STANDARD.damage + EXPLOSION_STANDARD.damageRange);
  });

  it('at distance >= radius (converted to meters), damage is 0', () => {
    const radiusM = EXPLOSION_STANDARD.radius / 256; // BU_PER_METER
    const d = falloffDamage(radiusM, EXPLOSION_STANDARD);
    expect(d).toBe(0);
  });

  it('at half radius, damage is ~half', () => {
    const radiusM = EXPLOSION_STANDARD.radius / 256;
    const d = falloffDamage(radiusM * 0.5, EXPLOSION_STANDARD);
    const full = EXPLOSION_STANDARD.damage + EXPLOSION_STANDARD.damageRange;
    expect(d).toBeCloseTo(full * 0.5, 1);
  });
});

describe('explosion impulse falloff', () => {
  it('at distance 0, impulse is full', () => {
    const i = falloffImpulse(0, EXPLOSION_STANDARD);
    expect(i).toBe(EXPLOSION_STANDARD.impulse);
  });
  it('at radius, impulse is 0', () => {
    const radiusM = EXPLOSION_STANDARD.radius / 256;
    expect(falloffImpulse(radiusM, EXPLOSION_STANDARD)).toBe(0);
  });
});

describe('radialImpulseVector', () => {
  it('produces unit-magnitude * impulse along (target - origin)', () => {
    const v = radialImpulseVector(
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 4 },
      100,
    );
    // Unit vector (0.6, 0, 0.8); scaled by 100 → (60, 0, 80)
    expect(v.x).toBeCloseTo(60, 3);
    expect(v.y).toBeCloseTo(0, 3);
    expect(v.z).toBeCloseTo(80, 3);
  });

  it('returns zero vector when target == origin', () => {
    const v = radialImpulseVector({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }, 100);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });
});
