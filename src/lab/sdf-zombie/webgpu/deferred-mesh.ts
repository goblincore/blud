// src/lab/sdf-zombie/webgpu/deferred-mesh.ts
//
// Adapts a real MeshStandardMaterial (the fixture's mapped stone) into a
// surface producer for the deferred G-buffer. It copies the source material's
// texture references and scalars and writes the four named surface
// attachments via a material-level mrtNode — it does NOT borrow Three's
// prelit `output`; the G-buffer is unlit linear material data.
//
// LIGHTS OFF. `lights = false` is load-bearing: the surface output must be
// invariant under scene light motion (lighting happens once, in the shared
// deferred light pass), and skipping the forward lighting rig keeps the
// producer pass cheap.
//
// NORMALS. `normalWorld` resolves through the material's own setupNormal, so
// the tangent-space normal map (and normalScale) participates without any
// custom TBN code.
//
// DEPTH. `surfaceDepth` carries WebGPU clip depth computed the same way the
// existing march writes it (zombie-gpu.ts createMarchMaterial): clip =
// cameraProjectionMatrix * cameraViewMatrix * worldPos, depth = clip.z/clip.w,
// already in [0,1] — no *0.5+0.5 remap.

import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  mrt, vec4,
  cameraProjectionMatrix, cameraViewMatrix,
  positionWorld, normalWorld,
  materialColor, materialRoughness, materialMetalness, materialEmissive,
} from 'three/tsl';
import { SURFACE_CLASS_MESH } from './deferred-surface';

/**
 * Builds the deferred surface producer for `source`. Texture REFERENCES are
 * shared (not cloned) so the fixture's maps stay single-owned; the returned
 * material is owned by the caller and must be disposed with the layer.
 */
export function createDeferredMeshMaterial(source: THREE.MeshStandardMaterial): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  mat.color.copy(source.color);
  mat.map = source.map;
  mat.normalMap = source.normalMap;
  mat.normalScale.copy(source.normalScale);
  mat.roughness = source.roughness;
  mat.roughnessMap = source.roughnessMap;
  mat.metalness = source.metalness;
  mat.metalnessMap = source.metalnessMap;
  mat.emissive.copy(source.emissive);
  mat.emissiveMap = source.emissiveMap;
  mat.emissiveIntensity = source.emissiveIntensity;
  mat.alphaTest = source.alphaTest;
  mat.side = source.side;

  // Opaque/cutout only in this milestone — no transparency support claimed.
  mat.transparent = false;
  mat.blending = THREE.NoBlending;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.lights = false;

  // WebGPU clip z is already [0,1] (same convention as the existing march's
  // depth write). Computed per fragment from the interpolated world position.
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionWorld, 1.0));
  const clipDepth = clip.z.div(clip.w);

  // Names must match SURFACE_ATTACHMENT_NAMES — three's MRTNode matches
  // outputs to the current render target's textures BY NAME.
  mat.mrtNode = mrt({
    albedoRoughness: vec4(materialColor.rgb, materialRoughness),
    normalMetalness: vec4(normalWorld, materialMetalness),
    emissionClass: vec4(materialEmissive, SURFACE_CLASS_MESH),
    surfaceDepth: vec4(clipDepth, 0.0, 0.0, 1.0),
  });

  return mat;
}
