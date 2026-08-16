// src/lab/sdf-zombie/webgpu/sdf-layer.ts
//
// Renders the raymarched bodies into their own render target, at their own
// resolution, and composites the result back over the polygonal scene.
//
// WHY. Measured cost is close to linear in PIXELS — 518k px cost 141 ms where
// 130k cost 49 ms — and the raymarcher is the only expensive thing in the
// frame. So halving the SDF layer's resolution is worth roughly 4x on the
// dominant term, where every quality lever put together was worth 24%.
//
// It also fits Blud specifically rather than being a generic compromise: the
// game already renders at 960x540 and upscales with `image-rendering:
// pixelated`, so a chunkier flesh layer reads as more of the intended look,
// not less of it. Level geometry stays full resolution.
//
// HOW THE OCCLUSION WORKS, and why there is no depth texture here. The march
// writes its depth into the colour target's ALPHA (see createMarchMaterial),
// and the composite quad feeds that straight to `depthNode` with depth testing
// left on. The hardware then compares it against the depth the polygonal pass
// already left in the canvas: a body behind the floor fails and never appears,
// one in front passes.
//
// Attaching a `DepthTexture` and sampling it as `texture_depth_2d` was the
// first attempt and it read as "near" everywhere — the quad passed the depth
// test across the whole screen, painted the floor out, and left only the
// nearer reference cube showing through. Depth in a float alpha channel has
// none of that ambiguity.
//
// What this does NOT do is make an occluded body cheaper. It still marches
// every pixel of its proxy box inside the SDF pass, because that pass cannot
// see the floor. Cutting occluded work needs early-Z, which frag_depth and
// discard rule out — see the LOD note.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { wgslFn, texture, uv, vec4, uniform } from 'three/tsl';
import { createConeUniforms, type ConeSource, type OccluderSource } from './zombie-gpu';

/**
 * The layer SDF bodies live on. Everything raymarched goes here; the polygonal
 * scene stays on the default layer 0, so the two passes are a camera layer
 * mask apart rather than an object list to keep in sync.
 */
export const SDF_LAYER = 1;

/**
 * The layer the coarse cone-march twins live on.
 *
 * A separate layer rather than a material swap: swapping materials on every
 * mesh each frame would dirty three's render lists, and the twin needs its own
 * depth buffer anyway.
 */
export const CONE_LAYER = 2;

/**
 * The layer the conservative INNER-HULL occluders live on.
 *
 * The march writes frag_depth and discards, which between them defeat early-Z,
 * so a body fully hidden behind another still pays in full — measured at 6.2x
 * for ten bodies sharing one body's silhouette. WGSL has no equivalent of
 * EXT_conservative_depth's depth_greater qualifier to win early-Z back, so the
 * rejection has to be done by hand: rasterise cheap geometry that is
 * GUARANTEED to lie inside the real surface, and let every ray stop at the
 * distance that hull covers.
 *
 * Inside-ness is what makes it safe, and it comes free from the field's own
 * algebra: smin only ever ADDS material, so the raw primitives are strictly
 * inside the blended surface they build.
 */
export const OCCLUDER_LAYER = 3;

/**
 * Tile size of the cone pre-pass, in full-resolution pixels.
 *
 * 8 is the figure the technique is usually quoted with. Bigger tiles make the
 * pre-pass cheaper but the cone wider, and a wider cone stops earlier — so the
 * start distance it proves is less useful. Cheap to change and worth sweeping.
 */
export const CONE_TILE = 8;

