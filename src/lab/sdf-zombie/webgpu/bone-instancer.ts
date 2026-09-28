// src/lab/sdf-zombie/webgpu/bone-instancer.ts
//
// Bones as instanced tubes (spec 2026-09-02-bone-tubes-design.md). One unit
// tube (bone-tube-geom.ts) drawn once per posed bone prim, in the POLYGONAL
// pass on the default layer with depth write on. The SDF composite's depth
// test then hides bone under flesh and reveals it in cavities — no gate, no
// mask. The vertex program is the twin of tubePoint(); keep them in step.
//
// wgslFn constraints (same as humanoid.wgsl.ts's header): each source string
// begins with `fn` — no leading comment — and helpers go through `includes`
// in DEPENDENCY order, because WGSL requires declaration before use. That is
// why qRotB is its own string (BONE_QROT_WGSL) rather than a second fn at the
// bottom of BONE_VERTEX_WGSL.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, uniform, attribute, positionWorld, cameraPosition, vec4, float, texture,
  mrt, mix, clamp, cameraProjectionMatrix, cameraViewMatrix,
} from 'three/tsl';
import type { Primitive } from '../types';
import { boneInstanceOf, buildTubeGeometry } from './bone-tube-geom';
import { encodeSurfaceClass, SURFACE_CLASS_MESH, type SurfaceOutputOptions } from './deferred-surface';
import { BODY_LIGHTS } from './march/body-lights.wgsl';
import { fallbackLightListNode } from './zombie-gpu';

/** 18 geometry floats + the owner's 4 packed light picks (iLights, shared light list Task 11)
 *  + the owner room's fill factor (iFill, Task 11b). */
export const INSTANCE_FLOATS = 23;
/** Float offset of iLights in an instance row: the owner actor's `bodyLights` (4 packed
 *  `index + weight`, -1 empty). NO_OWNER_PICKS marks an instance with no owning actor (a chunk's
 *  bones): it keeps the old single key even in list mode. */
export const ILIGHTS_OFFSET = 18;
export const NO_OWNER_PICKS = -2;
/** Float offset of iFill: the owner's room fill factor (roomFillFactor at the owner's root, the
 *  factor applyRoomFill scales the body's fill by). The list branch scales the bone ambient by it,
 *  so bone darkens with its body when the room's lamps die. Owner-less = 1. */
export const IFILL_OFFSET = 22;
/** The x/y/z/w of a light-picks vec4 (a THREE.Vector4, the actor view's `bodyLights` value). */
export interface PicksLike { x: number; y: number; z: number; w: number }

export interface BoneInstanceArrays {
  ab: Float32Array;           // INSTANCE_FLOATS per instance
  overflowed: boolean;
}
export function boneInstanceArrays(max: number): BoneInstanceArrays {
  return { ab: new Float32Array(max * INSTANCE_FLOATS), overflowed: false };
}

/**
 * Pack posed bone prims into the instance array. `alive` is the body's
 * cluster-alive table (undefined for chunk lists, whose bones are all live).
 * Same filter as packBody's bone rows: op 'bone' only, not dead, cluster alive.
 */
export function packBoneInstances(
  prims: readonly Primitive[], alive: readonly boolean[] | undefined,
  out: BoneInstanceArrays, max: number,
): number {
  let n = 0;
  out.overflowed = false;
  for (const p of prims) {
    if (p.op !== 'bone' || p.dead) continue;
    if (alive && !alive[p.cluster]) continue;
    if (n >= max) { out.overflowed = true; break; }
    const s = boneInstanceOf(p);
    const o = n * INSTANCE_FLOATS;
    out.ab.set(s.a, o); out.ab.set(s.b, o + 3); out.ab.set(s.c, o + 6);
    out.ab[o + 9] = s.r1; out.ab[o + 10] = s.r2;
    out.ab.set(s.scale, o + 11); out.ab.set(s.orient, o + 14);
    out.ab[o + 18] = NO_OWNER_PICKS; out.ab[o + 19] = NO_OWNER_PICKS;
    out.ab[o + 20] = NO_OWNER_PICKS; out.ab[o + 21] = NO_OWNER_PICKS;
    out.ab[o + 22] = 1;
    n++;
  }
  return n;
}

