// src/lab/sdf-zombie/webgpu/post-flash-grade.wgsl.ts
//
// THE LIGHTNING GRADE (owner, 2026-09-26), hand-written WGSL, applied at the final blit. While a
// bolt strikes, the frame punches toward a cold white; through the strike and its afterglow the
// blacks are crushed a little (owner: "just ... blacks get crushed a little bit", after a full
// contrast stretch read far too harsh) and the colour cools slightly.
// g = (flash, grade, punch, crush): flash is the bolt's envelope, grade the same with a slow
// release, crush the black point at full grade (0.06 = the darkest 6% goes to black). Both 0
// returns c untouched.

export const FLASH_GRADE_WGSL = /* wgsl */ `fn flashGrade(c: vec3<f32>, g: vec4<f32>) -> vec3<f32> {
  if (g.x <= 0.0 && g.y <= 0.0) { return c; }
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let cold = vec3<f32>(luma) * vec3<f32>(0.85, 0.95, 1.1);
  var o = mix(c, cold, clamp(g.y * 0.35, 0.0, 1.0));
  let bp = g.y * g.w;
  o = max(o - vec3<f32>(bp), vec3<f32>(0.0)) / (1.0 - bp);
  o = o + vec3<f32>(0.75, 0.85, 1.0) * (g.x * g.z * (0.06 + luma));
  return clamp(o, vec3<f32>(0.0), vec3<f32>(1.0));
}`;
