/** Hand-written shading: real cavities/teeth come from geometry, not the old
 * painted face masks. Cotangent frame needs no tangent vertex stream. */
export const ANATOMICAL_SKULL_NORMAL_WGSL = /* wgsl */ `fn anatomicalSkullNormal(p: vec3<f32>, n: vec3<f32>, uv: vec2<f32>, texel: vec3<f32>, normalScale: vec2<f32>) -> vec3<f32> {
  let dp1 = dpdx(p); let dp2 = dpdy(p);
  let duv1 = dpdx(uv); let duv2 = dpdy(uv);
  let a = cross(dp2, n); let b = cross(n, dp1);
  let t = a * duv1.x + b * duv2.x;
  let bitangent = a * duv1.y + b * duv2.y;
  let inv = inverseSqrt(max(max(dot(t,t),dot(bitangent,bitangent)),1e-16));
  let m = (texel * 2.0 - 1.0) * vec3<f32>(normalScale, 1.0);
  return normalize(t * (m.x * inv) + bitangent * (m.y * inv) + n * m.z);
}`;
export const ANATOMICAL_SKULL_SURFACE_WGSL = /* wgsl */ `fn anatomicalSkullSurface(pWorld: vec3<f32>, pLocal: vec3<f32>, boneColor: vec3<f32>, deepColor: vec3<f32>, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32> {
  var expo = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    if (f32(i) >= woundCount) { break; }
    let w = textureLoad(woundTex, vec2<i32>(i,0),0);
    expo = max(expo,clamp(1.0-length(pWorld-w.xyz)/max(w.w*1.15,1e-3),0.0,1.0));
  }
  let grain = boneNoise(pLocal * 110.0 + vec3<f32>(2.0,5.0,1.0));
  var albedo = boneColor * vec3<f32>(0.86,0.77,0.63) * (0.86 + 0.14 * grain);
  let stain = smoothstep(0.18,0.85,expo) * (0.12 + 0.12 * grain);
  albedo = mix(albedo,deepColor * 0.45,stain);
  return vec4<f32>(albedo,expo);
}`;