/** Quaternion rotation, shared by the vertex sweep. Separate source because
 *  WGSL requires declaration before use and wgslFn emits includes in order. */
export const BONE_QROT_WGSL = /* wgsl */ `fn qRotB(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}`;

/** Vertex sweep — the WGSL twin of tubePoint(). Returns world position in
 *  xyz; the normal is recomputed from the same inputs with wantNormal = 1. */
export const BONE_VERTEX_WGSL = /* wgsl */ `fn boneVertex(t: f32, theta: f32, lat: f32, iA: vec3<f32>, iB: vec3<f32>, iC: vec3<f32>, iR: vec2<f32>, iScale: vec3<f32>, iQ: vec4<f32>, wantNormal: f32) -> vec3<f32> {
  let inv = 1.0 / iScale;
  let mid = (iA + iB) * 0.5;
  let A = qRotB(iQ, iA - mid) * inv + mid * inv;
  let B = qRotB(iQ, iB - mid) * inv + mid * inv;
  let C = qRotB(iQ, iC - mid) * inv + mid * inv;
  let sphere = dot(B - A, B - A) < 1e-18;
  let w0 = (1.0 - t) * (1.0 - t);
  let w1 = 2.0 * t * (1.0 - t);
  let w2 = t * t;
  let centre = A * w0 + C * w1 + B * w2;
  var tan = vec3<f32>(0.0, 1.0, 0.0);
  if (!sphere) {
    tan = normalize(2.0 * (1.0 - t) * (C - A) + 2.0 * t * (B - C));
  }
  // 'ref' is a RESERVED WGSL keyword (real-device parse error, task 5 boot)
  // — the CPU mirror's refAxis name is used here too.
  let refAxis = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(tan.y) < 0.9);
  let u = normalize(cross(refAxis, tan));
  let v = cross(tan, u);
  let r = mix(iR.x, iR.y, t);
  var q = vec3<f32>(0.0);
  var nrm = vec3<f32>(0.0);
  if (lat < 0.0) {
    let ring = u * cos(theta) + v * sin(theta);
    q = centre + ring * r;
    nrm = ring;
  } else {
    let outDir = select(tan, -tan, t < 0.5);
    let ringW = cos(lat * 1.5707963);
    let rise = sin(lat * 1.5707963);
    let dir = (u * cos(theta) + v * sin(theta)) * ringW + outDir * rise;
    q = centre + dir * r;
    nrm = dir;
  }
  if (wantNormal > 0.5) {
    // normal of a scaled surface: n' = normalize(n / scale)
    return normalize(nrm * inv);
  }
  return q * iScale;
}`;

/** MATERIAL TERMS of the bone look (M2 task 2): wound exposure, mottle,
 *  blood stain and the resulting albedo — everything that is a property of
 *  the surface, not of the lights. Split out of boneShade verbatim so the
 *  deferred G-buffer can publish the same albedo the lit shader composes
 *  from, without re-deriving it or duplicating the shading. Returns
 *  vec4(albedo, expo): lit mode feeds the whole vec4 into boneShade
 *  (surfaceIn); surface mode reads xyz as the G-buffer albedo and maps w
 *  (the wound exposure, 0 dry..1 blood-slick) to roughness in TSL. */
