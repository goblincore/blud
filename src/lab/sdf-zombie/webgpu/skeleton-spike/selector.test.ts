import { describe, it, expect } from 'vitest';
import { resolveOrganMode, resolveSkeletonMode } from './selector';

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

describe('resolveOrganMode (organs as mesh)', () => {
  it('is mesh by default on the mesh skeleton, and sdf on request', () => {
    for (const search of ['', '?organs=mesh', '?organs=unknown', '?skeleton=mesh']) expect(resolveOrganMode(search, 'mesh')).toBe('mesh');
    expect(resolveOrganMode('?organs=sdf', 'mesh')).toBe('sdf');
    expect(resolveOrganMode('?seed=1&organs=sdf&frozen=1', 'mesh')).toBe('sdf');
  });
  it('is always sdf off the mesh skeleton', () => {
    for (const skeleton of ['procedural', 'volume'] as const) {
      for (const search of ['', '?organs=mesh', '?organs=sdf']) expect(resolveOrganMode(search, skeleton)).toBe('sdf');
    }
  });
});
