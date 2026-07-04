// src/game/level/theme-material-set.test.ts
import { describe, it, expect } from 'vitest';
import { resolveRole, type ThemeMaterialSet, type SurfaceRole } from './theme-material-set';

const mat = (name: string) => ({ name }) as unknown as import('three').Material;

describe('resolveRole', () => {
  const set: ThemeMaterialSet = {
    floor: mat('floor'), wall: mat('wall'),
    coverLow: mat('coverLow'), coverMid: mat('coverMid'),
    perimeterAccent: mat('accent'),
  };

  it('maps every required role to its material', () => {
    for (const role of ['floor', 'wall', 'coverLow', 'coverMid', 'perimeterAccent'] as SurfaceRole[])
      expect((resolveRole(set, role) as { name?: string }).name).toBe(
        role === 'perimeterAccent' ? 'accent' : role,
      );
  });

  it('falls back pocketFloor → floor when the optional slot is absent', () => {
    expect(resolveRole(set, 'pocketFloor')).toBe(set.floor);
    const withPocket = { ...set, pocketFloor: mat('pocket') };
    expect((resolveRole(withPocket, 'pocketFloor') as { name?: string }).name).toBe('pocket');
  });
});
