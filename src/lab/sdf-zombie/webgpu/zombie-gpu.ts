// src/lab/sdf-zombie/webgpu/zombie-gpu.ts
//
// The WebGPU view of the body: packs primitives into a float data texture and
// drives the WGSL march.
//
// The pure modules (build-body, pack, clusters, validate, face, damage, sever,
// gib-chunks) are shared with the WebGL path UNCHANGED. That is the point of
// the migration being lab-scoped — only the rendering tail differs, so a bug in
// the field maths cannot diverge between the two paths.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture, texture3D, float,
  cameraProjectionMatrix, cameraViewMatrix, cameraNear, cameraFar, modelWorldMatrix, normalize, sub, mul, add, screenUV,
  storage,
} from 'three/tsl';
import type { BuildResult } from '../build-body';
import { packBody, PRIM_STRIDE, W_BONE, W_ORGAN } from '../pack';
import { MAX_PRIMS, MAX_CLUSTERS, BONE_SEG_MAX } from '../validate';
import { MAX_WOUNDS } from '../damage';
import { chunkPoint, squashFactors, type Chunk } from '../gib-chunks';
import type { FleshMaterial, LightPreset } from '../material';
import type { Primitive, Vec3 } from '../types';
import { bendCtrl, qRotate, sub as vsub } from '../vec';
import { chunkExtent, tornEndRadius } from '../extent';
import { createFallbackHandVolumeTexture } from './hand-volume';
import {
  TILE_SIZE_PX,
} from './tile-cull';
import { NORMAL_GRADIENT_HELPERS, NORMAL_GRADIENT_GAME_HELPERS } from './normal-gradient.wgsl';
import type { TileGroupInput } from './tile-cull';
import type { ComputeTileBinding } from './tile-bin-compute';
import {
  HELPERS, MARCH_BODY, CONE_MARCH, DEPTH_PREPASS_MARCH, DATA_ROWS,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT, ROW_REST_A, ROW_REST_B, ROW_PRIM_SHAPE,
  ROW_PRIM_BEND, ROW_PRIM_COLOR, ROW_PRIM_SHELL, ROW_PRIM_WARP, ROW_PRIM_STRAND, ROW_PRIM_CLIP,
  ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_GROUP_BOUNDS, ROW_GROUP_RANGE, ROW_CLUSTER_GROUPS,
  ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS,
} from './march.wgsl';
import { sdfSurfaceMarch, sdfSurfaceMrtNodes } from './deferred-sdf';
import {
  encodeSurfaceClass, SURFACE_CLASS_FLESH,
  type ShadowReceiver, type SurfaceOutputOptions,
} from './deferred-surface';

export interface ZombieGpuView {
  object: THREE.Object3D;
  /** The coarse cone-march twin, rendered into the pre-pass targets. */
  coneObject: THREE.Object3D;
  /** The quarter-res depth-prepass twin (close-up task 3) — same proxy
   *  geometry, distance-writing material, rendered into the layer's
   *  depthPre target only when the caller passes opts.depthPre. Present but
   *  never rendered when omitted, so callers may add it to the scene
   *  unconditionally. */
  depthPreObject?: THREE.Object3D;
  /** Live uniforms — the WebGPU stand-in for `ShaderMaterial.uniforms`. */
  uniforms: MarchUniforms;
  /** The 3D texture bound to the march's volume slot (X1.26). The shared
   *  1-cubed fallback while the volume branch stays disabled; a view that
   *  created its own fallback disposes it in dispose(). */
  volumeTexture: THREE.Texture;
  /** The packed prim DataTexture this view uploads to — the hull extraction
   *  kernel reads the same texture the march does. */
  dataTexture: THREE.Texture;
  /**
   * Re-upload after the body changes (sever, override edit, rig step).
   * `rest` is the same body in its authored rest pose (motion-polish task 6 —
   * the rest-space noise anchor); omitted, the posed prims double as rest,
   * which is right for never-rigged bodies.
   */
  update(body: BuildResult, rest?: BuildResult): void;
  /** Uploads wounds already transformed to world space by the caller.
   *  splay/offsetScales are the per-wound rim multipliers (WOUND_PROFILES);
   *  omitted, they default to 1 — chunk torn ends pass nothing and get 1s.
   *  caps are the per-wound depth-slab (inward normal + max depth); omitted
   *  = uncapped spheres (the lab — its look is pinned; old wounds). */
  setWounds(worldPositions: Vec3[], radii: number[], types: number[], ages: number[],
    splayScales?: number[], offsetScales?: number[],
    caps?: readonly ({ n: Vec3; depth: number } | null)[],
    owners?: readonly ({ cluster: number; start: number; count: number } | null)[]): void;
  /** Wound union-reach cull gate (close-up wound-cull task, 2026-09-05).
   *  Ships ON — the cull is a value no-op (outside the bound every per-wound
   *  reach test would `continue`). false parks the bound's radius at 1e9 (the
   *  no-cull identity) for the bench A/B; the computed radius is kept, so
   *  true restores it without a re-upload. */
  setWoundCull(on: boolean): void;
  /** The skull's centre and semi-axes, which the face projection normalises by. */
  setHeadShape(centre: Vec3, axes: Vec3): void;
  /** The rigid head rotation (rig-bind headQuatOf); identity resets it. */
  setHeadRotation(q: [number, number, number, number]): void;
  /** Drives the eye-glow flicker. Seconds. */
  setTime(seconds: number): void;
  /**
   * Anchors the surface/gore/silhouette noise to the body's root translation
   * (motion-polish): every fbm in the march samples at p - (x, 0, z), so the
   * texture rides the flesh while the body walks instead of the body sliding
   * through a stationary noise field. Ground-plane only — the y shift is
   * structurally zero (wander translates on the floor), which is why the
   * packed channel is a vec2. Statue bodies leave the default (0, 0).
   */
  setRootShift(x: number, z: number, bodyYaw?: number): void;
  /**
   * Swaps the face sheet, its crop rect (as uv scale/offset) and its mean.
   *
   * Does NOT dispose the outgoing texture: one sheet is shared across every
   * body in the scene, so a view that disposed on swap would pull the texture
   * out from under its neighbours. The caller owns the lifecycle.
   */
  setFaceTexture(tex: THREE.Texture, atlas: THREE.Vector4, mean: number): void;
  applyMaterial(m: FleshMaterial, light: LightPreset): void;
  /**
   * PER-TILE LISTS (perf task 5). Present only when the view was created
   * with opts.tiles. The caller bins the view's posed bound groups per frame
   * (tile-cull.ts TileBinner) and uploads the result here.
   */
  tiles?: ViewTileBinding;
  /** This view's posed bound groups, as the binner consumes them. Reads the
   *  LAST uploaded pack — call after update(). */
  getTileGroups(): import('./tile-cull').TileGroupInput[];
  /**
   * Flip the packBones layout (bone tubes). Default TRUE — bone rows in the
   * field. FALSE takes effect on the NEXT update(): bones leave the marched
   * field for the instanced-tube renderer and counts2.x counts organs only.
   */
  setPackBones(on: boolean): void;
  /**
   * One bound sphere per flesh cluster's bone rows (packBoneClusters). Default
   * FALSE — the old flat bone loop, bit-identical. TRUE takes effect on the
   * NEXT update(); __sdfGame.setBoneCull flips it live for the bench.
   * Equivalent to setBoneCullMode(on ? 'cluster' : 'off').
   */
  setBoneCull(on: boolean): void;
  /**
   * Three-way bone cull (bone-segment spheres): 'off' = the flat loop,
   * 'cluster' = one sphere per flesh cluster's bone rows, 'segment' = one
   * sphere per RIGID SEGMENT (skull / axial BoneFrame / limb bone / organs).
   * Default 'off'. Takes effect on the NEXT update(); the setter re-packs
   * the frozen pose immediately so the exactness gate can flip it live.
   */
  setBoneCullMode(mode: 'off' | 'cluster' | 'segment'): void;
  /**
   * Lift the march's nearWound gate on the inside-flesh rows (counts2.y) —
   * the melt's skeleton must fold WITHOUT a wound, because the melt sags
   * the flesh off the bones on purpose. Default FALSE; takes effect on the
   * NEXT update(). Only the melt sets this.
   */
  setBonesBare(on: boolean): void;
  /** Rebind opt-in sampled-skeleton resources. The caller owns them. */
  setSkeletonVolume(atlas: THREE.Texture, meta: THREE.Texture): void;
  /** Melt progress 0..1 → meltCfg.x (zombie melt task 6). Only the lab's
   *  melting body (and its released bone chunks) ever set this non-zero. */
  setMelt(progress: number): void;
  /** The level-shadow TextureNode this view's material binds (perf round 2
   *  task 7). Rebind `.value` to the twin light's real depthTexture once
   *  three has rendered it — same mechanism as setFaceTexture. */
  levelShadowTex: { value: THREE.Texture };
  dispose(): void;
}

/**
 * Builds the entry function with its helpers as `includes`.
 *
 * Not string concatenation: three's declarationRegexp is ^-anchored, so a
 * source that does not START with `fn` fails to parse, and WGSL requires
 * declaration before use so helpers cannot follow the entry point either.
 * `includes` is the mechanism three provides for precisely this, and it emits
 * them in the order given — hence HELPERS being dependency-ordered.
 *
 * Each helper is itself a node, built by folding so that every one carries the
 * helpers declared before it.
 */
function buildMarchFn() {
  // mapBody sits at a fixed place in HELPERS — after the things it calls,
  // before calcNormal which calls it — so any future per-body variant of it
  // would have to go in the SAME slot or WGSL's declaration-before-use rule
  // breaks. (The specialiser that used that slot was retired 2026-09-01,
  // perf r2 task 4: its emitted call signature had rotted against SD_PRIM's.)
  const sources = [...HELPERS, ...NORMAL_GRADIENT_HELPERS, ...NORMAL_GRADIENT_GAME_HELPERS];
  // EACH HELPER DEPENDS ON THE PREVIOUS ONE ONLY, not on every earlier one.
  // wgslFn includes a dependency's code transitively, and HELPERS is already a
  // strict declaration order, so a chain emits exactly the same WGSL as the
  // full cross-product did — with O(n) dependency edges instead of O(n^2).
  // At 26 helpers that is 25 edges rather than 325, and three's NodeBuilder
  // walks those edges repeatedly (NodeBuilder.get was 37.6% of a boot profile).
  const nodes = sources.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  return wgslFn(MARCH_BODY, nodes.slice(-1));
}

/** The default march entry (plus its dependency-ordered helpers), shared by
 *  the body views and the hands view. */
export const marchBody = buildMarchFn();

/** The coarse cone-march entry, sharing the same dependency-ordered helpers. */
const coneMarch = (() => {
  const nodes = HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  return wgslFn(CONE_MARCH, nodes.slice(-1));
})();

/** The quarter-res depth-prepass entry (close-up task 3), same helper chain.
 *  Its own chain rather than coneMarch's final node — buildMarchFn's edge
 *  structure is load-bearing and boot-profiled, and this page is not the
 *  place to optimise node sharing away from a shipping path. */
const depthPreMarch = (() => {
  const nodes = HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  return wgslFn(DEPTH_PREPASS_MARCH, nodes.slice(-1));
})();

/**
 * Stand-in face sheet, so the texture binding exists before the real art
 * loads. A 1x1 opaque white texel is the identity for everything the face does
 * — the multiplier divides by its own mean, and the relief differences are all
 * zero — so a body whose face never loads simply renders untextured rather
 * than black or pink. Exported for the hands view (which has no face at all).
 */
export function blankFaceTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat,
  );
  tex.needsUpdate = true;
  return tex;
}

/**
 * Every uniform the march reads.
 *
 * Defaults mirror zombie.ts's uniform block exactly, so both renderer paths
 * start from the same look and a divergence on screen means a port bug rather
 * than a different starting value.
 *
 * Values are packed into vec4s rather than one uniform per scalar because the
 * entry function takes them as PARAMETERS, and twenty-odd loose floats would
 * make an already-long signature unreadable. Slot meanings are documented on
 * MARCH_BODY in march.wgsl.ts and repeated in the comments below.
 */
/** The default uniform block — exported so the hands view can start from the
 *  same look defaults before copying the hero's live template. */
