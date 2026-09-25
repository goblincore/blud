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
