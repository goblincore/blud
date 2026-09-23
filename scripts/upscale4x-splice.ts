// scripts/upscale4x-splice.ts — offline preview of the HYBRID march (owner request 2026-09-22).
//
// The idea: march coarse (0.25 or 0.35), then give only the pixels the eye catches — silhouettes,
// depth edges (limb over torso), the face — a real full-resolution ray (the run-5 refine path in the
// engine); interpolate everything else from the coarse march. This builds the BEST CASE of that
// image offline so the owner can judge it before any engine work:
//   * the HARD MASK is derived from the COARSE march only (plus the head circle) — the engine will
//     not have the truth, so the preview must not use it to choose pixels;
//   * hard pixels take the NATIVE single-ray 800x600 march (tolerance off), not the 16x truth —
//     that is what an in-engine refine produces, so the preview does not flatter itself;
//   * soft pixels are coverage-aware bilinear from the coarse march.
// Reports the hard-pixel share of the body, which is what the refine would cost.
//
//   npx tsx scripts/upscale4x-splice.ts [dir=.lab-tmp/upscale4x]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import { writePng } from './lib/png-write.mjs';
import { upscaleReference, type FloatImage } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts';
import { parseUpscaleModelJson } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts';

const DIR = process.argv[2] ?? '.lab-tmp/upscale4x';
const W = 800, H = 600;
const DEPTH_EDGE_M = Number(process.env.SPLICE_DEPTH_EDGE_M ?? 0.08); // coarse neighbours further apart than this = a depth edge
const DILATE = Number(process.env.SPLICE_DILATE ?? 0); // coarse texels of growth around every hard texel
const FACE_GROW = Number(process.env.SPLICE_FACE_GROW ?? 0.8); // head circle radius multiplier (0.45 missed the mouth at 2.5 m; 1.15 took the whole head + neck)
const SEAM_COLOUR = Number(process.env.SPLICE_SEAM_COLOUR ?? 0.08); // tonemapped channel delta that makes a prim seam visible
const USE_IDS = process.env.SPLICE_IDS !== '0';
const WOUND_GROW = Number(process.env.SPLICE_WOUND_GROW ?? 1.3); // wound circle radius multiplier; 0 = wounds not in the mask // part-ID boundaries (skin vs trousers etc.) from march debug mode 11
const probe = JSON.parse(readFileSync(join(DIR, 'probe.json'), 'utf8')) as { near: number; far: number; rows: { tag: string }[] };
const model = parseUpscaleModelJson(JSON.parse(readFileSync('public/assets/lab/upscale/t16-rgb-v32.json', 'utf8')));
const linear = (d: number) => (probe.near * probe.far) / (probe.far - d * (probe.far - probe.near));
const load = (tag: string, k: string, w: number, h: number): FloatImage => {
  const b = readFileSync(join(DIR, `${tag}-${k}.f32`));
  return { w, h, c: 4, data: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
};
const toneByte = (v: number) => Math.min(255, Math.max(0, Math.round(255 * Math.pow(v / (1 + v), 1 / 2.2))));
const hit = (img: FloatImage, i: number) => img.data[i * 4 + 3]! < 1;

function bilinearTo(lr: FloatImage): FloatImage {
  const data = new Float32Array(W * H * 4), fx0 = lr.w / W, fy0 = lr.h / H;
  const cl = (v: number, m: number) => Math.min(Math.max(v, 0), m - 1);
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) * fy0 - 0.5, y0 = Math.floor(sy), fy = sy - y0;
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) * fx0 - 0.5, x0 = Math.floor(sx), fx = sx - x0, o = (Y * W + X) * 4;
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
  return { w: W, h: H, c: 4, data };
}

/** Hard mask at OUTPUT res, from the coarse march alone: a coarse texel is hard when its 3x3
 *  neighbourhood mixes hit and miss (silhouette) or spans a linear-depth jump > DEPTH_EDGE_M (a limb
 *  in front of the torso), grown by DILATE texels; plus every pixel inside the grown head circle. */
/** Part-ID boundaries: a coarse texel whose 3x3 hit neighbours carry more than one hit slot sits on
 *  a material / part seam (skin-trousers, head-hat) that bilinear would stair-step. */
