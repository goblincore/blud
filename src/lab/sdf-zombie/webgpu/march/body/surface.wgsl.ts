// src/lab/sdf-zombie/webgpu/march/body/surface.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): surface prep and output readers.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { GLOW_BLOCK } from './blocks/surface/glow.wgsl';
import { WET_BLOCK } from './blocks/surface/wet.wgsl';

/**
 * SECTION 3 of 4 — SURFACE PREP: the light-independent material terms the
 * deferred surface output needs, hoisted ABOVE the analytic flashlight
 * (hybrid deferred M1 task 2). The wet block and the glow term are verbatim
 * moves from the lighting tail; specPow is the legacy shine exponent given a
 * name. Nothing here reads L/keyC/keyI, H, or any light uniform, so the
 * legacy expansion's arithmetic is unchanged by the move.
 */
export const MARCH_BODY_SURFACE_PREP = /* wgsl */ `
${WET_BLOCK}

${GLOW_BLOCK}
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
