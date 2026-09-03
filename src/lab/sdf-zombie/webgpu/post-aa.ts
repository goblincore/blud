// src/lab/sdf-zombie/webgpu/post-aa.ts
//
// X1.25: PSX-friendly anti-aliasing for the SDF lab. The owner LIKES the raw
// low-res look — the chunky pixel grid must survive — but not the stair-step
// jaggies and temporal edge crawl. Three independently toggleable passes sit
// between the render chain and the canvas:
//
//   CAPTURE — sdfLayer and gooLayer get their canvas-bound passes redirected
//   (setOutputTarget) into a full-content-resolution scene target with its
//   own depth buffer, so the composite/goo depth interleaving works exactly
//   as it did against the canvas depth.
//
//   FXAA — the classic Lottes reduced kernel (5-tap luma cross, edge
//   direction, two along-edge blends) over the captured frame. It only
//   re-colours pixels it detects as edge stair-steps, so flat interiors and
//   the pixel grid itself come through untouched.
//
//   SMEAR — temporal accumulation: out = mix(current, history, smear) with a
//   ping-pong pair of history targets (never sample the target a pass
//   writes). Hides temporal edge crawl and gives the subtle PSX-video motion
//   blur the owner asked for; ghosting on fast gibs is accepted (and liked).
//
//   BLIT — the final copy to the canvas. Sharp-upscale OFF: a straight copy
//   (canvas == content size; CSS does the nearest upscale as today). Sharp
//   upscale ON: the canvas backing grows to the window and the blit does a
//   UV-snapped "sharp bilinear" — fat pixels whose BORDERS are antialiased
//   over one output pixel — instead of the CSS nearest stretch.
//
// COLOUR CHAIN (the hard constraint — see lab-main's legacy-gamma note and
// commits 12a4e40/cc63f6c). Rendering into ANY RenderTarget applies NO
// output transform: Renderer.currentColorSpace/currentToneMapping return the
// WORKING space unless isOutputTarget (verified in three r185 source). So
// the captured frame holds pre-encode values, and this module mirrors the
// canvas exactly by applying three's own transfer functions by hand:
// sRGBTransferOETF on the way IN (entry taps of the FXAA/blend/blit passes,
// so all blending happens in the display space the canvas would have
// received) and sRGBTransferEOTF in the blit on the way OUT, where the
// canvas's in-shader OETF cancels it. Same constants as
// nodes/display/ColorSpaceFunctions.js — anything else would add or remove
// an encode.
//
// ALL-OFF PARITY (the hard gate): with fxaa off, smear 0 and sharp upscale
// off, render() drops the redirect and calls the chain straight through —
// bit-identical to the pre-post-aa draw path, not a copy of it.
//
// Render-target discipline copied from sdf-layer/goo-layer: explicit first
// clear after every (re)allocation (the lazy-init same-encoder trap),
// autoClear off for the canvas blit, and the ortho quad camera at z = 1.
//
// ORIENTATION (measured on screen, X1.25b — the prior run's 'colour shift'
// was this, not an encode bug): every target-bound quad pass inverts Y
// once on this backend, so a naive chain ends up flipped whenever an ODD
// number of intermediate passes is active (fxaa-only and smear-only came
// out upside-down while fxaa+smear was accidentally upright — the flips
// cancelled — which is how it survived the first visual check). The
// invariant here: the FXAA and blend passes each flip their ENTRY
// sampling exactly once, so every target always holds the capture's
// orientation no matter how many passes ran, and the blit's flipY uniform
// then handles the single canvas boundary identically for every toggle
// combination.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { wgslFn, texture, uv, vec2, vec4, uniform } from 'three/tsl';
import { computeRenderSize, canvasCssSize } from './lab-renderer';
import { FISHEYE_WGSL, makeLens, type Lens } from './fisheye';

/** The owner-approved defaults: FXAA on, modest smear, nearest upscale. */
export const POST_AA_DEFAULTS = {
  fxaa: true,
  smear: 0.25,
  sharpUpscale: false,
} as const;

/** Panel slider ceiling — 0.6 is heavy ghosting, beyond is a smear trail. */
export const POST_AA_SMEAR_MAX = 0.6;