type Circle = { x: number; y: number; r: number };
function hardMask(lr: FloatImage, heads: Circle[], ids?: FloatImage, wounds: Circle[] = []): Uint8Array {
  const hardC = new Uint8Array(lr.w * lr.h);
  for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
    let anyHit = false, anyMiss = false, dMin = Infinity, dMax = -Infinity;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = Math.min(Math.max(x + i, 0), lr.w - 1), yy = Math.min(Math.max(y + j, 0), lr.h - 1), a = lr.data[(yy * lr.w + xx) * 4 + 3]!;
      if (a < 1) { anyHit = true; const d = linear(a); dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); } else anyMiss = true;
    }
    let seam = false;
    if (ids && anyHit) {
      let first = -1;
      for (let j = -1; j <= 1 && !seam; j++) for (let i = -1; i <= 1; i++) {
        const xx = Math.min(Math.max(x + i, 0), lr.w - 1), yy = Math.min(Math.max(y + j, 0), lr.h - 1), k = yy * lr.w + xx;
        if (lr.data[k * 4 + 3]! >= 1) continue;
        const slot = Math.round(ids.data[k * 4 + 2]!); // b = hitBest, the winning PRIM (r = gHitSlot is the body instance)
        if (first < 0) { first = slot; continue; }
        // A prim change only matters where the COLOUR changes too: skin-to-skin joins (shoulder,
        // elbow, chest bands) are invisible and would double the refine budget for nothing.
        if (slot !== first) {
          const c0 = (y * lr.w + x) * 4, t = (v: number) => v / (1 + v);
          let dc = 0;
          for (let c = 0; c < 3; c++) dc = Math.max(dc, Math.abs(t(lr.data[c0 + c]!) - t(lr.data[k * 4 + c]!)));
          if (dc > SEAM_COLOUR) { seam = true; break; }
        }
      }
    }
    if ((anyHit && anyMiss) || (anyHit && dMax - dMin > DEPTH_EDGE_M) || seam) hardC[y * lr.w + x] = 1;
  }
  const grown = new Uint8Array(lr.w * lr.h);
  for (let y = 0; y < lr.h; y++) for (let x = 0; x < lr.w; x++) {
    if (!hardC[y * lr.w + x]) continue;
    for (let j = -DILATE; j <= DILATE; j++) for (let i = -DILATE; i <= DILATE; i++) {
      const xx = x + i, yy = y + j;
      if (xx >= 0 && yy >= 0 && xx < lr.w && yy < lr.h) grown[yy * lr.w + xx] = 1;
    }
  }
  const out = new Uint8Array(W * H);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const x = Math.min(lr.w - 1, Math.floor(((X + 0.5) * lr.w) / W)), y = Math.min(lr.h - 1, Math.floor(((Y + 0.5) * lr.h) / H));
    let hard = grown[y * lr.w + x] === 1;
    for (const h of heads) if (Math.hypot(X + 0.5 - h.x, Y + 0.5 - h.y) <= h.r * FACE_GROW) hard = true;
    for (const w of wounds) if (Math.hypot(X + 0.5 - w.x, Y + 0.5 - w.y) <= w.r * WOUND_GROW) hard = true;
    out[Y * W + X] = hard ? 1 : 0;
  }
  return out;
}

function splice(soft: FloatImage, native: FloatImage, mask: Uint8Array): FloatImage {
  const data = new Float32Array(soft.data);
  for (let i = 0; i < W * H; i++) if (mask[i]) for (let c = 0; c < 4; c++) data[i * 4 + c] = native.data[i * 4 + c]!;
  return { w: W, h: H, c: 4, data };
}