export const BONE_SURFACE_WGSL = /* wgsl */ `fn boneSurface(p: vec3<f32>, boneColor: vec3<f32>, deepColor: vec3<f32>, look: vec4<f32>, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32> {
  // EXPOSURE from the wounds (the field's tissue-depth stain + cavity AO, faked):
  // bone under a crater's centre is exposed — pale, dry, lit; bone toward the
  // rim sits under blood and flesh — stained, dark, glossy. Nearest crater wins.
  var expo = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    if (f32(i) >= woundCount) { break; }
    let w = textureLoad(woundTex, vec2<i32>(i, 0), 0);
    let dist = length(p - w.xyz);
    expo = max(expo, clamp(1.0 - dist / max(w.w * 1.15, 1e-3), 0.0, 1.0));
  }
  expo = smoothstep(0.0, 1.0, expo);
  // look.x = stain toward deepColor
  // MOTTLE (owner, 2026-09-03: "uniform colour... should have random red
  // bits like the non-mesh bones"). The field's bone inherited the flesh
  // shader's noise; the tubes had none. Two octaves of value noise on world
  // position: a broad tissue-stain wash plus tight blood flecks where the
  // noise peaks. Stronger under blood (rim of a crater), fainter where a
  // crater's centre has scoured the bone.
  let nz = boneNoise(p * 55.0) * 0.65 + boneNoise(p * 140.0 + vec3<f32>(7.1, 3.3, 9.7)) * 0.35;
  let flecks = smoothstep(0.62, 0.80, boneNoise(p * 210.0 + vec3<f32>(2.0, 5.0, 1.0)));
  let mottle = clamp(nz * 0.6 + flecks * 0.9, 0.0, 1.0) * (1.0 - 0.5 * expo);
  let stain = clamp(mix(look.x, look.x * 0.2, expo) + mottle * 0.55, 0.0, 1.0);
  let albedo = mix(boneColor, deepColor * 0.8, stain) * (1.0 - 0.25 * flecks);
  return vec4<f32>(albedo, expo);
}`;

/** Lambert key + flashlight cone, the march's own formula (march.wgsl.ts
 *  ~2253-2290) on the same uniform values, minus wetness/scatter. The
 *  MATERIAL terms (exposure/mottle/stain/albedo) live in boneSurface above
 *  and arrive as `surfaceIn` — the light compose consumes them; it does not
 *  re-derive them. */
/** Value-noise helpers for the mottle in boneShade. Separate strings: wgslFn
 *  takes ONE fn per source and reads a second fn's params as inputs (a
 *  boneHash inside BONE_SHADE_WGSL made TSL ask for an input 'q', and the
 *  pipeline failed to build — first boot, 2026-09-03). */
export const BONE_HASH_WGSL = /* wgsl */ `fn boneHash(q: vec3<f32>) -> f32 {
  var p3 = fract(q * 0.1031);
  p3 = p3 + dot(p3, p3.zyx + vec3<f32>(31.32));
  return fract((p3.x + p3.y) * p3.z);
}`;
export const BONE_NOISE_WGSL = /* wgsl */ `fn boneNoise(q: vec3<f32>) -> f32 {
  let i = floor(q);
  let f = fract(q);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(boneHash(i), boneHash(i + vec3<f32>(1.0, 0.0, 0.0)), u.x);
  let b = mix(boneHash(i + vec3<f32>(0.0, 1.0, 0.0)), boneHash(i + vec3<f32>(1.0, 1.0, 0.0)), u.x);
  let c = mix(boneHash(i + vec3<f32>(0.0, 0.0, 1.0)), boneHash(i + vec3<f32>(1.0, 0.0, 1.0)), u.x);
  let d = mix(boneHash(i + vec3<f32>(0.0, 1.0, 1.0)), boneHash(i + vec3<f32>(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}`;