/**
 * The FXAA pass. Lottes' reduced kernel: a 3x3 luma cross gives the edge
 * direction, then rgbA (two taps at 1/6 along the edge either way) and rgbB
 * (wider, at ±1/2) blend along it; if rgbB's luma leaves the neighbourhood
 * range it was a false edge and rgbA stands. Every tap goes through
 * postAaOetf first — luma weights and the blend both assume display space.
 *
 * Helper fns follow the main fn: three anchors its wgslFn declaration parse
 * at ^ (the source must START with the main fn), and everything after the
 * header — body plus these helpers — is emitted verbatim at module scope,
 * where WGSL resolves forward references.
 */
export const POST_AA_FXAA_WGSL = /* wgsl */ `fn postAaFxaa(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>
) -> vec4<f32> {
  let dimsF = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(dimsF) - vec2<i32>(1, 1);
  // Entry flip: this pass's target-bound write inverts Y, so flipping the
  // sampling keeps the output in the source's orientation (the module
  // invariant — see the file header).
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let px = clamp(vec2<i32>(floor(tc * dimsF)), vec2<i32>(0, 0), maxP);

  let cM = postAaFetch(srcTex, px, maxP);
  let lumaNW = dot(postAaFetch(srcTex, px + vec2<i32>(-1, -1), maxP), vec3<f32>(0.299, 0.587, 0.114));
  let lumaNE = dot(postAaFetch(srcTex, px + vec2<i32>(1, -1), maxP), vec3<f32>(0.299, 0.587, 0.114));
  let lumaSW = dot(postAaFetch(srcTex, px + vec2<i32>(-1, 1), maxP), vec3<f32>(0.299, 0.587, 0.114));
  let lumaSE = dot(postAaFetch(srcTex, px + vec2<i32>(1, 1), maxP), vec3<f32>(0.299, 0.587, 0.114));
  let lumaM = dot(cM, vec3<f32>(0.299, 0.587, 0.114));

  let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  var dir = vec2<f32>(
    -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
    ((lumaNW + lumaSW) - (lumaNE + lumaSE))
  );
  // 1/32 of the cross sum, floored at 1/128 — the classic dirReduce.
  let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2<f32>(-8.0, -8.0), vec2<f32>(8.0, 8.0));

  let centre = vec2<f32>(px) + vec2<f32>(0.5, 0.5);
  let rgbA = 0.5 * (
    postAaBilinear(srcTex, centre + dir * (1.0 / 3.0 - 0.5), maxP) +
    postAaBilinear(srcTex, centre + dir * (2.0 / 3.0 - 0.5), maxP)
  );
  let rgbB = rgbA * 0.5 + 0.25 * (
    postAaBilinear(srcTex, centre - dir * 0.5, maxP) +
    postAaBilinear(srcTex, centre + dir * 0.5, maxP)
  );
  let lumaB = dot(rgbB, vec3<f32>(0.299, 0.587, 0.114));
  if (lumaB < lumaMin || lumaB > lumaMax) {
    return vec4<f32>(rgbA, 1.0);
  }
  return vec4<f32>(rgbB, 1.0);
}

// three's sRGBTransferOETF, mirrored exactly (ColorSpaceFunctions.js).
fn postAaOetf(c: vec3<f32>) -> vec3<f32> {
  let cc = max(c, vec3<f32>(0.0, 0.0, 0.0));
  let hi = pow(cc, vec3<f32>(0.41666, 0.41666, 0.41666)) * 1.055 - vec3<f32>(0.055, 0.055, 0.055);
  let lo = cc * 12.92;
  return select(hi, lo, cc <= vec3<f32>(0.0031308, 0.0031308, 0.0031308));
}

// A display-space texel fetch, edge-clamped.
fn postAaFetch(srcTex: texture_2d<f32>, idx: vec2<i32>, maxP: vec2<i32>) -> vec3<f32> {
  return postAaOetf(textureLoad(srcTex, clamp(idx, vec2<i32>(0, 0), maxP), 0).rgb);
}

// Bilinear fetch at a pixel-centre coordinate g (texel i covers [i, i+1)).
fn postAaBilinear(srcTex: texture_2d<f32>, g: vec2<f32>, maxP: vec2<i32>) -> vec3<f32> {
  let g2 = g - vec2<f32>(0.5, 0.5);
  let ib = vec2<i32>(floor(g2));
  let f = g2 - floor(g2);
  let i00 = clamp(ib, vec2<i32>(0, 0), maxP);
  let i11 = clamp(ib + vec2<i32>(1, 1), vec2<i32>(0, 0), maxP);
  let c00 = postAaFetch(srcTex, i00, maxP);
  let c10 = postAaFetch(srcTex, vec2<i32>(i11.x, i00.y), maxP);
  let c01 = postAaFetch(srcTex, vec2<i32>(i00.x, i11.y), maxP);
  let c11 = postAaFetch(srcTex, i11, maxP);
  return mix(mix(c00, c10, vec3<f32>(f.x)), mix(c01, c11, vec3<f32>(f.x)), vec3<f32>(f.y));
}`;