export function defaultUniforms(faceTex: THREE.Texture) {
  return {
    /** x primCount, y clusterCount, z carveCount, w maxBlendK */
    counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x boneCount, yzw spare (wound pass r2). Bone rows pack at
     *  [counts.x, counts.x + boneCount) and applyBones walks exactly that
     *  range, gated on nearWound. A NEW vec4 rather than a spare channel:
     *  counts was already full and woundCfg2.w is the volume hitEps
     *  override — NOT spare (see the woundShadowCfg note below). */
    counts2: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x melt progress 0..1 (zombie melt task 6), yzw spare. Drives the
     *  flesh-only wet-red albedo/gloss ramp in MARCH_BODY — the body goes red
     *  while still standing, before it visibly sags. 0 everywhere except a
     *  melting body (and the bone chunks it releases), so every other view
     *  shades bit-identical to before the slot existed. */
    meltCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x steps, y stepMul, z silhouetteNoiseAmp */
    marchCfg: uniform(new THREE.Vector3(96, 0.6, 0.016)),
    /** x count, y blendK, z rimSplay, w rimOffset */
    woundCfg: uniform(new THREE.Vector4(0, 0.015, 0.55, 1.15)),
    /**
     * x rimWidth, y relaxation factor, z shellAmp (silhouette shell noise).
     *
     * y: 1.4, from a measured sweep (10 bodies, occluder on, cooled, with an
     * interleaved control): 1.0 → 14.89 ms, 1.4 → 9.31, 1.6 → 9.81, 1.8 →
     * 10.17. Higher factors save steps but pay for them in overshoot
     * retractions — each one costs extra samples and drops the ray to plain
     * tracing — and the curve bottoms at 1.4. The textbook 1.6 was adopted
     * before it could be measured honestly. Purely a perf knob: the overshoot
     * test makes any factor exact on a conservative field. At or below 1.0
     * the relaxed path is off.
     *
     * z: shell-displacement silhouette amplitude (gobs-and-goo task 4). 0 is
     * off — normals still carry the fbm via calcNormal. 0.016, matching
     * marchCfg.z's silhouette value, turns the REAL field bumpy inside a thin
     * shell of the surface. Bench-gated OFF (task 4, 10 bodies, occluder on,
     * 0.70 scale, second of two runs quoted, all hiddenSteps 0): shell off
     * 12.03 ms, shell on 12.36 ms — over the 12 ms gate. A reverse-order
     * control (on first) gave on 10.79 / off 12.72, so the real shell cost is
     * inside the ±2 ms thermal noise; the gate is simply conservative. Drive
     * it live from the panel or __sdfLab.setShellDisplace.
     */
    // rimWidth 0.25, not 0.42 (cyclops 2026-08-23): at 0.42 a blast's lip was
    // an 11 cm wide, 3 cm tall torus — painted wet-red and glossed, it read as
    // a red BALL from the side (owner screenshots; with splay 0 the same wound
    // was a clean dish). 0.25 is a lip, not a donut.
    // y (relax) = 1.0, NOT the swept 1.4 optimum (owner isolation,
    // 2026-08-24 night): with wounds carved, the omega>1 paths — the
    // overshoot retraction and especially the deep-crossing retract guard —
    // fire at grazing wound angles, step rays BACKWARD, and do not reliably
    // reconverge: rays terminate at offset depths and whole screen-space
    // circles render the body from a displaced view (the 'distorted lens'
    // halo/clipping chased all day; killing relax live fixed it instantly,
    // occluder/adaptive/shading all exonerated by direct A/B). The ~1.6x
    // crowd speedup of 1.4 comes back when the retract guard learns to
    // reconverge (bound the back-step, then finish conservative) — do NOT
    // raise this default before that rework; the X1.10 sweep predates wounds
    // in the scene.
    woundCfg2: uniform(new THREE.Vector4(0.42, 1.0, 0, 0)),
    baseColor: uniform(new THREE.Color(0xc46a72)),
    deepColor: uniform(new THREE.Color(0x8c1420)),
    charColor: uniform(new THREE.Color(0x1a1214)),
    lightDir: uniform(new THREE.Vector3(0.45, 0.72, 0.53)),
    keyColor: uniform(new THREE.Color(1, 0.96, 0.92)),
    /** x keyIntensity, y fillIntensity */
    lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
    /** Flashlight world position. */
    spotPos: uniform(new THREE.Vector3(0, 0, 0)),
    /** Flashlight beam axis, normalised, pointing AWAY from the lamp. */
    spotAxis: uniform(new THREE.Vector3(0, 0, -1)),
    /** x intensity (0 disables), y cosInner, z cosOuter, w range. */
    spotCfg: uniform(new THREE.Vector4(0, 0.93, 0.80, 16)),
    spotColor: uniform(new THREE.Color(0.94, 0.96, 1.0)),
    /** x beamKeyGain (how hard the beam drives the key), y highlightShoulder
     *  (0 = hard clip, the pre-2026-09-01 behaviour; higher = more headroom
     *  above the knee so wounds keep contrast under direct light), z ambient
     *  key floor (what is left of the PRESET key when the beam is off — 1.0
     *  restores the old always-lit behaviour; 0, the shipped value, leaves an
     *  unlit body on ambientAt's fill term alone, which is what makes the
     *  carried lamp the reason anything is visible). */
    spotCfg2: uniform(new THREE.Vector4(4, 0.35, 0, 0)),
    /** x specIntensity, y specRoughness, z fresnelBoost, w translucency */
    surfCfg: uniform(new THREE.Vector4(0.95, 0.12, 0.85, 0.45)),
    /** x wetness, y surfaceNoiseAmp, z mottleAmp, w mottleScale */
    surfCfg2: uniform(new THREE.Vector4(1.0, 0.06, 0, 1.2)),
    /** x woundDepthAmp, y fatDepth, z muscleDepth, w visceraAmp — the
     *  wound tissue ramp (march.wgsl.ts TISSUE_RAMP). Defaults mirror
     *  henenlotter-latex; applyMaterial overwrites from the material. */
    surfCfg3: uniform(new THREE.Vector4(1.0, 0.004, 0.014, 1.0)),
    /** The colour the albedo mottle mixes toward. Inert while surfCfg2.z is 0,
     *  which is every stock preset — see FleshMaterial.mottleAmp. */
    mottleColor: uniform(new THREE.Color(0.62, 0.24, 0.30)),
    /** Subcutaneous fat for the wound tissue ramp (linear RGB). */
    fatColor: uniform(new THREE.Color(0.83, 0.72, 0.42)),
    /** Exposed bone (wound pass r2), mixed toward deepColor at the flesh
     *  junction. Matches the FleshMaterial preset default. */
    boneColor: uniform(new THREE.Color(0.71, 0.53, 0.35)),
    /** Cavity organ prims (organs r3), pale salmon. Mixed over the shaded
     *  albedo by organAmp; at amp 0 organ prims shade as plain bone. Matches
     *  the FleshMaterial preset default. */
    organColor: uniform(new THREE.Color(0.72, 0.32, 0.30)),
    organAmp: uniform(1),
    /** Cavity interior for the viscera stop (entrails, linear RGB). Darker
     *  than deepColor so it separates by VALUE at combat range. Inert while
     *  surfCfg3.w (visceraAmp) is 0. Matches the FleshMaterial preset default. */
    visceraColor: uniform(new THREE.Color(0.28, 0.06, 0.10)),
    /** Depth beneath the original skin at which muscle gives way to cavity,
     *  metres (entrails). Matches the FleshMaterial preset default. */
    visceraDepth: uniform(0.045),
    /** x enabled (1 multiplier sheet, 2 decal sheet), y strength, z forward (+1/-1), w relief */
    faceCfg: uniform(new THREE.Vector4(0, 0.85, 1, 1.4)),
    /** x projMode (0 planar, 1 spherical), y mean, z glowThreshold, w glowStrength */
    // 0.88, not the 0.72 this used to be. Measured off the sheet: at 0.72 the
    // mask covers 314 texels spanning y 0-35 — most of the upper face — while
    // at 0.9 it is 30 texels in a tight band at y 20-25, which is the eyes and
    // nothing else. The loose value only ever worked because the glow was a
    // faint ADDITIVE tint that spilled unnoticeably; now that the eye replaces
    // the flesh under it, a loose threshold paints a solid red patch across
    // the brow. Re-measure this if the art changes.
    faceCfg2: uniform(new THREE.Vector4(0, 0.5, 0.88, 1.6)),
    faceGlowRedOnly: uniform(0),
    /** x glowFlicker, y timeSeconds, zw = noise root shift xz (setRootShift —
     *  the only spare vec2 in this uniform set; see march.wgsl.ts). Chunks
     *  overwrite zw per frame with their own position instead. */
    faceCfg3: uniform(new THREE.Vector4(0.45, 0, 0, 0)),
    faceProj: uniform(new THREE.Vector4(1.15, 1.15, 0.5, 0.52)),
    faceAtlas: uniform(new THREE.Vector4(1, 1, 0, 0)),
    headCentre: uniform(new THREE.Vector3(0, 1.6, 0)),
    /** Rigid head rotation (xyzw quat); identity for statues and chunks. */
    headQuat: uniform(new THREE.Vector4(0, 0, 0, 1)),
    headAxes: uniform(new THREE.Vector3(0.12, 0.13, 0.12)),
    // Bright red, and deliberately over 1.0 on the red channel: an emissive
    // that only reaches 1.0 cannot read as a LIGHT, and a value above it is
    // also what a bloom pass would key on if one is added later.
    //
    // Green and blue are much lower than the WebGL path's 0.18/0.10, and that
    // divergence is deliberate. These are LINEAR values that go through the
    // output sRGB encode on this path, which lifts the low channels far more
    // than the clamped red one — 0.18 linear encodes to 0.46, so the "red" eye
    // came out salmon. At 1.6 strength these land near RGB(255, 42, 28).
    // The WebGL path has no output encode (see the parity note), so its
    // numbers stay as authored; both converge at the preset retune, X1.3.
    faceGlowColor: uniform(new THREE.Color(1.9, 0.012, 0.005)),
    /** The face sheet itself. Swapped by the panel; see setFaceTexture(). */
    faceTex: texture(faceTex),
    /** VOLUME BRANCH (X1.26 task B3), disabled by default so every existing
     *  view marches the primitive fold bit-for-bit as before:
     *  volumePose0.xyz = the volume's world centre, .w = enable flag;
     *  volumePose1 = local-to-world quaternion (identity);
     *  volumeMin / volumeInvExtent = the manifest AABB in local metres and
     *    its per-axis uv normaliser;
     *  volumeWarp.xyz = distal warp offset in local metres (CPU clamps it to
     *    12 mm), zero = no warp. */
    volumePose0: uniform(new THREE.Vector4(0, 0, 0, 0)),
    volumePose1: uniform(new THREE.Vector4(0, 0, 0, 1)),
    volumeMin: uniform(new THREE.Vector3(0, 0, 0)),
    volumeInvExtent: uniform(new THREE.Vector3(0, 0, 0)),
    volumeWarp: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /**  volumeClip (X1.27 task C3) — x/y = adjacent frame indices, z = mix
     *   alpha, w = frame depth. The default [0,0,0,1] is the FALLBACK
     *   semantics: a 1-deep slab, frame 0, alpha 0 — every non-clip view
     *   (bodies, chunks, primitive hands) stays exactly where it was. A
     *   static v1 view binds [0,0,0,nz] (slab 0 of the v1 texture, the
     *   bit-identical X1.26 sample); a v2 clip view binds frameDepth and
     *   drives x/y/z per frame. No 0-depth sentinel exists in WGSL. */
    volumeClip: uniform(new THREE.Vector4(0, 0, 0, 1)),
    /**
     * x = aoEnabled, w = goreStrength (0 body, 1 chunk views).
     *
     * The two levers that need their own uniform: every other one is
     * switched off by driving its existing amplitude to zero, and the shader
     * branches on that. "No ambient occlusion" and "no gore mask" have no
     * amplitude to turn down.
     */
    // y = legacyGamma, default ON: presets read as tuned (see march.wgsl.ts).
    lodCfg: uniform(new THREE.Vector4(1, 1, 0, 0)),
    /**
     * Wound soft shadow (iq rsmshadows, gated on the wound zone — see
     * WOUND_SHADOW in march.wgsl.ts). x strength 0..1 (0 = the shadow march
     * never fires), y softness k (~8 hard edge, ~16 very soft). A NEW vec2
     * rather than a packed spare: every channel of woundCfg/woundCfg2/
     * surfCfg/lodCfg is already consumed (woundCfg2.w overrides hitEps in
     * volume mode — NOT spare), so nothing here could be reused safely.
     */
    woundShadowCfg: uniform(new THREE.Vector2(0.0, 12.0)),
    /**
     * ENVIRONMENT BOUNCE (lighting P1). The enclosure's bounds and its six
     * wall colours, from which `ambientAt` derives an analytic chromatic
     * ambient — no field sampling, by design and by test.
     *
     * bounceCfg: x probeWeight (0 = flat fill exactly as before, the
     * shipped default), y ambientGain, z ceilingEnabled, w chromaGain.
     *
     * Defaults describe the lab's Cornell box but contribute NOTHING until
     * probeWeight moves, so this whole block is inert on arrival.
     */
    /**
     * WIND (shell cloth). The world-space offset in METRES that a warped
     * shell's fold lattice has drifted — the host accumulates wind velocity
     * times elapsed time and writes the result, so the shader needs no clock
     * and every pass reads one number.
     *
     * A NEW uniform rather than a packed spare, for the reason woundShadowCfg
     * gives above: nothing in woundCfg/woundCfg2/surfCfg/lodCfg is free, and
     * `woundCfg2.w` in particular is the volume hitEps override despite what
     * an older comment in march.wgsl.ts called it.
     *
     * ZERO by default, which is exactly the field as authored: sdShell skips
     * the drift entirely when the warp branch is off, and subtracting a zero
     * vector is a no-op when it is on.
     */
    windDrift: uniform(new THREE.Vector3(0, 0, 0)),
    /**
     * THE BODY'S NOISE FRAME as (rootShiftX, bodyYaw, rootShiftZ) — the same
     * triple `noiseLocal` takes, and written by the same `setRootShift` that
     * already feeds faceCfg3.zw and lodCfg.z.
     *
     * It exists as its own uniform because the CONE PRE-PASS needs it and
     * has neither faceCfg3 nor lodCfg. Rebuilding the triple independently in
     * each entry point is how the two would drift apart, and a cone anchored
     * to a different frame than the march certifies emptiness against a
     * surface the march does not have.
     *
     * Zero is world-anchored, which is the pre-2026-09-05 behaviour and what
     * a statue wants.
     */
    bodyAnchor: uniform(new THREE.Vector3(0, 0, 0)),
    bounceCfg: uniform(new THREE.Vector4(0, 1, 1, 1)),
    boxMin: uniform(new THREE.Vector3(-2, 0, -2)),
    boxMax: uniform(new THREE.Vector3(2, 3.2, 2)),
    wallNegX: uniform(new THREE.Color(0.63, 0.06, 0.05)),
    wallPosX: uniform(new THREE.Color(0.15, 0.48, 0.09)),
    wallNegY: uniform(new THREE.Color(0.73, 0.71, 0.68)),
    wallPosY: uniform(new THREE.Color(0.73, 0.72, 0.70)),
    wallNegZ: uniform(new THREE.Color(0.73, 0.71, 0.68)),
    wallPosZ: uniform(new THREE.Color(0.73, 0.71, 0.68)),
    /**
     * Debug instrumentation (perf-plan task 2): x = 0 off / 1 steps
     * heatmap / 2 prims heatmap. INERT until the march consumes it — the
     * bench page (bench-main.ts) sets it per body under ?debug=steps|prims,
     * and MARCH_BODY reads it only inside `if (debugCfg.x > 0.5)` guards so
     * the shipping path (x 0) pays nothing. y/w are spare.
     */
    /**
     * Antialiasing epsilon (2026-08-25). x = the ray's footprint RADIUS PER
     * UNIT DISTANCE for one pixel — tan(fovY/2) / sdfPassHeight, the same
     * quantity coneMarch uses at tile granularity. y = strength, 0 = OFF.
     *
     * Ships off: it prefilters geometry below Nyquist (real AA, and fewer
     * steps with it) but mapBody under-reports Euclid distance by the group
     * distortion factor, so a large epsilon can stop rays short in
     * high-distortion regions. See the hitEps block in march.wgsl.ts.
     */
    aaCfg: uniform(new THREE.Vector2(0.02, 0)),
    debugCfg: uniform(new THREE.Vector2(0, 0)),
    /** Perf round 2 seams (plan 2026-09-01): x hull-exit tMax bound, y wound
     *  early-out, z near-wound step multiplier override (2026-09-04; 0 = the
     *  compiled WOUND_STEP_MUL), w spare. All zero = the pre-plan shader,
     *  which is what the lab binds. */
    perfCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** x legacy/hybrid, y beauty/normal/eligibility, zw reserved. */
    normalGradientCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
    /** Wound union-reach bound (close-up wound-cull task, 2026-09-05): xyz
     *  centre, w radius — one sphere covering every wound's reach, computed
     *  by setWounds from the live woundCfg/woundCfg2 (woundReachBound below).
     *  applyWounds tests it BEFORE the wound loop; outside it, every loop
     *  iteration would early-out anyway, so the skip is a value no-op.
     *  Default w = 1e9 is the NO-CULL identity: views whose wounds are
     *  written without a bound (chunk torn ends, the hands view) pay the
     *  loop exactly as before. __sdfGame.setWoundCull flips w between the
     *  computed radius and 1e9 for the A/B bench. */
    woundBound: uniform(new THREE.Vector4(0, 0, 0, 1e9)),
    /** Half extents of the view's proxy box, world space (perf round 2 task
     *  5): the accumulated-depth gate's conservative per-body ray entry —
     *  box ⊇ hull ⊇ flesh, so nothing of this body is nearer than the
     *  ray-box entry. The box CENTRE rides the mesh's model matrix, not a
     *  uniform. (0,0,0) is a safe identity: the degenerate point at the mesh
     *  origin only ever discards when even that point lies beyond prevT. */
    bodyHalf: uniform(new THREE.Vector3(0, 0, 0)),
    /**
 * PER-TILE PRIMITIVE LISTS (perf task 5, now compute-binned). x enabled,
 * y tiles-per-row, z tile px size, w tile rows. INERT at x=0: MARCH_BODY
 * reads it once per pixel and the cluster walk applies exactly as before.
 * A view opts in by passing a ComputeTileBinding as `tiles` to
 * createZombieGpuView and binning per frame; every other view keeps this at 0
 * and binds the shared one-element fallback buffers (never read while x stays
 * 0). THE GRID IS CARRIED HERE, never inferred from resource dimensions —
 * that inference is what broke under adaptive resolution on the old
 * DataTexture path.
 */
    tileCfg: uniform(new THREE.Vector4(0, 0, TILE_SIZE_PX, 0)),
    /** Level-only shadow (perf round 2 task 7). The matrix is copied from
     *  the twin light's `shadow.matrix` each frame by the owner; cfg =
     *  (enabled, normalBias m, depthBias, spare) with enabled 0 — the
     *  shader returns 1.0 before sampling, so every view (lab, hands, gibs)
     *  rides inert until the game page's seam turns it on. normalBias
     *  0.02 m keeps the body's own surface off the shadow plane; 0.05 is
     *  the ceiling — past it the shadow visibly slides off the body. */
    levelShadowMatrix: uniform(new THREE.Matrix4()),
    levelShadowCfg: uniform(new THREE.Vector4(0, 0.02, 0.0005, 0)),
    /** STATIC PROBE GRID (lighting P3 step 1, lab spike). probeTex is the
     *  packed L1-SH probe texture (3 RGBA32F texels per probe, see
     *  probe-grid.ts packProbeTexture); a TextureNode so the lab can swap
     *  `.value` after a rebuild without recompiling. probeCfg.x is the
     *  weight toward the probe irradiance (0 = bit-identical to the
     *  ambientAt result, which is what every non-lab view rides), .y the
     *  gain applied to the probe irradiance. The 1x1 fallback plus x = 0
     *  keeps the fetch out of every view that never opts in. */
    probeTex: texture(fallbackProbeTexture()),
    probeMin: uniform(new THREE.Vector3(0, 0, 0)),
    probeInvExtent: uniform(new THREE.Vector3(0, 0, 0)),
    probeDims: uniform(new THREE.Vector4(1, 1, 1, 0)),
    probeCfg: uniform(new THREE.Vector4(0, 0.25, 0, 0)),
    /** FLASHLIGHT BOUNCE SPOT (lighting P4 step 1). The beam's lit patch on
     *  the level as one analytic disc light: position, normal, radiance and
     *  cfg (x gain — 0 is bit-identical — y radius). Rewritten per frame by
     *  the game from computeBounceSpot; the lab leaves it at 0. */
    bounceSpotPos: uniform(new THREE.Vector3(0, 0, 0)),
    bounceSpotNormal: uniform(new THREE.Vector3(0, 1, 0)),
    bounceSpotRadiance: uniform(new THREE.Vector3(0, 0, 0)),
    bounceSpotCfg: uniform(new THREE.Vector4(0, 0.5, 0, 0)),
  };
}

