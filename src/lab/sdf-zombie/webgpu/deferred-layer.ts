// src/lab/sdf-zombie/webgpu/deferred-layer.ts
//
// The deferred layer: passes, resolve, and lifecycle for the hybrid deferred
// comparison scene (spec:
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md).
//
// FRAME STRUCTURE (7 passes, each a separate renderer.render submit):
//
//   1. clear quad -> meshTarget     (autoClear on: hardware depth reset)
//   2. meshScene  -> meshTarget     (autoClear off; MRT surface output)
//   3. clear quad -> sdfTarget
//   4. sdfScene   -> sdfTarget      (EMPTY until task 2 wires the SDF producer)
//   5. resolve    -> resolvedTarget (nearest-depth selection, one texel source)
//   6. light      -> litTarget      (the single shared light evaluation)
//   7. present    -> canvas         (debug view selection, one display encode)
//
// CLEAR SEMANTICS. One shared RGBA clear colour cannot express this G-buffer's
// empty state (surfaceDepth must clear to 1 = far, emissionClass.a to 0 =
// class empty, everything else don't-care), so each producer target is cleared
// by a full-screen MRT quad writing those constants. The renderer's own
// autoClear during that pass resets the hardware depth attachment — with
// autoClearDepth/clearDepth explicitly forced to true/1 for those passes and
// restored afterwards, because a caller's autoClearDepth=false or clearDepth=0
// would otherwise reject every geometry fragment (coordinator review fix 5).
// Producer scenes' backgrounds are suppressed for the same passes: a Color
// background force-clears the target even with autoClear=false and would
// overwrite the sentinels (coordinator review fix 3), and a caller-level
// renderer MRT would merge into the producers' material mrtNode outputs
// (coordinator review fix 4). All of it is restored in finally.
//
// ORIENTATION. Every internal pass samples by integer fragment coordinate
// (screenCoordinate -> textureLoad). That is framebuffer-identity for both
// target-to-target and target-to-canvas on this backend: the texel a producer
// wrote at fragment coordinate p is read back at p, and the canvas fragment
// at p presents texel p. No flip exists inside the chain. The ONE documented
// boundary transform is the present pass's uFlipY uniform (default 0 =
// identity), kept adjustable pending task 3's on-screen verification with
// asymmetric geometry. (sdf-layer needs flipY=1 because it samples by uv(),
// which flips once per quad pass — see post-aa.ts's orientation note.)
//
// NO READ-AFTER-WRITE within a pass: resolve reads the producers and writes
// resolved; light reads resolved and writes lit; present reads both and
// writes the canvas. All disjoint.
//
// LIGHTS. M1 lighting is explicitly UNSHADOWED. The light buffer is a fixed
// 16-slot DataTexture (deferred-lighting.ts); setLights is a data upload,
// never a rebuild. No per-light field sampling, no legacy gamma compensation.
// The flashlight shadow BINDING API (setFlashlightShadow) exists from M2
// task 1 but stores only — sampling lands with the shadow module in task 4.
//
// M2 TASK 1 ADDITIONS. Three opt-in seams, all defaulting to exact M1
// behaviour:
//
//   setOutputTarget(t | null) — present into a caller-owned color+depth
//     target (game composition) instead of the canvas. The target path clears
//     the destination, presents with DEPTH WRITES (depthNode = the resolved
//     surfaceDepth, empty = far), and treats the target as LINEAR: the one
//     display encode stays on the canvas path / the game's post chain.
//   render(..., hooks?)       — drawMesh/drawSdf replace the corresponding
//     producer scene render, running at the owned target with the sentinel
//     clear already submitted and autoClear off (game per-draw rebinding).
//   setEnvironment(...)       — game ambient + distance fog evaluated ONLY in
//     the lit stage. Defaults are the M1 constants with fog off; surface and
//     debug outputs never read either.
//
// emissionClass.a may now carry packed receiver metadata (low 4 bits = base
// class, bit 4 = level-only shadow receiver, deferred-surface.ts). Lighting
// and the material debug view DECODE it; the attachment keeps the raw packed
// value for the task-4 shadow-receiver selection.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, texture, textureLoad, uniform, mrt,
  screenCoordinate, ivec2, vec4, select, floor,
} from 'three/tsl';
import {
  createSurfaceTarget, getSurfaceTextures, sdfTargetSize,
  SURFACE_COLOR_BYTES_PER_SAMPLE, SURFACE_ATTACHMENT_NAMES,
} from './deferred-surface';
import {
  MAX_DEFERRED_LIGHTS, packDeferredLights, createDeferredLightTexture, uploadDeferredLights,
  type DeferredLight,
} from './deferred-lighting';

export type DeferredDebugView = 'lit' | 'albedo' | 'normal' | 'depth' | 'material';

const DEBUG_VIEW_INDEX: Record<DeferredDebugView, number> = {
  lit: 0, albedo: 1, normal: 2, depth: 3, material: 4,
};

export interface DeferredLayerOptions {
  width: number;
  height: number;
  /** 1 = full resolution, 0.5 = quarter the pixels. Independent of the mesh. */
  sdfScale: number;
}

