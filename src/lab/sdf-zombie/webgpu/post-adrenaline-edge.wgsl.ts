// src/lab/sdf-zombie/webgpu/post-adrenaline-edge.wgsl.ts
//
// THE ADRENALINE EDGE (owner 2026-10-27: "there needs to be a visual indicator of this state — maybe distortion
// around the border/edges of the screen"), hand-written WGSL, applied inside the final blit (post-aa.ts
// postAaBlit) so it can re-sample the frame: a radial warp with a slow ripple, a chromatic split, and a warm
// darkening / desaturation — all on an EDGE MASK that is exactly 0 over the middle of the screen, so the
// crosshair and whatever it sits on stay clean.
//
// a = (amount, time, ripple, 0): amount is adrenaline.ts adrenalineEdgeAt (edgeFx x the eased rush level); time is
// seconds for the ripple's drift; ripple is 1, or 0 under ?flashes=reduced (the warp stays, static, no motion).
// amount 0 returns everything untouched — the blit's all-off path is the shipped one.

/** Edge mask: 0 inside this fraction of the centre-to-corner distance, rising to 1 at the corners. */
export const ADRENALINE_EDGE_INNER = 0.38;

export const ADRENALINE_EDGE_WGSL = /* wgsl */ `
fn adrEdgeMask(uv: vec2<f32>, aspect: f32) -> f32 {
  let p = (uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);
  let r = length(p) / (0.5 * length(vec2<f32>(aspect, 1.0)));
  return smoothstep(${ADRENALINE_EDGE_INNER.toFixed(3)}, 1.0, r);
}

// The warp, as an inverse lookup: the border samples a little INWARD, so the image at the edges swells outward and
// breathes with a slow radial ripple. Bounded: at most ~3.2% of the screen at amount 1, in the corners.
fn adrenalineEdgeWarp(uv: vec2<f32>, a: vec4<f32>, aspect: f32) -> vec2<f32> {
  if (a.x <= 0.0) { return uv; }
  let m = adrEdgeMask(uv, aspect);
  if (m <= 0.0) { return uv; }
  let d = uv - vec2<f32>(0.5, 0.5);
  let l = max(length(d), 1e-4);
  let ripple = sin(l * 38.0 - a.y * 2.2) * a.z;
  return uv - (d / l) * (a.x * m * m * (0.022 + 0.01 * ripple));
}

// The chromatic split: red and blue sampled this far apart along the radius (+ for red, - for blue).
fn adrenalineEdgeChroma(uv: vec2<f32>, a: vec4<f32>, aspect: f32) -> vec2<f32> {
  if (a.x <= 0.0) { return vec2<f32>(0.0, 0.0); }
  let m = adrEdgeMask(uv, aspect);
  return (uv - vec2<f32>(0.5, 0.5)) * (a.x * m * 0.024);
}

// The grade: toward a warm, desaturated, darker border (display space, after the fetch).
fn adrenalineEdgeGrade(c: vec3<f32>, uv: vec2<f32>, a: vec4<f32>, aspect: f32) -> vec3<f32> {
  if (a.x <= 0.0) { return c; }
  let m = adrEdgeMask(uv, aspect);
  if (m <= 0.0) { return c; }
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let warm = vec3<f32>(luma) * vec3<f32>(1.15, 0.82, 0.76);
  let g = mix(c, warm, clamp(a.x * m * 1.1, 0.0, 1.0));
  return g * (1.0 - clamp(1.1 * a.x * m, 0.0, 0.92));
}
`;