/**
 * Shared fallback bindings for views that do not opt into tiles. Zero-filled:
 * even if a stray enable ever flipped, the header count reads 0 and the fold
 * folds nothing — never garbage. Storage buffers, not textures: the march
 * reads them through ptr<storage> params now, so the fallback must be one
 * too (WebGPU will not bind a texture to a storage signature).
 */
let fallbackTileNodes: { header: unknown; entries: unknown } | null = null;
function fallbackTileBindings() {
  if (!fallbackTileNodes) {
    const h = new THREE.StorageBufferAttribute(1, 2);
    const e = new THREE.StorageBufferAttribute(3, 4);
    fallbackTileNodes = {
      header: storage(h, 'uvec2', 1).toReadOnly(),
      entries: storage(e, 'vec4', 3).toReadOnly(),
    };
  }
  return fallbackTileNodes;
}

/**
 * The no-map identity for the level-shadow binding (perf round 2 task 7).
 *
 * `light.shadow.map` is null until three has rendered the light once, and
 * the lab/hand/gib materials never get a light at all — but MARCH_BODY's
 * signature binds the depth-texture slot unconditionally, so EVERY material
 * needs some `texture_depth_2d`. cfg.x = 0 (the uniform default) makes
 * levelShadow() return 1.0 before its first textureLoad, so this texture is
 * never actually read. depth16unorm (UnsignedShortType) rather than the
 * DepthTexture default: a depth32float BINDING needs the 'depth32float'
 * GPU feature; 16-bit needs nothing.
 */
let fallbackLevelShadow: THREE.DepthTexture | null = null;
function fallbackLevelShadowTexture() {
  if (!fallbackLevelShadow) {
    const t = new THREE.DepthTexture(1, 1);
    t.type = THREE.UnsignedShortType;
    fallbackLevelShadow = t;
  }
  return fallbackLevelShadow;
}

let fallbackSegmentVolume: { atlas: THREE.Data3DTexture; meta: THREE.DataTexture } | null = null;
function fallbackSegmentVolumeTextures() {
  if (!fallbackSegmentVolume) {
    const atlas = new THREE.Data3DTexture(new Float32Array(8), 2, 2, 2);
    atlas.format = THREE.RedFormat;
    atlas.type = THREE.FloatType;
    atlas.minFilter = atlas.magFilter = THREE.NearestFilter;
    atlas.needsUpdate = true;
    const meta = new THREE.DataTexture(new Float32Array(BONE_SEG_MAX * 4 * 4), BONE_SEG_MAX, 4);
    meta.format = THREE.RGBAFormat;
    meta.type = THREE.FloatType;
    meta.minFilter = meta.magFilter = THREE.NearestFilter;
    meta.needsUpdate = true;
    fallbackSegmentVolume = { atlas, meta };
  }
  return fallbackSegmentVolume;
}

/** A tiled view's binning surface: delegates to the owner's GPU binding and
 *  flips this view's tileCfg gate. */
export interface ViewTileBinding {
  /** Bin this frame's posed groups (see ComputeTileBinding.bin). */
  bin(
    groups: TileGroupInput[], camera: THREE.PerspectiveCamera, maxBlendK: number,
    grid: { widthPx: number; heightPx: number },
  ): void;
  setEnabled(on: boolean): void;
  /** Per-ray sphere compaction of the tile list (prototype): with tiles
   *  enabled, tileCfg.x becomes 2 and the march drops entries whose inflated
   *  sphere the pixel's ray never enters. Off by default. */
  setRayCull(on: boolean): void;
  dispose(): void;
}

/**
 * The live uniform set — the WebGPU stand-in for `ShaderMaterial.uniforms`.
 *
 * Derived from the factory rather than declared by hand so the node types stay
 * exact: `wgslFn` takes Nodes, and a hand-written `{ value: Vector4 }` shape
 * would not satisfy it.
 */
export type MarchUniforms = ReturnType<typeof defaultUniforms>;

/**
 * Swizzle accessors on a wgslFn result.
 *
 * three 0.185 types wgslFn's return as a plain Node, which has no `.xyz` or
 * `.w` on it even though the node system supplies them at runtime. Casting
 * through a named shape keeps the two uses below honest about what they
 * expect, rather than scattering `as any` at each call site.
 */
type Swizzled = { xyz: unknown; w: unknown };

/** The level-shadow TextureNode createMarchMaterial attaches to its material
 *  (perf round 2 task 7). `.value` is rebound to the twin light's real
 *  depthTexture once three has rendered it — the same live-rebind mechanism
 *  as setFaceTexture. */
interface MaterialWithLevelShadowTex {
  levelShadowTex: { value: THREE.Texture };
}
interface MaterialWithSegmentVolume {
  segVolumeAtlas: { value: THREE.Texture };
  segVolumeMeta: { value: THREE.Texture };
}
/** Surface-mode march materials carry the packed emission-class uniform
 *  (M2 task 2): base class + shadow receiver bit, flippable at runtime via
 *  `.value` without rebuilding the pipeline. `surfaceKind` is the same
 *  value, frozen at construction, for route diagnostics. */
export interface MaterialWithSurfaceClass {
  surfaceClass: { value: number };
  surfaceKind: number;
}
/** The same handle, as the view exposes it. */
export interface LevelShadowTexHandle {
  value: THREE.Texture;
}

/**
 * Builds the marching material for one data texture + uniform set.
 *
 * Shared by the body and by every gib chunk. Both march the identical WGSL, so
 * three hashes them to ONE pipeline and only the bind groups differ — which is
 * what makes a two-dozen-chunk gib explosion affordable on this path.
 */
/**
 * Reads the coarse pass's start distance for this pixel.
 *
 * Deliberately a NEAREST fetch of the tile the pixel falls in: interpolating
 * two tiles would produce a distance neither of them proved safe, which is how
 * a ray ends up starting past geometry and the body develops holes.
 */
const CONE_FETCH_WGSL = /* wgsl */ `fn coneFetch(
  coneTex: texture_2d<f32>,
  screenUV: vec2<f32>,
  enabled: f32
) -> f32 {
  if (enabled < 0.5) { return 0.0; }
  let dims = vec2<f32>(textureDimensions(coneTex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(coneTex, c, 0).x;
}`;
/** Shared with the merged path, which needs the identical NEAREST tile fetch. */
export const coneFetchNode = wgslFn(CONE_FETCH_WGSL);
const coneFetch = coneFetchNode;

/**
 * Reads the occluder pre-pass's distance for this pixel.
 *
 * ZERO IS THE "NOTHING HERE" SENTINEL, and it has to be: the target is cleared
 * to zero, and clamping a ray's tMax to zero would erase the whole layer. A
 * real occluder distance of exactly zero would mean the camera is exactly on
 * the hull surface, which the near plane already excludes.
 */
const OCC_FETCH_WGSL = /* wgsl */ `fn occFetch(
  occTex: texture_2d<f32>,
  screenUV: vec2<f32>,
  enabled: f32
) -> f32 {
  if (enabled < 0.5) { return 1e9; }
  let dims = vec2<f32>(textureDimensions(occTex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let v = textureLoad(occTex, c, 0).x;
  if (v <= 0.0) { return 1e9; }
  return v;
}`;
export const occFetchNode = wgslFn(OCC_FETCH_WGSL);

/**
 * Reads one of the outer hull's distance targets (shell-hull-outer.ts).
 *
 * ZERO MEANS ABSENT, same contract as the occluder and for the same reason —
 * the targets clear to zero. But unlike the occluder the caller must choose
 * what "the shell is switched off" means per target, because entry and exit
 * want OPPOSITE identities: a disabled entry must read 0 (start at the camera,
 * change nothing) while a disabled exit must read 1e9 (bound nothing). Passing
 * that in as `disabledValue` keeps both in one helper and makes the asymmetry
 * explicit at the two call sites instead of hiding it in a branch.
 */
const SHELL_FETCH_WGSL = /* wgsl */ `fn shellFetch(
  shellTex: texture_2d<f32>,
  screenUV: vec2<f32>,
  enabled: f32,
  disabledValue: f32
) -> f32 {
  if (enabled < 0.5) { return disabledValue; }
  let dims = vec2<f32>(textureDimensions(shellTex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(shellTex, c, 0).x;
}`;
export const shellFetchNode = wgslFn(SHELL_FETCH_WGSL);

/**
 * Reads the accumulated frame state (sdf-layer's `prev` target) for the
 * front-to-back per-body passes (perf round 2 task 5).
 *
 * Returns the RAY DISTANCE to the nearest hit already recorded at this pixel,
 * or 1e9 when nothing is recorded (alpha >= 1.0 is the composite's "nothing
 * here" sentinel; the target clears to it) or when the gate is off — both
 * identities, so a march built without a prev source is bit-identical.
 *
 * Alpha holds WebGPU clip depth in [0,1] from three's perspective projection,
 * depth = far*(z-near)/((far-near)*z), so z = near*far / (far - depth*(far-near));
 * the ray distance is z over the cosine between the ray and the camera forward
 * axis (t is euclidean; z is the forward-axis distance, z = t*cos).
 */
const PREV_FETCH_WGSL = /* wgsl */ `fn prevFetch(prevTex: texture_2d<f32>, screenUV: vec2<f32>, enabled: f32, near: f32, far: f32, cosRay: f32) -> f32 {
  if (enabled < 0.5) { return 1e9; }
  let dims = vec2<f32>(textureDimensions(prevTex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let depth = textureLoad(prevTex, c, 0).a;
  if (depth >= 1.0) { return 1e9; }
  let z = near * far / max(far - depth * (far - near), 1e-6);
  return z / max(cosRay, 1e-4);
}`;
export const prevFetchNode = wgslFn(PREV_FETCH_WGSL);

/** The accumulated-depth gate's input, as the march material needs it. Same
 *  shape as OccluderSource: the texture binds unconditionally, the uniform
 *  gates the fetch. */
export interface PrevSource {
  texture: THREE.Texture;
  uniforms: { enabled: ReturnType<typeof uniform> };
}

/** The outer hull's entry/exit pre-pass output, as the march material needs
 *  it. Same shape as OccluderSource; a distinct type so the two hulls cannot
 *  be passed to each other's parameter by accident — they are opposites. */
export interface ShellSource {
  entry: THREE.Texture;
  exit: THREE.Texture;
  uniforms: { enabled: ReturnType<typeof uniform> };
}

/** The occluder pre-pass's output, as the march material needs it. */
export interface OccluderSource {
  texture: THREE.Texture;
  uniforms: { enabled: ReturnType<typeof uniform> };
}

/**
 * The cone pre-pass's output, as the march material needs it.
 *
 * Built by a factory so the node types stay exact — `wgslFn` takes Nodes, and
 * a hand-written `{ value: number }` does not satisfy it. Same reason
 * MarchUniforms is derived rather than declared.
 */
export function createConeUniforms() {
  return {
    /** Whether the FULL march starts from the pre-pass at all. */
    enabled: uniform(0),
    /** Footprint radius per unit distance for the level being rendered. */
    k: uniform(0.02),
    /** Whether the cone pass itself chains from the coarser level's result. */
    chain: uniform(0),
  };
}
export type ConeUniforms = ReturnType<typeof createConeUniforms>;

export interface ConeSource {
  /** Finest level, read by the full-resolution march. */
  texture: THREE.Texture;
  /**
   * Coarsest level, read by the cone pass itself when chaining.
   *
   * Fixed rather than swapped per pass: pass A simply runs with `chain` at 0
   * and ignores it, so no texture binding has to change between the two.
   */
  coarseTexture: THREE.Texture;
  uniforms: ConeUniforms;
}

/**
 * The quarter-res depth pre-pass's uniforms (close-up task 3). Same shape as
 * the cone's — the texture binds unconditionally, the uniforms gate and size.
 * enabled 0 is the full identity — the pass does not run and the march's
 * fetch hands back 0, which folds away inside the ray start's max().
 */
export function createDepthPreUniforms() {
  return {
    /** ONE vec4 — x enabled, y the coarse block footprint — and NOT two
     *  scalar uniforms composed with vec4(a, b, 0, 0) in the material
     *  literal: a JoinNode over uniform SCALARS breaks three's WGSL
     *  generation (WGSLNodeBuilder.getTypeFromLength null deref), the
     *  console error is easy to miss, and the material falls back to a
     *  pipeline with NO working uniforms — bodies render unlit-black and
     *  every uniform write goes dead (2026-09-05, boot-screenshot bisect).
     *  A vec4 uniform passed WHOLE is the house pattern in this file, and
     *  it is load-bearing. x 0 is the full identity — the pass does not
     *  run and the march's fetch hands back 0, folding away inside the ray
     *  start's max(). y is consumed twice on purpose: the coarse march's
     *  cone radius (the proof's own radius) and the full march's start
     *  backoff (insurance beyond the proof). One number, one source. */
    cfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
  };
}
export type DepthPreUniforms = ReturnType<typeof createDepthPreUniforms>;

/** The quarter-res depth pre-pass's output, as the march material needs it.
 *  Same shape as OccluderSource/ConeSource. */
export interface DepthPreSource {
  texture: THREE.Texture;
  uniforms: DepthPreUniforms;
}

