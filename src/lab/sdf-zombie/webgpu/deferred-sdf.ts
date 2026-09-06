// src/lab/sdf-zombie/webgpu/deferred-sdf.ts
//
// The SDF surface producer for the hybrid deferred experiment (spec:
// docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md). This module
// owns the surface-capture declarations and the MRT output assembly for a
// march material running in 'surface' mode — NOT a copied marcher. The trace
// and the material evaluation are the production ones, imported as text
// sections from march.wgsl.ts (MARCH_BODY_PARAMS / MARCH_BODY_TRACE /
// MARCH_BODY_SURFACE_PREP) and assembled into a second entry point,
// marchSurface, which exits BEFORE the first light-dependent term.
//
// WHAT THE SURFACE ENTRY WRITES (the task-1 contract, class 2 = flesh):
//
//   albedoRoughness  = vec4(unlit tissue/paint albedo, roughness)
//   normalMetalness  = vec4(normalize(worldHitNormal), metal)
//   emissionClass    = vec4(face/prim glow emission only, SURFACE_CLASS_FLESH)
//   surfaceDepth     = clip.z / clip.w of the traced hit — computed in
//                      createMarchMaterial from the returned hit distance with
//                      the SAME formula the legacy path uses, so both modes
//                      carry identical traced depth
//
// HOW THREE OUTPUTS REACH ONE TRACE. marchSurface returns vec4(albedo, t)
// exactly like the legacy entry, and stores the three other attachments in
// private globals (SDF_SURFACE_STATE). Three tiny readback functions return
// those globals; each takes the traced result as a `dep` input, so the TSL
// graph forces the march call to evaluate BEFORE any global read — an
// explicit data dependency, not assumed node ordering. createMarchMaterial
// additionally caches the trace with .toVar(), so the generated fragment has
// exactly ONE marchSurface call feeding all four attachments plus the
// hardware depthNode. Verified on the real adapter in the task-2 smoke (see
// docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md): one trace in the
// generated WGSL, reads follow the write.
//
// INTENTIONALLY ABSENT FROM M1 (legacy lighting-only terms — they are light
// or view dependent and would violate the unlit G-buffer rule): the analytic
// flashlight beam, key specular/fresnel compose, the backlit scatter field
// probe, the AO field probe, the traced wound soft shadow, the level shadow
// map, the enclosure ambient bounce, the highlight shoulder, the faceFlat
// relight mix, and the legacy display compensation (lodCfg.y). The deferred
// light pass replaces the first group with the shared 16-light evaluation;
// the rest are inventoried here and in the dev notes, NOT hidden in prelit
// material data. The glow->lit fade-out also differs: legacy REPLACES flesh
// under a glow, the deferred light pass ADDS emission on top of the lit
// surface.

import { wgslFn, mrt, vec4 } from 'three/tsl';
import {
  HELPERS, MARCH_BODY_PARAMS, MARCH_BODY_TRACE, MARCH_BODY_SURFACE_PREP,
} from './march.wgsl';
import { NORMAL_GRADIENT_HELPERS, NORMAL_GRADIENT_GAME_HELPERS } from './normal-gradient.wgsl';
import { SURFACE_CLASS_FLESH } from './deferred-surface';

/**
 * The surface-capture private globals. Declared at the tail of a function
 * source because three's wgslFn parser is ^-anchored on `fn` (the NG_STATE
 * pattern in normal-gradient.wgsl.ts); WGSL module-scope declarations are
 * visible regardless of order, so the function above them may write them.
 */
export const SDF_SURFACE_STATE = /* wgsl */ `fn sdfSurfaceStateReset() -> f32 {
  gSdfAlbedoRough = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  gSdfNormalMetal = vec4<f32>(0.0, 0.0, 1.0, 0.0);
  gSdfEmissionClass = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  return 0.0;
}
var<private> gSdfAlbedoRough: vec4<f32>;
var<private> gSdfNormalMetal: vec4<f32>;
var<private> gSdfEmissionClass: vec4<f32>;
`;

/**
 * First statement of the surface entry: reset ALL outputs per invocation,
 * before the trace's early returns (the occupancy/bone debug counters and
 * the flat-albedo seam) can bail out — a bailing fragment must leave the
 * empty-state reset in the globals, never stale data. Fragment invocations
 * start with zeroed private globals anyway (the gDebug* note in
 * march.wgsl.ts); this makes the contract explicit instead of relying on it.
 * A genuine MISS discards inside the shared trace, so nothing is written and
 * the target keeps its clear state (depth 1, class 0).
 *
 * SURFACE MODE REQUIRES debugCfg = 0 (the default everywhere): the debug
 * early-returns predate the G-buffer and would emit reset/empty attributes
 * at a computed depth. The deferred fixture never sets them.
 */
export const MARCH_SURFACE_PROLOGUE = /* wgsl */ `
  _ = sdfSurfaceStateReset();
`;

