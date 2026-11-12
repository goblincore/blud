import { describe, expect, it } from 'vitest';
import { fleshPin, FLESH_BREATH, FLESH_VEINS } from './sector-flesh.wgsl';

describe('flesh wgsl', () => {
  it('each string is one fn, and every constant smoothstep has low < high', () => {
    for (const s of [FLESH_BREATH, FLESH_VEINS]) {
      expect(s.match(/^fn /gm)).toHaveLength(1);
      for (const m of s.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) expect(Number(m[1])).toBeLessThan(Number(m[2]));
    }
  });
});

describe('fleshPin', () => {
  it('is 0 on every edge and 1 well inside', () => {
    expect(fleshPin(0, 4, 1, 3)).toBe(0);
    expect(fleshPin(4, 4, 1, 3)).toBe(0);
    expect(fleshPin(2, 4, 0, 3)).toBe(0);
    expect(fleshPin(2, 4, 3, 3)).toBe(0);
    expect(fleshPin(2, 4, 1.5, 3)).toBe(1);
  });
  it('a sliver of a wall stays nearly still', () => {
    expect(fleshPin(0.1, 0.2, 1.5, 3)).toBeLessThan(0.3);
  });
});