/**
 * The 1×1 depth-prepass texture views bind when their caller passes no
 * DepthPreSource — same contract as fallbackLevelShadowTexture. The binding
 * must exist (MARCH_BODY declares the input), the fetch never reads it:
 * cfg.x 0 returns before the load. Zero-valued so even a stray read is the
 * "no start" identity rather than garbage.
 */
let fallbackDepthPre: THREE.DataTexture | null = null;
let fallbackDepthPreCfg: { value: THREE.Vector4 } | null = null;
let fallbackProbe: THREE.DataTexture | null = null;
/** One zero probe (3 RGBA texels) so views that never build a grid still
 *  bind a well-formed texture; probeCfg.x = 0 means it is never read. */
function fallbackProbeTexture() {
  if (!fallbackProbe) {
    const t = new THREE.DataTexture(new Float32Array(12), 3, 1, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    fallbackProbe = t;
  }
  return fallbackProbe;
}
function fallbackDepthPreTexture() {
  if (!fallbackDepthPre) {
    const t = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
    t.needsUpdate = true;
    fallbackDepthPre = t;
  }
  return fallbackDepthPre;
}
/** The no-source cfg identity — a shared all-zero vec4 UNIFORM, not a
 *  composed constant node (see createDepthPreUniforms for the JoinNode
 *  trap that forces this shape). */
function fallbackDepthPreUniform() {
  if (!fallbackDepthPreCfg) fallbackDepthPreCfg = uniform(new THREE.Vector4(0, 0, 0, 0));
  return fallbackDepthPreCfg;
}

/** Hull-refine (phase 0): per-fragment ray overrides so the SHIPPED march
 *  does a short band walk from a rasterised hull instead of a proxy-box
 *  march. `worldPos` feeds tMaxBox = length(worldPos - camPos) — pass the
 *  hull point pushed 2*band along the ray to bound the walk; `startT` is
 *  the hull point's own distance; `marchCfg` a separate steps uniform so
 *  the inner view's 96 stays untouched; `side` FrontSide for a hull. */
export interface MarchRayOverride {
  worldPos: unknown;
  startT: unknown;
  marchCfg: unknown;
  side: THREE.Side;
}

/** Builds the march material (depth-writing proxy-box shader). Exported for
 *  the hands view — one material builder, one look.
 *
 *  `volumeTex` (X1.26) may be the raw THREE.Texture (wrapped here in a
 *  texture3D node) or a pre-built texture3D node — the hands view passes its
 *  own node so it can rebind .value between the fallback and a loaded volume
 *  without recompiling a pipeline. */
export function createMarchMaterial(
  dataTex: THREE.Texture | ReturnType<typeof texture>,
  volumeTex: THREE.Texture | ReturnType<typeof texture3D>,
  u: MarchUniforms,
  march = marchBody,
  cone?: ConeSource, occluder?: OccluderSource,
  tiles?: { header: unknown; entries: unknown },
  shell?: ShellSource,
  prev?: PrevSource,
  levelShadow?: { light: THREE.SpotLight },
  rays?: MarchRayOverride,
  depthPre?: DepthPreSource,
  // Hybrid deferred M1 (task 2), POSITIONALLY LAST. 'lit' (the default) is
  // the existing path, byte-identical. 'surface' swaps the entry for
  // sdfSurfaceMarch — SAME signature, so the one binding block below serves
  // both — and replaces the lit outputNode with the four named G-buffer MRT
  // attachments (deferred-sdf.ts). The march argument is ignored in surface
  // mode: the whole point is that no caller-supplied variant of the marcher
  // may diverge from the production trace/material sections.
  output: 'lit' | 'surface' = 'lit',
  // Hybrid deferred M2 (task 2), POSITIONALLY LAST after `output`. Which
  // flashlight shadow map the surface samples — packed into emissionClass.a
  // via encodeSurfaceClass. Ignored in lit mode. Default 'full' keeps the M1
  // encoding (class 2, no bit) exact.
  shadowReceiver?: ShadowReceiver,
) {
  const dataNode = dataTex instanceof THREE.Texture
    ? texture(dataTex)
    : dataTex as ReturnType<typeof texture>;
  const volumeNode = volumeTex instanceof THREE.Texture
    ? texture3D(volumeTex)
    : volumeTex as ReturnType<typeof texture3D>;
  const segFallback = fallbackSegmentVolumeTextures();
  const segVolumeAtlasNode = texture3D(segFallback.atlas);
  const segVolumeMetaNode = texture(segFallback.meta);
  // Hoisted above the march call: the accumulated-depth gate's cosRay reads
  // the same ray the march integrates.
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  // Level-only shadow map (perf round 2 task 7). The node rides the march's
  // last three slots; its .value starts on the 1×1 fallback whenever the
  // twin light has not rendered yet (shadow.map is null before three's
  // first shadow pass) and is rebound to the real depthTexture per frame by
  // the game page — same rebind-without-recompile mechanism as
  // setFaceTexture below.
  const levelShadowTexNode = texture(
    levelShadow
      ? (levelShadow.light.shadow.map?.depthTexture ?? fallbackLevelShadowTexture())
      : fallbackLevelShadowTexture(),
  );
  const marched = (output === 'surface' ? sdfSurfaceMarch : march)({
    worldPos: (rays?.worldPos ?? positionWorld) as never,
    camPos: cameraPosition,
    data: dataNode,
    volumeTex: volumeNode,
    faceTex: u.faceTex,
    volumePose0: u.volumePose0,
    volumePose1: u.volumePose1,
    volumeMin: u.volumeMin,
    volumeInvExtent: u.volumeInvExtent,
    volumeWarp: u.volumeWarp,
    volumeClip: u.volumeClip,
    segVolumeAtlas: segVolumeAtlasNode,
    segVolumeMeta: segVolumeMetaNode,
    counts: u.counts,
    counts2: u.counts2,
    marchCfg: (rays?.marchCfg ?? u.marchCfg) as never,
    woundCfg: u.woundCfg,
    woundCfg2: u.woundCfg2,
    baseColor: u.baseColor,
    deepColor: u.deepColor,
    charColor: u.charColor,
    lightDir: u.lightDir,
    keyColor: u.keyColor,
    lightCfg: u.lightCfg,
    spotPos: u.spotPos,
    spotAxis: u.spotAxis,
    spotCfg: u.spotCfg,
    // ORDER MATTERS HERE. These are bound POSITIONALLY against the WGSL
    // signature in march.wgsl.ts, not by name, so a key sitting in the wrong
    // slot silently hands the shader a different uniform instead of failing.
    // spotCfg2 was declared after spotColor here while the signature has it
    // before, so every beam knob was reading spotColor's constant
    // (0.94, 0.96, 1.0) and no slider did anything (2026-09-01).
    spotCfg2: u.spotCfg2,
    spotColor: u.spotColor,
    surfCfg: u.surfCfg,
    surfCfg2: u.surfCfg2,
    surfCfg3: u.surfCfg3,
    mottleColor: u.mottleColor,
    fatColor: u.fatColor,
    boneColor: u.boneColor,
    organColor: u.organColor,
    organAmp: u.organAmp,
    visceraColor: u.visceraColor,
    visceraDepth: u.visceraDepth,
    faceCfg: u.faceCfg,
    faceCfg2: u.faceCfg2,
    faceGlowRedOnly: u.faceGlowRedOnly,
    faceCfg3: u.faceCfg3,
    faceProj: u.faceProj,
    faceAtlas: u.faceAtlas,
    headCentre: u.headCentre,
    headAxes: u.headAxes,
    headQuat: u.headQuat,
    faceGlowColor: u.faceGlowColor,
    lodCfg: u.lodCfg,
    woundShadowCfg: u.woundShadowCfg,
    bounceCfg: u.bounceCfg,
    boxMin: u.boxMin,
    boxMax: u.boxMax,
    wallNegX: u.wallNegX,
    wallPosX: u.wallPosX,
    wallNegY: u.wallNegY,
    wallPosY: u.wallPosY,
    wallNegZ: u.wallNegZ,
    wallPosZ: u.wallPosZ,
    aaCfg: u.aaCfg,
    debugCfg: u.debugCfg,
    tileHdr: (tiles?.header ?? fallbackTileBindings().header) as never,
    tileEnt: (tiles?.entries ?? fallbackTileBindings().entries) as never,
    tileCfg: u.tileCfg,
    screenUV: screenUV,
    startT: rays
      ? (rays.startT as never)
      : cone
        ? coneFetch({
            coneTex: texture(cone.texture),
            screenUV: screenUV,
            enabled: cone.uniforms.enabled,
          })
        : float(0),
    occT: occluder
      ? occFetchNode({
          occTex: texture(occluder.texture),
          screenUV: screenUV,
          enabled: occluder.uniforms.enabled,
        })
      : float(1e9),
    // 0 and 1e9 are the no-shell identities — see shellFetch. A material built
    // without a shell source therefore marches exactly as before.
    shellIn: shell
      ? shellFetchNode({
          shellTex: texture(shell.entry),
          screenUV: screenUV,
          enabled: shell.uniforms.enabled,
          disabledValue: float(0),
        })
      : float(0),
    shellOut: shell
      ? shellFetchNode({
          shellTex: texture(shell.exit),
          screenUV: screenUV,
          enabled: shell.uniforms.enabled,
          disabledValue: float(1e9),
        })
      : float(1e9),
    // Perf round 2 seams. Bound POSITIONALLY last, matching the WGSL
    // signature (see the ORDER MATTERS note above — a slot swap here
    // silently hands the shader the wrong uniform).
    perfCfg: u.perfCfg,
    // Accumulated-depth gate (perf round 2 task 5). Bound POSITIONALLY last —
    // prevT sits AFTER perfCfg in MARCH_BODY's signature. 1e9 is the no-gate
    // identity: a material built without a prev source marches exactly as
    // before.
    prevT: prev
      ? prevFetchNode({
          prevTex: texture(prev.texture),
          screenUV: screenUV,
          enabled: prev.uniforms.enabled,
          near: cameraNear,
          far: cameraFar,
          cosRay: mul(cameraViewMatrix, vec4(rayDir, 0.0)).z.negate(),
        })
      : float(1e9),
    // The fragment's own proxy box: centre from the mesh's world matrix,
    // half extents from the uniform above. Consumed by the accumulated-depth
    // gate — see MARCH_BODY's bodyEntry block.
    bodyCentre: mul(modelWorldMatrix, vec4(0.0, 0.0, 0.0, 1.0)).xyz,
    bodyHalf: u.bodyHalf,
    // Melt progress (zombie melt task 6). Bound between bodyHalf and the
    // level-shadow slots, matching MARCH_BODY's signature — positional, see
    // the ORDER MATTERS note above.
    //
    // IT MUST BE BOUND AT ALL, and the failure is quiet: MARCH_BODY declares
    // the input, and an unbound declared input logs "THREE.TSL: Input
    // 'meltCfg' not found in 'Fn()'" once at boot and then shades as ZERO.
    // The parked melt spike (c52b05b) added a uniform and a WGSL input and
    // no binding, and rendered as nothing at every amplitude while the
    // uniform read back correctly from the console — hours went into looking
    // for the bug on the shader side of a wire that was never connected.
    meltCfg: u.meltCfg,
    // Level-only shadow (perf round 2 task 7). Bound POSITIONALLY last —
    // MARCH_BODY's tail is bodyCentre, bodyHalf, meltCfg, levelShadow*, in
    // this order (see the ORDER MATTERS note above; a slot swap here silently
    // hands the shader the wrong uniform).
    levelShadowTex: levelShadowTexNode,
    levelShadowMatrix: u.levelShadowMatrix,
    levelShadowCfg: u.levelShadowCfg,
    // Wind drift and the body frame, POSITIONALLY LAST and in this order —
    // appended after the level-shadow slots in MARCH_BODY's signature too.
    // Bound in the same commit as the WGSL inputs, which is the rule the
    // meltCfg note above exists to enforce.
    windDrift: u.windDrift,
    bodyAnchor: u.bodyAnchor,
    // Wound union-reach cull (close-up wound-cull task, 2026-09-05). Bound
    // POSITIONALLY last — MARCH_BODY's tail is bodyCentre, bodyHalf, meltCfg,
    // levelShadow*, woundBound, in this order (see the ORDER MATTERS note
    // above).
    woundBound: u.woundBound,
    // Quarter-res depth prepass (close-up task 3) — POSITIONALLY LAST after
    // windDrift, bound in the same commit as the WGSL input (the meltCfg
    // rule). Without a source the fallback 1×1 texture and the all-zero cfg
    // keep the fetch at its "no start" identity — the disabled march is
    // bit-identical, and cfg.y (the block footprint) is only read after the
    // enabled test in DEPTH_PRE_FETCH's consumer.
    depthPreTex: texture(depthPre ? depthPre.texture : fallbackDepthPreTexture()),
    depthPreCfg: (depthPre ? depthPre.uniforms.cfg : fallbackDepthPreUniform()) as never,
    normalGradientCfg: u.normalGradientCfg,
    // Static probe grid (lighting P3 step 1) — POSITIONALLY LAST, five
    // slots after normalGradientCfg, bound in the same commit as the WGSL
    // inputs (the meltCfg rule). probeCfg.x = 0 keeps every view that does
    // not build a grid bit-identical.
    probeTex: u.probeTex,
    probeMin: u.probeMin,
    probeInvExtent: u.probeInvExtent,
    probeDims: u.probeDims,
    probeCfg: u.probeCfg,
    // Flashlight bounce spot (P4 step 1) — POSITIONALLY LAST, four slots
    // after probeCfg, bound in the same commit as the WGSL inputs.
    bounceSpotPos: u.bounceSpotPos,
    bounceSpotNormal: u.bounceSpotNormal,
    bounceSpotRadiance: u.bounceSpotRadiance,
    bounceSpotCfg: u.bounceSpotCfg,
  }) as unknown as Swizzled;

  const material = new MeshBasicNodeMaterial();
  material.side = rays?.side ?? THREE.BackSide;

  /** The level-shadow TextureNode this material binds, exposed for the
   *  owner's per-frame rebind (see the comment at its creation). */
  (material as unknown as MaterialWithLevelShadowTex).levelShadowTex =
    levelShadowTexNode as unknown as { value: THREE.Texture };
  (material as unknown as MaterialWithSegmentVolume).segVolumeAtlas =
    segVolumeAtlasNode as unknown as { value: THREE.Texture };
  (material as unknown as MaterialWithSegmentVolume).segVolumeMeta =
    segVolumeMetaNode as unknown as { value: THREE.Texture };

  // Depth from the marched hit, so the body composites with real geometry.
  // WebGPU clip z is already [0,1] — no `* 0.5 + 0.5` remap, unlike the GLSL.
  //
  // SURFACE MODE (hybrid deferred M1 task 2): the trace result is cached with
  // toVar so the whole fragment — three MRT readbacks, the surfaceDepth
  // attachment and this depthNode — evaluates the march ONCE. The readbacks
  // additionally take the cached result as an input (the `dep` parameter in
  // deferred-sdf.ts), which is what orders their global reads AFTER the trace
  // write in the generated WGSL; toVar alone does not prove that ordering.
  const tracedHit = output === 'surface'
    ? (marched as unknown as { toVar: (name: string) => Swizzled }).toVar('sdfTrace')
    : marched;
  const hitPos = add(cameraPosition, mul(rayDir, tracedHit.w as never));
  const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
  const depth = clip.z.div(clip.w);

  if (output === 'surface') {
    // The four named attachments (deferred-surface.ts) via the material-level
    // mrtNode — the same mechanism as the task-1 mesh producer. depthNode
    // keeps the REAL traced hit depth in the hardware depth buffer, so the
    // proxy box depth-tests exactly as the lit path does. No colorNode/
    // outputNode: with a material mrtNode the output struct IS the MRT (the
    // task-1 note on MRTNode.js), and the deferred SDF target has no legacy
    // depth-alpha channel to feed.
    //
    // M2 task 2: the class channel is an UNLIT UNIFORM seeded from the
    // shadowReceiver option (default keeps the M1 encoding exactly), exposed
    // on the material so a caller can flip a body's receiver without
    // rebuilding the pipeline. The tail still writes the plain flesh class
    // into the private global; the emission readback substitutes this value.
    const surfaceClass = uniform(encodeSurfaceClass(SURFACE_CLASS_FLESH, shadowReceiver ?? 'full'));
    material.mrtNode = sdfSurfaceMrtNodes(tracedHit, depth, surfaceClass) as never;
    material.depthNode = depth;
    material.depthWrite = true;
    (material as unknown as MaterialWithSurfaceClass).surfaceClass = surfaceClass;
    (material as unknown as { surfaceKind: number }).surfaceKind = surfaceClass.value;
    return material;
  }

  material.colorNode = vec4(marched.xyz as never, 1.0);
  material.depthNode = depth;
  material.depthWrite = true;

  // Depth goes out in ALPHA as well as to depthNode, via `outputNode`.
  //
  // It has to be outputNode and not colorNode: three builds `DiffuseColor =
  // vec4(colorNode.xyz, 1.0)` and then forces `DiffuseColor.w = 1.0` again for
  // an opaque material, so an alpha written through colorNode never reaches
  // the target. That cost a pass where the composite discarded every pixel and
  // no body appeared at all. outputNode replaces the final RGBA outright.
  //
  // The alpha copy is what lets the half-resolution SDF layer composite: its
  // pass renders into a float target, and the composite reads depth straight
  // back out of the colour it already samples. Attaching a DepthTexture and
  // sampling it as `texture_depth_2d` was the first attempt and read as "near"
  // everywhere, so the quad passed the depth test across the whole screen and
  // painted out the floor. Depth in a float alpha channel has no such
  // ambiguity, and FloatType keeps it exact rather than quantised to 8 bits.
  //
  // Harmless when the material draws straight to the canvas: it is opaque, so
  // the framebuffer alpha is never read.
  material.outputNode = vec4(marched.xyz as never, depth);
  return material;
}

/** Per-object inputs consumed by the one NodeMaterial shared by every gib.
 *
 * Three's object uniform group is rewritten before each draw. The update
 * callbacks below select this state from the mesh currently being rendered,
 * so simultaneous chunks share the expensive node graph while retaining
 * exclusive textures and values. */
interface ChunkMaterialState {
  dataTexture: THREE.Texture;
  volumeTexture: THREE.Texture;
  uniforms: MarchUniforms;
}

const CHUNK_MATERIAL_STATE = '__sdfChunkMaterialState';

function chunkMaterialState(object: THREE.Object3D): ChunkMaterialState {
  const state = object.userData[CHUNK_MATERIAL_STATE] as ChunkMaterialState | undefined;
  if (!state) throw new Error('shared chunk material rendered without per-object state');
  return state;
}

type ObjectUpdatedNode = {
  onObjectUpdate(callback: (frame: { object: THREE.Object3D }) => unknown): unknown;
};

function bindObjectValue<T>(node: T, value: (state: ChunkMaterialState) => unknown): T {
  (node as unknown as ObjectUpdatedNode).onObjectUpdate(
    ({ object }) => value(chunkMaterialState(object)),
  );
  return node;
}

/** A single externally-owned march material for every simultaneously-live
 * gib chunk. Creating a fresh NodeMaterial per chunk makes Three rebuild the
 * complete WGSL node graph for each render object even when program keys
 * match; this object-update binding keeps that graph singular.
 *
 * M2 task 2: `options` selects the output mode. Surface mode (used by the
 * deferred game) emits the four named G-buffer attachments from the SAME
 * graph — the per-draw data rebinding below is what keeps two differently
 * bound chunks correct under one shared surface material. The per-draw
 * bound nodes are exposed (`dataNode`, `volumeNode`, `uniformNodes`) so a
 * test can perform exactly the rebinding a render performs:
 * `node.update({ object })` is the same callback the renderer invokes. */
export interface SharedChunkGpuMaterial {
  material: MeshBasicNodeMaterial;
  /** The per-draw bound data-texture node. */
  dataNode: { value: THREE.Texture; update: (frame: { object: THREE.Object3D }) => void };
  /** The per-draw bound volume-texture node. */
  volumeNode: { value: THREE.Texture; update: (frame: { object: THREE.Object3D }) => void };
  /** The seed uniform NODES — every one rebinds its .value per draw. */
  uniformNodes: MarchUniforms;
  dispose(): void;
}

export function createSharedChunkGpuMaterial(
  prev?: PrevSource,
  options?: SurfaceOutputOptions,
): SharedChunkGpuMaterial {
  // These seeds establish the binding types before any chunk exists. They are
  // never sampled by a chunk draw: every node below swaps to the current
  // mesh's state through onObjectUpdate first.
  const seedFace = blankFaceTexture();
  const seedUniforms = defaultUniforms(seedFace);
  const { tex: seedData } = createDataTexture();
  const seedVolume = createFallbackHandVolumeTexture();

  for (const key of Object.keys(seedUniforms) as (keyof MarchUniforms)[]) {
    bindObjectValue(seedUniforms[key], state => state.uniforms[key].value);
  }
  const dataNode = bindObjectValue(texture(seedData), state => state.dataTexture);
  const volumeNode = bindObjectValue(texture3D(seedVolume), state => state.volumeTexture);
  const material = createMarchMaterial(
    dataNode, volumeNode, seedUniforms,
    undefined, undefined, undefined, undefined, undefined, prev,
    undefined, undefined, undefined, options?.output ?? 'lit', options?.shadowReceiver,
  );

  let disposed = false;
  return {
    material,
    dataNode: dataNode as unknown as SharedChunkGpuMaterial['dataNode'],
    volumeNode: volumeNode as unknown as SharedChunkGpuMaterial['volumeNode'],
    uniformNodes: seedUniforms,
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
      seedData.dispose();
      seedVolume.dispose();
      seedFace.dispose();
    },
  };
}

