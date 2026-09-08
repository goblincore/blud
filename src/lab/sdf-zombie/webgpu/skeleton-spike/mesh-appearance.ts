import type { Vec3 } from '../../types';

export interface LocalBounds { min: Vec3; max: Vec3 }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
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

/** CPU mirror of the shader's broad, front-only skull markings. These are
 * material cues rather than geometry cuts; keeping the math here makes their
 * scale, symmetry and back-face exclusion testable without a GPU. */
export function skullFeatureMasks(p: Vec3): { sockets: number; nose: number; mouth: number; teeth: number; seams: number } {
  const [x, y, z] = p;
  const front = smoothstep(0.18, 0.58, z);
  const sockets = Math.max(
    ellipse(x, y, -0.36, 0.22, 0.27, 0.25),
    ellipse(x, y, 0.36, 0.22, 0.27, 0.25),
  ) * front;
  const nose = ellipse(x, y, 0, -0.08, 0.15, 0.25)
    * smoothstep(-0.34, -0.02, y) * front;
  const mouth = ellipse(x, y, 0, -0.53, 0.50, 0.17) * front;
  const toothBand = smoothstep(-0.67, -0.58, y) * (1 - smoothstep(-0.45, -0.37, y));
  const seams = mouth * toothBand * smoothstep(0.68, 0.94, Math.abs(Math.cos(x * 28)));
  const teeth = mouth * toothBand * (1 - seams * 0.65);
  return { sockets, nose, mouth, teeth, seams };
}

/** Mesh-only material terms. World position remains reserved for crater
 * exposure; local position drives all random variation so stains follow the
 * posed segment. feature.xyz is the normalized local frame above, feature.w
 * is 1 for the rigid head source and 0 for every other segment. */
export const MESH_BONE_SURFACE_WGSL = /* wgsl */ `fn meshBoneSurface(pWorld: vec3<f32>, pLocal: vec3<f32>, feature: vec4<f32>, boneColor: vec3<f32>, deepColor: vec3<f32>, look: vec4<f32>, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32> {
  var expo = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    if (f32(i) >= woundCount) { break; }
    let w = textureLoad(woundTex, vec2<i32>(i, 0), 0);
    let dist = length(pWorld - w.xyz);
    expo = max(expo, clamp(1.0 - dist / max(w.w * 1.15, 1e-3), 0.0, 1.0));
  }
  expo = smoothstep(0.0, 1.0, expo);

  // Continuous burgundy membrane with rose attachment bands. The broad
  // tissue gradient dominates; small ivory windows reveal underlying bone.
  let broad = boneNoise(pLocal * 24.0 + vec3<f32>(7.1, 3.3, 9.7));
  let fibers = boneNoise(pLocal * vec3<f32>(105.0, 28.0, 105.0));
  let tissue = smoothstep(0.28, 0.75, broad * 0.72 + fibers * 0.28);
  let burgundy = mix(vec3<f32>(0.15, 0.009, 0.021), deepColor, 0.3);
  let pink = vec3<f32>(0.58, 0.16, 0.20);
  var albedo = mix(burgundy, pink, tissue * 0.82);
  let ivory = smoothstep(0.78, 0.94, broad) * (1.0 - feature.w * 0.8);
  albedo = mix(albedo, boneColor * vec3<f32>(0.88, 0.75, 0.64), ivory * 0.65);
  // Fresh crater exposure brightens the red attachment tissue, never strips
  // the whole surface back to chalk-white bone.
  albedo = mix(albedo, pink, expo * 0.18);

  // Broad frontal skull read. +z is the face direction in zombie.blob's
  // explicit head-local rig frame. These marks never wrap around the back.
  let q = feature.xyz;
  let front = smoothstep(0.18, 0.58, q.z) * feature.w;
  let eyeL = 1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(-0.36, 0.22)) / vec2<f32>(0.27, 0.25)));
  let eyeR = 1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>( 0.36, 0.22)) / vec2<f32>(0.27, 0.25)));
  let sockets = max(eyeL, eyeR) * front;
  let nose = (1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(0.0, -0.08)) / vec2<f32>(0.15, 0.25))))
    * smoothstep(-0.34, -0.02, q.y) * front;
  let mouth = (1.0 - smoothstep(0.72, 1.0, length((q.xy - vec2<f32>(0.0, -0.53)) / vec2<f32>(0.50, 0.17)))) * front;
  let toothBand = smoothstep(-0.67, -0.58, q.y) * (1.0 - smoothstep(-0.45, -0.37, q.y));
  let seams = mouth * toothBand * smoothstep(0.68, 0.94, abs(cos(q.x * 28.0)));
  let teeth = mouth * toothBand * (1.0 - seams * 0.65);
  let cavity = max(max(sockets, nose), mouth);
  albedo = mix(albedo, deepColor * 0.18, cavity);
  albedo = mix(albedo, boneColor * vec3<f32>(0.76, 0.59, 0.47), teeth * 0.72);
  albedo = mix(albedo, deepColor * 0.12, seams);
  return vec4<f32>(albedo, expo);
}`;