/**
 * Tile size of an optional SECOND, finer cone level. **0 — off by default.**
 *
 * The reasoning for adding one was half right and it is worth keeping the
 * whole argument. A narrower cone DOES travel further before it touches, so a
 * finer level hands the full march a strictly larger proven-empty distance
 * than 8x8 alone. What that reasoning ignored is the COST of the level:
 * pre-pass cost grows as 1/tile^2, so halving the tile quadruples it. The 8x8
 * level is a sixty-fourth of the pixels and nearly free; a 2x2 level is a
 * QUARTER of them, which is most of a full march.
 *
 * Measured at 10 bodies, repeats within 3%: a 2x2 second level made the frame
 * ~30% SLOWER (112 ms to 146 ms) than the single level alone, while the single
 * 8x8 level was worth -22%. So the second level is off, and this stays tunable
 * via setConeFineTile() because 4 was never cleanly measured — the sweep that
 * would have settled it drifted 60% on its own control and was thrown out.
 *
 * The deeper reason this does not pay: the ARBM recursion it was modelled on
 * is ADAPTIVE, subdividing only the patches that need it. A uniform finer
 * level pays full cost across the entire screen to help the few tiles that
 * had further to travel.
 */
export const CONE_TILE_FINE = 0;

/**
 * Samples the SDF layer at the current pixel. rgb is colour, a is depth.
 *
 * `textureLoad` with explicit integer coordinates, not `textureSample`: the
 * upscale must be NEAREST so the flesh layer reads as chunky pixels rather
 * than a blur, which is the point of doing this on a game that already
 * upscales with `image-rendering: pixelated`. Filtering depth would be wrong
 * outright — an averaged depth is a surface that exists nowhere.
 *
 * `flipY` is a uniform rather than a constant because whether a render target
 * comes back the same way up as the canvas is a property of the backend, not
 * something to assume. It is verified on screen and pinned in lab-main.
 */
export const COMPOSITE_WGSL = /* wgsl */ `fn sdfComposite(
  layerTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(layerTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let c = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let texel = textureLoad(layerTex, c, 0);
  // The target is cleared with alpha 1.0, which is the far plane and means
  // "the march discarded here". Without this the clear colour would paint over
  // the polygonal scene everywhere the bodies are not.
  if (texel.w >= 1.0) { discard; }
  return texel;
}`;

const composite = wgslFn(COMPOSITE_WGSL);

export interface SdfLayer {
  /** Draws the polygonal scene, then the SDF layer, then composites. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  /** Full-resolution size of the output, in device pixels. */
  setSize(width: number, height: number): void;
  /** 1 = full resolution, 0.5 = quarter the pixels. */
  setScale(scale: number): void;
  /** Whether the render target comes back inverted relative to the canvas. */
  setFlipY(on: boolean): void;
  /** The pre-pass output, to hand to every view that should start from it. */
  readonly cone: ConeSource;
  /** The inner-hull pre-pass the march clamps its tMax by. See OCCLUDER_LAYER. */
  readonly occluder: OccluderSource;
  setOccluderEnabled(on: boolean): void;
  readonly occluderEnabled: boolean;
  /** Turns the cone pre-pass on or off, for measurement. */
  setConeEnabled(on: boolean): void;
  /** Lens and layer height, from which both levels' cone widths are derived. */
  setConeGeometry(fovDeg: number, targetHeight: number): void;
  /** Second-level tile size in pixels, or 0 for a single level. */
  setConeFineTile(px: number): void;
  readonly coneFineTile: number;
  readonly coneEnabled: boolean;
  readonly scale: number;
  readonly flipY: boolean;
  /** Actual SDF target size, for the panel to display. */
  readonly targetSize: { width: number; height: number };
  dispose(): void;
}

/**
 * Default scale for the raymarched layer.
 *
 * 0.7 rather than 0.5, from the measured curve at 15 bodies: 0.85 was worth
 * -22%, 0.7 -47%, 0.5 -58%. So 0.7 collects most of the win, and it softens
 * the flesh far less — 672x378 against 480x270 on a 960x540 frame. 0.5 read as
 * too coarse by eye, which is the call that matters here; the slider spans
 * 0.25 to 1 for anyone who disagrees.
 */
export const DEFAULT_SDF_SCALE = 0.7;