/**
 * The smear pass: out = mix(current, history, smear), both display-space.
 * cfg.x = effective smear (0 on the frame that seeds the history, so a
 * stale or freshly-allocated buffer can never ghost in), cfg.y = whether
 * the current frame arrives already display-encoded (1 after FXAA, 0 when
 * the blend is the entry pass and must encode the capture itself).
 */
export const POST_AA_BLEND_WGSL = /* wgsl */ `fn postAaBlend(
  curTex: texture_2d<f32>,
  histTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  cfg: vec2<f32>
) -> vec4<f32> {
  let dimsF = vec2<f32>(textureDimensions(curTex, 0));
  let maxP = vec2<i32>(dimsF) - vec2<i32>(1, 1);
  // Entry flip, same invariant as the FXAA pass: cur and hist always share
  // the capture's orientation, and this pass's write inverts once.
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let px = clamp(vec2<i32>(floor(tc * dimsF)), vec2<i32>(0, 0), maxP);
  var cur = textureLoad(curTex, px, 0).rgb;
  if (cfg.y < 0.5) { cur = postAaOetf(cur); }
  let hist = textureLoad(histTex, px, 0).rgb;
  return vec4<f32>(mix(cur, hist, cfg.x), 1.0);
}

fn postAaOetf(c: vec3<f32>) -> vec3<f32> {
  let cc = max(c, vec3<f32>(0.0, 0.0, 0.0));
  let hi = pow(cc, vec3<f32>(0.41666, 0.41666, 0.41666)) * 1.055 - vec3<f32>(0.055, 0.055, 0.055);
  let lo = cc * 12.92;
  return select(hi, lo, cc <= vec3<f32>(0.0031308, 0.0031308, 0.0031308));
}`;

/**
 * The canvas blit. cfg: x = flipY (canvas-boundary inversion, verified on
 * screen, uniform rather than assumed — the sdf-layer discipline), y = src
 * is display-space already, z = sharp-upscale mode. sizes.zw = the canvas
 * (destination) size in device pixels.
 *
 * Sharp mode maps each destination pixel centre into source pixel-centre
 * coordinates and re-ramps the fractional part by the magnification ratio,
 * so bilinear interpolation only happens inside a one-destination-pixel
 * band at source texel borders: fat pixels, antialiased borders, no blur.
 *
 * The output is DECODED back to working space (postAaEotf) because three
 * applies its OETF to everything bound for the canvas — the two cancel and
 * the canvas receives the display-space blend exactly (the colour-chain
 * rule in the file header).
 */
