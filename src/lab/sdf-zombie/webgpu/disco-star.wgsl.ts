// src/lab/sdf-zombie/webgpu/disco-star.wgsl.ts
//
// A disco ball's reflected star (spec 2026-09-27-disco-ball-design.md §2), hand-written WGSL: a soft
// round spot with a hot core, drawn additive on a quad flush with the wall. `fade` is the star's own
// strength (distance and grazing, disco-stars.ts discoFade); `color` is the light on the ball
// (rgb · intensity). One fn per string (wgslFn takes one).

export const DISCO_STAR_WGSL = /* wgsl */ `fn discoStar(uv: vec2<f32>, fade: f32, color: vec3<f32>) -> vec3<f32> {
  let r = length(uv - vec2<f32>(0.5)) * 2.0;
  if (r >= 1.0 || fade <= 0.0) { return vec3<f32>(0.0); }
  let disc = 1.0 - smoothstep(0.45, 1.0, r);
  let core = 1.0 - smoothstep(0.0, 0.4, r);
  return color * fade * (disc * 0.55 + core * core * 0.9);
}`;
