// src/lab/sdf-zombie/webgpu/sector-glow.wgsl.test.ts

import { describe, expect, it } from 'vitest';
import { GLOW_BASE_RGB, SECTOR_GLOW, SECTOR_GLOW_HASH, SECTOR_GLOW_NOISE } from './sector-glow.wgsl';

describe('sector-glow.wgsl', () => {
  const all = [SECTOR_GLOW_HASH, SECTOR_GLOW_NOISE, SECTOR_GLOW];
  it('each string is exactly one fn with a return type', () => {
    for (const s of all) {
      expect(s.trim().startsWith('fn ')).toBe(true);
      expect(s.match(/^fn /gm)).toHaveLength(1);
      expect(s).toContain('-> ');
    }
  });
  it('the functions call each other', () => {
    expect(SECTOR_GLOW).toContain('sgNoise(');
    expect(SECTOR_GLOW_NOISE).toContain('sgHash(');
  });
  it('every smoothstep has low < high (WGSL makes low >= high a shader-creation error)', () => {
    let seen = 0;
    for (const s of all) for (const m of s.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
      expect(Number(m[1]), m[0]).toBeLessThan(Number(m[2]));
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('has no colon inside a // comment', () => {
    for (const s of all) for (const line of s.split('\n')) {
      const at = line.indexOf('//');
      if (at >= 0) expect(line.slice(at)).not.toContain(':');
    }
  });
  it('GLOW_BASE_RGB matches each kind\'s base colour in the WGSL', () => {
    const v = (c: readonly number[]) => `vec3<f32>(${c.map(x => x.toFixed(2)).join(', ')})`;
    for (const c of Object.values(GLOW_BASE_RGB)) expect(SECTOR_GLOW).toContain(v(c));
  });
});