export const POST_AA_BLIT_WGSL = /* wgsl */ `fn postAaBlit(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  cfg: vec4<f32>,
  dstSize: vec2<f32>,
  lens: vec3<f32>
) -> vec4<f32> {
  var st = texCoord;
  if (cfg.x > 0.5) { st.y = 1.0 - st.y; }
  let srcDims = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(srcDims) - vec2<i32>(1, 1);
  var c: vec3<f32>;
  if (lens.x > 0.0) {
    // FISHEYE. Four rotated-grid taps a quarter of a DESTINATION pixel apart,
    // each warped independently: where the lens minifies, the warp itself
    // spreads the taps further apart in the source, so the average is a
    // prefilter that costs no Jacobian maths. Supersedes sharp mode (cfg.z),
    // whose fractional ramp assumes an axis-aligned uniform magnification the
    // warp does not provide.
    var offs: array<vec2<f32>, 4> = array<vec2<f32>, 4>(
      vec2<f32>( 0.125,  0.375), vec2<f32>( 0.375, -0.125),
      vec2<f32>(-0.125, -0.375), vec2<f32>(-0.375,  0.125));
    let texel = vec2<f32>(1.0, 1.0) / dstSize;
    var acc = vec3<f32>(0.0, 0.0, 0.0);
    for (var i: i32 = 0; i < 4; i = i + 1) {
      let warped = fisheyeWarp(st + offs[i] * texel, lens);
      let wp = clamp(vec2<i32>(floor(warped * srcDims)), vec2<i32>(0, 0), maxP);
      acc = acc + postAaFetch(srcTex, wp, cfg.y, maxP);
    }
    c = acc * 0.25;
  } else if (cfg.z > 0.5) {
    let dstPx = floor(st * dstSize);
    let g = (dstPx + vec2<f32>(0.5, 0.5)) * (srcDims / dstSize);
    let ratio = dstSize / srcDims;
    let g2 = g - vec2<f32>(0.5, 0.5);
    let ib = floor(g2);
    let fr = g2 - ib;
    let fs = clamp(
      (fr - vec2<f32>(0.5, 0.5)) * ratio + vec2<f32>(0.5, 0.5),
      vec2<f32>(0.0, 0.0),
      vec2<f32>(1.0, 1.0)
    );
    let i00 = clamp(vec2<i32>(ib), vec2<i32>(0, 0), maxP);
    let i11 = clamp(vec2<i32>(ib) + vec2<i32>(1, 1), vec2<i32>(0, 0), maxP);
    let c00 = postAaFetch(srcTex, i00, cfg.y, maxP);
    let c10 = postAaFetch(srcTex, vec2<i32>(i11.x, i00.y), cfg.y, maxP);
    let c01 = postAaFetch(srcTex, vec2<i32>(i00.x, i11.y), cfg.y, maxP);
    let c11 = postAaFetch(srcTex, i11, cfg.y, maxP);
    c = mix(mix(c00, c10, vec3<f32>(fs.x)), mix(c01, c11, vec3<f32>(fs.x)), vec3<f32>(fs.y));
  } else {
    let px = clamp(vec2<i32>(floor(st * srcDims)), vec2<i32>(0, 0), maxP);
    c = postAaFetch(srcTex, px, cfg.y, maxP);
  }
  return vec4<f32>(postAaEotf(c), 1.0);
}

fn postAaOetf(c: vec3<f32>) -> vec3<f32> {
  let cc = max(c, vec3<f32>(0.0, 0.0, 0.0));
  let hi = pow(cc, vec3<f32>(0.41666, 0.41666, 0.41666)) * 1.055 - vec3<f32>(0.055, 0.055, 0.055);
  let lo = cc * 12.92;
  return select(hi, lo, cc <= vec3<f32>(0.0031308, 0.0031308, 0.0031308));
}

// three's sRGBTransferEOTF, mirrored exactly — the inverse the canvas OETF
// cancels against.
fn postAaEotf(c: vec3<f32>) -> vec3<f32> {
  let cc = max(c, vec3<f32>(0.0, 0.0, 0.0));
  let hi = pow(cc * 0.9478672986 + vec3<f32>(0.0521327014, 0.0521327014, 0.0521327014), vec3<f32>(2.4, 2.4, 2.4));
  let lo = cc * 0.0773993808;
  return select(hi, lo, cc <= vec3<f32>(0.04045, 0.04045, 0.04045));
}

// A texel fetch that yields display space either way: raw when the source
// is already encoded (isDisplay > 0.5), OETF'd when it is the working-space
// capture.
fn postAaFetch(srcTex: texture_2d<f32>, idx: vec2<i32>, isDisplay: f32, maxP: vec2<i32>) -> vec3<f32> {
  let c = textureLoad(srcTex, clamp(idx, vec2<i32>(0, 0), maxP), 0).rgb;
  if (isDisplay > 0.5) { return c; }
  return postAaOetf(c);
}

` + FISHEYE_WGSL;

