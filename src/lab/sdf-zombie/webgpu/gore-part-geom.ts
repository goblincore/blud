// src/lab/sdf-zombie/webgpu/gore-part-geom.ts
//
// The THREE side of `gore-parts.ts`: turn a pure `PartMesh` into the exact
// geometry contract the mesh gore path already renders — `position` plus a
// `bakeColor` vec4 (rgb albedo, alpha = the wetness the material turns into
// roughness), indexed, with flat facets.
//
// FLAT FACETS ARE THE POINT. `computeVertexNormals` on an indexed mesh averages
// across faces and gives a smooth shell, which is precisely the "tube" read the
// owner rejected twice. `toNonIndexed()` first makes every triangle own its
// vertices, so the computed normals are the FACE normals and the chunk reads
// faceted.
import * as THREE from 'three/webgpu';
import {
  boneBloodField, classicBoneMesh, isOrgan, meatChunkMesh, meatFields, paintPart,
  type BoneVariant, type MeatVariant, type PartMesh,
} from '../gore-parts';
import type { ChunkLook } from '../chunk-bake-field';

export interface GorePartGeom {
  geometry: THREE.BufferGeometry;
  /** Nominal radius (m) — what the physics gives the piece. */
  radius: number;
}

/**
 * Wrap a `PartMesh` in a BufferGeometry with `bakeColor` painted from the
 * game's own meat chain, flat-faceted.
 *
 * The paint runs on the ORIGINAL vertices, then the geometry is de-indexed, so
 * the attribute is expanded with it — painting after `toNonIndexed()` would
 * repeat the work per triangle vertex for the same answer.
 */
export function gorePartGeometry(
  mesh: PartMesh, look: ChunkLook, kind: 'meat' | 'bone' | 'organ',
  fields: { blood: (p: import('../types').Vec3) => number; depth: (p: import('../types').Vec3) => number },
): GorePartGeom {
  const colors = paintPart(mesh, look, kind, fields);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geo.setAttribute('bakeColor', new THREE.Float32BufferAttribute(colors, 4));
  // `goreKind` is what the procedural detail shader switches on: 0 meat, 1 bone,
  // 2 organ. Per-VERTEX rather than a uniform, because the parts share ONE
  // material instance (the shared-chunk-material rule) — a per-part uniform
  // would mean a material per part and a pipeline per material.
  const kindCode = kind === 'bone' ? 1 : kind === 'organ' ? 2 : 0;
  geo.setAttribute('goreKind', new THREE.Float32BufferAttribute(
    new Array(mesh.positions.length / 3).fill(kindCode), 1,
  ));
  geo.setIndex(mesh.indices);
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  return { geometry: flat, radius: mesh.radius };
}

/** A meat (or ORGAN) chunk of one variant. `scaleM` is its radius in metres. */
export function meatPartGeometry(
  variant: MeatVariant, scaleM: number, seed: number, look: ChunkLook,
): GorePartGeom {
  return gorePartGeometry(
    meatChunkMesh(variant, scaleM, seed), look, isOrgan(variant) ? 'organ' : 'meat',
    meatFields(variant, scaleM, seed),
  );
}

/** A classic bone of one variant. */
export function bonePartGeometry(
  variant: BoneVariant, scaleM: number, seed: number, look: ChunkLook,
): GorePartGeom {
  return gorePartGeometry(
    classicBoneMesh(variant, scaleM, seed), look, 'bone', {
      blood: boneBloodField(scaleM, seed), depth: () => 0,
    },
  );
}
