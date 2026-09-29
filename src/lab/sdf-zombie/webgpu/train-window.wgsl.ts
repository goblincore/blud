// src/lab/sdf-zombie/webgpu/train-window.wgsl.ts
//
// The view through a train window (carriage kit spec §5), hand-written WGSL: the sky
// (SKY_COLOR, passed as an include), far hills, the treeline, telegraph poles and fence
// posts, each a vertical plane beside the track that the view ray meets. Twin:
// train-window.ts. One fn per string (wgslFn takes one).

export const TRAIN_WINDOW = /* wgsl */ `fn trainWindow(wpos: vec3<f32>, eye: vec3<f32>, t: f32, cfg0: vec4<f32>, cfg1: vec4<f32>, cfg2: vec4<f32>,
  zenith: vec3<f32>, horizon: vec3<f32>, band: vec3<f32>, moonDir: vec3<f32>, moonColor: vec3<f32>, moonCfg: vec4<f32>) -> vec3<f32> {
  // cfg0: speed, poleDist, polePitch, poleHeight · cfg1: postDist, postPitch, postHeight, treeDist
  // cfg2: treeHeight, hillDist, hillHeight, unused. Rail head is y = 0 (the floor); scenery is dark.
  let d = normalize(wpos - eye);
  var c = skyColor(d, zenith, horizon, band, moonDir, moonColor, moonCfg, vec3<f32>(0.0), vec3<f32>(0.0), vec4<f32>(0.0));
  if (abs(d.x) < 1e-4) { return c * 0.5; }
  let side = sign(d.x);
  // Far to near, each layer painting over the last.
  let tHill = (side * cfg2.y - eye.x) / d.x;
  let hz = eye.z + d.z * tHill; let hy = eye.y + d.y * tHill;
  let hillH = cfg2.z * (0.55 + 0.25 * sin(hz * 0.004) + 0.12 * sin(hz * 0.004 * 2.7 + 1.3) + 0.08 * sin(hz * 0.004 * 6.1 + 4.1));
  if (hy < hillH) { c = vec3<f32>(0.018, 0.022, 0.03); }
  let tTree = (side * cfg1.w - eye.x) / d.x;
  let tz = eye.z + d.z * tTree + cfg0.x * t * 0.05; let ty = eye.y + d.y * tTree;
  let treeH = cfg2.x * (0.55 + 0.25 * sin(tz * 0.35) + 0.12 * sin(tz * 0.35 * 2.7 + 1.3) + 0.08 * sin(tz * 0.35 * 6.1 + 4.1));
  if (ty < treeH) { c = vec3<f32>(0.006, 0.008, 0.01); }
  if (d.y < 0.0) {
    // Ground plane below the rail head, darkening toward the train.
    c = mix(vec3<f32>(0.012, 0.014, 0.016), c, smoothstep(-0.02, 0.0, d.y));
  }
  let tPole = (side * cfg0.y - eye.x) / d.x;
  let pz = eye.z + d.z * tPole + cfg0.x * t; let py = eye.y + d.y * tPole;
  let pu = ((pz % cfg0.z) + cfg0.z) % cfg0.z;
  if (pu < 0.25 && py < cfg0.w && py > -1.0) { c = vec3<f32>(0.004, 0.004, 0.005); }
  let tPost = (side * cfg1.x - eye.x) / d.x;
  let fz = eye.z + d.z * tPost + cfg0.x * t; let fy = eye.y + d.y * tPost;
  let fu = ((fz % cfg1.y) + cfg1.y) % cfg1.y;
  if (fu < 0.12 && fy < cfg1.z && fy > -1.0) { c = vec3<f32>(0.004, 0.004, 0.005); }
  return c;
}`;

/** A 0..1 hash of a 2-vector (for the storm's clouds, bolts and rain). */
export const STORM_HASH = /* wgsl */ `fn stormHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}`;

