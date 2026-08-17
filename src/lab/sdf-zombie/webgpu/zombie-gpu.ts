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
  wgslFn, positionWorld, cameraPosition, vec4, uniform, texture, float,
  cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add, screenUV,
} from 'three/tsl';
import type { BuildResult } from '../build-body';
import { packBody, PRIM_STRIDE } from '../pack';
import { MAX_PRIMS } from '../validate';
import { MAX_WOUNDS } from '../damage';
import { chunkPoint, squashFactors, type Chunk } from '../gib-chunks';
import type { FleshMaterial, LightPreset } from '../material';
import type { Primitive, Vec3 } from '../types';
import { sub as vsub } from '../vec';
import { chunkExtent, tornEndRadius } from '../extent';
import { specialiseMapBody } from './specialise';
import {
  HELPERS, MARCH_BODY, CONE_MARCH, DATA_ROWS,
  ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT, ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE,
  ROW_WOUND, ROW_WOUND_META,
} from './march.wgsl';

export interface ZombieGpuView {
  object: THREE.Object3D;
  /** The coarse cone-march twin, rendered into the pre-pass targets. */
  coneObject: THREE.Object3D;
  /** Live uniforms — the WebGPU stand-in for `ShaderMaterial.uniforms`. */
  uniforms: MarchUniforms;
  /** Re-upload after the body changes (sever, override edit, rig step). */
  update(body: BuildResult): void;
  /** Uploads wounds already transformed to world space by the caller.
   *  splay/offsetScales are the per-wound rim multipliers (WOUND_PROFILES);
   *  omitted, they default to 1 — chunk torn ends pass nothing and get 1s. */
  setWounds(worldPositions: Vec3[], radii: number[], types: number[], ages: number[],
    splayScales?: number[], offsetScales?: number[]): void;
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
function buildMarchFn(mapBodySrc?: string) {
  // Swap one entry in the dependency-ordered helper list. mapBody sits at a
  // fixed place in that order — after the things it calls, before calcNormal
  // which calls it — so the specialised version has to go in the SAME slot or
  // WGSL's declaration-before-use rule breaks.
  const sources = mapBodySrc
    ? HELPERS.map(h => (/^fn\s+mapBody\s*\(/.test(h) ? mapBodySrc : h))
    : HELPERS;
  const nodes = sources.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice())], [],
  );
  return wgslFn(MARCH_BODY, nodes);
}

/** The default march entry (plus its dependency-ordered helpers), shared by
 *  the body views and the hands view. */
export const marchBody = buildMarchFn();

/** The coarse cone-march entry, sharing the same dependency-ordered helpers. */
const coneMarch = (() => {
  const nodes = HELPERS.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice())], [],
  );
  return wgslFn(CONE_MARCH, nodes);
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
    woundCfg2: uniform(new THREE.Vector4(0.42, 1.4, 0, 0)),
    baseColor: uniform(new THREE.Color(0xc46a72)),
    deepColor: uniform(new THREE.Color(0x8c1420)),
    charColor: uniform(new THREE.Color(0x1a1214)),
    lightDir: uniform(new THREE.Vector3(0.45, 0.72, 0.53)),
    keyColor: uniform(new THREE.Color(1, 0.96, 0.92)),
    /** x keyIntensity, y fillIntensity */
    lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
    /** x specIntensity, y specRoughness, z fresnelBoost, w translucency */
    surfCfg: uniform(new THREE.Vector4(0.95, 0.12, 0.85, 0.45)),
    /** x wetness, y surfaceNoiseAmp */
    surfCfg2: uniform(new THREE.Vector2(1.0, 0.06)),
    /** x enabled, y strength, z forward (+1/-1), w relief */
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
  };
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

/** Builds the march material (depth-writing proxy-box shader). Exported for
 *  the hands view — one material builder, one look. */
