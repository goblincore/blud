// Mesh a .blob character's SDF (the game's own CPU field) with surface nets, write an ASCII PLY with vertex colours.
// usage: tsx blob-mesh.ts <file.blob> <out.ply> [voxel_m=0.006] ["bone=line" overrides...]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../../src/lab/sdf-zombie/build-body';
import { sdBody, nearestPrim } from '../../../src/lab/sdf-zombie/validate';

const [file, out, vox = '0.006', ...over] = process.argv.slice(2);
let src = readFileSync(file!, 'utf8');
for (const o of over) {            // "thigh=pitch=88" replaces pitch= on that bone's line; "thigh=dir=up" etc.
  const [bone, key, val] = o.split('=');
  const re = new RegExp('(\\n\\s*bone ' + bone + '\\s[^\\n]*)');
  src = src.replace(re, (line: string) => {
    const kv = new RegExp('\\b' + key + '=\\S+');
    return kv.test(line) ? line.replace(kv, key + '=' + val) : line + ' ' + key + '=' + val;
  });
}
const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc))) as any;
const base = (/baseColor\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(src)?.slice(1).map(Number)) ?? [0.34, 0.44, 0.19];
const h = Number(vox);
const lo = [-0.7, -0.05, -0.7], hi = [0.7, 1.6, 0.9];
const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
// Coarse pass, then fine samples only near the surface.
const C = 6, ch = h * C;
const cx = Math.ceil(nx / C) + 1, cy = Math.ceil(ny / C) + 1, cz = Math.ceil(nz / C) + 1;
const coarse = new Float32Array(cx * cy * cz);
for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
  coarse[i + cx * (j + cy * k)] = sdBody([lo[0] + i * ch, lo[1] + j * ch, lo[2] + k * ch], body);
const field = new Float32Array(nx * ny * nz);
let evals = 0;
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const ci = Math.round(i / C), cj = Math.round(j / C), ck = Math.round(k / C);
  const cd = coarse[Math.min(ci, cx - 1) + cx * (Math.min(cj, cy - 1) + cy * Math.min(ck, cz - 1))]!;
  if (Math.abs(cd) > ch * 1.8) { field[i + nx * (j + ny * k)] = cd; continue; }
  field[i + nx * (j + ny * k)] = sdBody([lo[0] + i * h, lo[1] + j * h, lo[2] + k * h], body); evals++;
}
const F = (i: number, j: number, k: number) => field[i + nx * (j + ny * k)]!;
const vid = new Int32Array(nx * ny * nz).fill(-1);
const verts: number[][] = [];
const corners = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  const v = corners.map(([a, b, c]) => F(i + a!, j + b!, k + c!));
  let inside = 0; for (const d of v) if (d < 0) inside++;
  if (inside === 0 || inside === 8) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of edges) {
    const da = v[a!]!, db = v[b!]!;
    if ((da < 0) === (db < 0)) continue;
    const t = da / (da - db), ca = corners[a!]!, cb = corners[b!]!;
    sx += ca[0]! + (cb[0]! - ca[0]!) * t; sy += ca[1]! + (cb[1]! - ca[1]!) * t; sz += ca[2]! + (cb[2]! - ca[2]!) * t; n++;
  }
  vid[i + nx * (j + ny * k)] = verts.length;
  verts.push([lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h]);
}
const faces: number[][] = [];
const V = (i: number, j: number, k: number) => vid[i + nx * (j + ny * k)]!;
for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const d0 = F(i, j, k);
  // edges along +x, +y, +z from this sample
  const quads: [number, number, number[][]][] = [
    [F(i + 1, j, k), 0, [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]]],
    [F(i, j + 1, k), 1, [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]]],
    [F(i, j, k + 1), 2, [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]]],
  ];
  for (const [d1, , cells] of quads) {
    if ((d0 < 0) === (d1 < 0)) continue;
    const q = cells.map(([a, b, c]) => V(i + a!, j + b!, k + c!));
    if (q.some(x => x < 0)) continue;
    faces.push(d0 < 0 ? q : [...q].reverse());
  }
}
const lin2s = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.4) - 0.055));
const lines = ['ply', 'format ascii 1.0', 'element vertex ' + verts.length, 'property float x', 'property float y', 'property float z',
  'property uchar red', 'property uchar green', 'property uchar blue', 'element face ' + faces.length, 'property list uchar int vertex_indices', 'end_header'];
for (const p of verts) {
  const pi = nearestPrim(p as any, body); const pr = pi >= 0 ? body.prims[pi] : null;
  const c = pr?.color ?? base;
  lines.push(p[0]!.toFixed(5) + ' ' + p[1]!.toFixed(5) + ' ' + p[2]!.toFixed(5) + ' ' + lin2s(c[0]) + ' ' + lin2s(c[1]) + ' ' + lin2s(c[2]));
}
for (const f of faces) lines.push('4 ' + f.join(' '));
writeFileSync(out!, lines.join('\n'));
console.log('MESH', out, 'verts', verts.length, 'faces', faces.length, 'evals', evals, 'errors', (body.errors ?? []).length);
