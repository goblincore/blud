// The teratoma before/after picture: a slice through the detail body's worst bent prim (detail line src 600) on
// the GPU bake field vs sdBody. Left: |gpu - cpu| of the distance, log scale (black <= 1e-8 m, white >= 1e-3 m).
// Right: the angle between the GPU and CPU central-difference normals (the bake's eps 6e-4) in the 4 mm band
// round the skin, black 0 deg, white >= 5 deg. Grey contour = the CPU skin.
//   npx tsx docs/dev-notes/2026-10-24-gpu-bake-parity/teratoma-error-map.mts <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFromBlob, withDetail } from '../../../src/lab/sdf-zombie/body-normal-bake/regions';
import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { sdBody } from '../../../src/lab/sdf-zombie/validate';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
// @ts-expect-error -- a plain .mjs helper with no types
import { writePng } from '../../../scripts/lib/png-write.mjs';

const out = process.argv[2] ?? 'teratoma-error-map.png';
const CH = 'src/lab/sdf-zombie/characters';
const body = buildFromBlob(withDetail(readFileSync(`${CH}/teratoma.blob`, 'utf8'), readFileSync(`${CH}/teratoma.detail`, 'utf8'), 'teratoma'));
const prim = body.prims.find(p => p.src === 600 && p.bend !== undefined)!;
// The slice: the plane through the prim's chord and its bend, 6 cm round the chord's midpoint.
const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]!);
const nrm = (u: number[]) => { const l = Math.hypot(...u); return u.map(x => x / l); };
const cross = (u: number[], v: number[]) => [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
const U = nrm(sub(prim.b, prim.a)), W = nrm(cross(U, prim.bend!)), V = cross(W, U);
const mid = prim.a.map((x, i) => (x + prim.b[i]!) / 2);
const N = 192, HALF = 0.11, E = 6e-4;
const at = (i: number, j: number) => mid.map((m, k) => m + U[k]! * ((i + 0.5) / N * 2 - 1) * HALF + V[k]! * ((j + 0.5) / N * 2 - 1) * HALF * 0.5);
const OFFS = [[0, 0, 0], [E, 0, 0], [-E, 0, 0], [0, E, 0], [0, -E, 0], [0, 0, E], [0, 0, -E]];
const pts = new Float32Array(N * N * 7 * 3);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const p = at(i, j);
  OFFS.forEach((o, k) => pts.set([p[0]! + o[0]!, p[1]! + o[1]!, p[2]! + o[2]!], ((j * N + i) * 7 + k) * 3));
}
const gpu = (await dawnDevice())!;
const field = await GpuField.create(gpu, packBakeBody(body));
const got = await field.evaluate(pts);
const W2 = N * 2 + 8, rgba = new Uint8Array(W2 * N * 4).fill(255);
let maxErr = 0, maxDeg = 0;
const put = (x: number, y: number, v: number, contour: boolean) => {
  const o = ((N - 1 - y) * W2 + x) * 4; const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  rgba[o] = contour ? 120 : g; rgba[o + 1] = contour ? 200 : g; rgba[o + 2] = contour ? 255 : g; rgba[o + 3] = 255;
};
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const base = (j * N + i) * 7;
  const P = (k: number) => [pts[(base + k) * 3]!, pts[(base + k) * 3 + 1]!, pts[(base + k) * 3 + 2]!] as [number, number, number];
  const cpu = OFFS.map((_, k) => sdBody(P(k), body)), g = OFFS.map((_, k) => got[base + k]!);
  const err = Math.abs(g[0]! - cpu[0]!); maxErr = Math.max(maxErr, err);
  const contour = Math.abs(cpu[0]!) < 4e-4;
  put(i, j, (Math.log10(Math.max(err, 1e-8)) + 8) / 5, contour);
  let deg = 0;
  if (Math.abs(cpu[0]!) < 4e-3) {
    const nc = [cpu[1]! - cpu[2]!, cpu[3]! - cpu[4]!, cpu[5]! - cpu[6]!], ng = [g[1]! - g[2]!, g[3]! - g[4]!, g[5]! - g[6]!];
    const c = (nc[0]! * ng[0]! + nc[1]! * ng[1]! + nc[2]! * ng[2]!) / (Math.hypot(...nc) * Math.hypot(...ng));
    deg = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI; maxDeg = Math.max(maxDeg, deg);
  }
  put(N + 8 + i, j, deg / 5, contour);
}
field.destroy();
writeFileSync(out, writePng(W2, N, rgba));
console.log(`teratoma src 600 slice: max |gpu - cpu| ${maxErr.toExponential(2)} m, max normal error ${maxDeg.toFixed(2)} deg -> ${out}`);
