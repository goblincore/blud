// CPU extraction shared by the worker and deterministic tests. No renderer/DOM imports.
import * as THREE from 'three';
import { extractHullSoup, fitHullGrid } from './surface-nets-cpu';
import { fbm, bakeAoAt, bakeChunkAlbedo, chunkBakeField, type ChunkFieldEvals, type ChunkLook, type ChunkBakeParts } from '../chunk-bake-field';
import { qRotate, type Quat } from '../vec';
import { nearestPrim } from '../validate';
import type { Primitive, Vec3 } from '../types';

/** The settled view's field inputs, in WORLD space (see ChunkGpuView.bakeData). */
export interface ChunkBakeData {
  body?: ChunkBakeParts['body'];
  halfExtent?: Vec3;
  cellSize?: number;
  flesh: Primitive[];
  bones: Primitive[];
  torn: ChunkBakeParts['torn'];
  carveK: number;
  centre: Vec3;
  /** Cluster radius — sizes the extraction grid. */
  extent: number;
  quat: Quat;
  look: ChunkLook;
  /** Source SDF response; absent for older mesh/corpse producers. */
  surface?: { legacyGamma: number; wetness: number; roughness: number; specIntensity: number; noiseAmp: number; fresnel: number };
  /** The gore/lod strength actually in effect (0 = never bake, e.g. bone-only chunks). */
  gore: number;
}

export interface BakedChunkResult {
  geometry: THREE.BufferGeometry;
  /** World-space bounding sphere for the projectile test. */
  centre: Vec3;
  radius: number;
  verts: number;
  tris: number;
  /** CPU bake cost, ms — reported per bake, never asserted. */
  bakeMs: number;
  overflow: boolean;
  droppedQuads: number;
}

/** Extraction resolution. 1 cm cells: a torn-end crater is 3-5 cells across,
 *  which reads as a torn edge rather than a nibble. The hull spike's 2 cm
 *  cells exist for a band-walked hull; a bake pays ONCE, so spend them. */
export const BAKE_CELL = 0.01;

/**
 * Extract + paint one settled chunk. Synchronous, CPU: surface-nets over the
 * pure field (band 0 — the TRUE surface, not the hull's band-inflated one;
 * the Newton pull in extractHullSoup then lands vertices ON the field),
 * weld the soup by exact position, bake albedo per unique vertex, smooth
 * normals from the indexed geometry.
 */
export function bakeChunkGeometry(data: ChunkBakeData): BakedChunkResult {
  const t0 = performance.now();
  const ev: ChunkFieldEvals = chunkBakeField({
    body: data.body, flesh: data.flesh, bones: data.bones, torn: data.torn, carveK: data.carveK,
  });
  const grid = fitHullGrid(data.centre, data.halfExtent ?? [data.extent, data.extent, data.extent], data.cellSize ?? BAKE_CELL, 0);
  const soup = extractHullSoup(p => ev.field(p), grid, 0, 1);

  // Weld the triangle soup by exact position (surface-nets repeats each
  // cell vertex verbatim per quad, so exact-float keys are safe), baking
  // the albedo once per unique vertex. The anchor for the noise fbm is the
  // chunk-LOCAL point: inverse of the settle transform (rotate by the
  // conjugate; squash is 1 at settle by the predicate's own clause).
  const qc: Quat = [-data.quat[0], -data.quat[1], -data.quat[2], data.quat[3]];
  const localOf = (p: Vec3): Vec3 => {
    const d: Vec3 = [p[0] - data.centre[0], p[1] - data.centre[1], p[2] - data.centre[2]];
    return qRotate(qc, d);
  };
  const index: number[] = [];
  const positions: number[] = [];
  const colors: number[] = [];
  const aos: number[] = [];
  const responses: number[] = [];
  const anchors: number[] = [];
  const fresnels: number[] = [];
  const weld = new Map<string, number>();
  const n = soup.vertCount;
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [soup.positions[i * 3]!, soup.positions[i * 3 + 1]!, soup.positions[i * 3 + 2]!];
    const key = `${p[0]},${p[1]},${p[2]}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      weld.set(key, id);
      positions.push(p[0], p[1], p[2]);
      const painted = data.body ? data.body.prims[nearestPrim(p, data.body)]?.color : undefined;
      const [r, g, b, wm] = bakeChunkAlbedo(p, localOf(p), ev,
        painted ? { ...data.look, baseColor: painted } : data.look);
      colors.push(r, g, b, wm);
      const surf = data.surface;
      const anchor = localOf(p);
      anchors.push(...anchor, surf?.noiseAmp ?? 0);
      fresnels.push(surf?.fresnel ?? 0.18);
      const mottle = Math.min(1, Math.max(0, fbm([anchor[0] * 6, anchor[1] * 6, anchor[2] * 6]) * 0.5 + 0.5));
      const gore = Math.min(1, mottle * 0.55 + wm * 0.65) * data.look.goreStrength;
      responses.push(surf ? 1 + surf.legacyGamma : 0,
        surf ? surf.wetness * (1 + 0.6 * Math.max(wm, gore)) : 0,
        surf ? 128 + (4 - 128) * surf.roughness : 48,
        surf?.specIntensity ?? 0);
      aos.push(bakeAoAt(q => ev.field(q), p, data.cellSize ?? BAKE_CELL));
    }
    index.push(id);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('bakeFresnel', new THREE.Float32BufferAttribute(fresnels, 1));
  geo.setAttribute('bakeAnchor', new THREE.Float32BufferAttribute(anchors, 4));
  geo.setAttribute('bakeResponse', new THREE.Float32BufferAttribute(responses, 4));
  geo.setAttribute('bakeColor', new THREE.Float32BufferAttribute(colors, 4));
  // The occlusion `chunkShade` cannot compute at runtime — see bakeAoAt.
  geo.setAttribute('bakeAo', new THREE.Float32BufferAttribute(aos, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();

  // Bounding sphere for the projectile test: from the actual vertices, so a
  // hit test cannot disagree with the drawn geometry.
  geo.computeBoundingSphere();
  const bs = geo.boundingSphere!;
  return {
    geometry: geo,
    centre: [bs.center.x, bs.center.y, bs.center.z],
    radius: bs.radius,
    verts: positions.length / 3,
    tris: index.length / 3,
    bakeMs: performance.now() - t0,
    overflow: soup.overflow,
    droppedQuads: soup.droppedQuads,
  };
}