/**
 * Depth range the cone pass normalises its distance by.
 *
 * Only has to exceed any distance the lab's camera sits at — it exists so the
 * depth test can pick the nearest start, not to be metric. Larger than the
 * camera's far plane would waste precision; smaller would clamp distant starts
 * together and lose the ordering.
 */
export const CONE_DEPTH_RANGE = 32;

/** Allocates the RGBA32F data texture every march reads its field from.
 *  Exported for the FPV hands view, which marches its own small field the
 *  same way (X1.23 task 4) — one copy of the packing machinery. */
export function createDataTexture() {
  // Nearest filtering and no mips: these are DATA, and any interpolation
  // between texels would silently blend one primitive's endpoint into its
  // neighbour's.
  const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
  const tex = new THREE.DataTexture(
    texels, MAX_PRIMS, DATA_ROWS, THREE.RGBAFormat, THREE.FloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  /** Writes one row of the data texture from a packed Float32Array. */
  function writeRow(row: number, src: Float32Array, count: number, col = 0) {
    const base = row * MAX_PRIMS * 4 + col * 4;
    for (let i = 0; i < count * 4; i++) texels[base + i] = src[i]!;
  }
  return { tex, texels, writeRow };
}

/**
 * Writes the wound rows. Shared by the body and by a chunk's torn end, which
 * is itself just a single blast wound parked where the limb came away.
 * meta texel = (type, age, rimSplayScale, rimOffsetScale); the scale slots
 * default to 1 so callers that pass nothing (chunk torn ends) keep the global
 * woundCfg rim settings unchanged.
 * Exported for the hands view, which owns its own (splash-wound) ring, and for
 * the humanoid view, whose data texture uses a different stride and wound rows
 * (Task 9 — the texel layout is identical, only the clamp/rows/stride differ).
 */
export interface WriteWoundsLayout {
  /** Clamp on the number of slots written (was MAX_WOUNDS). */
  maxWounds?: number;
  /** Row index for the wound world-position texels (was ROW_WOUND). */
  woundRow?: number;
  /** Row index for the wound meta texels (was ROW_WOUND_META). */
  metaRow?: number;
  /** Row index for the depth-slab cap texels (was ROW_WOUND_CAP). */
  capRow?: number;
  /** Row index for the per-wound flag texels (was ROW_WOUND_FLAGS). */
  flagsRow?: number;
  /** Data-texture column stride (was MAX_PRIMS). */
  stride?: number;
}

export function writeWounds(
  texels: Float32Array,
  worldPositions: Vec3[], radii: number[], types: number[], ages: number[],
  splayScales?: number[], offsetScales?: number[],
  layout: WriteWoundsLayout = {},
  /** Depth-slab caps (ROW_WOUND_CAP: inward normal + depth). Omitted or
   *  null per wound = uncapped sphere — the row is left at whatever it held
   *  (zeroed at allocation; applyWounds treats w <= 0 as uncapped), so the
   *  LAB (which never passes caps) renders bit-identically to pre-slab. */
  caps?: readonly ({ n: Vec3; depth: number } | null)[],
  /** Per-wound cavity flags (ROW_WOUND_FLAGS: x = 1 = this wound opened a
   *  body cavity). Omitted or absent per wound = 0 — non-cavity, the state
   *  every pre-entrails wound had. Written for i < n only, like every row. */
  cavities?: readonly boolean[],
  /** Owning cluster and its primitive span. Omitted = legacy world-space wound. */
  owners?: readonly ({ cluster: number; start: number; count: number } | null)[],
): number {
  const stride = layout.stride ?? MAX_PRIMS;
  const woundRow = layout.woundRow ?? ROW_WOUND;
  const metaRow = layout.metaRow ?? ROW_WOUND_META;
  const n = Math.min(worldPositions.length, layout.maxWounds ?? MAX_WOUNDS);
  const wBase = woundRow * stride * 4;
  const mBase = metaRow * stride * 4;
  const capBase = (layout.capRow ?? ROW_WOUND_CAP) * stride * 4;
  const flagBase = (layout.flagsRow ?? ROW_WOUND_FLAGS) * stride * 4;
  for (let i = 0; i < n; i++) {
    const p = worldPositions[i]!;
    texels[wBase + i * 4] = p[0];
    texels[wBase + i * 4 + 1] = p[1];
    texels[wBase + i * 4 + 2] = p[2];
    texels[wBase + i * 4 + 3] = radii[i]!;
    texels[mBase + i * 4] = types[i]!;
    texels[mBase + i * 4 + 1] = ages[i]!;
    texels[mBase + i * 4 + 2] = splayScales?.[i] ?? 1;
    texels[mBase + i * 4 + 3] = offsetScales?.[i] ?? 1;
    const cap = caps?.[i];
    if (cap) {
      texels[capBase + i * 4] = cap.n[0];
      texels[capBase + i * 4 + 1] = cap.n[1];
      texels[capBase + i * 4 + 2] = cap.n[2];
      texels[capBase + i * 4 + 3] = cap.depth;
    }
    texels[flagBase + i * 4] = cavities?.[i] ? 1 : 0;
    const owner = owners?.[i];
    texels[flagBase + i * 4 + 1] = owner ? owner.cluster + 1 : 0;
    texels[flagBase + i * 4 + 2] = owner?.start ?? 0;
    texels[flagBase + i * 4 + 3] = owner ? owner.start + owner.count : 0;
  }
  return n;
}

/**
 * Bounding sphere of every wound's REACH (close-up wound-cull task,
 * 2026-09-05). For each wound i the reach sphere is (centre worldPositions[i],
 * radius reach_i), where reach_i is EXACTLY the formula applyWounds' per-wound
 * early-out uses (march.wgsl.ts, pinned by test):
 *
 *   reach = radius * max(2, 2*rimOffset + 3*rimWidth) + 4*blendK + 0.25
 *
 * read here off the LIVE uniforms (woundCfg.y blendK, woundCfg.w rimOffset,
 * woundCfg2.x rimWidth) rather than hardcoded. The union bound is C = the
 * wound centroid and R = max_i(|w_i - C| + reach_i); containment is the
 * triangle inequality, exact for any centre, so this is a value no-op cull —
 * a sample outside it is outside every per-wound reach and the loop would
 * have `continue`d on all of them (d unchanged, near 0). Zero wounds return
 * radius 0 (the loop never runs, as before).
 *
 * CAVEAT: computed at upload time. A live wound-panel edit of blendK /
 * rimOffset / rimWidth WITHOUT a re-upload leaves the bound stale (too tight
 * if the knob grew) — re-stamp or nudge wounds to refresh. The game's wound
 * settings are boot constants, so this never bites in play.
 */
export function woundReachBound(
  worldPositions: Vec3[], radii: number[], count: number,
  blendK: number, rimOffset: number, rimWidth: number,
): [number, number, number, number] {
  const n = Math.min(count, worldPositions.length, radii.length);
  if (n <= 0) return [0, 0, 0, 0];
  const f = Math.max(2, 2 * rimOffset + 3 * rimWidth);
  const margin = 4 * blendK + 0.25;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const p = worldPositions[i]!;
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  cx /= n; cy /= n; cz /= n;
  let r = 0;
  for (let i = 0; i < n; i++) {
    const p = worldPositions[i]!;
    const reach = radii[i]! * f + margin;
    const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) + reach;
    if (d > r) r = d;
  }
  return [cx, cy, cz, r];
}

export interface GpuViewOpts {
  /** Coarse cone pre-pass to start the march from. Omit to march from the camera. */
  cone?: ConeSource;
  /**
   * Conservative inner hull of the scene, rasterised depth-only before the
   * march. Lets a ray stop early where something solid already covers it —
   * the early-Z that frag_depth + discard rule out.
   */
  occluder?: OccluderSource;
  /** Outer-hull entry/exit bounds (shell-hull-outer.ts). Omit for the
   *  unbounded march — the fetch identities make it bit-identical. */
  shell?: ShellSource;
  /** Accumulated colour+depth for the front-to-back per-body passes (perf
   *  round 2 task 5). Omit for the ungated march — 1e9 is the identity. */
  prev?: PrevSource;
  /** Quarter-resolution depth prepass (close-up task 3): this view's coarse
   *  twin renders into it, and the march starts from its nearest-touch
   *  distance. Omit for the from-camera march — the fetch identity is 0. */
  depthPre?: DepthPreSource;
  /** Level-only shadow light (perf round 2 task 7) — the twin of the
   *  flashlight. Omit in the lab/hands: the binding falls back to a 1×1
   *  depth texture and levelShadowCfg.x = 0 keeps the march inert. */
  levelShadow?: { light: THREE.SpotLight };
  /**
   * The 3D texture bound to the volume slot (X1.26). Omitted, the view binds
   * its own 1-cubed fallback and disposes it in dispose(); pass one to share
   * a single fallback across every non-volume view (the lab renderer owns
   * and disposes it — this view will not).
   */
  volumeTex?: THREE.Texture;
  /**
   * Opt this view into the per-tile fold path (perf task 5). The binding is
   * created by the CALLER (createComputeTileBinding — it needs the renderer)
   * and sized at the caller's worst-case SDF-pass grid; this view binds its
   * storage buffers into the march material and exposes the bin/setEnabled
   * facade through .tiles.
   */
  tiles?: ComputeTileBinding;
  /**
   * Pack bone rows (op 'bone') into the inside-flesh array. Default TRUE —
   * the shipped layout. The bone-tubes renderer sets it FALSE via
   * setPackBones: bones draw as instanced tubes, so the wound-zone fold sees
   * ORGANS only and counts2.x becomes the organ count.
   */
  packBones?: boolean;
  /**
   * Hybrid deferred M1 (task 2): 'surface' makes this view's march material
   * emit the four named surface G-buffer attachments (deferred-sdf.ts,
   * class 2 flesh) instead of lit colour, for the deferred layer's SDF
   * producer pass. Default 'lit' — every existing caller keeps the legacy
   * lit + depth-alpha output without opting in. The traced body, normals,
   * wounds and constants are IDENTICAL in both modes; surface mode only
   * exits before the light-dependent tail. The view's proxy geometry,
   * update/setWounds/setFaceTexture and disposal rules are unchanged, and
   * task 3 reaches the producer mesh/material through view.object.
   */
  output?: 'lit' | 'surface';
  /**
   * Hybrid deferred M2 (task 2): which flashlight shadow map this view's
   * surface samples when `output: 'surface'` — packed into emissionClass.a
   * by encodeSurfaceClass. Default 'full' keeps the M1 encoding EXACTLY
   * (class 2, no receiver bit); the game passes 'level-only' for flesh so a
   * character's own inflated hull cannot swallow its illumination.
   * Ignored in lit mode.
   */
  shadowReceiver?: ShadowReceiver;
}

