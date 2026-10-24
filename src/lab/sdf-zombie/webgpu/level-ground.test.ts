// src/lab/sdf-zombie/webgpu/level-ground.test.ts
import { describe, expect, it } from 'vitest';
import { FLAT_GROUND, standingFloor, type LevelGround } from './level-ground';

describe('standingFloor', () => {
  it('is 0 on flat ground', () => expect(standingFloor(FLAT_GROUND, 3, -7)).toBe(0));
  it('is the floor inside a sector and 0 outside every sector', () => {
    const g: LevelGround = { ...FLAT_GROUND, floorAt: (x) => (x > 0 ? 0.5 : NaN) };
    expect(standingFloor(g, 1, 0)).toBe(0.5);
    expect(standingFloor(g, -1, 0)).toBe(0);
  });
});
