import type { Vec3 } from '../../types';

export interface LocalBounds { min: Vec3; max: Vec3 }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  1 - smoothstep(0.72, 1, Math.hypot((x - cx) / rx, (y - cy) / ry));

/** Position in a source's rigid local AABB, signed -1..1 on each axis.
 * Zombie.blob defines +z as the face direction, +y up and +x left/right. */
export function meshAppearanceCoord(bounds: LocalBounds, p: Vec3): Vec3 {
  const axis = (k: number) => {
    const span = Math.max(bounds.max[k]! - bounds.min[k]!, 1e-6);
    return ((p[k]! - bounds.min[k]!) / span) * 2 - 1;
  };
  return [axis(0), axis(1), axis(2)];
}

// ---------------------------------------------------------------------------
// CPU mirrors of the shader fields. The WGSL below and these functions must
// stay in lockstep; the mirrors exist so the field MAPPING (patch class
// boundaries, front-face occlusion, two tooth rows, gloss-vs-cavity) is unit
// tested instead of only substring-matched.
// ---------------------------------------------------------------------------

/** boneHash (bone-instancer.ts) reimplemented in TS for the mirrors. */
export function boneHash3(q: Vec3): number {
  let px = fract(q[0] * 0.1031);
  let py = fract(q[1] * 0.1031);
  let pz = fract(q[2] * 0.1031);
  const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
  px += d; py += d; pz += d;
  return fract((px + py) * pz);
}

/** boneNoise (bone-instancer.ts) reimplemented in TS for the mirrors. */
export function boneNoise3(q: Vec3): number {
  const ix = Math.floor(q[0]), iy = Math.floor(q[1]), iz = Math.floor(q[2]);
  const fx = q[0] - ix, fy = q[1] - iy, fz = q[2] - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const h = (x: number, y: number, z: number) => boneHash3([x, y, z]);
  const a = lerp(h(ix, iy, iz), h(ix + 1, iy, iz), ux);
  const b = lerp(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), ux);
  const c = lerp(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), ux);
  const d = lerp(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz);
}

const noiseOffset = (p: Vec3, s: number, o: Vec3): number =>
  boneNoise3([p[0] * s + o[0], p[1] * s + o[1], p[2] * s + o[2]]);

export interface TissueClasses {
  /** Dark burgundy blood / attachment blotches. */
  blood: number;
  /** Pink connective tissue. */
  connect: number;
  /** Limited exposed ivory. */
  ivory: number;
}

/** Discontinuous painted tissue classes: three independent local-space noise
 * fields thresholded into distinct zones. `headFlag` restores broad ivory patches on the
 * skull while retaining selective dark attachment tissue. Mirrors the surface WGSL. */
export function tissuePatchClasses(pLocal: Vec3, headFlag: number): TissueClasses {
  const blotch = noiseOffset(pLocal, 20.0, [4.2, 17.7, 2.9]);
  const warp = noiseOffset(pLocal, 6.0, [11.5, 1.7, 23.3]);
  const weave = noiseOffset(pLocal, 44.0, [7.1, 3.3, 9.7]);
  const grain = noiseOffset(pLocal, 110.0, [2.0, 5.0, 1.0]);
  const patchT = blotch * 0.72 + warp * 0.28;
  const blood = smoothstep(0.50, 0.60, patchT);
  const connect = smoothstep(0.34, 0.48, weave * 0.68 + warp * 0.32) * (1 - blood * 0.85);
  const ivory = smoothstep(0.53, 0.65, blotch * 0.5 + grain * 0.5)
    * (1 - blood * 0.85) * (1 - headFlag) + headFlag * (0.72 + 0.28 * grain) * (1 - blood * 0.85);
  return { blood, connect, ivory };
}

/** Front-only skull cavity coverage (sockets, nasal opening, mouth). */
export function meshSkullCavity(q: Vec3, headFlag: number): number {
  const front = smoothstep(0.05, 0.23, q[2]) * headFlag;
  const sockets = Math.max(
    ellipse(q[0], q[1], -0.36, 0.22, 0.27, 0.25),
    ellipse(q[0], q[1], 0.36, 0.22, 0.27, 0.25),
  ) * front;
  const nose = ellipse(q[0], q[1], 0, -0.08, 0.15, 0.25)
    * smoothstep(-0.34, -0.02, q[1]) * front;
  const mouth = ellipse(q[0], q[1], 0, -0.38, 0.52, 0.19) * front;
  const cheeks = Math.max(ellipse(q[0], q[1], -0.55, -0.19, 0.23, 0.22), ellipse(q[0], q[1], 0.55, -0.19, 0.23, 0.22)) * front;
  return Math.max(Math.max(sockets, nose), Math.max(mouth, cheeks));
}

