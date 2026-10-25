// src/lab/sdf-zombie/body-normal-bake/bake.wgsl.ts
//
// THE BAKE FIELD in WGSL: `sdBodyClosed` (validate.ts) line for line, built from the SAME leaf functions the game
// marches with (webgpu/march/primitives.wgsl.ts, math.wgsl.ts). Spec: docs/superpowers/specs/
// 2026-10-24-gpu-body-normal-bake-design.md.
//
// Why not mapBody: it is the crowd-, split-, wound-, volume- and tile-aware runtime fold, bounded by the runtime
// packer (MAX_PRIMS per body, 64 per cluster), and a detail body is thousands of prims. The leaves are what define
// the surface; the fold here is the CPU's, so the bake is held to `sdBody` and not to the runtime's fold rules
// (which differ: foldGroup chamfers only a prim that is chamfered and nothing else, `sdBody` any chamfered prim).
//
// The prims ride a data texture laid out exactly as the game's (gpu-pack.ts, through pack.ts writePrimRows), one
// column per prim, and the fold walks a LIST of prim columns in fold order, so a caller can fold any subset (the
// bake's per-row nearBody cull) without re-packing.
import {
  CONE_BEND, CONE_CAP, CONE_STRAND, SD_BEZIER_T, SD_GROOVE, SD_PRIM, SD_PRIM_ORIENTED, SD_ROUND_BOX, SD_SHELL,
  SMAX, SMIN, SMIN_CHAMFER, STRAND_HASH4, STRAND_LIPSCHITZ,
} from '../webgpu/march/primitives.wgsl';
import { FBM, HASH13, NOISE3, NOISE_LOCAL } from '../webgpu/march/math.wgsl';
import { ROW_PRIM_B, ROW_PRIM_BEND, ROW_PRIM_CLIP, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_PRIM_SHELL, ROW_PRIM_WARP } from '../webgpu/march/layout';

/** The leaf functions, in declaration order (WGSL has no forward declarations). Each name is the fn it declares. */
export const BAKE_LEAVES: readonly (readonly [string, string])[] = [
  ['smin', SMIN], ['sminChamfer', SMIN_CHAMFER], ['smax', SMAX], ['sdGroove', SD_GROOVE], ['coneCap', CONE_CAP],
  ['sdBezierT', SD_BEZIER_T], ['coneBend', CONE_BEND], ['strandHash4', STRAND_HASH4], ['strandLip', STRAND_LIPSCHITZ],
  ['coneStrand', CONE_STRAND], ['sdRoundBox', SD_ROUND_BOX], ['sdPrim', SD_PRIM], ['sdPrimO', SD_PRIM_ORIENTED],
  ['hash13', HASH13], ['noise3', NOISE3], ['fbm', FBM], ['noiseLocal', NOISE_LOCAL], ['sdShell', SD_SHELL],
];

/** The private globals the leaves read, at the REST values `sdBody` assumes: no wind (validate.ts sdStrand's
 *  windPhase 0, sdShellWrap's warpDrift 0) and the body frame at the origin (sdShellWrap's bodyAnchor 0). */
export const BAKE_GLOBALS: readonly (readonly [string, string])[] = [
  ['gWindDrift', 'var<private> gWindDrift: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);'],
  ['gBodyAnchor', 'var<private> gBodyAnchor: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);'],
];

/** One prim's distance: sdPrimitive. sdPrimO on an identity quat runs sdPrim's exact op sequence (its own header),
 *  which is why validate.ts can branch per prim and this can always take the oriented path. The shell wrap is
 *  applied to every role, as sdPrimitive does (a .blob `shell` line and a `carve` line are different kinds, so today
 *  only additive prims carry one). */
export const BAKE_PRIM = /* wgsl */ `fn bakePrim(p: vec3<f32>, i: i32, data: texture_2d<f32>) -> f32 {
  let T = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHAPE}), 0);
  let prof = T.y;
  var cpos = vec3<f32>(0.0, 0.0, 0.0);
  if ((i32(prof) & 2) != 0) { cpos = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND}), 0).xyz; }
  var sd = sdPrimO(p, i, data, T.x, prof, cpos, 0);
  if ((i32(prof) & 4) != 0) {
    let S2 = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHELL}), 0);
    let C2 = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_CLIP}), 0);
    let W2 = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_WARP}), 0);
    sd = sdShell(sd, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);
  }
  return sd;
}`;

/** sdBodyClosed: pass 1 folds the additive prims (role 0), chamfered by the prim's chamfer bit (prof bit 0) like
 *  `blendProfile === 'chamfer'`; pass 2 applies carves (role 1, smax) and grooves (role 3). Dead (2), bone (4) and
 *  organ (5) prims fold in neither pass. `list` holds prim columns in fold order, [off, off + n). */
export const BAKE_FIELD = /* wgsl */ `fn bakeField(p: vec3<f32>, data: texture_2d<f32>, off: u32, n: u32) -> f32 {
  var d = 1e9;
  for (var k = 0u; k < n; k = k + 1u) {
    let i = i32(list[off + k]);
    let role = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0).w;
    if (role != 0.0) { continue; }
    let blendK = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0).w;
    let prof = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHAPE}), 0).y;
    let sd = bakePrim(p, i, data);
    if ((i32(prof) & 1) != 0) { d = sminChamfer(d, sd, blendK); } else { d = smin(d, sd, blendK); }
  }
  for (var k = 0u; k < n; k = k + 1u) {
    let i = i32(list[off + k]);
    let role = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0).w;
    if (role == 1.0) {
      let blendK = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0).w;
      d = smax(d, -bakePrim(p, i, data), blendK);
    } else if (role == 3.0) {
      let T = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHAPE}), 0);
      d = sdGroove(d, bakePrim(p, i, data), T.z, T.w);
    }
  }
  return d;
}`;