const report: Record<string, unknown>[] = [];
for (const { tag } of probe.rows) {
  const gt = load(tag, 'gt', W, H);
  const native = load(tag, 'lr1off', W, H);
  const lr35 = load(tag, 'lr35off', 280, 210);
  const lr25 = load(tag, 'lr4off', 200, 150);
  const ann = JSON.parse(readFileSync(join(DIR, `${tag}-annotations.json`), 'utf8')) as { head: Circle | null; wounds: Circle[] }[];
  const heads = ann.map((a) => a.head).filter((h): h is Circle => !!h);
  // 'blast' circles span the whole scorch zone (~100 px at 0.9 m) — smooth discolouration that
  // interpolates fine; only the crater kinds carry sharp rims. SPLICE_BLAST=1 masks blasts too.
  const wounds = WOUND_GROW > 0 ? ann.flatMap((a) => (a.wounds ?? []) as (Circle & { type?: string })[]).filter((w) => process.env.SPLICE_BLAST === '1' || w.type !== 'blast') : [];
  const today = upscaleReference(load(tag, 'lr2off', 400, 300), model, 'sp', probe.near, probe.far, W, H);
  const m35 = hardMask(lr35, heads, USE_IDS ? load(tag, 'id35', 280, 210) : undefined, wounds), m25 = hardMask(lr25, heads, USE_IDS ? load(tag, 'id25', 200, 150) : undefined, wounds);
  const s35 = splice(bilinearTo(lr35), native, m35), s25 = splice(bilinearTo(lr25), native, m25);
  // INTERIOR CEILING: the 0.25 hybrid with every soft (non-red) pixel the refine pass accepted taken
  // from the refine (coarse geometry, full-res shading) instead of bilinear.
  const ref25 = load(tag, 'ref25', W, H);
  const s25r = { w: W, h: H, c: 4, data: new Float32Array(s25.data) } as FloatImage;
  let refUsed = 0;
  for (let i = 0; i < W * H; i++) if (!m25[i] && hit(s25, i) && ref25.data[i * 4 + 3]! < 1) { for (let c = 0; c < 3; c++) s25r.data[i * 4 + c] = ref25.data[i * 4 + c]!; refUsed++; }

  // Hard share of BODY pixels (native hits) = the refine's cost driver.
  let body = 0, h35 = 0, h25 = 0;
  // Only hard pixels ON the body cost a refine ray (a miss pixel in the mask costs a cheap miss).
  for (let i = 0; i < W * H; i++) { if (!hit(native, i)) continue; body++; if (m35[i]) h35++; if (m25[i]) h25++; }
  report.push({ tag, bodyPx: body, wounds: wounds.length, hardShare035: +(h35 / body).toFixed(3), hardShare025: +(h25 / body).toFixed(3), refinedInterior025: +(refUsed / body).toFixed(3) });

  // Mask view: the 0.25 splice with hard pixels tinted, so the owner sees WHERE the real rays went.
  const maskView = new Float32Array(s25.data);
  for (let i = 0; i < W * H; i++) if (m25[i]) { maskView[i * 4] = 1.5; maskView[i * 4 + 1] *= 0.4; maskView[i * 4 + 2] *= 0.4; maskView[i * 4 + 3] = 0.5; }

  const cols: FloatImage[] = [gt, today, s35, s25, s25r, { w: W, h: H, c: 4, data: maskView }];
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hit(gt, y * W + x)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 12;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  if (y1 - y0 > 300) y1 = y0 + 300;
  if (x1 - x0 > 300) { const cx = (x0 + x1) >> 1; x0 = cx - 150; x1 = cx + 150; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, Z = 2, gap = 4, SW = cols.length * (cw * Z + gap), SH = ch * Z;
  const px = new Uint8Array(SW * SH * 4).fill(40);
  cols.forEach((img, k) => {
    for (let y = 0; y < SH; y++) for (let x = 0; x < cw * Z; x++) {
      const s = ((y0 + Math.floor(y / Z)) * W + x0 + Math.floor(x / Z)) * 4, o = (y * SW + k * (cw * Z + gap) + x) * 4;
      const on = img.data[s + 3]! < 1;
      for (let c = 0; c < 3; c++) px[o + c] = on ? toneByte(img.data[s + c]!) : 0;
      px[o + 3] = 255;
    }
  });
  writeFileSync(join(DIR, `splice-${tag}.png`), writePng(SW, SH, px));
}
console.log('columns: truth 16x | TODAY 0.5+t16 | hybrid 0.35 | hybrid 0.25 | hybrid 0.25 + refined interior | real-ray pixels tinted red');
console.table(report);
writeFileSync(join(DIR, 'splice.json'), JSON.stringify(report, null, 2));
