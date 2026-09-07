// src/lab/sdf-zombie/webgpu/baked-chunks.ts
//
// The settled-chunk BAKE (close-up task 5): a chunk that has come to rest is
// extracted ONCE into a static triangle mesh and never marched again.
//
// WHY A MESH AND NOT THE HULL RENDERER. The parked hull renderer (2026-09-02)
// re-extracted EVERY frame and still had to band-walk the march in the
// fragment shader, so its ~3-4 ms extraction was a per-frame tax it never
// repaid. A settled chunk never re-extracts: the cost is paid once at the
// settle frame, and the mesh is then a plain rigid, static draw — a normal
// early-Z occluder in the MAIN scene instead of another frag_depth + discard
// proxy. The hull's per-frame objections do not shrink here; they are deleted.
//
// WHERE IT DRAWS. The main scene, default layer — NOT the SDF layer. The
// sdf-layer composite depth-tests the march's written depth against the main
// pass (sdf-layer.ts header), so a depth-writing mesh in the main scene both
// occludes marched bodies behind it and is correctly occluded by walls. This
// is the same layer contract the bone instancer ships under.
//
// LOOK PARITY. Albedo is BAKED per vertex (chunk-bake-field.ts mirrors the
// march's albedo chain: tissue ramp, wound mask, organ tint, mottle, gore
// mask); the WOUND MASK rides the albedo's alpha. Lighting stays LIVE —
// chunkShade below is boneShade's exact key + flashlight cone + wrapped
// diffuse + specular + fresnel (the march's own formula, per bone-tubes),
// with the wet terms boosted by the baked mask. The uniform set mirrors
// bone-instancer's and is refreshed per frame by the page from the same
// flashlight values — baked chunks track the flashlight like tubes do.
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, float, normalWorld, positionWorld, uniform, vec4, wgslFn,
  mrt, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';
import { len } from '../vec';
import type { Vec3 } from '../types';
import { encodeSurfaceClass, SURFACE_CLASS_MESH, type SurfaceOutputOptions } from './deferred-surface';

/**
 * Live lighting for every baked chunk. Same uniform names and semantics as
 * the bone instancer's set (the page updates both from the same flashlight
 * block), minus woundTex: the wound proximity is baked per-vertex instead.
 * look = (stain [unused, albedo carries it], wetTint, specGain, fresGain).
 */
const bakedChunkUniforms = () => ({
  deepColor: uniform(new THREE.Color(0.45, 0.06, 0.05)),
  ambient: uniform(new THREE.Color(0.06, 0.06, 0.06)),
  look: uniform(new THREE.Vector4(0.65, 0.5, 1.2, 0.6)),
  lightDir: uniform(new THREE.Vector3(0.3, 0.8, 0.5)),
  keyColor: uniform(new THREE.Color(1, 0.95, 0.9)),
  lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
  spotPos: uniform(new THREE.Vector3()),
  spotAxis: uniform(new THREE.Vector3(0, 0, -1)),
  spotCfg: uniform(new THREE.Vector4(0, 0.93, 0.80, 16)),
  spotCfg2: uniform(new THREE.Vector4(4, 0.35, 0, 0)),
  spotColor: uniform(new THREE.Color(0.94, 0.96, 1.0)),
});
export type BakedChunkUniforms = ReturnType<typeof bakedChunkUniforms>;

/**
 * The march's own key-light + flashlight cone + wrapped diffuse + wet
 * specular/fresnel (boneShade verbatim minus the wound-texture exposure
 * loop), fed a BAKED albedo whose ALPHA is the wound mask. wm drives the
 * blood-slick terms: near a torn end the highlight tints toward deep blood
 * and the fresnel gains, exactly the "wet" read the march gives crater
 * rims. NO noise here — the mottle is baked into the albedo; the march's
 * per-pixel fbm has no mesh-side equivalent and does not need one.
 *
 * wgslFn hygiene (the three r185 traps, all pinned in memory/tests): one fn
 * per source string; NO parens or colons in the signature comment; no
 * reserved words ('ref' was the last one).
 */
export const CHUNK_SHADE_WGSL = /* wgsl */ `fn chunkShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, albedo: vec4<f32>, deepColor: vec3<f32>, ambient: vec3<f32>, look: vec4<f32>, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>, spotPos: vec3<f32>, spotAxis: vec3<f32>, spotCfg: vec4<f32>, spotCfg2: vec4<f32>, spotColor: vec3<f32>) -> vec3<f32> {
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
  }
  let V = normalize(camPos - p);
  let ndl = max(dot(n, L), 0.0);
  let H = normalize(L + V);
  let wm = clamp(albedo.a, 0.0, 1.0);
  let shine = pow(max(dot(n, H), 0.0), 48.0);
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * look.w * (1.0 + wm * 1.5);
  let wetTint = mix(vec3<f32>(1.0), deepColor, look.y * wm);
  let diffuse = albedo.rgb * (ambient + keyI * keyC * (0.15 + 0.85 * ndl));
  let specular = keyC * wetTint * (shine * look.z * keyI + fres * (0.5 + 0.5 * keyI));
  return diffuse + specular;
}`;

