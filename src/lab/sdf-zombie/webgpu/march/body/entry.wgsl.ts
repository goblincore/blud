// src/lab/sdf-zombie/webgpu/march/body/entry.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): marchBody entry and the refine pass.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { MARCH_IN_PACK, MARCH_IN_STRUCT } from './io.wgsl';
import { MARCH_BODY_LIGHT } from './light.wgsl';
import { MARCH_BODY_PARAMS } from './params.wgsl';
import { MARCH_BODY_SURFACE_PREP } from './surface.wgsl';
import { MARCH_BODY_TRACE, MARCH_TRACE_POST, MARCH_TRACE_SETUP } from './trace.wgsl';

/**
 * The legacy lit entry — the default expansion. Assembled from the sections
 * above; the text is the pre-split shader with the wet/glow hoist described
 * at MARCH_BODY_PARAMS, which is arithmetic-neutral. Every existing variant
 * (body, hands, chunks, hull-refine) keeps binding against exactly this.
 *
 * Phase-2 task 2 adds MARCH_IN_PACK — the FIRST body statement, packing the
 * value parameters into MarchIn (generated, so still in parameter order) —
 * and MARCH_IN_STRUCT, the struct's trailing declaration at the very end of
 * the string. The body itself still reads the positional names; the struct
 * is deliberately unused until task 3 hands `m` to the trace.
 */
export const MARCH_BODY = `fn marchBody${MARCH_BODY_PARAMS}${MARCH_IN_PACK}${MARCH_BODY_TRACE}${MARCH_BODY_SURFACE_PREP}${MARCH_BODY_LIGHT}${MARCH_IN_STRUCT}`;

/**
 * RUN 5 (spec docs/superpowers/specs/2026-09-13-neural-upscale-run5-sdf-refine-design.md §4).
 * The refine entry shares the march's PARAMS (+4 appended), SETUP, POST, SURFACE_PREP and LIGHT
 * sections verbatim; only the walk is replaced. Per OUTPUT pixel: the hit comes from the four
 * surrounding march texels (hit-gated bilinear of linear view depth, along THIS pixel's ray) and
 * only when at least HALF that bilinear weight is over hit texels (a grazing pixel whose
 * footprint is mostly misses would converge on the silhouette's far side - a halo - so it is
 * discarded and left to the net), the
 * OWNERSHIP early-out (run 5b) drops a tap whose march texel belongs to another body - the key in
 * the normal attachment's alpha - so a twin's proxy box costs nothing over pixels another body owns
 * and the pass becomes screen- rather than body-bound, the
 * body's own SDF rejects the pixel if it disagrees by more than refineCfg.y march texels (another
 * body, or an edge — the net keeps owning edges), then refineCfg.w Newton steps land on the true
 * surface and the normal stencil shrinks to refineCfg.z of an OUTPUT pixel's footprint.
 * refineCfg: x = enabled (0 discards everything), y = reject in march texels (1.0),
 *            z = normal stencil in output-pixel footprints (0.25), w = Newton steps (2).
 *
 * Walk state the later sections actually READ is declared here too: t, hit, hitBest, hitField
 * and hitNearWound, each with the refine's real value. The walk's pure bookkeeping (step
 * counters, prevRadius, omega/overshoot state) has no reader past the walk and is absent.
 */
