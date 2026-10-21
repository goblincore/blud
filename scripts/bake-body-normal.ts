// scripts/bake-body-normal.ts
//
// Bake a character's BODY NORMAL MAP (spec docs/superpowers/specs/2026-10-21-body-normal-map-design.md):
//
//   npx tsx scripts/bake-body-normal.ts <character> [width] [height]
//     reads  src/lab/sdf-zombie/characters/<character>.blob
//            src/lab/sdf-zombie/characters/<character>.detail   (extra `body` lines, never marched)
//     writes public/assets/lab/<character>-body-n.png            (tangent-space normals)
//            public/assets/lab/<character>-body-n.json           (the projection: band, axis, size)
//
// WHAT IT BAKES. Two versions of the torso in its REST pose: the body the game marches, and the same body
// with the .detail lines folded in (muscle separations, veins, fibres, swellings: detail that would cost a
// prim per pixel to march but is only ever seen as shading). Per texel the script finds the marched torso's
// skin along a ray toward the projection axis, finds the detailed torso's skin along the same ray, and stores
// the detailed surface's normal in the plain surface's tangent frame. The runtime
// (march/body/blocks/post/body-normal.wgsl.ts) rebuilds that frame at every hit and bends the shading normal
// by it, so the marched body takes on the detailed body's relief without its cost.
//
// THE FRAME, which the shader must agree with exactly: u = atan2(x - axisX, z - axisZ) / 2pi + 0.5 (0.5 faces
// +z), v = (y - yMin) / (yMax - yMin), image row 0 = v 1 (yMax). Tangent = (cos th, 0, -sin th) round the axis,
// bitangent = n x tangent (rest +y on an upright wall), normal = the plain surface normal. rgb = (t, b, n) mapped
// from -1..1 to 0..255.
//
// ONLY THE TORSO: every other cluster is switched off for both marches, so an arm hanging in front of the chest
// cannot be baked into it (the runtime likewise applies the map only to hits on torso prims).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
// @ts-expect-error -- a plain .mjs helper with no types
import { writePng } from './lib/png-write.mjs';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, wArg, hArg] = process.argv.slice(2);
if (!name) { console.error('usage: bake-body-normal.ts <character> [width] [height]'); process.exit(2); }
const W = Number(wArg ?? 512), H = Number(hArg ?? 256);
const CH = resolve(ROOT, 'src/lab/sdf-zombie/characters');
const blobSrc = readFileSync(resolve(CH, `${name}.blob`), 'utf8');
const detailPath = resolve(CH, `${name}.detail`);
if (!existsSync(detailPath)) { console.error(`no ${name}.detail beside the .blob`); process.exit(2); }
const detailSrc = readFileSync(detailPath, 'utf8');

/** Fold the detail lines into the .blob's `body` block (at its end, before the next top-level block). */
function withDetail(src: string, detail: string): string {
  const lines = src.split('\n');
  const start = lines.findIndex(l => /^body\s*$/.test(l));
  if (start < 0) throw new Error(`${name}.blob has no body block`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^\S/.test(lines[i]!) && !lines[i]!.startsWith('#')) { end = i; break; }
  const extra = detail.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  return [...lines.slice(0, end), ...extra, ...lines.slice(end)].join('\n');
}

function torsoOnly(src: string) {
  const doc = parseBlob(src);
  const b = buildBody(compileBlob(doc, compileFace(doc)));
  return { ...b, clusters: b.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof b;
}
const base = torsoOnly(blobSrc);
const detail = torsoOnly(withDetail(blobSrc, detailSrc));

// The projection: a vertical axis through the torso, the band its prims span.
const torso = base.prims.filter(p => p.limb === 'torso' && p.op !== 'sub' && p.op !== 'groove');
let yMin = Infinity, yMax = -Infinity, zSum = 0, xSum = 0;
for (const p of torso) {
  const ry = p.radius * p.scale[1];
  yMin = Math.min(yMin, p.a[1] - ry, p.b[1] - ry);
  yMax = Math.max(yMax, p.a[1] + ry, p.b[1] + ry);
  zSum += (p.a[2] + p.b[2]) / 2; xSum += (p.a[0] + p.b[0]) / 2;
}
const axisX = xSum / torso.length, axisZ = zSum / torso.length;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => mul(a, 1 / Math.hypot(...a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** First skin along the ray from 0.9 m out toward the axis, or null. */
function skin(body: typeof base, y: number, dir: V): V | null {
  const axis: V = [axisX, y, axisZ];
  let t = 0.9;
  for (let i = 0; i < 300 && t > 0; i++) {
    const p = add(axis, mul(dir, t));
    const d = sdBody(p, body);
    if (d < 1e-4) return p;
    t -= Math.max(d * 0.9, 2e-4);
  }
  return null;
}
function grad(body: typeof base, p: V): V {
  const e = 6e-4;
  return norm([
    sdBody(add(p, [e, 0, 0]), body) - sdBody(add(p, [-e, 0, 0]), body),
    sdBody(add(p, [0, e, 0]), body) - sdBody(add(p, [0, -e, 0]), body),
    sdBody(add(p, [0, 0, e]), body) - sdBody(add(p, [0, 0, -e]), body),
  ]);
}

const rgba = new Uint8Array(W * H * 4);
const enc = (x: number) => Math.max(0, Math.min(255, Math.round((x * 0.5 + 0.5) * 255)));
let covered = 0, maxTilt = 0;
const t0 = Date.now();
for (let row = 0; row < H; row++) {
  const v = 1 - (row + 0.5) / H;
  const y = yMin + v * (yMax - yMin);
  for (let col = 0; col < W; col++) {
    const u = (col + 0.5) / W;
    const th = (u - 0.5) * 2 * Math.PI;
    const dir: V = [Math.sin(th), 0, Math.cos(th)];
    const o = (row * W + col) * 4;
    rgba[o] = 128; rgba[o + 1] = 128; rgba[o + 2] = 255; rgba[o + 3] = 255;
    const pb = skin(base, y, dir);
    if (!pb) continue;
    const pd = skin(detail, y, dir) ?? pb;
    const nb = grad(base, pb), nd = grad(detail, pd);
    const tRaw: V = [Math.cos(th), 0, -Math.sin(th)];
    const T = norm(add(tRaw, mul(nb, -dot(tRaw, nb))));
    const B = cross(nb, T);
    const tn = dot(nd, T), bn = dot(nd, B), nn = Math.max(dot(nd, nb), 0.05);
    rgba[o] = enc(tn); rgba[o + 1] = enc(bn); rgba[o + 2] = enc(nn);
    covered++;
    maxTilt = Math.max(maxTilt, Math.hypot(tn, bn));
  }
}
const png = resolve(ROOT, `public/assets/lab/${name}-body-n.png`);
writeFileSync(png, writePng(W, H, rgba));
const meta = {
  generator: 'scripts/bake-body-normal.ts', character: name, width: W, height: H,
  yMin: +yMin.toFixed(4), yMax: +yMax.toFixed(4), axisX: +axisX.toFixed(4), axisZ: +axisZ.toFixed(4),
};
writeFileSync(resolve(ROOT, `public/assets/lab/${name}-body-n.json`), JSON.stringify(meta, null, 2) + '\n');
console.log(`bake-body-normal: ${name} ${W}x${H}, ${(100 * covered / (W * H)).toFixed(1)}% of texels on skin, ` +
  `max tilt ${maxTilt.toFixed(3)}, band y ${meta.yMin}..${meta.yMax}, axis (${meta.axisX}, ${meta.axisZ}), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
