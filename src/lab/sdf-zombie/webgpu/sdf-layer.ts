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

// ---------------------------------------------------------------------------
// HALF-RATE (lever C2, temporal amortisation) — render the march every OTHER
// frame, reproject the held frame in between. DEFAULT OFF; the composite side
// is the only place it touches.
//
// The march (pass 2) leaves its result in `target`, and NOTHING between
// frames clears it — a render target only ever clears when it is rendered
// INTO. So a hold frame needs no copy pass: skip the pre-passes and the
// march, and composite the same texture again. The composite quad is the
// same single pass it always was (odd/even pass-count Y-flip trap avoided by
// construction — no pass is added, ever), with a holdMode uniform selecting
// between the classic sample, a raw hold, and a per-pixel reprojection.
//
// The reprojection uses the depth the march already wrote into the target's
// ALPHA: unproject the held pixel through the HELD camera's inverse
// view-projection, project the world point with the CURRENT camera, sample
// there. That is the stretch goal of the C2 brief, and it subsumes the
// full-screen homography (a homography is what you get when every depth is
// the same value). The depth written to depthNode is recomputed for the
// current camera, so occlusion against the full-rate polygonal pass tracks
// camera motion; the colour is one or two frames stale, which is the point —
// the smear IS the candidate look.
//
// NDC conventions (the Y-flip trap, derived once so it is written down): in
// the target's texture space, u = ndc.x * 0.5 + 0.5 and v = 0.5 - ndc.y * 0.5
// (v = 0 is the TOP of the framebuffer, ndc.y = +1). The st the composite
// works in after the flipY adjustment IS that texture space, which is why
// the unproject/project below converts through it and the flipY uniform
// needs no special-casing here.
// ---------------------------------------------------------------------------

/**
 * Pure half-rate frame decision: is THIS frame index a hold (composite a
 * held march) rather than a fresh march? Even frames are fresh so enabling
 * mid-session seeds the held frame immediately; `needsFresh` (first frame,
 * resize, enable) overrides to fresh regardless of parity, because the
 * target's backing memory is (re)allocated garbage in those cases.
 */
export function isHoldFrame(frameIndex: number, halfRate: boolean, needsFresh: boolean): boolean {
  return halfRate && !needsFresh && frameIndex % 2 === 1;
}

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
 * The layer the conservative OUTER hull lives on (shell-hull-outer.ts).
 *
 * Separate from OCCLUDER_LAYER because the two hulls are opposites and are
 * consumed in opposite directions: the occluder is INSIDE the flesh and cuts
 * tMax short, this one CONTAINS the flesh and says where a ray may start —
 * and, more valuably, whether it is worth marching at all.
 */
export const SHELL_LAYER = 4;

/**
 * The outer hull's EXIT twin (back faces + GreaterDepth) lives on its own
 * layer. Two meshes with fixed materials rather than one flipped between
 * passes: flipping side + needsUpdate per pass forced a WebGPU pipeline
 * rebuild mid-frame, and a pass whose pipeline is rebuilding renders stale —
 * the rendered hull stopped tracking the bodies (owner-caught, 2026-08-31).
 */
export const SHELL_EXIT_LAYER = 5;

/**
 * The SHADOW-CASTING twin of the occluder hull (occluder-hull.ts
 * `shadowObject`): the same instances at SHADOW_HULL_INFLATE, rendered into
 * the flashlight's shadow map only.
 *
 * Its own bit, and deliberately NOT OCCLUDER_LAYER: pass 1c rasterises
 * everything on OCCLUDER_LAYER into the occT distance target, and an inflated
 * hull in that target would put a surface OUTSIDE the body in front of every
 * ray — tMax clamping in empty space, bodies dissolving. Enabled only on the
 * shadow camera (dungeon-lighting.ts), never on a view camera.
 */
