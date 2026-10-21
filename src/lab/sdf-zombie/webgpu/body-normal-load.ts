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

/** One region of the atlas's header table (scripts/bake-body-normal.ts THE HEADER). */
export interface BodyNormalRegion {
  head: [number, number, number];
  tail: [number, number, number];
  rMax: number;
  row0: number;
  rows: number;
  kind: 'torso' | 'limb';
}

/**
 * Decode the region table from the atlas's header row (RGBA8 bytes), exactly as body-normal.wgsl.ts reads it:
 * texel 0 = 'B', 'N', version, count; region i = texels 1 + 5i .. 5 + 5i of 16-bit pairs (hi, lo), positions
 * and rMax mapped from -2.5..2.5 m. Null when the row is not a table (a version-1 torso-only map).
 */
export function decodeRegionTable(row: Uint8Array): BodyNormalRegion[] | null {
  if (row[0] !== 66 || row[1] !== 78) return null;
  const u16 = (texel: number, second: boolean) => { const o = texel * 4 + (second ? 2 : 0); return row[o]! * 256 + row[o + 1]!; };
  const pos = (texel: number, second: boolean) => u16(texel, second) / 65535 * 5 - 2.5;
  const out: BodyNormalRegion[] = [];
  for (let i = 0; i < row[3]!; i++) {
    const b = 1 + 5 * i;
    out.push({
      head: [pos(b, false), pos(b, true), pos(b + 1, false)],
      tail: [pos(b + 1, true), pos(b + 2, false), pos(b + 2, true)],
      rMax: pos(b + 3, false), row0: u16(b + 3, true), rows: u16(b + 4, false),
      kind: u16(b + 4, true) ? 'limb' : 'torso',
    });
  }
  return out;
}
