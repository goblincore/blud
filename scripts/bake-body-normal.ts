// scripts/bake-body-normal.ts
//
// Bake a character's BODY NORMAL MAP (spec docs/superpowers/specs/2026-10-21-body-normal-map-design.md):
//
//   npx tsx scripts/bake-body-normal.ts <character> [width] [torsoRows] [--limb bone:t0:t1:rMax:rows ...]
//     reads  src/lab/sdf-zombie/characters/<character>.blob
//            src/lab/sdf-zombie/characters/<character>.detail   (extra `body` lines, never marched)
//     writes public/assets/lab/<character>-body-n.png            (an atlas of tangent-space normals)
//            public/assets/lab/<character>-body-n.json           (the regions, for people and the loader)
//
// e.g. the twinhead:  npx tsx scripts/bake-body-normal.ts twinhead 512 256 \
//   --limb upperarm.l:0:1:0.17:96 --limb forearm.l:0:0.5:0.13:48 --limb upperarm.r:0:1:0.17:96 --limb forearm.r:0:0.5:0.13:48
//
// WHAT IT BAKES. Two versions of the body in its REST pose: the body the game marches, and the same body with the
// .detail lines folded in (muscle separations, veins, swellings: detail that would cost a prim per pixel to march
// but is only ever seen as shading). Per texel it finds the plain skin along a ray toward the region's axis, the
// detailed skin along the same ray, and stores the detailed normal in the plain surface's tangent frame. The
// runtime (march/body/blocks/post/body-normal.wgsl.ts) rebuilds that frame at every hit and bends the shading
// normal by it.
//
// REGIONS. Each region is a cylinder round a REST-space segment head -> tail, baked into its own band of rows:
//   - region 0, the TORSO: a vertical segment through the torso's mean x/z from the top of its prims (head) to
//     the bottom (tail); only the torso cluster is marched, and at runtime only torso-prim hits take it;
//   - a LIMB region per `--limb bone:t0:t1:rMax:rows`: the bone's segment from t0 to t1, its own limb cluster only,
//     taken at runtime by non-torso hits whose rest point lies along the segment within rMax of it.
//
// THE FRAME, which the shader must agree with exactly. axis A = normalize(tail - head); f = rest +z made
// perpendicular to A; s = f x A. A point's t = its fraction along head -> tail, its angle th = atan2(r.s, r.f) for
// the radial r; u = th / 2pi + 0.5 (0.5 faces +z), and the band's row = row0 + t * rows (row0 = the head end).
// Tangent = s cos th - f sin th (round the axis), bitangent = n x tangent (toward the head), normal = the plain
// surface normal; rgb = (t, b, n) mapped from -1..1. For the torso (A = -y) this is exactly the original
// projection: u = atan2(x - axisX, z - axisZ), v = 1 - t.
//
// THE HEADER. Row 0 of the image is the region table, read by the shader: texel 0 = ('B', 'N', 2, count); region
// i is texels 1 + 5i .. 5 + 5i holding pairs of 16-bit values (r,g = hi,lo of the first; b,a of the second):
// [head.x, head.y] [head.z, tail.x] [tail.y, tail.z] [rMax, row0] [rows, kind]. Positions and rMax are mapped from
// -2.5..2.5 m; row0, rows and kind (0 torso, 1 limb) are plain integers. PNG keeps the bytes exact.
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
const argv = process.argv.slice(2);
const limbArgs: string[] = [];
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--limb') limbArgs.push(argv[++i]!); else pos.push(argv[i]!);
}
const [name, wArg, hArg] = pos;
if (!name) { console.error('usage: bake-body-normal.ts <character> [width] [torsoRows] [--limb bone:t0:t1:rMax:rows ...]'); process.exit(2); }
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
function build(src: string) { const doc = parseBlob(src); return buildBody(compileBlob(doc, compileFace(doc))); }
type Body = ReturnType<typeof build>;
type Prim = Body['prims'][number];
const base = build(blobSrc);
const detail = build(withDetail(blobSrc, detailSrc));
const bones = base.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => mul(a, 1 / Math.hypot(...a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

interface Region { label: string; limb: string; head: V; tail: V; rMax: number; rows: number; kind: 0 | 1; r0: number; row0: number }
const regions: Region[] = [];

// Region 0: the torso, a vertical axis through it, the band its prims span.
{
  const torso = base.prims.filter(p => p.limb === 'torso' && p.op !== 'sub' && p.op !== 'groove');
  let yMin = Infinity, yMax = -Infinity, zSum = 0, xSum = 0;
  for (const p of torso) {
    const ry = p.radius * p.scale[1];
    yMin = Math.min(yMin, p.a[1] - ry, p.b[1] - ry);
    yMax = Math.max(yMax, p.a[1] + ry, p.b[1] + ry);
    zSum += (p.a[2] + p.b[2]) / 2; xSum += (p.a[0] + p.b[0]) / 2;
  }
  const ax = xSum / torso.length, az = zSum / torso.length;
  regions.push({ label: 'torso', limb: 'torso', head: [ax, yMax, az], tail: [ax, yMin, az], rMax: 0, rows: H, kind: 0, r0: 0.6, row0: 0 });
}
for (const arg of limbArgs) {
  const [bone, t0, t1, rMax, rows] = arg.split(':');
  const b = bones.get(bone!);
  if (!b) { console.error(`--limb ${arg}: no bone ${bone}`); process.exit(2); }
  const limb = base.prims.find(p => p.bone === bone)?.limb;
  if (!limb) { console.error(`--limb ${arg}: no prims on ${bone}`); process.exit(2); }
  const d = sub(b.tail, b.head);
  regions.push({ label: bone!, limb, head: add(b.head, mul(d, Number(t0))), tail: add(b.head, mul(d, Number(t1))), rMax: Number(rMax), rows: Number(rows), kind: 1, r0: Number(rMax) * 1.5, row0: 0 });
}
let nextRow = 1;   // row 0 is the header
for (const r of regions) { r.row0 = nextRow; nextRow += r.rows; }
const TH = nextRow;

/** A body of only the prims of `limb` that can reach the ray disc at P (radius r0): one row's march is much cheaper. */
function nearBody(body: Body, limb: string, P: V, r0: number): Body {
  const keep: Prim[] = [];
  for (const c of body.clusters) {
    if (c.limb !== limb) continue;
    for (const p of body.prims.slice(c.start, c.start + c.count)) {
      const ab = sub(p.b, p.a), L2 = dot(ab, ab);
      const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(P, p.a), ab) / L2)) : 0;
      const q = add(p.a, mul(ab, t));
      const reach = Math.max(p.radius, p.radiusB ?? 0) * Math.max(...p.scale) + (p.blendK ?? 0) * 4 + 0.03;
      if (Math.hypot(...sub(P, q)) - reach < r0) keep.push(p);
    }
  }
  return { ...body, split: undefined, prims: keep, clusters: [{ ...body.clusters[0]!, limb, start: 0, count: keep.length, alive: true }] } as Body;
}
/** First skin along the ray from r0 out toward the axis point P, or null. */
function skin(body: Body, P: V, dir: V, r0: number): V | null {
  let t = r0;
  for (let i = 0; i < 300 && t > 0; i++) {
    const p = add(P, mul(dir, t));
    const d = sdBody(p, body);
    if (d < 1e-4) return p;
    t -= Math.max(d * 0.9, 2e-4);
  }
  return null;
}
function grad(body: Body, p: V): V {
  const e = 6e-4;
  return norm([
    sdBody(add(p, [e, 0, 0]), body) - sdBody(add(p, [-e, 0, 0]), body),
    sdBody(add(p, [0, e, 0]), body) - sdBody(add(p, [0, -e, 0]), body),
    sdBody(add(p, [0, 0, e]), body) - sdBody(add(p, [0, 0, -e]), body),
  ]);
}

