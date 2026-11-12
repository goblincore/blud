// src/lab/sdf-zombie/webgpu/march/fields/wound-grid.wgsl.ts
//
// THE CRATER GRID, shader half (`?woundgrid`, ../wound-grid-flag.ts; the builder and the texel layout are
// ../../../wound-grid.ts). Not in the barrel: spliced into applyWounds only when the switch is on, so the off text
// is untouched.
//
// WG_LOOKUP runs once a call, after the wound count is read: the sample's cell gives a run of wound indices, and
// WG_NEXT replaces the loop's index source with that run. A sample outside the grid's box is outside every listed
// reach and returns at once. Never for a slot with an open head split (its piece reads its wounds at an un-warped
// point; the spike leaves that case on the list).
import { ROW_WOUND, ROW_WOUND_CAP, ROW_WOUND_CUT, ROW_WOUND_FLAGS, ROW_WOUND_META } from '../layout';
import { WG_A_COL, WG_A_COLS, WG_A_TEXELS, WG_B_COL, WG_CELL0, WG_INDEX0, WG_INDEX_BITS } from '../../../wound-grid';

/** The texture coordinate of grid texel t. */
export const WG_TEXEL = /* wgsl */ `fn wgTexel(t: i32, band: i32) -> vec2<i32> {
  if (t >= ${WG_A_TEXELS}) { return vec2<i32>(${WG_B_COL} + t - ${WG_A_TEXELS}, ${ROW_WOUND_CUT} + band); }
  let r = t / ${WG_A_COLS};
  let row = select(select(select(${ROW_WOUND_FLAGS}, ${ROW_WOUND_CAP}, r == 2), ${ROW_WOUND_META}, r == 1), ${ROW_WOUND}, r == 0);
  return vec2<i32>(${WG_A_COL} + t % ${WG_A_COLS}, row + band);
}`;

export const WG_LOOKUP = /* wgsl */ `  var wgOn = false;
  var wgAt = 0;
  var wgCnt = 0;
  var wgIdx = vec4<f32>(0.0);
  if (n > 0 && !gInstSplitOpen) {
    let wgH1 = textureLoad(data, wgTexel(1, band), 0);
    if (wgH1.w > 0.5) {
      let wgH0 = textureLoad(data, wgTexel(0, band), 0);
      let wgP = i32(wgH0.w + 0.5);
      let wgD = vec3<i32>(wgP & 15, (wgP >> 4u) & 15, (wgP >> 8u) & 15);
      let wgC = (p - wgH0.xyz) * wgH1.xyz;
      if (any(wgC < vec3<f32>(0.0)) || any(wgC >= vec3<f32>(wgD))) { return vec2<f32>(d, near); }
      let wgI = vec3<i32>(wgC);
      let wgE = textureLoad(data, wgTexel(${WG_CELL0} + wgI.x + wgD.x * (wgI.y + wgD.y * wgI.z), band), 0);
      wgOn = true;
      wgAt = i32(wgE.x + 0.5);
      wgCnt = i32(wgE.y + 0.5);
    }
  }
`;

/** The loop's index source: the cell's run when the grid is live, else what it was (`rest`). */
export const wgNext = (rest: string): string => /* wgsl */ `    if (wgOn) {
      if (k >= wgCnt) { break; }
      let wgQ = wgAt + k;
      if (k == 0 || (wgQ & 15) == 0) { wgIdx = textureLoad(data, wgTexel(${WG_INDEX0} + (wgQ >> 4u), band), 0); }
      i = (i32(wgIdx[(wgQ >> 2u) & 3] + 0.5) >> (${WG_INDEX_BITS}u * u32(wgQ & 3))) & 31;
    } else ${rest}`;
