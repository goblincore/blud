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
//   VHS — the club-mutant soft pipeline ported to WGSL (post-vhs.ts), default
//   OFF. While a preset is active it runs AFTER FXAA and REPLACES smear: it
//   owns temporal blending (effective smear 0) but the user's smear SETTING is
//   preserved, so turning it off restores today's look exactly. It reads a
//   DEDICATED input ping-pong (the previous INPUT, never its own output — the
//   motion gate would otherwise latch on the previous frame's chroma split).
//   The pair is LinearFilter because POST_VHS_WGSL samples with textureSample
//   and three emits no sampler for a nearest/nearest target; the smear pair
//   stays NearestFilter and is not reused.
//
//   GLOW — bright-pass + separable blur (post-glow.ts), default OFF (the
//   flame lab enables it while its tuning's glowGain is up). Two draws run
//   BEFORE FXAA on the raw capture: the extract thresholds WORKING-space
//   luminance and blurs along x into a half-size LinearFilter target, then a
//   second draw blurs along y and is ADDED back into the capture with
//   additive blending — glow is never added after display encoding (the
//   colour-chain rule below). The pair is LinearFilter, not nearest, for the
//   same hard binding reason as the VHS input pair: three emits no sampler
//   for a nearest/nearest target and the y-blur samples with textureSample.
//
//   SSCS — screen-space contact shadows (post-sscs.ts), default OFF at the
//   factory and default ON on the game page (?sscs=off). Runs BEFORE FXAA on
//   the raw capture: each level pixel marches a short ray toward the
//   flashlight through the capture's DepthTexture (sceneTarget gained a
//   sampleable one — the fieldFull precedent) and darkens where the ray is
//   blocked, so the contact shadow matches the rendered silhouette exactly.
//   Marched flesh is excluded via the march target's depth-in-alpha, fed by
//   the host (setSscsFleshTex + setSscsFrame). Legacy path only.
//
//   BLIT — the final copy to the canvas. Sharp-upscale OFF: a straight copy
//   (canvas == content size; CSS does the nearest upscale as today). Sharp
//   upscale ON: the canvas backing grows to the window and the blit does a
//   UV-snapped "sharp bilinear" — fat pixels whose BORDERS are antialiased
//   over one output pixel — instead of the CSS nearest stretch. Fisheye ON
//   (lens.x > 0): supersedes sharp upscale, a 4-tap prefiltered radial warp
//   reading FISHEYE_WGSL's map — see fisheye.ts.
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
// ALL-OFF PARITY (the hard gate): with fxaa off, smear 0, sharp upscale off
// and VHS off (the default), render() drops the redirect and calls the chain
// straight through — bit-identical to the pre-post-aa draw path, not a copy
// of it. The VHS material is never bound on that path.
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
import { wgslFn, texture, texture3D, storage, uv, vec2, vec4, uniform } from 'three/tsl';
import { computeRenderSize, canvasCssSize } from './lab-renderer';
import { FISHEYE_WGSL, makeLens, type Lens } from './fisheye';
import { setPassLabel } from './gpu-pass-timing';
import type { Vec3 } from '../types';
import {
  BLAST_REFRACTION, blastRefractionPhase, projectBlastRefraction,
} from '../blast-refraction';
import {
  POST_VHS_WGSL,
  VHS_PRESETS,
  effectiveSmear as vhsEffectiveSmear,
  type VhsPreset,
  type VhsTerms,
} from './post-vhs';
import { POST_GLOW_EXTRACT_WGSL, POST_GLOW_BLUR_WGSL } from './post-glow';
import {
  POST_SSCS_WGSL,
  SSCS_DEFAULTS,
  SSCS_TERM_RANGES,
  type SscsTerms,
} from './post-sscs';
import { POST_TONGUES_WGSL, type TongueFrame } from './post-tongues';
import {
  FIRE_VOLUME_MARCH_WGSL, FIRE_VOLUME_RESOLVE_WGSL, FIRE_VOLUME_COMPOSITE_WGSL,
  type FireVolumeFrame,
} from './fire-volume.wgsl';
import { getCurlTexture } from './curl-volume-node';
import {
  FIRE_CAPSULE_STRIDE, FIRE_VOLUME_MAX_CAPSULES,
} from './fire-volume-pack';

/** The owner-approved defaults: FXAA on, modest smear, nearest upscale. */
export const POST_AA_DEFAULTS = {
  fxaa: true,
  smear: 0.25,
  sharpUpscale: false,
} as const;

/** Panel slider ceiling — 0.6 is heavy ghosting, beyond is a smear trail. */
export const POST_AA_SMEAR_MAX = 0.6;

/**
 * The club-mutant slider ranges, copied from SoftPostFxPipeline.ts's setters
 * (the port's source of truth). `setVhsTerm` clamps to these so a console
 * override can never push a term outside what the source pipeline accepted.
 */
export const VHS_TERM_RANGES: Record<keyof VhsTerms, readonly [number, number]> = {
  intensity: [0, 1],
  blurAmount: [0, 1],
  noiseAmount: [0, 0.25],
  gradeAmount: [0, 1],
  warpAmount: [0, 20],
  warpFrequency: [0, 20],
  warpSpeed: [0, 5],
  chromaAmount: [0, 10],
  chromaJitter: [0, 10],
  motionThreshold: [0, 1],
  chromaBurstChance: [0, 1],
  chromaBurstStrength: [0, 2],
  chromaBurstRate: [0, 60],
};

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
 * The VHS input-history copy: a RAW texel copy of the current chain source
 * (the FXAA output, or the capture when FXAA is off) into the VHS input
 * ping-pong. Raw — no OETF — because POST_VHS_WGSL's own `isDisplay` flag
 * decides whether a tap needs encoding; the pair must hold exactly what the
 * source held. textureLoad like its siblings (integer fetches, no sampler),
 * entry-flipped so the pair keeps the capture orientation every target does.
 */
export const POST_AA_COPY_WGSL = /* wgsl */ `fn postAaCopy(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>
) -> vec4<f32> {
  let dimsF = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(dimsF) - vec2<i32>(1, 1);
  // Entry flip, the module invariant (see the file header).
  let tc = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
  let px = clamp(vec2<i32>(floor(tc * dimsF)), vec2<i32>(0, 0), maxP);
  return vec4<f32>(textureLoad(srcTex, px, 0).rgb, 1.0);
}`;

/**
 * The canvas blit. cfg: x = flipY (canvas-boundary inversion, verified on
 * screen, uniform rather than assumed — the sdf-layer discipline), y = src
 * is display-space already, z = sharp-upscale mode. sizes.zw = the canvas
 * (destination) size in device pixels. lens = (k, rmax, aspect), the radial
 * fisheye map — see fisheye.ts for the definition; k = 0 is the off switch.
 *
 * Sharp mode maps each destination pixel centre into source pixel-centre
 * coordinates and re-ramps the fractional part by the magnification ratio,
 * so bilinear interpolation only happens inside a one-destination-pixel
 * band at source texel borders: fat pixels, antialiased borders, no blur.
 *
 * Fisheye mode (lens.x > 0) supersedes sharp mode rather than stacking with
 * it — see the branch's own comment below for why.
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
  lens: vec3<f32>,
  d0: vec4<f32>,
  d1: vec4<f32>,
  d2: vec4<f32>,
  d3: vec4<f32>,
  dist: vec4<f32>,
  heatTex: texture_2d<f32>,
  heatSamp: sampler,
  heat: vec4<f32>
) -> vec4<f32> {
  // BLAST REFRACTION (bounded, see postAaBlastWarp): applied to the OUTPUT
  // texCoord BEFORE the entry flip, so the ring is centred on the blast's
  // projected screen position rather than its mirror image. It composes with
  // whichever final filter is active and costs one extra loop of uniforms.
  // Inert unless the host pushes a blast and the strength gate is on, so the
  // all-off parity path is untouched.
  var st = postAaBlastWarp(texCoord, d0, d1, d2, d3, dist);
  // HEAT SHIMMER (heat.w on, heat.x = amplitude in UV, heat.y = time, heat.z = rise
  // band in UV): animated noise warp where the flame buffer is opaque, and in a band
  // ABOVE it (the mask samples below the pixel — hot air rises). The flame buffer is
  // indexed in the capture orientation, (x, 1 - y) of this texCoord.
  if (heat.w > 0.5 && heat.x > 0.0) {
    let ft = vec2<f32>(texCoord.x, 1.0 - texCoord.y);
    var m = 0.0;
    for (var k: i32 = 0; k < 4; k = k + 1) {
      let a = textureSampleLevel(heatTex, heatSamp, ft + vec2<f32>(0.0, f32(k) * heat.z / 3.0), 0.0).a;
      m = max(m, (1.0 - a) * (1.0 - 0.2 * f32(k)));
    }
    m = clamp(m * 1.5, 0.0, 1.0);
    let tt = heat.y;
    let nz = vec2<f32>(
      sin(ft.y * 90.0 - tt * 11.0 + sin(ft.x * 37.0 + tt * 3.0) * 2.0),
      cos(ft.x * 70.0 + tt * 8.0 + sin(ft.y * 53.0 - tt * 5.0) * 2.0));
    st = st + nz * (heat.x * m);
  }
  if (cfg.x > 0.5) { st.y = 1.0 - st.y; }
  let srcDims = vec2<f32>(textureDimensions(srcTex, 0));
  let maxP = vec2<i32>(srcDims) - vec2<i32>(1, 1);
  var c: vec3<f32>;
  if (lens.x > 0.0) {
    // FISHEYE. Pinning the corner (see fisheye.ts) minifies the periphery
    // ~2x, and a single point fetch out there shimmers — so this branch
    // prefilters with four rotated-grid taps a quarter of a DESTINATION
    // pixel apart, each warped INDEPENDENTLY (offset applied before the
    // warp, not after): where the lens minifies, the warp itself spreads
    // the taps further apart in the source, so the average is a prefilter
    // that costs no Jacobian maths. 0.125/0.375 is the standard rotated-grid
    // set — its four samples land on four distinct positions on BOTH axes,
    // which a tidier 0.25-spaced box would collapse to two. Supersedes
    // sharp mode (cfg.z), whose fractional ramp assumes an axis-aligned
    // uniform magnification the warp does not provide.
    //
    // offs is a var, not a let: WGSL only allows a dynamic (loop-variable)
    // index on a reference.
    var offs: array<vec2<f32>, 4> = array<vec2<f32>, 4>(
      vec2<f32>( 0.125,  0.375), vec2<f32>( 0.375, -0.125),
      vec2<f32>(-0.125, -0.375), vec2<f32>(-0.375,  0.125));
    let dstPxUv = vec2<f32>(1.0, 1.0) / dstSize;
    var acc = vec3<f32>(0.0, 0.0, 0.0);
    for (var i: i32 = 0; i < 4; i = i + 1) {
      let warped = fisheyeWarp(st + offs[i] * dstPxUv, lens);
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

/**
 * THE BOUNDED BLAST REFRACTION. A brief, localized, expanding screen-space
 * displacement centred on a blast's projected position: at radius r inside the
 * blast's screen radius the sampled coordinate is pushed radially so the image
 * REFRACTS through the shell instead of the explosion just adding a static
 * bloom ring.
 *
 * WHERE THE WAVE COMES FROM. blast-refraction.ts owns the world radius, its
 * growth over the life, the decay and the projection; the host reprojects every
 * frame and fills b.xy/b.z/b.w with the CURRENT centre, radius and
 * strength. This function therefore only draws the radial waveform, and the
 * waveform is deliberately BROAD: sin^2 has its half-maximum spanning a
 * quarter of the band on either side, where the old sin^4 shell dropped to a
 * quarter of its peak an eighth of the way in and bent almost nothing.
 *
 * BOUNDS, all enforced here as well as at the feed:
 *   * at most FOUR simultaneous blasts, unrolled (d0..d3) — no array indexing
 *     and no per-blast pipeline, so a burst of blasts cannot grow the shader or
 *     the render list;
 *   * the summed offset is clamped to dist.y UV (a few percent of the screen),
 *     so a near-camera blast cannot smear the frame or invert it;
 *   * the profile is a ring, zero at the blast centre and at the outer front,
 *     with an outward visual bulge across the moving band;
 *   * the whole pass is inert (dist.w < 0.5 or no blasts) and only touches
 *     uniforms — toggling it never rebuilds this pipeline or moves a node key.
 *
 * LIMIT (honest): this reads only the colour chain, not scene depth, so a wall
 * between the camera and the blast is still warped. A partially occluded blast
 * is not depth-gated. See the dev-note for why a depth-gated version is a
 * renderer change rather than a bounded experiment.
 */
