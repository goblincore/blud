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
import {
  SURFACE_CLASS_MESH, encodeSurfaceClass,
  type SurfaceOutputOptions,
} from './deferred-surface';

/** Diagnostics marker, the task-2 convention (MaterialWithSurfaceClass in
 *  zombie-gpu.ts): the PACKED class + shadow receiver this adapter writes
 *  into emissionClass.a, observable without a device. Frozen at construction
 *  — the game constructs per mode, and the scene router caches adapters per
 *  (source material, receiver), so a policy change rebinds rather than
 *  mutates a shared graph. */
export interface DeferredMeshMaterial extends MeshStandardNodeMaterial {
  surfaceKind: number;
}

/**
 * The surface state copied FROM a game MeshStandardMaterial onto a deferred
 * adapter: scalars, colors and texture REFERENCES (the maps stay
 * single-owned by the game). Used at construction AND on every source
 * refresh — the game mutates its Standard materials live (setGunTuning
 * changes roughness/metalness/normalScale and rebinds maps), so the router
 * re-runs this when the source's version counter moves.
 *
 * Deliberately NOT copied: envMap (unlit G-buffer rule) and the structural
 * G-buffer contract — fog, transparent, blending, depth, lights — which
 * createDeferredMeshMaterial forces; plus mrtNode/surfaceKind, frozen per
 * adapter because a cached (source, receiver) pair never changes receiver.
 */
export function copyDeferredMeshSurfaceState(
  source: THREE.MeshStandardMaterial,
  target: DeferredMeshMaterial,
): void {
  target.color.copy(source.color);
  target.map = source.map;
  target.normalMap = source.normalMap;
  target.normalScale.copy(source.normalScale);
  target.roughness = source.roughness;
  target.roughnessMap = source.roughnessMap;
  target.metalness = source.metalness;
  target.metalnessMap = source.metalnessMap;
  target.emissive.copy(source.emissive);
  target.emissiveMap = source.emissiveMap;
  target.emissiveIntensity = source.emissiveIntensity;
  target.alphaTest = source.alphaTest;
  target.side = source.side;
  target.vertexColors = source.vertexColors;
}

/**
 * Builds the deferred surface producer for `source`. Texture REFERENCES are
 * shared (not cloned) so the fixture's maps stay single-owned; the returned
 * material is owned by the caller and must be disposed with the layer.
 *
 * M2 TASK 3 (game materials). `options.shadowReceiver` packs the flashlight
 * shadow receiver into emissionClass.a beside the mesh class
 * (encodeSurfaceClass; default 'full' = the M1 encoding EXACTLY, so the M1
 * fixture and every existing call is unchanged). Everything the game's
 * MeshStandardMaterials carry that the G-buffer must preserve comes through:
 * maps by reference, alphaTest cutout, side, vertexColors, emissive.
 * `fog` is forced OFF — the game scene carries scene.fog and fog is a
 * lit-stage term evaluated once in the shared light pass, never pre-baked
 * into unlit albedo. envMap is deliberately NOT copied: it is a
 * light/view-dependent term and would violate the unlit G-buffer rule.
 */
export function createDeferredMeshMaterial(
  source: THREE.MeshStandardMaterial,
  options?: SurfaceOutputOptions,
): DeferredMeshMaterial {
  const receiver = options?.shadowReceiver ?? 'full';
  const surfaceKind = encodeSurfaceClass(SURFACE_CLASS_MESH, receiver);
  const mat = new MeshStandardNodeMaterial() as DeferredMeshMaterial;
  copyDeferredMeshSurfaceState(source, mat);
  // Unlit AND unfogged: the game's dungeon scene.fog must never tint the
  // G-buffer's albedo (the lit stage owns distance fog; see setEnvironment).
  mat.fog = false;

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
  // NOTE the .rgb on materialEmissive (composition review fix): three
  // r185's MaterialNode multiplies the emissive COLOR by the emissiveMap
  // SAMPLE WITHOUT an .rgb swizzle (MaterialNode.js:225), so a material
  // with an emissiveMap (the watch screen) exposes materialEmissive as a
  // VEC4 (map alpha rides along). Without the swizzle the join below is a
  // 5-component vec4 and the WGSL function validator rejects the whole
  // graph: "Length of parameters exceeds maximum length of function
  // 'vec4()'" — the arms never reached the G-buffer. materialColor keeps
  // its .rgb for the same reason (the map path is vec4 there too).
  mat.mrtNode = mrt({
    albedoRoughness: vec4(materialColor.rgb, materialRoughness),
    normalMetalness: vec4(normalWorld, materialMetalness),
    emissionClass: vec4(materialEmissive.rgb, surfaceKind),
    surfaceDepth: vec4(clipDepth, 0.0, 0.0, 1.0),
    // No authored march response exists for a Standard material (M2 task 7):
    // the packed-0 sentinel keeps mesh receivers on the M1 bounded flesh
    // evaluation — mesh shading is unchanged by the material-parity repair.
    surfaceParams: vec4(0.0, 0.0, 0.0, 1.0),
  });
  mat.surfaceKind = surfaceKind;

  return mat;
}
