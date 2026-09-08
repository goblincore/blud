// src/lab/sdf-zombie/webgpu/skeleton-spike/selector.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSkeletonMode } from './selector';

describe('resolveSkeletonMode', () => {
  it('defaults to procedural when the query is absent (baseline preserved)', () => {
    expect(resolveSkeletonMode('', { dev: true, deferred: false })).toBe('procedural');
    expect(resolveSkeletonMode('?res=1', { dev: true, deferred: false })).toBe('procedural');
  });
  it('resolves mesh only in dev forward mode', () => {
    expect(resolveSkeletonMode('?skeleton=mesh', { dev: true, deferred: false })).toBe('mesh');
    expect(resolveSkeletonMode('?skeleton=mesh', { dev: true, deferred: true })).toBe('procedural');
    expect(resolveSkeletonMode('?skeleton=mesh', { dev: false, deferred: false })).toBe('procedural');
  });
  it('ignores unknown values', () => {
    expect(resolveSkeletonMode('?skeleton=tubes', { dev: true, deferred: false })).toBe('procedural');
  });
  it('resolves volume only in dev forward mode', () => {
    expect(resolveSkeletonMode('?skeleton=volume', { dev: true, deferred: false })).toBe('volume');
    expect(resolveSkeletonMode('?skeleton=volume', { dev: true, deferred: true })).toBe('procedural');
    expect(resolveSkeletonMode('?skeleton=volume', { dev: false, deferred: false })).toBe('procedural');
  });
});