/** Optional per-producer draw overrides (M2 task 1). When present, the hook
 *  REPLACES the corresponding producer scene render: it runs at the owned
 *  producer target, after that target's sentinel clear, with autoClear off —
 *  exactly the state the default renderer.render(scene, camera) sees. A hook
 *  that throws unwinds through the layer's finally: every piece of renderer
 *  state is restored, then the error propagates. Absent hooks leave the M1
 *  path bit-identical. */
export interface DeferredRenderHooks {
  drawMesh?: () => void;
  drawSdf?: () => void;
}

/** Game environment terms for the lit stage (M2 task 1). Defaults restore the
 *  M1 fixture exactly: constant ambient, fog disabled. */
export interface DeferredEnvironment {
  ambient: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  fogEnabled: boolean;
}

/** The per-frame flashlight shadow inputs (M2 spec). RESERVED in task 1:
 *  setFlashlightShadow validates and stores the binding; no shader samples it
 *  until the shadow module lands in task 4. null = unshadowed, the M1
 *  default. Both depth maps are the CALLER's textures — the layer never
 *  disposes them. */
export interface DeferredFlashlightShadowBinding {
  fullDepth: THREE.Texture;
  levelDepth: THREE.Texture;
  viewProjection: THREE.Matrix4;
  lightIndex: number;
  bias: number;
  mapSize: THREE.Vector2;
  enabled: boolean;
}

/** M1-compatible defaults: the fixture's constant ambient, fog off. */
export const DEFERRED_ENVIRONMENT_DEFAULTS: DeferredEnvironment = {
  ambient: new THREE.Color(0.05, 0.05, 0.055),
  fogColor: new THREE.Color(0, 0, 0),
  fogNear: 1,
  fogFar: 40,
  fogEnabled: false,
};

export interface DeferredLimitCheck {
  name: string;
  required: number;
  actual: number;
}

export interface DeferredLayerDiagnostics {
  width: number;
  height: number;
  sdfScale: number;
  sdfTargetSize: { width: number; height: number };
  lightCount: number;
  lightCapacity: number;
  debugView: DeferredDebugView;
  /** Lit-stage environment (M2 task 1). */
  environment: {
    ambient: [number, number, number];
    fogColor: [number, number, number];
    fogNear: number;
    fogFar: number;
    fogEnabled: boolean;
  };
  /** True while the present pass writes into a caller-owned target. */
  outputTargetActive: boolean;
  /** True while a flashlight shadow binding is STORED. Sampling starts in
   *  task 4 — this flag makes the reservation observable without claiming
   *  any visual effect. */
  flashlightShadowBound: boolean;
  /** What was actually verified against the device, if a device was visible. */
  limits: { supported: boolean; ok: boolean; checks: DeferredLimitCheck[] };
}

export interface DeferredLayer {
  resize(width: number, height: number, sdfScale: number): void;
  render(meshScene: THREE.Scene, sdfScene: THREE.Scene, camera: THREE.PerspectiveCamera, hooks?: DeferredRenderHooks): void;
  setLights(lights: readonly DeferredLight[]): void;
  setDebugView(view: DeferredDebugView): void;
  /** Present into a caller-owned color+depth target (game composition) instead
   *  of the canvas. The target must have a depth buffer, must not be one of
   *  the layer's own targets (read-while-write hazard), and its size must
   *  match the layer's (checked at render time). null restores the M1 canvas
   *  default. The target receives LINEAR color — the single display encode
   *  stays on the canvas path / the game's post chain. */
  setOutputTarget(target: THREE.RenderTarget | null): void;
  /** Lit-stage environment (ambient + distance fog). Validates and COPIES:
   *  later mutation of the caller's colors cannot leak into the layer. */
  setEnvironment(environment: DeferredEnvironment): void;
  /** RESERVED (M2 task 4): validates and stores the flashlight shadow
   *  binding; nothing samples it yet. null = unshadowed (M1 default). */
  setFlashlightShadow(binding: DeferredFlashlightShadowBinding | null): void;
  dispose(): void;
  diagnostics(): DeferredLayerDiagnostics;
  /** Producer and resolved targets, for the task-3 GPU gate. Read-only:
   *  never render through these outside the layer's own passes. */
  readonly targets: {
    readonly mesh: THREE.RenderTarget;
    readonly sdf: THREE.RenderTarget;
    readonly resolved: THREE.RenderTarget;
    readonly lit: THREE.RenderTarget;
  };
}

/**
 * The resolve rule, translated once to TSL. Equivalent to selectSurface():
 *
 *   source = meshDepth < 1 && meshDepth <= sdfDepth ? 'mesh'
 *          : sdfDepth < 1 ? 'sdf' : 'empty'
 *
 * and every attribute is read from the SAME selected texel.
 */

/**
 * The shared light evaluation. Unlit linear G-buffer data in, linear HDR
 * radiance out; the present pass performs the one display conversion.
 *
 * Attenuation is bounded inverse-square: intensity * window^2 / max(d^2, eps)
 * with window = 1 - clamp(d/range)^4 (hard zero at range). The d^2 clamp
 * keeps a coincident light/surface finite. Spot cones smoothstep between
 * cosOuter and cosInner. Flesh (class 2) gets a wrapped diffuse and a
 * clamped, reduced specular — its bounded class-specific response. Emission
 * is additive linear radiance.
 */