/** Irregular branching vessels in the tissue immediately around each eye
 * socket: an annulus that starts just behind the seated eyeball, peaks on the
 * socket rim and fades out before the temple. Front-only and head-only, so the
 * markings stay eye-local instead of wrapping the skull. Mirrors the
 * socket-vein WGSL. */
export function meshSocketVessels(q: Vec3, headFlag: number): number {
  const front = smoothstep(0.10, 0.42, q[2]) * headFlag;
  const ring = (cx: number) => {
    const d = Math.hypot((q[0] - cx) / 0.30, (q[1] - 0.22) / 0.28);
    return smoothstep(0.55, 0.80, d) * (1 - smoothstep(1.02, 1.38, d));
  };
  const around = Math.max(ring(-0.36), ring(0.36)) * front;
  const n1 = noiseOffset(q, 26.0, [5.3, 13.1, 8.7]);
  const n2 = noiseOffset(q, 58.0, [21.7, 4.9, 16.3]);
  const ridge = Math.max(
    Math.pow(1 - Math.abs(n1 * 2 - 1), 5),
    Math.pow(1 - Math.abs(n2 * 2 - 1), 8) * 0.7,
  );
  const veinPatch = smoothstep(0.40, 0.62, noiseOffset(q, 8.0, [9.4, 3.6, 27.2]));
  return ridge * veinPatch * around;
}

/** One tooth row on a widening human arc: seven teeth per side, mirrored,
 * with per-tooth hash jitter for width, crown height, centre offset and
 * incisal-edge alignment. `upper` 1 = maxillary (hangs below the bite line),
 * 0 = mandibular (rises above it). Mirrors the tooth WGSL. */
export function meshToothRow(q: Vec3, upper: number): number {
  const ax = Math.abs(q[0]);
  const side = q[0] >= 0 ? 1 : -1;
  const bite = -0.38;
  let best = 0;
  for (let i = 0; i < 7; i++) {
    const r1 = boneHash3([i, side, 3]);
    const r2 = boneHash3([i, side, 11]);
    const r3 = boneHash3([i, side, 23]);
    const cx = 0.034 + 0.062 * i + 0.0016 * i * i + (r1 - 0.5) * 0.008;
    const hw = (0.030 + 0.0018 * i) * (0.88 + 0.24 * r2);
    const crown = (0.064 + 0.004 * i) * (0.84 + 0.30 * r3);
    const edge = 0.010 + (r2 - 0.5) * 0.006;
    const col = 1 - smoothstep(hw * 0.78, hw, Math.abs(ax - cx));
    let yLo: number, yHi: number;
    if (upper > 0.5) { yLo = bite + edge; yHi = bite + edge + crown; }
    else { yLo = bite - edge - crown; yHi = bite - edge; }
    const row = smoothstep(yLo - 0.004, yLo + 0.004, q[1])
      * (1 - smoothstep(yHi - 0.004, yHi + 0.004, q[1]));
    best = Math.max(best, col * row);
  }
  return best;
}

export interface SkullFeatureMasks {
  front: number; sockets: number; nose: number; mouth: number;
  cavity: number; upperTeeth: number; lowerTeeth: number; teeth: number;
}

/** CPU mirror of the shader's broad, front-only skull markings. These are
 * material cues rather than geometry cuts; keeping the math here makes their
 * scale, occlusion and tooth irregularity testable without a GPU. */
export function skullFeatureMasks(q: Vec3, headFlag = 1): SkullFeatureMasks {
  const front = smoothstep(0.05, 0.23, q[2]) * headFlag;
  const sockets = Math.max(
    ellipse(q[0], q[1], -0.36, 0.22, 0.27, 0.25),
    ellipse(q[0], q[1], 0.36, 0.22, 0.27, 0.25),
  ) * front;
  const nose = ellipse(q[0], q[1], 0, -0.08, 0.15, 0.25)
    * smoothstep(-0.34, -0.02, q[1]) * front;
  const mouth = ellipse(q[0], q[1], 0, -0.38, 0.52, 0.19) * front;
  const cavity = meshSkullCavity(q, headFlag);
  const upperTeeth = meshToothRow(q, 1) * cavity;
  const lowerTeeth = meshToothRow(q, 0) * cavity;
  return { front, sockets, nose, mouth, cavity, upperTeeth, lowerTeeth, teeth: Math.max(upperTeeth, lowerTeeth) };
}

