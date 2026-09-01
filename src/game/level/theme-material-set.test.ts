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

import * as THREE from 'three';
import { dungeonMaterialSet } from './theme-material-set';

describe('dungeonMaterialSet', () => {
  it('every surface carries albedo, normal AND roughness maps', () => {
    const set = dungeonMaterialSet();
    for (const key of ['floor', 'wall', 'coverLow', 'coverMid', 'perimeterAccent'] as const) {
      const m = set[key] as THREE.MeshStandardMaterial;
      expect(m.map, `${key} albedo`).toBeTruthy();
      expect(m.normalMap, `${key} normal`).toBeTruthy();
      expect(m.roughnessMap, `${key} roughness`).toBeTruthy();
    }
  });

  it('albedo is sRGB and the DATA maps stay linear — the recorded colour-space bug', () => {
    const m = dungeonMaterialSet().wall as THREE.MeshStandardMaterial;
    expect(m.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(m.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('floor and wall use DIFFERENT stone, not one texture reused', () => {
    const set = dungeonMaterialSet();
    const wall = set.wall as THREE.MeshStandardMaterial;
    const floor = set.floor as THREE.MeshStandardMaterial;
    expect(wall.map).not.toBe(floor.map);
  });
});