/** The point-evaluation entry, for the parity tests: outD[j] = bakeField(pts[j].xyz) over list [cfg.x, cfg.x + cfg.y). */
export const FIELD_ENTRY = /* wgsl */ `@compute @workgroup_size(64)
fn fieldMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j >= cfg.z) { return; }
  outD[j] = bakeField(pts[j].xyz, data, cfg.x, cfg.y);
}`;

const FIELD_BINDINGS = /* wgsl */ `@group(0) @binding(0) var data: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> list: array<u32>;
@group(0) @binding(2) var<storage, read> pts: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> outD: array<f32>;
@group(0) @binding(4) var<uniform> cfg: vec4<u32>;`;

/** The whole point-evaluation module: bindings, globals, leaves, the fold and the entry `fieldMain`. */
export function fieldShaderSource(): string {
  return [FIELD_BINDINGS, ...BAKE_GLOBALS.map(g => g[1]), ...BAKE_LEAVES.map(l => l[1]), BAKE_PRIM, BAKE_FIELD, FIELD_ENTRY].join('\n\n');
}

/** cpu-bake.ts `skin`: the first skin along the ray from r0 in toward the axis point P. xyz the point, w 1 on a hit. */
export const BAKE_SKIN = /* wgsl */ `fn bakeSkin(P: vec3<f32>, dir: vec3<f32>, r0: f32, data: texture_2d<f32>, off: u32, n: u32) -> vec4<f32> {
  var t = r0;
  for (var i = 0; i < 300; i = i + 1) {
    if (t <= 0.0) { break; }
    let p = P + dir * t;
    let d = bakeField(p, data, off, n);
    if (d < 1e-4) { return vec4<f32>(p, 1.0); }
    t = t - max(d * 0.9, 2e-4);
  }
  return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}`;

/** cpu-bake.ts `grad`: the central-difference normal, eps 6e-4. */
export const BAKE_GRAD = /* wgsl */ `fn bakeGrad(p: vec3<f32>, data: texture_2d<f32>, off: u32, n: u32) -> vec3<f32> {
  let e = 6e-4;
  return normalize(vec3<f32>(
    bakeField(p + vec3<f32>(e, 0.0, 0.0), data, off, n) - bakeField(p - vec3<f32>(e, 0.0, 0.0), data, off, n),
    bakeField(p + vec3<f32>(0.0, e, 0.0), data, off, n) - bakeField(p - vec3<f32>(0.0, e, 0.0), data, off, n),
    bakeField(p + vec3<f32>(0.0, 0.0, e), data, off, n) - bakeField(p - vec3<f32>(0.0, 0.0, e), data, off, n)));
}`;

/** One texel per invocation over a chunk of a region's rows: cpu-bake.ts `texelNormals`. The CPU supplies each
 *  row's axis point and prim lists (rowsIn[r]: P.xyz, then rowLists[r]: base off/n, detail off/n) and each column's
 *  ray direction (cols[c]), all from frame.ts; the encode stays on the CPU (frame.ts writeTexel). outN[2k] = (nb, hit),
 *  outN[2k + 1] = (nd, 0), k = local row * width + column. */
export const BAKE_ENTRY = /* wgsl */ `@compute @workgroup_size(64)
fn bakeMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = bcfg.x;
  let k = id.x;
  if (k >= width * bcfg.z) { return; }
  let row = bcfg.y + k / width;
  let col = k % width;
  let P = rowsIn[row].xyz;
  let L = rowLists[row];
  let dir = cols[col].xyz;
  let r0 = bcfgF.x;
  let pb = bakeSkin(P, dir, r0, dataBase, L.x, L.y);
  if (pb.w < 0.5) {
    outN[2u * k] = vec4<f32>(0.0, 0.0, 1.0, 0.0);
    outN[2u * k + 1u] = vec4<f32>(0.0, 0.0, 1.0, 0.0);
    return;
  }
  var pd = bakeSkin(P, dir, r0, dataDetail, L.z, L.w);
  if (pd.w < 0.5) { pd = pb; }
  outN[2u * k] = vec4<f32>(bakeGrad(pb.xyz, dataBase, L.x, L.y), 1.0);
  outN[2u * k + 1u] = vec4<f32>(bakeGrad(pd.xyz, dataDetail, L.z, L.w), 0.0);
}`;

const BAKE_BINDINGS = /* wgsl */ `@group(0) @binding(0) var dataBase: texture_2d<f32>;
@group(0) @binding(1) var dataDetail: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> list: array<u32>;
@group(0) @binding(3) var<storage, read> rowsIn: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> rowLists: array<vec4<u32>>;
@group(0) @binding(5) var<storage, read> cols: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> outN: array<vec4<f32>>;
@group(0) @binding(7) var<uniform> bcfg: vec4<u32>;
@group(0) @binding(8) var<uniform> bcfgF: vec4<f32>;`;

/** The whole bake module: bindings, globals, leaves, the fold, skin, gradient and the entry `bakeMain`. bcfg = (width,
 *  first row of this dispatch, rows in it, 0); bcfgF = (r0, 0, 0, 0). */
export function bakeShaderSource(): string {
  return [BAKE_BINDINGS, ...BAKE_GLOBALS.map(g => g[1]), ...BAKE_LEAVES.map(l => l[1]), BAKE_PRIM, BAKE_FIELD, BAKE_SKIN, BAKE_GRAD, BAKE_ENTRY].join('\n\n');
}
