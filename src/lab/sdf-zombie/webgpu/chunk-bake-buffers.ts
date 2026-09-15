import * as THREE from 'three';
import type { BakedChunkResult } from './chunk-bake-geometry';

/** Structured-cloneable result. Transfer the buffers, never a THREE class instance. */
export interface ChunkBakeBuffers extends Omit<BakedChunkResult, 'geometry'> {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Per-vertex baked AO — see bakeAoAt. Its own channel rather than a spare
   *  lane of `colors`, whose four are all spoken for (rgb + the wound mask). */
  aos: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export function packChunkBake({ geometry, ...stats }: BakedChunkResult): ChunkBakeBuffers {
  return {
    ...stats,
    positions: geometry.getAttribute('position').array as Float32Array,
    normals: geometry.getAttribute('normal').array as Float32Array,
    colors: geometry.getAttribute('bakeColor').array as Float32Array,
    aos: geometry.getAttribute('bakeAo').array as Float32Array,
    indices: geometry.getIndex()!.array as Uint16Array | Uint32Array,
  };
}

export function chunkBakeTransfers(result: ChunkBakeBuffers): ArrayBuffer[] {
  return [result.positions.buffer, result.normals.buffer, result.colors.buffer,
    result.aos.buffer, result.indices.buffer] as ArrayBuffer[];
}

export function unpackChunkBake({ positions, normals, colors, aos, indices, ...stats }: ChunkBakeBuffers): BakedChunkResult {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('bakeColor', new THREE.BufferAttribute(colors, 4));
  geometry.setAttribute('bakeAo', new THREE.BufferAttribute(aos, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...stats.centre), stats.radius);
  return { geometry, ...stats };
}
