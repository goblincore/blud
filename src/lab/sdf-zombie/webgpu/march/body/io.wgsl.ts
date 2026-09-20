// src/lab/sdf-zombie/webgpu/march/body/io.wgsl.ts
//
// March phase-2 task 2 (plan docs/superpowers/plans/2026-09-20-march-phase-2.md):
// `MarchIn`, the packed form of the marchBody positional list — the plumbing
// the later tasks (trace()/surface()/light() taking `m: MarchIn`) build on.
//
// WHAT RIDES IN THE STRUCT, AND WHAT CANNOT. The WGSL spec restricts
// structure member types to plain data — "a pointer, texture, or sampler
// must not appear in any level of nesting within an array or structure"
// (gpuweb WGSL, Structure Types). Of MARCH_BODY_PARAMS' 99 parameters, 86 are
// values and go into MarchIn; 13 stay positional in the entry signature
// FOREVER, for as long as the entries carry the bindings themselves:
//   textures (9):  data, volumeTex, faceTex, segVolumeAtlas, segVolumeMeta,
//                  levelShadowTex, depthPreTex, probeTex, lastTex
//   storage ptrs (4): tileHdr, tileEnt, probeDyn, inst
// Where each excluded param sits in the list order, the struct marks the gap
// with a one-line comment, so an audit of struct-vs-list stays mechanical.
//
// The field order is EXACTLY MARCH_BODY_PARAMS' order minus those 13 —
// WGSL's positional struct constructor takes fields in declaration order,
// so the pack statement and the struct can only agree if both follow the
// list. The pack (MARCH_IN_PACK) is GENERATED from MARCH_BODY_PARAMS below;
// the struct is hand-written but pinned to the same list by io.wgsl.test.ts
// (names AND types AND order). Adding a parameter to MARCH_BODY_PARAMS
// without deciding struct-or-positional fails HERE, not at pipeline
// creation.
//
// Both exports follow the trailing-declaration pattern (SDF_SURFACE_STATE in
// deferred-sdf.ts, MARCH_NORMAL_OUT in surface.wgsl.ts): the string handed
// to wgslFn must begin with `fn`, so module-scope declarations trail the fn
// in the same string — WGSL module-scope declarations are order-independent.
//
// GATE NOTE (task 2, learned the loud way): unlike a dead struct/fn — which
// Tint strips pre-MSL so the emitted MSL matches baseline and the
// machine-global shader cache stays warm — the pack statement SURVIVES into
// the MSL, so the first boot after this (or any task 3+) change pays the
// ~1-3.5 min single-program cold compile and the pixel gate's occupancy
// wait times out ("occupancy never went live") until ONE warm-up boot has
// let the compile finish. Warm first, then gate.
import { MARCH_BODY_PARAMS } from './params.wgsl';

/** One parsed `name: type` head pair of the positional list. The type is the
 * head token only (up to the first `<`) — exactly what the handle test
 * needs, and all the pack needs is the name. */
interface WgslParamHead {
  name: string;
  type: string;
}

/** Parse the parameter list out of a wgslFn signature string. Mirrors
 * three's own propertiesRegexp (WGSLNodeFunction.js — same shape, same `i`
 * flag, which matters: the list names carry uppercase), after stripping
 * line comments. The hazard notes in params.wgsl.ts already forbid colons
 * and parens in the list's comments; stripping them first means this parser
 * does not depend on that discipline. */
const parseParamHeads = (src: string): WgslParamHead[] => {
  const code = src.replace(/\/\/[^\n]*/g, '');
  const list = code.slice(code.indexOf('(') + 1, code.indexOf(')'));
  const out: WgslParamHead[] = [];
  const re = /([a-z_0-9]+)\s*:\s*([a-z_0-9]+)/gi;
  for (let m = re.exec(list); m !== null; m = re.exec(list)) {
    out.push({ name: m[1]!, type: m[2]!.toLowerCase() });
  }
  return out;
};

const PARAM_HEADS = parseParamHeads(MARCH_BODY_PARAMS);
// Handles cannot be struct members — see the header. `texture_2d`,
// `texture_depth_2d`, `texture_3d`, `ptr` — the four heads that occur.
const VALUE_HEADS = PARAM_HEADS.filter((p) => !/^(texture|ptr|sampler)/.test(p.type));