/** Localized reinforcement visible through the Soldier's left temple/cheek. */
export function soldierSteelMask(q: Vec3, soldierHead=1): number {
  const front=smoothstep(0.08,0.42,q[2]);
  const temple=ellipse(q[0],q[1],-0.48,0.08,0.30,0.42);
  const brow=ellipse(q[0],q[1],-0.24,0.30,0.42,0.16);
  return Math.max(temple,brow)*front*soldierHead;
}

/** Dry gloss floor: dry tissue keeps a barely-there sheen, never a polish. */
export const MESH_GLOSS_DRY = 0.05;
/** Gloss at full wetness (glossy patch). */
export const MESH_GLOSS_WET = 1.0;
/** Mesh-only scale on the shared specular/fresnel gains (see renderer). */
export const MESH_SPEC_SCALE = 0.75;
export const MESH_FRES_SCALE = 0.6;

/** Per-fragment gloss multiplier. Wetness is an INDEPENDENT noise field, so
 * gloss varies without moving colour; a fresh crater is slick, skull cavities
 * and tooth recesses get no highlight. Mirrors the wet WGSL. */
export function meshGlossMask(pLocal: Vec3, q: Vec3, headFlag: number, expo: number): number {
  const w1 = noiseOffset(pLocal, 26.0, [3.7, 11.2, 5.9]);
  const w2 = noiseOffset(pLocal, 70.0, [19.3, 2.1, 27.4]);
  const wet = lerp(smoothstep(0.30, 0.68, w1 * 0.62 + w2 * 0.38), 0.9, clamp01(expo) * 0.45);
  let gloss = lerp(MESH_GLOSS_DRY, MESH_GLOSS_WET, wet);
  gloss *= 1 - 0.97 * meshSkullCavity(q, headFlag);
  // Socket vessels are wet tissue: they keep a sheen even inside the otherwise
  // matte dark socket recess, but only where the local vessel field says so.
  return Math.max(gloss, meshSocketVessels(q, headFlag) * 0.45);
}

// ---------------------------------------------------------------------------
// WGSL. Dependency order is load-bearing: the renderer builds each function
// with every EARLIER function as an include, so a callee must appear before
// its caller. Order here: hash -> noise -> tooth row -> skull cavity ->
// surface -> wet -> (shared BONE_SHADE last, added by the renderer).
// ---------------------------------------------------------------------------

export const MESH_TOOTH_ROW_WGSL = /* wgsl */ `fn meshToothRow(q: vec3<f32>, upper: f32) -> f32 {
  var best = 0.0;
  let ax = abs(q.x);
  let side = select(-1.0, 1.0, q.x >= 0.0);
  let bite = -0.38;
  for (var i = 0; i < 7; i = i + 1) {
    let fi = f32(i);
    let r1 = boneHash(vec3<f32>(fi, side, 3.0));
    let r2 = boneHash(vec3<f32>(fi, side, 11.0));
    let r3 = boneHash(vec3<f32>(fi, side, 23.0));
    let cx = 0.034 + 0.062 * fi + 0.0016 * fi * fi + (r1 - 0.5) * 0.008;
    let hw = (0.030 + 0.0018 * fi) * (0.88 + 0.24 * r2);
    let crown = (0.064 + 0.004 * fi) * (0.84 + 0.30 * r3);
    let edge = 0.010 + (r2 - 0.5) * 0.006;
    let col = 1.0 - smoothstep(hw * 0.78, hw, abs(ax - cx));
    var yLo = 0.0;
    var yHi = 0.0;
    if (upper > 0.5) {
      yLo = bite + edge;
      yHi = bite + edge + crown;
    } else {
      yLo = bite - edge - crown;
      yHi = bite - edge;
    }
    let row = smoothstep(yLo - 0.004, yLo + 0.004, q.y) * (1.0 - smoothstep(yHi - 0.004, yHi + 0.004, q.y));
    best = max(best, col * row);
  }
  return best;
}`;

