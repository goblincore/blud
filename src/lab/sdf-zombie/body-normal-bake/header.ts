// src/lab/sdf-zombie/body-normal-bake/header.ts
//
// THE HEADER. Row 0 of the image is the region table, read by the shader: texel 0 = ('B', 'N', 2, count); region
// i is texels 1 + 5i .. 5 + 5i holding pairs of 16-bit values (r,g = hi,lo of the first; b,a of the second):
// [head.x, head.y] [head.z, tail.x] [tail.y, tail.z] [rMax, row0] [rows, kind]. Positions and rMax are mapped from
// -2.5..2.5 m; row0, rows and kind (0 torso, 1 limb) are plain integers. PNG keeps the bytes exact.
//
// Also the `<character>-body-n.json` sidecar, for people and the loader (webgpu/body-normal-load.ts).
import type { V } from './frame';
import type { Region } from './regions';

const q16 = (x: number) => Math.max(0, Math.min(65535, Math.round((x + 2.5) / 5 * 65535)));

/** Write the region table into row 0 of a `width`-wide RGBA image. Throws when the regions do not fit the row. */
export function writeHeader(rgba: Uint8Array, width: number, regions: Region[]): void {
  const put = (texel: number, a: number, b: number) => {
    const o = texel * 4;
    rgba[o] = a >> 8; rgba[o + 1] = a & 255; rgba[o + 2] = b >> 8; rgba[o + 3] = b & 255;
  };
  rgba.fill(0, 0, width * 4);
  rgba[0] = 66; rgba[1] = 78; rgba[2] = 2; rgba[3] = regions.length;
  if (1 + 5 * regions.length > width) throw new Error('too many regions for the header row');
  regions.forEach((R, i) => {
    const b = 1 + 5 * i;
    put(b, q16(R.head[0]), q16(R.head[1]));
    put(b + 1, q16(R.head[2]), q16(R.tail[0]));
    put(b + 2, q16(R.tail[1]), q16(R.tail[2]));
    put(b + 3, q16(R.rMax), R.row0);
    put(b + 4, R.rows, R.kind);
  });
}

/** The sidecar object (serialise with JSON.stringify(meta, null, 2) + '\n'). */
export function sidecar(name: string, width: number, height: number, regions: Region[]) {
  const r4 = (v: V) => v.map(x => +x.toFixed(4));
  const torso = regions[0]!;
  return {
    generator: 'scripts/bake-body-normal.ts', character: name, width, height, version: 2,
    yMin: +torso.tail[1].toFixed(4), yMax: +torso.head[1].toFixed(4), axisX: +torso.head[0].toFixed(4), axisZ: +torso.head[2].toFixed(4),
    regions: regions.map(R => ({ label: R.label, kind: R.kind ? 'limb' : 'torso', head: r4(R.head), tail: r4(R.tail), rMax: R.rMax, row0: R.row0, rows: R.rows })),
  };
}
