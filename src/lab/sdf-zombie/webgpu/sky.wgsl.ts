// src/lab/sdf-zombie/webgpu/sky.wgsl.ts
//
// The sky dome's colour, hand-written WGSL (Outdoor v1 §6). One function per string
// (wgslFn takes one). Twin: sky-color.ts. Stars and a low cloud band are here only.

export const SKY_COLOR = /* wgsl */ `fn skyColor(
  dir: vec3<f32>, zenith: vec3<f32>, horizon: vec3<f32>, band: vec3<f32>,
  moonDir: vec3<f32>, moonColor: vec3<f32>, moonCfg: vec4<f32>,
  cloudColor: vec3<f32>, cloudUnder: vec3<f32>, cloudCfg: vec4<f32>
) -> vec3<f32> {
  // moonCfg: x cos(disc), y cos(disc*0.85), z intensity, w halo exponent
  // cloudCfg: x cover, y stars density, z time (0 in v1), w unused
  let y = dir.y;
  if (y < 0.0) { return horizon * 0.5; }
  let t = pow(clamp(y, 0.0, 1.0), 0.45);
  var c = mix(horizon, zenith, t) + band * (exp(-y * 8.0) * 0.6);
  let cosA = dot(dir, moonDir);
  let disc = smoothstep(moonCfg.x, moonCfg.y, cosA);
  let halo = pow(max(cosA, 0.0), moonCfg.w) * 0.35;
  c = c + moonColor * (disc * moonCfg.z + halo);
  let cell = floor(dir * 300.0);
  let h = fract(sin(dot(cell, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
  let star = step(1.0 - cloudCfg.y * 0.004, h) * smoothstep(0.05, 0.35, y);
  c = c + vec3<f32>(0.8, 0.85, 1.0) * star * 0.6;
  let p = dir.xz / max(y, 0.05) * 0.6;
  let n = 0.5 + 0.25 * sin(p.x * 1.7 + sin(p.y * 1.3)) + 0.25 * sin(p.y * 2.1 + sin(p.x * 0.9));
  let bandMask = smoothstep(0.02, 0.10, y) * (1.0 - smoothstep(0.10, 0.30, y));
  let cloud = clamp((n - (1.0 - cloudCfg.x)) * 3.0, 0.0, 1.0) * bandMask;
  let cloudCol = mix(cloudUnder, cloudColor, clamp(y * 4.0, 0.0, 1.0));
  return mix(c, cloudCol, cloud);
}`;