export const SHADOW_HULL_LAYER = 6;

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
  flipY: f32,
  holdMode: f32,
  heldInv: mat4x4<f32>,
  curVp: mat4x4<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(layerTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  // holdMode: 0 = fresh/classic, 1 = raw hold, 2 = per-pixel reprojection.
  // The classic path below is deliberately UNCHANGED when holdMode < 1.5 —
  // the toggle-OFF frame must stay bit-identical.
  var outDepth = -1.0;
  if (holdMode > 1.5) {
    // Reproject: this screen pixel's held depth -> world (held camera) ->
    // current camera -> a different texel of the SAME held texture.
    let probe = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
    let here = textureLoad(layerTex, probe, 0);
    if (here.w >= 1.0) { discard; }
    let ndcHeld = vec2<f32>(st.x * 2.0 - 1.0, 1.0 - st.y * 2.0);
    let world = heldInv * vec4<f32>(ndcHeld, here.w, 1.0);
    let clipCur = curVp * (world / world.w);
    if (clipCur.w <= 0.0) { discard; }
    let ndcCur = clipCur.xy / clipCur.w;
    st = vec2<f32>((ndcCur.x + 1.0) * 0.5, (1.0 - ndcCur.y) * 0.5);
    // The held point's depth under the CURRENT camera — occlusion tracks
    // camera motion instead of lagging a frame behind it.
    outDepth = clamp(clipCur.z / clipCur.w, 0.0, 0.9999);
  }
  let c = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let texel = textureLoad(layerTex, c, 0);
  // The target is cleared with alpha 1.0, which is the far plane and means
  // "the march discarded here". Without this the clear colour would paint over
  // the polygonal scene everywhere the bodies are not.
  if (texel.w >= 1.0) { discard; }
  if (outDepth >= 0.0) { return vec4<f32>(texel.xyz, outDepth); }
  return texel;
}`;

const composite = wgslFn(COMPOSITE_WGSL);

export interface SdfLayer {
  /** Draws the polygonal scene, then the SDF layer, then composites. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
  /** Builds a prospective SDF object's pipeline in this layer's real float
   * render-target context, before the object enters the live scene. */
  precompile(
    object: THREE.Object3D,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): Promise<void>;
  /**
   * Redirects the two passes that normally go to the canvas (the polygonal
   * scene and the final composite) into this target instead; null restores
   * the canvas. post-aa uses this to capture the frame for its FXAA/smear
   * chain. The target MUST carry a depth buffer — the composite depth-tests
   * against what the polygonal pass left behind.
   */
  setOutputTarget(t: THREE.RenderTarget | null): void;
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
  /** Outer-hull ENTRY distance (nearest front face) — 0 where no hull covers
   *  the pixel, which means no flesh can be there either. */
  readonly shellEntry: OccluderSource;
  /** Outer-hull EXIT distance (farthest back face). Needed to tell "no hull
   *  here" from "camera is INSIDE the hull", which the entry pass alone
   *  cannot: a camera inside a sphere sees no front face, and treating that
   *  as no-hull would discard flesh at point-blank range. */
  readonly shellExit: OccluderSource;
  setShellEnabled(on: boolean): void;
  readonly shellEnabled: boolean;
  setOccluderEnabled(on: boolean): void;
  readonly occluderEnabled: boolean;
  /** C2 half-rate: march every OTHER frame, composite the held march in
   *  between (mode 0 = raw hold, 1 = per-pixel depth reproject). Default
   *  OFF; off is the ship behaviour and must stay bit-identical to it. */
  setHalfRate(on: boolean): void;
  readonly halfRate: boolean;
  setHalfRateMode(n: number): void;
  readonly halfRateMode: number;
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
  /** The float target the march writes into. Exposed for MEASUREMENT
   *  readback only (the occupancy probe); do not render through it. */
  readonly marchTarget: THREE.RenderTarget;
  /** Outer-hull entry/exit targets, for MEASUREMENT readback only. */
  readonly shellEntryTarget: THREE.RenderTarget;
  readonly shellExitTarget: THREE.RenderTarget;
  /** One-pixel footprint radius per unit distance (tan(fovY/2) / passHeight),
   *  for the march's AA epsilon. Follows the adaptive resolution ladder. */
  readonly pixelConeK: number;
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

  // ---- half-rate state (C2) ------------------------------------------------
  let halfRate = false;
  let halfRateMode = 1;
  let frameIndex = 0;
  /** Fresh overrides parity: first frame, every (re)allocation, every enable. */
  let forceFreshFrame = true;
  /** view-projection of the camera the held march was rendered with. */
  const heldVp = new THREE.Matrix4();
  const heldVpInv = new THREE.Matrix4();
  const _view = new THREE.Matrix4();
  const _curVp = new THREE.Matrix4();
  // holdMode: 0 fresh/classic, 1 raw hold, 2 reprojected hold (see WGSL).
  const uHoldMode = uniform(0);
  const uHeldInv = uniform(new THREE.Matrix4());
  const uCurVp = uniform(new THREE.Matrix4());

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

  // Outer-hull entry/exit. Same float-distance encoding as the occluder, and
  // the same "cleared to zero means nothing here" contract.
  const shellOpts = {
    type: THREE.FloatType,
    format: THREE.RedFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    generateMipmaps: false,
  } as const;
  const shellEntry = new THREE.RenderTarget(1, 1, { ...shellOpts });
  const shellExit = new THREE.RenderTarget(1, 1, { ...shellOpts });
  const shellUniforms = { enabled: uniform(0) };
  const clearColorScratch = new THREE.Color();

  /**
   * Where the canvas-bound passes draw — null is the canvas. See
   * setOutputTarget; one member rather than a render() argument because the
   * redirect is a session-long wiring decision (post-aa toggles), not a
   * per-call choice.
   */
  let outputTarget: THREE.RenderTarget | null = null;

  /**
   * Pre-pass targets need an explicit first clear whenever they are
   * (re)allocated. The march materials bind the cone and occluder textures
   * UNCONDITIONALLY — the enable uniforms gate the fetch, not the binding —
   * so when a pre-pass is disabled its target is sampled without ever having
   * been rendered to. three then lazily initialises the texture inside the
   * SAME command encoder as the pass that samples it, and WebGPU rejects the
   * whole submit:
   *   "usage (TextureBinding|RenderAttachment) includes writable usage and
   *    another usage in the same synchronization scope"
   * — one dropped frame per lazy init, at boot and after every resize. An
   * explicit clear in its own pass, flagged on allocation, ends that.
   */
  let targetsNeedInit = true;
  const emptyScene = new THREE.Scene();
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
    holdMode: uHoldMode,
    heldInv: uHeldInv,
    curVp: uCurVp,
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

  /** Cone footprint radius per unit distance for a tile of `px` pixels.
   *  `coneKFor(1)` is the ONE-PIXEL footprint the march's AA epsilon wants —
   *  it tracks the adaptive-resolution ladder for free, because coneHeight is
   *  the SDF pass height, not the window's. */
  function coneKFor(px: number): number {
    return (px * Math.tan((coneFov * Math.PI) / 360)) / Math.max(1, coneHeight);
  }

  function resize() {
    const w = Math.max(1, Math.round(fullW * scale));
    const h = Math.max(1, Math.round(fullH * scale));
    // setSize reallocates the march target's backing memory — a hold frame
    // would composite garbage until the next fresh march.
    forceFreshFrame = true;
    target.setSize(w, h);
    occluder.setSize(w, h);
    shellEntry.setSize(w, h);
    shellExit.setSize(w, h);
    // setSize reallocates the backing textures, so they are uninitialised
    // again and the lazy-init conflict would return on the next frame.
    targetsNeedInit = true;
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
    async precompile(object, scene, camera) {
      const previousTarget = renderer.getRenderTarget();
      const previousMask = camera.layers.mask;
      try {
        camera.layers.set(SDF_LAYER);
        renderer.setRenderTarget(target);
        await renderer.compileAsync(object, camera, scene);
      } finally {
        renderer.setRenderTarget(previousTarget);
        camera.layers.mask = previousMask;
      }
    },
    render(scene, camera) {
      const restore = camera.layers.mask;

      // ---- half-rate decision (C2) ---------------------------------------
      // Snapshot the camera every frame (hold frames reproject through it);
      // a fresh frame additionally seeds the HELD view-projection the next
      // hold will unproject through.
      camera.updateMatrixWorld();
      _view.copy(camera.matrixWorld).invert();
      _curVp.multiplyMatrices(camera.projectionMatrix, _view);
      uCurVp.value.copy(_curVp);
      const hold = isHoldFrame(frameIndex, halfRate, forceFreshFrame);
      uHoldMode.value = hold ? (halfRateMode === 1 ? 2 : 1) : 0;
      if (!hold) {
        heldVp.copy(_curVp);
        heldVpInv.copy(heldVp).invert();
        uHeldInv.value.copy(heldVpInv);
      }

      if (targetsNeedInit) {
        targetsNeedInit = false;
        // The clear colour is irrelevant: a disabled pre-pass is never
        // FETCHED (the enable uniforms gate occFetch/coneFetch), and an
        // enabled one clears for real at the top of its own pass.
        for (const t of [coneCoarse, coneFine, occluder, shellEntry, shellExit]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, camera);
        }
      }

      // Pass 1 — the polygonal scene, at full resolution, to the output
      // (canvas, or post-aa's capture target). This leaves the depth the
      // composite will test against.
      camera.layers.disable(SDF_LAYER);
      renderer.setRenderTarget(outputTarget);
      void renderer.render(scene, camera);

      // Passes 1b/1c/1d + 2 — pre-passes and march. SKIPPED ENTIRELY on a
      // hold frame: they exist only to feed the march, and the march target
      // still holds the last fresh frame's result (nothing between frames
      // clears it). This skip IS the half-rate win.
      if (!hold) {
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

      // Pass 1d — the OUTER hull, twice: nearest front face (entry) and
      // farthest back face (exit).
      //
      // Cleared to BLACK for the same reason the occluder is, and it is the
      // same trap: the renderer's clear colour is the scene background, and a
      // non-zero clear would read as "a hull surface 10 cm away" on every
      // pixel — here that would start every ray inside the body.
      //
      // Front and back are separated by side + depth function rather than by
      // two meshes: one instanced hull, drawn twice.
      if (shellUniforms.enabled.value > 0.5) {
        const prevClear = renderer.getClearColor(clearColorScratch).getHex();
        const prevDepth = renderer.getClearDepth();
        renderer.setClearColor(0x000000);

        // ENTRY: the front-face twin (LessEqual), nearest wins.
        camera.layers.set(SHELL_LAYER);
        renderer.setClearDepth(1);
        renderer.setRenderTarget(shellEntry);
        void renderer.render(scene, camera);

        // EXIT: the back-face twin (GreaterDepth), farthest wins — clear
        // depth to near, the same inversion the 2026-08-25 shell spike used.
        // A separate MESH on a separate LAYER, not a material flip: pipelines
        // stay fixed, so nothing rebuilds mid-frame.
        camera.layers.set(SHELL_EXIT_LAYER);
        renderer.setClearDepth(0);
        renderer.setRenderTarget(shellExit);
        void renderer.render(scene, camera);

        renderer.setClearDepth(prevDepth);
        renderer.setClearColor(prevClear);
      }

      // Pass 2 — the raymarched bodies alone, into the scaled target, each ray
      // starting from the distance the pre-pass proved empty. The clear leaves
      // alpha at 1.0, which is the "nothing here" sentinel the composite
      // discards on.
      camera.layers.set(SDF_LAYER);
      renderer.setRenderTarget(target);
      void renderer.render(scene, camera);
      } // !hold

      // Pass 3 — composite up. autoClear off, or this wipes pass 1.
      camera.layers.mask = restore;
      renderer.setRenderTarget(outputTarget);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(quadScene, quadCam);
      renderer.autoClear = prevAutoClear;

      frameIndex++;
      if (!hold) forceFreshFrame = false;
    },
    setOutputTarget(t) { outputTarget = t; },
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
    shellEntry: { texture: shellEntry.texture, uniforms: shellUniforms },
    shellExit: { texture: shellExit.texture, uniforms: shellUniforms },
    setShellEnabled(on) { shellUniforms.enabled.value = on ? 1 : 0; },
    get shellEnabled() { return shellUniforms.enabled.value > 0.5; },
    setHalfRate(on) {
      if (on === halfRate) return;
      halfRate = on;
      // Seed immediately: the first frame after enabling is a fresh march,
      // never a hold of whatever the target happened to be holding.
      forceFreshFrame = true;
    },
    get halfRate() { return halfRate; },
    setHalfRateMode(n) { halfRateMode = n === 0 ? 0 : 1; },
    get halfRateMode() { return halfRateMode; },
    setOccluderEnabled(on) { occluderUniforms.enabled.value = on ? 1 : 0; },
    get occluderEnabled() { return occluderUniforms.enabled.value > 0.5; },
    get coneEnabled() { return coneUniforms.enabled.value > 0.5; },
    get scale() { return scale; },
    get flipY() { return uFlipY.value > 0.5; },
    get marchTarget() { return target; },
    get shellEntryTarget() { return shellEntry; },
    get shellExitTarget() { return shellExit; },
    get targetSize() { return { width: target.width, height: target.height }; },
    /** One-pixel footprint radius per unit distance, for the march's AA
     *  epsilon. Derived from the SDF pass height, so it follows the adaptive
     *  resolution ladder automatically. */
    get pixelConeK() { return coneKFor(1); },
    dispose() {
      target.dispose();
      coneCoarse.dispose();
      coneFine.dispose();
      quad.geometry.dispose();
      quadMat.dispose();
    },
  };
}