export const MESH_SKULL_CAVITY_WGSL = /* wgsl */ `fn meshSkullCavity(q: vec3<f32>, headFlag: f32) -> f32 {
  let front = smoothstep(0.05, 0.23, q.z) * headFlag;
  let eyeL = 1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(-0.36, 0.22)) / vec2<f32>(0.27, 0.25)));
  let eyeR = 1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>( 0.36, 0.22)) / vec2<f32>(0.27, 0.25)));
  let sockets = max(eyeL, eyeR) * front;
  let nose = (1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(0.0, -0.08)) / vec2<f32>(0.15, 0.25))))
    * smoothstep(-0.34, -0.02, q.y) * front;
  let mouth = (1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(0.0, -0.38)) / vec2<f32>(0.52, 0.19)))) * front;
  let cheekL = 1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(-0.55, -0.19)) / vec2<f32>(0.23, 0.22)));
  let cheekR = 1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(0.55, -0.19)) / vec2<f32>(0.23, 0.22)));
  return max(max(sockets, nose), max(mouth, max(cheekL, cheekR) * front));
}`;

/** Branching red vessels around the eye sockets (front/head only). */
export const MESH_SOCKET_VESSEL_WGSL = /* wgsl */ `fn meshSocketVessels(q: vec3<f32>, headFlag: f32) -> f32 {
  let front = smoothstep(0.10, 0.42, q.z) * headFlag;
  let dl = length((q.xy - vec2<f32>(-0.36, 0.22)) / vec2<f32>(0.30, 0.28));
  let dr = length((q.xy - vec2<f32>( 0.36, 0.22)) / vec2<f32>(0.30, 0.28));
  let ringL = smoothstep(0.55, 0.80, dl) * (1.0 - smoothstep(1.02, 1.38, dl));
  let ringR = smoothstep(0.55, 0.80, dr) * (1.0 - smoothstep(1.02, 1.38, dr));
  let around = max(ringL, ringR) * front;
  let n1 = boneNoise(q * 26.0 + vec3<f32>(5.3, 13.1, 8.7));
  let n2 = boneNoise(q * 58.0 + vec3<f32>(21.7, 4.9, 16.3));
  let ridge = max(pow(1.0 - abs(n1 * 2.0 - 1.0), 5.0), pow(1.0 - abs(n2 * 2.0 - 1.0), 8.0) * 0.7);
  let veinPatch = smoothstep(0.40, 0.62, boneNoise(q * 8.0 + vec3<f32>(9.4, 3.6, 27.2)));
  return ridge * veinPatch * around;
}`;

/** Mesh-only material terms. World position remains reserved for crater
 * exposure; local position drives all random variation so stains follow the
 * posed segment. feature.xyz is the normalized local frame above, feature.w
 * is 1 for the rigid head source and 0 for every other segment. */