export function createSdfLayer(renderer: THREE.WebGPURenderer): SdfLayer {
  let scale = DEFAULT_SDF_SCALE;
  let fullW = 1;
  let fullH = 1;

  // FloatType because the alpha channel carries DEPTH. At 8 bits per channel
  // the composite would resolve depth to 256 steps and the flesh would z-fight
  // the floor across the whole frame.
  const target = new THREE.RenderTarget(1, 1, {
    depthBuffer: true,          // bodies still have to occlude each OTHER
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  // Verified on screen: three's WebGPU backend hands a render target back
  // inverted relative to the canvas, so the composite reads it upside down
  // without this. It presented as a zombie standing on its head. Left as a
  // uniform rather than baked in, because "which way up does a render target
  // come back" is a backend property and not something to assume — flip it
  // from the console if a future three version changes its mind.
  const uFlipY = uniform(1);

  // Two chained pre-pass levels: wide then narrow. Each holds the distance
  // every ray in its tile can safely skip.
  const coneOpts = {
    depthBuffer: true,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  } as const;
  const coneCoarse = new THREE.RenderTarget(1, 1, coneOpts);
  const coneFine = new THREE.RenderTarget(1, 1, coneOpts);
  const coneUniforms = createConeUniforms();

  // The occluder target holds a DISTANCE per pixel, not a depth: the march
  // compares it against its own ray parameter t, and converting a depth back
  // into a distance in the shader would need the projection undone per pixel.
  //
  // Full SDF-layer resolution, because it is consumed per marched pixel. It is
  // cheap regardless — the hull is a few hundred low-poly spheres with no
  // shading.
  const occluder = new THREE.RenderTarget(1, 1, {
    depthBuffer: true,   // nearest hull surface must win where hulls overlap
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const occluderUniforms = { enabled: uniform(0) };
  const clearColorScratch = new THREE.Color();
  let coneFov = 75;
  let coneHeight = 540;
  /**
   * Tile size of the second level, or 0 to run a single level.
   *
   * Tunable because the trade is sharp and not obvious: a narrower cone hands
   * the full march a longer proven-empty distance, but pre-pass cost grows as
   * 1/tile^2, so halving the tile quadruples what the level costs. Measured at
   * 10 bodies: tile 2 made the frame ~30% SLOWER than no second level at all.
   */
  let coneFineTile: number = CONE_TILE_FINE;

  const sampled = composite({
    layerTex: texture(target.texture),
    texCoord: uv(),
    flipY: uFlipY,
  }) as unknown as { xyz: unknown; w: unknown };

  const quadMat = new MeshBasicNodeMaterial();
  quadMat.colorNode = vec4(sampled.xyz as never, 1.0);
  // Writing the SDF's own depth is what lets the hardware depth test resolve
  // the flesh against the floor and the reference cube.
  quadMat.depthNode = sampled.w as never;
  quadMat.depthWrite = true;
  quadMat.depthTest = true;

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  // Pulled back to z = 1 so the plane at z = 0 sits INSIDE the [0, 1] depth
  // range rather than exactly on the near plane, which is degenerate.
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  quadCam.position.z = 1;

  /** Cone footprint radius per unit distance for a tile of `px` pixels. */
  function coneKFor(px: number): number {
    return (px * Math.tan((coneFov * Math.PI) / 360)) / Math.max(1, coneHeight);
  }

  function resize() {
    const w = Math.max(1, Math.round(fullW * scale));
    const h = Math.max(1, Math.round(fullH * scale));
    target.setSize(w, h);
    occluder.setSize(w, h);
    coneCoarse.setSize(
      Math.max(1, Math.ceil(w / CONE_TILE)),
      Math.max(1, Math.ceil(h / CONE_TILE)),
    );
    const ft = coneFineTile > 0 ? coneFineTile : CONE_TILE;
    coneFine.setSize(
      Math.max(1, Math.ceil(w / ft)),
      Math.max(1, Math.ceil(h / ft)),
    );
  }

  return {
    render(scene, camera) {
      const restore = camera.layers.mask;

      // Pass 1 — the polygonal scene, at full resolution, straight to the
      // canvas. This leaves the depth the composite will test against.
      camera.layers.disable(SDF_LAYER);
      renderer.setRenderTarget(null);
      void renderer.render(scene, camera);

      // Pass 1b — the cone pre-pass, wide level then narrow, each starting
      // where the last stopped. No shading in either; the wide level is a
      // sixty-fourth of the pixels and the narrow one a quarter.
      //
      // The same meshes render twice. Only the uniforms change: `chain` is 0
      // for the wide level so it ignores the (unwritten) coarse texture, and 1
      // for the narrow one. No binding has to be swapped between passes.
      if (coneUniforms.enabled.value > 0.5) {
        camera.layers.set(CONE_LAYER);

        coneUniforms.k.value = coneKFor(CONE_TILE);
        coneUniforms.chain.value = 0;
        renderer.setRenderTarget(coneCoarse);
        void renderer.render(scene, camera);

        if (coneFineTile > 0) {
          coneUniforms.k.value = coneKFor(coneFineTile);
          coneUniforms.chain.value = 1;
          renderer.setRenderTarget(coneFine);
          void renderer.render(scene, camera);
        }
      }

      // Pass 1c — the occluder hulls. Depth-only in spirit: the fragment
      // shader writes one number, the distance from the camera. Cleared to
      // zero, which occFetch reads as "nothing here" rather than as a
      // zero-length ray.
      if (occluderUniforms.enabled.value > 0.5) {
        camera.layers.set(OCCLUDER_LAYER);
        renderer.setRenderTarget(occluder);
        // BLACK, explicitly, and restored afterwards. The renderer's clear
        // colour is the scene background (0x1a1116), so without this the
        // target clears to red 0.102 — and occFetch reads that as "a hull
        // surface 10 cm from the camera", which clamps tMax on almost every
        // ray and shreds the whole crowd. It renders as bodies dissolving into
        // disconnected blobs, which looks like a broken hull rather than a
        // clear colour.
        const prevClear = renderer.getClearColor(clearColorScratch).getHex();
        renderer.setClearColor(0x000000);
        void renderer.render(scene, camera);
        renderer.setClearColor(prevClear);
      }

      // Pass 2 — the raymarched bodies alone, into the scaled target, each ray
      // starting from the distance the pre-pass proved empty. The clear leaves
      // alpha at 1.0, which is the "nothing here" sentinel the composite
      // discards on.
      camera.layers.set(SDF_LAYER);
      renderer.setRenderTarget(target);
      void renderer.render(scene, camera);

      // Pass 3 — composite up. autoClear off, or this wipes pass 1.
      camera.layers.mask = restore;
      renderer.setRenderTarget(null);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(quadScene, quadCam);
      renderer.autoClear = prevAutoClear;
    },
    setSize(width, height) {
      fullW = width;
      fullH = height;
      resize();
    },
    setScale(next) {
      scale = Math.max(0.1, Math.min(1, next));
      resize();
    },
    setFlipY(on) { uFlipY.value = on ? 1 : 0; },
    // The full march reads the finest level that was actually rendered. With
    // the second level off, that is the coarse one — hence the swap here
    // rather than a branch in the shader.
    cone: {
      get texture() { return coneFineTile > 0 ? coneFine.texture : coneCoarse.texture; },
      coarseTexture: coneCoarse.texture,
      uniforms: coneUniforms,
    },
    setConeGeometry(fovDeg, targetHeight) {
      coneFov = fovDeg;
      coneHeight = targetHeight;
    },
    setConeFineTile(px) { coneFineTile = Math.max(0, Math.round(px)); resize(); },
    get coneFineTile() { return coneFineTile; },
    setConeEnabled(on) { coneUniforms.enabled.value = on ? 1 : 0; },
    occluder: { texture: occluder.texture, uniforms: occluderUniforms },
    setOccluderEnabled(on) { occluderUniforms.enabled.value = on ? 1 : 0; },
    get occluderEnabled() { return occluderUniforms.enabled.value > 0.5; },
    get coneEnabled() { return coneUniforms.enabled.value > 0.5; },
    get scale() { return scale; },
    get flipY() { return uFlipY.value > 0.5; },
    get targetSize() { return { width: target.width, height: target.height }; },
    dispose() {
      target.dispose();
      coneCoarse.dispose();
      coneFine.dispose();
      quad.geometry.dispose();
      quadMat.dispose();
    },
  };
}
