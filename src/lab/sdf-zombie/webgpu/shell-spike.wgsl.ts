// src/lab/sdf-zombie/webgpu/shell-spike.wgsl.ts
//
// The shell-march entry for the hull+shell spike. Runs per pixel on a
// BackSide proxy box (the same medium the full march uses), reads the hull's
// entry (front-face) and exit (back-face) depths per pixel, and sphere-traces
// the REAL zombie field — via the imported HELPERS chain from march.wgsl.ts,
// so the field definition is shared, not forked — only within [entry, exit].
//
// The whole question this answers: a hull inflated to iso +0.03 puts the
// entry ~3 cm outside the surface, so a bounded march needs a handful of
// steps instead of 60-100. The surface found is the SAME sdBody = 0 the full
// march hits, and the normal is calcNormal on that same field, so the blends
// (smin) and gradient-shading normals are preserved exactly.

// Returns are mode-switched by `outMode`:
//   outMode < 0.5  visual  -> vec4(color, hitDist)   (miss/discard)
//   outMode > 0.5  steps   -> vec4(steps, 0, 0, marker)  marker 1 = hit on hull
//
// `bounded` in marchCfg.z: 1 = trace only [entry, exit]; 0 = full march from
// the camera (the baseline, to measure the step-count win honestly).
export const SHELL_TRACE = /* wgsl */ `fn shellTrace(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  entryTex: texture_2d<f32>,
  exitTex: texture_2d<f32>,
  screenUV: vec2<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  counts: vec4<f32>,
  marchCfg: vec4<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  surfCfg: vec2<f32>,
  outMode: f32
) -> vec4<f32> {
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);

  // Determine the trace interval.
  var t0 = 0.0;
  var t1 = tMax;
  if (marchCfg.z > 0.5) {
    // Bounded shell: read the hull entry/exit depths for this pixel.
    let dims = vec2<f32>(textureDimensions(entryTex, 0));
    let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
    let e = textureLoad(entryTex, c, 0).x;
    let xit = textureLoad(exitTex, c, 0).x;
    if (e <= 0.0) {
      // No hull here. In steps mode record 0 steps; in visual mode let the
      // background (floor) show through.
      if (outMode > 0.5) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
      discard;
    }
    t0 = e;
    // If the exit is missing or behind the entry (thin/silhouette region),
    // give the trace a fixed shell-width fallback so it still finds the surface.
    t1 = select(e + surfCfg.x, xit, xit > e + 1e-4);
    t1 = min(t1, tMax);
  }

  var t = t0;
  var steps = 0.0;
  var hit = 0.0;
  let maxSteps = marchCfg.x;
  let stepMul = marchCfg.y;
  for (var i = 0; i < 128; i = i + 1) {
    if (f32(i) >= maxSteps) { break; }
    let p = camPos + rd * t;
    let d = mapBody(p, data, counts, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, vec4<f32>(0.0)).x;
    if (d < 0.0015) {
      hit = 1.0;
      if (outMode > 0.5) { return vec4<f32>(steps, steps / 16.0, 0.0, 1.0); }
      let n = calcNormal(p, data, counts, surfCfg.y, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, vec4<f32>(0.0));
      let ndl = max(dot(n, lightDir), 0.0);
      let key = ndl * lightCfg.x;
      let fill = lightCfg.y * max(dot(n, -rd), 0.0);
      let dif = (key + fill) * keyColor;
      var col = baseColor * dif;
      // Woodcutting carve: darken surfaces that face almost entirely away.
      let facing = clamp(dot(n, -rd), 0.0, 1.0);
      col = mix(col, deepColor, (1.0 - facing) * 0.45);
      // Slight rim so the silhouette pops against the ground plane.
      let rim = pow(1.0 - facing, 2.5) * 0.5;
      col = col + vec3<f32>(rim * 0.8, rim * 0.7, rim * 0.6);
      return vec4<f32>(col, t);
    }
    t = t + max(d * stepMul, 0.0005);
    steps += 1.0;
    if (t > t1) { break; }
    if (t > tMax) { break; }
  }
  // No surface found within the interval (a genuine gap in the field inside the
  // shell, or the budget ran out on a grazing ray).
  if (outMode > 0.5) { return vec4<f32>(steps, steps / 16.0, 0.0, hit); }
  discard;
  // Unreachable, but WGSL requires a return at the end of a non-void function.
  return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}`;
