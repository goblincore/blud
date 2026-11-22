// src/lab/sdf-zombie/webgpu/residual-volume.ts
//
// RESIDUAL LAYER (gargoyle-hd spike, docs/dev-notes/2026-11-17-gargoyle-hd-spike/notes.md): a baked r16float 3D
// texture of (mesh SDF - prim field) in the body's REST frame, added in mapBody after the prim fold
// (march/fields/volume.wgsl.ts sampleMeshSdf + residualOffset, blended across joints in map-body). It rides the X1.26 volume binding: volumePose0.w == 2 selects it,
// volumeMin is the grid's first texel, volumeInvExtent = (1/h, clamp, band).
//
// Synchronous on purpose: createCharacterView is sync, so the texture is allocated at its final size from the
// manifest (imported with the registry entry) and filled with the neutral texel (0 = no offset); the binary
// streams in afterwards and flips needsUpdate. Until it lands the body renders as plain prims.
import * as THREE from 'three/webgpu';

/** format 'mesh': half floats of the MESH SDF / band; the shader takes clamp(mesh - prims) live (bake-residual.ts). */
export interface ResidualManifest { dims: [number, number, number]; min: [number, number, number]; h: number; clamp: number; band: number; format: 'mesh' }
export interface ResidualSpec { url: string; manifest: ResidualManifest }

const cache = new Map<string, THREE.Data3DTexture>();

export function residualTexture(spec: ResidualSpec): THREE.Data3DTexture {
  const hit = cache.get(spec.url);
  if (hit) return hit;
  const [nx, ny, nz] = spec.manifest.dims;
  if (spec.manifest.format !== 'mesh') throw new Error(`residual ${spec.url}: rebake in the 'mesh' format (bake-residual.ts)`);
  const data = new Uint16Array(nx * ny * nz);
  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.HalfFloatType;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  cache.set(spec.url, tex);
  void fetch(spec.url).then(r => {
    if (!r.ok) throw new Error(`residual ${spec.url}: HTTP ${r.status}`);
    // .binz is gzipped (bake-residual.ts): inflate in the browser.
    if (!spec.url.endsWith('.binz') || !r.body) return r.arrayBuffer();
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }).then(buf => {
    if (buf.byteLength !== data.byteLength) throw new Error(`residual ${spec.url}: ${buf.byteLength} bytes, want ${data.byteLength}`);
    data.set(new Uint16Array(buf));
    tex.needsUpdate = true;
  }).catch(e => console.error('[residual-volume]', e));
  return tex;
}

/** Point a view's march uniforms at a residual (volumePose0.w = 2). */
export function applyResidualUniforms(
  u: { volumePose0: { value: THREE.Vector4 }; volumeMin: { value: THREE.Vector3 }; volumeInvExtent: { value: THREE.Vector3 } },
  m: ResidualManifest,
  /** The body's spawn translation (translate.ts translateBody): rest rows are built AT the spawn point in the game,
   *  so the shader subtracts this (volumePose0.xyz, per instance even in a crowd) before sampling. Lab: origin. */
  origin: readonly [number, number, number] = [0, 0, 0],
): void {
  // `?residual=0` shows the bare fitted prims (A/B against the residual).
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('residual') === '0') return;
  u.volumePose0.value.set(origin[0], origin[1], origin[2], 2);
  u.volumeMin.value.set(m.min[0], m.min[1], m.min[2]);
  u.volumeInvExtent.value.set(1 / m.h, m.clamp, m.band);
}