/**
 * MATERIAL TERMS of the baked chunk (M2 task 2): the baked vertex albedo
 * with its wound-mask wetness, mapped to G-buffer form — rgb albedo,
 * roughness from the mask. Dry torn meat is matte; the wet (blood-slick)
 * mask tightens to the lit model's fixed 48-exponent gloss through the
 * shared light pass's shin = exp2((1-rough)*8) + 2 (48 -> 0.31, the same
 * inversion deferred-sdf.ts documents). NO light input — light-invariance
 * is structural, and the lit albedo color is never encoded (the albedo IS
 * the baked attribute the shade composes from).
 */
export const CHUNK_SURFACE_WGSL = /* wgsl */ `fn chunkSurface(albedo: vec4<f32>) -> vec4<f32> {
  let wm = clamp(albedo.a, 0.0, 1.0);
  let rough = clamp(mix(0.9, 0.31, wm), 0.04, 1.0);
  return vec4<f32>(albedo.rgb, rough);
}`;

export interface BakedChunkMaterial {
  material: THREE.Material;
  uniforms: BakedChunkUniforms;
  /** Packed emissionClass value when built with output:'surface' (M2 task
   *  2); undefined in the default lit mode. */
  readonly surfaceKind: number | undefined;
  dispose(): void;
}

/** ONE material for every baked chunk (the shared-chunk-material rule: one
 *  pipeline, N meshes). Lighting uniforms are LIVE and shared; albedo is
 *  per-vertex so sharing costs nothing.
 *
 *  M2 task 2: trailing `options` selects the output mode. Surface mode
 *  builds the five named G-buffer attachments from the baked vertex terms
 *  (albedo/roughness via chunkSurface, world normal, mesh class + shadow
 *  receiver, projected clip depth) and never touches the light compose —
 *  the SAME material split as the bone instancer, and the lit path below
 *  is untouched. */
export function createBakedChunkMaterial(options?: SurfaceOutputOptions): BakedChunkMaterial {
  const u = bakedChunkUniforms();
  const material = new THREE.MeshBasicNodeMaterial();
  let surfaceKind: number | undefined;
  if (options?.output === 'surface') {
    const surf = wgslFn(CHUNK_SURFACE_WGSL)({
      albedo: attribute('bakeColor', 'vec4'),
    }) as unknown as { xyz: unknown; w: unknown };
    const kind = encodeSurfaceClass(SURFACE_CLASS_MESH, options.shadowReceiver ?? 'full');
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionWorld, 1.0));
    material.mrtNode = mrt({
      albedoRoughness: vec4(surf.xyz as never, surf.w as never),
      normalMetalness: vec4(normalWorld, float(0)),
      emissionClass: vec4(float(0), float(0), float(0), float(kind)),
      surfaceDepth: vec4(clip.z.div(clip.w) as never, float(0), float(0), float(1)),
      // Mesh response has no authored flesh parameters; still write every MRT lane.
      surfaceParams: vec4(float(0), float(0), float(0), float(1)),
    }) as never;
    material.blending = THREE.NoBlending; // MRT producer — the M1 mesh rule
    // Route-diagnostic marker ON THE MATERIAL — see the same stamp in
    // bone-instancer.ts: the task-3 router reads material.surfaceKind, and
    // without it a surface-mode baked chunk is unsupported/hidden (task-5
    // boot check, 2026-09-07).
    (material as unknown as { surfaceKind: number }).surfaceKind = kind;
    surfaceKind = kind;
  } else {
    const shade = wgslFn(CHUNK_SHADE_WGSL);
    material.colorNode = vec4(shade({
      p: positionWorld, n: normalWorld, camPos: cameraPosition,
      albedo: attribute('bakeColor', 'vec4'),
      deepColor: u.deepColor, ambient: u.ambient, look: u.look,
      lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
      spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg,
      spotCfg2: u.spotCfg2, spotColor: u.spotColor,
    }) as never, float(1.0));
  }
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  return {
    material,
    uniforms: u,
    get surfaceKind() { return surfaceKind; },
    dispose() { material.dispose(); },
  };
}

// Preserve the existing CPU diagnostic API; live gameplay uses the worker.
export { bakeChunkGeometry, BAKE_CELL } from './chunk-bake-geometry';
export type { ChunkBakeData, BakedChunkResult } from './chunk-bake-geometry';

/** Distance from a point to the chunk bake's bounding sphere surface
 *  (negative inside) — the projectile test's reject/accept primitive. */
export function sphereSign(p: Vec3, centre: Vec3, radius: number): number {
  return len([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]) - radius;
}
