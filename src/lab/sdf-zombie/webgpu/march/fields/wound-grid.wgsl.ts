// src/lab/sdf-zombie/webgpu/march/fields/wound-grid.wgsl.ts
//
// THE CRATER GRID, shader half (`?woundgrid`, ../wound-grid-flag.ts; the builder and the texel layout are
// ../../../wound-grid.ts). Not in the barrel: spliced into the wound loops only when the switch is on, so the off
// text is untouched.
//
// wgBegin(p) finds the sample's cell: (1, offset, count) when the body has a live grid, (0, 0, 0) when it has none
// (the loop then walks the list's rows as before). Outside the grid's box the count is 0: the sample is outside
// every listed reach. wgIndex(q) is entry q of the index run. Every loop over a body's wounds takes its indices
// this way (applyWounds, woundMask, charMask, ngWounds), so a body's wounds past the first 32 carve, colour and
// shade like the rest.
import { WG_CELL0, WG_CELL_MAX, WG_COLS, WG_INDEX0, WG_INDEX_BITS, WG_PER_CHANNEL, WG_PER_TEXEL, WG_ROW0 } from '../../../wound-grid';

export const WG_FUNCTIONS = /* wgsl */ `fn wgTexel(t: i32, band: i32) -> vec2<i32> {
  return vec2<i32>(t % ${WG_COLS}, ${WG_ROW0} + t / ${WG_COLS} + band);
}
fn wgBegin(p: vec3<f32>, data: texture_2d<f32>, band: i32) -> vec3<i32> {
  let h1 = textureLoad(data, wgTexel(1, band), 0);
  if (h1.w < 0.5) { return vec3<i32>(0); }
  let h0 = textureLoad(data, wgTexel(0, band), 0);
  let packed = i32(h0.w + 0.5);
  let dims = vec3<i32>(packed & 15, (packed >> 4u) & 15, (packed >> 8u) & 15);
  let c = (p - h0.xyz) * h1.xyz;
  if (any(c < vec3<f32>(0.0)) || any(c >= vec3<f32>(dims))) { return vec3<i32>(1, 0, 0); }
  let ci = vec3<i32>(c);
  let e = textureLoad(data, wgTexel(${WG_CELL0} + ci.x + dims.x * (ci.y + dims.y * ci.z), band), 0);
  return vec3<i32>(1, i32(e.x + 0.5), i32(e.y + 0.5));
}
fn wgUnpack(v: vec4<f32>, q: i32) -> i32 {
  let s = q % ${WG_PER_TEXEL};
  return (i32(v[s / ${WG_PER_CHANNEL}] + 0.5) >> (${WG_INDEX_BITS}u * u32(s % ${WG_PER_CHANNEL}))) & 127;
}
fn wgIndex(q: i32, data: texture_2d<f32>, band: i32) -> i32 {
  return wgUnpack(textureLoad(data, wgTexel(${WG_INDEX0} + q / ${WG_PER_TEXEL}, band), 0), q);
}`;

/** applyWounds: once a call, after the wound count is read. A sample outside the box returns at once. */
export const WG_LOOKUP = /* wgsl */ `  var wgS = vec3<i32>(0);
  var wgIdx = vec4<f32>(0.0);
  if (n > 0) {
    wgS = wgBegin(p, data, band);
    if (wgS.x > 0 && wgS.z == 0) { return vec2<f32>(d, near); }
  }
`;

/** applyWounds' index source: the cell's run when the grid is live (one index texel load a dozen wounds), else
 *  what it was (\`rest\`). */
export const wgNext = (rest: string): string => /* wgsl */ `    if (wgS.x > 0) {
      if (k >= wgS.z) { break; }
      let wgQ = wgS.y + k;
      if (k == 0 || wgQ % ${WG_PER_TEXEL} == 0) { wgIdx = textureLoad(data, wgTexel(${WG_INDEX0} + wgQ / ${WG_PER_TEXEL}, band), 0); }
      i = wgUnpack(wgIdx, wgQ);
    } else ${rest}`;

/** A once-a-pixel loop over a body's wounds (\`for (var i = 0; i < MAX_WOUNDS; ...) { if (i >= n) { break; }\`),
 *  rewritten to take its indices from the cell of \`point\`. \`count\` is the loop's own count expression. */
export function wgLoopHead(point: string, count: string): string {
  return /* wgsl */ `let wgS = wgBegin(${point}, data, gBand);
  for (var wgK = 0; wgK < ${WG_CELL_MAX}; wgK = wgK + 1) {
    var i = wgK;
    if (wgS.x > 0) {
      if (wgK >= wgS.z) { break; }
      i = wgIndex(wgS.y + wgK, data, gBand);
    } else if (wgK >= ${count}) { break; }`;
}
