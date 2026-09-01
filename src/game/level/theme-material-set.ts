// src/game/level/theme-material-set.ts
// Role → material seam (spec §3). The sim emits role tags; the render layer
// resolves them here. Blood tile art is the FIRST implementation of this
// interface, not a dependency of it. Promoted from src/dev/theme-preview.ts.
import * as THREE from 'three';
import { stoneTextures } from './stone-textures';

export type SurfaceRole =
  | 'floor' | 'wall' | 'coverLow' | 'coverMid' | 'perimeterAccent' | 'pocketFloor';

export interface ThemeMaterialSet {
  floor: THREE.Material;
  wall: THREE.Material;
  coverLow: THREE.Material;   // ~1 m lob-over pieces
  coverMid: THREE.Material;   // sightline breakers
  perimeterAccent: THREE.Material;
  pocketFloor?: THREE.Material; // optional readability affordance (v1: = floor)
}

export function resolveRole(set: ThemeMaterialSet, role: SurfaceRole): THREE.Material {
  if (role === 'pocketFloor') return set.pocketFloor ?? set.floor;
  return set[role];
}

/** Untextured default set — used until Blood tile sets are wired in. */
export function defaultMaterialSet(): ThemeMaterialSet {
  return {
    floor: new THREE.MeshStandardMaterial({ color: 0x3a3734, roughness: 1.0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.95 }),
    coverLow: new THREE.MeshStandardMaterial({ color: 0x6b5f52, roughness: 0.9 }),
    coverMid: new THREE.MeshStandardMaterial({ color: 0x4f463c, roughness: 0.9 }),
    perimeterAccent: new THREE.MeshStandardMaterial({ color: 0x5c5044, roughness: 0.9 }),
  };
}

/** The dungeon set. Replaces defaultMaterialSet() on the game page; the
 *  untextured default stays for the gallery A/B. */
export function dungeonMaterialSet(): ThemeMaterialSet {
  const wall = stoneTextures('wallBrick', 11);
  const floor = stoneTextures('floorCobble', 23);
  const ceil = stoneTextures('ceilingVault', 37);
  const mat = (
    tex: ReturnType<typeof stoneTextures>,
    repeat: number,
  ) => {
    const m = new THREE.MeshStandardMaterial({
      ...tex,
      // Relief comes from the normal map, so keep the scalar low and let the
      // roughness MAP carry the wet/dry story.
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
    });
    for (const t of [m.map, m.normalMap, m.roughnessMap]) {
      if (t) t.repeat.set(repeat, repeat);
    }
    return m;
  };
  return {
    wall: mat(wall, 2),
    floor: mat(floor, 3),
    coverLow: mat(wall, 1),
    coverMid: mat(wall, 1),
    perimeterAccent: mat(ceil, 2),
  };
}
