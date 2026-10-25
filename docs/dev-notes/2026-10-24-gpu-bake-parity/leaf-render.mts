// Deterministic before/after of the coneBend Newton polish, rendered through the GPU bake field (the game's leaf
// WGSL): an orthographic, Lambert-shaded close-up round one bent prim. BEFORE = this tree's shader with CONE_BEND
// swapped for its text at <rev>; AFTER = this tree's. Columns: before | after | |after - before| x 8.
//   npx tsx docs/dev-notes/2026-10-24-gpu-bake-parity/leaf-render.mts <out.png> <rev> <character> <src line> [detail]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildFromBlob, withDetail } from '../../../src/lab/sdf-zombie/body-normal-bake/regions';
import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { fieldShaderSource } from '../../../src/lab/sdf-zombie/body-normal-bake/bake.wgsl';
import { CONE_BEND } from '../../../src/lab/sdf-zombie/webgpu/march/primitives.wgsl';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
// @ts-expect-error -- a plain .mjs helper with no types
import { writePng } from '../../../scripts/lib/png-write.mjs';

const [out, rev, name, srcLine, detailArg] = process.argv.slice(2) as [string, string, string, string, string?];
const CH = 'src/lab/sdf-zombie/characters';
const blob = readFileSync(`${CH}/${name}.blob`, 'utf8');
const body = buildFromBlob(detailArg ? withDetail(blob, readFileSync(`${CH}/${name}.detail`, 'utf8'), name) : blob);
const prim = body.prims.find(p => p.src === Number(srcLine) && p.bend !== undefined);
if (!prim) throw new Error(`${name}: no bent prim on line ${srcLine}`);
// BEFORE's CONE_BEND, from <rev>, extracted the way the module exports it.
const oldFile = execFileSync('git', ['show', `${rev}:src/lab/sdf-zombie/webgpu/march/primitives.wgsl.ts`], { encoding: 'utf8' });
const oldCone = oldFile.slice(oldFile.indexOf('fn coneBend('), oldFile.indexOf('}`;', oldFile.indexOf('fn coneBend(')) + 1);
const after = fieldShaderSource();
const before = after.replace(CONE_BEND, oldCone);
if (before === after) throw new Error(`CONE_BEND at ${rev} is the same text`);

// Camera: looking at the prim's midpoint along its bend direction's perpendicular, a window 3x the prim's reach.
const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]!);
const nrm = (u: number[]) => { const l = Math.hypot(...u); return u.map(x => x / l); };
const cross = (u: number[], v: number[]) => [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
const U = nrm(sub(prim.b, prim.a)), W = nrm(cross(U, prim.bend!)), V = cross(W, U);
const mid = prim.a.map((x, i) => (x + prim.b[i]!) / 2);
const half = Math.hypot(...sub(prim.b, prim.a)) * 0.75, N = 320, START = half * 2;
const origin = (i: number, j: number) => mid.map((m, k) => m + U[k]! * ((i + 0.5) / N * 2 - 1) * half + V[k]! * ((j + 0.5) / N * 2 - 1) * half + W[k]! * START);
const gpu = (await dawnDevice())!;
const packed = packBakeBody(body);

async function render(source: string): Promise<Float32Array> {
  const field = await GpuField.create(gpu, packed, source);
  const t = new Float32Array(N * N).fill(0), hit = new Uint8Array(N * N);
  const pts = new Float32Array(N * N * 3);
  for (let step = 0; step < 300; step++) {
    for (let k = 0; k < N * N; k++) { const o = origin(k % N, Math.floor(k / N)); for (let c = 0; c < 3; c++) pts[k * 3 + c] = o[c]! - W[c]! * t[k]!; }
    const d = await field.evaluate(pts);
    for (let k = 0; k < N * N; k++) if (!hit[k]) { if (d[k]! < 1e-5) hit[k] = 1; else if (t[k]! < START * 2) t[k]! += d[k]! * 0.9; }
  }
  // Normals at the hits (central differences, eps 2e-4), then Lambert under a fixed light.
  const E = 2e-4, offs = [[E, 0, 0], [-E, 0, 0], [0, E, 0], [0, -E, 0], [0, 0, E], [0, 0, -E]];
  const np = new Float32Array(N * N * 18);
  for (let k = 0; k < N * N; k++) offs.forEach((o, m) => { for (let c = 0; c < 3; c++) np[(k * 6 + m) * 3 + c] = pts[k * 3 + c]! + o[c]!; });
  const nd = await field.evaluate(np);
  field.destroy();
  const L = nrm([0.4, 0.7, 0.6]), shade = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (!hit[k]) { shade[k] = -1; continue; }
    const n = nrm([nd[k * 6]! - nd[k * 6 + 1]!, nd[k * 6 + 2]! - nd[k * 6 + 3]!, nd[k * 6 + 4]! - nd[k * 6 + 5]!]);
    const lw = [L[0]! * U[0]! + L[1]! * V[0]! + L[2]! * W[0]!, L[0]! * U[1]! + L[1]! * V[1]! + L[2]! * W[1]!, L[0]! * U[2]! + L[1]! * V[2]! + L[2]! * W[2]!];
    shade[k] = 0.12 + 0.88 * Math.max(0, n[0]! * lw[0]! + n[1]! * lw[1]! + n[2]! * lw[2]!);
  }
  return shade;
}
const A = await render(before), B = await render(after);
const W3 = N * 3 + 8, rgba = new Uint8Array(W3 * N * 4).fill(255);
let changed = 0, maxD = 0;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i, a = A[k]!, b = B[k]!;
  const ga = a < 0 ? 0.03 : a, gb = b < 0 ? 0.03 : b, dd = Math.abs(ga - gb);
  if (Math.round(ga * 255) !== Math.round(gb * 255)) changed++;
  maxD = Math.max(maxD, dd);
  [[ga, 0], [gb, N + 4], [Math.min(1, dd * 8), 2 * N + 8]].forEach(([v, x0]) => {
    const o = ((N - 1 - j) * W3 + (x0 as number) + i) * 4, g = Math.round((v as number) * 255);
    rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
  });
}
writeFileSync(out, writePng(W3, N, rgba));
console.log(`${name} line ${srcLine}${detailArg ? ' (detail body)' : ''}: ${changed} of ${N * N} px change in 8-bit, max shade delta ${(maxD * 255).toFixed(1)}/255 -> ${out}`);
