// src/lab/sdf-zombie/webgpu/portal.wgsl.ts
//
// The Void's portal, embers and glow pool, hand-written WGSL (spec
// 2026-09-24-void-portal-design.md §5). Twin: void-portal.ts.

/** Hash, one fn per string (wgslFn takes one); passed as an include. */
export const PORTAL_H21 = /* wgsl */ `fn h21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }`;

/** Value noise over h21 (include PORTAL_H21 with it). */
export const PORTAL_VNOISE = /* wgsl */ `fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2<f32>(1.0, 0.0)), u.x), mix(h21(i + vec2<f32>(0.0, 1.0)), h21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}`;

/** rgb additive colour of a portal-quad fragment. cfg: x width, y height, z time. */
export const PORTAL_COLOR = /* wgsl */ `fn portalColor(wpos: vec3<f32>, eye: vec3<f32>, base: vec3<f32>, facing: vec3<f32>, right: vec3<f32>, cfg: vec3<f32>) -> vec3<f32> {
  let rel = wpos - base;
  let u = dot(rel, right) / (cfg.x * 0.5);
  let v = (rel.y - cfg.y * 0.5) / (cfg.y * 0.5);
  let ang = atan2(v, u);
  let t = cfg.z;
  let n1 = vnoise(vec2<f32>(ang * 3.0 + t * 1.3, t * 2.1));
  let n2 = vnoise(vec2<f32>(ang * 9.0 - t * 3.7, length(vec2<f32>(u, v)) * 6.0 - t * 4.0));
  let d = length(vec2<f32>(u, v)) - 1.0 - (n1 - 0.5) * 0.10 - (n2 - 0.5) * 0.06;
  // Rim: white-hot just inside the edge, red outward, broken into wisps.
  let core = exp(-abs(d) * 26.0);
  // The quad reaches d = 0.4 (PORTAL_PAD 1.4): the glow must be gone before it.
  let glow = exp(-max(d, 0.0) * 7.0) * step(-0.02, d) * (0.6 + 0.8 * n2) * (1.0 - smoothstep(0.18, 0.36, d));
  var c = vec3<f32>(1.0, 0.95, 0.9) * core * 1.6 + vec3<f32>(0.9, 0.06, 0.04) * glow * 1.4;
  if (d < 0.0) {
    // Haze: slow dark-red swirl.
    let r = length(vec2<f32>(u, v));
    let sw = vnoise(vec2<f32>(ang * 2.0 + r * 3.0 - t * 0.6, r * 4.0 + t * 0.4));
    var inside = vec3<f32>(0.22, 0.015, 0.02) * (0.5 + sw);
    // Tracks: the view ray carried to the ground plane behind the portal.
    let dir = wpos - eye;
    if (dir.y < -1e-6) {
      let s = (wpos.y - base.y) / -dir.y;
      let hit = wpos + dir * s;
      let hrel = hit - base;
      let depth = dot(hrel, -facing);
      let lateral = dot(hrel, right);
      if (depth > 0.0) {
        let railD = abs(abs(lateral) - 0.72);
        let rail = 1.0 - smoothstep(0.02, 0.04, railD);
        let phase = fract(depth / 0.6);
        let sleeper = select(0.0, 0.45, phase < 0.25 && abs(lateral) < 1.2);
        let fade = exp(-depth / 14.0) * (1.0 - smoothstep(30.0, 60.0, depth));
        inside = inside + vec3<f32>(0.85, 0.22, 0.18) * max(rail, sleeper) * fade;
      }
    }
    c = c + inside * smoothstep(0.0, -0.08, d);
  }
  return c;
}`;

/** World position of ember `i` at time t, wrapped into a `box` cube around the camera. */
export const EMBER_POS = /* wgsl */ `fn emberPos(i: f32, t: f32, cam: vec3<f32>, box: f32) -> vec3<f32> {
  let h = fract(sin(vec3<f32>(i * 12.9898, i * 78.233, i * 37.719)) * 43758.5453);
  let drift = vec3<f32>(sin(t * 0.13 + i) * 0.4, t * (0.05 + h.y * 0.08), cos(t * 0.11 + i * 1.7) * 0.4);
  let p = vec3<f32>(h.x * box, h.y * 6.0, h.z * box) + drift;
  let w = cam.xz + ((((p.xz - cam.xz + box * 0.5) % box) + box) % box) - box * 0.5;
  return vec3<f32>(w.x, fract(p.y / 6.0) * 6.0, w.y);
}`;

/** Glow pool: additive red at uv (0..1 square), radial falloff. */
export const GLOW_POOL = /* wgsl */ `fn glowPool(uv: vec2<f32>) -> vec3<f32> {
  let r = min(1.0, length(uv - vec2<f32>(0.5, 0.5)) * 2.0);
  return vec3<f32>(0.40, 0.02, 0.015) * (1.0 - r) * (1.0 - r) * (1.0 - r);
}`;
