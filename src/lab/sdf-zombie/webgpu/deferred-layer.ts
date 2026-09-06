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
// autoClear during that pass resets the hardware depth attachment; the layer
// assumes the app's clearDepth is the default 1.
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
  /** What was actually verified against the device, if a device was visible. */
  limits: { supported: boolean; ok: boolean; checks: DeferredLimitCheck[] };
}

export interface DeferredLayer {
  resize(width: number, height: number, sdfScale: number): void;
  render(meshScene: THREE.Scene, sdfScene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  setLights(lights: readonly DeferredLight[]): void;
  setDebugView(view: DeferredDebugView): void;
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
const DEFERRED_LIGHT_WGSL = /* wgsl */ `fn deferredLight(
  px: vec2<f32>,
  albedoRoughness: texture_2d<f32>,
  normalMetalness: texture_2d<f32>,
  emissionClass: texture_2d<f32>,
  surfaceDepth: texture_2d<f32>,
  lights: texture_2d<f32>,
  lightCount: f32,
  invViewProj: mat4x4<f32>,
  camPos: vec3<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(surfaceDepth, 0));
  let c = clamp(vec2<i32>(floor(px)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let gE = textureLoad(emissionClass, c, 0);
  let emission = gE.xyz;
  let cls = gE.w;
  let depth = textureLoad(surfaceDepth, c, 0).x;
  if (cls < 0.5 || depth >= 1.0) { return vec4<f32>(emission, 1.0); }
  let gA = textureLoad(albedoRoughness, c, 0);
  let gN = textureLoad(normalMetalness, c, 0);
  // World position from clip depth, pixel coordinate, inverse view-projection.
  // px is the fragment coordinate (origin top-left); ndc y flips relative to
  // it. WebGPU clip z is already [0,1] — no remap.
  let ndc = vec2<f32>((px.x + 0.5) / dims.x * 2.0 - 1.0, 1.0 - (px.y + 0.5) / dims.y * 2.0);
  let wp4 = invViewProj * vec4<f32>(ndc, depth, 1.0);
  let world = wp4.xyz / wp4.w;
  let n = normalize(gN.xyz);
  let albedo = gA.xyz;
  let rough = clamp(gA.w, 0.04, 1.0);
  let metal = clamp(gN.w, 0.0, 1.0);
  let viewDir = normalize(camPos - world);
  let baseDiff = albedo * (1.0 - metal);
  let specCol = mix(vec3<f32>(0.04), albedo, metal);
  let isFlesh = cls > 1.5 && cls < 2.5;
  var acc = emission;
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
  return vec4<f32>(acc, 1.0);
}`;

/**
 * Debug view selection over the resolved/lit targets. Depth shows near as
 * bright ((1-d)^0.35); material maps class id to a colour (0 empty black,
 * 1 mesh blue, 2 flesh red, 3 flat green).
 */
const DEFERRED_PRESENT_WGSL = /* wgsl */ `fn deferredPresent(
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
  var col = vec3<f32>(0.0, 0.0, 0.0);
  if (cls > 0.5 && cls < 1.5) { col = vec3<f32>(0.2, 0.5, 1.0); }
  else if (cls > 1.5 && cls < 2.5) { col = vec3<f32>(1.0, 0.3, 0.2); }
  else if (cls > 2.5) { col = vec3<f32>(0.3, 1.0, 0.4); }
  return vec4<f32>(col, 1.0);
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
  /** dest-to-sdf texel ratio for the nearest low-res fetch. */
  const uSdfRatio = uniform(new THREE.Vector2(sdfW / width, sdfH / height));
  /** Present-pass debug selector (DEBUG_VIEW_INDEX). */
  const uView = uniform(0);
  /** The single documented boundary transform — see the orientation note. */
  const uFlipY = uniform(0);

  let lightCount = 0;
  let debugView: DeferredDebugView = 'lit';

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
  }) as never;
  const lightScene = quadPass(lightMat);

  // 7. Present / debug views, to the canvas.
  const presentFn = wgslFn(DEFERRED_PRESENT_WGSL);
  const presentMat = new MeshBasicNodeMaterial();
  presentMat.colorNode = presentFn({
    px: screenCoordinate,
    lit: texture(litTarget.texture),
    albedoRoughness: texture(resolvedTex.albedoRoughness),
    normalMetalness: texture(resolvedTex.normalMetalness),
    emissionClass: texture(resolvedTex.emissionClass),
    surfaceDepth: texture(resolvedTex.surfaceDepth),
    view: uView,
    flipY: uFlipY,
  }) as never;
  const presentScene = quadPass(presentMat);

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

    render(meshScene, sdfScene, camera) {
      assertAlive();
      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      const previousMask = camera.layers.mask;
      try {
        // Camera state for the light pass's world reconstruction.
        camera.updateMatrixWorld();
        _view.copy(camera.matrixWorld).invert();
        _vp.multiplyMatrices(camera.projectionMatrix, _view);
        uInvViewProj.value.copy(_vp).invert();
        uCamPos.value.setFromMatrixPosition(camera.matrixWorld);

        renderer.setRenderTarget(meshTarget);
        renderer.autoClear = true;
        void renderer.render(clearScene, quadCam);
        renderer.autoClear = false;
        void renderer.render(meshScene, camera);

        renderer.setRenderTarget(sdfTarget);
        renderer.autoClear = true;
        void renderer.render(clearScene, quadCam);
        renderer.autoClear = false;
        void renderer.render(sdfScene, camera);

        renderer.setRenderTarget(resolvedTarget);
        void renderer.render(resolveScene, quadCam);

        renderer.setRenderTarget(litTarget);
        void renderer.render(lightScene, quadCam);

        renderer.setRenderTarget(null);
        renderer.autoClear = previousAutoClear;
        void renderer.render(presentScene, quadCam);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = previousAutoClear;
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

    diagnostics() {
      return {
        width,
        height,
        sdfScale,
        sdfTargetSize: { width: sdfW, height: sdfH },
        lightCount,
        lightCapacity: MAX_DEFERRED_LIGHTS,
        debugView,
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
    },
  };
}