export const BONE_SHADE_WGSL = /* wgsl */ `fn boneShade(p: vec3<f32>, n: vec3<f32>, camPos: vec3<f32>, deepColor: vec3<f32>, ambient: vec3<f32>, look: vec4<f32>, lightDir: vec3<f32>, keyColor: vec3<f32>, lightCfg: vec2<f32>, spotPos: vec3<f32>, spotAxis: vec3<f32>, spotCfg: vec4<f32>, spotCfg2: vec4<f32>, spotColor: vec3<f32>, surfaceIn: vec4<f32>, picks: vec4<f32>, lights: ptr<storage, array<vec4<f32>>, read>, listOn: f32, fill: f32) -> vec3<f32> {
  // SHARED LIGHT LIST (plan 1, Task 11). listOn > 0.5 and an owned instance (picks.x > -1.5;
  // -2 = no owner, a chunk's bones or an ejected eye): the KEY is the owner body's 4 picks. Only
  // the key changes. Ambient, AO, the wet tint, the gloss (look.z) and the fresnel stay, and the
  // compose mirrors the march's list compose (albedo x diffuse, + spec, + rim); the fresnel rides
  // the dominant's colour as the march's does, or the key colour when nothing is picked.
  // The ambient (seeded once at spawn) is scaled by the owner room's fill factor (Task 11b, the
  // body's applyRoomFill factor), so bone darkens with its body when the room's lamps die.
  if (listOn > 0.5 && picks.x > -1.5) {
    let V = normalize(camPos - p);
    let bl = bodyLights(p, n, V, picks, lights, false, false);
    let peak = max(bl.domC.x, max(bl.domC.y, bl.domC.z));
    let rimC = select(keyColor, bl.domC / max(peak, 1e-4), peak > 1e-4);
    let expoL = surfaceIn.w;
    let fresL = pow(1.0 - max(dot(n, V), 0.0), 4.0) * look.w;
    let wetL = mix(vec3<f32>(1.0), deepColor, look.y * (1.0 - 0.6 * expoL));
    let aoL = mix(0.45, 1.0, expoL);
    let diffL = surfaceIn.xyz * (ambient * fill + bl.diffuse) * aoL;
    let specL = wetL * (bl.spec * look.z * mix(1.3, 0.7, expoL) + rimC * fresL * (0.5 + 0.5 * peak)) + bl.rim;
    return diffL + specL;
  }
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
  }
  // The flesh's own composition (march.wgsl.ts fleshLit), minus AO/scatter:
  // ambient fill from the enclosure, wrapped diffuse, WET specular + fresnel
  // (bone in a fresh cavity is blood-slick), and a blood stain toward the
  // deep tissue colour so it does not read as chalk against the meat.
  // albedo + exposure come from boneSurface (surfaceIn = vec4(albedo, expo))
  // — the exact terms the deferred G-buffer publishes.
  let V = normalize(camPos - p);
  let ndl = max(dot(n, L), 0.0);
  let H = normalize(L + V);
  let albedo = surfaceIn.xyz;
  let expo = surfaceIn.w;
  // look = (stain [consumed in boneSurface], blood tint on the highlight, spec gain, fresnel gain)
  let shine = pow(max(dot(n, H), 0.0), 48.0);
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * look.w;
  let wetTint = mix(vec3<f32>(1.0), deepColor, look.y * (1.0 - 0.6 * expo));
  let ao = mix(0.45, 1.0, expo);
  let diffuse = albedo * (ambient + keyI * keyC * (0.15 + 0.85 * ndl)) * ao;
  let specular = keyC * wetTint * (shine * look.z * keyI * mix(1.3, 0.7, expo) + fres * (0.5 + 0.5 * keyI));
  return diffuse + specular;
}`;

export interface BoneInstancer {
  object: THREE.Mesh;
  uniforms: BoneInstancerUniforms;
  /** Packed emissionClass value when built with output:'surface' (M2 task
   *  2); undefined in the default lit mode. Route diagnostics read this. */
  readonly surfaceKind: number | undefined;
  /** Replace this frame's bone set. Each entry is a posed prim list + its
   *  cluster-alive table (undefined for chunks). */
  update(sources: ReadonlyArray<{ prims: readonly Primitive[]; alive?: readonly boolean[]; lights?: PicksLike; owner?: unknown }>): void;
  /** Copy each instance's owner picks (the `lights` its source passed to update, read NOW) into
   *  iLights, and `fillOf(owner)` (the source's `owner`; Task 11b) into iFill. Call after this
   *  frame's picks are written (the game's light loop runs after update); update also calls it
   *  (without fillOf: iFill = 1). No owner, or no fillOf: fill 1. Allocation-free. */
  syncLights(fillOf?: (owner: unknown) => number): void;
  /** This frame's craters (world centre + radius) for the exposure gradient. */
  setWounds(wounds: ReadonlyArray<{ pos: readonly [number, number, number]; radius: number }>): void;
  readonly count: number;
  readonly overflowed: boolean;
  /** The packed instance array (INSTANCE_FLOATS per row, `count` rows live)
   *  — read by the probe gather to build body occluder capsules. Do not
   *  write to it. */
  readonly instances: Float32Array;
  dispose(): void;
}