export const MESH_BONE_SURFACE_WGSL = /* wgsl */ `fn meshBoneSurface(pWorld: vec3<f32>, pLocal: vec3<f32>, feature: vec4<f32>, boneColor: vec3<f32>, deepColor: vec3<f32>, look: vec4<f32>, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32> {
  let headFlag = min(feature.w, 1.0);
  let soldierHead = step(1.5, feature.w);
  var expo = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    if (f32(i) >= woundCount) { break; }
    let w = textureLoad(woundTex, vec2<i32>(i, 0), 0);
    let dist = length(pWorld - w.xyz);
    expo = max(expo, clamp(1.0 - dist / max(w.w * 1.15, 1e-3), 0.0, 1.0));
  }
  expo = smoothstep(0.0, 1.0, expo);

  // DISCONTINUOUS TISSUE: independent local-space fields thresholded into
  // distinct painted zones instead of one continuous burgundy->pink ramp.
  let blotch = boneNoise(pLocal * 20.0 + vec3<f32>(4.2, 17.7, 2.9));
  let warp = boneNoise(pLocal * 6.0 + vec3<f32>(11.5, 1.7, 23.3));
  let weave = boneNoise(pLocal * 44.0 + vec3<f32>(7.1, 3.3, 9.7));
  let grain = boneNoise(pLocal * 110.0 + vec3<f32>(2.0, 5.0, 1.0));
  let patchT = blotch * 0.72 + warp * 0.28;
  let blood = smoothstep(0.50, 0.60, patchT);
  let connect = smoothstep(0.34, 0.48, weave * 0.68 + warp * 0.32) * (1.0 - blood * 0.85);
  let ivory = smoothstep(0.53, 0.65, blotch * 0.5 + grain * 0.5)
    * (1.0 - blood * 0.85) * (1.0 - headFlag) + headFlag * (0.72 + 0.28 * grain) * (1.0 - blood * 0.85);
  let bloodCol = mix(vec3<f32>(0.055, 0.004, 0.008), deepColor * 0.55, 0.35);
  let connectCol = vec3<f32>(0.62, 0.19, 0.19);
  let ivoryCol = boneColor * vec3<f32>(0.86, 0.74, 0.62);
  var albedo = mix(vec3<f32>(0.30, 0.085, 0.075), boneColor * vec3<f32>(0.92, 0.86, 0.66), headFlag);
  albedo = mix(albedo, connectCol, connect * (1.0 - headFlag * 0.70));
  albedo = mix(albedo, bloodCol, blood);
  albedo = mix(albedo, ivoryCol, ivory * 0.8);

  // LOCALIZED skull cavity: a dark blood recess, not a lit convex patch.
  // The mesh sculpt provides real recesses; dark albedo and restrained gloss
  // reinforce those anatomical cavities.
  let cav = meshSkullCavity(feature.xyz, headFlag);
  let steelFront = smoothstep(0.08, 0.42, feature.z);
  let steelTemple = 1.0 - smoothstep(0.72, 1.0, length(vec2((feature.x + 0.48) / 0.30, (feature.y - 0.08) / 0.42)));
  let steelBrow = 1.0 - smoothstep(0.72, 1.0, length(vec2((feature.x + 0.24) / 0.42, (feature.y - 0.30) / 0.16)));
  let steel = max(steelTemple, steelBrow) * steelFront * soldierHead * (1.0 - cav);
  albedo = mix(albedo, vec3<f32>(0.13, 0.16, 0.17), steel * 0.82);
  albedo = mix(albedo, deepColor * 0.055, cav * 0.92);

  // IRREGULAR BRANCHING VESSELS around each seated eye: red tissue markings
  // in the socket ring, painted over the dark recess. Eye-local, front-only.
  let veins = meshSocketVessels(feature.xyz, headFlag);
  albedo = mix(albedo, vec3<f32>(0.46, 0.020, 0.030), veins * 0.8);

  // TWO tooth rows, front-only via the cavity gate. Upper crowns hang below
  // the bite line, lower crowns rise above it, with the dark mouth cavity
  // showing through the gap so both rows read.
  let toothUp = meshToothRow(feature.xyz, 1.0);
  let toothDn = meshToothRow(feature.xyz, 0.0);
  let teeth = max(toothUp, toothDn) * cav;
  let toothBase = boneColor * vec3<f32>(0.82, 0.70, 0.56);
  let toothStain = boneNoise(feature.xyz * 60.0) * 0.5;
  albedo = mix(albedo, mix(toothBase, vec3<f32>(0.30, 0.20, 0.10), toothStain), teeth * 0.85);

  // Wound exposure STAIN the attachment dark; it must not wash the crater
  // toward bright pink (that was the mesh-vs-volume brightness gap).
  let stainW = smoothstep(0.18, 0.85, expo) * (0.55 + 0.45 * grain);
  let stainStrength = mix(mix(0.55, 0.22, headFlag), 0.55, soldierHead);
  albedo = mix(albedo, mix(deepColor * 0.45, vec3<f32>(0.28, 0.012, 0.02), grain), stainW * stainStrength);
  return vec4<f32>(albedo, expo);
}`;

/** Mesh-only gloss multiplier: wetness in patches, no polish in cavities. */
export const MESH_BONE_WET_WGSL = /* wgsl */ `fn meshBoneWet(pLocal: vec3<f32>, feature: vec4<f32>, expo: f32) -> f32 {
  // Wetness is an INDEPENDENT field: it moves gloss without moving colour.
  let w1 = boneNoise(pLocal * 26.0 + vec3<f32>(3.7, 11.2, 5.9));
  let w2 = boneNoise(pLocal * 70.0 + vec3<f32>(19.3, 2.1, 27.4));
  let wet = mix(smoothstep(0.30, 0.68, w1 * 0.62 + w2 * 0.38), 0.9, clamp(expo, 0.0, 1.0) * 0.45);
  var gloss = mix(0.05, 1.0, wet);
  let headFlag = min(feature.w, 1.0);
  let cav = meshSkullCavity(feature.xyz, headFlag);
  gloss = gloss * (1.0 - 0.97 * cav);
  // Socket vessels stay wet inside the matte recess, but only where the
  // vessel field is present — the rest of the cavity remains highlight-free.
  gloss = max(gloss, meshSocketVessels(feature.xyz, headFlag) * 0.45);
  return gloss;
}`;