export const DEFERRED_LIGHT_WGSL = /* wgsl */ `fn deferredLight(
  px: vec2<f32>,
  albedoRoughness: texture_2d<f32>,
  normalMetalness: texture_2d<f32>,
  emissionClass: texture_2d<f32>,
  surfaceDepth: texture_2d<f32>,
  lights: texture_2d<f32>,
  lightCount: f32,
  invViewProj: mat4x4<f32>,
  camPos: vec3<f32>,
  ambient: vec3<f32>,
  fogColor: vec3<f32>,
  fogNear: f32,
  fogFar: f32,
  fogEnabled: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(surfaceDepth, 0));
  let c = clamp(vec2<i32>(floor(px)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let gE = textureLoad(emissionClass, c, 0);
  let emission = gE.xyz;
  let cls = gE.w;
  // M2 task 1: emissionClass.a may carry packed receiver metadata — base
  // class in the low four bits, bit 4 = level-only shadow receiver
  // (deferred-surface.ts). Lighting branches on the DECODED base class; the
  // raw packed value stays in the attachment for the task-4 shadow lookup.
  let baseCls = cls - floor(cls / 16.0) * 16.0;
  let depth = textureLoad(surfaceDepth, c, 0).x;
  if (baseCls < 0.5 || depth >= 1.0) { return vec4<f32>(emission, 1.0); }
  let gA = textureLoad(albedoRoughness, c, 0);
  let gN = textureLoad(normalMetalness, c, 0);
  // World position from clip depth, pixel coordinate, inverse view-projection.
  // px IS the WebGPU fragment coordinate (@builtin(position).xy): it already
  // carries the pixel-center +0.5, origin top-left, so px/dims lands the texel
  // centre EXACTLY — adding another half pixel here shifts every reconstructed
  // world position (coordinator review fix 1). WebGPU clip z is already
  // [0,1] — no remap. ndc y flips relative to the fragment coordinate.
  let ndc = vec2<f32>(px.x / dims.x * 2.0 - 1.0, 1.0 - px.y / dims.y * 2.0);
  let wp4 = invViewProj * vec4<f32>(ndc, depth, 1.0);
  let world = wp4.xyz / wp4.w;
  let n = normalize(gN.xyz);
  let albedo = gA.xyz;
  let rough = clamp(gA.w, 0.04, 1.0);
  let metal = clamp(gN.w, 0.0, 1.0);
  let viewDir = normalize(camPos - world);
  let baseDiff = albedo * (1.0 - metal);
  let specCol = mix(vec3<f32>(0.04), albedo, metal);
  let isFlesh = baseCls > 1.5 && baseCls < 2.5;
  var acc = emission;
  // Constant ambient floor (M1 fixture choice): the shared light pass has no
  // probe/enclosure bounce — the legacy path's fill/scatter terms are the
  // inventoried omissions. Without a floor, surfaces outside every light's
  // range render pure black and read as MISSING data in captures.
  acc = acc + ambient * baseDiff;
  let count = i32(lightCount);
  for (var i = 0; i < ${MAX_DEFERRED_LIGHTS}; i = i + 1) {
    if (i >= count) { break; }
    let v0 = textureLoad(lights, vec2<i32>(0, i), 0);
    let v1 = textureLoad(lights, vec2<i32>(1, i), 0);
    let v2 = textureLoad(lights, vec2<i32>(2, i), 0);
    let v3 = textureLoad(lights, vec2<i32>(3, i), 0);
    let toL = v0.xyz - world;
    let d2 = max(dot(toL, toL), 1e-6);
    let d = sqrt(d2);
    let range = max(v1.w, 1e-4);
    let ratio = clamp(d / range, 0.0, 1.0);
    let window = 1.0 - ratio * ratio * ratio * ratio;
    if (window <= 0.0) { continue; }
    var att = v2.w * window * window / d2;
    if (v0.w > 0.5) {
      // Spot: smoothstep falloff between cosOuter and cosInner.
      let cd = dot(-toL / d, normalize(v1.xyz));
      let t = clamp((cd - v3.y) / max(v3.x - v3.y, 1e-4), 0.0, 1.0);
      att = att * t * t * (3.0 - 2.0 * t);
      if (att <= 0.0) { continue; }
    }
    var ndl = dot(n, toL / d);
    if (isFlesh) {
      // Bounded flesh-class response: wrapped diffuse, no field resampling.
      ndl = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
    } else {
      ndl = max(ndl, 0.0);
    }
    let h = normalize(toL / d + viewDir);
    let shin = exp2((1.0 - rough) * 8.0) + 2.0;
    var spec = pow(max(dot(n, h), 0.0), shin) * (shin + 2.0) / 8.0;
    if (isFlesh) { spec = min(spec, 1.0) * 0.35; }
    acc = acc + v2.xyz * att * (baseDiff * ndl + specCol * spec * ndl);
  }
  // M2 task 1: game distance fog, evaluated ONLY here in the lit stage (raw
  // surface and debug outputs never read it). Linear three.js-style falloff
  // from fogNear to fogFar against fogColor, gated behind the enable flag so
  // the M1 default (off) is a single branch. Emission fogs with the lit
  // surface — a glowing thing across the room is behind the same air. Empty
  // pixels returned above and stay unfogged: the backdrop is the present
  // pass's / the game composite's business, not a surface term.
  if (fogEnabled > 0.5) {
    let fogF = clamp((distance(camPos, world) - fogNear) / max(fogFar - fogNear, 1e-4), 0.0, 1.0);
    acc = mix(acc, fogColor, fogF);
  }
  return vec4<f32>(acc, 1.0);
}`;

