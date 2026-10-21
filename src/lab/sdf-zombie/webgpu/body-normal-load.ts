// src/lab/sdf-zombie/webgpu/body-normal-load.ts
//
// Load a character's BODY NORMAL MAP (character-registry.ts `bodyNormal`; spec
// docs/superpowers/specs/2026-10-21-body-normal-map-design.md) and turn it into the BodyNormalMap a view's
// setBodyNormal takes. The PNG and its JSON sidecar are written together by scripts/bake-body-normal.ts; the
// sidecar is the projection (rest height band and axis) the texture was baked in, so the two must never be
// loaded from different bakes.
import * as THREE from 'three';
import type { BodyNormalMap } from './zombie-gpu';

/** The registry's declaration: the baked PNG, its sidecar, and how hard to apply it. */
export interface BodyNormalSpec {
  url: string;
  meta: string;
  strength: number;
}

/** The sidecar's projection fields (bake-body-normal.ts writes more; these are the ones the shader needs). */
export interface BodyNormalMeta {
  yMin: number;
  yMax: number;
  axisX: number;
  axisZ: number;
}

export interface LoadedBodyNormal {
  tex: THREE.Texture;
  meta: BodyNormalMeta;
}

const cache = new Map<string, Promise<LoadedBodyNormal>>();

/** One texture per URL, shared by every body of the character (crowd types copy it by reference). */
export function loadBodyNormal(spec: BodyNormalSpec): Promise<LoadedBodyNormal> {
  const hit = cache.get(spec.url);
  if (hit) return hit;
  const p = Promise.all([
    fetch(spec.meta).then(r => {
      if (!r.ok) throw new Error(`body normal map sidecar ${spec.meta}: HTTP ${r.status}`);
      return r.json() as Promise<BodyNormalMeta>;
    }),
    new THREE.TextureLoader().loadAsync(spec.url),
  ]).then(([meta, tex]) => {
    // DATA, not colour: no sRGB decode. Row 0 must be the image's TOP row (v = 1, the band's yMax): the
    // shader indexes rows itself with textureLoad (it filters by hand), so the upload must not flip.
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return { tex, meta };
  });
  cache.set(spec.url, p);
  return p;
}

/**
 * The view parameters for one body: the sidecar's projection plus the prim range of the body's TORSO
 * cluster, the only prims whose hits take the map. Clusters are contiguous runs of the packed prims (pack.ts),
 * so the range is just the torso cluster's [start, start + count). Null when the body has no torso cluster
 * (a severed piece), which leaves the map off.
 */
export function bodyNormalMap(
  spec: Pick<BodyNormalSpec, 'strength'>,
  meta: BodyNormalMeta,
  body: { clusters: readonly { limb: string; start: number; count: number }[] },
): BodyNormalMap | null {
  const torso = body.clusters.find(c => c.limb === 'torso');
  if (!torso) return null;
  return {
    strength: spec.strength,
    yMin: meta.yMin, yMax: meta.yMax, axisX: meta.axisX, axisZ: meta.axisZ,
    primStart: torso.start, primEnd: torso.start + torso.count,
  };
}
