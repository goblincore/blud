// scripts/upscale4x-sheets.ts — offline 4x reconstruction experiment: comparison sheets.
//
// Reads the raw float frames scripts/upscale4x-probe.mjs dumps and builds, per view, ONE zoomed sheet
// the owner can judge. The key column is TODAY: the 0.5 march run through the SHIPPED t16-rgb network
// (public/assets/lab/upscale/t16-rgb-v32.json) by the CPU reference twin of the upscale shader
// (upscale-reference.ts, parity-tested against the GPU stage) — so candidates are compared against
// what the game actually shows, not against a bilinear stand-in (owner, 2026-09-22: "hard to judge
// since they don't correspond to in game — we use the upscaler network").
//
//   npx tsx scripts/upscale4x-sheets.ts [dir=.lab-tmp/upscale4x]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import { writePng } from './lib/png-write.mjs';
import { upscaleReference, type FloatImage } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts';
import { parseUpscaleModelJson } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts';

const DIR = process.argv[2] ?? '.lab-tmp/upscale4x';
const probe = JSON.parse(readFileSync(join(DIR, 'probe.json'), 'utf8')) as { near: number; far: number; rows: { tag: string }[] };
const LR35 = (process.env.U4_LR35 ?? '280x210').split('x').map(Number) as [number, number];
const model = parseUpscaleModelJson(JSON.parse(readFileSync('public/assets/lab/upscale/t16-rgb-v32.json', 'utf8')));

const load = (tag: string, k: string, w: number, h: number): FloatImage => {
  const b = readFileSync(join(DIR, `${tag}-${k}.f32`));
  return { w, h, c: 4, data: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
};
const toneByte = (v: number) => Math.min(255, Math.max(0, Math.round(255 * Math.pow(v / (1 + v), 1 / 2.2))));

/** Nearest-neighbour coverage-aware bilinear, same convention as the probe (miss = black). */
function bilinearUp(lr: FloatImage, f: number, W0 = lr.w * f, H0 = lr.h * f): FloatImage {
  // f may be fractional (0.35 -> 800 is 2.857x): sample at output-pixel centres in source space.
  const w = W0, h = H0, fx0 = lr.w / w, fy0 = lr.h / h, data = new Float32Array(w * h * 4);
  const cl = (v: number, m: number) => Math.min(Math.max(v, 0), m - 1);
  for (let Y = 0; Y < h; Y++) {
    const sy = (Y + 0.5) * fy0 - 0.5, y0 = Math.floor(sy), fy = sy - y0;
    for (let X = 0; X < w; X++) {
      const sx = (X + 0.5) * fx0 - 0.5, x0 = Math.floor(sx), fx = sx - x0;
      const o = (Y * w + X) * 4;
      const own = lr.data[(cl(Math.round(sy), lr.h) * lr.w + cl(Math.round(sx), lr.w)) * 4 + 3]!;
      data[o + 3] = own;
      if (own >= 1) continue;
      let ws = 0;
      for (const [tx, ty, wt] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]] as const) {
        const k = (cl(ty, lr.h) * lr.w + cl(tx, lr.w)) * 4;
        if (lr.data[k + 3]! >= 1) continue;
        ws += wt;
        for (let c = 0; c < 3; c++) data[o + c] += wt * lr.data[k + c]!;
      }
      for (let c = 0; c < 3; c++) data[o + c] /= ws || 1;
    }
  }
  return { w, h, c: 4, data };
}

/** PSNR over pixels that are flesh in the truth, tonemapped (miss = black). */
function psnrFlesh(a: FloatImage, gt: FloatImage): number {
  let se = 0, n = 0;
  for (let i = 0; i < gt.w * gt.h; i++) {
    if (gt.data[i * 4 + 3]! >= 1) continue;
    const ha = a.data[i * 4 + 3]! < 1;
    for (let c = 0; c < 3; c++) { const d = ((ha ? toneByte(a.data[i * 4 + c]!) : 0) - toneByte(gt.data[i * 4 + c]!)) / 255; se += d * d; }
    n += 3;
  }
  return 10 * Math.log10(n / se);
}

