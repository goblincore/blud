// src/game/level/theme-material-set.ts
// Role → material seam (spec §3). The sim emits role tags; the render layer
// resolves them here. Blood tile art is the FIRST implementation of this
// interface, not a dependency of it. Promoted from src/dev/theme-preview.ts.
import * as THREE from 'three';

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