/**
 * Debug view selection over the resolved/lit targets. Depth shows near as
 * bright ((1-d)^0.35); material maps class id to a colour (0 empty black,
 * 1 mesh blue, 2 flesh red, 3 flat green).
 */
export const DEFERRED_PRESENT_WGSL = /* wgsl */ `fn deferredPresent(
  px: vec2<f32>,
  lit: texture_2d<f32>,
  albedoRoughness: texture_2d<f32>,
  normalMetalness: texture_2d<f32>,
  emissionClass: texture_2d<f32>,
  surfaceDepth: texture_2d<f32>,
  view: f32,
  flipY: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(surfaceDepth, 0));
  var c = clamp(vec2<i32>(floor(px)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  if (flipY > 0.5) { c.y = i32(dims.y) - 1 - c.y; }
  if (view < 0.5) { return vec4<f32>(textureLoad(lit, c, 0).xyz, 1.0); }
  if (view < 1.5) { return vec4<f32>(textureLoad(albedoRoughness, c, 0).xyz, 1.0); }
  if (view < 2.5) { return vec4<f32>(textureLoad(normalMetalness, c, 0).xyz * 0.5 + vec3<f32>(0.5), 1.0); }
  if (view < 3.5) {
    let d = textureLoad(surfaceDepth, c, 0).x;
    return vec4<f32>(vec3<f32>(pow(1.0 - d, 0.35)), 1.0);
  }
  let cls = textureLoad(emissionClass, c, 0).w;
  // Decode the packed value (deferred-surface.ts) so an encoded flesh sample
  // still maps to the flesh colour; the raw value stays in the attachment.
  let baseCls = cls - floor(cls / 16.0) * 16.0;
  var col = vec3<f32>(0.0, 0.0, 0.0);
  if (baseCls > 0.5 && baseCls < 1.5) { col = vec3<f32>(0.2, 0.5, 1.0); }
  else if (baseCls > 1.5 && baseCls < 2.5) { col = vec3<f32>(1.0, 0.3, 0.2); }
  else if (baseCls > 2.5) { col = vec3<f32>(0.3, 1.0, 0.4); }
  return vec4<f32>(col, 1.0);
}`;

/**
 * The present pass's DEPTH output (M2 task 1): the resolved surfaceDepth of
 * the same texel the colour just presented, flip and all. Written through the
 * material's depthNode so a caller-owned output target ends the frame with
 * hardware depth IDENTICAL to the resolved G-buffer — forward effects then
 * composite against it. Empty pixels carry the far sentinel (exactly 1).
 * Canvas presentation keeps depth writes off (M1 default) — the canvas has no
 * downstream consumer.
 */
export const DEFERRED_PRESENT_DEPTH_WGSL = /* wgsl */ `fn deferredPresentDepth(
  px: vec2<f32>,
  surfaceDepth: texture_2d<f32>,
  flipY: f32
) -> f32 {
  let dims = vec2<f32>(textureDimensions(surfaceDepth, 0));
  var c = clamp(vec2<i32>(floor(px)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  if (flipY > 0.5) { c.y = i32(dims.y) - 1 - c.y; }
  return textureLoad(surfaceDepth, c, 0).x;
}`;

function checkAdapterLimits(renderer: THREE.WebGPURenderer): DeferredLayerDiagnostics['limits'] {
  const device = (renderer as unknown as { backend?: { device?: { limits?: Record<string, number> } } })
    .backend?.device;
  const limits = device?.limits;
  if (!limits) {
    // No visible device (unit tests, non-WebGPU backend): nothing checked,
    // reported as such — never silently claimed.
    return { supported: false, ok: true, checks: [] };
  }
  const checks: DeferredLimitCheck[] = [
    { name: 'maxColorAttachments', required: SURFACE_ATTACHMENT_NAMES.length, actual: limits.maxColorAttachments ?? 0 },
    { name: 'maxColorAttachmentBytesPerSample', required: SURFACE_COLOR_BYTES_PER_SAMPLE, actual: limits.maxColorAttachmentBytesPerSample ?? 0 },
  ];
  const failing = checks.filter((c) => c.actual < c.required);
  if (failing.length > 0) {
    throw new Error(
      `deferred layer exceeds adapter limits: ${failing.map((f) => `${f.name} ${f.actual} < ${f.required}`).join('; ')}`,
    );
  }
  return { supported: true, ok: true, checks };
}

