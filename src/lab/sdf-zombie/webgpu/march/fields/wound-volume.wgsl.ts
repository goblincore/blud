// src/lab/sdf-zombie/webgpu/march/fields/wound-volume.wgsl.ts
//
// THE BAKED WOUND VOLUME, shader half (`?woundvol`, ../wound-volume-flag.ts; the stamp is
// ../../../wound-volume-stamp.ts and the boxes ../../wound-volume-store.ts). Not in the barrel: spliced into
// applyWounds, the wound masks and the shading normal only when the switch is on, so the off text is untouched.
//
// THE TABLE rides the wound rows' free columns (WV_TABLE_COL + e, e < WV_MAX_ENTRIES), one wounded primitive an
// entry, in WORLD space, rewritten each frame by the CPU:
//   ROW_WOUND        bound centre, radius   (radius <= 0 ends the table)
//   ROW_WOUND_META   quaternion: world direction -> box frame
//   ROW_WOUND_CAP    the minimum corner (world) of the TOUCHED part of the box, w = voxels along x from a shape
//                    voxel to its colour voxel
//   ROW_WOUND_FLAGS  that part's origin in the atlas (voxels), w = nx + 256 ny + 65536 nz (its own dims)
// The voxel's edge is compiled in (the flag sets it).
// THE READ blends FOUR texels, not eight: tetrahedral interpolation (the cell is cut into six tetrahedra along its
// main diagonal; a point takes the four corners of the one it is in). Continuous across cells and exact at the
// corners, as trilinear is; half the loads. sampleVolume (../../../wound-volume-stamp.ts) is the CPU twin.
// THE ATLAS is the 3D texture the shader already takes as `segVolumeAtlas`: RGBA8, a primitive's shape voxels with
// its colour voxels beside them along x. Texel centres sit at integer voxel coordinates.
import { ROW_WOUND, ROW_WOUND_CAP, ROW_WOUND_FLAGS, ROW_WOUND_META } from '../layout';
import { WOUND_VOL_VOXEL, WV_MAX_ENTRIES, WV_TABLE_COL } from '../wound-volume-flag';
import { WV_BUMP_STEP, WV_CHAIN_STEP, WV_FLOOR, WV_NEAR } from '../../../wound-volume-stamp';

const f = (v: number) => { const s = String(v); return /[.e]/.test(s) ? s : `${s}.0`; };
const LIVE = f(WV_FLOOR + 0.002);
const VOXEL = f(WOUND_VOL_VOXEL || 0.02);

/** One entry's texel at p (tetrahedral, four loads), raw 0..1; x < 0 when p is outside the entry's box. */
export const WV_READ = /* wgsl */ `fn wvRead(p: vec3<f32>, data: texture_2d<f32>, band: i32, e: i32, atlas: texture_3d<f32>, colour: bool) -> vec4<f32> {
  let col = ${WV_TABLE_COL} + e;
  let q = textureLoad(data, vec2<i32>(col, ${ROW_WOUND_META} + band), 0);
  let c = textureLoad(data, vec2<i32>(col, ${ROW_WOUND_CAP} + band), 0);
  let g = qRot(q, p - c.xyz) * ${f(1 / (WOUND_VOL_VOXEL || 0.02))} - vec3<f32>(0.5);
  if (any(g < vec3<f32>(0.0))) { return vec4<f32>(-1.0); }
  let a = textureLoad(data, vec2<i32>(col, ${ROW_WOUND_FLAGS} + band), 0);
  let packed = i32(a.w + 0.5);
  let dims = vec3<i32>(packed % 256, (packed / 256) % 256, packed / 65536);
  if (any(g > vec3<f32>(dims - vec3<i32>(1)))) { return vec4<f32>(-1.0); }
  let i0 = clamp(vec3<i32>(floor(g)), vec3<i32>(0), dims - vec3<i32>(2));
  let t = clamp(g - vec3<f32>(i0), vec3<f32>(0.0), vec3<f32>(1.0));
  var o = vec3<i32>(a.xyz + vec3<f32>(0.5)) + i0;
  if (colour) { o.x = o.x + i32(c.w + 0.5); }
  // The largest, middle and smallest of t and the axes they lie on: walk the cell's corners along them.
  var e1 = vec3<i32>(0, 0, 1);
  var e2 = vec3<i32>(0, 1, 0);
  var hi = t.z;
  var mid = t.y;
  var lo = t.x;
  if (t.x >= t.y && t.x >= t.z) {
    e1 = vec3<i32>(1, 0, 0); hi = t.x;
    if (t.y >= t.z) { e2 = vec3<i32>(0, 1, 0); mid = t.y; lo = t.z; } else { e2 = vec3<i32>(0, 0, 1); mid = t.z; lo = t.y; }
  } else if (t.y >= t.z) {
    e1 = vec3<i32>(0, 1, 0); hi = t.y;
    if (t.x >= t.z) { e2 = vec3<i32>(1, 0, 0); mid = t.x; lo = t.z; } else { e2 = vec3<i32>(0, 0, 1); mid = t.z; lo = t.x; }
  } else if (t.x >= t.y) {
    e2 = vec3<i32>(1, 0, 0); mid = t.x; lo = t.y;
  }
  let c0 = textureLoad(atlas, o, 0);
  let c1 = textureLoad(atlas, o + e1, 0);
  let c2 = textureLoad(atlas, o + e1 + e2, 0);
  let c3 = textureLoad(atlas, o + vec3<i32>(1, 1, 1), 0);
  return c0 * (1.0 - hi) + c1 * (hi - mid) + c2 * (mid - lo) + c3 * lo;
}`;

