export * from './march/layout';
export * from './march/math.wgsl';
export * from './march/primitives.wgsl';
export * from './march/melt';
export * from './march/shade-helpers.wgsl';
export * from './march/fields/carves.wgsl';
export * from './march/fields/wounds.wgsl';
export * from './march/fields/tissue.wgsl';
export * from './march/fields/volume.wgsl';
export * from './march/fields/groups.wgsl';
export * from './march/fields/bones.wgsl';
export * from './march/map-body.wgsl';
export * from './march/cone-march.wgsl';
export * from './march/body/params.wgsl';
export * from './march/body/trace.wgsl';
export * from './march/body/face.wgsl';
export * from './march/body/surface.wgsl';
export * from './march/body/light.wgsl';
export * from './march/body/entry.wgsl';
export * from './march/helpers';

// src/lab/sdf-zombie/webgpu/march.wgsl.ts
//
// WGSL port of march.glsl.ts. Kept as a near line-for-line translation on
// purpose — the WebGPU spec argues for raw WGSL over a TSL node graph
// specifically so this stays diffable against the GLSL original AND against
// validate.ts's CPU mirror. Nothing here checks that mirror automatically, and
// it backs click-to-shoot raycasting, so a human has to be able to read the
// two side by side.
//
// ============================ HOW wgslFn PARSES =============================
// Two hard constraints, both discovered the painful way, both presenting as
// the single unhelpful error "FunctionNode: Function is not a WGSL code."
//
//   1. Each source string must BEGIN with `fn`. three's declarationRegexp is
//      ^-anchored (see WGSLNodeFunction.js), so a leading comment — even a
//      blank first line — makes the parse fail outright. Every comment in this
//      file therefore sits OUTSIDE the template strings, or inside a body.
//
//   2. Helpers cannot simply be concatenated ahead of the entry point, because
//      of (1), nor after it, because WGSL requires declaration before use.
//      They are passed through wgslFn's second argument, `includes`, which is
//      the mechanism three provides for exactly this. See buildMarchFn().
// ============================================================================
//
// PRIMITIVE DATA ARRIVES AS A FLOAT TEXTURE, not uniform arrays. That is the
// substantive win of the migration: uniforms capped the body near 48
// primitives against a 224-vec4 floor, whereas a texture has no such ceiling
// (this device reports a 4 GB storage limit). Layout, MAX_PRIMS wide:
//
//   row 0  primA        xyz = endpoint A, w = radius
//   row 1  primB        xyz = endpoint B, w = blendK
//   row 2  primScale    xyz = ellipsoid scale, w = 1 when this is a carve
//   row 3  clusterBnds  xyz = centre, w = radius
//   row 4  clusterRange x = start, y = count, z = alive, w = oriented-cluster
//   row 5  wound        xyz = world position, w = radius
//   row 6  woundMeta    x = type (0 pellet, 1 blast, 2 burn), y = age
//   row 7  primQuat     xyzw = per-prim orientation (identity = 0,0,0,1)
//   row 8  restA        xyz = REST endpoint A, w = radius (0 = unwritten)
//   row 9  restB        xyz = REST endpoint B, w = blendK
//   row 10 primShape    x = radius at endpoint B (NEGATIVE = untapered),
//                       y = fold profile (0 round, 1 chamfer,
//                       2 round+BENT, 3 chamfer+BENT, +4 SHELL, +8 BOX),
//                       zw = groove depth and width
//   row 11 primBend     xyz = quadratic Bezier control point (world space),
//                       w = a BOX's corner-rounding fraction (see pack.ts;
//                       the two never coexist — bend= on a box is rejected)
//   row 12 primColor    xyz = linear albedo, w = 1 + gloss (w=0: flesh)
//   row 13 groupBnds    xyz = group sphere centre, w = radius
//   row 14 groupRange   x = start, y = count, z = distort, w = flag bitfield
//   row 15 clusterGps   x = first group, y = group count
//   row 16 primShell    x = half-thickness, y = rim, z = clip offset,
//                       w = hasClip (shell-fold prims only)
//   row 17 primClip     xyz = clip plane normal (shell-fold prims only),
//                       w = per-prim glow 0..1 (hard-surface task 3)
//   row 20 primWarp     x = wrinkle amplitude (m), yzw = per-axis wrinkle
//                       frequency (rad/m) (shell-fold prims only)
//   row 21 primStrand   x = strand count, y = wave, z = cycles, w = fat
//                       (hairlock 2026-09-05; zeros = no bundle — the exact
//                       no-op every pre-strand character packs)
//
// DIVERGENCE NOTE (2026-08-17, motion-polish task 3): row 7 / per-prim
// orientation exists ONLY here. The GLSL twin (march.glsl.ts) is FROZEN per
// owner decision and keeps world-axis ellipsoid squash — its lab renders a
// posed head with the old detached-visor artefact. Do not port this back.
// Rows 8-9 (task 6, rest-space noise) diverge the same way, same reason.
//
// Wounds ride the SAME texture rather than a uniform array, which the GLSL
// path had to use. MAX_WOUNDS (16) is comfortably under MAX_PRIMS (128), so
// they fit in two more rows and the whole per-body payload stays one upload.
//
// TRANSLATION TRAPS, all of which bite silently:
//   - `a ? b : c` becomes `select(c, b, a)` — the ARGUMENT ORDER FLIPS.
//   - GLSL's two-argument `atan(y, x)` is `atan2(y, x)` in WGSL; one-argument
//     `atan` keeps its name, so a mis-port compiles and returns nonsense.
//   - No implicit int/float conversion; loop bounds need explicit casts.
//   - WGSL has no `discard` expression, only the statement.
//   - WGSL RESERVES a long list of ordinary-looking identifiers that GLSL is
//     happy with: `meta`, `type`, `filter`, `set`, `shared`, `sample`, `mut`,
//     `ref`, `match`, `pass`, `line`, `precise`... `let meta = ...` cost a
//     blank page here. RESERVED_WORDS in march.wgsl.test.ts now fails the
//     build for any of them, so this is a test failure rather than a
//     pipeline-creation error nobody reads.






















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














