import type { Vec3 } from '../../types';
import type { BoneFieldSource } from './contract';
import { boneNoise3 } from './mesh-appearance';

export interface MeshEyePlacement { center: Vec3; radius: number }

/** Locate the actual frontal bone surface, not the AABB front (which can
 * leave eyes floating off an ellipsoid). The sphere is recessed in its
 * socket; ordinary scene depth keeps it behind intact flesh. */
export function meshEyePlacements(source: Pick<BoneFieldSource, 'segment' | 'bounds' | 'distance'>): MeshEyePlacement[] {
  if (source.segment !== 'head') return [];
  const { min, max } = source.bounds;
  const at = (axis: number, q: number) => min[axis]! + (q + 1) * 0.5 * (max[axis]! - min[axis]!);
  const radius = Math.min((max[0] - min[0]) * 0.095, (max[1] - min[1]) * 0.075);
  const eyes: MeshEyePlacement[] = [];
  for (const x of [-0.36, 0.36]) {
    const cx = at(0, x), cy = at(1, 0.22);
    let outside = max[2] + radius;
    for (let step = 1; step <= 128; step++) {
      const z = max[2] + radius - step / 128 * (max[2] - min[2] + radius);
      if (source.distance([cx, cy, z]) <= 0) {
        let inside = z;
        for (let i = 0; i < 16; i++) {
          const mid = (outside + inside) * 0.5;
          if (source.distance([cx, cy, mid]) > 0) outside = mid;
          else inside = mid;
        }
        eyes.push({ center: [cx, cy, (outside + inside) * 0.5 - radius * 0.35], radius });
        break;
      }
      outside = z;
    }
  }
  return eyes;
}

// ---------------------------------------------------------------------------
// CPU mirrors of the eye shader. The WGSL below and these functions must stay
// in lockstep; the mirrors exist so the glow/vessel MAPPING (front-only
// emission, restrained strength, sclera/iris/pupil separation, irregular
// vessel coverage) is unit tested instead of only substring-matched.
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const noiseOffset = (p: Vec3, s: number, o: Vec3): number =>
  boneNoise3([p[0] * s + o[0], p[1] * s + o[1], p[2] * s + o[2]]);

/** Peak red emission on the pupil. Restrained on purpose: the eye has to read
 * in darkness without behaving like a scene light. */
export const MESH_EYE_GLOW_PUPIL = 0.38;
/** Emission on the iris ring (between pupil and sclera). */
export const MESH_EYE_GLOW_IRIS = 0.075;
/** Emission tint: red-dominant, only a trace of green/blue so it stays blood. */
export const MESH_EYE_GLOW_TINT: Vec3 = [0.95, 0.05, 0.07];

/** Irregular branching vessels across the sclera: thin ridged filaments from
 * two noise octaves, clustered by a low-frequency mask, front-only and kept
 * clear of the iris. Mirrors the vessel WGSL. */
export function meshEyeVessels(p: Vec3): number {
  const front = smoothstep(-0.05, 0.35, p[2]);
  const irisMask = smoothstep(0.30, 0.46, Math.hypot(p[0], p[1]));
  const n1 = noiseOffset(p, 9.0, [3.1, 7.7, 1.3]);
  const n2 = noiseOffset(p, 21.0, [11.9, 2.4, 5.5]);
  const ridge1 = Math.pow(1 - Math.abs(n1 * 2 - 1), 6);
  const ridge2 = Math.pow(1 - Math.abs(n2 * 2 - 1), 9) * 0.7;
  const branch = Math.max(ridge1, ridge2);
  const veinPatch = smoothstep(0.40, 0.62, noiseOffset(p, 4.0, [2.2, 9.1, 4.4]));
  return branch * veinPatch * front * irisMask;
}

/** Limbal volume shading: darker around the iris, opening up toward the
 * equator so the eyeball keeps a rounded, fleshy read. Mirrors the surface
 * WGSL's `vol` term. */
export function meshEyeVolume(radial: number): number {
  return 0.72 + 0.28 * smoothstep(0.20, 0.55, radial);
}

export interface EyeShading {
  /** Front-facing cap gate (iris/pupil live here). */
  front: number;
  iris: number;
  pupil: number;
  vessel: number;
  /** Lit albedo of the eyeball surface (fleshy, rose, volume-shaded). */
  albedo: Vec3;
  /** Light-independent red glow, zero outside the front iris/pupil. */
  emission: Vec3;
}

/** Unit-sphere local +z faces out of the socket. Mirrors the eye surface and
 * emission WGSL: fleshy rose sclera with limbal volume shading, dark red
 * branching vessels, a deep-red iris and a darker pupil that carries the
 * restrained emissive glow. */
