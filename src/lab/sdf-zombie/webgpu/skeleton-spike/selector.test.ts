import { describe, it, expect } from 'vitest';
import { resolveSkeletonMode } from './selector';

describe('resolveSkeletonMode', () => {
  for (const dev of [true, false]) {
    it(`defaults to mesh in forward mode (dev=${dev})`, () => {
      for (const search of ['', '?res=1', '?skeleton=mesh', '?skeleton=unknown']) {
        expect(resolveSkeletonMode(search, { dev, deferred: false })).toBe('mesh');
      }
    });
    it(`retains explicit procedural and deferred fallback (dev=${dev})`, () => {
      expect(resolveSkeletonMode('?skeleton=procedural', { dev, deferred: false })).toBe('procedural');
      for (const search of ['', '?skeleton=mesh', '?skeleton=volume', '?skeleton=procedural']) {
        expect(resolveSkeletonMode(search, { dev, deferred: true })).toBe('procedural');
      }
    });
  }
  it('keeps sampled volume development-only', () => {
    expect(resolveSkeletonMode('?skeleton=volume', { dev: true, deferred: false })).toBe('volume');
    expect(resolveSkeletonMode('?skeleton=volume', { dev: false, deferred: false })).toBe('mesh');
  });
});