export const REFINE_LOOP = /* wgsl */ `  if (refineCfg.x < 0.5) { discard; }
  // The march texel grid under this output pixel - coneFetch's mapping, screenUV times dims.
  let mDims = vec2<f32>(textureDimensions(marchTex, 0));
  let mMax = vec2<i32>(mDims) - vec2<i32>(1, 1);
  let q = screenUV * mDims - vec2<f32>(0.5, 0.5);
  let c0 = clamp(vec2<i32>(floor(q)), vec2<i32>(0, 0), mMax);
  let fr = clamp(q - vec2<f32>(c0), vec2<f32>(0.0), vec2<f32>(1.0));
  var zsum = 0.0;
  var wsum = 0.0;
  // Run 5b: this body's key, the same expression MARCH_BODY_LIGHT wrote into the normal
  // attachment's alpha, from the SAME per-body uniform - so it compares exactly.
  let myKey = dot(gInstCentre, vec3<f32>(1.0, 7.31, 13.7)) + 1.0;
  for (var k = 0; k < 4; k = k + 1) {
    let dx = k & 1;
    let dy = k >> 1;
    let mcc = clamp(c0 + vec2<i32>(dx, dy), vec2<i32>(0, 0), mMax);
    let mc = textureLoad(marchTex, mcc, 0);
    let nk = textureLoad(normalTex, mcc, 0).w;
    if (mc.w >= 1.0 || nk != myKey) { continue; }
    let z = nearFar.x * nearFar.y / (nearFar.y - mc.w * (nearFar.y - nearFar.x));
    let wgt = (1.0 - abs(fr.x - f32(dx))) * (1.0 - abs(fr.y - f32(dy)));
    zsum = zsum + z * wgt;
    wsum = wsum + wgt;
  }
  // wsum is the bilinear weight of the HIT texels THIS BODY OWNS only (run 5b: a texel whose
  // normal-attachment alpha carries another body's key contributes nothing), i.e. the fraction of
  // this output pixel's footprint that lies over THIS body's marched flesh. Below one half the pixel CENTRE sits over
  // misses, and a Newton-converged point there is on the silhouette's far side - a lit halo
  // outside the body - so the pixel is left to the net, which keeps owning that rim.
  if (wsum < 0.5) { discard; }
  // View depth to distance along THIS pixel's ray - cosRay is minus the view-space z of rd.
  var t = clamp((zsum / wsum) / max(cosRay, 1e-4), 0.0, tMax);
  var hit = false;
  var hitBest = -1;
  var hitNearWound = false;
  var hitField = vec4<f32>(0.0);
  var pRef = camPos + rd * t;
  var dres = mapBody(pRef, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
  // aaCfg.x is the footprint RADIUS per unit distance for one MARCH-RES pixel - see the
  // PARAMS doc above - so at distance t a MARCH texel spans 2*t*aaCfg.x across and an
  // OUTPUT pixel, being half the march texel, spans t*aaCfg.x. This is the march texel.
  let texelFoot = 2.0 * t * aaCfg.x;
  if (abs(dres.x) > refineCfg.y * max(texelFoot, 1e-4)) { discard; }
  for (var k = 0; k < i32(refineCfg.w); k = k + 1) {
    t = t + dres.x;
    pRef = camPos + rd * t;
    dres = mapBody(pRef, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
  }
  hit = true;
  hitBest = i32(dres.y);
  hitField = dres;
  hitNearWound = dres.z > 0.5;
  // t*aaCfg.x is one OUTPUT pixel's world footprint (the same framing as texelFoot above
  // and the PARAMS doc), so refineCfg.z scales the stencil in output-pixel footprints.
  // The floor exists because the footprint goes to zero at the near plane and a stencil
  // small enough to vanish into float spacing would collapse calcNormal's four taps onto
  // the same value - an undefined normal. It sits far BELOW the march's 0.0015 default
  // on purpose - the refined point is already ON the surface after the Newton steps, so
  // there is no walk tolerance to straddle and a tight stencil is both safe and the whole
  // point of the pass - while 2e-4 is still ~1e3 ulps of a metre-scale coordinate.
  gNormalEps = max(refineCfg.z * t * aaCfg.x, 2e-4);
`;

export const REFINE_PARAMS = MARCH_BODY_PARAMS.slice(0, MARCH_BODY_PARAMS.lastIndexOf(')')).replace(/\s*$/, '') +
  `,\n  marchTex: texture_2d<f32>,\n  cosRay: f32,\n  nearFar: vec2<f32>,\n  refineCfg: vec4<f32>,\n  normalTex: texture_2d<f32>\n) -> vec4<f32> {\n`;

export const REFINE_BODY = `fn refineBody${REFINE_PARAMS}${MARCH_IN_PACK}${MARCH_TRACE_SETUP}${REFINE_LOOP}${MARCH_TRACE_POST}${MARCH_BODY_SURFACE_PREP}${MARCH_BODY_LIGHT}${MARCH_IN_STRUCT}`;