export function meshEyeShading(p: Vec3): EyeShading {
  const radial = Math.hypot(p[0], p[1]);
  const front = smoothstep(0.55, 0.82, p[2]);
  const iris = (1 - smoothstep(0.39, 0.46, radial)) * front;
  const pupil = (1 - smoothstep(0.18, 0.25, radial)) * front;
  const vessel = meshEyeVessels(p);
  // Limbal shading: darker toward the equator so the eyeball keeps a rounded,
  // fleshy volume instead of reading as a flat disc.
  const vol = meshEyeVolume(radial);
  let r = 0.58 * vol, g = 0.21 * vol, b = 0.22 * vol;
  r = lerp(r, 0.30, vessel * 0.85);
  g = lerp(g, 0.02, vessel * 0.85);
  b = lerp(b, 0.03, vessel * 0.85);
  r = lerp(r, 0.14, iris); g = lerp(g, 0.010, iris); b = lerp(b, 0.020, iris);
  r = lerp(r, 0.035, pupil); g = lerp(g, 0.003, pupil); b = lerp(b, 0.005, pupil);
  const glow = pupil * MESH_EYE_GLOW_PUPIL + (iris - pupil) * MESH_EYE_GLOW_IRIS;
  const emission: Vec3 = [
    MESH_EYE_GLOW_TINT[0] * glow,
    MESH_EYE_GLOW_TINT[1] * glow,
    MESH_EYE_GLOW_TINT[2] * glow,
  ];
  return { front, iris, pupil, vessel, albedo: [r, g, b], emission };
}

// ---------------------------------------------------------------------------
// WGSL. The renderer compiles these with BONE_HASH_WGSL and BONE_NOISE_WGSL as
// includes, in this order: hash -> noise -> vessels -> surface -> emission.
// ---------------------------------------------------------------------------

/** Branching red vessels on the sclera. */
export const MESH_EYE_VESSEL_WGSL = /* wgsl */ `fn meshEyeVessels(p: vec3<f32>) -> f32 {
  let front = smoothstep(-0.05, 0.35, p.z);
  let irisMask = smoothstep(0.30, 0.46, length(p.xy));
  let n1 = boneNoise(p * 9.0 + vec3<f32>(3.1, 7.7, 1.3));
  let n2 = boneNoise(p * 21.0 + vec3<f32>(11.9, 2.4, 5.5));
  let ridge1 = pow(1.0 - abs(n1 * 2.0 - 1.0), 6.0);
  let ridge2 = pow(1.0 - abs(n2 * 2.0 - 1.0), 9.0) * 0.7;
  let branch = max(ridge1, ridge2);
  let veinPatch = smoothstep(0.40, 0.62, boneNoise(p * 4.0 + vec3<f32>(2.2, 9.1, 4.4)));
  return branch * veinPatch * front * irisMask;
}`;

/** Fleshy, volume-shaded eyeball: rose sclera, branching red vessels, deep
 * red iris and darker pupil. Returns vec4(albedo, exposure) for the shared
 * boneShade compose, so the eye keeps the wet specular/Fresnel highlight. */
export const MESH_EYE_SURFACE_WGSL = /* wgsl */ `fn meshEyeSurface(p: vec3<f32>) -> vec4<f32> {
  let radial = length(p.xy);
  let front = smoothstep(0.55, 0.82, p.z);
  let iris = (1.0 - smoothstep(0.39, 0.46, radial)) * front;
  let pupil = (1.0 - smoothstep(0.18, 0.25, radial)) * front;
  let vessel = meshEyeVessels(p);
  let vol = 0.72 + 0.28 * smoothstep(0.20, 0.55, radial);
  var color = vec3<f32>(0.58, 0.21, 0.22) * vol;
  color = mix(color, vec3<f32>(0.30, 0.02, 0.03), vessel * 0.85);
  color = mix(color, vec3<f32>(0.14, 0.010, 0.020), iris);
  color = mix(color, vec3<f32>(0.035, 0.003, 0.005), pupil);
  return vec4<f32>(color, 0.8);
}`;

/** Restrained, light-independent red glow on the iris/pupil only. Added to the
 * shaded eye colour in the eye material; it is not a scene light and never
 * touches the bone material. */
export const MESH_EYE_EMISSION_WGSL = /* wgsl */ `fn meshEyeEmission(p: vec3<f32>) -> vec3<f32> {
  let radial = length(p.xy);
  let front = smoothstep(0.55, 0.82, p.z);
  let iris = (1.0 - smoothstep(0.39, 0.46, radial)) * front;
  let pupil = (1.0 - smoothstep(0.18, 0.25, radial)) * front;
  let glow = pupil * 0.38 + (iris - pupil) * 0.075;
  return vec3<f32>(0.95, 0.05, 0.07) * glow;
}`;
