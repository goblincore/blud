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
//   ROW_WOUND_CAP    the box's minimum corner (world), the voxel's edge
//   ROW_WOUND_FLAGS  the box's origin in the atlas (voxels), w = nx + 256 ny + 65536 nz
// THE ATLAS is the 3D texture the shader already takes as `segVolumeAtlas`: RGBA8, a primitive's shape voxels with
// its colour voxels stacked after them along z. Texel centres sit at integer voxel coordinates.
import { ROW_WOUND, ROW_WOUND_CAP, ROW_WOUND_FLAGS, ROW_WOUND_META } from '../layout';
import { WV_MAX_ENTRIES, WV_TABLE_COL } from '../wound-volume-flag';
import { WV_BUMP_STEP, WV_CHAIN_STEP, WV_FLOOR } from '../../../wound-volume-stamp';

const f = (v: number) => { const s = String(v); return /[.e]/.test(s) ? s : `${s}.0`; };
const LIVE = f(WV_FLOOR + 0.002);

/** One entry's texel at p (trilinear over eight loads), raw 0..1; x < 0 when p is outside the entry's box. */
export const WV_READ = /* wgsl */ `fn wvRead(p: vec3<f32>, data: texture_2d<f32>, band: i32, e: i32, atlas: texture_3d<f32>, colour: bool) -> vec4<f32> {
  let col = ${WV_TABLE_COL} + e;
  let q = textureLoad(data, vec2<i32>(col, ${ROW_WOUND_META} + band), 0);
  let c = textureLoad(data, vec2<i32>(col, ${ROW_WOUND_CAP} + band), 0);
  let a = textureLoad(data, vec2<i32>(col, ${ROW_WOUND_FLAGS} + band), 0);
  let packed = i32(a.w + 0.5);
  let dims = vec3<i32>(packed % 256, (packed / 256) % 256, packed / 65536);
  let g = qRot(q, p - c.xyz) / c.w - vec3<f32>(0.5);
  if (any(g < vec3<f32>(0.0)) || any(g > vec3<f32>(dims - vec3<i32>(1)))) { return vec4<f32>(-1.0); }
  let i0 = clamp(vec3<i32>(floor(g)), vec3<i32>(0), dims - vec3<i32>(2));
  let t = clamp(g - vec3<f32>(i0), vec3<f32>(0.0), vec3<f32>(1.0));
  var o = vec3<i32>(a.xyz + vec3<f32>(0.5)) + i0;
  if (colour) { o.z = o.z + dims.z; }
  let c000 = textureLoad(atlas, o, 0);
  let c100 = textureLoad(atlas, o + vec3<i32>(1, 0, 0), 0);
  let c010 = textureLoad(atlas, o + vec3<i32>(0, 1, 0), 0);
  let c110 = textureLoad(atlas, o + vec3<i32>(1, 1, 0), 0);
  let c001 = textureLoad(atlas, o + vec3<i32>(0, 0, 1), 0);
  let c101 = textureLoad(atlas, o + vec3<i32>(1, 0, 1), 0);
  let c011 = textureLoad(atlas, o + vec3<i32>(0, 1, 1), 0);
  let c111 = textureLoad(atlas, o + vec3<i32>(1, 1, 1), 0);
  return mix(mix(mix(c000, c100, t.x), mix(c010, c110, t.x), t.y), mix(mix(c001, c101, t.x), mix(c011, c111, t.x), t.y), t.z);
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
    if (wvChainN > -0.1) { near = 1.0; }
  }
`;

export const WV_FUNCTIONS = `${WV_READ}\n${WV_COLOUR}`;