/** three 0.185 types wgslFn's result as a plain Node; this keeps the swizzles honest. */
type Swizzled = { xyz: unknown };

/** Anything whose canvas-bound passes can be redirected — sdf and goo layers. */
export interface PostAaSink {
  setOutputTarget(t: THREE.RenderTarget | null): void;
}

export interface PostAa {
  /**
   * The frame wrapper. With every effect off this is an EXACT pass-through
   * (the redirect is dropped and the chain draws to the canvas as it always
   * has) — the all-off A/B parity gate depends on it being the same code
   * path, not an equivalent one.
   */
  render(chain: () => void): void;
  /** Registers a layer whose output gets captured while any effect is on. */
  addSink(s: PostAaSink): void;
  setFxaa(on: boolean): void;
  /** Exponential history blend, 0..POST_AA_SMEAR_MAX. */
  setSmear(v: number): void;
  /**
   * Sharp-bilinear final upscale. Grows the canvas backing to the window and
   * filters texel borders in the blit; off restores the capped canvas and
   * the CSS nearest stretch (today's look).
   */
  setSharpUpscale(on: boolean): void;
  /** Console escape hatch for the canvas-boundary flip — see sdf-layer. */
  setBlitFlipY(on: boolean): void;
  readonly fxaa: boolean;
  readonly smear: number;
  readonly sharpUpscale: boolean;
  /**
   * The capped internal size everything except the final blit runs at,
   * computed fresh from the window (pure — safe to read from any resize
   * listener regardless of registration order). lab-main sizes the SDF
   * layer from this so the low-res grid never follows a sharp-mode canvas.
   */
  readonly contentSize: { width: number; height: number };
  dispose(): void;
}