/** Wires an externally-owned GPU binding into a view: the material gets the
 *  binding's read-only storage nodes; bin() delegates; setEnabled flips this
 *  view's tileCfg gate. The binding itself is disposed by its creator. */
function wireViewTiles(
  binding: ComputeTileBinding, tileCfg: THREE.Vector4,
): ViewTileBinding {
  let rayCull = false;
  return {
    bin(groups, camera, maxBlendK, grid) {
      binding.bin(groups, camera, maxBlendK, grid);
      // Stamp the ACTIVE grid for the shader on every bin — adaptive
      // resolution moves it under our feet. x is the enable gate and keeps
      // whatever setEnabled last set.
      tileCfg.set(
        tileCfg.x,
        Math.ceil(Math.max(1, grid.widthPx) / TILE_SIZE_PX),
        TILE_SIZE_PX,
        Math.ceil(Math.max(1, grid.heightPx) / TILE_SIZE_PX),
      );
    },
    setEnabled(on) {
      tileCfg.x = on ? (rayCull ? 2 : 1) : 0;
    },
    setRayCull(on) {
      rayCull = on;
      if (tileCfg.x > 0) tileCfg.x = on ? 2 : 1;
    },
    dispose() { /* owned by the caller */ },
  };
}

export function createZombieGpuView(
  body: BuildResult, opts: GpuViewOpts = {},
): ZombieGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(blankFaceTexture());
  // Volume slot (X1.26): bind the shared fallback when the caller owns one,
  // else create (and later dispose) our own. The branch stays disabled.
  const ownsVolume = !opts.volumeTex;
  const volumeTex = opts.volumeTex ?? createFallbackHandVolumeTexture();

  // Posed bound groups of the LAST upload (perf task 5): the binner's input.
  let lastGroups: import('./tile-cull').TileGroupInput[] = [];
  // The last upload()'s args, so setBoneCull / setPackBones can re-pack
  // the SAME posed body immediately (used by the frozen-frame exactness gate
  // — a.step is gated on !wanderFrozen, so the per-frame re-pack a cull flag
  // usually rides is skipped). Stored here; the pose does not change on a
  // re-pack, so the frame is bit-identical to the pre-toggle frame.
  let lastUploadNext: BuildResult | undefined;
  let lastUploadRest: BuildResult | undefined;

  // Bone tubes: FALSE once the instanced-tube renderer owns the bones — the
  // pack then writes ORGANS only and counts2.x counts organs.
  let packBones = opts.packBones ?? true;
  // Bone-cluster spheres (packBoneClusters): TRUE culls the inside-flesh
  // rows with one per-flesh-cluster sphere before folding them. 'off' (ship)
  // is the old flat loop; pack writes zero bone-cluster texels and the shader
  // falls back. 'segment' culls per RIGID SEGMENT (bone-segment spheres).
  // __sdfGame.setBoneCull / setBoneCullMode flip it; takes effect on the
  // NEXT upload.
  let boneCullMode: 'off' | 'cluster' | 'segment' = 'off';
  // BARE BONES (melt task 5): TRUE lifts the march's nearWound gate on the
  // inside-flesh rows (counts2.y), so the skeleton folds WITHOUT a wound.
  // Only the melt sets this: it sags the flesh off the bones on purpose, and
  // the gate's "bones are contained in flesh" proof is exactly what the melt
  // violates.
  let bareBones = false;

  // Wound union-reach cull (close-up wound-cull task, 2026-09-05). SHIPS ON:
  // setWounds computes the bound from the live uniforms and writes it to
  // u.woundBound; the seam flips only the radius (1e9 = no-cull identity) so
  // the bench can A/B without re-uploading. woundBoundR starts at the
  // no-cull identity — before the first setWounds there are no wound rows to
  // cull anyway (woundCfg.x = 0).
  let woundCullOn = true;
  let woundBoundR = 1e9;

  function upload(next: BuildResult, rest?: BuildResult) {
    lastUploadNext = next;
    lastUploadRest = rest;
    const p = packBody(next, rest, { packBones, boneCullMode });
    lastGroups = [];
    for (let g = 0; g < p.groupCount; g++) {
      const o = g * 4;
      const gb = p.groupBounds;
      const gr = p.groupRange;
      lastGroups.push({
        bodyIndex: 0,
        start: gr[o]!, count: gr[o + 1]!,
        center: [gb[o]!, gb[o + 1]!, gb[o + 2]!],
        radius: gb[o + 3]!,
        distort: gr[o + 2]!,
        flags: gr[o + 3]!,
      });
    }
    writeRow(ROW_PRIM_A, p.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, p.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, p.primScale, MAX_PRIMS);
    writeRow(ROW_PRIM_QUAT, p.primQuat, MAX_PRIMS);
    writeRow(ROW_REST_A, p.restA, MAX_PRIMS);
    writeRow(ROW_REST_B, p.restB, MAX_PRIMS);
    writeRow(ROW_PRIM_SHAPE, p.primShape, MAX_PRIMS);
    writeRow(ROW_PRIM_BEND, p.primBend, MAX_PRIMS);
    writeRow(ROW_PRIM_COLOR, p.primColor, MAX_PRIMS);
    writeRow(ROW_PRIM_SHELL, p.primShell, MAX_PRIMS);
    writeRow(ROW_PRIM_WARP, p.primWarp, MAX_PRIMS);
    writeRow(ROW_PRIM_STRAND, p.primStrand, MAX_PRIMS);
    writeRow(ROW_PRIM_CLIP, p.primClip, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, p.clusterBounds, p.clusterCount);
    writeRow(ROW_CLUSTER_RANGE, p.clusterRange, p.clusterCount);
    // Bone-cluster spheres (packBoneClusters): stored in the free texels at
    // column MAX_CLUSTERS of the SAME rows. MAX_CLUSTERS+1 texels — one per
    // cluster index plus the tail (the shader's enabled flag). Zeros when the
    // option is off (pack zeroed them), which is the shader's flat fallback.
    writeRow(ROW_CLUSTER_BOUNDS, p.boneClusterBounds, MAX_CLUSTERS + 1, MAX_CLUSTERS);
    writeRow(ROW_CLUSTER_RANGE, p.boneClusterRange, MAX_CLUSTERS + 1, MAX_CLUSTERS);
    // Bone-SEGMENT spheres (mode 2): the free columns right after the header
    // texel (2*MAX_CLUSTERS). Zeros unless pack ran in segment mode.
    writeRow(ROW_CLUSTER_BOUNDS, p.boneSegmentBounds, BONE_SEG_MAX, 2 * MAX_CLUSTERS + 1);
    writeRow(ROW_CLUSTER_RANGE, p.boneSegmentRange, BONE_SEG_MAX, 2 * MAX_CLUSTERS + 1);
    // Full width: a shorter list than last frame must zero the tail, which
    // is the shader's end-of-list sentinel.
    writeRow(ROW_GROUP_BOUNDS, p.groupBounds, MAX_PRIMS);
    writeRow(ROW_GROUP_RANGE, p.groupRange, MAX_PRIMS);
    writeRow(ROW_CLUSTER_GROUPS, p.clusterGroups, p.clusterCount);
    dataTex.needsUpdate = true;
    u.counts.value.set(p.primCount, p.clusterCount, p.carveCount, p.maxBlendK);
    // z is the owner re-fold attribution gate (march.wgsl.ts) and w is the
    // per-ray wound list gate (counts2.w, 2026-09-07) — settings channels
    // that must survive every upload, like perfCfg.
    u.counts2.value.set(p.boneCount, bareBones ? 1 : 0, u.counts2.value.z, u.counts2.value.w);
    return p;
  }

  let viewTiles: ViewTileBinding | undefined;
  let tileNodes: { header: unknown; entries: unknown } | undefined;
  if (opts.tiles) {
    viewTiles = wireViewTiles(opts.tiles, u.tileCfg.value);
    tileNodes = { header: opts.tiles.headerNode, entries: opts.tiles.entryNode };
  }

  const packed = upload(body);
  const segFallback = fallbackSegmentVolumeTextures();
  const coneSegAtlas = texture3D(segFallback.atlas);
  const coneSegMeta = texture(segFallback.meta);
  const material = createMarchMaterial(
    dataTex, volumeTex, u,
    marchBody,
    opts.cone, opts.occluder, tileNodes, opts.shell, opts.prev, opts.levelShadow,
    undefined, opts.depthPre, opts.output, opts.shadowReceiver,
  );

  // The coarse twin: same field, same proxy box, no shading, its own mesh on
  // its own layer. Writes the conservative start distance into .x, and the
  // same value normalised as DEPTH — so where proxy boxes overlap the hardware
  // depth test resolves to the NEAREST start, which is the one value that is
  // safe for every body in that tile.
  const coneT = coneMarch({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    volumeTex: texture3D(volumeTex),
    volumePose0: u.volumePose0,
    volumePose1: u.volumePose1,
    volumeMin: u.volumeMin,
    volumeInvExtent: u.volumeInvExtent,
    volumeWarp: u.volumeWarp,
    volumeClip: u.volumeClip,
    segVolumeAtlas: coneSegAtlas,
    segVolumeMeta: coneSegMeta,
    counts: u.counts,
    counts2: u.counts2,
    marchCfg: u.marchCfg,
    // NOTE: meltCfg is deliberately NOT bound here. The melt commit (c52b05b)
    // passed u.meltCfg into this literal while CONE_MARCH's WGSL signature
    // never declared the input — three threw "Input 'meltCfg' not found in
    // 'Fn()'" on every lab page boot (pre-existing on main 121ef37; found
    // while rendering hard-surface task 3's acceptance frames). The cone
    // keeps marching the SMOOTH field (its mapBody call passes noiseCfg 0),
    // which is the pre-melt contract exactly; when the melt chain plumbs melt
    // into the cone for real, it must add the WGSL input AND this binding in
    // the same commit.
    woundCfg: u.woundCfg,
    woundCfg2: u.woundCfg2,
    coneK: opts.cone ? opts.cone.uniforms.k : float(0.02),
    startT: opts.cone
      ? coneFetch({
          coneTex: texture(opts.cone.coarseTexture),
          screenUV: screenUV,
          enabled: opts.cone.uniforms.chain,
        })
      : float(0),
    // Bound POSITIONALLY last, matching CONE_MARCH's WGSL signature (the
    // ORDER MATTERS note in createMarchMaterial). The cone twin sees the
    // same seams the march does.
    perfCfg: u.perfCfg,
    // ...and the same WIND and BODY FRAME. Unlike the noise, which the cone
    // deliberately passes as 0 because it lives on the normal, both of these
    // move the FIELD: a cone marching the no-wind, world-anchored surface
    // would certify space the real cloth occupies.
    windDrift: u.windDrift,
    bodyAnchor: u.bodyAnchor,
    // Wound union-reach cull (close-up wound-cull task) — the cone marches
    // the same field, so it takes the same bound; positionally last, after
    // perfCfg, matching CONE_MARCH's signature.
    woundBound: u.woundBound,
  }) as unknown as { div: (d: unknown) => unknown };

  const coneMaterial = new MeshBasicNodeMaterial();
  coneMaterial.side = THREE.BackSide;
  coneMaterial.outputNode = vec4(coneT as never, 0, 0, 1);
  coneMaterial.depthNode = coneT.div(CONE_DEPTH_RANGE) as never;
  coneMaterial.depthWrite = true;
  coneMaterial.depthTest = true;

  /**
   * Proxy box covering every live cluster, plus blend margin.
   *
   * A true AABB, not a cube. A standing body is roughly 0.6 x 1.8 x 0.35, so
   * the cube this used to build — 1.8 on every side — covered about three
   * times the screen area of the body itself, and every one of those extra
   * pixels entered the march. Sphere tracing exits them quickly, but "quickly"
   * still means several full mapBody evaluations each.
   */
  function fit(body_: BuildResult, maxBlendK: number) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const c of body_.clusters) {
      if (!c.alive) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, c.center[i]! - c.radius);
        max[i] = Math.max(max[i]!, c.center[i]! + c.radius);
      }
    }
    const pad = maxBlendK * 4 + 0.05;
    return {
      centre: new THREE.Vector3(...min.map((v, i) => (v + max[i]!) / 2)),
      size: new THREE.Vector3(...max.map((v, i) => v - min[i]! + pad * 2)),
    };
  }

  const first = fit(body, packed.maxBlendK);
  u.bodyHalf.value.set(first.size.x / 2, first.size.y / 2, first.size.z / 2);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(first.size.x, first.size.y, first.size.z), material,
  );
  mesh.position.copy(first.centre);
  mesh.frustumCulled = false; // the proxy IS the bound; don't double-cull

  // Shares the geometry — same proxy box, different material — and follows the
  // main mesh's transform so severing keeps the two in step.
  const coneMesh = new THREE.Mesh(mesh.geometry, coneMaterial);
  coneMesh.frustumCulled = false;
  coneMesh.position.copy(mesh.position);

  // The quarter-res depth-prepass twin (close-up task 3): same proxy box,
  // a distance-writing material, its own layer. The coarse march inside it
  // stops at the first touch of a BLOCK-radius cone — a provable lower bound
  // on the first hit of every full-res ray in the block (proof on
  // DEPTH_PREPASS_MARCH). frag_depth is the touch distance normalised exactly
  // like the cone twin's, so where proxy boxes overlap the hardware depth
  // test keeps the NEAREST touch — the one value safe for every body at that
  // pixel. FOG IS OFF, and must stay off: this material renders through the
  // main scene, and the fog fix (8da0bdd) exists because scene fog was
  // smoothstep-mixing exactly such a written distance toward fogColor with
  // range — the decay that killed the occluder pre-pass.
  let depthPreMesh: THREE.Mesh | undefined;
  let depthPreMaterial: MeshBasicNodeMaterial | undefined;
  let depthSegAtlasNode: ReturnType<typeof texture3D> | undefined;
  let depthSegMetaNode: ReturnType<typeof texture> | undefined;
  if (opts.depthPre) {
    depthSegAtlasNode = texture3D(segFallback.atlas);
    depthSegMetaNode = texture(segFallback.meta);
    const depthPreT = depthPreMarch({
      worldPos: positionWorld,
      camPos: cameraPosition,
      data: texture(dataTex),
      volumeTex: texture3D(volumeTex),
      volumePose0: u.volumePose0,
      volumePose1: u.volumePose1,
      volumeMin: u.volumeMin,
      volumeInvExtent: u.volumeInvExtent,
      volumeWarp: u.volumeWarp,
      volumeClip: u.volumeClip,
      segVolumeAtlas: depthSegAtlasNode,
      segVolumeMeta: depthSegMetaNode,
      counts: u.counts,
      counts2: u.counts2,
      marchCfg: u.marchCfg,
      woundCfg: u.woundCfg,
      woundCfg2: u.woundCfg2,
      depthPreCfg: opts.depthPre.uniforms.cfg,
      // Bound POSITIONALLY last, matching DEPTH_PREPASS_MARCH's WGSL
      // signature (the ORDER MATTERS note in createMarchMaterial).
      perfCfg: u.perfCfg,
      windDrift: u.windDrift,
    }) as unknown as { div: (d: unknown) => unknown };
    depthPreMaterial = new MeshBasicNodeMaterial();
    depthPreMaterial.side = THREE.BackSide;
    depthPreMaterial.fog = false;
    depthPreMaterial.outputNode = vec4(depthPreT as never, 0, 0, 1);
    depthPreMaterial.depthNode = depthPreT.div(CONE_DEPTH_RANGE) as never;
    depthPreMaterial.depthWrite = true;
    depthPreMaterial.depthTest = true;
    depthPreMesh = new THREE.Mesh(mesh.geometry, depthPreMaterial);
    depthPreMesh.frustumCulled = false;
    depthPreMesh.position.copy(mesh.position);
  }

  const mainSegmentVolume = material as unknown as MaterialWithSegmentVolume;
  return {
    object: mesh,
    coneObject: coneMesh,
    depthPreObject: depthPreMesh,
    uniforms: u,
    volumeTexture: volumeTex,
    dataTexture: dataTex,
    tiles: viewTiles,
    levelShadowTex: (material as unknown as MaterialWithLevelShadowTex).levelShadowTex,
    getTileGroups() { return lastGroups; },
    setPackBones(on) { packBones = on; },
    setBoneCull(on) {
      // The boolean seam is the cluster mode — kept for the bench's
      // bone-cull-on leg and the parked branch's callers.
      this.setBoneCullMode(on ? 'cluster' : 'off');
    },
    setBoneCullMode(mode) {
      if (mode === boneCullMode) return;
      boneCullMode = mode;
      // Re-pack the SAME posed body so the cull takes effect without waiting
      // for the next per-frame update — the frozen-frame exactness gate needs
      // a frame to flip the flag without advancing the pose.
      if (lastUploadNext) upload(lastUploadNext, lastUploadRest);
    },
    setBonesBare(on) { bareBones = on; },
    setSkeletonVolume(atlas, meta) {
      mainSegmentVolume.segVolumeAtlas.value = atlas;
      mainSegmentVolume.segVolumeMeta.value = meta;
      (coneSegAtlas as unknown as { value: THREE.Texture }).value = atlas;
      (coneSegMeta as unknown as { value: THREE.Texture }).value = meta;
      if (depthSegAtlasNode) (depthSegAtlasNode as unknown as { value: THREE.Texture }).value = atlas;
      if (depthSegMetaNode) (depthSegMetaNode as unknown as { value: THREE.Texture }).value = meta;
    },
    setMelt(progress) { u.meltCfg.value.x = progress; },
    update(next, rest) {
      const p = upload(next, rest);
      const f = fit(next, p.maxBlendK);
      mesh.position.copy(f.centre);
      // Per-axis, since the box is an AABB: severing a leg shortens it without
      // narrowing it, and a uniform scale would either clip or over-cover.
      mesh.scale.set(
        f.size.x / first.size.x, f.size.y / first.size.y, f.size.z / first.size.z);
      u.bodyHalf.value.set(f.size.x / 2, f.size.y / 2, f.size.z / 2);
      coneMesh.position.copy(mesh.position);
      coneMesh.scale.copy(mesh.scale);
      if (depthPreMesh) {
        depthPreMesh.position.copy(mesh.position);
        depthPreMesh.scale.copy(mesh.scale);
      }
    },
    setWounds(worldPositions, radii, types, ages, splayScales, offsetScales, caps, owners) {
      u.woundCfg.value.x = writeWounds(texels, worldPositions, radii, types, ages, splayScales, offsetScales, {}, caps, undefined, owners);
      // Union-reach bound, from the LIVE woundCfg/woundCfg2 channels the
      // reach formula reads (blendK, rimOffset, rimWidth) — see
      // woundReachBound. Stale only under a live panel edit without a
      // re-upload; the game's values are boot constants.
      const b = woundReachBound(worldPositions, radii, worldPositions.length,
        u.woundCfg.value.y, u.woundCfg.value.w, u.woundCfg2.value.x);
      woundBoundR = b[3];
      u.woundBound.value.set(b[0], b[1], b[2], woundCullOn ? b[3] : 1e9);
      dataTex.needsUpdate = true;
    },
    setWoundCull(on) {
      woundCullOn = on;
      u.woundBound.value.w = on ? woundBoundR : 1e9;
    },
    setHeadShape(centre, axes) {
      u.headCentre.value.set(...centre);
      u.headAxes.value.set(...axes);
    },
    setHeadRotation(q) { u.headQuat.value.set(q[0], q[1], q[2], q[3]); },
    setTime(seconds) { u.faceCfg3.value.y = seconds; },
    setRootShift(x, z, bodyYaw = 0) {
      u.faceCfg3.value.z = x; u.faceCfg3.value.w = z;
      // Free lodCfg channel: the noise frame's yaw (see NOISE_LOCAL).
      u.lodCfg.value.z = bodyYaw;
      // The same frame, as one vec3, for the shell warp and the cone
      // pre-pass. Written HERE so there is a single place that decides what
      // "the body's frame" is — see bodyAnchor's declaration.
      u.bodyAnchor.value.set(x, bodyYaw, z);
    },
    setFaceTexture(tex, atlas, mean) {
      u.faceTex.value = tex;
      u.faceAtlas.value.copy(atlas);
      u.faceCfg2.value.y = mean;
    },
    applyMaterial(m, light) {
      u.baseColor.value.setRGB(...m.baseColor);
      u.deepColor.value.setRGB(...m.deepColor);
      u.charColor.value.setRGB(...m.charColor);
      u.surfCfg.value.set(m.specIntensity, m.specRoughness, m.fresnelBoost, m.translucency);
      u.surfCfg2.value.set(m.wetness, m.surfaceNoiseAmp, m.mottleAmp, m.mottleScale);
      u.surfCfg3.value.set(m.woundDepthAmp, m.fatDepth, m.muscleDepth, m.visceraAmp);
      u.mottleColor.value.setRGB(...m.mottleColor);
      u.fatColor.value.setRGB(...m.fatColor);
      u.boneColor.value.setRGB(...m.boneColor);
      u.organColor.value.setRGB(...m.organColor);
      u.organAmp.value = m.organAmp;
      u.visceraColor.value.setRGB(...m.visceraColor);
      u.visceraDepth.value = m.visceraDepth;
      u.marchCfg.value.z = m.silhouetteNoiseAmp;
      u.lightDir.value.set(...light.keyDir);
      u.keyColor.value.setRGB(...light.keyColor);
      u.lightCfg.value.set(light.keyIntensity, light.fillIntensity);
      // probeWeight/ambientGain ride the preset so a horror beat can dial
      // bounce to zero without touching the enclosure. z (ceiling) and w
      // stay where the panel left them — they describe the room, not the
      // lighting mood.
      u.bounceCfg.value.x = light.probeWeight;
      u.bounceCfg.value.y = light.ambientGain;
      u.bounceCfg.value.w = light.chromaGain;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      coneMaterial.dispose();
      if (depthPreMaterial) depthPreMaterial.dispose();
      dataTex.dispose();
      if (ownsVolume) volumeTex.dispose();
      // viewTiles' underlying binding is owned by its creator, not the view.
    },
  };
}

