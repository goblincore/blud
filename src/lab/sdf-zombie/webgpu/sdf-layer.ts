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
import { createConeUniforms, type ConeSource } from './zombie-gpu';

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
 * Tile size of the cone pre-pass, in full-resolution pixels.
 *
 * 8 is the figure the technique is usually quoted with. Bigger tiles make the
 * pre-pass cheaper but the cone wider, and a wider cone stops earlier — so the
 * start distance it proves is less useful. Cheap to change and worth sweeping.
 */
export const CONE_TILE = 8;

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
  /** Turns the cone pre-pass on or off, for measurement. */
  setConeEnabled(on: boolean): void;
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

  // Coarse pre-pass target. One texel per CONE_TILE of the SDF pass, holding
  // the distance every ray in that tile can safely skip.
  const coneTarget = new THREE.RenderTarget(1, 1, {
    depthBuffer: true,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const coneUniforms = createConeUniforms();

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

  function resize() {
    const w = Math.max(1, Math.round(fullW * scale));
    const h = Math.max(1, Math.round(fullH * scale));
    target.setSize(w, h);
    coneTarget.setSize(
      Math.max(1, Math.ceil(w / CONE_TILE)),
      Math.max(1, Math.ceil(h / CONE_TILE)),
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

      // Pass 1b — the coarse cone pre-pass, one texel per tile. Cheap: a
      // sixty-fourth of the pixels at CONE_TILE = 8, and no shading at all.
      if (coneUniforms.enabled.value > 0.5) {
        camera.layers.set(CONE_LAYER);
        renderer.setRenderTarget(coneTarget);
        void renderer.render(scene, camera);
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
    cone: { texture: coneTarget.texture, uniforms: coneUniforms },
    setConeEnabled(on) { coneUniforms.enabled.value = on ? 1 : 0; },
    get coneEnabled() { return coneUniforms.enabled.value > 0.5; },
    get scale() { return scale; },
    get flipY() { return uFlipY.value > 0.5; },
    get targetSize() { return { width: target.width, height: target.height }; },
    dispose() {
      target.dispose();
      coneTarget.dispose();
      quad.geometry.dispose();
      quadMat.dispose();
    },
  };
}