/**
 * FIRST statement of BOTH entries (marchBody and refineBody): pack every
 * value parameter into MarchIn, in MARCH_BODY_PARAMS' exact order. Generated
 * from the positional list itself, so it cannot drift out of order when the
 * list changes.
 *
 * The struct is UNUSED below this line in task 2, on purpose: the body still
 * reads the positional names, and an unused local costs nothing (the backend
 * dead-stores it). Task 3 hands `m` to marchTrace and the positional names
 * start dying. Constructing the struct is side-effect-free — it reads only
 * the entry's inputs, never a g* private — so it may sit above the
 * loadInstance/gWindDrift prologue in MARCH_TRACE_SETUP without touching the
 * "first statement before anything folds" contract that comment describes.
 */
export const MARCH_IN_PACK = /* wgsl */ `  // MarchIn pack (phase-2 task 2) — every VALUE parameter in MARCH_BODY_PARAMS
  // order, generated in io.wgsl.ts. Unused below by design until task 3.
  var m: MarchIn = MarchIn(
    ${VALUE_HEADS.map((p) => p.name).join(',\n    ')},
  );
`;

/**
 * `struct MarchIn` — one field per VALUE parameter of MARCH_BODY_PARAMS, in
 * that list's order. The one-line comments are the list's own group headings;
 * the full per-parameter docs live in params.wgsl.ts, not here. Where a
 * texture or storage-pointer parameter sits in the list order, a comment
 * marks the gap instead of a field (WGSL forbids both as struct members —
 * see the header).
 *
 * Declared AFTER a tiny anchor fn because the chunk must begin with `fn` to
 * be wgslFn-parseable if ever built standalone (the trailing-declaration
 * pattern). Inside the assembled entries it trails MARCH_BODY_LIGHT /
 * REFINE_BODY_LIGHT at the very end of the string; marchBody's `var m:
 * MarchIn = MarchIn(...)` references it anyway because WGSL module-scope
 * declarations are order-independent.
 */
export const MARCH_IN_STRUCT = /* wgsl */ `fn marchIoAnchor() -> u32 {
  // Parse-rule anchor only (see the header) — dead code in every assembled
  // entry; the struct below is what the entries actually reference.
  return 0u;
}
struct MarchIn {
  // ---- geometry and volume ----
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  // (data, volumeTex, faceTex stay positional — textures)
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  // (segVolumeAtlas, segVolumeMeta stay positional — textures)
  // ---- wound/march config ----
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  // ---- colours ----
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  // ---- light ----
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  // ---- analytic spot ----
  spotPos: vec3<f32>,
  spotAxis: vec3<f32>,
  spotCfg: vec4<f32>,
  spotCfg2: vec4<f32>,
  spotColor: vec3<f32>,
  // ---- surface ----
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
  // ---- enclosure and debug ----
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
  // (tileHdr, tileEnt stay positional — storage pointers)
  tileCfg: vec4<f32>,
  screenUV: vec2<f32>,
  // ---- trace scalars ----
  startT: f32,
  occT: f32,
  shellIn: f32,
  shellOut: f32,
  perfCfg: vec4<f32>,
  prevT: f32,
  // ---- level shadow / depth prepass / normal gradient ----
  // (levelShadowTex, depthPreTex stay positional — textures)
  levelShadowMatrix: mat4x4<f32>,
  levelShadowCfg: vec4<f32>,
  depthPreCfg: vec4<f32>,
  normalGradientCfg: vec4<f32>,
  // ---- probe grid and bounce spot ----
  // (probeTex stays positional — a texture)
  probeMin: vec3<f32>,
  probeInvExtent: vec3<f32>,
  probeDims: vec4<f32>,
  probeCfg: vec4<f32>,
  bounceSpotPos: vec3<f32>,
  bounceSpotNormal: vec3<f32>,
  bounceSpotRadiance: vec3<f32>,
  bounceSpotCfg: vec4<f32>,
  // (probeDyn stays positional — a storage pointer)
  probeDynCfg: vec4<f32>,
  // ---- temporal ----
  // (lastTex stays positional — a texture)
  lastInvVp: mat4x4<f32>,
  temporalCfg: vec4<f32>,
  // ---- instancing ----
  // (inst stays positional — a storage pointer)
  instCfg: vec4<f32>,
  instCentre: vec3<f32>,
  instHalf: vec3<f32>,
  // ---- burn ----
  burnCfg: vec4<f32>,
  burnNoiseScale: f32,
  burnRiseSpeed: f32,
  burnCharPatch: f32,
  burnFireGain: f32,
  burnFireCoverage: f32,
  burnSkeleton: f32,
  burnSkeletonDepth: f32,
}
`;