/** Silhouette error: the fraction of pixels whose flesh/no-flesh verdict differs from the truth's.
 *  This is the "fattened edge" number directly, independent of colour. */
function edgeMismatch(a: FloatImage, gt: FloatImage): { extra: number; missing: number } {
  let extra = 0, missing = 0, flesh = 0;
  for (let i = 0; i < gt.w * gt.h; i++) {
    const g = gt.data[i * 4 + 3]! < 1, h = a.data[i * 4 + 3]! < 1;
    if (g) flesh++;
    if (h && !g) extra++;
    if (g && !h) missing++;
  }
  return { extra: extra / flesh, missing: missing / flesh };
}

const summary: Record<string, unknown>[] = [];
for (const { tag } of probe.rows) {
  const gt = load(tag, 'gt', 800, 600);
  const lr2 = load(tag, 'lr2', 400, 300);
  // All legs with the hit tolerance OFF (owner 2026-09-22: it is a perf side-effect, not the look).
  // [35w, 35h] from the probe's coverage record; setSdfScale(0.35) -> 280x210 at 800x600.
  const [w35, h35] = LR35;
  const cols: [string, FloatImage][] = [
    ['truth 16x', gt],
    ['TODAY 0.5+t16', upscaleReference(load(tag, 'lr2off', 400, 300), model, 'sp', probe.near, probe.far, 800, 600)],
    ['0.5 bilinear', bilinearUp(load(tag, 'lr2off', 400, 300), 2)],
    ['0.35 bilinear', bilinearUp(load(tag, 'lr35off', w35, h35), 0, 800, 600)],
    ['0.25 bilinear', bilinearUp(load(tag, 'lr4off', 200, 150), 4)],
  ];
  const row: Record<string, unknown> = { tag };
  for (const [name, img] of cols.slice(1)) row[name] = { psnrFlesh: +psnrFlesh(img, gt).toFixed(2), ...Object.fromEntries(Object.entries(edgeMismatch(img, gt)).map(([k, v]) => [k, +(100 * v).toFixed(1)])) };
  summary.push(row);

  // Crop to the truth's body bbox (+pad), zoom 2x nearest so edges are visible, columns side by side.
  let x0 = 800, y0 = 600, x1 = 0, y1 = 0;
  for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) if (gt.data[(y * 800 + x) * 4 + 3]! < 1) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 12;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(799, x1 + pad); y1 = Math.min(599, y1 + pad);
  // Cap the crop height so a full-body view still zooms; keep the top (head/shoulders) part.
  if (y1 - y0 > 300) y1 = y0 + 300;
  if (x1 - x0 > 300) { const cx = (x0 + x1) >> 1; x0 = cx - 150; x1 = cx + 150; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, Z = 2, gap = 4;
  const W = cols.length * (cw * Z + gap), H = ch * Z;
  const px = new Uint8Array(W * H * 4).fill(40);
  for (let k = 0; k < cols.length; k++) {
    const img = cols[k]![1];
    for (let y = 0; y < H; y++) for (let x = 0; x < cw * Z; x++) {
      const sx = x0 + Math.floor(x / Z), sy = y0 + Math.floor(y / Z), s = (sy * 800 + sx) * 4, o = (y * W + k * (cw * Z + gap) + x) * 4;
      const hit = img.data[s + 3]! < 1;
      for (let c = 0; c < 3; c++) px[o + c] = hit ? toneByte(img.data[s + c]!) : 0;
      px[o + 3] = 255;
    }
  }
  writeFileSync(join(DIR, `cmp-${tag}.png`), writePng(W, H, px));
}
console.log('columns (tolerance off): truth | TODAY 0.5+t16 | 0.5 bilinear | 0.35 bilinear | 0.25 bilinear');
console.table(summary.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]))));
writeFileSync(join(DIR, 'sheets.json'), JSON.stringify(summary, null, 2));