export interface ChunkGpuView {
  object: THREE.Object3D;
  /** Live uniforms (copied from the body template at spawn; the noise root
   *  shift zw is re-anchored to the chunk's own position on every update). */
  uniforms: MarchUniforms;
  /** The 3D texture bound to the volume slot (X1.26) — the shared fallback;
   *  self-created ones are disposed with the view. */
  volumeTexture: THREE.Texture;
  /** The packed prim DataTexture this view uploads to — the hull extraction
   *  kernel reads the same texture the march does. */
  dataTexture: THREE.Texture;
  /** Reuses this mesh/render-object slot for a newly spawned chunk. */
  reset(chunk: Chunk, prims: Primitive[], tornAt?: Vec3[], bones?: Primitive[]): void;
  update(chunk: Chunk): void;
  /** Bone tubes: flip the packBones layout (pack.ts PackOpts.packBones).
   *  Re-packs immediately from the last reset() args. */
  setPackBones(on: boolean): void;
  /** Bone-cluster cull (packBoneClusters). A chunk stays on the FLAT bone
   *  fold: it is one cluster whose bones re-transform every frame, so a
   *  baked bone-cluster sphere would go stale — and the chunk's own cluster
   *  sphere already culls it as a unit. This seam exists so __sdfGame's
   *  setBoneCull can address every view uniformly; it does not change a
   *  chunk. See the body view's setBoneCull. */
  setBoneCull(on: boolean): void;
  /** Same story as setBoneCull — a chunk never leaves the flat fold. */
  setBoneCullMode(mode: 'off' | 'cluster' | 'segment'): void;
  /** Everything the settled-chunk BAKE needs (close-up task 5): the
   *  CURRENT world-space field inputs of this view — flesh prims, bone
   *  prims, torn ends with their girth radii — plus the transform and the
   *  look values the albedo bake reads. Computed from the same local
   *  arrays `apply()` writes rows from, so the bake cannot disagree with
   *  what the march was drawing (the hull spike's extraction-order bug,
   *  fixed at the source: the bake reads the view's own state). */
  bakeData(): ChunkGpuBakeData;
  /** This frame's bone prims in WORLD space with the chunk's rotation + squash
   *  applied — what the bone instancer draws (bone-tubes spec §7). */
  posedBones(): Primitive[];
  dispose(): void;
}

/** The settled-chunk bake input set (close-up task 5), as produced by
 *  ChunkGpuView.bakeData. World-space field inputs + the transform/look the
 *  albedo bake reads. Structurally the ChunkBakeData baked-chunks.ts
 *  consumes; declared here so the view's contract carries it. */
export interface ChunkGpuBakeData {
  flesh: Primitive[];
  bones: Primitive[];
  torn: { at: Vec3; radius: number }[];
  carveK: number;
  centre: Vec3;
  extent: number;
  quat: import('../gib-chunks').Chunk['quat'];
  look: import('./baked-chunks').ChunkBakeData['look'];
  gore: number;
}

/**
 * A detached blob, raymarched in its own small proxy box.
 *
 * The chunk's primitives are packed as a ONE-CLUSTER body into the chunk's own
 * data texture. The mesh transform only moves the proxy box — the shader
 * marches in WORLD space and the packed prims ARE the field — so the endpoints
 * are re-packed in world space on every update(); moving the mesh alone would
 * fly the box off while the limb stayed frozen in body space. Same hazard
 * translateBody() exists for, and it has bitten this project twice.
 *
 * `template` is the body's live uniform set at the moment of the cut, so the
 * chunk shades like the flesh it came from — one deliberate exception: the
 * gore mask below (lodCfg.w = 1) repaints it as torn meat. Its VALUES are
 * copied, not the nodes: sharing the nodes would let a chunk's wound count
 * scribble over the body's.
 */
