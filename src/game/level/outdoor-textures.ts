// src/game/level/outdoor-textures.ts
// three wrappers over outdoor-texture-pixels.ts. Albedo maps are sRGB (see stone-textures.ts).
import * as THREE from 'three';
import { stoneTextures } from './stone-textures';
import {
  OUTDOOR_TEX_SIZE, edgePixels, groundPixels, skylinePixels,
  type EdgeKind, type GroundKind, type SkylineKind,
} from './outdoor-texture-pixels';

const wrap = (data: Uint8ClampedArray, w: number, h: number, repeat: boolean): THREE.DataTexture => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
};

export function groundTexture(kind: GroundKind | 'cobble', seed: number): THREE.Texture {
  if (kind === 'cobble') return stoneTextures('floorCobble', 23).map;
  return wrap(groundPixels(kind, seed), OUTDOOR_TEX_SIZE, OUTDOOR_TEX_SIZE, true);
}
export function edgeTexture(kind: EdgeKind, seed: number): THREE.Texture {
  return wrap(edgePixels(kind, seed), OUTDOOR_TEX_SIZE, OUTDOOR_TEX_SIZE, true);
}
export function skylineTexture(kind: SkylineKind, roughness: number, seed: number): THREE.Texture {
  return wrap(skylinePixels(kind, roughness, seed), 2048, 256, false);
}
