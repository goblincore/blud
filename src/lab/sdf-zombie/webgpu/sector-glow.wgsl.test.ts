// src/lab/sdf-zombie/webgpu/sector-glow.wgsl.test.ts

import { describe, expect, it } from 'vitest';
import { SECTOR_GLOW, SECTOR_GLOW_HASH, SECTOR_GLOW_NOISE } from './sector-glow.wgsl';

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
  it('has no colon inside a // comment', () => {
    for (const s of all) for (const line of s.split('\n')) {
      const at = line.indexOf('//');
      if (at >= 0) expect(line.slice(at)).not.toContain(':');
    }
  });
});