/** The instancer's uniform set, in a factory so the interface can keep the
 *  CONCRETE value types (ReturnType-of-literal, the zombie-gpu defaultUniforms
 *  idiom) — a hand-written ReturnType<typeof uniform> erases .value to
 *  unknown and the game wiring could not copy into it. */
export const boneInstancerUniforms = () => ({
  boneColor: uniform(new THREE.Color(0.93, 0.89, 0.80)),
    deepColor: uniform(new THREE.Color(0.45, 0.06, 0.05)),
    ambient: uniform(new THREE.Color(0.06, 0.06, 0.06)),
    /** (stain, wetTint, specGain, fresGain) — __sdfGame.setBoneLook tunes it live. */
    look: uniform(new THREE.Vector4(0.65, 0.5, 1.2, 0.6)),
    woundCount: uniform(0),
  lightDir: uniform(new THREE.Vector3(0.3, 0.8, 0.5)),
  keyColor: uniform(new THREE.Color(1, 0.95, 0.9)),
  lightCfg: uniform(new THREE.Vector2(2.4, 0.06)),
  spotPos: uniform(new THREE.Vector3()),
  spotAxis: uniform(new THREE.Vector3(0, 0, -1)),
  spotCfg: uniform(new THREE.Vector4(0, 0.93, 0.80, 16)),
  spotCfg2: uniform(new THREE.Vector4(4, 0.35, 0, 0)),
  spotColor: uniform(new THREE.Color(0.94, 0.96, 1.0)),
  /** x = 1: owned instances take their owner's 4 list lights (the game sets it only while the
   *  shared light list is on); 0 = the old single key, exactly. */
  lightListCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
});
export type BoneInstancerUniforms = ReturnType<typeof boneInstancerUniforms>;

/** Dry-bone roughness for the G-buffer (surface mode): matte. */
const BONE_ROUGH_DRY = 0.85;
/** Blood-exposed bone tightens to the lit model's fixed 48-exponent gloss
 *  mapped through the shared light pass's shin = exp2((1-rough)*8) + 2:
 *  48 -> rough 0.31 (the same inversion deferred-sdf.ts documents). */
const BONE_ROUGH_EXPOSED = 0.31;

/** `lightList`: the game's shared light-list storage node (ctx.world.light.list.node). Omitted,
 *  the zero fallback is bound (a declared storage input must always be bound); lightListCfg.x
 *  stays 0 there, so it is never read. */