fn postAaBlastWarp(
  uvIn: vec2<f32>,
  d0: vec4<f32>,
  d1: vec4<f32>,
  d2: vec4<f32>,
  d3: vec4<f32>,
  dist: vec4<f32>
) -> vec2<f32> {
  if (dist.w < 0.5 || dist.x < 0.5) { return uvIn; }
  let aspect = max(0.0001, dist.z);
  var off = vec2<f32>(0.0, 0.0);
  for (var i: i32 = 0; i < 4; i = i + 1) {
    if (f32(i) + 0.5 > dist.x) { break; }
    var b = d3;
    if (i == 0) { b = d0; } else if (i == 1) { b = d1; } else if (i == 2) { b = d2; }
    if (b.w <= 0.0 || b.z <= 0.0) { continue; }
    var d = uvIn - b.xy;
    d.x = d.x * aspect;
    let r = length(d);
    if (r < 1e-5 || r >= b.z) { continue; }
    let t = 1.0 - r / b.z;
    // A BROAD SHELL: the displacement is zero at the centre and at the front
    // and peaks across the middle of the band. sin^2 (mirrored by
    // blastRefractionBand in blast-refraction.ts — keep them in step) is the
    // wide profile; the previous sin^4 fell off far faster.
    let s = sin(3.14159265 * t);
    let ring = s * s;
    var dir = d / r;
    dir.x = dir.x / aspect;
    off = off + dir * (ring * b.w);
  }
  let l = length(off);
  if (l > dist.y) { off = off * (dist.y / l); }
  // This is an inverse texture lookup: sampling inward moves the visible
  // image outward. Adding off instead made the blast look like suction.
  return uvIn - off;
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

/**
 * A stage that composites the freshly captured scene BEFORE the post chain
 * grades it (selective shutter blur, game integration 2026-09-17). It receives
 * the capture target (colour + its sampleable depth) and returns the target
 * the remaining chain should read, or null to leave the capture in place.
 * Running it here — not on the final display-encoded image — is what keeps the
 * accepted SSCS → FXAA → VHS → lens/blast-distortion ordering intact.
 */
export type PostAaCaptureStage = (capture: THREE.RenderTarget) => THREE.RenderTarget | null;

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
  /**
   * The capture target the chain draws into while redirected, with the
   * sampleable depth the capture stage and SSCS read. Exposed so a capture
   * stage can PREWARM its own targets/pipelines against the real texture at
   * boot instead of paying the allocation + compile on the first live frame
   * (the shutter layer's first-use stall, measured 2026-09-17). The object
   * identity is stable; refit() resizes it in place.
   */
  readonly captureTarget: THREE.RenderTarget;
  /**
   * PRE-POST CAPTURE STAGE. While set, the chain is always captured (the
   * redirect is forced even with every effect off) and this runs on the
   * capture before SSCS/FXAA/VHS. Null (the default) is the shipped chain.
   * This is the seam the shutter integration uses; it never re-renders the
   * scene and never samples the texture it is writing.
   */
  setCaptureStage(fn: PostAaCaptureStage | null): void;
  setFxaa(on: boolean): void;
  /** Exponential history blend, 0..POST_AA_SMEAR_MAX. */
  setSmear(v: number): void;
  /**
   * The VHS stage, default OFF. While on it runs AFTER FXAA (or as the entry
   * pass if FXAA is off) and REPLACES the smear pass — it owns temporal
   * blending, so the chain's effective smear is 0. The user's smear SETTING is
   * preserved, so setVhs(null) restores today's look exactly.
   */
  setVhs(preset: VhsPreset | null): void;
  /** A live term override, clamped to VHS_TERM_RANGES. */
  setVhsTerm(name: keyof VhsTerms, value: number): void;
  /**
   * FREEZE THE VHS TIME (deterministic demo recordings, 2026-09-10).
   *
   * VHS is the single most stateful stage in the chain, in two independent
   * ways, and both are hostile to a reproducible frame:
   *
   *   1. It OWNS temporal blending (post-vhs.ts: the motion gate reads the
   *      PREVIOUS frame's VHS output as `vhsPrevTex`, and smear is suppressed
   *      to 0 while it is on), so its output is a function of how many frames
   *      preceded it, not of the frame itself.
   *   2. Its `time` drives `floor(time * 60)`, `floor(time * 24)` and
   *      `floor(time * chromaBurstRate)` row-noise hashes, so those hashes
   *      change 60/24/rate times a second.
   *
   * The clock was already wall-clock ON PURPOSE (see the update site), and a
   * recorder was pinning it by overwriting `performance.now` in the page — a
   * blunt instrument that also freezes anything ELSE reading the clock. This
   * seam freezes exactly this uniform. It does NOT remove mechanism 1: VHS
   * keeps its history, so a VHS pass in the chain still makes the COMPOSITED
   * frame path-dependent. That is why the frame hash measures the march target
   * rather than the presented image; freezing the time is a prerequisite for
   * ever extending it, not a substitute.
   */
  setTimeFrozen(on: boolean): void;
  /**
   * The SSCS stage (post-sscs.ts) — screen-space contact shadows occluded
   * against the capture's own depth. Default OFF here; the game page owns
   * the default-on decision because the stage is legacy-path-only (its flesh
   * mask is the legacy march target). Runs before FXAA; the all-off parity
   * path never binds it.
   */
  setSscs(on: boolean): void;
  /** Points the flesh mask at a texture (the legacy march target). */
  setSscsFleshTex(t: THREE.Texture): void;
  /** Per-frame matrices + flashlight feed — see the implementation note. */
  setSscsFrame(camera: THREE.PerspectiveCamera, lightPos: THREE.Vector3): void;
  /** A live term override, clamped to SSCS_TERM_RANGES. */
  setSscsTerm(name: keyof SscsTerms, value: number): void;
  /** Whether the SSCS stage runs. */
  readonly sscs: boolean;
  /**
   * THE SCREEN-SPACE TONGUE PASS (flame-tongues task 2, post-tongues.ts),
   * default OFF. Runs FIRST of the post passes — right after the chain's
   * capture and BEFORE the shutter capture stage and the glow extract — so
   * tongues are both shutter-blurred and bloomed like everything else in
   * the frame. It shapes into its own target (it samples the capture's depth,
   * which cannot be a binding while the capture is the render target) and an
   * additive composite lands it in the capture; off never binds the material
   * and the all-off parity path stays exact.
   *
   * The per-frame feed is the whole state: stepPx (tonguePixelLength / taps,
   * host-computed at the body's depth), camera near/far/fovTan, the body
   * distance, the tuning record and the projected world-up in pixels.
   */
  setTongues(on: boolean, uniforms?: TongueFrame): void;
  /** Points the tongue pass at the march's burn-mask attachment (sdf-layer's
   *  `marchBurn`), exactly once at host boot — the sscsFleshTex discipline
   *  (a second texture() node over one texture would collapse into one
   *  binding a later .value write cannot split). Null restores the inert
   *  fallback. */
  setBurnMaskTexture(tex: THREE.Texture | null): void;
  /**
   * THE VOLUMETRIC FIRE + SMOKE PASS (burning-feedback round 2, task 4c),
   * default OFF. Same seam as the tongues: after the chain's capture and
   * BEFORE the shutter capture stage and the glow extract, so fire is both
   * shutter-blurred and bloomed like everything else. Four draws: a low-res
   * march (samples the capture's depth, writes its own target), a full-res
   * resolve with temporal reprojection, a composite (`scene * T + emission`)
   * into its own target, then a raw copy back into the capture. Off never
   * binds a material, so the all-off parity path stays exact.
   *
   * The per-frame record is the whole state (see FireVolumeFrame); the packed
   * capsule storage is fed separately by `setFireVolumeData` so the host can
   * reuse one Float32Array.
   */
  setFireVolume(on: boolean, frame?: FireVolumeFrame): void;
  /** Copy the packed capsules (packFireVolume's `data`) into the storage
   *  buffer's owned array and flag it for upload. */
  setFireVolumeData(buf: Float32Array): void;
  /**
   * THE GLOW STAGE (post-glow.ts), default OFF — the flame lab enables it
   * while its tuning's glowGain is above zero. Bright-pass + separable blur
   * off the working-space capture, added back into it BEFORE FXAA, so glow
   * is never added after display encoding (the colour-chain rule). Two quad
   * draws into one half-size pair; no chain stages are reordered and the
   * all-off parity path never binds either glow material.
   */
  setGlow(on: boolean, gain?: number, threshold?: number): void;
  /** The live SSCS terms (the defaults, until setSscsTerm overrides one). */
  readonly sscsTerms: SscsTerms;
  /**
   * Sharp-bilinear final upscale. Grows the canvas backing to the window and
   * filters texel borders in the blit; off restores the capped canvas and
   * the CSS nearest stretch (today's look).
   */
  setSharpUpscale(on: boolean): void;
  /** Console escape hatch for the canvas-boundary flip — see sdf-layer. */
  setBlitFlipY(on: boolean): void;
  /**
   * The fisheye. Both arguments are VERTICAL degrees: what the camera renders,
   * and what the middle of the screen should read as. A centre FOV that is not
   * narrower than the render FOV turns the lens off exactly (k = 0), and the
   * all-off parity path then still applies.
   */
  setLens(renderFovDeg: number, centerFovDeg: number): void;
  /** The lens resolved against the live content aspect. `k = 0` = off. */
  readonly lens: Lens;
  /**
   * BLAST REFRACTION — a bounded screen-space distortion folded into the final
   * blit, explicitly an EXPERIMENT (default OFF; the game page owns the
   * `?blastdistort=` decision and the A/B). `pushBlastDistort` records a blast
   * in a bounded (4) ring by its WORLD position and birth shell radius;
   * `setBlastDistortCamera` hands over the camera so every live band is
   * REPROJECTED each frame (a camera that moves during the ~0.55 s life keeps
   * the band on the blast); `stepBlastDistort` ages it on SIM time (never wall
   * time) so a frozen capture is deterministic. There is no per-blast pipeline
   * and no additional render target: four vec4 uniforms and one loop.
   *
   * The radius growth and the decay are computed in blast-refraction.ts, not
   * in the shader, which is what makes them testable and what keeps the band
   * sounding like a wave. The shader draws only the radial waveform.
   */
  setBlastDistort(on: boolean): void;
  /** Global strength multiplier for the experiment (default 1). */
  setBlastDistortStrength(v: number): void;
  /**
   * Record a blast at a WORLD position with the world radius its shell is born
   * at and the peak UV offset it would apply. Non-finite worlds, a
   * non-positive radius or a non-positive strength are dropped. Off-screen and
   * behind-camera blasts are dropped at projection time (the camera may not
   * exist yet when a blast is pushed).
   */
  pushBlastDistort(world: readonly [number, number, number], birthRadiusM: number, strength: number): void;
  /**
   * A burning body's heat band. Same four slots as the blast warp, but the
   * radius does not expand and the strength comes from burn, not from age.
   *
   * Entries live exactly ONE resolve: the feed re-pushes every frame while a
   * body burns (the light uniforms' discipline — per-frame state, aged by
   * nobody), render() consumes them against that frame's camera, and the
   * list returns to blasts-only for `stepBlastDistort` aging. While the warp
   * is off the entries sit in the bounded ring until the next resolve, so
   * enabling the warp mid-burn lights the band on the same frame. Bounded:
   * when a frame's pushes exceed the four unrolled slots together with the
   * live blasts, the STRONGEST sources survive (unlike the blast push, which
   * drops the oldest — "oldest" carries no meaning for a per-frame feed).
   */
  pushBurnDistort(world: Vec3, radiusM: number, strength: number): void;
  /**
   * The camera the live bands are reprojected against. Called once with the
   * page's persistent camera; without it the pass stays inert (a blast with no
   * camera cannot be placed on screen).
   */
  setBlastDistortCamera(camera: THREE.PerspectiveCamera): void;
  /** Age every live blast by the SIM tick's dt (not wall time). */
  stepBlastDistort(dt: number): void;
  /** How many blasts the bounded ring is currently holding (telemetry). */
  readonly blastDistortCount: number;
  /**
   * The RESOLVED slots the last blit actually pushed, one entry per live blast
   * (task-2 review seam). A blast can be live yet unresolved — behind the
   * camera, off-screen, or with the phase spent — and those two states project
   * very differently, so the raw `u`/`v`/`radiusUv`/`strength` values are what
   * a capture rig reads to prove the band is centred on the blast rather than
   * mirrored or drifting. `u`/`v`/`radiusUv` are null when dropped; `reason`
   * says why. Read-only, no allocation when nothing is live.
   */
  readonly blastDistortSlots: readonly {
    world: readonly [number, number, number];
    age: number;
    radiusScale: number;
    decay: number;
    u: number | null;
    v: number | null;
    radiusUv: number | null;
    strength: number;
    reason: 'ok' | 'behind' | 'offscreen' | 'spent';
  }[];
  readonly blastDistort: boolean;
  readonly blastDistortStrength: number;
  readonly fxaa: boolean;
  readonly smear: number;
  /** The active preset, or null while the VHS stage is off (the default). */
  readonly vhs: VhsPreset | null;
  /** The live term values (the preset's, until setVhsTerm overrides one). */
  readonly vhsTerms: VhsTerms;
  /** 0 while VHS owns temporal blending, the user's smear setting otherwise. */
  readonly effectiveSmear: number;
  /** Whether the last blit read a display-encoded source (diagnostic). */
  readonly blitSrcIsDisplay: boolean;
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
  // SAMPLEABLE scene depth for the SSCS stage — a plain depthBuffer is an
  // attachment, not a texture (the fieldFull precedent in sdf-layer.ts, which
  // documents exactly this). Textures.updateRenderTarget resizes a user
  // DepthTexture alongside the target, so refit() needs no extra handling.
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
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

  // --- VHS stage (default OFF) -----------------------------------------
  // The VHS INPUT history is a SECOND ping-pong pair, deliberately NOT
  // histA/histB. The VHS motion gate compares the current frame against the
  // previous INPUT; if prevTex were the pass's own output, the previous
  // frame's chroma split alone would exceed motionThreshold near every edge
  // and latch the gate on. The pair is LinearFilter rather than the smear
  // pair's NearestFilter, for a hard binding reason: three refuses to emit a
  // `<tex>_sampler` for a nearest/nearest target (WGSLNodeBuilder
  // .isUnfilterable), and POST_VHS_WGSL samples with textureSample at
  // sub-texel warp/chroma offsets — exactly the Phaser source's default
  // linear sampler. rgba16float is filterable in WebGPU, so the sampler is
  // valid. `vhsTarget` is the pass's output; the blit reads it with
  // textureLoad, so its nearest filter is irrelevant.
  const vhsPairOpts = {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  } as const;
  const vhsInA = new THREE.RenderTarget(1, 1, vhsPairOpts);
  const vhsInB = new THREE.RenderTarget(1, 1, vhsPairOpts);
  const vhsTarget = new THREE.RenderTarget(1, 1, passOpts);
  // SSCS output. Colour-only like the VHS target: the pass reads scene
  // depth, it does not write any.
  const sscsTarget = new THREE.RenderTarget(1, 1, passOpts);
  // --- GLOW pair (post-glow.ts), default OFF ----------------------------
  // Half-content-size working targets for the two glow draws, LinearFilter
  // ON PURPOSE and for the same hard reason as the VHS input pair above:
  // POST_GLOW_BLUR_WGSL samples with textureSample, and three emits no
  // `<tex>_sampler` for a nearest/nearest target (WGSLNodeBuilder
  // .isUnfilterable) — the blur would not compile against nearest.
  // rgba16float is filterable in WebGPU, so the sampler is valid. glowA is
  // written once (extract+blur-x) and read once (blur-y-and-add), no
  // ping-pong; glowB is its pair half, allocated so a non-additive variant
  // has somewhere to land without a mid-session reallocation.
  const glowA = new THREE.RenderTarget(1, 1, vhsPairOpts);
  const glowB = new THREE.RenderTarget(1, 1, vhsPairOpts);

  // The single canvas-boundary flip. Stays a uniform as a console escape
  // hatch (setBlitFlipY) — the intermediate passes flip their own sampling
  // so this is correct for every toggle combination at 1.
  const uFlipY = uniform(1);
  const uSmear = uniform(POST_AA_DEFAULTS.smear);
  // The lens, held as the two FOVs it was asked for: `k` depends on the
  // display aspect, so it is re-resolved on every refit rather than cached
  // from whatever the window happened to be at boot. `k = 0` is the real off
  // flag — the FOVs default to 0 (clamped to 1° by makeLens) and are only
  // meaningful once setLens() has actually run, so a HUD reading
  // lens.renderFovDeg before that must check lens.k first.
  let lensRenderFov = 0;
  let lensCenterFov = 0;
  // Placeholder; the construction-time refit() below overwrites it (via
  // recomputeLens) before the first frame.
  let lens: Lens = makeLens(0, 0, 1);
  // x = effective smear, y = current frame arrives display-encoded.
  const uBlendCfg = uniform(new THREE.Vector2(0, 0));
  // x = flipY, y = src is display-space, z = sharp mode, w = spare.
  const uBlitCfg = uniform(new THREE.Vector4(1, 0, 0, 0));
  const uBlitDst = uniform(new THREE.Vector2(1, 1));
  // (k, rmax, aspect) — see fisheye.ts. Owned by recomputeLens() from the
  // construction-time refit() onward; k = 0 is the off switch (an exact
  // identity in the blit) whatever rmax and aspect happen to be.
  const uLens = uniform(new THREE.Vector3(0, 0, 0));

  // --- BLAST REFRACTION state (experiment, default OFF). See the interface
  // and postAaBlastWarp. Bounded on purpose: FOUR unrolled slots and a ring of
  // at most four live blasts, aged on SIM time by the host's tick so a frozen
  // capture is deterministic. No new target and no per-blast pipeline. --------
  const BLAST_DISTORT_MAX = 4;
  const uBlastDistort = Array.from({ length: BLAST_DISTORT_MAX }, () =>
    uniform(new THREE.Vector4(0, 0, 0, 0)));
  // (count, maxUv, aspect, on)
  const uBlastDistortCfg = uniform(new THREE.Vector4(0, BLAST_REFRACTION.maxOffsetUv, 1, 0));
  let blastDistortOn = false;
  let blastDistortStrength = 1;
  /** The camera the live bands are reprojected against, or null (inert). */
  let blastCamera: THREE.PerspectiveCamera | null = null;
  /** Scratch view-projection; recomposed each frame, never a new node. */
  const blastViewProj = new THREE.Matrix4();
  interface LiveBlastDistort {
    world: [number, number, number];
    birthRadiusM: number;
    strength: number;
    age: number;
    /** 'burn' entries skip the blast phase (no expansion, no decay) and are
     *  dropped after the resolve that consumed them — see pushBurnDistort. */
    kind: 'blast' | 'burn';
  }
  const liveBlastDistorts: LiveBlastDistort[] = [];
  /** The last blit's resolved slots — see `blastDistortSlots` (task-2 seam). */
  type ResolvedBlastSlot = {
    world: [number, number, number];
    age: number;
    radiusScale: number;
    decay: number;
    u: number | null;
    v: number | null;
    radiusUv: number | null;
    strength: number;
    reason: 'ok' | 'behind' | 'offscreen' | 'spent';
  };
  let lastBlastSlots: ResolvedBlastSlot[] = [];

  // --- VHS state. Every field below is inert while `vhsPreset` is null, and
  // null is the default: the all-off path must not even bind the material. --
  let vhsPreset: VhsPreset | null = null;
  /** The input-history half the next VHS pass READS (the other is written). */
  let vhsRead = vhsInA;
  let vhsWrite = vhsInB;
  /** False while the input history holds a stale/garbage frame -> hasPrev 0. */
  let vhsInputValid = false;
  /** Last blit source encoding — diagnostic only, see the interface. */
  let blitSrcIsDisplay = false;
  const uVhsTime = uniform(0);
  /** Demo-recording hold: while set, `uVhsTime` comes from the freeze instant
   *  instead of the wall clock. Default OFF, so ordinary play is untouched. */
  let vhsTimeFrozen = false;
  let vhsFrozenAt = 0;
  const uVhsHasPrev = uniform(0);
  const uVhsIsDisplay = uniform(0);
  // One uniform per VhsTerms key, written by setVhs/setVhsTerm. Initialised to
  // 0 because they are never bound while the preset is null.
  const vhsTermUniforms = {
    intensity: uniform(0),
    blurAmount: uniform(0),
    noiseAmount: uniform(0),
    gradeAmount: uniform(0),
    warpAmount: uniform(0),
    warpFrequency: uniform(0),
    warpSpeed: uniform(0),
    chromaAmount: uniform(0),
    chromaJitter: uniform(0),
    motionThreshold: uniform(0),
    chromaBurstChance: uniform(0),
    chromaBurstStrength: uniform(0),
    chromaBurstRate: uniform(0),
  };

  // --- SSCS state (post-sscs.ts). Inert while `sscsOn` is false — the
  // factory default — so this module stays neutral and the game page owns
  // the product decision (?sscs=, legacy path only). -------------------------
  let sscsOn = false;
  const sscsTerms: SscsTerms = { ...SSCS_DEFAULTS };
  // Per-frame matrices + light, fed by setSscsFrame. Zero matrices would
  // collapse every ray to a point; the pass additionally guards on that, but
  // a host that enables the stage without feeding it gets nothing by design.
  const uSscsVp = uniform(new THREE.Matrix4());
  const uSscsInvVp = uniform(new THREE.Matrix4());
  // xyz = flashlight position, w = strength (kept beside it so the per-frame
  // feed is one uniform write).
  const uSscsLight = uniform(new THREE.Vector4(0, 0, 0, 0));
  // x = camera near, y = camera far, z = maxDist, w = bias.
  const uSscsCfg = uniform(new THREE.Vector4(
    0.05, 50, SSCS_DEFAULTS.maxDist, SSCS_DEFAULTS.bias,
  ));
  const _sscsView = new THREE.Matrix4();
  const _sscsVp = new THREE.Matrix4();

  // --- GLOW state (post-glow.ts). Inert while `glowOn` is false — the
  // factory default — so the parity path never binds either glow material.
  // The extract reads whatever the chain currently holds (swapped per frame,
  // the blendCurTex pattern); the blur always reads glowA, which never
  // changes, so its texture node is bound once.
  let glowOn = false;
  let glowGain = 0;
  let glowThreshold = 0.75;
  // Per-draw cfg, x = knee threshold, y/z = one GLOW-target texel as UV,
  // w = gain (applied by the blur draw only).
  const uGlowExtractCfg = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uGlowBlurCfg = uniform(new THREE.Vector4(0, 0, 0, 0));

  // --- TONGUES state (post-tongues.ts). Inert while `tonguesOn` is false —
  // the factory default — so the parity path never binds the material. The
  // burn-mask slot starts on an OWNED 1x1 fallback (rgb 0 = no burn) and is
  // repointed ONCE at host boot by setBurnMaskTexture.
  let tonguesOn = false;
  const tongueBurnFallback = new THREE.DataTexture(
    new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  tongueBurnFallback.needsUpdate = true;
  const tongueBurnTex = texture(tongueBurnFallback);
  const uTongueUp = uniform(new THREE.Vector2(0, -1));
  // cfg0 = (stepPx, near, far, fovTan); cfg1 = (ragged, rise, gain, lean);
  // cfg2 = (refDepthM, lengthM, time, spare) — the packing POST_TONGUES_WGSL reads.
  const uTongueCfg0 = uniform(new THREE.Vector4(0, 0.05, 60, 1));
  const uTongueCfg1 = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uTongueCfg2 = uniform(new THREE.Vector4(3, 0.45, 0, 0));
  // The pass READS sceneTarget.depthTexture, so it can NOT write into
  // sceneTarget: WebGPU forbids one subresource being both a render
  // attachment and a binding in the same pass, and sceneTarget's depth is
  // always an attachment (its depthTexture). Every other pass in this chain
  // obeys the same "never sample what you write" rule by writing its own
  // target; the tongues do too, and a second additive draw lands the result in
  // the capture. Writing straight into sceneTarget made the whole pass a
  // validation no-op — its taps read zero and nothing appeared.
  const tongueTarget = new THREE.RenderTarget(1, 1, passOpts);
  const tongueOut = wgslFn(POST_TONGUES_WGSL)({
    burnTex: tongueBurnTex,
    depthTex: texture(sceneTarget.depthTexture!),
    texCoord: uv(),
    upPx: uTongueUp,
    cfg0: uTongueCfg0,
    cfg1: uTongueCfg1,
    cfg2: uTongueCfg2,
  }) as unknown as Swizzled;
  const tongueMat = new MeshBasicNodeMaterial();
  tongueMat.name = 'post:tongues';
  tongueMat.colorNode = vec4(tongueOut.xyz as never, 1.0);
  tongueMat.depthWrite = false;
  tongueMat.depthTest = false;
  tongueMat.fog = false;
  // The shaping pass WRITES its value (the quad covers every pixel); only the
  // composite below is additive. Additive here would fold the target's clear
  // colour — the lab background — into every frame the technique is on.
  tongueMat.blending = THREE.NoBlending;
  const tongueScene = quadScene(tongueMat);

  // The additive composite of tongueTarget into the capture. POST_AA_COPY_WGSL
  // is the module's textureLoad copy (no sampler needed), and its entry flip
  // cancels the pass's own read flip, so the flame lands exactly where it was
  // shaped. Drawn into sceneTarget with autoClear off.
  const tongueCompositeOut = wgslFn(POST_AA_COPY_WGSL)({
    srcTex: texture(tongueTarget.texture),
    texCoord: uv(),
  }) as unknown as Swizzled;
  const tongueCompositeMat = new MeshBasicNodeMaterial();
  tongueCompositeMat.name = 'post:tongues-composite';
  tongueCompositeMat.colorNode = vec4(tongueCompositeOut.xyz as never, 1.0);
  tongueCompositeMat.depthWrite = false;
  tongueCompositeMat.depthTest = false;
  tongueCompositeMat.fog = false;
  tongueCompositeMat.blending = THREE.AdditiveBlending;
  const tongueCompositeScene = quadScene(tongueCompositeMat);

  // --- FIRE VOLUME state (fire-volume.wgsl.ts), default OFF -------------
  // Same discipline as the tongues: inert while `fireOn` is false, so the
  // all-off parity path never binds a material. The capsule storage starts
  // zeroed; the curl volume is repointed to the shared singleton (0.7 s CPU
  // build) only when fire is first enabled, so a page that never burns never
  // pays for it.
  let fireOn = false;
  let fireResolutionScale = 0.5;
  let fireHistValid = false;
  let fireCurlLive = false;
  const fireCapsFloats = new Float32Array(FIRE_VOLUME_MAX_CAPSULES * FIRE_CAPSULE_STRIDE);
  const fireCapsAttr = new THREE.StorageBufferAttribute(fireCapsFloats, 4);
  fireCapsAttr.setUsage(THREE.DynamicDrawUsage);
  const fireCapsNode = storage(
    fireCapsAttr, 'vec4', FIRE_VOLUME_MAX_CAPSULES * 3,
  ).toReadOnly();
  // curlFallback decodes to ~0 flow; Linear/Linear because the atlas lesson:
  // three emits no sampler for a nearest/nearest texture and `textureSampleLevel`
  // would silently fall back to an unfiltered binding (or fail to compile).
  const fireCurlFallback = new THREE.Data3DTexture(
    new Uint8Array([128, 128, 128, 255]), 1, 1, 1,
  );
  fireCurlFallback.format = THREE.RGBAFormat;
  fireCurlFallback.type = THREE.UnsignedByteType;
  fireCurlFallback.minFilter = THREE.LinearFilter;
  fireCurlFallback.magFilter = THREE.LinearFilter;
  fireCurlFallback.needsUpdate = true;
  const fireCurlTex = texture3D(fireCurlFallback);
  // Matrices + the packed per-frame record. Nothing here is per-frame ALLOCATED.
  const uFireInvVp = uniform(new THREE.Matrix4());
  const uFirePrevVp = uniform(new THREE.Matrix4());
  const uFireCfg0 = uniform(new THREE.Vector4(32, 1.1, 2.2, 1.2));
  const uFireCfg1 = uniform(new THREE.Vector4(0.35, 0.3, 0.6, 1.6));
  const uFireCfg2 = uniform(new THREE.Vector4(0.6, 0, 0, 0));
  const uFireCfg3 = uniform(new THREE.Vector4(0.85, 0, 0.05, 60));
  // Round 2b's tongue-erosion + smoke-scatter block: the march reads these
  // (the resolve keeps cfg3).
  const uFireCfg4 = uniform(new THREE.Vector4(2.4, 0.5, 0.55, 0.6));
  const uFireCfg5 = uniform(new THREE.Vector4(2.5, 0.12, 0.5, 0.55));
  const uFireCfg6 = uniform(new THREE.Vector4(1.0, 0.4, 0, 0));
  const uFireBoundsMin = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uFireBoundsMax = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uFireNearFar = uniform(new THREE.Vector4(0.05, 60, 0, 0));
  // x = flame streak half-length in UV (tuning streakPx / output height / 2).
  const uFireStreak = uniform(new THREE.Vector4(0, 0, 0, 0));
  // x = heat shimmer amplitude in UV, y = time (s), z = rise band UV, w = on.
  const uFireHeat = uniform(new THREE.Vector4(0, 0, 0.08, 0));
  // fireTarget is the low-res march (Linear so the resolve can upsample it);
  // round 2b runs the history/resolve at the SAME low resolution (the field is
  // low-frequency, so a full-res resolve only bought pixels) and the composite
  // bilinearly upsamples it into the capture once. The history is a ping-pong
  // because each resolve reads the previous frame and writes the next, never
  // the same target. There is NO separate full-res composite target: the
  // composite blends directly into the capture.
  const fireTarget = new THREE.RenderTarget(1, 1, vhsPairOpts);
  const fireHistA = new THREE.RenderTarget(1, 1, vhsPairOpts);
  const fireHistB = new THREE.RenderTarget(1, 1, vhsPairOpts);
  let fireHistRead = fireHistA;
  let fireHistWrite = fireHistB;
  const fireHistReadTex = texture(fireHistRead.texture);
  const fireResolvedTex = texture(fireHistWrite.texture);

  const fireMarchOut = wgslFn(FIRE_VOLUME_MARCH_WGSL)({
    depthTex: texture(sceneTarget.depthTexture!),
    curlTex: fireCurlTex,
    curlSamp: fireCurlTex,
    caps: fireCapsNode,
    invViewProj: uFireInvVp,
    texCoord: uv(),
    cfg0: uFireCfg0,
    cfg1: uFireCfg1,
    cfg2: uFireCfg2,
    cfg4: uFireCfg4,
    cfg5: uFireCfg5,
    cfg6: uFireCfg6,
    boundsMin: uFireBoundsMin,
    boundsMax: uFireBoundsMax,
    nearFar: uFireNearFar,
  }) as unknown as Swizzled;
  const fireMarchMat = new MeshBasicNodeMaterial();
  fireMarchMat.name = 'post:fire-march';
  // The march already returns vec4(emission, T); wrapping it in vec4(.., 1.0)
  // passed five components (the console's 'exceeds maximum length' warning).
  fireMarchMat.colorNode = fireMarchOut as never;
  fireMarchMat.depthWrite = false;
  fireMarchMat.depthTest = false;
  fireMarchMat.fog = false;
  fireMarchMat.blending = THREE.NoBlending;
  const fireMarchScene = quadScene(fireMarchMat);

  const fireResolveOut = wgslFn(FIRE_VOLUME_RESOLVE_WGSL)({
    fireTex: texture(fireTarget.texture),
    fireSamp: texture(fireTarget.texture),
    histTex: fireHistReadTex,
    histSamp: fireHistReadTex,
    depthTex: texture(sceneTarget.depthTexture!),
    invViewProj: uFireInvVp,
    prevViewProj: uFirePrevVp,
    texCoord: uv(),
    cfg: uFireCfg3,
  }) as unknown as Swizzled;
  const fireResolveMat = new MeshBasicNodeMaterial();
  fireResolveMat.name = 'post:fire-resolve';
  fireResolveMat.colorNode = fireResolveOut as never;
  fireResolveMat.depthWrite = false;
  fireResolveMat.depthTest = false;
  fireResolveMat.fog = false;
  fireResolveMat.blending = THREE.NoBlending;
  const fireResolveScene = quadScene(fireResolveMat);

  // COMPOSITE = the capture blend. src = emission (rgb), srcAlpha = T; with
  // dstFactor = SrcAlpha the target becomes emission + scene * T in place, so
  // this pass never samples the target it writes and no copy draw is needed.
  // Alpha output = T (One/Zero on the alpha channel), as the plan specifies.
  const fireCompositeOut = wgslFn(FIRE_VOLUME_COMPOSITE_WGSL)({
    fireTex: fireResolvedTex,
    fireSamp: fireResolvedTex,
    texCoord: uv(),
    streak: uFireStreak,
  }) as unknown as Swizzled;
  const fireCompositeMat = new MeshBasicNodeMaterial();
  fireCompositeMat.name = 'post:fire-composite';
  fireCompositeMat.colorNode = fireCompositeOut as never;
  fireCompositeMat.depthWrite = false;
  fireCompositeMat.depthTest = false;
  fireCompositeMat.fog = false;
  fireCompositeMat.blending = THREE.CustomBlending;
  fireCompositeMat.blendSrc = THREE.OneFactor;
  fireCompositeMat.blendDst = THREE.SrcAlphaFactor;
  fireCompositeMat.blendEquation = THREE.AddEquation;
  fireCompositeMat.blendSrcAlpha = THREE.OneFactor;
  fireCompositeMat.blendDstAlpha = THREE.ZeroFactor;
  const fireCompositeScene = quadScene(fireCompositeMat);

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

  // The FXAA input is a NAMED node (not an inline texture()) because the
  // SSCS stage can sit in front of it: when it runs, FXAA must read
  // sscsTarget's output, so render() swaps .value exactly like blendCurTex.
  // With SSCS off the value is sceneTarget.texture itself — bit-identical.
  const fxaaSrcTex = texture(sceneTarget.texture);
  const fxaaOut = wgslFn(POST_AA_FXAA_WGSL)({
    srcTex: fxaaSrcTex,
    texCoord: uv(),
  }) as unknown as Swizzled;
  const fxaaMat = new MeshBasicNodeMaterial();
  fxaaMat.name = 'post:fxaa';
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
  blendMat.name = 'post:smear';
  blendMat.colorNode = vec4(blendOut.xyz as never, 1.0);
  blendMat.depthWrite = false;
  blendMat.depthTest = false;
  blendMat.fog = false;
  const blendScene = quadScene(blendMat);

  // The VHS input-history copy. Built from POST_AA_COPY_WGSL (textureLoad, no
  // sampler) and only ever rendered while a preset is active.
  const vhsCopySrcTex = texture(sceneTarget.texture);
  const vhsCopyOut = wgslFn(POST_AA_COPY_WGSL)({
    srcTex: vhsCopySrcTex,
    texCoord: uv(),
  }) as unknown as Swizzled;
  const vhsCopyMat = new MeshBasicNodeMaterial();
  vhsCopyMat.name = 'post:vhs-input';
  vhsCopyMat.colorNode = vec4(vhsCopyOut.xyz as never, 1.0);
  vhsCopyMat.depthWrite = false;
  vhsCopyMat.depthTest = false;
  vhsCopyMat.fog = false;
  const vhsCopyScene = quadScene(vhsCopyMat);

  // The VHS pass itself. `tex` is the CURRENT input (the pair write half just
  // filled by the copy) and `prevTex` the PREVIOUS input — never this pass's
  // own output. The texture node doubles as the `samp` argument: three builds
  // a sampler-typed input from it as `<tex>_sampler`, which exists because the
  // pair is LinearFilter (see the pair's comment above).
  const vhsCurTex = texture(vhsInA.texture);
  const vhsPrevTex = texture(vhsInA.texture);
  const vhsOut = wgslFn(POST_VHS_WGSL)({
    tex: vhsCurTex,
    samp: vhsCurTex,
    prevTex: vhsPrevTex,
    uv: uv(),
    time: uVhsTime,
    hasPrev: uVhsHasPrev,
    isDisplay: uVhsIsDisplay,
    intensity: vhsTermUniforms.intensity,
    blurAmount: vhsTermUniforms.blurAmount,
    noiseAmount: vhsTermUniforms.noiseAmount,
    gradeAmount: vhsTermUniforms.gradeAmount,
    warpAmount: vhsTermUniforms.warpAmount,
    warpFrequency: vhsTermUniforms.warpFrequency,
    warpSpeed: vhsTermUniforms.warpSpeed,
    chromaAmount: vhsTermUniforms.chromaAmount,
    chromaJitter: vhsTermUniforms.chromaJitter,
    motionThreshold: vhsTermUniforms.motionThreshold,
    chromaBurstChance: vhsTermUniforms.chromaBurstChance,
    chromaBurstStrength: vhsTermUniforms.chromaBurstStrength,
    chromaBurstRate: vhsTermUniforms.chromaBurstRate,
  }) as unknown as Swizzled;
  const vhsMat = new MeshBasicNodeMaterial();
  vhsMat.name = 'post:vhs';
  vhsMat.colorNode = vec4(vhsOut.xyz as never, 1.0);
  vhsMat.depthWrite = false;
  vhsMat.depthTest = false;
  vhsMat.fog = false;
  const vhsScene = quadScene(vhsMat);

  // The SSCS pass. Three DISTINCT textures in three slots — the capture
  // colour, its DepthTexture, and the march target's flesh mask — so the TSL
  // uniform-hash dedup cannot merge any two. The flesh slot starts on an
  // OWNED 1×1 fallback (alpha 1 = "no flesh") rather than a second
  // texture() over sceneTarget.texture: two nodes built over one texture
  // collapse into one binding for the pipeline's life, and a later per-slot
  // .value write cannot split them (the trap that bit the deferred shadow
  // slots). setSscsFleshTex repoints it, exactly once, at host boot.
  const sscsFleshFallback = new THREE.DataTexture(
    new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
  );
  sscsFleshFallback.needsUpdate = true;
  const sscsFleshTex = texture(sscsFleshFallback);
  // SSCS always reads the RAW capture — its own dedicated, never-swapped
  // node (fxaaSrcTex above is swapped to sscsTarget by the FXAA branch, and
  // sharing it here would have SSCS drinking its own output a frame late).
  const sscsColorTex = texture(sceneTarget.texture);
  const sscsOut = wgslFn(POST_SSCS_WGSL)({
    tex: sscsColorTex,
    depthTex: texture(sceneTarget.depthTexture!),
    fleshTex: sscsFleshTex,
    uv: uv(),
    vp: uSscsVp,
    invVp: uSscsInvVp,
    light: uSscsLight,
    cfg: uSscsCfg,
  }) as unknown as Swizzled;
  const sscsMat = new MeshBasicNodeMaterial();
  sscsMat.name = 'post:sscs';
  sscsMat.colorNode = vec4(sscsOut.xyz as never, 1.0);
  sscsMat.depthWrite = false;
  sscsMat.depthTest = false;
  sscsMat.fog = false;
  const sscsScene = quadScene(sscsMat);

  // The GLOW passes. Extract: bright-pass + blur-x off the current chain
  // source into glowA. Blur: blur-y off glowA, ADDITIVE into the capture —
  // AdditiveBlending is (SrcAlpha, One) non-premultiplied on this backend
  // (explosion-vfx.ts read the factors out of the build), and alpha is 1, so
  // rgb * cfg.w lands over the frame the capture already holds. The additive
  // draw must run with autoClear off (render() does the blit's dance): a
  // clear would wipe the frame from under the glow.
  const glowExtractSrcTex = texture(sceneTarget.texture);
  const glowExtractOut = wgslFn(POST_GLOW_EXTRACT_WGSL)({
    srcTex: glowExtractSrcTex,
    texCoord: uv(),
    cfg: uGlowExtractCfg,
  }) as unknown as Swizzled;
  const glowExtractMat = new MeshBasicNodeMaterial();
  glowExtractMat.name = 'post:glow-extract';
  glowExtractMat.colorNode = vec4(glowExtractOut.xyz as never, 1.0);
  glowExtractMat.depthWrite = false;
  glowExtractMat.depthTest = false;
  glowExtractMat.fog = false;
  const glowExtractScene = quadScene(glowExtractMat);

  const glowBlurTex = texture(glowA.texture);
  const glowBlurOut = wgslFn(POST_GLOW_BLUR_WGSL)({
    glowTex: glowBlurTex,
    glowSamp: glowBlurTex,
    texCoord: uv(),
    cfg: uGlowBlurCfg,
  }) as unknown as Swizzled;
  const glowBlurMat = new MeshBasicNodeMaterial();
  glowBlurMat.name = 'post:glow-blur';
  glowBlurMat.colorNode = vec4(glowBlurOut.xyz as never, 1.0);
  glowBlurMat.depthWrite = false;
  glowBlurMat.depthTest = false;
  glowBlurMat.fog = false;
  glowBlurMat.blending = THREE.AdditiveBlending;
  const glowBlurScene = quadScene(glowBlurMat);

  const blitOut = wgslFn(POST_AA_BLIT_WGSL)({
    srcTex: blitSrcTex,
    texCoord: uv(),
    cfg: uBlitCfg,
    dstSize: uBlitDst,
    lens: uLens,
    d0: uBlastDistort[0]!,
    d1: uBlastDistort[1]!,
    d2: uBlastDistort[2]!,
    d3: uBlastDistort[3]!,
    dist: uBlastDistortCfg,
    heatTex: fireResolvedTex,
    heatSamp: fireResolvedTex,
    heat: uFireHeat,
  }) as unknown as Swizzled;
  const blitMat = new MeshBasicNodeMaterial();
  blitMat.name = 'post:blit';
  blitMat.colorNode = vec4(blitOut.xyz as never, 1.0);
  blitMat.depthWrite = false;
  blitMat.depthTest = false;
  blitMat.fog = false;
  const blitScene = quadScene(blitMat);

  const sinks: PostAaSink[] = [];
  let redirected = false;
  /**
   * PRE-POST CAPTURE STAGE (shutter game integration, 2026-09-17). Runs after
   * the chain has drawn the clean captured frame and BEFORE SSCS/FXAA/VHS, so
   * an exposure resolve composites in working-linear space with the capture's
   * own depth still intact for SSCS. Returns the target the rest of the chain
   * should read (null = no change, keep the capture). See setCaptureStage.
   */
  let captureStage: PostAaCaptureStage | null = null;
  /** The history buffer the next frame's blend READS (the other is written). */
  let histRead = histA;
  let histWrite = histB;
  /** False while the history holds a stale/garbage frame — seeds at smear 0. */
  let historyValid = false;
  /** Explicit first clear after every (re)allocation — the lazy-init trap. */
  let targetsNeedInit = true;
  const emptyScene = new THREE.Scene();
  const drawSize = new THREE.Vector2();

  /**
   * The ONLY writer of `lens` and `uLens`. Must run after anything that can
   * move the content size — it is called from setLens() and from the tail of
   * refit(), and there is no other path that keeps them in sync. NOTE: a
   * future runtime setRenderCap() switch fires no resize event, so a caller
   * that adds one must call refit() itself or the lens and contentSize will
   * silently disagree about the aspect.
   */
  function recomputeLens() {
    const c = computeRenderSize(window.innerWidth, window.innerHeight);
    const next = makeLens(lensRenderFov, lensCenterFov, c.width / c.height);
    // makeLens's clamp does not catch NaN (see fisheye.ts), and the JS gate
    // (k > 0) and the WGSL gate (k <= 0.0) disagree about it: JS reads NaN as
    // off, WGSL as on, so the frame would warp on every UV while the API
    // reports the lens as off. Resolve it here, once, at the seam that takes
    // the input, rather than leaving two disagreeing gates downstream.
    lens = Number.isFinite(next.k) ? next : makeLens(0, 0, c.width / c.height);
    uLens.value.set(lens.k, lens.rmax, lens.aspect);
  }

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
    vhsInA.setSize(content.width, content.height);
    vhsInB.setSize(content.width, content.height);
    vhsTarget.setSize(content.width, content.height);
    sscsTarget.setSize(content.width, content.height);
    // Tongues shape at the capture resolution (the pass is per-pixel flame).
    tongueTarget.setSize(content.width, content.height);
    // Fire volume: the march runs at resolutionScale of the content size (the
    // field is low-frequency, so 0.5 is invisible and a quarter of the pixels).
    // Round 2b runs the resolve + history pair at the SAME low resolution and
    // upsamples once in the blend-into-capture composite, so all three fire
    // draws shrink with the scale.
    fireTarget.setSize(
      Math.max(1, Math.floor(content.width * fireResolutionScale)),
      Math.max(1, Math.floor(content.height * fireResolutionScale)),
    );
    fireHistA.setSize(fireTarget.width, fireTarget.height);
    fireHistB.setSize(fireTarget.width, fireTarget.height);
    // The glow pair runs at HALF content size: a bloom's footprint is wide
    // relative to one pixel, so the blur does not need full resolution, and
    // the two draws cost a quarter of one each.
    glowA.setSize(Math.max(1, Math.floor(content.width / 2)), Math.max(1, Math.floor(content.height / 2)));
    glowB.setSize(Math.max(1, Math.floor(content.width / 2)), Math.max(1, Math.floor(content.height / 2)));
    // setSize reallocates the backing textures: uninitialised again, and the
    // old history is the wrong size besides.
    targetsNeedInit = true;
    historyValid = false;
    vhsInputValid = false;
    fireHistValid = false;
    recomputeLens();
  }
  refit();
  // Registered AFTER lab-renderer's own resize listener (this is created
  // later), so the sharp-mode canvas override always lands last.
  window.addEventListener('resize', refit);

  return {
    get captureTarget() { return sceneTarget; },
    render(chain) {
      const smear = uSmear.value;
      const vhsOn = vhsPreset !== null;
      // A narrowing lens is an effect like any other: it needs the capture
      // redirect, because the blit has to sample a texture rather than be one.
      // VHS is a stage too, so it forces the redirected chain even alone.
      const active = fxaaOn || smear > 0 || sharpOn || lens.k > 0 || vhsOn || sscsOn || glowOn
        || tonguesOn || fireOn
        || (blastDistortOn && liveBlastDistorts.length > 0) || captureStage !== null;
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
        setPassLabel('init');
        for (const t of [sceneTarget, fxaaTarget, histA, histB, vhsInA, vhsInB, vhsTarget, sscsTarget, glowA, glowB, fireTarget, fireHistA, fireHistB]) {
          renderer.setRenderTarget(t);
          void renderer.render(emptyScene, quadCam);
        }
      }

      // The whole polygon/sdf/cone/occluder/composite/goo flow, captured.
      chain();

      // TONGUES (flame-tongues task 2): first of the post passes, before the
      // shutter capture stage and the glow extract below, so tongues are both
      // shutter-blurred and bloomed like the rest of the frame. Two draws: the
      // shaping pass into its own target (it samples the capture's depth), then
      // an additive composite into the capture with autoClear off — a clear
      // there would wipe the frame from under the flame (the glow-blur dance).
      if (tonguesOn) {
        setPassLabel('post:tongues');
        renderer.setRenderTarget(tongueTarget);
        void renderer.render(tongueScene, quadCam);
        setPassLabel('post:tongues-composite');
        renderer.setRenderTarget(sceneTarget);
        const prevAutoClearTongues = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(tongueCompositeScene, quadCam);
        renderer.autoClear = prevAutoClearTongues;
      }

      // FIRE VOLUME (burning-feedback round 2, task 4c; round 2b task 4b): the
      // SAME seam as the tongues — after the capture, before the shutter stage
      // and the glow extract. THREE draws now: the low-res march (reads the
      // capture depth), the low-res resolve (reads the march output + the
      // previous history), and the composite, which BLENDS into the capture
      // with (One, SrcAlpha). Round 2's separate full-res composite target and
      // its copy draw are gone: the blend does `emission + scene * T` in place,
      // so the pass still never samples the target it writes.
      if (fireOn) {
        setPassLabel('post:fire-march');
        renderer.setRenderTarget(fireTarget);
        void renderer.render(fireMarchScene, quadCam);
        fireHistReadTex.value = fireHistRead.texture;
        setPassLabel('post:fire-resolve');
        renderer.setRenderTarget(fireHistWrite);
        void renderer.render(fireResolveScene, quadCam);
        fireResolvedTex.value = fireHistWrite.texture;
        setPassLabel('post:fire-composite');
        renderer.setRenderTarget(sceneTarget);
        const prevAutoClearFire = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(fireCompositeScene, quadCam);
        renderer.autoClear = prevAutoClearFire;
        const fireSwap = fireHistRead;
        fireHistRead = fireHistWrite;
        fireHistWrite = fireSwap;
        fireHistValid = true;
      }

      // PRE-POST CAPTURE STAGE. The chain has drawn the clean frame into
      // sceneTarget; a stage may composite over it (the shutter resolve reads
      // sceneTarget and writes its OWN target, so it never samples what it
      // writes). sceneTarget's depth is untouched and stays the source for
      // SSCS below, which is why the stage returns a colour target rather than
      // resolving in place.
      let src = sceneTarget;
      if (captureStage !== null) {
        const staged = captureStage(sceneTarget);
        if (staged !== null) src = staged;
      }

      // GLOW: bright-pass + separable blur off the working-space capture,
      // added back into it — BEFORE SSCS/FXAA see the frame, so glow is
      // never added after display encoding (the colour-chain rule) and the
      // stages below simply read the glowing frame. The add draws INTO src
      // (additive, autoClear off — a clear would wipe the frame under the
      // glow), so `src` itself is unchanged and nothing downstream reorders.
      // Both thresholds work in WORKING space: the capture is pre-encode.
      if (glowOn && glowGain > 0) {
        const gw = Math.max(1, glowA.width);
        const gh = Math.max(1, glowA.height);
        glowExtractSrcTex.value = src.texture;
        uGlowExtractCfg.value.set(glowThreshold, 1 / gw, 1 / gh, glowGain);
        setPassLabel('post:glow-extract');
        renderer.setRenderTarget(glowA);
        void renderer.render(glowExtractScene, quadCam);
        uGlowBlurCfg.value.set(glowThreshold, 1 / gw, 1 / gh, glowGain);
        setPassLabel('post:glow-blur');
        renderer.setRenderTarget(src);
        const prevAutoClearGlow = renderer.autoClear;
        renderer.autoClear = false;
        void renderer.render(glowBlurScene, quadCam);
        renderer.autoClear = prevAutoClearGlow;
      }

      // SSCS: contact shadows from the capture's own depth, run BEFORE FXAA
      // so the darkened silhouette edges are antialiased with everything
      // else. Matrices and the light position are fed per frame by the host
      // (setSscsFrame); while off this stage never renders.
      let srcIsDisplay = false;
      if (sscsOn) {
        setPassLabel('post:sscs');
        renderer.setRenderTarget(sscsTarget);
        void renderer.render(sscsScene, quadCam);
        src = sscsTarget;
      }

      // FXAA: capture (working space) -> fxaaTarget (display space).
      if (fxaaOn) {
        fxaaSrcTex.value = src.texture;
        setPassLabel('post:fxaa');
        renderer.setRenderTarget(fxaaTarget);
        void renderer.render(fxaaScene, quadCam);
        src = fxaaTarget;
        srcIsDisplay = true;
      }

      if (vhsOn) {
        // Copy the current input into the VHS input history — RAW, so the pair
        // holds exactly the space `src` did. The VHS pass then reads this
        // frame's input as `tex` and the PREVIOUS input as `prevTex`: the
        // motion gate must never see the pass's own output (its previous
        // chroma split would exceed the threshold at every edge and latch on).
        vhsCopySrcTex.value = src.texture;
        setPassLabel('post:vhs-input');
        renderer.setRenderTarget(vhsWrite);
        void renderer.render(vhsCopyScene, quadCam);

        vhsCurTex.value = vhsWrite.texture;
        vhsPrevTex.value = vhsRead.texture;
        uVhsTime.value = vhsTimeFrozen ? vhsFrozenAt : performance.now() / 1000;
        uVhsHasPrev.value = vhsInputValid ? 1 : 0;
        uVhsIsDisplay.value = srcIsDisplay ? 1 : 0;
        setPassLabel('post:vhs');
        renderer.setRenderTarget(vhsTarget);
        void renderer.render(vhsScene, quadCam);
        const t = vhsRead;
        vhsRead = vhsWrite;
        vhsWrite = t;
        vhsInputValid = true;

        // VHS output is display-encoded (it graded the taps itself), and VHS
        // OWNS temporal blending: smear is suppressed to 0 while it is on.
        src = vhsTarget;
        srcIsDisplay = true;
        historyValid = false;
      } else if (smear > 0) {
        blendCurTex.value = src.texture;
        blendHistTex.value = histRead.texture;
        uBlendCfg.value.set(historyValid ? smear : 0, srcIsDisplay ? 1 : 0);
        setPassLabel('post:smear');
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
      blitSrcIsDisplay = srcIsDisplay;
      uBlitDst.value.set(drawSize.x, drawSize.y);
      // BLAST REFRACTION uniforms, resolved fresh each frame from the bounded
      // ring. Only uniform values change here — never the node graph — so
      // toggling the experiment or firing a blast never triggers a shader
      // compile. Each live blast is REPROJECTED from its WORLD position and the
      // grown world radius, so a camera that moves during the wave's life keeps
      // the band on the blast instead of on where it used to be.
      {
        let active = 0;
        const resolved: ResolvedBlastSlot[] = [];
        if (blastDistortOn && blastCamera !== null) {
          blastViewProj.multiplyMatrices(
            blastCamera.projectionMatrix, blastCamera.matrixWorldInverse);
          for (const b of liveBlastDistorts) {
            // A burn band has no phase: its radius never expands and its
            // strength carries no age decay (burn-distort.ts computes both
            // from burn and char instead). The TS-side shape the blast's
            // phase returns is exactly (1, 1).
            const phase = b.kind === 'burn'
              ? { t: 1, radiusScale: 1, decay: 1 }
              : blastRefractionPhase(b.age, BLAST_REFRACTION);
            if (!phase) {
              resolved.push({ world: b.world, age: b.age, radiusScale: 1, decay: 0, u: null, v: null, radiusUv: null, strength: 0, reason: 'spent' });
              continue;
            }
            const p = projectBlastRefraction(
              b.world, blastViewProj.elements, b.birthRadiusM * phase.radiusScale);
            // Behind-camera / non-finite, and a small margin off-screen: a blast
            // that cannot be seen must not clamp onto an edge and warp it.
            if (!p) {
              resolved.push({ world: b.world, age: b.age, radiusScale: phase.radiusScale, decay: phase.decay, u: null, v: null, radiusUv: null, strength: 0, reason: 'behind' });
              continue;
            }
            if (p.u < -0.3 || p.u > 1.3 || p.v < -0.3 || p.v > 1.3) {
              resolved.push({ world: b.world, age: b.age, radiusScale: phase.radiusScale, decay: phase.decay, u: p.u, v: p.v, radiusUv: p.radiusUv, strength: 0, reason: 'offscreen' });
              continue;
            }
            const strength = b.strength * phase.decay * blastDistortStrength;
            const radiusUv = Math.min(BLAST_REFRACTION.maxScreenRadius, p.radiusUv);
            uBlastDistort[active]!.value.set(
              p.u, p.v,
              radiusUv,
              Math.max(0, strength),
            );
            resolved.push({ world: b.world, age: b.age, radiusScale: phase.radiusScale, decay: phase.decay, u: p.u, v: p.v, radiusUv, strength: Math.max(0, strength), reason: 'ok' });
            active++;
          }
        }
        lastBlastSlots = resolved;
        for (let i = active; i < BLAST_DISTORT_MAX; i++) uBlastDistort[i]!.value.set(0, 0, 0, 0);
        const aspect = drawSize.y > 0 ? drawSize.x / drawSize.y : 1;
        uBlastDistortCfg.value.set(
          active, BLAST_REFRACTION.maxOffsetUv, aspect,
          blastDistortOn && active > 0 ? 1 : 0,
        );
        // Burn entries are a PER-FRAME feed — the resolve above consumed
        // this frame's pushes, so drop them here and the list returns to
        // blasts-only for stepBlastDistort aging. A host that never resolves
        // (parity path) just leaves at most four of them parked in the ring.
        for (let i = liveBlastDistorts.length - 1; i >= 0; i--) {
          if (liveBlastDistorts[i]!.kind === 'burn') liveBlastDistorts.splice(i, 1);
        }
      }
      setPassLabel('post:blit');
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
    setCaptureStage(fn) {
      captureStage = fn;
      // A stage forces the redirected (captured) path. Enabling one after the
      // parity path is running must hand the sinks the capture target NOW, the
      // same late-registration trap addSink documents. Disabling it leaves the
      // redirect in place for this frame; the next render() with every effect
      // off drops back to the canvas parity path.
      if (captureStage !== null && !redirected) {
        for (const s of sinks) s.setOutputTarget(sceneTarget);
        redirected = true;
      }
    },
    setFxaa(on) {
      fxaaOn = on;
      // The VHS input pair holds the previous frame's ENCODING; toggling FXAA
      // changes the source's space, so re-seed rather than compare across it.
      vhsInputValid = false;
    },
    setSmear(v) { uSmear.value = Math.max(0, Math.min(POST_AA_SMEAR_MAX, v)); },
    setLens(renderFovDeg, centerFovDeg) {
      lensRenderFov = renderFovDeg;
      lensCenterFov = centerFovDeg;
      recomputeLens();
    },
    get lens() { return lens; },
    // --- BLAST REFRACTION (experiment, default OFF). --------------------
    setBlastDistort(on: boolean) { blastDistortOn = on; },
    setBlastDistortStrength(v: number) {
      blastDistortStrength = Number.isFinite(v) ? Math.max(0, Math.min(4, v)) : 1;
    },
    setBlastDistortCamera(camera: THREE.PerspectiveCamera) { blastCamera = camera; },
    pushBlastDistort(world, birthRadiusM, strength) {
      if (world.length < 3) return;
      const [x, y, z] = world;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      if (!(birthRadiusM > 0) || !(strength > 0)) return;
      liveBlastDistorts.push({
        world: [x, y, z],
        birthRadiusM: Math.max(0.05, Math.min(20, birthRadiusM)),
        strength: Math.max(0, Math.min(BLAST_REFRACTION.maxOffsetUv, strength)),
        age: 0,
        kind: 'blast',
      });
      // BOUNDED: the oldest blast beyond the four unrolled slots is dropped.
      while (liveBlastDistorts.length > BLAST_DISTORT_MAX) liveBlastDistorts.shift();
    },
    pushBurnDistort(world: Vec3, radiusM: number, strength: number) {
      if (world.length < 3) return;
      const [x, y, z] = world;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      if (!(radiusM > 0) || !(strength > 0)) return;
      const entry: LiveBlastDistort = {
        world: [x, y, z],
        birthRadiusM: Math.max(0.05, Math.min(20, radiusM)),
        strength: Math.max(0, Math.min(BLAST_REFRACTION.maxOffsetUv, strength)),
        age: 0,
        kind: 'burn',
      };
      if (liveBlastDistorts.length >= BLAST_DISTORT_MAX) {
        // Keep the STRONGEST of the four (see pushBurnDistort's doc): a
        // per-frame feed has no meaningful "oldest", and a weak blast must
        // not evict a strong fire.
        let weakest = 0;
        for (let i = 1; i < liveBlastDistorts.length; i++) {
          if (liveBlastDistorts[i]!.strength < liveBlastDistorts[weakest]!.strength) weakest = i;
        }
        if (entry.strength <= liveBlastDistorts[weakest]!.strength) return;
        liveBlastDistorts.splice(weakest, 1);
      }
      liveBlastDistorts.push(entry);
    },
    stepBlastDistort(dt: number) {
      if (!(dt > 0)) return;
      for (let i = liveBlastDistorts.length - 1; i >= 0; i--) {
        const b = liveBlastDistorts[i]!;
        // Burns are the host's per-frame feed; nobody ages them.
        if (b.kind === 'burn') continue;
        b.age += dt;
        if (!blastRefractionPhase(b.age, BLAST_REFRACTION)) liveBlastDistorts.splice(i, 1);
      }
    },
    get blastDistortCount() { return liveBlastDistorts.length; },
    get blastDistortSlots() { return lastBlastSlots; },
    get blastDistort() { return blastDistortOn; },
    get blastDistortStrength() { return blastDistortStrength; },
    setSharpUpscale(on) {
      if (on === sharpOn) return;
      sharpOn = on;
      refit();
    },
    setBlitFlipY(on) { uFlipY.value = on ? 1 : 0; },
    setTimeFrozen(on) {
      vhsTimeFrozen = on;
      if (on) vhsFrozenAt = performance.now() / 1000;
    },
    setVhs(preset) {
      vhsPreset = preset;
      // The pair's contents are stale after an off stretch (and after a preset
      // change the look jumps), so the next VHS frame seeds at hasPrev 0.
      vhsInputValid = false;
      if (preset !== null) {
        const terms = VHS_PRESETS[preset];
        for (const k of Object.keys(terms) as (keyof VhsTerms)[]) {
          vhsTermUniforms[k].value = terms[k];
        }
      }
    },
    setVhsTerm(name, value) {
      const [lo, hi] = VHS_TERM_RANGES[name];
      vhsTermUniforms[name].value = Math.max(lo, Math.min(hi, value));
    },
    get vhs() { return vhsPreset; },
    // --- SSCS (post-sscs.ts), default OFF here; the game page owns the
    // default-on decision (?sscs=) because the stage is legacy-path-only. --
    setSscs(on: boolean) { sscsOn = on; },
    /** Points the flesh-mask slot at the legacy march target. Call BEFORE
     *  setSscs(true); until then the owned 1×1 fallback (alpha 1) reads as
     *  "no flesh anywhere" and every level pixel is eligible. */
    setSscsFleshTex(t: THREE.Texture) { sscsFleshTex.value = t; },
    /** Per-frame feed. camera.matrixWorld must be CURRENT (game-main calls
     *  this right after flashlight.update, which re-runs updateMatrixWorld);
     *  matrixWorldInverse itself is last render's, so it is rebuilt here. */
    setSscsFrame(camera: THREE.PerspectiveCamera, lightPos: THREE.Vector3) {
      _sscsView.copy(camera.matrixWorld).invert();
      _sscsVp.multiplyMatrices(camera.projectionMatrix, _sscsView);
      uSscsVp.value.copy(_sscsVp);
      uSscsInvVp.value.copy(_sscsVp).invert();
      uSscsLight.value.set(lightPos.x, lightPos.y, lightPos.z, sscsTerms.strength);
      uSscsCfg.value.set(camera.near, camera.far, sscsTerms.maxDist, sscsTerms.bias);
    },
    /** A live term override, clamped to SSCS_TERM_RANGES. */
    setSscsTerm(name: keyof SscsTerms, value: number) {
      const [lo, hi] = SSCS_TERM_RANGES[name];
      sscsTerms[name] = Math.max(lo, Math.min(hi, value));
    },
    get sscs() { return sscsOn; },
    get sscsTerms(): SscsTerms { return { ...sscsTerms }; },
    // --- TONGUES (post-tongues.ts), default OFF. The per-frame feed is the
    // whole state (see the interface); non-finite fields fall back to the
    // last good values rather than poisoning the uniforms.
    setTongues(on: boolean, u?: TongueFrame) {
      tonguesOn = on && u !== undefined;
      if (!u) return;
      if (Number.isFinite(u.upX) && Number.isFinite(u.upY) && (u.upX !== 0 || u.upY !== 0)) {
        const l = Math.hypot(u.upX, u.upY);
        uTongueUp.value.set(u.upX / l, u.upY / l);
      }
      if (Number.isFinite(u.stepPx) && u.stepPx > 0) uTongueCfg0.value.x = u.stepPx;
      if (Number.isFinite(u.near) && u.near > 0) uTongueCfg0.value.y = u.near;
      if (Number.isFinite(u.far) && u.far > (uTongueCfg0.value.y)) uTongueCfg0.value.z = u.far;
      if (Number.isFinite(u.fovTan) && u.fovTan > 0) uTongueCfg0.value.w = u.fovTan;
      if (Number.isFinite(u.refDepthM) && u.refDepthM > 0) uTongueCfg2.value.x = u.refDepthM;
      if (Number.isFinite(u.length) && u.length > 0) uTongueCfg2.value.y = u.length;
      if (Number.isFinite(u.time)) uTongueCfg2.value.z = u.time;
      if (Number.isFinite(u.ragged)) uTongueCfg1.value.x = Math.min(1, Math.max(0, u.ragged));
      if (Number.isFinite(u.rise)) uTongueCfg1.value.y = Math.min(8, Math.max(0, u.rise));
      if (Number.isFinite(u.gain)) uTongueCfg1.value.z = Math.min(4, Math.max(0, u.gain));
      if (Number.isFinite(u.lean)) uTongueCfg1.value.w = Math.min(1, Math.max(0, u.lean));
    },
    /** Repoint the burn-mask slot at the march's fourth attachment — ONCE at
     *  host boot (the sscsFleshTex trap: one owned node, one rebind). */
    setBurnMaskTexture(t: THREE.Texture | null) { tongueBurnTex.value = t ?? tongueBurnFallback; },
    // --- FIRE VOLUME (fire-volume.wgsl.ts), default OFF. The per-frame record
    // is copied into uniform nodes (no allocation); non-finite numbers fall
    // back to the previous values rather than poisoning the march.
    setFireVolume(on: boolean, u?: FireVolumeFrame) {
      const wasOn = fireOn;
      fireOn = on && u !== undefined;
      if (!fireOn) uFireHeat.value.w = 0;
      if (!u) return;
      if (fireOn && !fireCurlLive) {
        // First enable: repoint the curl slot at the shared singleton (a 0.7 s
        // CPU build), so a page that never burns never pays for it.
        fireCurlTex.value = getCurlTexture();
        fireCurlLive = true;
      }
      const t = u.tuning;
      if (Number.isFinite(t.steps)) uFireCfg0.value.x = Math.max(0, t.steps);
      if (Number.isFinite(t.rise)) uFireCfg0.value.y = Math.max(0, t.rise);
      if (Number.isFinite(t.curlScale) && t.curlScale > 0) uFireCfg0.value.w = t.curlScale;
      if (Number.isFinite(t.curlStrength)) uFireCfg1.value.x = Math.max(0, t.curlStrength);
      if (Number.isFinite(t.lag)) uFireCfg1.value.y = Math.max(0, t.lag);
      if (Number.isFinite(t.lagMaxM)) uFireCfg1.value.z = Math.max(0, t.lagMaxM);
      if (Number.isFinite(t.tempGain)) uFireCfg1.value.w = Math.max(0, t.tempGain);
      if (Number.isFinite(u.capsuleCount)) uFireCfg2.value.y = Math.max(0, u.capsuleCount);
      if (Number.isFinite(u.time)) uFireCfg2.value.z = u.time;
      if (Number.isFinite(u.frame)) uFireCfg2.value.w = u.frame;
      // Round 2b's tongue-erosion block (its smoke block was removed 2026-09-19).
      if (Number.isFinite(t.noiseScale) && t.noiseScale > 0) uFireCfg4.value.x = t.noiseScale;
      if (Number.isFinite(t.noiseStretch) && t.noiseStretch > 0) uFireCfg4.value.y = t.noiseStretch;
      if (Number.isFinite(t.erode)) uFireCfg4.value.z = Math.max(0, t.erode);
      if (Number.isFinite(t.erodeRise) && t.erodeRise > 0) uFireCfg4.value.w = t.erodeRise;
      if (Number.isFinite(t.edgeSharp) && t.edgeSharp > 0) uFireCfg5.value.x = t.edgeSharp;
      if (Number.isFinite(t.coreR) && t.coreR > 0) uFireCfg5.value.y = t.coreR;
      if (Number.isFinite(t.density)) uFireCfg5.value.z = Math.max(0, t.density);
      if (Number.isFinite(t.skin)) uFireCfg5.value.w = Math.min(1, Math.max(0, t.skin));
      if (Number.isFinite(t.headClear)) uFireCfg6.value.x = Math.min(1, Math.max(0, t.headClear));
      if (Number.isFinite(t.headRise)) uFireCfg6.value.y = Math.max(0, t.headRise);
      // History resets on the first frame after enabling, on a host camera
      // jump, and whenever nothing has been written yet (a stale previous
      // frame would smear across a scene change).
      const reset = u.resetHistory === true || !wasOn || !fireHistValid;
      if (Number.isFinite(t.history)) uFireCfg3.value.x = Math.min(0.97, Math.max(0, t.history));
      uFireCfg3.value.y = reset ? 1 : 0;
      if (Number.isFinite(u.near) && u.near > 0) uFireCfg3.value.z = u.near;
      if (Number.isFinite(u.far) && u.far > 0) uFireCfg3.value.w = u.far;
      uFireBoundsMin.value.set(u.boundsMin[0], u.boundsMin[1], u.boundsMin[2], 0);
      uFireBoundsMax.value.set(u.boundsMax[0], u.boundsMax[1], u.boundsMax[2], 0);
      uFireNearFar.value.set(uFireCfg3.value.z, uFireCfg3.value.w, 0, 0);
      {
        const outH = Math.max(1, fireTarget.height / Math.max(fireResolutionScale, 1e-3));
        const sp = Number.isFinite(t.streakPx) ? Math.max(0, t.streakPx) : 0;
        uFireStreak.value.set(sp / outH / 2, 0, 0, 0);
        const hp = Number.isFinite(t.heatPx) ? Math.max(0, t.heatPx) : 0;
        uFireHeat.value.set(hp / outH, u.time, 0.08, hp > 0 ? 1 : 0);
      }
      uFireInvVp.value.copy(u.invViewProj);
      uFirePrevVp.value.copy(u.prevViewProj);
      // resolutionScale is live; a change resizes the low-res march target AND
      // its history pair (both run at the same scale in round 2b).
      if (Number.isFinite(t.resolutionScale) && t.resolutionScale > 0
        && t.resolutionScale !== fireResolutionScale) {
        fireResolutionScale = t.resolutionScale;
        const c = computeRenderSize(window.innerWidth, window.innerHeight);
        fireTarget.setSize(
          Math.max(1, Math.floor(c.width * fireResolutionScale)),
          Math.max(1, Math.floor(c.height * fireResolutionScale)),
        );
        fireHistA.setSize(fireTarget.width, fireTarget.height);
        fireHistB.setSize(fireTarget.width, fireTarget.height);
        fireHistValid = false;
      }
    },
    setFireVolumeData(buf: Float32Array) {
      const n = Math.min(buf.length, fireCapsFloats.length);
      fireCapsFloats.set(buf.subarray(0, n));
      fireCapsAttr.needsUpdate = true;
    },
    // --- GLOW (post-glow.ts), default OFF; the flame lab feeds it from its
    // live burn tuning every frame. Non-finite arguments fall back rather
    // than poisoning the uniforms.
    setGlow(on: boolean, gain = 0, threshold = 0.75) {
      glowOn = on;
      glowGain = Number.isFinite(gain) ? Math.max(0, gain) : 0;
      glowThreshold = Number.isFinite(threshold) ? Math.max(0, threshold) : 0.75;
    },
    get vhsTerms() {
      const out = {} as VhsTerms;
      for (const k of Object.keys(vhsTermUniforms) as (keyof VhsTerms)[]) {
        out[k] = vhsTermUniforms[k].value;
      }
      return out;
    },
    get effectiveSmear() { return vhsEffectiveSmear(uSmear.value, vhsPreset !== null); },
    get blitSrcIsDisplay() { return blitSrcIsDisplay; },
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
    vhsInA.dispose();
    vhsInB.dispose();
    vhsTarget.dispose();
    sscsTarget.dispose();
    tongueTarget.dispose();
    fireTarget.dispose();
    fireHistA.dispose();
    fireHistB.dispose();
    fireCurlFallback.dispose();
    glowA.dispose();
    glowB.dispose();
    sscsFleshFallback.dispose();
    sscsMat.dispose();
    glowExtractMat.dispose();
    glowBlurMat.dispose();
    tongueMat.dispose();
    tongueCompositeMat.dispose();
    fireMarchMat.dispose();
    fireResolveMat.dispose();
    fireCompositeMat.dispose();
    fxaaMat.dispose();
      blendMat.dispose();
      vhsCopyMat.dispose();
      vhsMat.dispose();
      blitMat.dispose();
    },
  };
}
