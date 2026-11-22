import { describe, expect, it } from 'vitest';
import { at32, doomScale, doomScaleOf } from './doom-scale.mjs';

describe('doom-scale: poses written at 32 units/m follow the level scale', () => {
  it('reads the level unitsPerM (none: 32)', () => {
    expect(doomScaleOf({ unitsPerM: 35 })).toBeCloseTo(32 / 35, 12);
    expect(doomScaleOf({})).toBe(1);
    expect(() => doomScaleOf({ unitsPerM: 0 })).toThrow(/bad unitsPerM/);
  });
  it('scales x and z, and an absent level file is scale 1', () => {
    expect(at32(32 / 40, 10, -20)).toEqual([8, -16]);
    expect(doomScale('/nonexistent/doom.level.json')).toBe(1);
  });
});