export function createPostAa(renderer: THREE.WebGPURenderer): PostAa {
  let fxaaOn: boolean = POST_AA_DEFAULTS.fxaa;
  let sharpOn: boolean = POST_AA_DEFAULTS.sharpUpscale;

  // HalfFloatType on every target — measured, not speculative: the capture
  // holds WORKING-space values (no output transform off-canvas), and the
  // lab's dark background (0x1a1116) is ~0.01 in linear, which unorm8
  // resolves to TWO counts — the encode round-trip then shifts every dark
  // pixel by ~8 display levels (background read back as 34,22,22 instead of
  // 26,17,22). Half float keeps the dark end exact, and rgba16float is the
  // one float format WebGPU guarantees blendable (the polygonal pass blends
  // blood billboards into sceneTarget). The single 8-bit quantisation still
  // happens exactly where it did before: at the canvas, post-encode.
  const sceneTarget = new THREE.RenderTarget(1, 1, {
    depthBuffer: true,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const passOpts = {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  } as const;
  const fxaaTarget = new THREE.RenderTarget(1, 1, passOpts);
  // The history ping-pong: each frame's blend reads one and writes the
  // other, so no pass ever samples a target written in its own scope.
  const histA = new THREE.RenderTarget(1, 1, passOpts);
  const histB = new THREE.RenderTarget(1, 1, passOpts);

  // The single canvas-boundary flip. Stays a uniform as a console escape
  // hatch (setBlitFlipY) — the intermediate passes flip their own sampling
  // so this is correct for every toggle combination at 1.
  const uFlipY = uniform(1);
  const uSmear = uniform(POST_AA_DEFAULTS.smear);
  // x = effective smear, y = current frame arrives display-encoded.
  const uBlendCfg = uniform(new THREE.Vector2(0, 0));
  // x = flipY, y = src is display-space, z = sharp mode, w = spare.
  const uBlitCfg = uniform(new THREE.Vector4(1, 0, 0, 0));
  const uBlitDst = uniform(new THREE.Vector2(1, 1));

  // One quad scene per pass, the sdf-layer shape: ortho camera at z = 1 so
  // the plane at z = 0 sits inside [0, 1] rather than on the near plane.
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  quadCam.position.z = 1;

  function quadScene(mat: MeshBasicNodeMaterial): THREE.Scene {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(q);
    return s;
  }

  // The blend's cur/hist and the blit's src vary per frame (FXAA crossing,
  // history ping-pong), and a texture binding is baked per material — so
  // these nodes are created once and their .value is swapped before the
  // pass. Same number of materials as a static wiring, no render-list churn.
  const blendCurTex = texture(sceneTarget.texture);
  const blendHistTex = texture(histA.texture);
  const blitSrcTex = texture(sceneTarget.texture);

  const fxaaOut = wgslFn(POST_AA_FXAA_WGSL)({
    srcTex: texture(sceneTarget.texture),
    texCoord: uv(),
  }) as unknown as Swizzled;
  const fxaaMat = new MeshBasicNodeMaterial();
  fxaaMat.colorNode = vec4(fxaaOut.xyz as never, 1.0);
  fxaaMat.depthWrite = false;
  fxaaMat.depthTest = false;
  fxaaMat.fog = false;
  const fxaaScene = quadScene(fxaaMat);

  const blendOut = wgslFn(POST_AA_BLEND_WGSL)({
    curTex: blendCurTex,
    histTex: blendHistTex,
    texCoord: uv(),
    cfg: uBlendCfg,
  }) as unknown as Swizzled;
  const blendMat = new MeshBasicNodeMaterial();
  blendMat.colorNode = vec4(blendOut.xyz as never, 1.0);
  blendMat.depthWrite = false;
  blendMat.depthTest = false;
  blendMat.fog = false;
  const blendScene = quadScene(blendMat);

  const blitOut = wgslFn(POST_AA_BLIT_WGSL)({
    srcTex: blitSrcTex,
    texCoord: uv(),
    cfg: uBlitCfg,
    dstSize: uBlitDst,
  }) as unknown as Swizzled;
  const blitMat = new MeshBasicNodeMaterial();
  blitMat.colorNode = vec4(blitOut.xyz as never, 1.0);
  blitMat.depthWrite = false;
  blitMat.depthTest = false;
  blitMat.fog = false;
  const blitScene = quadScene(blitMat);

  const sinks: PostAaSink[] = [];
  let redirected = false;
  /** The history buffer the next frame's blend READS (the other is written). */
  let histRead = histA;
  let histWrite = histB;
  /** False while the history holds a stale/garbage frame — seeds at smear 0. */
  let historyValid = false;
  /** Explicit first clear after every (re)allocation — the lazy-init trap. */
  let targetsNeedInit = true;
  const emptyScene = new THREE.Scene();
  const drawSize = new THREE.Vector2();

  function refit() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const content = computeRenderSize(winW, winH);
    const el = renderer.domElement;
    if (sharpOn) {
      // The blit upscales in-shader, so the canvas backing is the window and
      // the CSS stretch becomes 1:1 — 'pixelated' would fight the filter.
      // NOTE: under a 'fixed' (4:3) cap the blit stretches to the whole
      // window and so breaks the letterbox aspect — sharp mode is a lab
      // toggle; the game page does not use it.
      renderer.setSize(winW, winH, false);
      el.style.imageRendering = 'auto';
    } else {
      // Mirrors lab-renderer's resize(): capped backing, CSS nearest stretch,
      // letterboxed under a 'fixed' cap.
      renderer.setSize(content.width, content.height, false);
      el.style.imageRendering = 'pixelated';
    }
    const css = canvasCssSize(winW, winH);
    const cssW = sharpOn ? winW : css.width;
    const cssH = sharpOn ? winH : css.height;
    el.style.position = 'absolute';
    el.style.left = (sharpOn ? 0 : css.left) + 'px';
    el.style.top = (sharpOn ? 0 : css.top) + 'px';
    el.style.width = cssW + 'px';
    el.style.height = cssH + 'px';
    sceneTarget.setSize(content.width, content.height);
    fxaaTarget.setSize(content.width, content.height);
    histA.setSize(content.width, content.height);
    histB.setSize(content.width, content.height);
    // setSize reallocates the backing textures: uninitialised again, and the
    // old history is the wrong size besides.
    targetsNeedInit = true;
    historyValid = false;
  }
  refit();
  // Registered AFTER lab-renderer's own resize listener (this is created
  // later), so the sharp-mode canvas override always lands last.
  window.addEventListener('resize', refit);

  return {
    render(chain) {
      const smear = uSmear.value;
      const active = fxaaOn || smear > 0 || sharpOn;
      if (!active) {
        // The parity path: hand the canvas straight back to the chain.
        if (redirected) {
          for (const s of sinks) s.setOutputTarget(null);
          redirected = false;
        }
        historyValid = false;
        chain();
        return;
      }
      if (!redirected) {
        for (const s of sinks) s.setOutputTarget(sceneTarget);
        redirected = true;
      }
      if (targetsNeedInit) {
        targetsNeedInit = false;
        for (const t of [sceneTarget, fxaaTarget, histA, histB]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, quadCam);
        }
      }

      // The whole polygon/sdf/cone/occluder/composite/goo flow, captured.
      chain();

      // FXAA: capture (working space) -> fxaaTarget (display space).
      let src = sceneTarget;
      let srcIsDisplay = false;
      if (fxaaOn) {
        renderer.setRenderTarget(fxaaTarget);
        void renderer.render(fxaaScene, quadCam);
        src = fxaaTarget;
        srcIsDisplay = true;
      }

      // Smear: mix into the write half of the ping-pong, then swap so the
      // next frame reads what this frame produced.
      if (smear > 0) {
        blendCurTex.value = src.texture;
        blendHistTex.value = histRead.texture;
        uBlendCfg.value.set(historyValid ? smear : 0, srcIsDisplay ? 1 : 0);
        renderer.setRenderTarget(histWrite);
        void renderer.render(blendScene, quadCam);
        const t = histRead;
        histRead = histWrite;
        histWrite = t;
        historyValid = true;
        src = histRead;
        srcIsDisplay = true;
      } else {
        // A smear-less stretch leaves the history stale — re-seed on return.
        historyValid = false;
      }

      // Blit to the canvas: copy, or the sharp-bilinear upscale when the
      // canvas backing is the window. autoClear off — every pixel is
      // covered, and a clear would only risk wiping what came before.
      blitSrcTex.value = src.texture;
      renderer.getDrawingBufferSize(drawSize);
      uBlitCfg.value.set(uFlipY.value, srcIsDisplay ? 1 : 0, sharpOn ? 1 : 0, 0);
      uBlitDst.value.set(drawSize.x, drawSize.y);
      renderer.setRenderTarget(null);
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      void renderer.render(blitScene, quadCam);
      renderer.autoClear = prevAutoClear;
    },
    addSink(s) {
      sinks.push(s);
      // A sink registered AFTER the first redirect must be handed the current
      // state immediately. The redirect above only fires on the TRANSITION
      // (`if (!redirected)`), so without this a late sink keeps its output on
      // the canvas while every other pass renders into sceneTarget — and the
      // blit at the end of this frame then paints sceneTarget over the canvas,
      // erasing whatever the late sink drew. Every frame. Silently.
      //
      // This is exactly what hid the goo layer on the game page: game-main
      // awaits the gun GLB between addSink(sdfLayer) and addSink(gooLayer), so
      // frames render (and redirect) during that await and the goo was added
      // afterwards. It also explains why toggling fxaa/smear appeared to
      // "fix" it — a toggle flips `redirected` and re-runs the loop above.
      if (redirected) s.setOutputTarget(sceneTarget);
    },
    setFxaa(on) { fxaaOn = on; },
    setSmear(v) { uSmear.value = Math.max(0, Math.min(POST_AA_SMEAR_MAX, v)); },
    setSharpUpscale(on) {
      if (on === sharpOn) return;
      sharpOn = on;
      refit();
    },
    setBlitFlipY(on) { uFlipY.value = on ? 1 : 0; },
    get fxaa() { return fxaaOn; },
    get smear() { return uSmear.value; },
    get sharpUpscale() { return sharpOn; },
    get contentSize() {
      return computeRenderSize(window.innerWidth, window.innerHeight);
    },
    dispose() {
      window.removeEventListener('resize', refit);
      sceneTarget.dispose();
      fxaaTarget.dispose();
      histA.dispose();
      histB.dispose();
      fxaaMat.dispose();
      blendMat.dispose();
      blitMat.dispose();
    },
  };
}
