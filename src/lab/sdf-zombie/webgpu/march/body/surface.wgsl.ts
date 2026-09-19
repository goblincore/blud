// src/lab/sdf-zombie/webgpu/march/body/surface.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): surface prep and output readers.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.

/**
 * SECTION 3 of 4 — SURFACE PREP: the light-independent material terms the
 * deferred surface output needs, hoisted ABOVE the analytic flashlight
 * (hybrid deferred M1 task 2). The wet block and the glow term are verbatim
 * moves from the lighting tail; specPow is the legacy shine exponent given a
 * name. Nothing here reads L/keyC/keyI, H, or any light uniform, so the
 * legacy expansion's arithmetic is unchanged by the move.
 */
export const MARCH_BODY_SURFACE_PREP = /* wgsl */ `
  // Wounds are wetter than the surrounding skin; char is dead matte. Gore
  // rides the same boost: bloody chunk regions glisten like open wounds.
  // gloss pulls a painted surface toward a tight, fully wet highlight
  // whatever the flesh preset says: a lens on a matte clay character still
  // has to glint.
  //
  // Wound pass r2: wetness peaks at the fat/muscle boundary — the lip
  // glistens, the floor does not — instead of wetting the whole crater
  // uniformly. At woundDepthAmp 0 tissueDepth is 0, so lip is 1 and
  // wetWound is exactly the old max(wm, gore): the amp-0 guarantee survives
  // this line. Bone is matte — wet skin reflects, wet bone just looks
  // polished.
  let lip = 1.0 - smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
  let wetWound = max(wm * lip, gore);
  let woundWetBoost = mix(1.6, 2.15, faceGlowRedOnly);
  var wet = mix(surfCfg2.x * mix(1.0, woundWetBoost, wetWound) * (1.0 - cm) * select(1.0, 1.8, isOrgan), 1.0, gloss);
  // Melt wetness (task 6): liquefying flesh goes FULLY wet — the puddle
  // glistens. FLESH ONLY: bone stays matte (the anchor comment above — wet
  // skin reflects, wet bone just looks polished), and that matte-vs-wet
  // contrast is what makes pale bones read inside the red puddle. The same
  // branch now covers a RUPTURING body's bare bones (bareBoneU), so exposed
  // ribs read matte there too.
  // 1.6, the wound-wetness precedent: 2.2 was the first guess and the
  // near-level capture showed the whole grazing-angle puddle clipping to
  // paper white — wet, yes; blown out, no.
  if (bonePaleU > 0.0) {
    wet = mix(wet, select(1.6, 0.45, isBone), bonePaleU);
  }
  // The legacy shine exponent, named so the lighting tail and the deferred
  // surface output share one definition: the surface's roughness inverts the
  // shared light pass's exponent mapping against exactly this value.
  let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);

  // The eye REPLACES the flesh rather than adding to it.
  //
  // This used to be a pure addition, and it could not produce a red eye. Lit
  // flesh is already bright — roughly (1.16, 0.60, 0.62) with the key on it —
  // so adding a red emissive on top gives something like (4.2, 0.62, 0.63).
  // The output sRGB encode then clamps red at 1.0 while lifting the low
  // channels hard (0.62 encodes to 0.81), and the eye lands at RGB(255, 206,
  // 208): a pale cream, with the red only visible where it spilled onto the
  // darker skin around the socket. Exactly the reported symptom.
  //
  // Fading the flesh out under the glow also matches what the GLSL header
  // always claimed — "an eye should not be lit by the key light at all" — a
  // statement the code never actually implemented.
  let glow = faceGlowColor * faceGlow * faceCfg2.w
           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm)
           // PER-PRIM GLOW (hard-surface task 3): the same two lines keyed
           // off the prim row instead of the face texture. The colour is the
           // prim's OWN albedo (design C — a prim with color=ff2200 glow=0.9
           // glows red because it IS red), the strength is the authored
           // 0..1 from primClip.w. No faceCfg2.w global (the authored value
           // IS the strength) and no flicker (that is the face sheet's
           // heartbeat). Char kills it exactly as it kills the face glow:
           // burnt is burnt.
           + primAlbedo * primGlow * (1.0 - cm);
`;

/**
 * SECTION 4 of 4 — the legacy lighting tail: analytic flashlight, spec/
 * fresnel, scatter/AO probes, wound and level shadows, ambient bounce, the
 * fleshLit compose, the display conversion and the debug heatmaps. None of
 * this exists in the deferred surface entry.
 */
/**
 * NEURAL UPSCALE RUNTIME NORMALS (plan docs/superpowers/plans/2026-09-12-neural-upscale-runtime-normals.md).
 * The lit march leaves its final shading normal (WORLD space, unit, after the face bump — the
 * same `n` the capture's debug mode 9 returns) in a module-scope private, and this read fn hands
 * it to a renderer-level MRT as a second colour attachment. The private-global pattern is
 * deferred-sdf.ts's SDF_SURFACE_STATE: the declaration trails the fn because wgslFn's parser is
 * ^fn-anchored, and a read fn taking the march result as `dep` orders the read after the write.
 * ONE node must carry this source for every chain that includes MARCH_BODY (zombie-gpu.ts
 * `marchNormalRead` seeds buildMarchFn's chain) — a second wgslFn of the same text would
 * redeclare the var and fail every pipeline.
 */
export const MARCH_NORMAL_OUT = /* wgsl */ `fn readMarchNormal(dep: vec4<f32>) -> vec4<f32> {
  return gMarchNormal;
}
var<private> gMarchNormal: vec4<f32>;
var<private> gMarchAnchor: vec4<f32>;
`;

/** Run 4 (plan 2026-09-12-neural-upscale-run4-relief): the rest-space noise anchor of the hit
 *  (xyz) and the skin-detail gate detailAmp (w), for the output-resolution detail pass. Reads the
 *  private declared in MARCH_NORMAL_OUT — include that node, never redeclare the var. */
export const MARCH_ANCHOR_READ = /* wgsl */ `fn readMarchAnchor(dep: vec4<f32>) -> vec4<f32> {
  return gMarchAnchor;
}`;

/** Flame tongues (flame-tongues task 2): the burn mask of the hit (rgb =
 *  burn, char, fire) for the layer's fourth MRT attachment. The private it
 *  reads is declared beside gBurnEmit in the FOLD_GROUP helper chunk, which
 *  every march-chain shader already carries -- do NOT redeclare it here; and
 *  include marchAnchorRead so this read keeps the same lineage (and therefore
 *  the same eval order after the march output) as the anchor read above. */
export const MARCH_BURN_OUT = /* wgsl */ `fn readMarchBurn(dep: vec4<f32>) -> vec4<f32> {
  return gBurnOut;
}`;