export function createBoneInstancer(max = 256, options?: SurfaceOutputOptions, lightList?: unknown): BoneInstancer {
  const base = buildTubeGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.getIndex());
  for (const name of ['position', 'tubeT', 'tubeTheta', 'tubeLat']) geo.setAttribute(name, base.getAttribute(name));
  const arrays = boneInstanceArrays(max);
  const ib = new THREE.InstancedInterleavedBuffer(arrays.ab, INSTANCE_FLOATS, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  geo.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 3, 6));
  geo.setAttribute('iR', new THREE.InterleavedBufferAttribute(ib, 2, 9));
  geo.setAttribute('iScale', new THREE.InterleavedBufferAttribute(ib, 3, 11));
  geo.setAttribute('iQ', new THREE.InterleavedBufferAttribute(ib, 4, 14));
  geo.setAttribute('iLights', new THREE.InterleavedBufferAttribute(ib, 4, ILIGHTS_OFFSET));
  geo.setAttribute('iFill', new THREE.InterleavedBufferAttribute(ib, 1, IFILL_OFFSET));
  geo.instanceCount = 0;

  const u = boneInstancerUniforms();
  /** Up to 64 craters (xyz world, w radius) for the exposure gradient. */
  const MAX_WOUNDS_TEX = 64;
  const woundData = new Float32Array(MAX_WOUNDS_TEX * 4);
  const woundTex = new THREE.DataTexture(woundData, MAX_WOUNDS_TEX, 1, THREE.RGBAFormat, THREE.FloatType);
  woundTex.minFilter = THREE.NearestFilter; woundTex.magFilter = THREE.NearestFilter; woundTex.generateMipmaps = false;
  woundTex.needsUpdate = true;

  // Dependency-ordered includes via the repo's reduce idiom (zombie-gpu.ts
  // buildMarchFn): qRotB declared before boneVertex, as WGSL requires.
  const [qrot, vert] = [BONE_QROT_WGSL, BONE_VERTEX_WGSL].reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  void qrot;
  // Same idiom for the fragment side: boneHash -> boneNoise -> boneSurface
  // (material terms) -> boneShade (light compose, consumes surfaceIn).
  // BODY_LIGHTS sits just before boneShade (it calls none of the others).
  const [, , surfaceFn, , shade] = [
    BONE_HASH_WGSL, BONE_NOISE_WGSL, BONE_SURFACE_WGSL, BODY_LIGHTS, BONE_SHADE_WGSL,
  ].reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [],
  );
  const args = {
    t: attribute('tubeT', 'float'), theta: attribute('tubeTheta', 'float'), lat: attribute('tubeLat', 'float'),
    iA: attribute('iA', 'vec3'), iB: attribute('iB', 'vec3'), iC: attribute('iC', 'vec3'),
    iR: attribute('iR', 'vec2'), iScale: attribute('iScale', 'vec3'), iQ: attribute('iQ', 'vec4'),
  };
  const material = new MeshBasicNodeMaterial();
  // The instanced bone vertex positions and normals are retained in BOTH
  // modes (M2 task 2): positionNode skins the tube; normalNode is the
  // world-space bone surface normal — the lit shade consumes it as `n`, the
  // surface mode publishes it straight into normalMetalness.
  material.positionNode = vert({ ...args, wantNormal: float(0) }) as never;
  material.normalNode = vert({ ...args, wantNormal: float(1) }) as never;

  /** Material terms: vec4(albedo, wound exposure) — the same node the lit
   *  compose consumes, evaluated with NO light input. */
  const surf = surfaceFn({
    p: positionWorld,
    boneColor: u.boneColor, deepColor: u.deepColor, look: u.look,
    woundTex: texture(woundTex), woundCount: u.woundCount,
  }) as unknown as { xyz: unknown; w: unknown };

  let surfaceKind: number | undefined;
  if (options?.output === 'surface') {
    // MRT from the material terms only — no light compose anywhere in this
    // graph (light-invariance is structural: shade/light uniforms are not
    // even referenced). Bones are mesh-class receivers ('full' by default;
    // the game may pass 'level-only' for tissue). No metal, no emission.
    const kind = encodeSurfaceClass(SURFACE_CLASS_MESH, options.shadowReceiver ?? 'full');
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionWorld, 1.0));
    material.mrtNode = mrt({
      albedoRoughness: vec4(
        surf.xyz as never,
        clamp(mix(float(BONE_ROUGH_DRY), float(BONE_ROUGH_EXPOSED), surf.w as never), 0.04, 1.0) as never,
      ),
      normalMetalness: vec4(material.normalNode as never, float(0)),
      emissionClass: vec4(float(0), float(0), float(0), float(kind)),
      surfaceDepth: vec4(clip.z.div(clip.w) as never, float(0), float(0), float(1)),
      // Mesh response has no authored flesh parameters; still write every MRT lane.
      surfaceParams: vec4(float(0), float(0), float(0), float(1)),
    }) as never;
    material.blending = THREE.NoBlending; // MRT producer — the M1 mesh rule
    // Route-diagnostic marker ON THE MATERIAL (the same stamp zombie-gpu's
    // march material carries): the task-3 router's materialEligibility reads
    // material.surfaceKind to admit surface producers into the G-buffer
    // passes. The handle getter below predates the router and is not enough
    // — without this stamp a surface-mode bone tube is diagnosed as an
    // unsupported MeshBasicNodeMaterial and hidden from its pass (found by
    // the task-5 game boot check, 2026-09-07).
    (material as unknown as { surfaceKind: number }).surfaceKind = kind;
    surfaceKind = kind;
  } else {
    material.colorNode = vec4(shade({
      p: positionWorld, n: material.normalNode, camPos: cameraPosition,
      deepColor: u.deepColor, ambient: u.ambient, look: u.look,
      lightDir: u.lightDir, keyColor: u.keyColor, lightCfg: u.lightCfg,
      spotPos: u.spotPos, spotAxis: u.spotAxis, spotCfg: u.spotCfg, spotCfg2: u.spotCfg2, spotColor: u.spotColor,
      surfaceIn: surf as never,
      picks: attribute('iLights', 'vec4'),
      lights: (lightList ?? fallbackLightListNode()) as never,
      listOn: u.lightListCfg.x,
      fill: attribute('iFill', 'float'),
    }) as never, 1.0);
  }
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;   // instances are in world space; the mesh sits at the origin
  let count = 0;
  /** Each live instance's owner picks (a reference, read at syncLights); undefined = no owner. */
  const owners: (PicksLike | undefined)[] = [];
  /** Each live instance's owner key (the source's `owner`, handed to fillOf). */
  const ownerKeys: unknown[] = [];
  /** Upload only the live rows (M3): the buffer is DynamicDrawUsage, so three uploads it every
   *  frame, the whole `max` rows unless a range is set; r186's WebGPU backend honours an
   *  InterleavedBuffer's updateRanges (clears them after the write). */
  const markLive = () => {
    ib.clearUpdateRanges();
    ib.addUpdateRange(0, Math.max(count, 1) * INSTANCE_FLOATS);
    ib.needsUpdate = true;
  };
  const syncLights = (fillOf?: (owner: unknown) => number) => {
    const ab = arrays.ab;
    let lastKey: unknown = undefined, lastFill = 1;
    for (let i = 0; i < count; i++) {
      const l = owners[i];
      const o = i * INSTANCE_FLOATS + ILIGHTS_OFFSET;
      if (l) { ab[o] = l.x; ab[o + 1] = l.y; ab[o + 2] = l.z; ab[o + 3] = l.w; }
      else { ab[o] = NO_OWNER_PICKS; ab[o + 1] = NO_OWNER_PICKS; ab[o + 2] = NO_OWNER_PICKS; ab[o + 3] = NO_OWNER_PICKS; }
      // One fill per owner (an owner's rows are contiguous): the lookup runs once per run.
      const k = ownerKeys[i];
      if (k === undefined || !fillOf) lastFill = 1;
      else if (k !== lastKey) lastFill = fillOf(k);
      lastKey = k;
      ab[i * INSTANCE_FLOATS + IFILL_OFFSET] = lastFill;
    }
    markLive();
  };

  return {
    object: mesh,
    uniforms: u,
    get surfaceKind() { return surfaceKind; },
    update(sources) {
      let n = 0;
      arrays.overflowed = false;
      for (const s of sources) {
        const room = max - n;
        if (room <= 0) { arrays.overflowed = true; break; }
        const sub = boneInstanceArrays(0);
        sub.ab = arrays.ab.subarray(n * INSTANCE_FLOATS);
        const n0 = n;
        n += packBoneInstances(s.prims, s.alive, sub, room);
        for (let i = n0; i < n; i++) { owners[i] = s.lights; ownerKeys[i] = s.owner; }
        if (sub.overflowed) arrays.overflowed = true;
      }
      count = n;
      owners.length = n;
      ownerKeys.length = n;
      syncLights();
      geo.instanceCount = n;
      mesh.visible = n > 0;
    },
    syncLights,
    setWounds(wounds) {
      const n = Math.min(wounds.length, MAX_WOUNDS_TEX);
      for (let i = 0; i < n; i++) { const w = wounds[i]!; woundData.set([w.pos[0], w.pos[1], w.pos[2], w.radius], i * 4); }
      u.woundCount.value = n;
      woundTex.needsUpdate = true;
    },
    get count() { return count; },
    get overflowed() { return arrays.overflowed; },
    get instances() { return arrays.ab; },
    dispose() { geo.dispose(); base.dispose(); material.dispose(); woundTex.dispose(); },
  };
}