const rgba = new Uint8Array(W * TH * 4);
const enc = (x: number) => Math.max(0, Math.min(255, Math.round((x * 0.5 + 0.5) * 255)));
const t0 = Date.now();
const stats: string[] = [];
for (const R of regions) {
  const A = norm(sub(R.tail, R.head));
  const f = norm(sub([0, 0, 1], mul(A, A[2])));
  const s = cross(f, A);
  let covered = 0;
  for (let row = 0; row < R.rows; row++) {
    const P = add(R.head, mul(sub(R.tail, R.head), (row + 0.5) / R.rows));
    const nb0 = nearBody(base, R.limb, P, R.r0), nd0 = nearBody(detail, R.limb, P, R.r0);
    for (let col = 0; col < W; col++) {
      const th = ((col + 0.5) / W - 0.5) * 2 * Math.PI;
      const dir = norm(add(mul(f, Math.cos(th)), mul(s, Math.sin(th))));
      const o = ((R.row0 + row) * W + col) * 4;
      rgba[o] = 128; rgba[o + 1] = 128; rgba[o + 2] = 255; rgba[o + 3] = 255;
      const pb = skin(nb0, P, dir, R.r0);
      if (!pb) continue;
      const pd = skin(nd0, P, dir, R.r0) ?? pb;
      const nb = grad(nb0, pb), nd = grad(nd0, pd);
      const tRaw = sub(mul(s, Math.cos(th)), mul(f, Math.sin(th)));
      const T = norm(add(tRaw, mul(nb, -dot(tRaw, nb))));
      const B = cross(nb, T);
      rgba[o] = enc(dot(nd, T)); rgba[o + 1] = enc(dot(nd, B)); rgba[o + 2] = enc(Math.max(dot(nd, nb), 0.05));
      covered++;
    }
  }
  stats.push(`${R.label} ${(100 * covered / (W * R.rows)).toFixed(0)}%`);
  console.log(`  ${R.label}: rows ${R.row0}..${R.row0 + R.rows - 1}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// The header row: the region table (see THE HEADER above).
const q16 = (x: number) => Math.max(0, Math.min(65535, Math.round((x + 2.5) / 5 * 65535)));
const put = (texel: number, a: number, b: number) => {
  const o = texel * 4;
  rgba[o] = a >> 8; rgba[o + 1] = a & 255; rgba[o + 2] = b >> 8; rgba[o + 3] = b & 255;
};
rgba.fill(0, 0, W * 4);
rgba[0] = 66; rgba[1] = 78; rgba[2] = 2; rgba[3] = regions.length;
if (1 + 5 * regions.length > W) throw new Error('too many regions for the header row');
regions.forEach((R, i) => {
  const b = 1 + 5 * i;
  put(b, q16(R.head[0]), q16(R.head[1]));
  put(b + 1, q16(R.head[2]), q16(R.tail[0]));
  put(b + 2, q16(R.tail[1]), q16(R.tail[2]));
  put(b + 3, q16(R.rMax), R.row0);
  put(b + 4, R.rows, R.kind);
});

const png = resolve(ROOT, `public/assets/lab/${name}-body-n.png`);
writeFileSync(png, writePng(W, TH, rgba));
const r4 = (v: V) => v.map(x => +x.toFixed(4));
const torso = regions[0]!;
const meta = {
  generator: 'scripts/bake-body-normal.ts', character: name, width: W, height: TH, version: 2,
  yMin: +torso.tail[1].toFixed(4), yMax: +torso.head[1].toFixed(4), axisX: +torso.head[0].toFixed(4), axisZ: +torso.head[2].toFixed(4),
  regions: regions.map(R => ({ label: R.label, kind: R.kind ? 'limb' : 'torso', head: r4(R.head), tail: r4(R.tail), rMax: R.rMax, row0: R.row0, rows: R.rows })),
};
writeFileSync(resolve(ROOT, `public/assets/lab/${name}-body-n.json`), JSON.stringify(meta, null, 2) + '\n');
console.log(`bake-body-normal: ${name} ${W}x${TH}, ${regions.length} regions (${stats.join(', ')}), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
