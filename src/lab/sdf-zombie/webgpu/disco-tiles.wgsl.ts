// src/lab/sdf-zombie/webgpu/disco-tiles.wgsl.ts
//
// The disco ball's mirror tiles (spec 2026-09-27-disco-ball-design.md §1), hand-written WGSL. Small
// square facets in the ball's OWN spherical coordinates (so they turn with the spin): rows of equal
// height, each row cut into as many columns as keep the tiles square. Each tile has a seeded tilt,
// so a few flare as they turn toward the camera (the glint), and a seeded share of the room it
// reflects. The gaps stay dark. Everything the ball reflects is tinted by `tint`, the light on the
// ball (rgb · intensity: party white, the strobe, beacon red); a small floor keeps it from reading
// black in the dark.

export const DISCO_TILES_WGSL = /* wgsl */ `fn discoTiles(local: vec3<f32>, centre: vec3<f32>, n: vec3<f32>, wpos: vec3<f32>, eye: vec3<f32>, tint: vec3<f32>, cfg: vec4<f32>) -> vec3<f32> {
  // cfg: x rows pole to pole, y glint strength, z the floor (the dim room it reflects), w seed.
  let p = normalize(local - centre);
  let rows = cfg.x;
  let phi = acos(clamp(p.y, -1.0, 1.0));
  let fr = phi / 3.14159265 * rows;
  let row = floor(fr);
  let rowPhi = (row + 0.5) / rows * 3.14159265;
  let cols = max(4.0, floor(2.0 * rows * sin(rowPhi) + 0.5));
  let fc = (atan2(p.z, p.x) / 6.2831853 + 0.5) * cols;
  let col = floor(fc);
  let cell = vec2<f32>(fract(fc), fract(fr));
  let edge = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
  let tile = smoothstep(0.03, 0.1, edge);
  let id = row * 131.0 + col + cfg.w;
  let h = fract(sin(vec4<f32>(id * 12.9898, id * 78.233, id * 37.719, id * 4.581)) * 43758.5453);
  // The glint: each facet tilted a little its own way; it flares when that faces the eye.
  let v = normalize(eye - wpos);
  let fnrm = normalize(normalize(n) + (h.xyz - vec3<f32>(0.5)) * 0.5);
  let glint = pow(max(dot(fnrm, v), 0.0), 60.0) * (0.3 + 1.7 * h.w);
  // The room in each facet: patchy, some tiles catching the lit room, most the dark.
  let room = vec3<f32>(cfg.z * (0.5 + h.y)) + tint * (0.12 + 0.55 * h.x * h.x);
  let lit = room + tint * glint * cfg.y;
  return mix(vec3<f32>(0.006), lit, tile);
}`;