export function createMarchMaterial(
  dataTex: THREE.Texture, u: MarchUniforms, march = marchBody,
  cone?: ConeSource, occluder?: OccluderSource,
) {
  const marched = march({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    faceTex: u.faceTex,
    counts: u.counts,
    marchCfg: u.marchCfg,
    woundCfg: u.woundCfg,
    woundCfg2: u.woundCfg2,
    baseColor: u.baseColor,
    deepColor: u.deepColor,
    charColor: u.charColor,
    lightDir: u.lightDir,
    keyColor: u.keyColor,
    lightCfg: u.lightCfg,
    surfCfg: u.surfCfg,
    surfCfg2: u.surfCfg2,
    faceCfg: u.faceCfg,
    faceCfg2: u.faceCfg2,
    faceCfg3: u.faceCfg3,
    faceProj: u.faceProj,
    faceAtlas: u.faceAtlas,
    headCentre: u.headCentre,
    headAxes: u.headAxes,
    headQuat: u.headQuat,
    faceGlowColor: u.faceGlowColor,
    lodCfg: u.lodCfg,
    startT: cone
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
  }) as unknown as Swizzled;

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.BackSide;

  // Depth from the marched hit, so the body composites with real geometry.
  // WebGPU clip z is already [0,1] — no `* 0.5 + 0.5` remap, unlike the GLSL.
  const rayDir = normalize(sub(positionWorld, cameraPosition));
  const hitPos = add(cameraPosition, mul(rayDir, marched.w as never));
  const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
  const depth = clip.z.div(clip.w);

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
  function writeRow(row: number, src: Float32Array, count: number) {
    const base = row * MAX_PRIMS * 4;
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
 * Exported for the hands view, which owns its own (splash-wound) ring.
 */
export function writeWounds(
  texels: Float32Array,
  worldPositions: Vec3[], radii: number[], types: number[], ages: number[],
  splayScales?: number[], offsetScales?: number[],
): number {
  const n = Math.min(worldPositions.length, MAX_WOUNDS);
  const wBase = ROW_WOUND * MAX_PRIMS * 4;
  const mBase = ROW_WOUND_META * MAX_PRIMS * 4;
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
  }
  return n;
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
  /**
   * Generate a shader specialised to THIS body's structure — loops unrolled,
   * carve decisions and blend constants baked. See specialise.ts. Costs one
   * pipeline compile per distinct structure, so it is opt-in until measured.
   */
  specialise?: boolean;
}

export function createZombieGpuView(
  body: BuildResult, opts: GpuViewOpts = {},
): ZombieGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(blankFaceTexture());

  function upload(next: BuildResult) {
    const p = packBody(next);
    writeRow(ROW_PRIM_A, p.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, p.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, p.primScale, MAX_PRIMS);
    writeRow(ROW_PRIM_QUAT, p.primQuat, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, p.clusterBounds, p.clusterCount);
    writeRow(ROW_CLUSTER_RANGE, p.clusterRange, p.clusterCount);
    dataTex.needsUpdate = true;
    u.counts.value.set(p.primCount, p.clusterCount, p.carveCount, p.maxBlendK);
    return p;
  }

  const packed = upload(body);
  const material = createMarchMaterial(
    dataTex, u,
    opts.specialise ? buildMarchFn(specialiseMapBody(body)) : marchBody,
    opts.cone, opts.occluder);

  // The coarse twin: same field, same proxy box, no shading, its own mesh on
  // its own layer. Writes the conservative start distance into .x, and the
  // same value normalised as DEPTH — so where proxy boxes overlap the hardware
  // depth test resolves to the NEAREST start, which is the one value that is
  // safe for every body in that tile.
  const coneT = coneMarch({
    worldPos: positionWorld,
    camPos: cameraPosition,
    data: texture(dataTex),
    counts: u.counts,
    marchCfg: u.marchCfg,
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

  return {
    object: mesh,
    coneObject: coneMesh,
    uniforms: u,
    update(next) {
      const p = upload(next);
      const f = fit(next, p.maxBlendK);
      mesh.position.copy(f.centre);
      // Per-axis, since the box is an AABB: severing a leg shortens it without
      // narrowing it, and a uniform scale would either clip or over-cover.
      mesh.scale.set(
        f.size.x / first.size.x, f.size.y / first.size.y, f.size.z / first.size.z);
      coneMesh.position.copy(mesh.position);
      coneMesh.scale.copy(mesh.scale);
    },
    setWounds(worldPositions, radii, types, ages, splayScales, offsetScales) {
      u.woundCfg.value.x = writeWounds(texels, worldPositions, radii, types, ages, splayScales, offsetScales);
      dataTex.needsUpdate = true;
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
      u.surfCfg2.value.set(m.wetness, m.surfaceNoiseAmp);
      u.marchCfg.value.z = m.silhouetteNoiseAmp;
      u.lightDir.value.set(...light.keyDir);
      u.keyColor.value.setRGB(...light.keyColor);
      u.lightCfg.value.set(light.keyIntensity, light.fillIntensity);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      coneMaterial.dispose();
      dataTex.dispose();
    },
  };
}

export interface ChunkGpuView {
  object: THREE.Object3D;
  /** Live uniforms (copied from the body template at spawn; the noise root
   *  shift zw is re-anchored to the chunk's own position on every update). */
  uniforms: MarchUniforms;
  update(chunk: Chunk): void;
  dispose(): void;
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
): ChunkGpuView {
  const { tex: dataTex, texels, writeRow } = createDataTexture();
  const u = defaultUniforms(template.faceTex.value);

  // Copy the body's look across. Anything not copied here is a deliberate
  // per-chunk override further down.
  u.baseColor.value.copy(template.baseColor.value);
  u.deepColor.value.copy(template.deepColor.value);
  u.charColor.value.copy(template.charColor.value);
  u.lightDir.value.copy(template.lightDir.value);
  u.keyColor.value.copy(template.keyColor.value);
  u.lightCfg.value.copy(template.lightCfg.value);
  u.surfCfg.value.copy(template.surfCfg.value);
  u.surfCfg2.value.copy(template.surfCfg2.value);
  u.marchCfg.value.copy(template.marchCfg.value);
  u.woundCfg.value.copy(template.woundCfg.value);
  u.woundCfg2.value.copy(template.woundCfg2.value);
  u.faceCfg.value.copy(template.faceCfg.value);
  u.faceCfg2.value.copy(template.faceCfg2.value);
  u.faceCfg3.value.copy(template.faceCfg3.value);
  u.lodCfg.value.copy(template.lodCfg.value);
  u.faceProj.value.copy(template.faceProj.value);
  u.headQuat.value.copy(template.headQuat.value);
  u.faceAtlas.value.copy(template.faceAtlas.value);
  u.faceGlowColor.value.copy(template.faceGlowColor.value);

  // chunk.pos is the cluster centre at sever time, so this recentres the
  // severed limb's rest-space primitives around the chunk's own origin.
  const local = prims.map(p => ({
    ...p,
    cluster: 0,
    a: vsub(p.a, chunk.pos),
    b: vsub(p.b, chunk.pos),
  }));

  // The chunk's TRUE extent, not chunk.radius: a real limb is 0.3-0.45 across
  // where chunk.radius is 0.14, and the shader's cluster-bounds cull would
  // erase anything reaching past it.
  const extent = chunkExtent(prims, chunk.pos);
  const tornLocals: Vec3[] = (tornAt ?? []).map(t => vsub(t, chunk.pos));
  // Girth at the tear, NOT extent: extent is length-dominated, and a wound
  // radius that scales with length swallows the capsule silhouette (X1.16).
  const tornRadii = tornLocals.map(t => tornEndRadius(local, t));

  const packed = packBody({
    prims: local,
    clusters: [{
      id: 0, limb: chunk.limb, start: 0, count: local.length,
      center: [0, 0, 0], radius: extent, alive: true,
    }],
    bones: new Map(),
  });

  writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
  writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
  writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
  writeRow(ROW_PRIM_QUAT, packed.primQuat, MAX_PRIMS);
  writeRow(ROW_CLUSTER_RANGE, packed.clusterRange, 1);
  // The quat row is written ONCE, here: a chunk's tumble rotates its packed
  // ENDPOINTS (apply() below) but leaves each prim's orient frozen at its
  // sever-time value — so a severed head's face ellipsoids keep the pose the
  // head had when it came off. sever.ts's prim copies preserve the field via
  // spread; a copy without it would silently drop the face's orientation.
  // A severed head keeps its face: the cluster slice carries its carves, and
  // apply() below rewrites only xyz per endpoint, leaving the packed sign in .w.
  u.counts.value.set(packed.primCount, 1, packed.carveCount, packed.maxBlendK);
  // Chunks are small; fewer steps.
  u.marchCfg.value.x = 48;
  // Gore mask (gobs-and-goo §2): a chunk is torn meat, not clean latex. The
  // body view keeps w=0, so the shader skips the block entirely there. The
  // head keeps gore too — it just tore off; its face still paints over it.
  u.lodCfg.value.w = 1;
  // Only a severed HEAD carries the face. Without this a flying arm would get
  // one projected onto it, since every chunk's own cluster 0 is itself.
  u.faceCfg.value.x = chunk.limb === 'head' ? 1 : 0;
  // A severed head keeps its face, so give it its own skull sphere centred on
  // the chunk — the body's points at the original, now-absent head.
  u.headCentre.value.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
  u.headAxes.value.set(extent, extent, extent);

  const material = createMarchMaterial(dataTex, u);
  const size = extent * 2 * 1.4 + packed.maxBlendK * 4 + 0.05;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
  mesh.frustumCulled = false;

  /** Writes the local prims into the world-space data rows for state `c`. */
  function apply(c: Chunk): { sx: number; sy: number; sz: number } {
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
    });
    packed.clusterBounds.set([c.pos[0], c.pos[1], c.pos[2], extent * Math.max(sx, sy, sz)], 0);

    writeRow(ROW_PRIM_A, packed.primA, MAX_PRIMS);
    writeRow(ROW_PRIM_B, packed.primB, MAX_PRIMS);
    writeRow(ROW_PRIM_SCALE, packed.primScale, MAX_PRIMS);
    writeRow(ROW_CLUSTER_BOUNDS, packed.clusterBounds, 1);

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

  const firstApply = apply(chunk);
  mesh.position.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
  // No mesh rotation: the proxy box stays axis-aligned — its size
  // (extent * 2 * 1.4 + ...) already covers every orientation of the rotated
  // field, and rotating the box while squash acts in world axes would
  // under-cover.
  mesh.scale.set(firstApply.sx, firstApply.sy, firstApply.sz);

  return {
    object: mesh,
    uniforms: u,
    update(c: Chunk) {
      const { sx, sy, sz } = apply(c);
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.scale.set(sx, sy, sz);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      dataTex.dispose();
    },
  };
}