export function createChunkGpuView(
  chunk: Chunk,
  prims: Primitive[],
  template: MarchUniforms,
  /** World positions where this limb was attached — become torn ends. */
  tornAt?: Vec3[],
  /** Shared volume-slot texture (X1.26); omitted, a private fallback is
   *  created and disposed with the chunk. */
  volumeTex?: THREE.Texture,
  /** One NodeMaterial shared by every live chunk. Omit for isolated tests or
   * callers that intentionally retain the old privately-owned lifecycle. */
  sharedMaterial?: SharedChunkGpuMaterial,
  /** The severed limb's BONE prims (gore r3 refinement 6). Omitted, the chunk
   *  is bone-free — which is what shipped, and why a torn-off forearm was
   *  solid meat. */
  bones?: Primitive[],
  /** Hybrid deferred M2 (task 2), trailing: output mode + shadow receiver.
   *  With a `sharedMaterial` given, the material's mode wins (one graph per
   *  output mode — the shared material must be built with the SAME options);
   *  this option then only governs the privately-owned-material path. */
  options?: SurfaceOutputOptions,
): ChunkGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(template.faceTex.value);
  const ownsVolume = !volumeTex;
  const volTex = volumeTex ?? createFallbackHandVolumeTexture();

  const ownsMaterial = !sharedMaterial;
  const material = sharedMaterial?.material ?? createMarchMaterial(
    dataTex, volTex, u,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, options?.output ?? 'lit', options?.shadowReceiver,
  );
  // A unit proxy lets reset() resize this exact mesh with scale instead of
  // replacing its geometry. Object identity is what bounds Three's
  // RenderObject cache when the lab recycles its oldest 40 chunk slots.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.userData[CHUNK_MATERIAL_STATE] = {
    dataTexture: dataTex,
    volumeTexture: volTex,
    uniforms: u,
  } satisfies ChunkMaterialState;
  mesh.frustumCulled = false;

  let local: Primitive[] = [];
  /** The severed limb's BONE prims, recentred like `local` (gore r3
   *  refinement 6). Chunks shipped bone-free — the safe default of the
   *  separate-array design — so a torn-off forearm was solid meat. */
  let localBones: Primitive[] = [];
  /** The chunk state the view last received in update()/reset() — posedBones
   *  poses against it. */
  let current: Chunk = chunk;
  /** Bone tubes: FALSE once the instanced-tube renderer owns the bones —
   *  reset() packs ORGANS only and update() skips the bone rows. */
  let packBones = true;
  /** The last reset() args, so setPackBones can re-pack without the caller
   *  re-supplying them. */
  let lastReset: { c: Chunk; prims: Primitive[]; tornAt?: Vec3[]; bones?: Primitive[] } | undefined;
  let extent = 0;
  let tornLocals: Vec3[] = [];
  let tornRadii: number[] = [];
  let packed!: ReturnType<typeof packBody>;
  let proxySize = 1;

  function copyTemplateLook() {
    u.faceTex.value = template.faceTex.value;
    u.baseColor.value.copy(template.baseColor.value);
    u.deepColor.value.copy(template.deepColor.value);
    u.charColor.value.copy(template.charColor.value);
    u.lightDir.value.copy(template.lightDir.value);
    u.keyColor.value.copy(template.keyColor.value);
    u.lightCfg.value.copy(template.lightCfg.value);
    u.spotPos.value.copy(template.spotPos.value);
    u.spotAxis.value.copy(template.spotAxis.value);
    u.spotCfg.value.copy(template.spotCfg.value);
    u.spotColor.value.copy(template.spotColor.value);
    u.spotCfg2.value.copy(template.spotCfg2.value);
    // Chunks must light like the body they came off. Miss this and gibs
    // carry the old flat fill while the torso takes the room's colour.
    u.bounceCfg.value.copy(template.bounceCfg.value);
    u.boxMin.value.copy(template.boxMin.value);
    u.boxMax.value.copy(template.boxMax.value);
    u.wallNegX.value.copy(template.wallNegX.value);
    u.wallPosX.value.copy(template.wallPosX.value);
    u.wallNegY.value.copy(template.wallNegY.value);
    u.wallPosY.value.copy(template.wallPosY.value);
    u.wallNegZ.value.copy(template.wallNegZ.value);
    u.wallPosZ.value.copy(template.wallPosZ.value);
    u.surfCfg.value.copy(template.surfCfg.value);
    u.surfCfg2.value.copy(template.surfCfg2.value);
    u.surfCfg3.value.copy(template.surfCfg3.value);
    u.mottleColor.value.copy(template.mottleColor.value);
    u.fatColor.value.copy(template.fatColor.value);
    u.boneColor.value.copy(template.boneColor.value);
    u.organColor.value.copy(template.organColor.value);
    u.organAmp.value = template.organAmp.value;
    u.visceraColor.value.copy(template.visceraColor.value);
    u.visceraDepth.value = template.visceraDepth.value;
    u.marchCfg.value.copy(template.marchCfg.value);
    u.woundCfg.value.copy(template.woundCfg.value);
    u.woundCfg2.value.copy(template.woundCfg2.value);
    u.woundShadowCfg.value.copy(template.woundShadowCfg.value);
    u.perfCfg.value.copy(template.perfCfg.value);
    u.normalGradientCfg.value.copy(template.normalGradientCfg.value);
    u.bodyHalf.value.copy(template.bodyHalf.value);
    u.faceCfg.value.copy(template.faceCfg.value);
    u.faceCfg2.value.copy(template.faceCfg2.value);
    u.faceGlowRedOnly.value = template.faceGlowRedOnly.value;
    u.faceCfg3.value.copy(template.faceCfg3.value);
    u.lodCfg.value.copy(template.lodCfg.value);
    u.faceProj.value.copy(template.faceProj.value);
    u.headQuat.value.copy(template.headQuat.value);
    u.faceAtlas.value.copy(template.faceAtlas.value);
    u.faceGlowColor.value.copy(template.faceGlowColor.value);
  }

  /**
   * Transform a bent prim's Bezier control point by the chunk's own transform.
   *
   * WITHOUT THIS A BENT BAR STRAIGHTENS AS THE CHUNK TURNS. `apply` rewrites
   * primA/primB into world space every frame, but ROW_PRIM_BEND was written
   * ONCE by `reset` in local space and never again — so the endpoints rotated
   * with the chunk while the control point stayed where the chunk was born.
   * On the melt's released ribcage that is the whole defect the owner saw: the
   * ribs are two BENT bars per hoop, and a hoop whose control point no longer
   * matches its endpoints collapses into a straight rod. Twelve of those is
   * "a linear bundle of sticks" rather than a ribcage.
   *
   * The row stores the ABSOLUTE control point (pack.ts), so this is exactly
   * the transform the endpoints get — not a displacement that needs rotating.
   * `posedBones()` already knew this and did it for its own read path; the
   * render path simply never got the same treatment.
   *
   * Prims with no bend are left alone: their row carries a BOX's corner
   * rounding in .w, which this must not clobber.
   */
  function writeBend(p: Primitive, o: number, sx: number, sy: number, sz: number): void {
    if (p.bend === undefined) return;
    packed.primBend.set(
      [...chunkPoint(current, bendCtrl(p.a, p.b, p.bend), sx, sy, sz), 0], o);
  }

  /** Writes the local prims into the world-space data rows for state `c`. */
  function apply(c: Chunk): { sx: number; sy: number; sz: number } {
    current = c;
    const { sx, sy, sz } = squashFactors(c);
    local.forEach((p, i) => {
      const o = i * PRIM_STRIDE;
      packed.primA.set(chunkPoint(c, p.a, sx, sy, sz), o);
      packed.primB.set(chunkPoint(c, p.b, sx, sy, sz), o);
      // Squash multiplies the world-axis ellipsoid scale. Approximation: the
      // authored per-axis scale does not rotate with the chunk (the yaw-only
      // version had the same limitation) — limb prims are near-uniform so this
      // never shows.
      packed.primScale.set([p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz,
        p.op === 'sub' ? 1 : 0], o);
      writeBend(p, o, sx, sy, sz);
    });
    // Bones ride the same squash and transform, written at the rows packBody
    // put them on — AFTER the flesh. Missing this would leave them in local
    // space while the meat moved, so a thrown forearm would trail its own
    // bone across the room. W_BONE is re-asserted here rather than copied
    // from packBody's row, because this loop overwrites primScale wholesale.
    // Bone tubes: with packBones OFF, op 'bone' rows are skipped exactly as
    // packBody skipped them — organs still rewritten — and a running row
    // counter keeps the surviving rows compacted onto packBody's indices.
    let boneRow = 0;
    localBones.forEach((p) => {
      if (!packBones && p.op === 'bone') return;
      const o = (local.length + boneRow) * PRIM_STRIDE;
      boneRow++;
      packed.primA.set(chunkPoint(c, p.a, sx, sy, sz), o);
      packed.primB.set(chunkPoint(c, p.b, sx, sy, sz), o);
      packed.primScale.set(
        [p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz,
        p.op === 'organ' ? W_ORGAN : W_BONE], o);
      writeBend(p, o, sx, sy, sz);
    });
    packed.clusterBounds.set([c.pos[0], c.pos[1], c.pos[2], extent * Math.max(sx, sy, sz)], 0);
    // The chunk's one bound group IS its cluster (singleGroup above): same
    // sphere, rewritten from the chunk's position every frame.
    packed.groupBounds.set([c.pos[0], c.pos[1], c.pos[2], extent * Math.max(sx, sy, sz)], 0);

    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_PRIM_BEND, packed.primBend, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, 1);
    writeRow(ROW_GROUP_BOUNDS, packed.groupBounds, 1);

    if (tornLocals.length > 0) {
      // Torn ends ride the same rotate-then-squash transform as the prims, so
      // they stay welded to the stumps as the piece tumbles.
      const ats = tornLocals.map(t => chunkPoint(c, t, sx, sy, sz));
      u.woundCfg.value.x = writeWounds(
        texels, ats, tornRadii, ats.map(() => 1), ats.map(() => 0));
    } else {
      u.woundCfg.value.x = 0;
    }

    if (u.faceCfg.value.x > 0.5) u.headCentre.value.set(c.pos[0], c.pos[1], c.pos[2]);

    // Noise anchor: the chunk's gore mottle rides the CHUNK, not the world.
    // Overwrites the body root shift the template copy brought over — a
    // severed limb tumbling away keeps its own mottle glued to its flesh
    // (translation only; tumble rotation still slides it, same as the body's
    // minimum fix).
    u.faceCfg3.value.z = c.pos[0];
    u.faceCfg3.value.w = c.pos[2];

    dataTex.needsUpdate = true;
    return { sx, sy, sz };
  }

  function reset(
    c: Chunk, nextPrims: Primitive[], nextTornAt?: Vec3[], nextBones?: Primitive[],
  ) {
    lastReset = { c, prims: nextPrims, tornAt: nextTornAt, bones: nextBones };
    copyTemplateLook();

    // c.pos is the cluster centre at sever time, so this recentres the
    // severed limb's rest-space primitives around the chunk's own origin.
    local = nextPrims.map(p => ({
      ...p,
      cluster: 0,
      a: vsub(p.a, c.pos),
      b: vsub(p.b, c.pos),
    }));
    // Bones recentre on the SAME origin as the flesh, so the stub stays where
    // the limb's own geometry put it. Cluster 0 because a chunk is one cluster.
    localBones = (nextBones ?? []).map(p => ({
      ...p,
      cluster: 0,
      a: vsub(p.a, c.pos),
      b: vsub(p.b, c.pos),
    }));
    // Extent sizes the proxy box AND the cluster sphere. A BONE-ONLY chunk
    // (the melt's released skeleton groups) has no flesh to measure — take
    // the bones, or the box comes out 5 cm and culls the very bones it
    // exists to show.
    extent = chunkExtent(nextPrims.length > 0 ? nextPrims : (nextBones ?? []), c.pos);
    tornLocals = (nextTornAt ?? []).map(t => vsub(t, c.pos));
    // Girth at the tear, not the length-dominated proxy extent (X1.16).
    tornRadii = tornLocals.map(t => tornEndRadius(local, t));

    packed = packBody({
      prims: local,
      clusters: [{
        id: 0, limb: c.limb, start: 0, count: local.length,
        center: [0, 0, 0], radius: extent, alive: true,
      }],
      bones: new Map(), bonePrims: localBones,
    }, undefined, { singleGroup: true, packBones });

    // Full-width copies intentionally zero any rows left by the previous
    // occupant of this slot.
    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_PRIM_QUAT, packed.primQuat, MAX_PRIMS);
    writeRow(ROW_REST_A, packed.restA, MAX_PRIMS);
    writeRow(ROW_REST_B, packed.restB, MAX_PRIMS);
    writeRow(ROW_PRIM_SHAPE, packed.primShape, MAX_PRIMS);
    writeRow(ROW_PRIM_BEND, packed.primBend, MAX_PRIMS);
    writeRow(ROW_PRIM_COLOR, packed.primColor, MAX_PRIMS);
    writeRow(ROW_PRIM_SHELL, packed.primShell, MAX_PRIMS);
    writeRow(ROW_PRIM_WARP, packed.primWarp, MAX_PRIMS);
    writeRow(ROW_PRIM_STRAND, packed.primStrand, MAX_PRIMS);
    writeRow(ROW_PRIM_CLIP, packed.primClip, MAX_PRIMS);
    writeRow(ROW_CLUSTER_RANGE, packed.clusterRange, 1);
    writeRow(ROW_GROUP_RANGE, packed.groupRange, MAX_PRIMS);
    writeRow(ROW_CLUSTER_GROUPS, packed.clusterGroups, 1);

    u.counts.value.set(packed.primCount, 1, packed.carveCount, packed.maxBlendK);
    // counts2.y is the BARE-BONES bypass: a bone-only chunk (the melt's
    // released skeleton groups) has no wound to be near, and the nearWound
    // gate would march an empty field — the chunk would be invisible.
    // w is the per-ray wound list gate (march.wgsl.ts counts2.w), preserved
    // across uploads like z above.
    u.counts2.value.set(packed.boneCount, nextPrims.length === 0 ? 1 : 0, u.counts2.value.z, u.counts2.value.w);
    u.marchCfg.value.x = 48; // chunks are small; fewer steps
    // Torn-meat gore mask — for FLESH chunks. A bone-only chunk (the melt's
    // released skeleton groups) is not torn meat; the mask would paint bare
    // bone red and the puddle's pale bits would read as more goo.
    u.lodCfg.value.w = nextPrims.length > 0 ? 1 : 0;
    u.faceCfg.value.x = c.limb === 'head' ? 1 : 0;
    u.headCentre.value.set(c.pos[0], c.pos[1], c.pos[2]);
    u.headAxes.value.set(extent, extent, extent);
    proxySize = extent * 2 * 1.4 + packed.maxBlendK * 4 + 0.05;

    const { sx, sy, sz } = apply(c);
    mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
    // No mesh rotation: this box covers every orientation of the rotated
    // field, while squash remains in world axes.
    mesh.scale.set(proxySize * sx, proxySize * sy, proxySize * sz);
    u.bodyHalf.value.set(proxySize * sx / 2, proxySize * sy / 2, proxySize * sz / 2);
  }

  reset(chunk, prims, tornAt, bones);

  return {
    object: mesh,
    uniforms: u,
    volumeTexture: volTex,
    dataTexture: dataTex,
    reset,
    setPackBones(on: boolean) {
      if (on === packBones) return;
      packBones = on;
      // Re-pack from the stored reset() args so counts2.x and the packed
      // rows flip NOW, not on the next sever.
      if (lastReset) reset(lastReset.c, lastReset.prims, lastReset.tornAt, lastReset.bones);
    },
    // Chunks stay on the FLAT bone fold — see ChunkGpuView.setBoneCull.
    setBoneCull() {},
    setBoneCullMode() {},
    bakeData() {
      const c = current;
      const { sx, sy, sz } = squashFactors(c);
      // A prim's bend displacement is MID-RELATIVE (types.ts), so its world
      // transform is rotate-then-scale with NO translate — exactly
      // chunkPoint's map minus the pos term. At settle the predicate has
      // squash = 0, so this is a pure rotation either way.
      const xfVec = (v: Vec3): Vec3 => {
        const r = qRotate(c.quat, v);
        return [r[0] * sx, r[1] * sy, r[2] * sz];
      };
      const xf = (p: Primitive): Primitive => ({
        ...p,
        cluster: 0,
        a: chunkPoint(c, p.a, sx, sy, sz),
        b: chunkPoint(c, p.b, sx, sy, sz),
        bend: p.bend === undefined ? undefined : xfVec(p.bend),
      });
      const col = (u2: { value: THREE.Color }): Vec3 =>
        [u2.value.r, u2.value.g, u2.value.b];
      return {
        flesh: local.filter(p => p.op !== 'sub').map(xf),
        bones: localBones.map(xf),
        torn: tornLocals.map((t, i) => ({
          at: chunkPoint(c, t, sx, sy, sz),
          radius: tornRadii[i]!,
        })),
        carveK: u.woundCfg.value.y,
        centre: [c.pos[0], c.pos[1], c.pos[2]],
        extent,
        quat: c.quat,
        look: {
          baseColor: col(u.baseColor),
          deepColor: col(u.deepColor),
          fatColor: col(u.fatColor),
          mottleColor: col(u.mottleColor),
          organColor: col(u.organColor),
          visceraColor: col(u.visceraColor),
          woundDepthAmp: u.surfCfg3.value.x,
          fatDepth: u.surfCfg3.value.y,
          muscleDepth: u.surfCfg3.value.z,
          visceraAmp: u.surfCfg3.value.w,
          visceraDepth: u.visceraDepth.value,
          mottleAmp: u.surfCfg2.value.z,
          mottleScale: u.surfCfg2.value.w,
          organAmp: u.organAmp.value,
          goreStrength: u.lodCfg.value.w,
        },
        gore: u.lodCfg.value.w,
      };
    },
    posedBones(): Primitive[] {
      const { sx, sy, sz } = squashFactors(current);
      return localBones.filter(p => p.op === 'bone').map(p => ({
        ...p,
        a: chunkPoint(current, p.a, sx, sy, sz),
        b: chunkPoint(current, p.b, sx, sy, sz),
        scale: [p.scale[0] * sx, p.scale[1] * sy, p.scale[2] * sz] as Vec3,
        // bend rides the endpoints: recompute its control displacement in world
        bend: p.bend ? vsub(chunkPoint(current, bendCtrl(p.a, p.b, p.bend), sx, sy, sz),
          bendCtrl(chunkPoint(current, p.a, sx, sy, sz), chunkPoint(current, p.b, sx, sy, sz))) : undefined,
      }));
    },
    update(c: Chunk) {
      const { sx, sy, sz } = apply(c);
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.scale.set(proxySize * sx, proxySize * sy, proxySize * sz);
      u.bodyHalf.value.set(proxySize * sx / 2, proxySize * sy / 2, proxySize * sz / 2);
    },
    dispose() {
      mesh.geometry.dispose();
      if (ownsMaterial) material.dispose();
      dataTex.dispose();
      if (ownsVolume) volTex.dispose();
      delete mesh.userData[CHUNK_MATERIAL_STATE];
    },
  };
}
