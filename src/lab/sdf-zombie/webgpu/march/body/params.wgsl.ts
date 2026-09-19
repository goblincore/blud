// src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): marchBody parameter list.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.


// Entry point. Returns rgb plus the hit distance in w, so the depth node can
// reconstruct the hit point without marching a second time.
//
// Parameter groups, all vec4-packed to keep the argument list survivable:
//   volumeTex  the baked hand volume (X1.26); every non-volume view binds
//              the shared 1-cubed fallback and leaves the enable flag 0
//   volumePose0 xyz = volume world centre, w = volume enable (0 = primitive)
//   volumePose1 xyzw = volume local-to-world quaternion
//   volumeMin   metric min corner of the volume AABB (local space)
//   volumeInvExtent 1/(boundsMax - boundsMin), per axis
//   volumeWarp  xyz = distal warp offset in local metres (CPU clamps it to
//               12 mm); zero vector = no warp. w is spare.
//   volumeClip  x/y = adjacent frame indices, z = mix alpha, w = frame
//               depth. Static v1 binds [0,0,0,nz] (slab 0, alpha 0 = the
//               exact v1 sample); the shared fallback binds [0,0,0,1]; a
//               v2 clip binds frameDepth and drives x/y/z per frame.
//   counts     x primCount, y clusterCount, z carveCount, w maxBlendK
//   counts2    x boneCount, y bareBones (melt task 5: fold inside-flesh
//              rows WITHOUT a wound - see mapBody), zw spare (wound pass r2;
//              counts was already full and woundCfg2.w is the volume hitEps
//              override, not spare)
//   meltCfg    x melt progress 0..1 (zombie melt task 6) — drives the
//              flesh-only wet-red albedo/gloss ramp below; yzw spare.
//              0 everywhere except a melting body and its released bone
//              chunks, so every other view shades bit-identical
//   marchCfg   x steps, y stepMul, z silhouetteNoiseAmp
//   woundCfg   x count, y blendK, z rimSplay, w rimOffset
//   woundCfg2  x rimWidth, y relaxation factor, z shellAmp (silhouette shell)
//   lightCfg   x keyIntensity, y fillIntensity
//   spotPos    world position of the analytic flashlight (dungeon task 7)
//   spotAxis   normalised beam axis, pointing AWAY from the lamp
//   spotCfg    x intensity (0 disables — lab parity), y cosInner,
//              z cosOuter, w range
//   spotColor  the beam's colour; the KEY blends toward it, the ambient
//              hue basis never moves
//   surfCfg    x specIntensity, y specRoughness, z fresnelBoost, w translucency
//   surfCfg2   x wetness, y surfaceNoiseAmp, z mottleAmp, w mottleScale
//   surfCfg3   x woundDepthAmp (0 = ramp off, shades as before), y fatDepth,
//              z muscleDepth, w visceraAmp (0 = viscera stop off; was SPARE
//              after the torn-fibre pass was cut 2026-09-02)
//   mottleColor  the colour the mottle mixes toward (linear RGB)
//   fatColor   subcutaneous fat for the wound tissue ramp (linear RGB)
//   visceraColor  cavity interior for the viscera stop (linear RGB); darker
//              than deepColor so it separates by VALUE — combat range
//   visceraDepth  depth at which muscle gives way to cavity, metres
//   faceCfg    x enabled, y strength, z forward (+1/-1), w relief
//   faceCfg2   x projMode (0 planar, 1 spherical), y mean, z glowThreshold,
//              w glowStrength
//   faceGlowRedOnly  opt-in bright red mask, also enabled for Replace faces
//   faceCfg3   x glowFlicker, y timeSeconds, zw = noise root shift (xz world;
//              the y shift is zero — root translation is ground-plane)
//   faceProj   xy = scale of head-space xy -> uv, zw = uv centre
//   headQuat   xyzw = the rigid head rotation (rig-bind headQuatOf); the face
//              projection un-rotates by its conjugate so the painted face
//              rides the rotating skull. Identity (0,0,0,1) on statues/chunks.
//   faceAtlas  xy = uv scale, zw = uv offset — crops the head out of the sheet
//   lodCfg     x aoEnabled, y legacyGamma, w goreStrength (0 body, 1 chunk views)
//   aaCfg      x pixelConeK — the ray's footprint RADIUS PER UNIT DISTANCE
//              for ONE pixel (tan(fovY/2) / viewportHeight), the same
//              quantity coneMarch uses at tile granularity; y strength
//              (0 = off, the shipping default)
//   woundShadowCfg  x strength (0 = off — the whole march is skipped),
//                   y softness k (iq's penumbra factor; ~8 hard, ~16 very soft)
//   bounceCfg  x probeWeight (0 = flat fill, bit-identical to pre-bounce),
//              y ambientGain, z ceilingEnabled, w chromaGain
//   tileHdr/tileEnt/tileCfg/screenUV  per-tile fold lists (perf task 5,
//                now compute-binned): tileHdr is a storage array of per-tile
//                (base, count) pairs; tileEnt the linear entry stream of
//                TILE_STRIDE vec4s per entry (bound sphere; the
//                ROW_GROUP_RANGE pack; meta with bodyIndex in x). cfg x
//                enabled / y tilesPerRow / z tile px / w tile rows. ALWAYS
//                bound (a one-element zero fallback when off); screenUV picks
//                this pixel's tile. THE GRID COMES FROM CFG, never from a
//                resource dimension — storage buffers are allocated once at
//                the worst-case size and cannot be resized, so adaptive
//                resolution changes rungs by moving these numbers alone.
//   boxMin/boxMax  the enclosure bounds ambientAt derives wall planes from
//   wallNegX..wallPosZ  the six wall albedos, linear RGB
//
// LOD NOTE: most quality levers are guarded by their own amplitude reaching
// zero (silhouette noise, surface noise, translucency, face, wounds), so the
// LOD system drives them through uniforms that already existed. AO needs
// lodCfg.x because "no ambient occlusion" has no amplitude to turn down;
// the gore mask took the spare lodCfg.w for the same reason — "no gore"
// has no colour amplitude to fade to.

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