/** The stamped colour at p: (wound mask, cavity share, torn / wet lip, wet only), the largest over the entries. */
export const WV_COLOUR = /* wgsl */ `fn wvColour(p: vec3<f32>, data: texture_2d<f32>, band: i32, atlas: texture_3d<f32>) -> vec4<f32> {
  var m = vec4<f32>(0.0);
  for (var e = 0; e < ${WV_MAX_ENTRIES}; e = e + 1) {
    let eb = textureLoad(data, vec2<i32>(${WV_TABLE_COL} + e, ${ROW_WOUND} + band), 0);
    if (eb.w <= 0.0) { break; }
    if (length(p - eb.xyz) > eb.w) { continue; }
    let t = wvRead(p, data, band, e, atlas, true);
    if (t.x >= 0.0) { m = max(m, t); }
  }
  return m;
}`;

/** applyWounds' own part, right after its bound test: the stamped craters are the OLDEST, so they carve first and
 *  the list's follow. `smax(d - gate * bumps, mix(chain without, chain with, gate))` is what the list returns for
 *  them (../../../wound-volume-stamp.ts applyVolumeSample is the CPU twin). */
export const WV_APPLY = /* wgsl */ `  for (var e = 0; e < ${WV_MAX_ENTRIES}; e = e + 1) {
    let eb = textureLoad(data, vec2<i32>(${WV_TABLE_COL} + e, ${ROW_WOUND} + band), 0);
    if (eb.w <= 0.0) { break; }
    if (length(p - eb.xyz) > eb.w) { continue; }
    let wt = wvRead(p, data, band, e, wvAtlas, false);
    if (wt.x < 0.0) { continue; }
    let wvChainB = ${f(WV_FLOOR)} + wt.x * ${f(255 * WV_CHAIN_STEP)};
    let wvChainN = ${f(WV_FLOOR)} + wt.w * ${f(255 * WV_CHAIN_STEP)};
    let wvBumps = wt.y * ${f(255 * WV_BUMP_STEP)};
    if (wvChainN < ${LIVE} && wvBumps < 1e-5) { continue; }
    // No lip here: nothing for the gate to scale, and equal smoothstep edges are undefined.
    let wvAmp = max(wt.z * ${f(255 * WV_BUMP_STEP)}, 1e-6);
    let wvGate = 1.0 - smoothstep(-wvAmp * 0.3, wvAmp * 0.7, dIn);
    let wvChain = mix(wvChainN, wvChainB, wvGate);
    let wvBumped = d - wvBumps * wvGate;
    d = select(wvBumped, smax(wvBumped, wvChain, woundCfg.y), wvChain > ${LIVE});
    if (wvChainN > ${f(WV_NEAR)}) { near = 1.0; }
  }
`;

export const WV_FUNCTIONS = `${WV_READ}\n${WV_COLOUR}`;
