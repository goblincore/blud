// src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): marchBody parameter list.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.

// MARCH_BODY is assembled from NAMED SECTIONS (hybrid deferred M1 task 2) so
// the deferred surface entry — MARCH_SURFACE in deferred-sdf.ts — can share
// the trace and the material evaluation VERBATIM instead of copying a
// 600-line marcher:
//
//   `fn <entry>` + MARCH_BODY_PARAMS          one signature, both entries,
//                                             so createMarchMaterial's
//                                             positional bindings serve both
//                + MARCH_BODY_TRACE           ray setup, the march loop, the
//                                             hit, the albedo/normal chain
//                + MARCH_BODY_SURFACE_PREP    light-independent material
//                                             terms (wet, specPow, glow)
//                + MARCH_BODY_LIGHT           legacy only: flashlight through
//                                             display conversion and return
//
// The legacy expansion (MARCH_BODY at the bottom of this block) is the same
// text as before the split with exactly ONE reordering: the wet block and
// the glow term moved above the analytic flashlight. Neither reads L/keyC/
// keyI or any light uniform, so the arithmetic is unchanged; the move is
// what lets the surface entry exit before the first light-dependent term
// while sharing one source of truth. specPow is the legacy shine exponent
// given a name, nothing more.
export const MARCH_BODY_PARAMS = /* wgsl */ `(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  faceTex: texture_2d<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  spotPos: vec3<f32>,
  spotAxis: vec3<f32>,
  spotCfg: vec4<f32>,
  spotCfg2: vec4<f32>,
  spotColor: vec3<f32>,
  surfCfg: vec4<f32>,
  surfCfg2: vec4<f32>,
  surfCfg3: vec4<f32>,
  meatCfg: vec4<f32>,
  mottleColor: vec3<f32>,
  fatColor: vec3<f32>,
  boneColor: vec3<f32>,
  organColor: vec3<f32>,
  organAmp: f32,
  visceraColor: vec3<f32>,
  visceraDepth: f32,
  faceCfg: vec4<f32>,
  faceCfg2: vec4<f32>,
  faceGlowRedOnly: f32,
  faceCfg3: vec4<f32>,
  faceProj: vec4<f32>,
  faceAtlas: vec4<f32>,
  headAxes: vec3<f32>,
  faceGlowColor: vec3<f32>,
  lodCfg: vec4<f32>,
  woundShadowCfg: vec2<f32>,
  bounceCfg: vec4<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
  wallNegX: vec3<f32>,
  wallPosX: vec3<f32>,
  wallNegY: vec3<f32>,
  wallPosY: vec3<f32>,
  wallNegZ: vec3<f32>,
  wallPosZ: vec3<f32>,
  aaCfg: vec2<f32>,
  debugCfg: vec2<f32>,
  tileHdr: ptr<storage, array<vec2<u32>>, read>,
  tileEnt: ptr<storage, array<vec4<f32>>, read>,
  tileCfg: vec4<f32>,
  screenUV: vec2<f32>,
  startT: f32,
  occT: f32,
  shellIn: f32,
  shellOut: f32,
  perfCfg: vec4<f32>,
  prevT: f32,
  // Level-only shadow - perf round 2 task 7 — bound positionally LAST to
  // match createMarchMaterial's binding order. The gate is cfg.x — zero
  // keeps the march bit-identical to the pre-task-7 shader.
  // NOTE FOR THE NEXT EDITOR — the wgslFn parser regexes the parameter list
  // for name-colon-type pairs, COMMENTS INCLUDED, so no comment in here may
  // ever contain a colon between two words; a phantom input shifts every
  // binding by one slot and the pipeline dies on a type mismatch.
  levelShadowTex: texture_depth_2d,
  levelShadowMatrix: mat4x4<f32>,
  levelShadowCfg: vec4<f32>,
  // Quarter-res depth prepass - close-up task 3. Bound POSITIONALLY LAST,
  // in the same commit as the WGSL input - the meltCfg rule. cfg is
  // x enabled, y the coarse block footprint - radius per unit distance, the
  // 2*sqrt2 SDF-pixel half-diagonal - zw spare. Disabled or untouched, the
  // fetch hands back 0 and the max at the ray start folds it away, so
  // every view that never opts in marches bit-identical.
  // HAZARD - WIDER THAN THE COLON WARNING AT THE TOP OF THIS LIST - three
  // captures the parameter list UP TO THE FIRST CLOSE-PAREN, so a paren in
  // any comment here also truncates the parsed inputs; the missing params
  // then get float 0 substituted at the call, WGSL generation dies with a
  // JoinNode null deref, and every body renders unlit-black behind a
  // console-only error - 2026-09-05. A stray name-colon-type pattern in a
  // comment is the OLDER failure - the phantom input shifts every binding
  // by one slot. NO PARENS and NO COLONS in any comment in this list. Ever.
  depthPreTex: texture_2d<f32>,
  depthPreCfg: vec4<f32>,
  normalGradientCfg: vec4<f32>,
  // Static probe grid - lighting P3 step 1 - bound POSITIONALLY LAST. Five
  // slots. probeCfg x is the weight and 0 keeps the compose bit-identical.
  // NO PARENS and NO COLONS in this comment either.
  probeTex: texture_2d<f32>,
  probeMin: vec3<f32>,
  probeInvExtent: vec3<f32>,
  probeDims: vec4<f32>,
  probeCfg: vec4<f32>,
  // Flashlight bounce spot - lighting P4 step 1 - bound POSITIONALLY LAST.
  // Four slots. bounceSpotCfg x is the gain and 0 keeps the compose bit-identical.
  // NO PARENS and NO COLONS in this comment either.
  bounceSpotPos: vec3<f32>,
  bounceSpotNormal: vec3<f32>,
  bounceSpotRadiance: vec3<f32>,
  bounceSpotCfg: vec4<f32>,
  // GPU probe gather dynamic layer - lighting P3 and P4 - bound POSITIONALLY LAST.
  // Two slots. probeDynCfg x radiance gain, y visibility strength, both 0 keeps
  // the compose bit-identical. NO PARENS and NO COLONS in this comment either.
  probeDyn: ptr<storage, array<vec4<f32>>, read>,
  probeDynCfg: vec4<f32>,
  // Temporal reprojection start - plan 2026-09-10 - bound POSITIONALLY LAST.
  // lastTex is last fresh frame's layer with NDC depth in alpha, lastInvVp the
  // inverse view projection that made it, temporalCfg x enable y margin z slope
  // w max start. x at 0 keeps the march bit-identical.
  // NO PARENS and NO COLONS in this comment either.
  lastTex: texture_2d<f32>,
  lastInvVp: mat4x4<f32>,
  temporalCfg: vec4<f32>,
  // Instance record and config - crowd stage a - bound POSITIONALLY LAST in
  // the same commit as the kernel. instCfg x is the instance count, y is the
  // crowd-material flag - 1 = use instCentre/instHalf for the proxy box, 0 =
  // use the record's bodyCentre/bodyHalf. NO PARENS and NO COLONS in this
  // comment either.
  inst: ptr<storage, array<vec4<f32>>, read>,
  instCfg: vec4<f32>,
  // Crowd proxy box overrides - Task 5 - POSITIONALLY LAST after instCfg.
  // The instanced crowd material passes its per-instance box centre and half
  // extent as ATTRIBUTES so every instance's box entry maths uses its own
  // box; a per-body material binds zero vec3s and instCfg.y 0 selects the
  // record instead. NO PARENS and NO COLONS in this comment either.
  instCentre: vec3<f32>,
  instHalf: vec3<f32>,
  // Burning body - flame lab - bound POSITIONALLY LAST in the same commit as
  // the WGSL tail. burnCfg x is the per-view burn ramp and 0 keeps every
  // surface bit-identical. NO PARENS and NO COLONS in this comment either.
  burnCfg: vec4<f32>,
  burnNoiseScale: f32,
  burnRiseSpeed: f32,
  burnCharPatch: f32,
  burnFireGain: f32,
  // Fire coverage - flame lab fix pass - POSITIONALLY LAST after burnFireGain.
  // Slides the noise threshold so one field picks flame versus soot. Bound in
  // the same slot order in zombie-gpu.ts. NO COLONS in this comment.
  burnFireCoverage: f32,
  // Skeleton show-through - flame lab fix pass - POSITIONALLY LAST after
  // burnFireCoverage. Strength of the bone bleed through charring flesh, and
  // the shader scales it by char so a fresh body stays opaque. Bound in the
  // same slot order in zombie-gpu.ts. NO COLONS in this comment either.
  burnSkeleton: f32,
  // Skeleton reveal depth - flame polish task 4 - POSITIONALLY LAST after
  // burnSkeleton. Metres of flesh the bone probe reads through before its
  // smoothstep falloff reaches zero; the old shader constant 0.08 is now
  // BurnTuning.skeletonDepth so the panel can trade limb clutter for rib
  // coverage. Bound in the same slot order in zombie-gpu.ts. NO COLONS and NO
  // PARENS in this comment either.
  burnSkeletonDepth: f32
) -> vec4<f32> {
`;
