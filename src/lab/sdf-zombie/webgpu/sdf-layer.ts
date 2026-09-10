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
import { fieldParity, fieldTargetHeight, fieldJitterNdcY } from './field-render';
import { createConeUniforms, createDepthPreUniforms, type ConeSource, type DepthPreSource, type LastFrameSource, type OccluderSource, type PrevSource } from './zombie-gpu';
import { TEMPORAL_START_DEFAULTS } from './temporal-start';
import { setPassLabel } from './gpu-pass-timing';

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
 * Nearest first by world-position distance. Pure; returns a new array. The
 * front-to-back per-body walk (perf round 2 task 5) draws in this order so
 * every pass's accumulated depth is the nearest surface so far at each pixel
 * — the gate a farther body's fragment tests itself against.
 */
export function sortFrontToBack(objects: THREE.Object3D[], camPos: THREE.Vector3): THREE.Object3D[] {
  const d = new Map<THREE.Object3D, number>();
  for (const o of objects) d.set(o, o.getWorldPosition(new THREE.Vector3()).distanceToSquared(camPos));
  return [...objects].sort((a, b) => d.get(a)! - d.get(b)!);
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
 * The layer the quarter-resolution depth-prepass twins live on (close-up
 * task 3). One mesh per body — the SAME proxy-box geometry as the march
 * mesh, a distance-writing material — rendered into `depthPre` at a quarter
 * of the SDF target's linear size, one coarse march per 4x4 block of SDF
 * pixels (~1/16 of the marching work, no vertices, no new geometry
 * pipeline). The full march then starts each ray from the coarse touch
 * distance, which is a PROVABLE lower bound on the first hit of every ray
 * in the block (the proof lives on DEPTH_PREPASS_MARCH — the cone radius
 * used by the coarse march is the block's own half-diagonal footprint).
 *
 * A separate layer, like every other pre-pass twin, so no render list is
 * ever mutated per frame: the pass is a camera layer mask away.
 */
export const DEPTH_PREPASS_LAYER = 7;

/**
 * Content that fields WITH the marched flesh in the 'bodies' style: the
 * skeleton meshes. Pulled out of the full-resolution polygonal pass and
 * rendered into a half-height buffer instead, so bone and flesh share one
 * cadence while the level and viewmodel stay crisp.
 *
 * These meshes do NOT need to encode depth into alpha the way the march does.
 * Their half-height pass only has to resolve mesh-against-mesh; the interleave
 * that draws them over the frame republishes their depth and depth-TESTS, so
 * the real buffer resolves them against the level and the flesh.
 */
export const FIELD_MESH_LAYER = 8;

/** The depth prepass's linear downsample factor per axis. 4 → one coarse
 *  texel per 4x4 block of SDF pixels → ~1/16 of the march work. */
export const DEPTH_PREPASS_DIV = 4;

/** The coarse block's half-diagonal in SDF pixels — the angular radius the
 *  coarse cone must cover so no full-res ray in the block can escape it.
 *  Block corners sit at (±2, ±2) SDF px from the texel centre ray. This is
 *  the ONE number the proof depends on; it must stay in step with
 *  DEPTH_PREPASS_DIV (block width / 2, times √2). */
export const DEPTH_PREPASS_BLOCK_PX = 2 * Math.SQRT2;

/** Pure coarse-target size for an SDF target of w×h. Ceil so the last
 *  partial block still gets a texel; a partial block is SMALLER than a full
 *  one, so its corners stay inside the proof's radius. */
export function depthPrepassSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(width / DEPTH_PREPASS_DIV)),
    height: Math.max(1, Math.ceil(height / DEPTH_PREPASS_DIV)),
  };
}

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
  prevFieldTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  holdMode: f32,
  heldInv: mat4x4<f32>,
  curVp: mat4x4<f32>,
  fieldMode: f32,
  fieldParityF: f32,
  fieldComb: f32,
  outHeight: f32
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(layerTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  // ---- INTERLACED FIELDS -------------------------------------------------
  // The layer rendered at HALF HEIGHT this frame, covering the scanlines of
  // one field; prevFieldTex holds the other from last frame. Interleave them
  // back to full height here. This branch is entered only when fieldMode is
  // on, so every other path below stays bit-identical (the all-off parity
  // gate depends on sameness, not equivalence).
  if (fieldMode > 0.5) {
    let col = clamp(i32(floor(st.x * dims.x)), 0, i32(dims.x) - 1);
    let outRow = i32(floor(st.y * outHeight));
    let tRow = clamp(outRow / 2, 0, i32(dims.y) - 1);
    var fieldTexel: vec4<f32>;
    if ((outRow % 2) == i32(fieldParityF)) {
      fieldTexel = textureLoad(layerTex, vec2<i32>(col, tRow), 0);
    } else {
      // The row this frame did not march. fieldComb 1 = hold last frame's
      // field verbatim, which IS the comb artifact and the point of the
      // feature; 0 = interpolate vertically from THIS frame's field instead,
      // trading vertical detail for no comb.
      let held = textureLoad(prevFieldTex, vec2<i32>(col, tRow), 0);
      // The two FRESH rows bracketing this held row. Half-target row r is
      // output row 2r+parity, so held row 2r+1 (parity 0) sits between r
      // and r+1, but held row 2r (parity 1) sits between r-1 and r.
      let base = tRow - i32(fieldParityF);
      let a = textureLoad(layerTex, vec2<i32>(col, clamp(base, 0, i32(dims.y) - 1)), 0);
      let b = textureLoad(layerTex, vec2<i32>(col, clamp(base + 1, 0, i32(dims.y) - 1)), 0);
      // DEPTH IS NEVER INTERPOLATED (same rule as sdfFieldInterleave): the
      // alpha channel IS the depth this quad republishes, and a mix of two
      // depths describes no surface. A held row carries the held depth and
      // the sentinel test runs on the held field, not on a blend that can
      // pass while both inputs disagree about whether anything is there.
      if (held.w >= 1.0) { discard; }
      fieldTexel = vec4<f32>(mix((a.xyz + b.xyz) * 0.5, held.xyz, fieldComb), held.w);
    }
    if (fieldTexel.w >= 1.0) { discard; }
    return fieldTexel;
  }

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

/**
 * WHOLE-FRAME INTERLEAVE. In field mode the ENTIRE layer — polygonal scene,
 * march, composite — renders into a half-height buffer, so the flesh and the
 * polygons on top of it (skeleton meshes, kit, prop, viewmodel) share one
 * sampling grid and one instant. This pass expands that to full height by
 * weaving it with the previous frame's half-height output.
 *
 * Fielding only the SDF layer left held rows showing one-frame-stale flesh
 * against current bone — the owner's "weird rendering artifact". Fielding
 * everything removes it by construction: there is no longer a full-rate layer
 * to disagree with.
 *
 * No discard: by this point the image is composited and opaque.
 */
export const FIELD_INTERLEAVE_WGSL = /* wgsl */ `fn sdfFieldInterleave(
  curTex: texture_2d<f32>,
  prevTex: texture_2d<f32>,
  curDepth: texture_depth_2d,
  prevDepth: texture_depth_2d,
  texCoord: vec2<f32>,
  flipY: f32,
  parity: f32,
  comb: f32,
  gateAlpha: f32,
  outHeight: f32
) -> vec4<f32> {
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let dims = vec2<f32>(textureDimensions(curTex, 0));
  let col = clamp(i32(floor(st.x * dims.x)), 0, i32(dims.x) - 1);
  let outRow = i32(floor(st.y * outHeight));
  let tRow = clamp(outRow / 2, 0, i32(dims.y) - 1);
  if ((outRow % 2) == i32(parity)) {
    let fresh = textureLoad(curTex, vec2<i32>(col, tRow), 0);
    // Coverage lives in the SOURCE alpha. The mesh field is cleared to alpha
    // 0 where no bone was drawn; without this the weave paints opaque black
    // over the scene wherever its depth happens to pass.
    if (gateAlpha > 0.5 && fresh.w < 0.5) { discard; }
    return vec4<f32>(fresh.xyz, textureLoad(curDepth, vec2<i32>(col, tRow), 0));
  }
  // A HELD ROW MUST CARRY ITS OWN FRAME'S DEPTH, not this one's.
  //
  // Taking depth from the current frame here looked harmless — a scanline of
  // error — but it desynced colour from depth: the flesh weave writes last
  // frame's depth on a held row (it rides the retained field's alpha), so a
  // mesh weave writing CURRENT depth let moving bone beat stale flesh and the
  // skeleton showed through the body. Only while moving, because standing
  // still the two depths agree (owner-caught).
  let dHeld = textureLoad(prevDepth, vec2<i32>(col, tRow), 0);
  if (gateAlpha > 0.5 && textureLoad(prevTex, vec2<i32>(col, tRow), 0).w < 0.5) { discard; }
  // The row this frame did not draw. comb 1 = hold last frame's field
  // verbatim, which IS the interlace artifact; 0 = interpolate vertically
  // from THIS frame's field, trading vertical detail for no comb.
  let held = textureLoad(prevTex, vec2<i32>(col, tRow), 0);
  // The two FRESH rows bracketing this held row (see fieldHeldNeighbours):
  // held row 2r+1 (parity 0) lies between r and r+1; held row 2r (parity 1)
  // between r-1 and r. Using r, r+1 for both bobbed the interpolated share
  // one row at field rate.
  let base = tRow - i32(parity);
  let a = textureLoad(curTex, vec2<i32>(col, clamp(base, 0, i32(dims.y) - 1)), 0);
  let b = textureLoad(curTex, vec2<i32>(col, clamp(base + 1, 0, i32(dims.y) - 1)), 0);
  let woven = mix((a + b) * 0.5, held, comb);
  // DEPTH IS NEVER INTERPOLATED. mix()ing two depths yields a value that
  // describes no actual surface, and at comb 0.6 those invented depths fought
  // the scene — see-through bodies and black scanlines (owner-caught). A held
  // row takes the HELD depth verbatim, which is what the flesh weave does
  // (it rides the retained field's alpha), so the two agree.
  return vec4<f32>(woven.xyz, dHeld);
}`;

const fieldInterleave = wgslFn(FIELD_INTERLEAVE_WGSL);

/** What gets interlaced — see `fieldStyle` in createSdfLayer. */
export type FieldStyle = 'off' | 'sdf' | 'bodies' | 'frame';

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
  /** The quarter-res depth prepass (close-up task 3): pass to every body
   *  view that should start from it. Its `enabled` uniform gates BOTH the
   *  coarse pass below and the march's fetch — one flag, both ends. */
  readonly depthPre: DepthPreSource;
  /** Turns the depth prepass and the march's consumption of it on or off,
 *  for measurement. Off is bit-identical to the pre-task-3 march. */
  setDepthPreEnabled(on: boolean): void;
  readonly depthPreEnabled: boolean;
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
  /**
   * Whether the NEXT render() will be a hold frame. Read it BEFORE calling
   * render(): `frameIndex` and `forceFreshFrame` are both read at the top of
   * render and only mutated at the very end, so the answer is stable for the
   * whole frame up to that call.
   *
   * WHY THIS EXISTS. Half-rate holds the MARCHED flesh, but anything that
   * rides the same rig and draws as a POLYGON — the skeleton meshes, the kit
   * overlay, the held prop — renders at full rate. Before the 2026-09-08 mesh
   * migration that did not matter, because bones lived inside the marched
   * field and held with it. Now they do not, and a hold frame draws
   * up-to-date bones inside one-frame-stale skin: the skeleton visibly walks
   * out of its own body. Callers use this to hold their pose in step.
   */
  /** Interlaced scanline fields. Mutually exclusive with half-rate. */
  setFieldStyle(style: FieldStyle): void;
  readonly fieldStyle: FieldStyle;
  /** Back-compat boolean: true selects 'frame'. */
  setFieldMode(on: boolean): void;
  readonly fieldMode: boolean;
  /** 1 = hold the stale field (full comb); 0 = interpolate it away. */
  setFieldComb(v: number): void;
  readonly fieldComb: number;
  readonly willHold: boolean;
  readonly halfRate: boolean;
  setHalfRateMode(n: number): void;
  readonly halfRateMode: number;
  /** Turns the cone pre-pass on or off, for measurement. */
  setConeEnabled(on: boolean): void;
  /** Lens and layer height, from which both levels' cone widths are derived
   *  — and the depth prepass's block footprint with them. */
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
  /** The occluder pre-pass target, for MEASUREMENT readback only. */
  readonly occluderTarget: THREE.RenderTarget;
  /** The quarter-res depth-prepass target, for MEASUREMENT readback only. */
  readonly depthPreTarget: THREE.RenderTarget;
  /** Outer-hull entry/exit targets, for MEASUREMENT readback only. */
  readonly shellEntryTarget: THREE.RenderTarget;
  readonly shellExitTarget: THREE.RenderTarget;
  /** Accumulated colour+depth so far this frame, for the front-to-back
   *  per-body passes (perf round 2 task 5). Bind into every march material
   *  that should be gated by nearer hits; `uniforms.enabled` is the gate —
   *  off is the single-pass ship behaviour and reads as "nothing recorded". */
  readonly prev: PrevSource;
  /** Temporal reprojection start source (plan 2026-09-10). */
  readonly lastFrame: LastFrameSource;
  /** On = each ray starts at last frame's reprojected hit minus the margin
   *  (m) and slope (fraction). Off is bit-identical (and skips the copy). */
  setTemporalStart(on: boolean, margin?: number, slope?: number): void;
  readonly temporalStart: { on: boolean; margin: number; slope: number; maxStart: number };
  /** Registers the bodies (one pass each, front to back) and the gib chunks
   *  (one shared final pass, gated by every body). Call every frame before
   *  render(); with the gate off these lists are simply not walked. */
  setBodies(bodies: THREE.Object3D[], chunks: THREE.Object3D[]): void;
  /** The accumulated-depth gate. OFF = one march pass, bit-identical to the
   *  pre-task-5 frame. ON = one pass per body, nearest first, each gated and
   *  bounded by the depth every nearer pass recorded. */
  setDepthGate(on: boolean): void;
  readonly depthGate: boolean;
  /**
   * ATTRIBUTION SEAM (pass timing, 2026-09-07). With the depth gate off the
   * bodies and the gib chunks march in ONE pass. 'split' draws the chunks in
   * a second pass into the same target (autoClear off, same depth test —
   * the hardware resolves the overlap exactly as one pass would) so the
   * pass timer can label them apart ('sdf:march' vs 'sdf:march-chunks').
   * 'skip' omits the chunk pass entirely: a WRONG frame on purpose, the
   * diagnostic ceiling for what chunk work costs. 'merged' is the ship path.
   */
  setChunkPass(mode: 'merged' | 'split' | 'skip'): void;
  readonly chunkPass: 'merged' | 'split' | 'skip';
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

  // ---- interlaced field state ---------------------------------------------
  //
  // Alternative to half-rate, not additive: half-rate holds the whole marched
  // frame and reprojects it, which desyncs from the full-rate skeleton meshes
  // under camera motion. Fields march half the SCANLINES every frame at the
  // CURRENT camera, so that error class does not exist.
  //
  // THE SAVING IS THE HALF-HEIGHT TARGET, NOT A DISCARD. GPUs shade in 2x2
  // quads, so discarding alternate rows in a full-res pass still executes
  // every quad. resize() halves EVERY screen-space target in the layer (march,
  // shell, cone, occluder, depth-pre) so the pre-passes stay aligned with the
  // march; only the composite interleaves back to full height.
  /**
   * WHAT gets interlaced.
   *
   *   'off'   — no fielding.
   *   'sdf'   — the MARCHED FLESH only. Half-height march target, woven in the
   *             composite. Cheapest and the original cut, but the skeleton
   *             meshes, kit, prop and viewmodel stay full-rate, so held rows
   *             show one-frame-stale flesh against current bone — the owner's
   *             "weird rendering artifact".
   *   'frame' — the WHOLE assembled picture. Polys, march and composite all
   *             land in a half-height buffer and one pass weaves the result.
   *             Nothing on screen is at a different cadence from anything
   *             else, so that artifact cannot occur; the cost is that the
   *             viewmodel combs too.
   *
   * A third option — flesh AND the skeleton meshes, leaving the level and
   * viewmodel full-rate — is deliberately NOT here. It needs those meshes to
   * render into the SDF layer's buffer, whose ALPHA IS the depth encoding the
   * composite reads (alpha >= 1 means discarded, and alpha feeds depthNode).
   * Ordinary mesh materials do not write that, so it is a second material
   * path, not a flag.
   */
  let fieldStyle: FieldStyle = 'off';
  let fieldMode = false;              // fieldStyle !== 'off'
  const uFieldMode = uniform(0);      // 'frame': the whole-picture interleave
  const uCompositeField = uniform(0); // 'sdf': the flesh-only weave
  const uFieldParity = uniform(0);
  const uFieldComb = uniform(1);
  const uOutHeight = uniform(1);
  // Shared with the composite: both convert texCoord->st the same way, so
  // the interleave cannot pick rows in a different orientation.
  const uFlipY = uniform(1);

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

  // Accumulated colour+depth so far in this frame's front-to-back walk. A
  // pass cannot read the target it writes, so each body reads a blit of
  // the previous state. Same format as `target`; its alpha is the clip depth
  // the composite already consumes (1.0 = "nothing recorded here").
  /** The WHOLE layer's half-height output in field mode — polys, march and
   *  composite all land here, so nothing on screen is at a different cadence
   *  from anything else. Needs its own depth: the composite depth-tests the
   *  flesh against the polygonal pass exactly as it does at full height. */
  // FloatType, NOT HalfFloat: fieldPrev retains EITHER this or the march
  // target depending on fieldStyle, and copyTextureToTexture demands identical
  // formats. `target` is RGBA32Float (the march needs float depth in alpha),
  // so everything the retain can touch must be too — a HalfFloat fieldPrev
  // made the 'sdf' retain fail every frame with a copy-compatibility error
  // while the picture still looked plausible.
  const fieldFull = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  // SAMPLEABLE depth, because the interleave has to REPUBLISH it.
  // `sdfLayer.render` has always left valid depth in the output target, and
  // the goo layer depth-tests its blood against exactly that. Routing the
  // frame through a half-height buffer broke that contract and blood drew
  // over everything, viewmodel included (owner-caught). A plain depthBuffer
  // is an attachment, not a texture; DepthTexture is what makes it readable.
  fieldFull.depthTexture = new THREE.DepthTexture(1, 1);
  /** Last frame's half-height output, woven with this frame's. */
  const fieldPrev = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  fieldPrev.depthTexture = new THREE.DepthTexture(1, 1);
  /** 'bodies' style: the skeleton meshes' own half-height field, and the
   *  previous frame's. Its depth resolves mesh-against-mesh only; the
   *  interleave below republishes depth and depth-tests for everything else. */
  const fieldMesh = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  fieldMesh.depthTexture = new THREE.DepthTexture(1, 1);
  const fieldMeshPrev = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  fieldMeshPrev.depthTexture = new THREE.DepthTexture(1, 1);
  const meshWoven = fieldInterleave({
    curTex: texture(fieldMesh.texture),
    prevTex: texture(fieldMeshPrev.texture),
    curDepth: texture(fieldMesh.depthTexture),
    prevDepth: texture(fieldMeshPrev.depthTexture),
    texCoord: uv(),
    flipY: uFlipY,
    parity: uFieldParity,
    comb: uFieldComb,
    gateAlpha: uniform(1),
    outHeight: uOutHeight,
  }) as unknown as { xyz: unknown; w: unknown };
  const meshQuadMat = new MeshBasicNodeMaterial();
  meshQuadMat.colorNode = vec4(meshWoven.xyz as never, 1.0);
  meshQuadMat.depthNode = meshWoven.w as never;
  // depthTest ON is the whole trick: this republishes each woven pixel's own
  // depth and lets the hardware resolve it against the level and the flesh
  // already in the output. Without it the skeleton would draw through walls.
  meshQuadMat.depthTest = true;
  meshQuadMat.depthWrite = true;
  // NOT transparent: coverage is resolved by discard, not by blending. A
  // transparent material that also writes depth is what let this paint over
  // the scene in black scanlines.
  meshQuadMat.transparent = false;
  const meshQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), meshQuadMat);
  meshQuad.frustumCulled = false;
  const meshScene = new THREE.Scene();
  meshScene.add(meshQuad);

  const fieldQuadMat = new MeshBasicNodeMaterial();
  const woven = fieldInterleave({
    curTex: texture(fieldFull.texture),
    prevTex: texture(fieldPrev.texture),
    curDepth: texture(fieldFull.depthTexture),
    prevDepth: texture(fieldPrev.depthTexture),
    texCoord: uv(),
    flipY: uFlipY,
    parity: uFieldParity,
    comb: uFieldComb,
    gateAlpha: uniform(0),
    outHeight: uOutHeight,
  }) as unknown as { xyz: unknown; w: unknown };
  fieldQuadMat.colorNode = vec4(woven.xyz as never, 1.0);
  // Republishes the depth the layer has always left behind, so the goo layer
  // occludes blood exactly as it did before fields existed.
  fieldQuadMat.depthNode = woven.w as never;
  fieldQuadMat.depthTest = false;
  fieldQuadMat.depthWrite = true;
  const fieldQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fieldQuadMat);
  fieldQuad.frustumCulled = false;
  const fieldScene = new THREE.Scene();
  fieldScene.add(fieldQuad);
  const prev = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const prevUniforms = { enabled: uniform(0) };
  // TEMPORAL START source (plan 2026-09-10): the frame's final layer, copied
  // once at the end of every MARCHED frame, with the inverse VP that made
  // it; hold frames keep the last fresh copy. cfg.x ships 0 (never fetched,
  // no blit) until setTemporalStart turns it on.
  const lastTex = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const lastUniforms = {
    invVp: uniform(new THREE.Matrix4()),
    cfg: uniform(new THREE.Vector4(0, TEMPORAL_START_DEFAULTS.margin, TEMPORAL_START_DEFAULTS.slope, TEMPORAL_START_DEFAULTS.maxStart)),
  };
  let bodies: THREE.Object3D[] = [];
  let chunks: THREE.Object3D[] = [];
  let chunkPass: 'merged' | 'split' | 'skip' = 'merged';
  // The blit is an identity copy target -> prev in texture space: both are
  // render targets with the same orientation, so no flipY enters (the canvas
  // composite needs one; a target-to-target copy does not).
  const blitMat = new MeshBasicNodeMaterial();
  blitMat.colorNode = texture(target.texture, uv());
  blitMat.outputNode = texture(target.texture, uv()); // carry alpha (depth) verbatim
  blitMat.depthTest = false;
  blitMat.depthWrite = false;
  const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
  blitQuad.frustumCulled = false;
  const blitScene = new THREE.Scene();
  blitScene.add(blitQuad);

  // Verified on screen: three's WebGPU backend hands a render target back
  // inverted relative to the canvas, so the composite reads it upside down
  // without this. It presented as a zombie standing on its head. Left as a
  // uniform rather than baked in, because "which way up does a render target
  // come back" is a backend property and not something to assume — flip it
  // from the console if a future three version changes its mind.

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

  // Quarter-res depth prepass (close-up task 3). Same float-distance
  // encoding as the shell targets — .x is the coarse ray parameter, zero
  // means "no coarse ray touched anything in this block". The hardware
  // depth test resolves OVERLAPPING bodies' proxy boxes to the nearest
  // touch: each twin writes frag_depth from its own marched distance, so a
  // farther body's touch can never overwrite a nearer one's.
  const depthPre = new THREE.RenderTarget(1, 1, { ...shellOpts });
  const depthPreUniforms = createDepthPreUniforms();
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
    prevFieldTex: texture(fieldPrev.texture),
    texCoord: uv(),
    flipY: uFlipY,
    holdMode: uHoldMode,
    heldInv: uHeldInv,
    curVp: uCurVp,
    // 'sdf' mode only: 'frame' mode leaves this 0 and interleaves later,
    // over the whole assembled picture instead of just the flesh.
    fieldMode: uCompositeField,
    fieldParityF: uFieldParity,
    fieldComb: uFieldComb,
    outHeight: uOutHeight,
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
    const hFull = Math.max(1, Math.round(fullH * scale));
    // In field mode EVERY screen-space target halves together, so the shell,
    // cone, occluder and depth pre-passes keep addressing the same pixels the
    // march does. Only the composite knows about full height.
    // 'sdf' halves the MARCH target (the composite weaves it). 'frame' leaves
    // the march at full height and halves the whole-frame buffer instead —
    // halving both would field twice and lose half the vertical detail.
    const h = (fieldStyle === 'sdf' || fieldStyle === 'bodies') ? fieldTargetHeight(hFull) : hFull;
    // The row count the weave interlaces on. 'sdf'/'bodies' weave the MARCH
    // target, whose grid is sdfScale'd; 'frame' weaves fieldFull, which is
    // output-sized. Using the scaled count for 'frame' at any scale but 1
    // reads only the top `scale` of the field and stretches it to fill.
    uOutHeight.value = fieldStyle === 'frame' ? Math.max(1, fullH) : hFull;
    // setSize reallocates the march target's backing memory — a hold frame
    // would composite garbage until the next fresh march.
    forceFreshFrame = true;
    target.setSize(w, h);
    prev.setSize(w, h);
    lastTex.setSize(w, h);
    // The whole-frame field buffers track the OUTPUT size, not sdfScale: the
    // polygonal pass has always rendered at full content resolution and must
    // keep doing so, halved only in the field axis.
    const fw = Math.max(1, fullW);
    const fh = fieldStyle === 'frame' ? fieldTargetHeight(fullH) : 1;
    fieldFull.setSize(fw, fh);
    // fieldPrev retains whichever buffer the style actually fields: the march
    // target in 'sdf', the whole-frame buffer in 'frame'. Sizing it to the
    // wrong one silently weaves mismatched texel grids.
    if (fieldStyle === 'sdf' || fieldStyle === 'bodies') fieldPrev.setSize(w, h);
    else fieldPrev.setSize(fw, fh);
    // The mesh field follows the MARCH target's grid so bone and flesh weave
    // on identical texel rows.
    const mh = fieldStyle === 'bodies' ? h : 1;
    fieldMesh.setSize(fieldStyle === 'bodies' ? w : 1, mh);
    fieldMeshPrev.setSize(fieldStyle === 'bodies' ? w : 1, mh);
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
    // A THREE RENDER TARGET resizes fine (unlike the DataTexture trap):
    // setSize reallocates the backing texture, and the shader reads its grid
    // from textureDimensions — never from a captured value. The block
    // footprint k follows separately via setConeGeometry, which the page
    // re-calls from sizeSdfLayer on EVERY resize/adaptive move.
    const dp = depthPrepassSize(w, h);
    depthPre.setSize(dp.width, dp.height);
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
      // FIELD JITTER. With an unchanged projection a half-height target would
      // sample the SAME scanlines both frames — half the resolution, none of
      // the interlace. setViewOffset shifts the view by (parity - 0.5) of a
      // FULL-RES row, so the two fields land exactly one full-res row apart
      // (fieldJitterNdcY documents the same +/- 1/H in NDC terms) and neither
      // is the biased one. Applied around the WHOLE layer render so every
      // pre-pass shares the march's sampling grid; cleared at the end.
      const parity = fieldMode ? fieldParity(frameIndex) : 0;
      if (fieldMode) uFieldParity.value = parity;
      // The jitter is in rows of the grid being FIELDED: the output grid for
      // 'frame' (fieldFull is output-sized), the sdfScale'd grid otherwise.
      const applyFieldJitter = () => {
        const jw = fieldStyle === 'frame' ? Math.max(1, fullW) : Math.max(1, Math.round(fullW * scale));
        const jh = fieldStyle === 'frame' ? Math.max(1, fullH) : Math.max(1, Math.round(fullH * scale));
        camera.setViewOffset(jw, jh, 0, parity - 0.5, jw, jh);
      };
      // 'frame' fields the polygonal pass too, so it is jittered with the
      // rest. 'sdf'/'bodies' draw the polys at FULL height, unfielded, and
      // the jitter is applied only from the half-height passes on: half-target
      // row r lands on output row 2r+parity by construction, so an unjittered
      // poly pass already lines up with the woven flesh — a jittered one is
      // half a row off and the whole level crawls at field rate.
      if (fieldStyle === 'frame') applyFieldJitter();
      const hold = isHoldFrame(frameIndex, halfRate, forceFreshFrame);
      uHoldMode.value = hold ? (halfRateMode === 1 ? 2 : 1) : 0;
      if (!hold) {
        heldVp.copy(_curVp);
        heldVpInv.copy(heldVp).invert();
        uHeldInv.value.copy(heldVpInv);
      }

      if (targetsNeedInit) {
        targetsNeedInit = false;
        setPassLabel('init');
        // The clear colour is irrelevant: a disabled pre-pass is never
        // FETCHED (the enable uniforms gate occFetch/coneFetch), and an
        // enabled one clears for real at the top of its own pass.
        // `prev` rides the list even though nothing samples it while the
        // gate is off: the march materials bind prev.texture UNCONDITIONALLY
        // (the enable uniform gates the fetch, not the binding), and an
        // uninitialised prev would hit the same lazy-init submit conflict
        // the comment above describes.
        // fieldPrev MUST be in this list. Uninitialised it reads as zeros,
        // and alpha 0 is not the "nothing here" sentinel — the composite
        // treats it as a valid surface at depth 0, i.e. nearer than
        // everything, and paints black over the whole polygonal scene on
        // every held scanline. Cleared here it reads alpha 1 and discards,
        // so the first field frame shows the polys through the held rows
        // until the retain blit fills it one frame later.
        // fieldMeshPrev too, and NOT only for the sentinel: RenderTarget.setSize
        // resizes the colour textures but leaves a DepthTexture's image at
        // its construction size, and the backend allocates a depth texture
        // from that image unless the target is RENDERED to (which sizes it
        // from the target). fieldMeshPrev is only ever a copy destination, so
        // without this clear its depth stayed 1x1 and the 'bodies' depth
        // retain failed validation every frame — held rows then wove bone at
        // garbage depth. fieldPrev only escaped because it was already here.
        for (const t of [coneCoarse, coneFine, occluder, shellEntry, shellExit, prev, lastTex, depthPre, fieldPrev, fieldMeshPrev]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, camera);
        }
        // fieldMeshPrev's coverage sentinel is alpha 0 ("no bone here"), the
        // opposite of every other target's. The render above cleared it with
        // the renderer's alpha (1), so on the first 'bodies' frame every held
        // row would pass the weave's gate and paint the clear colour wherever
        // the output depth was still far. Clear it again at alpha 0.
        renderer.setRenderTarget(fieldMeshPrev);
        const initAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);
        renderer.clear();
        renderer.setClearAlpha(initAlpha);
      }

      // Pass 1 — the polygonal scene, at full resolution, to the output
      // (canvas, or post-aa's capture target). This leaves the depth the
      // composite will test against.
      camera.layers.disable(SDF_LAYER);
      // 'bodies': the skeleton leaves the full-resolution pass and is drawn
      // into its own half-height field below, so bone and flesh share one
      // cadence. Every other style keeps it here at full rate.
      if (fieldStyle === 'bodies') camera.layers.disable(FIELD_MESH_LAYER);
      else camera.layers.enable(FIELD_MESH_LAYER);
      // The depth-prepass twins must not rasterise into the polygonal pass
      // either — the disable above covers only the SDF layer itself.
      camera.layers.disable(DEPTH_PREPASS_LAYER);
      // Pass timing labels (gpu-pass-timing.ts): the polygonal pass also
      // carries the level's shadow-map passes, which three renders inside
      // this one render() call.
      setPassLabel('sdf:polys');
      // In field mode the WHOLE layer lands in the half-height buffer, so the
      // polygons (skeleton meshes, kit, prop, viewmodel) share the flesh's
      // sampling grid and instant. Fielding only the SDF layer is what left
      // stale flesh against current bone on held rows.
      renderer.setRenderTarget(fieldStyle === 'frame' ? fieldFull : outputTarget);
      void renderer.render(scene, camera);
      if (fieldStyle === 'sdf' || fieldStyle === 'bodies') applyFieldJitter();

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
        setPassLabel('sdf:cone');
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
        setPassLabel('sdf:occluder');
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
        setPassLabel('sdf:shell-hull');
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

      // Pass 1e — the quarter-res depth prepass (close-up task 3). One coarse
      // march per 4x4 block of SDF pixels; the march's ray start consumes it.
      // Runs BEFORE the march in the same frame — never a frame stale.
      //
      // Cleared to BLACK for the same reason the occluder and shell targets
      // are: the scene background colour is non-zero, and a non-zero clear
      // would read as "a surface 10 cm from the camera" on every block —
      // here every ray would start at 10 cm minus a footprint, INSIDE the
      // body at close range. Zero is the "no start" sentinel.
      if (depthPreUniforms.cfg.value.x > 0.5) {
        setPassLabel('sdf:depth-pre');
        camera.layers.set(DEPTH_PREPASS_LAYER);
        renderer.setRenderTarget(depthPre);
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
      setPassLabel('sdf:march');
      if (prevUniforms.enabled.value > 0.5 && bodies.length > 0) {
        // Front-to-back per-body passes (perf round 2 task 5). Clear once,
        // then one pass per body nearest-first, each preceded by a blit of
        // the accumulated state into `prev` — the march's gate reads it and
        // discards fragments whose hull entry lies beyond the nearest hit
        // already recorded at that pixel. Chunks go last, all together,
        // gated by every body. The hardware depth test already resolved
        // these overlaps inside one pass; the gate only stops PAYING for
        // the fragments it would have thrown away, which is why parity is
        // expected to be exact.
        const ordered = sortFrontToBack(bodies, camera.position);
        const wasVisible = new Map<THREE.Object3D, boolean>();
        for (const o of [...bodies, ...chunks]) { wasVisible.set(o, o.visible); o.visible = false; }
        renderer.setRenderTarget(target);
        renderer.clear();
        const prevAuto = renderer.autoClear;
        renderer.autoClear = false;
        const passes: THREE.Object3D[][] = [...ordered.map(o => [o]), chunks];
        for (const group of passes) {
          if (group.length === 0) continue;
          setPassLabel('sdf:prev-blit');
          renderer.setRenderTarget(prev);
          void renderer.render(blitScene, quadCam);
          for (const o of group) o.visible = true;
          setPassLabel('sdf:march');
          renderer.setRenderTarget(target);
          void renderer.render(scene, camera);
          for (const o of group) o.visible = false;
        }
        renderer.autoClear = prevAuto;
        for (const [o, v] of wasVisible) o.visible = v;
      } else if (chunkPass !== 'merged' && chunks.length > 0) {
        // Bodies first (clears), then the chunks on top with autoClear off.
        const wasVisible = new Map<THREE.Object3D, boolean>();
        for (const o of chunks) { wasVisible.set(o, o.visible); o.visible = false; }
        renderer.setRenderTarget(target);
        void renderer.render(scene, camera);
        if (chunkPass === 'split') {
          for (const [o, v] of wasVisible) o.visible = v;
          for (const o of bodies) { if (!wasVisible.has(o)) { wasVisible.set(o, o.visible); o.visible = false; } }
          setPassLabel('sdf:march-chunks');
          const prevAuto = renderer.autoClear;
          renderer.autoClear = false;
          void renderer.render(scene, camera);
          renderer.autoClear = prevAuto;
        }
        for (const [o, v] of wasVisible) o.visible = v;
      } else {
        renderer.setRenderTarget(target);
        void renderer.render(scene, camera);
      }
      // TEMPORAL START copy (plan 2026-09-10): the marched layer, final for
      // this frame, and the inverse of the VP that rendered it — paired here
      // so the fetch can never unproject with the wrong camera. Marched
      // frames only (inside !hold); off when the fetch is off.
      if ((lastUniforms.cfg.value as THREE.Vector4).x > 0.5) {
        setPassLabel('sdf:last-blit');
        renderer.setRenderTarget(lastTex);
        void renderer.render(blitScene, quadCam);
        (lastUniforms.invVp.value as THREE.Matrix4).copy(_curVp).invert();
      }
      } // !hold

      // Pass 3 — composite up. autoClear off, or this wipes pass 1.
      setPassLabel('sdf:composite');
      camera.layers.mask = restore;
      renderer.setRenderTarget(fieldStyle === 'frame' ? fieldFull : outputTarget);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(quadScene, quadCam);
      renderer.autoClear = prevAutoClear;

      if (fieldStyle === 'bodies') {
        // The skeleton's own half-height field, at this frame's jitter, then
        // woven over the frame. Its depth buffer resolves bone against bone;
        // the interleave's depth TEST resolves it against level and flesh.
        setPassLabel('sdf:field-mesh');
        camera.layers.set(FIELD_MESH_LAYER);
        renderer.setRenderTarget(fieldMesh);
        // ALPHA 0, not the renderer's default 1: the weave's coverage test is
        // "did anything draw here", and a clear alpha of 1 would claim every
        // empty pixel is bone.
        const prevAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);
        renderer.clear();
        renderer.setClearAlpha(prevAlpha);
        // autoClear OFF for the draw, exactly as the march does after its own
        // clear(): with it on, render() clears AGAIN with the renderer's clear
        // alpha (1) and the alpha-0 clear above is undone before a single
        // bone is drawn. Every empty texel then passes the coverage gate and
        // the weave paints the clear colour over every held scanline of the
        // whole frame — the see-through, striped bodies.
        const prevMeshAuto = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(scene, camera);
        renderer.autoClear = prevMeshAuto;
        camera.layers.mask = restore;

        setPassLabel('sdf:field-mesh-weave');
        renderer.setRenderTarget(outputTarget);
        const prevAuto = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(meshScene, quadCam);
        renderer.autoClear = prevAuto;

        renderer.copyTextureToTexture(target.texture, fieldPrev.texture);
        // Depth is retained WITH colour: a held row is a snapshot of one
        // instant, not last frame's pixels at this frame's depth.
        renderer.copyTextureToTexture(fieldMesh.texture, fieldMeshPrev.texture);
        renderer.copyTextureToTexture(fieldMesh.depthTexture!, fieldMeshPrev.depthTexture!);
        camera.clearViewOffset();
      } else if (fieldStyle === 'sdf') {
        // Flesh-only: the composite already wove it. Retain the march target
        // so the next frame has the other field. Same true-copy rule as below.
        renderer.copyTextureToTexture(target.texture, fieldPrev.texture);
        camera.clearViewOffset();
      } else if (fieldStyle === 'frame') {
        // Weave this half-height frame with the last one, into the real
        // full-height output. post-aa downstream sees exactly what it always
        // has, which is why its byte-identical all-off path is untouched.
        setPassLabel('sdf:field-interleave');
        renderer.setRenderTarget(outputTarget);
        void renderer.render(fieldScene, quadCam);
        // Retain by TRUE TEXTURE COPY, never a quad blit. fieldFull is written
        // by the rasteriser; a quad sampling uv() writes with the opposite Y
        // origin, and blitting produced a vertically MIRRORED retained field —
        // an upside-down ghost of the body woven with the right-way-up one
        // (owner-caught). Do not "fix" a future flip by mirroring the row
        // index in the shader: that hard-codes one platform's convention,
        // which is how this bug class keeps coming back.
        renderer.copyTextureToTexture(fieldFull.texture, fieldPrev.texture);
        renderer.copyTextureToTexture(fieldFull.depthTexture!, fieldPrev.depthTexture!);
        camera.clearViewOffset();
      }

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
      // The depth prepass's block footprint tracks the same lens and the
      // same SDF pass height the AA epsilon does. Called from sizeSdfLayer on
      // every resize AND every adaptive-rung move, so k can never go stale
      // while the coarse grid (resize above) moves under it.
      depthPreUniforms.cfg.value.y = coneKFor(DEPTH_PREPASS_BLOCK_PX);
    },
    setConeFineTile(px) { coneFineTile = Math.max(0, Math.round(px)); resize(); },
    get coneFineTile() { return coneFineTile; },
    setConeEnabled(on) { coneUniforms.enabled.value = on ? 1 : 0; },
    occluder: { texture: occluder.texture, uniforms: occluderUniforms },
    depthPre: { texture: depthPre.texture, uniforms: depthPreUniforms },
    setDepthPreEnabled(on) { depthPreUniforms.cfg.value.x = on ? 1 : 0; },
    get depthPreEnabled() { return depthPreUniforms.cfg.value.x > 0.5; },
    shellEntry: { texture: shellEntry.texture, uniforms: shellUniforms },
    shellExit: { texture: shellExit.texture, uniforms: shellUniforms },
    setShellEnabled(on) { shellUniforms.enabled.value = on ? 1 : 0; },
    get shellEnabled() { return shellUniforms.enabled.value > 0.5; },
    prev: { texture: prev.texture, uniforms: prevUniforms },
    lastFrame: { texture: lastTex.texture, uniforms: lastUniforms },
    setTemporalStart(on, margin, slope) {
      const v = lastUniforms.cfg.value as THREE.Vector4;
      v.x = on ? 1 : 0;
      if (margin !== undefined) v.y = Math.max(0, margin);
      if (slope !== undefined) v.z = Math.max(0, slope);
    },
    get temporalStart() {
      const v = lastUniforms.cfg.value as THREE.Vector4;
      return { on: v.x > 0.5, margin: v.y, slope: v.z, maxStart: v.w };
    },
    setBodies(list, chunkList) { bodies = list; chunks = chunkList; },
    setDepthGate(on) { prevUniforms.enabled.value = on ? 1 : 0; },
    setChunkPass(mode) { chunkPass = mode; },
    get chunkPass() { return chunkPass; },
    get depthGate() { return prevUniforms.enabled.value > 0.5; },
    setHalfRate(on) {
      if (on === halfRate) return;
      // Same exclusion from the other side.
      if (on && fieldMode) { fieldStyle = 'off'; fieldMode = false; uFieldMode.value = 0; uCompositeField.value = 0; resize(); }
      halfRate = on;
      // Seed immediately: the first frame after enabling is a fresh march,
      // never a hold of whatever the target happened to be holding.
      forceFreshFrame = true;
    },
    setFieldStyle(style) {
      if (style === fieldStyle) return;
      fieldStyle = style;
      fieldMode = style !== 'off';
      uFieldMode.value = style === 'frame' ? 1 : 0;
      uCompositeField.value = (style === 'sdf' || style === 'bodies') ? 1 : 0;
      // Mutually exclusive with half-rate: both on would hold a held field.
      if (fieldMode && halfRate) { halfRate = false; uHoldMode.value = 0; }
      forceFreshFrame = true;
      resize();          // which target is halved changes with the style
    },
    get fieldStyle() { return fieldStyle; },
    /** Back-compat boolean: true selects the whole-frame style. */
    setFieldMode(on) { this.setFieldStyle(on ? 'frame' : 'off'); },
    get fieldMode() { return fieldMode; },
    setFieldComb(v) { uFieldComb.value = Math.max(0, Math.min(1, v)); },
    get fieldComb() { return uFieldComb.value; },
    get willHold() { return isHoldFrame(frameIndex, halfRate, forceFreshFrame); },
    get halfRate() { return halfRate; },
    setHalfRateMode(n) { halfRateMode = n === 0 ? 0 : 1; },
    get halfRateMode() { return halfRateMode; },
    setOccluderEnabled(on) { occluderUniforms.enabled.value = on ? 1 : 0; },
    get occluderEnabled() { return occluderUniforms.enabled.value > 0.5; },
    get coneEnabled() { return coneUniforms.enabled.value > 0.5; },
    get scale() { return scale; },
    get flipY() { return uFlipY.value > 0.5; },
    get marchTarget() { return target; },
    /** The occluder pre-pass target, for diagnostics that need occT per pixel
     *  (same access the shell targets already have). */
    get occluderTarget() { return occluder; },
    /** The quarter-res depth-prepass target, for MEASUREMENT readback only
     *  (the occupancy probe pattern — never render through it). */
    get depthPreTarget() { return depthPre; },
    get shellEntryTarget() { return shellEntry; },
    get shellExitTarget() { return shellExit; },
    get targetSize() { return { width: target.width, height: target.height }; },
    /** One-pixel footprint radius per unit distance, for the march's AA
     *  epsilon. Derived from the SDF pass height, so it follows the adaptive
     *  resolution ladder automatically. */
    get pixelConeK() { return coneKFor(1); },
    dispose() {
      target.dispose();
      prev.dispose();
      coneCoarse.dispose();
      coneFine.dispose();
      depthPre.dispose();
      occluder.dispose();
      shellEntry.dispose();
      shellExit.dispose();
      // The field buffers and their weave quads (RenderTarget.dispose also
      // releases the attached DepthTexture through the backend's listener).
      fieldFull.dispose();
      fieldPrev.dispose();
      fieldMesh.dispose();
      fieldMeshPrev.dispose();
      fieldQuad.geometry.dispose();
      fieldQuadMat.dispose();
      meshQuad.geometry.dispose();
      meshQuadMat.dispose();
      quad.geometry.dispose();
      quadMat.dispose();
      blitQuad.geometry.dispose();
      blitMat.dispose();
    },
  };
}
