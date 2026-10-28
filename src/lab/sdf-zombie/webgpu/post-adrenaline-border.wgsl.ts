// src/lab/sdf-zombie/webgpu/post-adrenaline-border.wgsl.ts
//
// THE LOW-HEALTH RED BORDER (owner 2026-10-27: "once you're below a certain health and the time scale is affecting
// you, there should be a red border around the edges of the screen that fades inward"), hand-written WGSL, layered
// in the final blit's node chain (post-aa.ts) right after the adrenaline edge distortion, before the lightning grade.
//
// b = (strength, width, aspect, 0): strength and width are adrenaline.ts adrenalineBorderAt (the pulse is already in
// strength); width is a fraction of the screen HEIGHT measured in from the NEAREST edge (so the band is even on all
// four sides); aspect is width / height. strength 0 returns the colour untouched.

/** The border's red (display space): a deep blood red, not an alarm red. */
export const ADRENALINE_BORDER_RED = [0.62, 0.02, 0.02] as const;

export const ADRENALINE_BORDER_WGSL = /* wgsl */ `fn adrenalineBorder(c: vec3<f32>, uv: vec2<f32>, b: vec4<f32>) -> vec3<f32> {
  if (b.x <= 0.0 || b.y <= 0.0) { return c; }
  let dx = min(uv.x, 1.0 - uv.x) * b.z;
  let dy = min(uv.y, 1.0 - uv.y);
  // Fade inward from the nearest edge: full at the edge, 0 at the width in (quadratic, so the inner edge is soft).
  let t = 1.0 - smoothstep(0.0, b.y, min(dx, dy));
  let a = clamp(b.x * t * t * t, 0.0, 0.9);
  // Not a flat paint: the scene stays readable through it, pushed toward a blood-red multiply plus a little red
  // light, so the walls under the border still show their shape.
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let red = vec3<f32>(${ADRENALINE_BORDER_RED.map(v => v.toFixed(3)).join(', ')});
  let stained = c * vec3<f32>(1.0, 0.18, 0.14) + red * (0.35 + 0.5 * luma);
  return mix(c, stained, a);
}
`;
