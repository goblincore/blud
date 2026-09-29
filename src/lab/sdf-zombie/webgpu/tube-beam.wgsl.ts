// src/lab/sdf-zombie/webgpu/tube-beam.wgsl.ts
//
// THE TUBE BEAM (owner, 2026-09-26: "harsh overhead light cone ... a volumetric god ray beam of
// light dust in the air"), hand-written WGSL: the glow of a fluorescent tube's cone of light in
// dusty air, drawn on an open cone mesh under the tube, additive. A stand-in for part 3's
// raymarched haze: bright near the tube and fading with the drop, soft at the cone's silhouette,
// broken up by slow drifting dust. `lit` is the lamp's level (0 = dark, so blackouts cut it).
// Include STORM_HASH and STORM_NOISE (train-window.wgsl.ts).

export const TUBE_BEAM_WGSL = /* wgsl */ `fn tubeBeam(local: vec3<f32>, wpos: vec3<f32>, n: vec3<f32>, eye: vec3<f32>, t: f32, cfg: vec4<f32>, color: vec3<f32>) -> vec3<f32> {
  // cfg: x lit (the lamp level), y the cone's height, z strength, w unused.
  if (cfg.x <= 0.0) { return vec3<f32>(0.0); }
  let drop = clamp(-local.y / max(cfg.y, 1e-3), 0.0, 1.0);
  let fall = pow(1.0 - drop, 1.6);
  let v = normalize(eye - wpos);
  let edge = pow(abs(dot(normalize(n), v)), 1.4);
  let q = wpos * 5.0 + vec3<f32>(t * 0.12, -t * 0.05, t * 0.21);
  let dust = stormNoise(q.xz + vec2<f32>(q.y * 0.7, 0.0)) * 0.6 + stormNoise(q.zy * 2.3) * 0.4;
  return color * (cfg.x * cfg.z * fall * edge * (0.15 + 1.4 * dust * dust));
}`;
