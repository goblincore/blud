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
/** `hollow` is the atlas's alpha (1 open bone, 0 deep in a socket; an atlas with no alpha reads 1) and `grime` the
 * asset's (skull-cast.ts SkullAsset.grime): at 0 the plain bone below is all there is. */
export const ANATOMICAL_SKULL_SURFACE_WGSL = /* wgsl */ `fn anatomicalSkullSurface(pWorld: vec3<f32>, pLocal: vec3<f32>, boneColor: vec3<f32>, deepColor: vec3<f32>, woundTex: texture_2d<f32>, woundCount: f32, hollow: f32, grime: f32) -> vec4<f32> {
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
  // A DIRTY SKULL (grime 1): a grubby wash over all of it, a dried-blood film in the hollows going black in the
  // sockets, and torn flesh clinging in islands, more of them in the hollows and near a wound.
  let deep = (1.0 - hollow) * grime;
  let film = smoothstep(0.03, 0.30, deep);
  let mottle = boneNoise(pLocal * 9.0 + vec3<f32>(4.1,7.7,1.9));
  albedo = mix(albedo, albedo * vec3<f32>(0.62,0.50,0.40), (0.45 + 0.45 * mottle) * grime);
  albedo = mix(albedo, deepColor * 0.22 + vec3<f32>(0.035,0.012,0.008), film * 0.85);
  // Small islands (at 22 a single patch could cover the whole muzzle and read as a pink nose), mostly at the hollows' edges.
  let n = boneNoise(pLocal * 38.0 + vec3<f32>(8.3,2.9,14.1)) * 0.62 + boneNoise(pLocal * 90.0 + vec3<f32>(3.3,19.7,6.1)) * 0.38;
  let t = 0.70 - 0.24 * film - 0.12 * expo;
  let cling = smoothstep(t, t + 0.04, n) * grime;
  albedo = mix(albedo, mix(vec3<f32>(0.10,0.008,0.006), deepColor * 0.30, grain), cling * 0.92);
  // Last, so nothing paints over it: the sockets, the nasal pit and the sutures go black.
  albedo = albedo * (1.0 - 0.95 * smoothstep(0.10, 0.45, deep));
  return vec4<f32>(albedo,expo);
}`;
