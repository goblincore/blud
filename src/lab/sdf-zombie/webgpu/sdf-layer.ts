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
import { wgslFn, texture, uv, vec4, uniform, mrt, output, cameraViewMatrix, mat3, mul } from 'three/tsl';
import { fieldParity, fieldTargetHeight, fieldJitterNdcY } from './field-render';
import { createConeUniforms, createDepthPreUniforms, createRefineUniforms, marchNormalRead, marchAnchorRead, detailFieldFn, type ConeSource, type DepthPreSource, type LastFrameSource, type OccluderSource, type PrevSource, type RefineSource } from './zombie-gpu';
import { TEMPORAL_START_DEFAULTS, temporalMarginForMotion } from './temporal-start';
import { TEMPORAL_ACCUM_DEFAULT_ALPHA, TEMPORAL_ACCUM_CONVERGED_FRAMES, accumAlpha, accumJitter } from './temporal-accum';
import { setPassLabel } from './gpu-pass-timing';
import { createUpscaleStage, upscaleInfoOf, type UpscaleInfo, type UpscaleStage } from './upscale/upscale-stage';
import { inputsUseNormals, type UpscaleConfig, type UpscaleModel } from './upscale/upscale-model';

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
 * Rotate the per-slot HELD CAMERAS exactly as the history ring rotates its
 * textures: slot2 <- slot1, then slot1 <- slot0, then slot0 <- `current`.
 *
 * ORDER IS THE WHOLE FUNCTION. The reverse (slot1 before slot2) copies an
 * already-overwritten slot, and nothing about the result looks like an error —
 * every held row is simply reprojected through a neighbouring frame's camera,
 * which reads as a plausible smear. So it is pure, exported and unit-tested
 * rather than inlined at the rotation site.
 *
 * `slots` is [slot0, slot1, slot2] and is mutated in place; `current` is the
 * inverse view-projection of the frame that just marched.
 */