/**
 * The surface exit, replacing MARCH_BODY_LIGHT. Runs after the shared
 * SURFACE_PREP, so albedo/n/wet/specPow/glow/metal are the production
 * values. Roughness: the legacy model spends `wet` on specular INTENSITY at
 * the fixed specPow exponent, and the G-buffer has no per-pixel specular
 * intensity channel — so wetness folds into roughness: char/dry (wet < 1)
 * widens toward matte, wet (wet > 1) tightens. specPow itself is inverted
 * against the shared light pass's `shin = exp2((1 - rough) * 8) + 2`
 * (deferred-layer.ts), so a legacy 220-exponent gloss lands near roughness
 * 0.03 and the default flesh 128 lands near 0.12. An approximation by
 * construction — M1 is not pixel-identical relighting, and the mapping is
 * recorded here rather than hidden.
 */
export const MARCH_SURFACE_TAIL = /* wgsl */ `
  // ---- SURFACE OUTPUT (hybrid deferred M1 task 2) -------------------------
  // Exit BEFORE every light-dependent term. Everything written here is unlit
  // linear material data from the production hit evaluation above.
  var surfRough = 1.0 - log2(max(specPow - 2.0, 1.0)) / 8.0;
  surfRough = clamp(mix(1.0, surfRough, min(wet, 1.0)) / max(wet, 1.0), 0.04, 1.0);
  gSdfAlbedoRough = vec4<f32>(albedo, surfRough);
  gSdfNormalMetal = vec4<f32>(normalize(n), metal);
  gSdfEmissionClass = vec4<f32>(glow, ${SURFACE_CLASS_FLESH}.0);
  // vec4(albedo, t) exactly like the legacy entry: createMarchMaterial turns
  // t into the surfaceDepth attachment and the hardware depthNode with the
  // SAME clip formula, so both modes preserve the same traced hit depth.
  return vec4<f32>(albedo, t);
}
`;

/**
 * The surface entry. Same signature as marchBody — the params section is
 * shared, so createMarchMaterial's single positional binding block serves
 * both entries unchanged (the light/shadow slots are simply unread here).
 * The trace and surface-prep sections are the legacy text verbatim.
 */
export const MARCH_SURFACE =
  `fn marchSurface${MARCH_BODY_PARAMS}${MARCH_SURFACE_PROLOGUE}${MARCH_BODY_TRACE}${MARCH_BODY_SURFACE_PREP}${MARCH_SURFACE_TAIL}`;

/**
 * The readback bridge from the vec4 entry to the MRT outputs. `dep` is the
 * traced hit result — an unused INPUT, deliberately: it makes the TSL data
 * flow order every readback AFTER the march call that wrote the globals.
 * (A bare `.toVar()` caches the trace but does not by itself order an
 * independent read of module-scope state after it.)
 */
export const SDF_SURFACE_READ_ALBEDO = /* wgsl */ `fn sdfSurfaceReadAlbedo(dep: vec4<f32>) -> vec4<f32> {
  return gSdfAlbedoRough;
}`;
export const SDF_SURFACE_READ_NORMAL = /* wgsl */ `fn sdfSurfaceReadNormal(dep: vec4<f32>) -> vec4<f32> {
  return gSdfNormalMetal;
}`;
export const SDF_SURFACE_READ_EMISSION = /* wgsl */ `fn sdfSurfaceReadEmission(dep: vec4<f32>) -> vec4<f32> {
  return gSdfEmissionClass;
}`;

/**
 * One shared, dependency-ordered node chain for the surface entry AND its
 * readbacks. Sharing the folded tail node (identity, not source) is what
 * lets three's builder emit every helper — and the global declarations —
 * exactly once when the march and the readbacks meet in one material.
 * buildMarchFn's O(n) edge structure is load-bearing and boot-profiled;
 * this mirrors it, with SDF_SURFACE_STATE appended after DEPTH_PRE_FETCH.
 */
function buildSdfSurfaceChain() {
  const sources = [
    ...HELPERS, ...NORMAL_GRADIENT_HELPERS, ...NORMAL_GRADIENT_GAME_HELPERS,
    SDF_SURFACE_STATE,
  ];
  const nodes = sources.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  const tail = nodes.slice(-1);
  return {
    march: wgslFn(MARCH_SURFACE, tail),
    readAlbedo: wgslFn(SDF_SURFACE_READ_ALBEDO, tail),
    readNormal: wgslFn(SDF_SURFACE_READ_NORMAL, tail),
    readEmission: wgslFn(SDF_SURFACE_READ_EMISSION, tail),
  };
}

const chain = buildSdfSurfaceChain();

/** The surface-mode march entry node — createMarchMaterial selects it when
 *  built with output: 'surface'. */
export const sdfSurfaceMarch = chain.march;

/**
 * Assembles the four named MRT outputs for a surface-mode march material.
 *
 * `traced` MUST be the cached (.toVar) result of the sdfSurfaceMarch call:
 * every readback takes it as `dep`, so the generated fragment evaluates the
 * trace ONCE and every attachment read follows the write. `clipDepth` is the
 * WebGPU clip depth (clip.z / clip.w, already [0,1]) of the same traced hit.
 * Names match SURFACE_ATTACHMENT_NAMES — three's MRTNode matches outputs to
 * the render target's textures BY NAME.
 */
export function sdfSurfaceMrtNodes(traced: unknown, clipDepth: unknown) {
  return mrt({
    albedoRoughness: chain.readAlbedo({ dep: traced as never }),
    normalMetalness: chain.readNormal({ dep: traced as never }),
    emissionClass: chain.readEmission({ dep: traced as never }),
    surfaceDepth: vec4(clipDepth as never, 0.0, 0.0, 1.0),
  });
}