export function createDeferredLayer(renderer: THREE.WebGPURenderer, options: DeferredLayerOptions): DeferredLayer {
  const limits = checkAdapterLimits(renderer);

  // Construction-time validation (sdfTargetSize validates scale AND size).
  const initialSdfSize = sdfTargetSize(options.width, options.height, options.sdfScale);
  let width = Math.max(1, Math.round(options.width));
  let height = Math.max(1, Math.round(options.height));
  let sdfScale = options.sdfScale;
  let sdfW = initialSdfSize.width;
  let sdfH = initialSdfSize.height;
  let disposed = false;

  const meshTarget = createSurfaceTarget(width, height);
  const sdfTarget = createSurfaceTarget(sdfW, sdfH);
  const resolvedTarget = createSurfaceTarget(width, height);
  const litTarget = new THREE.RenderTarget(width, height, {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  litTarget.texture.colorSpace = THREE.NoColorSpace;
  litTarget.texture.generateMipmaps = false;

  // Texture object identity persists across RenderTarget.setSize (sdf-layer
  // relies on the same), so these bindings stay valid over resizes.
  const meshTex = getSurfaceTextures(meshTarget);
  const sdfTex = getSurfaceTextures(sdfTarget);
  const resolvedTex = getSurfaceTextures(resolvedTarget);

  const lightTexture = createDeferredLightTexture();
  const uLightCount = uniform(0);
  const uInvViewProj = uniform(new THREE.Matrix4());
  const uCamPos = uniform(new THREE.Vector3());
  /** Constant ambient floor — see the deferredLight WGSL note. Fixed for M1;
   *  not a per-light term, so it cannot leak light-dependence into surface
   *  data (it lives in the lit target only). M2 task 1: settable through
   *  setEnvironment, defaulting to exactly this value. */
  const uAmbient = uniform(new THREE.Color(DEFERRED_ENVIRONMENT_DEFAULTS.ambient.r, DEFERRED_ENVIRONMENT_DEFAULTS.ambient.g, DEFERRED_ENVIRONMENT_DEFAULTS.ambient.b));
  /** Lit-stage distance fog (M2 task 1). Defaults are DISABLED fog, so the
   *  M1 output is unchanged until a caller opts in. */
  const uFogColor = uniform(new THREE.Color(DEFERRED_ENVIRONMENT_DEFAULTS.fogColor.r, DEFERRED_ENVIRONMENT_DEFAULTS.fogColor.g, DEFERRED_ENVIRONMENT_DEFAULTS.fogColor.b));
  const uFogNear = uniform(DEFERRED_ENVIRONMENT_DEFAULTS.fogNear);
  const uFogFar = uniform(DEFERRED_ENVIRONMENT_DEFAULTS.fogFar);
  const uFogEnabled = uniform(DEFERRED_ENVIRONMENT_DEFAULTS.fogEnabled ? 1 : 0);
  /** dest-to-sdf texel ratio for the nearest low-res fetch. */
  const uSdfRatio = uniform(new THREE.Vector2(sdfW / width, sdfH / height));
  /** Present-pass debug selector (DEBUG_VIEW_INDEX). */
  const uView = uniform(0);
  /** The single documented boundary transform — see the orientation note. */
  const uFlipY = uniform(0);

  let lightCount = 0;
  let debugView: DeferredDebugView = 'lit';
  /** Caller-owned present target (M2 task 1). null = canvas (M1 default). */
  let outputTarget: THREE.RenderTarget | null = null;
  /** Stored flashlight shadow binding (M2 task 1). Reserved: nothing samples
   *  it until task 4. */
  let flashlightShadow: DeferredFlashlightShadowBinding | null = null;

  // ---- fullscreen pass scaffolding ----------------------------------------
  // The ortho quad camera at z = 1, so the z = 0 plane sits inside [0, 1]
  // depth rather than exactly on the near plane (sdf-layer pattern).
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  quadCam.position.z = 1;
  const quadGeom = new THREE.PlaneGeometry(2, 2);

  function quadPass(mat: MeshBasicNodeMaterial): THREE.Scene {
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.transparent = false;
    const quad = new THREE.Mesh(quadGeom, mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return scene;
  }

  // 1/3. Empty-state clear: depth sentinel 1, class sentinel 0, zeros
  // elsewhere. One MRT quad writes every attachment; the renderer's autoClear
  // during the same pass resets the hardware depth.
  const clearMat = new MeshBasicNodeMaterial();
  clearMat.mrtNode = mrt({
    albedoRoughness: vec4(0.0, 0.0, 0.0, 1.0),
    normalMetalness: vec4(0.0, 0.0, 1.0, 0.0),
    emissionClass: vec4(0.0, 0.0, 0.0, 0.0),
    surfaceDepth: vec4(1.0, 1.0, 1.0, 1.0),
  });
  const clearScene = quadPass(clearMat);

  // 5. Resolve: nearest-depth selection into the full-res resolved G-buffer.
  // Both producer targets are sampled by integer fragment coordinate; the
  // low-res SDF texel is floor(px * sdfDims/destDims) — nearest, the game's
  // pixel style, and never blended across silhouettes.
  const ipx = ivec2(screenCoordinate);
  const sdfPx = ivec2(floor(screenCoordinate.mul(uSdfRatio)));
  const mDepth = textureLoad(meshTex.surfaceDepth, ipx).x.toVar('mDepth');
  const sDepth = textureLoad(sdfTex.surfaceDepth, sdfPx).x.toVar('sDepth');
  const meshWin = mDepth.lessThan(1.0).and(mDepth.lessThanEqual(sDepth));
  const sdfWin = meshWin.not().and(sDepth.lessThan(1.0));
  const pickVec4 = (meshA: THREE.Texture, sdfA: THREE.Texture) =>
    select(meshWin, textureLoad(meshA, ipx), select(sdfWin, textureLoad(sdfA, sdfPx), vec4(0.0, 0.0, 0.0, 0.0)));
  const rDepth = select(meshWin, mDepth, select(sdfWin, sDepth, 1.0));
  const resolveMat = new MeshBasicNodeMaterial();
  resolveMat.mrtNode = mrt({
    albedoRoughness: pickVec4(meshTex.albedoRoughness, sdfTex.albedoRoughness),
    normalMetalness: pickVec4(meshTex.normalMetalness, sdfTex.normalMetalness),
    emissionClass: pickVec4(meshTex.emissionClass, sdfTex.emissionClass),
    surfaceDepth: vec4(rDepth, 0.0, 0.0, 1.0),
  });
  const resolveScene = quadPass(resolveMat);

  // 6. The single shared light evaluation.
  const lightFn = wgslFn(DEFERRED_LIGHT_WGSL);
  const lightMat = new MeshBasicNodeMaterial();
  lightMat.colorNode = lightFn({
    px: screenCoordinate,
    albedoRoughness: texture(resolvedTex.albedoRoughness),
    normalMetalness: texture(resolvedTex.normalMetalness),
    emissionClass: texture(resolvedTex.emissionClass),
    surfaceDepth: texture(resolvedTex.surfaceDepth),
    lights: texture(lightTexture),
    lightCount: uLightCount,
    invViewProj: uInvViewProj,
    camPos: uCamPos,
    ambient: uAmbient,
    fogColor: uFogColor,
    fogNear: uFogNear,
    fogFar: uFogFar,
    fogEnabled: uFogEnabled,
  }) as never;
  const lightScene = quadPass(lightMat);

  // 7. Present / debug views. TWO fixed-config materials, each compiled
  // exactly once (M2 task 1): the canvas path keeps the M1 depth-less
  // presentation; the owned-target path presents with DEPTH WRITES
  // (depthNode = the resolved surfaceDepth of the presented texel). They are
  // separate materials because three compiles a NodeMaterial's depth output
  // only if depthWrite/depthTest is set AT COMPILE TIME and caches the graph —
  // a per-frame depthWrite toggle on one shared material would silently keep
  // the first-compiled, depth-less shader.
  const presentFn = wgslFn(DEFERRED_PRESENT_WGSL);
  const presentDepthFn = wgslFn(DEFERRED_PRESENT_DEPTH_WGSL);
  const presentArgs = () => ({
    px: screenCoordinate,
    lit: texture(litTarget.texture),
    albedoRoughness: texture(resolvedTex.albedoRoughness),
    normalMetalness: texture(resolvedTex.normalMetalness),
    emissionClass: texture(resolvedTex.emissionClass),
    surfaceDepth: texture(resolvedTex.surfaceDepth),
    view: uView,
    flipY: uFlipY,
  });
  // Canvas (M1 default).
  const presentMat = new MeshBasicNodeMaterial();
  presentMat.colorNode = presentFn(presentArgs()) as never;
  const presentScene = quadPass(presentMat);
  // Caller-owned color+depth target: fullscreen opaque presentation — depth
  // tests are pointless for a quad that covers every pixel, but depth WRITES
  // are the point (the resolved depth lands in the caller's depth buffer).
  const targetPresentMat = new MeshBasicNodeMaterial();
  targetPresentMat.colorNode = presentFn(presentArgs()) as never;
  targetPresentMat.depthNode = presentDepthFn({
    px: screenCoordinate,
    surfaceDepth: texture(resolvedTex.surfaceDepth),
    flipY: uFlipY,
  }) as never;
  targetPresentMat.depthTest = false;
  targetPresentMat.depthWrite = true;
  const targetPresentScene = quadPass(targetPresentMat);

  const _view = new THREE.Matrix4();
  const _vp = new THREE.Matrix4();

  function assertAlive(): void {
    if (disposed) throw new Error('deferred layer is disposed');
  }

  return {
    resize(nextWidth, nextHeight, nextScale) {
      assertAlive();
      const sdf = sdfTargetSize(nextWidth, nextHeight, nextScale);
      width = Math.max(1, Math.round(nextWidth));
      height = Math.max(1, Math.round(nextHeight));
      sdfScale = nextScale;
      sdfW = sdf.width;
      sdfH = sdf.height;
      // RenderTarget.setSize reallocates the backing textures (never a
      // DataTexture-style in-place mutation). Stale contents are not a
      // hazard: every target is fully rewritten by the per-frame clear
      // quads and fullscreen resolve/light passes before it is sampled.
      meshTarget.setSize(width, height);
      sdfTarget.setSize(sdfW, sdfH);
      resolvedTarget.setSize(width, height);
      litTarget.setSize(width, height);
      uSdfRatio.value.set(sdfW / width, sdfH / height);
    },

    render(meshScene, sdfScene, camera, hooks) {
      assertAlive();
      // M2 task 1: an owned output target must match the layer's size — a
      // mismatch would silently edge-smear the presentation (nearest clamped
      // loads), so it is a loud error instead. Checked here (not in resize)
      // so the caller may resize in either order.
      if (outputTarget && (outputTarget.width !== width || outputTarget.height !== height)) {
        throw new Error(
          `output target size ${outputTarget.width}x${outputTarget.height} does not match layer size ${width}x${height} — resize them together`,
        );
      }
      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      // Coordinator review fix 5: autoClear=true does NOT imply a hardware
      // depth clear — a caller with autoClearDepth=false or clearDepth 0
      // (sdf-layer's shell-exit pass sets exactly that) would leave stale/zero
      // hardware depth in the producer targets, and the sentinel clear quad
      // (depthWrite off) cannot dig out of it. Force a depth-1 clear for the
      // producer clear passes and restore the caller's state afterwards.
      const previousAutoClearDepth = renderer.autoClearDepth;
      const previousClearDepth = renderer.getClearDepth();
      // Coordinator review fix 4: a caller-level MRT (renderer.setMRT) MERGES
      // INTO/replaces the producers' material-level mrtNode outputs. The owned
      // passes must run with no renderer MRT; restore the caller's after.
      const previousMrt = renderer.getMRT();
      const previousMask = camera.layers.mask;
      // Coordinator review fix 3: a Color scene.background force-clears the
      // target THROUGH the renderer (Background.js sets forceClear even with
      // autoClear=false), overwriting the sentinel clear — empty pixels would
      // read depth<1/class!=0 and occlude the SDF. A backgroundNode draws a
      // depthless skybox mesh into the G-buffer, same corruption. Suppress
      // both for the producer passes; restore in finally, including exceptions.
      const producerScenes = [meshScene, sdfScene] as const;
      const previousBackgrounds = producerScenes.map((s) => ({
        scene: s,
        background: s.background,
        backgroundNode: (s as THREE.Scene & { backgroundNode?: unknown }).backgroundNode ?? null,
      }));
      try {
        // Present-pass depth writes live on the FIXED target-present material
        // (compiled with depthWrite=true from construction); the canvas
        // material keeps the M1 depth-less presentation. Nothing toggles at
        // runtime — see the two-material note above.
        // Coordinator review fix 2: a FRESH PerspectiveCamera defaults to
        // WebGL clip conventions; WebGPURenderer only rewrites its
        // coordinateSystem/projection during the first geometry render —
        // AFTER we would have cached the inverse view-projection below.
        // Sync the camera to the renderer's coordinate system FIRST, exactly
        // as Renderer.render itself does (Renderer.js:3474), so the very
        // first frame reconstructs world positions from the actual WebGPU
        // projection.
        const coordinateSystem = (renderer as unknown as { coordinateSystem?: number }).coordinateSystem;
        if (coordinateSystem !== undefined &&
            (camera as unknown as { coordinateSystem?: number }).coordinateSystem !== coordinateSystem) {
          (camera as unknown as { coordinateSystem: number }).coordinateSystem = coordinateSystem;
          camera.updateProjectionMatrix();
        }
        // Camera state for the light pass's world reconstruction.
        camera.updateMatrixWorld();
        _view.copy(camera.matrixWorld).invert();
        _vp.multiplyMatrices(camera.projectionMatrix, _view);
        uInvViewProj.value.copy(_vp).invert();
        uCamPos.value.setFromMatrixPosition(camera.matrixWorld);

        for (const prev of previousBackgrounds) {
          prev.scene.background = null;
          (prev.scene as THREE.Scene & { backgroundNode?: unknown }).backgroundNode = null;
        }
        renderer.setMRT(null);
        renderer.autoClearDepth = true;
        renderer.setClearDepth(1);

        renderer.setRenderTarget(meshTarget);
        renderer.autoClear = true;
        void renderer.render(clearScene, quadCam);
        renderer.autoClear = false;
        if (hooks?.drawMesh) hooks.drawMesh();
        else void renderer.render(meshScene, camera);

        renderer.setRenderTarget(sdfTarget);
        renderer.autoClear = true;
        void renderer.render(clearScene, quadCam);
        renderer.autoClear = false;
        if (hooks?.drawSdf) hooks.drawSdf();
        else void renderer.render(sdfScene, camera);

        renderer.setRenderTarget(resolvedTarget);
        void renderer.render(resolveScene, quadCam);

        renderer.setRenderTarget(litTarget);
        void renderer.render(lightScene, quadCam);

        if (outputTarget) {
          // M2 task 1: present into the caller-owned target. autoClear=true
          // resets the destination color AND hardware depth (clearDepth is
          // already forced to 1 for the whole frame) before the fullscreen
          // quad rewrites every pixel with depth writes on — the frame
          // contract's "clear destination depth before presenting".
          renderer.setRenderTarget(outputTarget);
          renderer.autoClear = true;
          void renderer.render(targetPresentScene, quadCam);
        } else {
          renderer.setRenderTarget(null);
          renderer.autoClear = previousAutoClear;
          void renderer.render(presentScene, quadCam);
        }
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = previousAutoClear;
        renderer.autoClearDepth = previousAutoClearDepth;
        renderer.setClearDepth(previousClearDepth);
        renderer.setMRT(previousMrt);
        for (const prev of previousBackgrounds) {
          prev.scene.background = prev.background;
          (prev.scene as THREE.Scene & { backgroundNode?: unknown }).backgroundNode = prev.backgroundNode;
        }
        camera.layers.mask = previousMask;
      }
    },

    setLights(lights) {
      assertAlive();
      // packDeferredLights throws on overflow/invalid BEFORE any state moves,
      // so a rejected set never corrupts the previous buffer.
      const packed = packDeferredLights(lights);
      uploadDeferredLights(lightTexture, packed);
      uLightCount.value = packed.count;
      lightCount = packed.count;
    },

    setDebugView(view) {
      assertAlive();
      if (!(view in DEBUG_VIEW_INDEX)) {
        throw new RangeError(`unknown debug view '${view}' (expected lit|albedo|normal|depth|material)`);
      }
      debugView = view;
      uView.value = DEBUG_VIEW_INDEX[view];
    },

    setOutputTarget(target) {
      assertAlive();
      if (target === outputTarget) return;
      if (target !== null) {
        if (
          target === meshTarget || target === sdfTarget
          || target === resolvedTarget || target === litTarget
        ) {
          throw new Error('setOutputTarget: the layer\'s own targets are read by the present pass — passing one back is a read-while-write hazard');
        }
        if (!target.depthBuffer) {
          throw new Error('setOutputTarget: the target must have a depth buffer — the present pass writes the resolved depth into it');
        }
      }
      outputTarget = target;
    },

    setEnvironment(environment) {
      assertAlive();
      // Validate BEFORE any uniform moves, so a rejected set keeps the
      // previous environment (same discipline as setLights).
      const { ambient, fogColor, fogNear, fogFar, fogEnabled } = environment;
      if (!(ambient as unknown as { isColor?: boolean }).isColor) throw new TypeError('setEnvironment: ambient must be a THREE.Color');
      if (!(fogColor as unknown as { isColor?: boolean }).isColor) throw new TypeError('setEnvironment: fogColor must be a THREE.Color');
      for (const [label, v] of [
        ['ambient.r', ambient.r], ['ambient.g', ambient.g], ['ambient.b', ambient.b],
        ['fogColor.r', fogColor.r], ['fogColor.g', fogColor.g], ['fogColor.b', fogColor.b],
        ['fogNear', fogNear], ['fogFar', fogFar],
      ] as const) {
        if (!Number.isFinite(v)) throw new RangeError(`setEnvironment: ${label} must be finite, got ${v}`);
      }
      if (fogNear < 0) throw new RangeError(`setEnvironment: fogNear must be >= 0, got ${fogNear}`);
      if (fogFar <= fogNear) throw new RangeError(`setEnvironment: fogFar (${fogFar}) must be greater than fogNear (${fogNear})`);
      // Copy — later mutation of the caller's Color objects cannot leak in.
      uAmbient.value.copy(ambient);
      uFogColor.value.copy(fogColor);
      uFogNear.value = fogNear;
      uFogFar.value = fogFar;
      uFogEnabled.value = fogEnabled ? 1 : 0;
    },

    setFlashlightShadow(binding) {
      assertAlive();
      // Task-1 reservation: validate and store ONLY. Nothing samples this
      // until the task-4 shadow module lands; a bound-but-unimplemented
      // binding must not change any output.
      if (binding !== null) {
        if (typeof binding !== 'object') throw new TypeError('setFlashlightShadow: binding must be an object or null');
        if (!(binding.fullDepth as unknown as { isTexture?: boolean })?.isTexture
          || !(binding.levelDepth as unknown as { isTexture?: boolean })?.isTexture) {
          throw new TypeError('setFlashlightShadow: fullDepth and levelDepth must be THREE.Textures');
        }
        if (!(binding.viewProjection as unknown as { isMatrix4?: boolean })?.isMatrix4) {
          throw new TypeError('setFlashlightShadow: viewProjection must be a THREE.Matrix4');
        }
        if (!Number.isFinite(binding.bias)) throw new RangeError('setFlashlightShadow: bias must be finite');
        if (!Number.isInteger(binding.lightIndex) || binding.lightIndex < 0 || binding.lightIndex >= MAX_DEFERRED_LIGHTS) {
          throw new RangeError(`setFlashlightShadow: lightIndex must be an integer in [0, ${MAX_DEFERRED_LIGHTS}), got ${binding.lightIndex}`);
        }
        const { mapSize } = binding;
        if (!mapSize || !Number.isFinite(mapSize.x) || !Number.isFinite(mapSize.y) || mapSize.x <= 0 || mapSize.y <= 0) {
          throw new RangeError('setFlashlightShadow: mapSize must be finite and positive');
        }
        if (typeof binding.enabled !== 'boolean') throw new TypeError('setFlashlightShadow: enabled must be a boolean');
      }
      flashlightShadow = binding;
    },

    diagnostics() {
      return {
        width,
        height,
        sdfScale,
        sdfTargetSize: { width: sdfW, height: sdfH },
        lightCount,
        lightCapacity: MAX_DEFERRED_LIGHTS,
        debugView,
        environment: {
          ambient: [uAmbient.value.r, uAmbient.value.g, uAmbient.value.b],
          fogColor: [uFogColor.value.r, uFogColor.value.g, uFogColor.value.b],
          fogNear: uFogNear.value,
          fogFar: uFogFar.value,
          fogEnabled: uFogEnabled.value > 0.5,
        },
        outputTargetActive: outputTarget !== null,
        flashlightShadowBound: flashlightShadow !== null,
        limits,
      };
    },

    targets: { mesh: meshTarget, sdf: sdfTarget, resolved: resolvedTarget, lit: litTarget },

    dispose() {
      if (disposed) return;
      disposed = true;
      meshTarget.dispose();
      sdfTarget.dispose();
      resolvedTarget.dispose();
      litTarget.dispose();
      lightTexture.dispose();
      quadGeom.dispose();
      clearMat.dispose();
      resolveMat.dispose();
      lightMat.dispose();
      presentMat.dispose();
      targetPresentMat.dispose();
    },
  };
}