export function rotateHeldCameras(slots: THREE.Matrix4[], current: THREE.Matrix4): void {
  slots[2]!.copy(slots[1]!);
  slots[1]!.copy(slots[0]!);
  slots[0]!.copy(current);
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

/**
 * Run 5: the OUTPUT-resolution refine twins (`view.refineObject`). One mesh per
 * body, the same proxy-box geometry as the march, drawn once per frame into the
 * refine target at output resolution — its own layer, like every other twin, so
 * no render list is mutated per frame.
 */
export const REFINE_LAYER = 9;

/** Per-pass ceiling for precompilePasses (see the bounded race there). */
const PRECOMPILE_PASS_TIMEOUT_MS = 8000;

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
 *
 * ⚠ NO COMMENTS INSIDE THE PARAMETER LIST. three's wgslFn parser reads every
 * `word: word` between the parens as an input, comments included; a phantom
 * input gets float(0) bound, the call gains an argument and the composite never
 * compiles — no flesh on any page (2026-09-10). Pinned by sdf-layer.test.ts.
 * Inputs bind BY NAME from the object below, so a new one goes anywhere in the
 * list, but must be bound in the same commit (the meltCfg rule).
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
  outHeight: f32,
  fieldCount: f32,
  prevFieldTex1: texture_2d<f32>,
  prevFieldTex2: texture_2d<f32>,
  heldInv1: mat4x4<f32>,
  heldInv2: mat4x4<f32>,
  heldReproject: f32,
  accumTex: texture_2d<f32>,
  accumOn: f32
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
    // FIELD COUNT IS CLAMPED, NOT TRUSTED. These inputs bind POSITIONALLY, so a
    // missing or zero binding would otherwise be a DIVISION BY ZERO inside the
    // composite — broken rendering that no unit test here can catch without a
    // GPU. Clamped, a bad binding degrades to "no interlace" rather than to NaN,
    // and the frame hash reports a mismatch instead of an empty screen.
    let nf = clamp(i32(fieldCount + 0.5), 1, 8);
    // Integer division: outRow >= 0, so this is a true floor for every nf.
    let tRow0 = outRow / nf;
    let tRow = clamp(tRow0, 0, i32(dims.y) - 1);
    var fieldTexel: vec4<f32>;
    if ((outRow % nf) == i32(fieldParityF)) {
      fieldTexel = textureLoad(layerTex, vec2<i32>(col, tRow), 0);
    } else {
      // The row this frame did not march. fieldComb 1 = hold last frame's
      // field verbatim, which IS the comb artifact and the point of the
      // feature; 0 = interpolate vertically from THIS frame's field instead,
      // trading vertical detail for no comb.
      // THE HISTORY RING, consulted before interpolating anything.
      //
      // With ONLY the immediate previous field, every held row has to be
      // interpolated from the two bracketing marched rows — which is VERTICAL
      // BLUR rather than interlacing, and at h/3 that is two rows in three (h/4:
      // three in four). The ring retains "nf - 1" fields so a held row's OWN
      // sample is usually still there to read. Owner-visible reason this exists:
      // h/3 and h/4 read as "significantly more distracting in terms of the low
      // resolution", which is the reconstruction, not the field count.
      //
      // AT nf = 2 THIS MUST BE EXACTLY THE OLD PATH, and it is: the shader above
      // has already established outRow % nf != fieldParityF, and with nf = 2 that
      // forces (outRow % nf) == 1 - fieldParityF, so slot == 0 and the first
      // branch fires. The ring is therefore unreachable for the shipped two-field
      // case and h/2 is bit-identical by construction.
      let slot = (i32(fieldParityF) - (outRow % nf) + nf) % nf - 1;
      var held: vec4<f32>;
      // THE HELD SAMPLE'S OWN CAMERA. Slot 0 is the field marched one frame ago,
      // slot 1 two, slot 2 three — three DIFFERENT cameras — so the reprojection
      // below needs the inverse view-projection of the frame that wrote THIS
      // slot, rotated in lockstep with the textures (sdf-layer.ts, RING ROTATION).
      // heldInv (no suffix) is the half-rate C2 path's single held camera and is
      // NOT used here: fields and half-rate are mutually exclusive.
      var heldInvSlot = heldInv1;
      if (slot <= 0) {
        held = textureLoad(prevFieldTex, vec2<i32>(col, tRow), 0);
        heldInvSlot = heldInv;
      } else if (slot == 1) {
        held = textureLoad(prevFieldTex1, vec2<i32>(col, tRow), 0);
        heldInvSlot = heldInv1;
      } else {
        held = textureLoad(prevFieldTex2, vec2<i32>(col, tRow), 0);
        heldInvSlot = heldInv2;
      }
      // The two FRESH rows bracketing this held row — fieldHeldNeighboursInteger
      // from field-render.ts, which PROVES this integer form equals the intended
      // float one on every held row at fields 2, 3 and 4. THE INTEGER FORM IS
      // THE CONTRACT: WGSL's / and % truncate toward zero, so the float
      // derivation ceil((y - field)/fields) is wrong wherever y < field — a
      // silently shifted scanline rather than a visible error.
      //
      // At nf = 2 this reduces EXACTLY to the shipped "tRow - i32(fieldParityF)":
      // "own <= outRow" is then always true, so base = tRow, and the clamps below
      // reproduce the original edges including the -1 case at tRow = 0.
      let own = tRow0 * nf + i32(fieldParityF);
      let base = select(tRow0 - 1, tRow0, own <= outRow);
      let a = textureLoad(layerTex, vec2<i32>(col, clamp(base, 0, i32(dims.y) - 1)), 0);
      let b = textureLoad(layerTex, vec2<i32>(col, clamp(base + 1, 0, i32(dims.y) - 1)), 0);
      // DEPTH IS NEVER INTERPOLATED (same rule as sdfFieldInterleave): the
      // alpha channel IS the depth this quad republishes, and a mix of two
      // depths describes no surface. A held row carries the held depth and
      // the sentinel test runs on the held field, not on a blend that can
      // pass while both inputs disagree about whether anything is there.
      if (held.w >= 1.0) { discard; }
      var heldCol = held.xyz;
      var heldDepth = held.w;
      // HELD-ROW REPROJECTION (2026-09-10). A held row is a snapshot of an
      // OLDER CAMERA: at nf = 3 two rows in three carry a sample taken 1-3
      // frames ago at the camera of that frame, composited at THIS frame's
      // screen position. The pre-test measured what that costs — with the
      // subject frozen, h/3 differs from h/2 by 0.80 mean 8-bit levels at a
      // still camera and 12.06 the moment the camera strafes, 15x — i.e. the
      // staleness is the artifact, not the reconstruction.
      //
      // The maths is the C2 path's, reused verbatim (it is MEASURED there: a
      // raw hold's flesh best-aligns at dx = +21 px on a 6 m/s sweep, the
      // reprojection at dx = 0). Unproject the held sample through the CAMERA
      // THAT WROTE ITS SLOT, project with the current camera, and resample.
      //
      // ⚠ HORIZONTAL ONLY, DELIBERATELY. A held row's content must stay in the
      // row it belongs to — the field's whole structure is "this output row's
      // sample lives at this texture row" — so the reprojected coordinate's ROW
      // is discarded (tRow is kept) and only the COLUMN moves. That is exact for
      // a lateral translate, which is the motion the owner reported and the case
      // the pre-test measured; a pitch or forward component also displaces the
      // content VERTICALLY, and that part stays stale. Do not "fix" it by
      // resampling the reprojected row: it would tear one row's sample across
      // several and defeat the weave.
      if (heldReproject > 0.5) {
        let ndcHeld = vec2<f32>(st.x * 2.0 - 1.0, 1.0 - st.y * 2.0);
        let world = heldInvSlot * vec4<f32>(ndcHeld, held.w, 1.0);
        let clipCur = curVp * (world / world.w);
        if (clipCur.w > 0.0) {
          let ndcCur = clipCur.xy / clipCur.w;
          let stRep = vec2<f32>((ndcCur.x + 1.0) * 0.5, (1.0 - ndcCur.y) * 0.5);
          let cRep = clamp(i32(floor(stRep.x * dims.x)), 0, i32(dims.x) - 1);
          var rep: vec4<f32>;
          if (slot <= 0) {
            rep = textureLoad(prevFieldTex, vec2<i32>(cRep, tRow), 0);
          } else if (slot == 1) {
            rep = textureLoad(prevFieldTex1, vec2<i32>(cRep, tRow), 0);
          } else {
            rep = textureLoad(prevFieldTex2, vec2<i32>(cRep, tRow), 0);
          }
          // Only take it if the reprojected texel is a SURFACE in that older
          // field: landing on the far sentinel means the reprojection points at
          // background that field has no data for (the disocclusion case C2
          // documented as pale edge streaking), and the un-reprojected sample is
          // the lesser artifact there.
          if (rep.w < 1.0) { heldCol = rep.xyz; }
          // The depth DOES follow the reprojection: the held row's depth has to
          // describe the current camera or it tests against the polygonal pass a
          // frame behind (the desync that retired C2).
          heldDepth = clamp(clipCur.z / clipCur.w, 0.0, 0.9999);
        }
      }
      fieldTexel = vec4<f32>(mix((a.xyz + b.xyz) * 0.5, heldCol, fieldComb), heldDepth);
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
  // TEMPORAL ACCUMULATION (2026-09-10): when on, the flesh being composited is
  // the reconstructed OUTPUT-RESOLUTION history rather than this frame's raw
  // low-res march. The polygonal passes below are untouched — the level and the
  // viewmodel stay crisp, which is the whole reason this happens before the
  // composite instead of after it. accumOn 0 is bit-identical to the shipped
  // path (one extra texture binding, never fetched).
  var srcTexel = textureLoad(layerTex, c, 0);
  if (accumOn > 0.5) {
    let adims = vec2<f32>(textureDimensions(accumTex, 0));
    let ac = clamp(vec2<i32>(floor(st * adims)), vec2<i32>(0, 0), vec2<i32>(adims) - vec2<i32>(1, 1));
    srcTexel = textureLoad(accumTex, ac, 0);
  }
  let texel = srcTexel;
  // The target is cleared with alpha 1.0, which is the far plane and means
  // "the march discarded here". Without this the clear colour would paint over
  // the polygonal scene everywhere the bodies are not.
  if (texel.w >= 1.0) { discard; }
  if (outDepth >= 0.0) { return vec4<f32>(texel.xyz, outDepth); }
  return texel;
}`;

/**
 * TEMPORAL ACCUMULATION resolve (plan docs/superpowers/plans/2026-09-10-temporal-accumulation.md).
 *
 * WHY, in one paragraph. The march can run at `sdfScale` 0.5 for ~8 ms of a
 * 16.6 ms frame, but a half-scale march upsampled by a nearest tap is, in the
 * owner's words, "too pixelated and aliased". This pass reconstructs it: the
 * marching camera is JITTERED by a sub-pixel offset each frame, so every output
 * pixel reads a DIFFERENT low-res texel over time, and accumulating those at
 * OUTPUT resolution turns a quarter of the samples per frame into a supersampled
 * image. Accumulating into the LOW-RES grid instead would average the
 * sub-positions into the same texels — a box blur with no new detail — so the
 * history here is output-sized and the jitter is the feature, not a detail.
 *
 * FLESH ONLY, and before the composite. The polygonal level and the viewmodel
 * must stay crisp (that is what field style 'bodies' exists for), so nothing
 * here ever sees the composited image.
 *
 * v1 IS CAMERA-ONLY, ON PURPOSE. No object motion vectors, no validity test, no
 * neighbourhood clamping: the owner has pre-accepted ghosting ("some ghosting is
 * not a big deal since it adds to the degraded CRT look"), and each of those is a
 * measurable follow-up rather than a prerequisite. What it does NOT accept is
 * shimmer, which is what the still-camera convergence gate measures.
 *
 * ONE GUARD WORTH KEEPING: the history is only blended where the CURRENT frame
 * also has flesh (alpha < 1). Without it a body that moved would leave its
 * accumulated silhouette painted over the background — the one ghost that reads
 * as a bug rather than as CRT wear.
 *
 * No comments inside the PARAMETER LIST: three's wgslFn parser reads every
 * word-colon-word pair between the parens as an input, comments included, and a
 * phantom input silently breaks the pipeline (2026-09-10, pinned by
 * sdf-layer.test.ts). (And no backticks anywhere in here — one breaks the
 * enclosing TypeScript template literal. Both traps were hit writing this.)
 */
export const TEMPORAL_ACCUM_WGSL = /* wgsl */ `fn temporalAccum(
  curTex: texture_2d<f32>,
  histTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  curInvVp: mat4x4<f32>,
  prevVp: mat4x4<f32>,
  alpha: f32
) -> vec4<f32> {
  let curDims = vec2<f32>(textureDimensions(curTex, 0));
  let outDims = vec2<f32>(textureDimensions(histTex, 0));
  // THE SAME CONVENTION AS THE COMPOSITE, and this is not optional. A quad
  // sampling uv() writes with the OPPOSITE Y origin to the texture's texel rows
  // (uv.y = 1 is the TOP fragment, texel row 0 is the top row, and
  // textureLoad(uv * dims) therefore reads the BOTTOM row from the top fragment).
  // The repo already paid for this once: the field ring's retention had to become
  // a TRUE TEXTURE COPY because a quad blit produced a vertically MIRRORED
  // retained field. A blend cannot be a copy, so it takes the shared flipY
  // uniform instead of hard-coding a mirrored index — which is the other thing the
  // ring's note forbids, because it bakes in one platform's convention.
  //
  // SYMPTOM THIS FIXES (owner, 2026-09-10): "when i turn accumulation on in the
  // console it causes the sdf bodies to mirror across the x axis so it looks like
  // the sdf bodies are walking on the ceiling and the mesh parts are walking
  // upright" — the flesh goes through this pass and the mesh does not, so ONLY the
  // flesh flipped. My gate could not see it because the staged body was vertically
  // CENTRED, where a mirror is invisible to a difference metric.
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }

  // THIS FRAME'S SAMPLE — BILINEAR, and that is the whole ballgame.
  //
  // A NEAREST fetch was the first version and it CANNOT work, measured: a
  // sub-pixel jitter on a nearest reconstruction does not move the sample by a
  // sub-pixel, it flips WHICH low-res texel the output pixel reads — a two-pixel
  // jump at sdfScale 0.5. Accumulating those gives a two-pixel edge smear, not
  // finer detail: gate 1 read 5-7 mean 8-bit levels from the full-scale render
  // while the raw low-res march was 0.9, with sharpness UNCHANGED (so it was not
  // a blur — it was quantised displacement).
  //
  // Bilinear places each sample at its true sub-pixel position with the right
  // weight, which is what lets differently-jittered frames carry DIFFERENT
  // information into the same output pixel. The target is NearestFilter, so the
  // four taps are gathered by hand: filtering depth would be wrong anyway (a
  // blended depth describes no surface), so only the COLOUR is interpolated and
  // the coverage/depth comes from the nearest tap.
  let f = st * curDims - vec2<f32>(0.5, 0.5);
  let i0 = vec2<i32>(floor(f));
  let fr = f - vec2<f32>(i0);
  let maxI = vec2<i32>(curDims) - vec2<i32>(1, 1);
  let a00 = textureLoad(curTex, clamp(i0, vec2<i32>(0, 0), maxI), 0);
  let a10 = textureLoad(curTex, clamp(i0 + vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0);
  let a01 = textureLoad(curTex, clamp(i0 + vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0);
  let a11 = textureLoad(curTex, clamp(i0 + vec2<i32>(1, 1), vec2<i32>(0, 0), maxI), 0);
  // Coverage first: a tap that has no surface contributes no colour, and the
  // weights are renormalised over the taps that do. Without this a body's edge
  // would drag the far sentinel's colour (a cleared texel) into the flesh.
  let w00 = (1.0 - fr.x) * (1.0 - fr.y) * select(0.0, 1.0, a00.w < 1.0);
  let w10 = fr.x * (1.0 - fr.y) * select(0.0, 1.0, a10.w < 1.0);
  let w01 = (1.0 - fr.x) * fr.y * select(0.0, 1.0, a01.w < 1.0);
  let w11 = fr.x * fr.y * select(0.0, 1.0, a11.w < 1.0);
  let wSum = w00 + w10 + w01 + w11;
  let nearIdx = clamp(vec2<i32>(floor(st * curDims)), vec2<i32>(0, 0), maxI);
  var cur = textureLoad(curTex, nearIdx, 0);
  if (wSum > 1e-5) {
    let rgb = (a00.xyz * w00 + a10.xyz * w10 + a01.xyz * w01 + a11.xyz * w11) / wSum;
    // DEPTH/COVERAGE FROM A SINGLE TAP, never a blend (the repo pins this rule for
    // the weave): the reprojection below unprojects it, and a mixed depth
    // describes a surface that exists nowhere.
    cur = vec4<f32>(rgb, cur.w);
  }

  // Nothing marched here: carry the sentinel through so the composite discards
  // and the polygonal scene shows. Deliberately NOT "keep the history" — see the
  // silhouette-ghost note above.
  if (cur.w >= 1.0) { return cur; }

  // BACKWARD REPROJECTION: where was the surface NOW at this pixel, last frame?
  // Unproject this pixel's OWN current depth with the current camera, project it
  // with the previous frame's camera, read the history there. (The half-rate C2
  // path reprojected forward instead, unprojecting with the HELD camera and
  // projecting with the current one; that works when the source and destination
  // are the same buffer, which a ping-pong history is not.)
  let ndc = vec2<f32>(st.x * 2.0 - 1.0, 1.0 - st.y * 2.0);
  let world = curInvVp * vec4<f32>(ndc, cur.w, 1.0);
  let clipPrev = prevVp * (world / world.w);
  if (clipPrev.w <= 0.0) { return cur; }
  let ndcPrev = clipPrev.xy / clipPrev.w;
  let stPrev = vec2<f32>((ndcPrev.x + 1.0) * 0.5, (1.0 - ndcPrev.y) * 0.5);
  if (stPrev.x < 0.0 || stPrev.x > 1.0 || stPrev.y < 0.0 || stPrev.y > 1.0) { return cur; }
  let histIdx = clamp(vec2<i32>(floor(stPrev * outDims)), vec2<i32>(0, 0), vec2<i32>(outDims) - vec2<i32>(1, 1));
  let hist = textureLoad(histTex, histIdx, 0);
  if (hist.w >= 1.0) { return cur; }

  // DEPTH IS NOT BLENDED (the rule the weave already pins): the alpha this pass
  // republishes is the CURRENT frame's depth, because a mix of two depths
  // describes a surface that exists nowhere and the composite depth-tests the
  // flesh against the polygonal pass with it.
  return vec4<f32>(mix(hist.xyz, cur.xyz, alpha), cur.w);
}`;

const composite = wgslFn(COMPOSITE_WGSL);
const temporalAccum = wgslFn(TEMPORAL_ACCUM_WGSL);

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
  outHeight: f32,
  fieldCount: f32,
  prevTex1: texture_2d<f32>,
  prevTex2: texture_2d<f32>
) -> vec4<f32> {
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let dims = vec2<f32>(textureDimensions(curTex, 0));
  let col = clamp(i32(floor(st.x * dims.x)), 0, i32(dims.x) - 1);
  let outRow = i32(floor(st.y * outHeight));
  // GENERALISED with the composite (deeper interlace fields, 2026-09-10), and it
  // has to be: this weave puts BONE on the flesh's grid, so if the two weaves
  // disagree about how many fields there are, the skeleton lands on rows the
  // flesh did not draw — it renders outside the body. Clamped for the same
  // reason as the composite: a missing binding must degrade, not divide by zero.
  let nf = clamp(i32(fieldCount + 0.5), 1, 8);
  let tRow0 = outRow / nf;
  let tRow = clamp(tRow0, 0, i32(dims.y) - 1);
  if ((outRow % nf) == i32(parity)) {
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
  // NOTE: depth follows slot 0 unconditionally. The retained ring stores COLOUR
  // only; adding depth to it is a further step, and until then a deep field's
  // held rows take their depth from the most recent field (the pre-ring
  // behaviour). Colour and depth desyncing is the bug this file already records
  // being owner-caught, so this is called out rather than left implicit.
  if (gateAlpha > 0.5 && textureLoad(prevTex, vec2<i32>(col, tRow), 0).w < 0.5) { discard; }
  // The row this frame did not draw. comb 1 = hold last frame's field
  // verbatim, which IS the interlace artifact; 0 = interpolate vertically
  // from THIS frame's field, trading vertical detail for no comb.
  // THE SAME RING LOOKUP AS THE COMPOSITE, and it must be the same: this weave
  // puts BONE on the flesh's grid, so if one of them reconstructs a held row from
  // a different field than the other, the skeleton lands on rows the flesh did not
  // draw. That is not hypothetical — it is precisely the "skeleton outside the
  // armour" defect, and the test that compares these two shaders line for line
  // failed when only the composite learned about the ring.
  let slot = (i32(parity) - (outRow % nf) + nf) % nf - 1;
  var held: vec4<f32>;
  if (slot <= 0) {
    held = textureLoad(prevTex, vec2<i32>(col, tRow), 0);
  } else if (slot == 1) {
    held = textureLoad(prevTex1, vec2<i32>(col, tRow), 0);
  } else {
    held = textureLoad(prevTex2, vec2<i32>(col, tRow), 0);
  }
  // The two FRESH rows bracketing this held row — fieldHeldNeighboursInteger,
  // the same integer derivation the composite uses. At nf = 2 it reduces exactly
  // to the shipped "tRow - i32(parity)", including the -1 edge, which is why the
  // two-field look is unchanged. The original note still applies: using r, r+1
  // for both parities bobbed the interpolated share one row at field rate.
  let own = tRow0 * nf + i32(parity);
  let base = select(tRow0 - 1, tRow0, own <= outRow);
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
   * Compiles EVERY pipeline this layer draws with, in the render-target context
   * it really draws them in, and returns how many compiles ran.
   *
   * The page's boot `renderer.compileAsync(scene, camera)` cannot reach any of
   * them: three's compileAsync walks `_projectObject`, which skips an object
   * whose `layers.test(camera.layers)` is false exactly like `render` does, so
   * the twins on CONE/OCCLUDER/SHELL/SHELL_EXIT/DEPTH_PREPASS/REFINE are never
   * visited; and the layer's fullscreen passes (blit, accumulation, detail,
   * refine-view, the composite quad) live in private scenes that are not in
   * the page's scene graph at all. Before this existed every one of those
   * pipelines was built synchronously on the first frame that needed it —
   * the multi-second freezes the owner felt seconds AFTER the loader cleared.
   *
   * The render context is part of a pipeline's cache key (attachment formats,
   * MRT), so each compile sets the same target and MRT the real pass sets.
   */
  precompilePasses(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<number>;
  /**
   * Redirects the two passes that normally go to the canvas (the polygonal
   * scene and the final composite) into this target instead; null restores
   * the canvas. post-aa uses this to capture the frame for its FXAA/smear
   * chain. The target MUST carry a depth buffer — the composite depth-tests
   * against what the polygonal pass left behind.
   */
  setOutputTarget(t: THREE.RenderTarget | null): void;
  /** The target the layer actually composites into, for evidence readback.
   *  Null when nothing is redirecting, in which case "the output" is the canvas.
   *  Added 2026-09-10 alongside the h/3 investigation: the march target and the
   *  composited output are DIFFERENT textures, and being able to read only the
   *  former is what let a missing-flesh bug hide behind a provably-correct
   *  march. */
  readonly outputTarget: THREE.RenderTarget | null;
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
  /**
   * THE INTERLACED FIELD DIVISOR (deeper interlace fields, 2026-09-10). 2 is the
   * shipped half-height field; 3 and 4 march a third or a quarter of the rows.
   *
   * The look gate on h/3 and h/4 is owner-approved on the understanding that the
   * comb period moves from 2 rows to 3-4 rows, so this is a LOOK lever that must
   * be judged on screen — the arithmetic here is not the decision.
   *
   * Clamped to [2, 8]. 1 is refused rather than treated as "no interlace": a
   * divisor of 1 would march every row while the composite still ran its FIELD
   * branch, which is a different thing from `setFieldStyle('off')` and not a
   * configuration anyone asked for. The shader clamps its own copy too, because
   * the inputs bind positionally and a bad binding must degrade rather than
   * divide by zero.
   *
   * `frame` (the whole-picture weave) is still TWO-FIELD ONLY — it hardcodes
   * `% 2` / `/ 2` in FIELD_INTERLEAVE_WGSL. Rather than leave that silent, the
   * setter REFUSES fields > 2 for that style and reports what it did.
   */
  setFieldCount(n: number): number;
  readonly fieldCount: number;
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
  /** Reproject a held row's stale sample through the camera that wrote it
   *  (?heldreproj / setHeldReproject). OFF ships the pre-2026-09-10 held row. */
  setHeldReproject(on: boolean): boolean;
  readonly heldReproject: boolean;
  /** Temporal accumulation of the marched flesh (?accum). OFF ships the plain
   *  low-res march; this is what makes a half-scale march acceptable again.
   *  Turning it ON turns the field weave OFF — they are mutually exclusive, and
   *  accumulation replaces the weave rather than joining it. */
  setTemporalAccum(on: boolean, alpha?: number): boolean;
  /** NEURAL UPSCALE STAGE (spec docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md).
   *  march -> upscale -> composite. `null` turns it off. On: forces field style
   *  'off' and refuses temporal accumulation (stacking is P5); the composite reads
   *  the stage's output-resolution flesh. The caller sets the march scale.
   *  `model` = trained weights (parseUpscaleModelJson), matching config's model and
   *  inputs; absent = seeded random weights. A mismatch throws and keeps the old stage. */
  setUpscale(config: UpscaleConfig | null, model?: UpscaleModel): UpscaleInfo;
  readonly upscaleInfo: UpscaleInfo;
  /** The live stage, for measurement readbacks only; null when off. */
  readonly upscaleStage: UpscaleStage | null;
  /** The march's second attachment (view-space normal, rgba32f) when the layer was created with
   *  `marchNormals`; null otherwise. */
  readonly marchNormalTexture: THREE.Texture | null;
  /** Run 4: the march's third attachment (rest-space noise anchor.xyz, w = detail gate), normals boots only. */
  readonly marchAnchorTexture: THREE.Texture | null;
  /** Run 4: the output-res skin-detail noise (xyz, w = gate), rgba32f; null unless normals are on. */
  readonly detailTarget: THREE.RenderTarget | null;
  /** Run 4: the same-body anchor jump limit (metres) for the detail pass's gradient extrapolation. */
  setDetailJumpMax(metres: number): void;
  /** Which flesh texture the composite reads: the raw march, the accumulated history, the upscale output,
   *  or the Run-5 refine debug view. */
  readonly compositeSource: 'march' | 'accum' | 'upscale' | 'refine-view';
  /** Run 5: the refine twins' bindings (march target + refine uniforms); null unless created with `refine`. */
  readonly refineSource: RefineSource | null;
  /** Run 5: [0] re-lit rgb + clip depth (accepted iff w < 1), [1] world normal; output-res; null unless `refine`. */
  readonly refineTarget: THREE.RenderTarget | null;
  /** Run 5: run the refine pass (cfg.x). Throws if the layer was not created with `refine`. */
  setRefine(on: boolean): void;
  readonly refine: boolean;
  /** Run 5: the refine entry's tuning (cfg.y/z/w). Units:
   *  - `reject` in MARCH texels — the pixel is discarded when |sdf| exceeds it times the march
   *    texel's world footprint (2·t·aaCfg.x). Clamped to >= 0; default 1.
   *  - `normalEps` in OUTPUT-pixel footprints — the normal stencil is it times t·aaCfg.x.
   *    Clamped to >= 0; default 0.25.
   *  - `steps` — Newton steps, rounded and clamped to the integer range 0..8; default 2. */
  setRefineCfg(cfg: { reject?: number; normalEps?: number; steps?: number }): void;
  readonly refineCfg: { reject: number; normalEps: number; steps: number };
  /** Run 5: the Gate-1 picture in place of the composite source. */
  setRefineView(on: boolean): void;
  readonly refineView: boolean;
  /** CAPTURE JITTER (neural upscale P3, spec 2026-09-11-neural-upscale-p3-training-design.md §1):
   *  a fixed sub-pixel view offset in output px, applied around the march only. `null` turns it
   *  off. Refused (returns false) while temporal accumulation or any field style is on — both drive
   *  their own view offset — and dropped if either turns on later. */
  setMarchJitter(offset: readonly [number, number] | null): boolean;
  readonly marchJitter: readonly [number, number] | null;
  resetTemporalAccum(): void;
  readonly temporalAccum: {
    on: boolean; alpha: number; epoch: number; frames: number; convergedFrames: number;
  };
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
/** Run 5: the refine cfg vector's shipped defaults, read ONCE from a throwaway
 *  createRefineUniforms() so the getter's no-layer fallback can never drift from
 *  zombie-gpu's actual initial values (x enabled, y reject, z normalEps, w steps). */
const REFINE_CFG_DEFAULTS = createRefineUniforms().cfg.value.clone();

export const DEFAULT_SDF_SCALE = 0.7;

export interface SdfLayerOptions {
  /** Allocate a second march attachment carrying the VIEW-space shading normal and render the
   *  march with a renderer-level MRT into it (neural upscale rgbn/rgbdn inputs). Dev-only: the
   *  shipped boot keeps the single-attachment target and its exact frame. */
  marchNormals?: boolean;
  /** Run 5: allocate the output-res refine targets and run the per-body refine pass; implies `marchNormals`. */
  refine?: boolean;
}

export function createSdfLayer(renderer: THREE.WebGPURenderer, options: SdfLayerOptions = {}): SdfLayer {
  const refineOn = options.refine === true;
  const marchNormals = options.marchNormals === true || refineOn;
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
  /** The interlaced field divisor: 2 = the shipped half-height field. Clamped in
   *  the shader as well, so a zero here degrades to no-interlace rather than to a
   *  division by zero in the composite. */
  const uFieldCount = uniform(2);
  /** The live divisor. `FIELD_COUNT`-equivalent default is 2 — the shipped
   *  half-height field, so an untouched page is bit-identical. */
  let fieldCount = 2;
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
  // HELD-ROW REPROJECTION (2026-09-10, fields only). One inverse view-projection
  // PER RING SLOT: slot 0 is the field marched one frame ago, slot 1 two, slot 2
  // three, so a held row's stale sample can be reprojected through the camera
  // that actually wrote it. uHeldInv above is the half-rate C2 path's single held
  // camera and stays what it was — fields and half-rate are mutually exclusive.
  // Rotated in lockstep with the textures (see RING ROTATION): push order is
  // slot1 <- slot0, slot2 <- slot1, slot0 <- this frame, the same order the
  // textures are copied in.
  const uHeldInv1 = uniform(new THREE.Matrix4());
  const uHeldInv2 = uniform(new THREE.Matrix4());
  /** Scratch for the ring rotation's current view-projection (jittered). */
  const _ringVp = new THREE.Matrix4();

  // ---- TEMPORAL ACCUMULATION (plan 2026-09-10-temporal-accumulation.md) -------
  // Output-sized FLESH history, ping-ponged by a texture copy rather than by
  // rebinding: the resolve's materials hold FIXED bindings (read accumPrev, write
  // accumNext) and one copy a frame moves next -> prev, the same true-copy pattern
  // the field ring uses. Rebinding a TextureNode's value would also work, but a
  // fixed pair cannot drift out of sync with what the shader thinks it is reading.
  const accumOpts = {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  } as const;
  const accumPrev = new THREE.RenderTarget(1, 1, { ...accumOpts });
  const accumNext = new THREE.RenderTarget(1, 1, { ...accumOpts });
  const uAccumOn = uniform(0);
  const uAccumAlpha = uniform(TEMPORAL_ACCUM_DEFAULT_ALPHA);
  // The two cameras the reprojection needs: this frame's inverse (to unproject
  // the current depth) and the PREVIOUS frame's (to project into the history).
  const uAccumCurInvVp = uniform(new THREE.Matrix4());
  const uAccumPrevVp = uniform(new THREE.Matrix4());
  const _accumCurVp = new THREE.Matrix4();
  let accumOn = false;
  /** Frames accumulated since the last reset — the history length, and the index
   *  the jitter sequence is evaluated at. Both are what make an accumulated frame
   *  comparable at all: without them "frame k" is not a comparison point. */
  let accumFrames = 0;
  /** Bumped by every reset, so a stored hash knows which history it came from. */
  let accumEpoch = 0;
  /** Set when the history must NOT be blended on the next frame (a reset, a
   *  resize, a teleport): that frame takes the current sample at alpha = 1, which
   *  re-seeds the history without a clear pass. */
  let accumSeed = true;

  /** The neural upscale stage, or null (spec 2026-09-11). */
  let upscale: UpscaleStage | null = null;

  /** Capture jitter for supersampled training targets (P3), or null. */
  let marchJitter: [number, number] | null = null;

  /** Reset the accumulation to a defined state. The epoch advances so a stored
   *  hash knows which history it came from, and the next frame re-seeds instead
   *  of blending — which is what makes frame 0 of an epoch independent of
   *  whatever the buffer happened to hold. Anything that moves the camera
   *  discontinuously or reallocates must call this rather than reproject garbage
   *  for the next N frames (see the frame-hash decision note). */
  function resetAccum(): void {
    accumSeed = true;
    accumFrames = 0;
    accumEpoch++;
  }
  /** 0 = the pre-2026-09-10 held row verbatim (bit-identical), 1 = reprojected.
   *  Ships OFF until the owner's look: at nf = 2 the held row IS the shipped
   *  look the owner accepted, so this cannot default on without re-deciding h/2
   *  as well. `?heldreproj=1` / `setHeldReproject(on)`. */
  const uHeldReproject = uniform(0);
  let heldReproject = false;

  // FloatType because the alpha channel carries DEPTH. At 8 bits per channel
  // the composite would resolve depth to 256 steps and the flesh would z-fight
  // the floor across the whole frame.
  const target = new THREE.RenderTarget(1, 1, {
    depthBuffer: true,          // bodies still have to occlude each OTHER
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    count: marchNormals ? 3 : 1,
  });
  // RUNTIME NORMALS (2026-09-12): with two attachments every material drawn into `target` must
  // emit both, so the MRT is set on the RENDERER around the march renders (three's MRTNode maps
  // outputs to attachments BY NAME and drops unmatched names — a material-level mrtNode would
  // break that material in every single-attachment target). `output` is each material's own
  // final colour; the normal is the lit march's private global rotated into view space (unit in,
  // unit out — no normalize, which would NaN on a fragment that never wrote it).
  let marchMrt: unknown = null;
  if (marchNormals) {
    target.textures[0]!.name = 'output';
    target.textures[1]!.name = 'marchNormal';
    // Run 4: rest-space noise anchor + detail gate, for the output-res detail pass below.
    target.textures[2]!.name = 'marchAnchor';
    const n = marchNormalRead({ dep: output as never }) as unknown as { xyz: unknown; w: unknown };
    marchMrt = mrt({
      output,
      marchNormal: vec4(mul(mat3(cameraViewMatrix as never), n.xyz as never) as never, n.w as never),
      marchAnchor: marchAnchorRead({ dep: output as never }),
    });
  }
  // RUN 4 DETAIL PASS (plan 2026-09-12-neural-upscale-run4-relief): the skin-detail noise evaluated
  // at OUTPUT resolution from marchAnchor (DETAIL_FIELD). rgba32f so the capture readback is exact.
  // Runs only when the attachment exists, right after the march, before the upscale stage.
  const detailTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
  });
  const uDetailJumpMax = uniform(0.08);
  let detailScene: THREE.Scene | null = null;
  if (marchNormals) {
    const mat = new MeshBasicNodeMaterial();
    const out = detailFieldFn({ anchorTex: texture(target.textures[2]!), marchTex: texture(target.textures[0]!), texCoord: uv(), flipY: uFlipY, jumpMax: uDetailJumpMax } as never) as unknown as { xyz: unknown; w: unknown };
    mat.colorNode = vec4(out.xyz as never, 1.0);
    mat.outputNode = vec4(out.xyz as never, out.w as never);
    mat.depthTest = false; mat.depthWrite = false; mat.blending = THREE.NoBlending;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false;
    detailScene = new THREE.Scene(); detailScene.add(m);
  }
  // RUN 5 REFINE (spec 2026-09-13-neural-upscale-run5-sdf-refine-design §4): two OUTPUT-res
  // attachments written by the refine twins (REFINE_LAYER) under a hardware depth test, nearest body
  // wins. [0] 'output' = re-lit linear rgb, w = clip depth (ACCEPTED iff w < 1.0 — the march's own
  // sentinel, so the clear alpha is the gate); [1] 'refineN' = WORLD-space unit normal, w = 1 where
  // written (never a gate: the clear alpha is 1 too). FloatType so readback is exact.
  // Allocated ONLY when the option is on: creating the uniform nodes at all perturbs the
  // shipped frame (march-hash), and this path must stay byte-identical without `refine`.
  const refineUniforms = refineOn ? createRefineUniforms() : null;
  let refineTarget: THREE.RenderTarget | null = null;
  let refineViewTarget: THREE.RenderTarget | null = null;
  let refineMrt: unknown = null;
  let refineView = false;
  if (refineOn) {
    refineTarget = new THREE.RenderTarget(1, 1, {
      depthBuffer: true, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, count: 2,
    });
    refineTarget.textures[0]!.name = 'output';
    refineTarget.textures[1]!.name = 'refineN';
    refineMrt = mrt({ output, refineN: marchNormalRead({ dep: output as never }) });
    // The Gate-1 picture: accepted refine pixels over the current output-res source.
    refineViewTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
    });
  }
  const REFINE_VIEW_WGSL = /* wgsl */ `fn refineView(refineC: texture_2d<f32>, src: texture_2d<f32>, texCoord: vec2<f32>, flipY: f32) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(refineC, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let p = clamp(vec2<i32>(floor(st * vec2<f32>(dims))), vec2<i32>(0, 0), dims - vec2<i32>(1, 1));
  let rc = textureLoad(refineC, p, 0);
  if (rc.w < 1.0) { return rc; }
  // The source may be at march res or output res; derive the ratio from the two texture
  // sizes rather than assuming a fixed 2x, which is wrong at any other sdfScale.
  let sdims = vec2<i32>(textureDimensions(src, 0));
  let sp = clamp(vec2<i32>(vec2<f32>(p) * vec2<f32>(sdims) / vec2<f32>(dims)), vec2<i32>(0, 0), sdims - vec2<i32>(1, 1));
  return textureLoad(src, sp, 0);
}`;
  let refineViewSrcNode: ReturnType<typeof texture> | null = null;
  let refineViewScene: THREE.Scene | null = null;
  if (refineOn) {
    refineViewSrcNode = texture(target.texture);
    const mat = new MeshBasicNodeMaterial();
    const out = wgslFn(REFINE_VIEW_WGSL)({ refineC: texture(refineTarget!.textures[0]!), src: refineViewSrcNode, texCoord: uv(), flipY: uFlipY } as never) as unknown as { xyz: unknown; w: unknown };
    mat.colorNode = vec4(out.xyz as never, 1.0);
    mat.outputNode = vec4(out.xyz as never, out.w as never);
    mat.depthTest = false; mat.depthWrite = false; mat.blending = THREE.NoBlending;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false;
    refineViewScene = new THREE.Scene(); refineViewScene.add(m);
  }

  const withMarchMrt = <T>(fn: () => T): T => {
    if (!marchMrt) return fn();
    renderer.setMRT(marchMrt as never);
    try { return fn(); } finally { renderer.setMRT(null); }
  };

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
  // THE HISTORY RING (deeper interlace fields, step 3, 2026-09-10). `fieldPrev`
  // is slot 0 — the field drawn one frame ago — and these two hold the fields
  // before it, so at h/3 and h/4 a held row can read its OWN sample instead of
  // being interpolated from the bracketing marched rows. Only allocated to the
  // depth a deeper field needs; at nf = 2 the shader never reads past slot 0, so
  // their CONTENT is irrelevant to the shipped path (they still cost two 1x1
  // textures at h/2, which is nothing).
  const fieldRing0 = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const fieldRing1 = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
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
  // The MESH ring, parallel to the flesh ring: this weave reconstructs held bone
  // rows the same way, so it needs the same depth of history or bone and flesh
  // reconstruct from different fields.
  const fieldMeshRing0 = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const fieldMeshRing1 = new THREE.RenderTarget(1, 1, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
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
    fieldCount: uFieldCount,
    prevTex1: texture(fieldMeshRing0.texture),
    prevTex2: texture(fieldMeshRing1.texture),
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
    fieldCount: uFieldCount,
    // 'frame' refuses fields > 2, so this path never reads past slot 0; the ring is
    // bound for shape only.
    prevTex1: texture(fieldRing0.texture),
    prevTex2: texture(fieldRing1.texture),
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
  // ADAPTIVE MARGIN state (temporal-start.ts temporalMarginForMotion). The
  // per-body world positions of the last FRESH frame; the margin measures
  // fresh-frame-to-fresh-frame translation, which covers half-rate holds
  // natively (their history spans two frame intervals and so does the
  // measurement). An explicit margin via setTemporalStart turns the
  // adaptation off for A/Bs.
  const temporalBodyPos = new Map<THREE.Object3D, THREE.Vector3>();
  const temporalPosScratch = new THREE.Vector3();
  let temporalAdaptiveMargin = true;
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

  // The composite's output-resolution flesh input. Held as a node so the upscale
  // stage can REBIND its value (stage output) without touching COMPOSITE_WGSL:
  // the default path keeps the same shader and the same accumNext binding.
  const accumTexNode = texture(accumNext.texture);

  const sampled = composite({
    layerTex: texture(target.texture),
    prevFieldTex: texture(fieldPrev.texture),
    prevFieldTex1: texture(fieldRing0.texture),
    prevFieldTex2: texture(fieldRing1.texture),
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
    fieldCount: uFieldCount,
    accumTex: accumTexNode,
    accumOn: uAccumOn,
    heldInv1: uHeldInv1,
    heldInv2: uHeldInv2,
    heldReproject: uHeldReproject,
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
  /** Point the composite back at whatever it would read with the refine VIEW off:
   *  the upscale stage's output when the stage is on (setUpscale), else the accumulation
   *  history with the same on-flag setTemporalAccum/setUpscale(null) leave behind. */
  function restoreCompositeSource(): void {
    accumTexNode.value = upscale ? upscale.output.texture : accumNext.texture;
    (uAccumOn.value as number) = upscale !== null || accumOn ? 1 : 0;
  }

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);

  quadCam.position.z = 1;

  // The accumulation resolve: one full-screen quad, fixed bindings, writing
  // accumNext (see the ping-pong note above). It runs between the march and the
  // composite so the composite is handed reconstructed flesh, and the polygonal
  // pass never sees an accumulated image.
  const accumMat = new THREE.MeshBasicNodeMaterial();
  const accumOut = temporalAccum({
    curTex: texture(target.texture),
    histTex: texture(accumPrev.texture),
    texCoord: uv(),
    flipY: uFlipY,
    curInvVp: uAccumCurInvVp,
    prevVp: uAccumPrevVp,
    alpha: uAccumAlpha,
  }) as unknown as { xyz: unknown; w: unknown };
  // BOTH colorNode and outputNode, exactly as the temporal-start blit does: the
  // alpha channel IS the depth the composite depth-tests with, and with
  // transparency off the pipeline forces alpha to 1 unless outputNode carries it.
  // Missing this made every accumulated frame discard as "nothing here" — the
  // flesh vanished and the gate read a 6.5x WORSE image than the raw low-res march
  // it was supposed to improve (2026-09-10).
  accumMat.colorNode = vec4(accumOut.xyz as never, accumOut.w as never);
  accumMat.outputNode = vec4(accumOut.xyz as never, accumOut.w as never);
  accumMat.depthTest = false;
  accumMat.depthWrite = false;
  const accumQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), accumMat);
  accumQuad.frustumCulled = false;
  const accumScene = new THREE.Scene();
  accumScene.add(accumQuad);

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
    // `fieldCount` rides through so h/3 and h/4 actually land on a third or a
    // quarter of the rows. The DEFAULT is 2, so an untouched page takes exactly
    // the shipped path.
    const h = (fieldStyle === 'sdf' || fieldStyle === 'bodies') ? fieldTargetHeight(hFull, fieldCount) : hFull;
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
    // The accumulation history is OUTPUT-sized, not march-sized: accumulating a
    // low-res march INTO its own grid would average the jittered sub-positions
    // into the same texels (a box blur, no new detail). At output resolution each
    // pixel reads a different low-res texel as the jitter advances, which is what
    // reconstructs. Reallocating it also invalidates its contents, so reset.
    accumPrev.setSize(fullW, fullH);
    accumNext.setSize(fullW, fullH);
    // The upscale stage reads the march grid and writes the output grid.
    upscale?.setSize(w, h, fullW, fullH);
    if (detailScene) detailTarget.setSize(Math.max(1, fullW), Math.max(1, fullH));
    if (refineOn) {
      refineTarget!.setSize(Math.max(1, fullW), Math.max(1, fullH));
      refineViewTarget!.setSize(Math.max(1, fullW), Math.max(1, fullH));
    }
    resetAccum();
    // The whole-frame field buffers track the OUTPUT size, not sdfScale: the
    // polygonal pass has always rendered at full content resolution and must
    // keep doing so, halved only in the field axis.
    const fw = Math.max(1, fullW);
    const fh = fieldStyle === 'frame' ? fieldTargetHeight(fullH, fieldCount) : 1;
    fieldFull.setSize(fw, fh);
    // fieldPrev retains whichever buffer the style actually fields: the march
    // target in 'sdf', the whole-frame buffer in 'frame'. Sizing it to the
    // wrong one silently weaves mismatched texel grids.
    if (fieldStyle === 'sdf' || fieldStyle === 'bodies') fieldPrev.setSize(w, h);
    else fieldPrev.setSize(fw, fh);
    // The ring slots track fieldPrev exactly: they hold the SAME field, one and
    // two frames older, so a mismatched size would weave mismatched grids — the
    // defect class that produced "skeleton outside the body".
    fieldRing0.setSize(fieldPrev.width, fieldPrev.height);
    fieldRing1.setSize(fieldPrev.width, fieldPrev.height);
    // The mesh field follows the MARCH target's grid so bone and flesh weave
    // on identical texel rows.
    const mh = fieldStyle === 'bodies' ? h : 1;
    fieldMesh.setSize(fieldStyle === 'bodies' ? w : 1, mh);
    fieldMeshPrev.setSize(fieldStyle === 'bodies' ? w : 1, mh);
    fieldMeshRing0.setSize(fieldMeshPrev.width, fieldMeshPrev.height);
    fieldMeshRing1.setSize(fieldMeshPrev.width, fieldMeshPrev.height);
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
        if (marchMrt) renderer.setMRT(marchMrt as never);
        try { await renderer.compileAsync(object, camera, scene); } finally { if (marchMrt) renderer.setMRT(null); }
      } finally {
        renderer.setRenderTarget(previousTarget);
        camera.layers.mask = previousMask;
      }
    },
    async precompilePasses(scene, camera) {
      const previousTarget = renderer.getRenderTarget();
      const previousMask = camera.layers.mask;
      let n = 0;
      // One failure must not cost the rest: a warm-up is best-effort, and a
      // pass whose pipeline cannot be built here will simply be built the way
      // it always was.
      const compile = async (
        what: string,
        s: THREE.Scene,
        cam: THREE.Camera,
        t: THREE.RenderTarget | null,
        mrtNode: unknown = null,
      ) => {
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        try {
          renderer.setRenderTarget(t);
          if (mrtNode) renderer.setMRT(mrtNode as never);
          try {
            // BOUNDED. A compileAsync whose pipeline creation fails inside the
            // backend can leave its promise unsettled — which would hold the
            // warm-up (and the loader behind it) forever. A pass that does not
            // settle here is simply left to compile the way it always did.
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), PRECOMPILE_PASS_TIMEOUT_MS); });
            const outcome = await Promise.race([renderer.compileAsync(s, cam).then(() => 'ok' as const), timeout]);
            if (timer !== undefined) clearTimeout(timer);
            if (outcome === 'timeout') { console.warn(`[sdf-layer] precompile ${what} did not settle in ${PRECOMPILE_PASS_TIMEOUT_MS} ms — skipped`); return; }
          } finally { if (mrtNode) renderer.setMRT(null); }
          n++;
        } catch (err) {
          console.warn(`[sdf-layer] precompile ${what} failed after ${Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)} ms`, err);
        }
      };
      try {
        // --- the marched twins, one layer at a time -------------------------
        camera.layers.set(SDF_LAYER);
        await compile('march', scene, camera, target, marchMrt);
        // GATED BY THE SAME FLAG THE RENDER PATH READS. Warming a pass that is
        // off is not free and not harmless: an off-by-default twin can carry a
        // stale mapBody argument list that only fails at pipeline creation, and
        // compiling it here would spend the warm-up's budget producing an error
        // for a pass that never runs.
        if (coneUniforms.enabled.value > 0.5) {
          camera.layers.set(CONE_LAYER);
          await compile('cone', scene, camera, coneCoarse);
        }
        if (occluderUniforms.enabled.value > 0.5) {
          camera.layers.set(OCCLUDER_LAYER);
          await compile('occluder', scene, camera, occluder);
        }
        if (shellUniforms.enabled.value > 0.5) {
          camera.layers.set(SHELL_LAYER);
          await compile('shell-entry', scene, camera, shellEntry);
          camera.layers.set(SHELL_EXIT_LAYER);
          await compile('shell-exit', scene, camera, shellExit);
        }
        if (depthPreUniforms.cfg.value.x > 0.5) {
          camera.layers.set(DEPTH_PREPASS_LAYER);
          await compile('depth-pre', scene, camera, depthPre);
        }
        if (refineTarget && refineMrt) {
          camera.layers.set(REFINE_LAYER);
          await compile('refine', scene, camera, refineTarget, refineMrt);
        }
        camera.layers.mask = previousMask;
        // --- the layer's own fullscreen passes -------------------------------
        await compile('prev-blit', blitScene, quadCam, prev);
        if (accumOn) await compile('accum', accumScene, quadCam, accumNext);
        if (detailScene) await compile('detail', detailScene, quadCam, detailTarget);
        if (refineViewScene && refineViewTarget) await compile('refine-view', refineViewScene, quadCam, refineViewTarget);
        await compile('composite', quadScene, quadCam, outputTarget);
        // --- the upscale stage's passes --------------------------------------
        if (upscale) n += await upscale.precompile(renderer, quadCam);
      } finally {
        renderer.setRenderTarget(previousTarget);
        camera.layers.mask = previousMask;
      }
      return n;
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
      // THE PARITY MUST CYCLE OVER THE LIVE DIVISOR. `fieldParity` defaults to
      // fields = 2, and that default was the second half of the h/3 defect: with
      // nf = 3 the shader tests `outRow % 3 == parity`, so a parity that only ever
      // reaches 0 or 1 makes the FIELD-2 BRANCH UNREACHABLE — a third of the fresh
      // rows never match, and `parity == 1` samples field 1's rows forever. The
      // owner saw the result as "the SDF flesh does not render". Passing the live
      // divisor is what makes the cycle 0,1,2 and the three fields actually rotate.
      const parity = fieldMode ? fieldParity(frameIndex, fieldCount) : 0;
      if (fieldMode) uFieldParity.value = parity;
      // The jitter is in rows of the grid being FIELDED: the output grid for
      // 'frame' (fieldFull is output-sized), the sdfScale'd grid otherwise.
      const applyFieldJitter = () => {
        const jw = fieldStyle === 'frame' ? Math.max(1, fullW) : Math.max(1, Math.round(fullW * scale));
        const jh = fieldStyle === 'frame' ? Math.max(1, fullH) : Math.max(1, Math.round(fullH * scale));
        // CENTRED OVER THE LIVE DIVISOR, not over two fields. `parity - 0.5` is
        // the two-field centering (fields - 1) / 2 = 0.5; at nf = 3 the fields
        // must sit at -1 / 0 / +1 full-res rows, and at nf = 4 at -1.5 … +1.5.
        // Leaving it at 0.5 would bias every field off-centre, which is the same
        // "the two-field constant survived into a deeper field" defect as the
        // unreachable parity branch. At nf = 2 this is EXACTLY parity - 0.5, so
        // the shipped h/2 sampling is untouched.
        camera.setViewOffset(jw, jh, 0, parity - (fieldCount - 1) / 2, jw, jh);
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
      // ADAPTIVE MARGIN (temporalMarginForMotion). The start margin only has
      // to cover how far flesh can move toward the camera over one history
      // interval, so scale the shipped 0.25 m constant down to what the
      // bodies ACTUALLY moved fresh frame to fresh frame. Runs before the
      // march reads temporalCfg; chunks count too — detached gibs march on
      // the same material and are the fastest things in the scene. A body
      // the map has never seen (first frame, spawn, teleport) reads as moved
      // by the cap: unknown motion is covered, not assumed away. Stored
      // before the unseen check so the map seeds on the very first frame.
      if (temporalAdaptiveMargin && (lastUniforms.cfg.value as THREE.Vector4).x > 0.5) {
        let temporalMaxDisp = 0;
        let temporalPosCapHit = false;
        const measure = (o: THREE.Object3D): void => {
          const cur = o.getWorldPosition(temporalPosScratch);
          const lastPos = temporalBodyPos.get(o);
          temporalBodyPos.set(o, cur.clone());
          if (lastPos === undefined) { temporalPosCapHit = true; return; }
          const d = cur.distanceTo(lastPos);
          if (d > temporalMaxDisp) { temporalMaxDisp = d; }
        };
        for (const o of bodies) measure(o);
        for (const o of chunks) measure(o);
        (lastUniforms.cfg.value as THREE.Vector4).y = temporalPosCapHit
          ? TEMPORAL_START_DEFAULTS.margin
          : temporalMarginForMotion(temporalMaxDisp);
        // Corpses despawn; drop keys the scene no longer holds so the map
        // cannot grow across a long session. Runs only when stale entries
        // actually outnumber the live set.
        if (temporalBodyPos.size > (bodies.length + chunks.length) * 2 + 8) {
          const live = new Set([...bodies, ...chunks]);
          for (const k of temporalBodyPos.keys()) { if (!live.has(k)) temporalBodyPos.delete(k); }
        }
      }
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

      // TEMPORAL ACCUMULATION JITTER (2026-09-10). A per-frame SUB-PIXEL frustum
      // offset, applied only around the march and cleared immediately after: this
      // is what makes the low-res march sample a different sub-position of every
      // output pixel each frame, i.e. what turns accumulation into reconstruction
      // rather than blur. Indexed by frames-since-epoch, so it is deterministic
      // AND advancing (see temporal-accum.ts — do NOT freeze it for recordings).
      if (accumOn) {
        const [jx, jy] = accumJitter(accumFrames);
        camera.setViewOffset(fullW, fullH, jx, jy, fullW, fullH);
      } else if (marchJitter) {
        // CAPTURE JITTER (neural upscale P3): one fixed sub-pixel offset for supersampled
        // training targets. Around the march only — cleared right after it, below.
        camera.setViewOffset(fullW, fullH, marchJitter[0], marchJitter[1], fullW, fullH);
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
          withMarchMrt(() => renderer.render(scene, camera));
          for (const o of group) o.visible = false;
        }
        renderer.autoClear = prevAuto;
        for (const [o, v] of wasVisible) o.visible = v;
      } else if (chunkPass !== 'merged' && chunks.length > 0) {
        // Bodies first (clears), then the chunks on top with autoClear off.
        const wasVisible = new Map<THREE.Object3D, boolean>();
        for (const o of chunks) { wasVisible.set(o, o.visible); o.visible = false; }
        renderer.setRenderTarget(target);
        withMarchMrt(() => renderer.render(scene, camera));
        if (chunkPass === 'split') {
          for (const [o, v] of wasVisible) o.visible = v;
          for (const o of bodies) { if (!wasVisible.has(o)) { wasVisible.set(o, o.visible); o.visible = false; } }
          setPassLabel('sdf:march-chunks');
          const prevAuto = renderer.autoClear;
          renderer.autoClear = false;
          withMarchMrt(() => renderer.render(scene, camera));
          renderer.autoClear = prevAuto;
        }
        for (const [o, v] of wasVisible) o.visible = v;
      } else {
        renderer.setRenderTarget(target);
        withMarchMrt(() => renderer.render(scene, camera));
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
      // Capture jitter is scoped to the march: nothing after it (accumulation, upscale,
      // composite) may see the offset.
      if (marchJitter) camera.clearViewOffset();

      // THE ACCUMULATION RESOLVE (2026-09-10), between the march and the
      // composite: the composite is handed reconstructed flesh and the polygonal
      // pass never sees an accumulated image. Fixed bindings — it reads
      // accumPrev and writes accumNext — with one true-copy after it, the same
      // pattern the field ring uses.
      if (accumOn) {
        camera.clearViewOffset();
        setPassLabel('sdf:accum');
        (uAccumCurInvVp.value as THREE.Matrix4).copy(_curVp).invert();
        (uAccumAlpha.value as number) = accumSeed ? 1 : accumAlpha(accumFrames);
        renderer.setRenderTarget(accumNext);
        const prevAccumAuto = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(accumScene, quadCam);
        renderer.autoClear = prevAccumAuto;
        renderer.copyTextureToTexture(accumNext.texture, accumPrev.texture);
        // The NEXT frame reprojects against THIS frame's camera, so the pairing
        // (history, camera) can never drift — the same reasoning the temporal
        // start's invVp copy follows.
        (uAccumPrevVp.value as THREE.Matrix4).copy(_curVp);
        accumSeed = false;
        accumFrames++;
      }

      // NEURAL UPSCALE STAGE (2026-09-11): between the march and the composite,
      // where the accumulation resolve sits (the two are exclusive until P5). The
      // composite reads upscale.output through accumTexNode.
      if (detailScene) {
        setPassLabel('sdf:detail');
        renderer.setRenderTarget(detailTarget);
        void renderer.render(detailScene, quadCam);
      }
      // RUN 5 REFINE (spec 2026-09-13-…-run5-sdf-refine-design §4). After the jitter clear, so the
      // twins march the same projection the march alpha encodes. setRefine forces field styles off
      // and temporal accumulation off, so there is no field/accum view offset in play either.
      if (refineOn && refineUniforms!.cfg.value.x > 0.5) {
        setPassLabel('sdf:refine');
        refineUniforms!.nearFar.value.set(camera.near, camera.far);
        camera.layers.set(REFINE_LAYER);
        renderer.setRenderTarget(refineTarget);
        renderer.setMRT(refineMrt as never);
        try {
          // Clear with the MRT already set so BOTH attachments are cleared, and with alpha
          // forced to 1: the colour attachment's alpha IS the accepted gate (w < 1), so a
          // cleared-to-0 alpha would read as "every pixel refined at depth 0".
          const prevAlpha = renderer.getClearAlpha();
          renderer.setClearAlpha(1);
          renderer.clear();
          renderer.setClearAlpha(prevAlpha);
          void renderer.render(scene, camera);
        } finally { renderer.setMRT(null); }
        camera.layers.set(SDF_LAYER);
      }
      if (upscale) upscale.render(renderer, quadCam, camera);
      if (refineOn && refineView && refineViewScene && refineUniforms!.cfg.value.x > 0.5) {
        setPassLabel('sdf:refine-view');
        // What the composite would be reading right now: the stage's output, else the
        // accumulation history when accum is on, else the raw march target.
        refineViewSrcNode!.value = upscale ? upscale.output.texture : accumOn ? accumNext.texture : target.texture;
        renderer.setRenderTarget(refineViewTarget);
        void renderer.render(refineViewScene, quadCam);
        accumTexNode.value = refineViewTarget!.texture;
        (uAccumOn.value as number) = 1;
      }

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

        // RING ROTATION: shift slot0 -> slot1 -> slot2 BEFORE overwriting slot 0,
        // so a held row's own sample is still reachable the frame after next.
        renderer.copyTextureToTexture(fieldRing0.texture, fieldRing1.texture);
        renderer.copyTextureToTexture(fieldPrev.texture, fieldRing0.texture);
        renderer.copyTextureToTexture(target.texture, fieldPrev.texture);
        // The per-slot CAMERAS rotate with the textures, in the SAME ORDER and
        // for the same reason (source -> destination reads as slot2 <- slot1,
        // then slot1 <- slot0, then slot0 <- this frame). Getting the order
        // wrong is silent: every held row would be reprojected through its
        // neighbour's camera, which is a plausible-looking smear rather than an
        // error. The current VP is captured HERE because this is the last moment
        // the JITTERED projection is still installed (clearViewOffset follows):
        // the retained field was marched with the field jitter applied, so a
        // camera without it reprojects every held row half a row off.
        _ringVp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
        rotateHeldCameras(
          [uHeldInv.value as THREE.Matrix4, uHeldInv1.value as THREE.Matrix4, uHeldInv2.value as THREE.Matrix4],
          _ringVp,
        );
        // Depth is retained WITH colour: a held row is a snapshot of one
        // instant, not last frame's pixels at this frame's depth.
        renderer.copyTextureToTexture(fieldMeshRing0.texture, fieldMeshRing1.texture);
        renderer.copyTextureToTexture(fieldMeshPrev.texture, fieldMeshRing0.texture);
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
    get outputTarget() { return outputTarget; },
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
      // An explicit margin pins cfg.y and disables the per-frame adaptation;
      // omit it and the margin tracks measured body motion every fresh frame.
      if (margin !== undefined) { v.y = Math.max(0, margin); temporalAdaptiveMargin = false; }
      if (slope !== undefined) v.z = Math.max(0, slope);
    },
    get temporalStart() {
      const v = lastUniforms.cfg.value as THREE.Vector4;
      return { on: v.x > 0.5, margin: v.y, slope: v.z, maxStart: v.w, adaptiveMargin: temporalAdaptiveMargin };
    },
    setHeldReproject(on) {
      heldReproject = on;
      (uHeldReproject.value as number) = on ? 1 : 0;
      return heldReproject;
    },
    get heldReproject() { return heldReproject; },
    setTemporalAccum(on, alpha) {
      if (on && upscale) {
        console.warn('[sdf-layer] temporal accumulation refused while the upscale stage is on (stacking is P5)');
        return accumOn;
      }
      if (on) marchJitter = null;
      accumOn = on;
      // The composite's output-resolution branch also carries the upscale stage.
      (uAccumOn.value as number) = on || upscale !== null ? 1 : 0;
      if (alpha !== undefined) (uAccumAlpha.value as number) = Math.min(1, Math.max(0.01, alpha));
      // MUTUALLY EXCLUSIVE WITH THE FIELD WEAVE, and accumulation wins: the
      // composite's field branch returns before the accumulated source is ever
      // consulted, and the field's row jitter would fight the sub-pixel one. This
      // is a replacement, not an addition — 'bodies' fields the flesh so it can
      // hold rows; accumulation reconstructs the flesh instead, at full output
      // resolution, so there are no held rows to disagree about.
      if (on && fieldStyle !== 'off') this.setFieldStyle('off');
      // Whatever is in the history buffer is from another configuration.
      resetAccum();
      return accumOn;
    },
    resetTemporalAccum() { resetAccum(); },
    setUpscale(config, model) {
      if (config === null) {
        upscale?.dispose();
        upscale = null;
        accumTexNode.value = accumNext.texture;
        (uAccumOn.value as number) = accumOn ? 1 : 0;
        return upscaleInfoOf(null);
      }
      if (accumOn) {
        console.warn('[sdf-layer] upscale: turning temporal accumulation OFF (the two do not stack until P5)');
        this.setTemporalAccum(false);
      }
      if (fieldStyle !== 'off') this.setFieldStyle('off');
      // Build first: a model/config mismatch throws here and leaves the old stage intact.
      if (inputsUseNormals(config.inputs) && !marchNormals) {
        throw new Error(`upscale: input set ${config.inputs} needs march normals — boot with ?upscale=... so the layer allocates the attachment`);
      }
      const next = createUpscaleStage(config, target.texture, uFlipY, model, marchNormals ? target.textures[1] : undefined,
        detailScene ? detailTarget.texture : undefined,
        refineTarget ? { n: refineTarget.textures[1]!, c: refineTarget.textures[0]! } : undefined);
      upscale?.dispose();
      upscale = next;
      upscale.setSize(target.width, target.height, fullW, fullH);
      accumTexNode.value = upscale.output.texture;
      (uAccumOn.value as number) = 1;
      return upscaleInfoOf(upscale);
    },
    get marchNormalTexture() { return marchNormals ? target.textures[1]! : null; },
    get marchAnchorTexture() { return marchNormals ? target.textures[2]! : null; },
    get detailTarget() { return detailScene ? detailTarget : null; },
    setDetailJumpMax(m) { (uDetailJumpMax.value as number) = Math.max(0.001, m); },
    get upscaleInfo() { return upscaleInfoOf(upscale); },
    get upscaleStage() { return upscale; },
    get compositeSource() { return refineView ? 'refine-view' : upscale ? 'upscale' : accumOn ? 'accum' : 'march'; },
    get refineSource() { return refineUniforms ? { texture: target.texture, normalTexture: target.textures[1]!, uniforms: refineUniforms } : null; },
    get refineTarget() { return refineTarget; },
    setRefine(on) {
      if (on && !refineUniforms) throw new Error('refine: boot with ?refine=1 so the layer allocates the refine targets');
      if (on) {
        // Same exclusions setUpscale enforces: the refine twins march the projection the march
        // alpha encodes, and both accumulation and any field style drive their own view offset.
        if (accumOn) {
          console.warn('[sdf-layer] refine: turning temporal accumulation OFF (the refine reads the march depth of THIS frame)');
          this.setTemporalAccum(false);
        }
        if (fieldStyle !== 'off') this.setFieldStyle('off');
      }
      if (refineUniforms) (refineUniforms.cfg.value as THREE.Vector4).x = on ? 1 : 0;
    },
    get refine() { return refineUniforms !== null && (refineUniforms.cfg.value as THREE.Vector4).x > 0.5; },
    setRefineCfg(cfg) {
      if (!refineUniforms) return;
      const v = refineUniforms.cfg.value as THREE.Vector4;
      if (cfg.reject !== undefined) v.y = Math.max(0, cfg.reject);
      if (cfg.normalEps !== undefined) v.z = Math.max(0, cfg.normalEps);
      if (cfg.steps !== undefined) v.w = Math.min(8, Math.max(0, Math.round(cfg.steps)));
    },
    get refineCfg() {
      if (!refineUniforms) return { reject: REFINE_CFG_DEFAULTS.y, normalEps: REFINE_CFG_DEFAULTS.z, steps: REFINE_CFG_DEFAULTS.w };
      const v = refineUniforms.cfg.value as THREE.Vector4;
      return { reject: v.y, normalEps: v.z, steps: v.w };
    },
    setRefineView(on) {
      if (on && !(refineUniforms && refineUniforms.cfg.value.x > 0.5)) {
        console.warn('[sdf-layer] refine view refused while the refine pass is off — setRefine(true) first');
        return;
      }
      refineView = on;
      if (!on) restoreCompositeSource();
    },
    get refineView() { return refineView; },
    setMarchJitter(offset) {
      if (offset === null) { marchJitter = null; return true; }
      if (accumOn || fieldStyle !== 'off') {
        console.warn('[sdf-layer] march jitter refused while temporal accumulation or a field style is on');
        return false;
      }
      marchJitter = [offset[0], offset[1]];
      return true;
    },
    get marchJitter() { return marchJitter; },
    get temporalAccum() {
      return {
        on: accumOn,
        alpha: uAccumAlpha.value as number,
        epoch: accumEpoch,
        frames: accumFrames,
        convergedFrames: TEMPORAL_ACCUM_CONVERGED_FRAMES,
      };
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
      if (upscale && style !== 'off') {
        console.warn(`[sdf-layer] field style '${style}' refused while the upscale stage is on (stacking is P5)`);
        return;
      }
      if (style !== 'off') marchJitter = null;
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
    setFieldCount(n) {
      // 'frame' weaves the whole assembled picture and still hardcodes two
      // fields. Refusing is the honest option: silently leaving it at 2 would
      // make `setFieldCount(4)` a no-op that reports success.
      const wanted = Math.max(2, Math.min(8, Math.floor(n)));
      if (fieldStyle === 'frame') return fieldCount;
      if (wanted === fieldCount) return fieldCount;
      fieldCount = wanted;
      uFieldCount.value = fieldCount;
      // The TARGET HEIGHT and the seam move with the divisor. Both the march
      // target and (for 'bodies') fieldMesh must move together, or the flesh and
      // the bone weave on different grids — the defect 'bodies' was fixed for.
      resize();
      return fieldCount;
    },
    get fieldCount() { return fieldCount; },
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
      upscale?.dispose();
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
      refineTarget?.dispose();
      refineViewTarget?.dispose();
    },
  };
}