/** Smooth value noise (include STORM_HASH). */
export const STORM_NOISE = /* wgsl */ `fn stormNoise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = stormHash(i); let b = stormHash(i + vec2<f32>(1.0, 0.0));
  let c = stormHash(i + vec2<f32>(0.0, 1.0)); let d = stormHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

/** The view through a train window in the storm (dynamic light spec §3, owner: "violent"):
 *  churning clouds lit from within by the flash, forked bolts close by on their side of the
 *  train, the same hills, treeline, poles and posts in silhouette, rain running on the glass.
 *  Include STORM_HASH and STORM_NOISE. `flash` is the bolt's envelope (storm.ts boltEnvelope);
 *  `bolt` is (side ±1 or 0, along-track z, seed, age). */
export const TRAIN_STORM = /* wgsl */ `fn trainStorm(wpos: vec3<f32>, eye: vec3<f32>, t: f32, time: f32, cfg0: vec4<f32>, cfg1: vec4<f32>,
  cfg2: vec4<f32>, flash: f32, bolt: vec4<f32>) -> vec3<f32> {
  let d = normalize(wpos - eye);
  if (abs(d.x) < 1e-4) { return vec3<f32>(0.0); }
  let side = sign(d.x);
  let near = select(0.35, 1.0, bolt.x == side);
  // Sky: near black, a little lighter at the horizon.
  var c = mix(vec3<f32>(0.03, 0.034, 0.045), vec3<f32>(0.012, 0.014, 0.02), smoothstep(0.0, 0.5, d.y));
  // Clouds on a plane 300 m out, drifting on the wind and scrolling with the train.
  let tc = (side * 300.0 - eye.x) / d.x;
  let cz = eye.z + d.z * tc + t * 0.3 + time * 4.0;
  let cy = eye.y + d.y * tc;
  let q = vec2<f32>(cz * 0.012, cy * 0.03 + time * 0.03);
  let n = stormNoise(q) * 0.65 + stormNoise(q * 2.7 + vec2<f32>(3.1, 1.7)) * 0.35;
  let dens = smoothstep(0.3, 0.75, n) * smoothstep(5.0, 40.0, cy);
  let lit = flash * near * exp(-abs(cz - t * 0.3 - time * 4.0 - bolt.y) / 90.0);
  let cloud = vec3<f32>(0.035, 0.038, 0.05) + lit * vec3<f32>(1.4, 1.55, 2.0) * (0.4 + n);
  c = mix(c, cloud, dens);
  // The whole sky washes with the flash, more on the bolt's side.
  c += flash * near * 0.35 * vec3<f32>(0.55, 0.62, 0.8) * smoothstep(-0.05, 0.1, d.y);
  // The bolt: a jagged channel 250 m out, 8 segments from the cloud base to the ground, one branch.
  if (bolt.x == side && flash > 0.0) {
    let tb = (side * 250.0 - eye.x) / d.x;
    let bz = eye.z + d.z * tb; let by = eye.y + d.y * tb;
    if (by > 0.0 && by < 140.0) {
      let s = by / 17.5; let i = floor(s); let f = fract(s);
      let o = mix(stormHash(vec2<f32>(i, bolt.z)), stormHash(vec2<f32>(i + 1.0, bolt.z)), f) * 24.0 - 12.0;
      let dist = abs(bz - (bolt.y + o));
      var core = 1.0 - smoothstep(0.0, 1.4, dist);
      var glow = exp(-dist / 12.0);
      if (by < 80.0 && by > 30.0) {
        let k = (80.0 - by) / 50.0;
        let ob = o + k * (18.0 + 10.0 * stormHash(vec2<f32>(bolt.z, 5.0))) + (stormHash(vec2<f32>(floor(by / 6.0), bolt.z + 9.0)) - 0.5) * 5.0;
        let db = abs(bz - (bolt.y + ob));
        core = max(core, (1.0 - smoothstep(0.0, 0.9, db)) * (1.0 - k));
        glow = max(glow, exp(-db / 8.0) * (1.0 - k));
      }
      c += flash * (core * vec3<f32>(2.2, 2.4, 3.0) + glow * 0.4 * vec3<f32>(0.5, 0.6, 1.0));
    }
  }
  // Silhouettes, far to near: black against the flash, barely there between flashes.
  let tHill = (side * cfg2.y - eye.x) / d.x;
  let hz = eye.z + d.z * tHill; let hy = eye.y + d.y * tHill;
  let hillH = cfg2.z * (0.55 + 0.25 * sin(hz * 0.004) + 0.12 * sin(hz * 0.004 * 2.7 + 1.3) + 0.08 * sin(hz * 0.004 * 6.1 + 4.1));
  if (hy < hillH) { c = vec3<f32>(0.01, 0.011, 0.014) + flash * near * vec3<f32>(0.02, 0.022, 0.03); }
  let tTree = (side * cfg1.w - eye.x) / d.x;
  let tz = eye.z + d.z * tTree + cfg0.x * t * 0.05; let ty = eye.y + d.y * tTree;
  let treeH = cfg2.x * (0.55 + 0.25 * sin(tz * 0.35) + 0.12 * sin(tz * 0.35 * 2.7 + 1.3) + 0.08 * sin(tz * 0.35 * 6.1 + 4.1));
  if (ty < treeH) { c = vec3<f32>(0.004, 0.005, 0.006); }
  if (d.y < 0.0) { c = mix(vec3<f32>(0.008, 0.009, 0.011), c, smoothstep(-0.02, 0.0, d.y)); }
  let tPole = (side * cfg0.y - eye.x) / d.x;
  let pz = eye.z + d.z * tPole + cfg0.x * t; let py = eye.y + d.y * tPole;
  let pu = ((pz % cfg0.z) + cfg0.z) % cfg0.z;
  if (pu < 0.25 && py < cfg0.w && py > -1.0) { c = vec3<f32>(0.002); }
  let tPost = (side * cfg1.x - eye.x) / d.x;
  let fz = eye.z + d.z * tPost + cfg0.x * t; let fy = eye.y + d.y * tPost;
  let fu = ((fz % cfg1.y) + cfg1.y) % cfg1.y;
  if (fu < 0.12 && fy < cfg1.z && fy > -1.0) { c = vec3<f32>(0.002); }
  // Rain on the glass: streaks in the pane's own space (along the car, up), running down.
  let col = floor(wpos.z * 45.0);
  let hc = stormHash(vec2<f32>(col, 7.0));
  let yy = wpos.y + time * (1.1 + hc) + hc * 13.0;
  let drop = fract(yy / 0.7);
  let streak = (1.0 - smoothstep(0.0, 0.12, drop)) * step(0.72, stormHash(vec2<f32>(col, floor(yy / 0.7))));
  c += streak * (0.03 + 0.45 * flash * near) * vec3<f32>(0.6, 0.66, 0.78);
  return c;
}`;
