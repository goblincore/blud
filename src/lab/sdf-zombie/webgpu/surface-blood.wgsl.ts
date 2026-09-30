// Original procedural splatter masks, shared by the shader entrypoints.
export const SBHASH_WGSL = /* wgsl */ `fn sbHash(x: f32) -> f32 { return fract(sin(x * 78.233 + 11.7) * 43758.5453); }`;

export const SBMASK_WGSL = /* wgsl */ `fn sbMask(p: vec2<f32>, seed: f32, smear: f32) -> f32 {
  let angle = atan2(p.y, p.x);
  let rim = 0.47 + 0.06 * sin(angle * 5.0 + seed * 30.0)
    + 0.05 * sin(angle * 9.0 - seed * 17.0) + 0.025 * sin(angle * 17.0);
  var coverage = 1.0 - smoothstep(rim - 0.015, rim + 0.015, length(p));
  // Seeded satellite droplets and narrow outward fingers.
  for (var i = 0; i < 12; i = i + 1) {
    let h = sbHash(seed * 117.0 + f32(i) * 3.7);
    let a = h * 6.283185;
    let r = 0.54 + sbHash(h * 101.0) * 0.31;
    let centre = vec2<f32>(cos(a), sin(a)) * r;
    let radius = 0.022 + sbHash(h * 91.0) * 0.047;
    coverage = max(coverage, 1.0 - smoothstep(radius * 0.75, radius, length(p - centre)));
    let along = dot(p, normalize(centre));
    let across = abs(dot(p, vec2<f32>(-sin(a), cos(a))));
    let finger = (1.0 - smoothstep(0.01, 0.035, across))
      * smoothstep(0.30, 0.4, along) * (1.0 - smoothstep(0.48, 0.60, along));
    coverage = max(coverage, finger * 0.9);
  }
  let streak = 0.7 + 0.3 * sin(p.y * 109.0 + seed * 20.0 + sin(p.x * 7.0));
  let smearBody = (1.0 - smoothstep(0.50, 0.85, abs(p.x)))
    * (1.0 - smoothstep(0.20 * streak, 0.29 * streak, abs(p.y + 0.025 * sin(p.x * 9.0))));
  return mix(coverage, max(smearBody, coverage * 0.35), smear);
}`;

export const SBSURFACE_WGSL = /* wgsl */ `fn sbSurface(p: vec2<f32>, data: vec4<f32>, clock: f32, drySeconds: f32) -> vec4<f32> {
  let smear = select(0.0, 1.0, data.z > 1.5);
  let mask = sbMask(p, data.x, smear);
  let wet = select(clamp(1.0 - (clock - data.y) / max(1.0, drySeconds), 0.0, 1.0), 0.0, data.z > 0.5 && data.z < 1.5);
  let thickness = clamp(1.0 - length(p * vec2<f32>(1.0, mix(1.0, 2.0, smear))) * 1.7, 0.0, 1.0);
  let dryBreak = 0.82 + 0.18 * sin(p.x * 145.0 + sin(p.y * 111.0 + data.x * 50.0));
  let colour = mix(vec3<f32>(0.13, 0.009, 0.013), vec3<f32>(0.32, 0.012, 0.023), wet);
  return vec4<f32>(colour * (0.7 + 0.3 * thickness), mask * mix(dryBreak, 1.0, wet));
}`;

export const SBROUGHNESS_WGSL = /* wgsl */ `fn sbRoughness(data: vec4<f32>, clock: f32, drySeconds: f32) -> f32 {
  let wet = select(clamp(1.0 - (clock - data.y) / max(1.0, drySeconds), 0.0, 1.0), 0.0, data.z > 0.5 && data.z < 1.5);
  return mix(0.88, 0.19, wet);
}`;

export const SBNORMAL_WGSL = /* wgsl */ `fn sbNormal(p: vec2<f32>, data: vec4<f32>, n: vec3<f32>, tangent: vec3<f32>) -> vec3<f32> {
  let smear = select(0.0, 1.0, data.z > 1.5);
  let dx = sbMask(p + vec2<f32>(0.008, 0.0), data.x, smear) - sbMask(p - vec2<f32>(0.008, 0.0), data.x, smear);
  let dy = sbMask(p + vec2<f32>(0.0, 0.008), data.x, smear) - sbMask(p - vec2<f32>(0.0, 0.008), data.x, smear);
  let v = normalize(cross(n, tangent));
  let relief = select(1.0, 0.15, data.z > 0.5 && data.z < 1.5);
  let waveX = sin(p.x * 13.0 + sin(p.y * 8.0) + data.x * 20.0) * 0.055;
  let waveY = sin(p.y * 11.0 + sin(p.x * 9.0) - data.x * 17.0) * 0.055;
  return normalize(n - tangent * (dx * 0.24 + waveX) * relief - v * (dy * 0.24 + waveY) * relief);
}`;

// Blood keeps a red body under the same strong carried lamp as the room.
// A shoulder preserves highlight detail rather than clipping the wet surface
// into pink/white. Shape, roughness and lighting still drive its live sheen.
export const SBFINISH_WGSL = /* wgsl */ `fn sbFinish(lit: vec4<f32>) -> vec4<f32> {
  let peak = max(lit.r, max(lit.g, lit.b));
  return vec4<f32>(lit.rgb * vec3<f32>(0.7, 0.45, 0.5) / (1.0 + peak * 0.95), lit.a);
}`;
