// Bake the gargoyle-hd RESIDUAL volume: the mesh SDF on its grid, in the body's REST frame (the .blob's frame:
// reference x1.103, feet y 0, shifted by SHIFT so the root is x=z=0). The shader takes clamp(mesh - prims) live.
//
//   npx tsx scripts/gargoyle-hd/bake-residual.ts <mesh-sdf.f32> <mesh-sdf.json> <out-prefix> [clamp=0.015] [band=0.04]
//
// Writes <out>.binz (gzipped r16float, x fastest — WebGPU texel order) and the manifest {dims, min, h, clamp, band, format}.
// The shader fades the residual to 0 across the outer quarter of the band so the field has no step where it ends.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [gridF, metaF, out, clampS, bandS] = process.argv.slice(2);
const CLAMP = Number(clampS ?? 0.015), BAND = Number(bandS ?? 0.04);
const SHIFT = [-0.12, 0.0, -0.40]; // must match scripts/gargoyle-hd/emit_blob.py
const meta = JSON.parse(readFileSync(metaF!, 'utf8')) as { dims: [number, number, number]; lo: number[]; h: number };
const raw = readFileSync(gridF!);
const D = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4); // numpy C order: idx = (i*ny + j)*nz + k
const [nx, ny, nz] = meta.dims;
const min = [meta.lo[0]! + SHIFT[0]!, meta.lo[1]! + SHIFT[1]!, meta.lo[2]! + SHIFT[2]!];


// HALF FLOAT of residual/clamp in [-1, 1] (0 = no offset). r8 quantised to clamp/127 (0.12 mm at 15 mm), and the
// normal's finite difference drew every quantum as a contour line across flat skin (the wing-membrane stripes).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const toHalf = (x: number): number => {
  f32[0] = x; const b = u32[0]!, s = (b >>> 16) & 0x8000, e = ((b >>> 23) & 0xff) - 127 + 15, m = b & 0x7fffff;
  if (e <= 0) return s;  // below 6e-5 of the clamp (< 1 nm): flush to zero
  if (e >= 31) return s | 0x7c00;
  return (s | (e << 10)) + ((m + 0x1000) >>> 13);  // a rounding carry may bump the exponent, which is correct
};
const outB = new Uint16Array(nx * ny * nz);
// FORMAT 'mesh' (2026-11-17): store the MESH SDF itself (dm / band, in [-1, 1], every voxel so the sign holds
// outside the band) and let the shader take clamp(mesh - prims, +-clamp) LIVE. A baked difference could not cancel
// creases in the prim field finer than the 6 mm grid, and the wing's fence of thin capsules showed through as
// stripes; against the live prim field the creases cancel exactly wherever the mesh is within the clamp.
let n = 0;
for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
  const dm = D[(i * ny + j) * nz + k]!;
  if (Math.abs(dm) < BAND) n++;
  outB[(k * ny + j) * nx + i] = toHalf(Math.max(-1, Math.min(1, dm / BAND)));
}
// GZIPPED (.binz): 81 MB raw, ~4.7 MB compressed (outside the band every texel is the same saturated value). A custom
// extension so no server adds Content-Encoding; residual-volume.ts inflates it with DecompressionStream.
writeFileSync(`${out}.binz`, gzipSync(new Uint8Array(outB.buffer), { level: 9 }));
writeFileSync(`src/lab/sdf-zombie/characters/gargoyle-hd-residual.json`, JSON.stringify({ dims: [nx, ny, nz], min, h: meta.h, clamp: CLAMP, band: BAND, format: 'mesh' }, null, 1));
console.log(`band voxels ${n}`);
