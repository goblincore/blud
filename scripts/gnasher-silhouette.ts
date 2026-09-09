// scripts/gnasher-silhouette.ts
// CPU SDF silhouette renderer — a Chrome-free substitute for the turntable
// when the lab's headless Chrome cannot launch (sandbox blocks its per-user
// temp/singleton dirs). Renders an occupancy/depth image of a .blob body on a
// chosen plane using the same `sdBody` CPU field the pins use, so what is
// drawn is exactly the geometry the tests measure.
//
// Usage:
//   npx tsx scripts/gnasher-silhouette.ts <limb?> <view> <out.ppm> [N]
//     limb  : 'all' (default) | 'armL' | 'armR' | 'legL' | 'torso' | 'head'
//     view  : 'side' (Y-Z, project over X) | 'front' (X-Y, project over Z) | 'top' (X-Z, project over Y)
//     out   : output path (PPM P6)
//     N     : pixels per axis (default 200)
//
// Reads src/lab/sdf-zombie/characters/gnasher.blob.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const here = (...p: string[]) => resolve(__dirname, '..', ...p);

const LIMB = process.argv[2] ?? 'all';
const VIEW = process.argv[3] ?? 'side';
const OUT = process.argv[4] ?? '/tmp/gnasher-sil.png';
const N = Number(process.argv[5] ?? 200);

const src = readFileSync(here('src/lab/sdf-zombie/characters/gnasher.blob'), 'utf8');
const doc = parseBlob(src);
const built = buildBody(compileBlob(doc, compileFace(doc)));
if (built.errors.length) {
  console.error('BUILD ERRORS:', built.errors);
  process.exit(1);
}

// Field restriction: sdBody takes { prims, clusters }. To render one limb we
// build a body whose sole cluster wraps that limb's prim slice (start 0).
let prims = built.prims;
let clusters = built.clusters;
if (LIMB !== 'all') {
  const c = built.clusters.find((x) => x.limb === LIMB);
  if (!c) { console.error(`no cluster ${LIMB}`); process.exit(1); }
  const slice = built.prims.slice(c.start, c.start + c.count);
  prims = slice;
  clusters = [{ ...c, start: 0, count: slice.length }];
}

// World bounds of the (possibly restricted) prims.
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const p of prims) if (!p.dead && p.op !== 'sub') {
  for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
    mn[i] = Math.min(mn[i], e[i] - p.radius * p.scale[i]);
    mx[i] = Math.max(mx[i], e[i] + p.radius * p.scale[i]);
  }
}
console.log(`limb=${LIMB} view=${VIEW} bounds mn=${mn.map(v=>v.toFixed(3))} mx=${mx.map(v=>v.toFixed(3))}`);

// A little padding so the silhouette does not sit on the image border.
const PAD = 0.05;
for (let i = 0; i < 3; i++) { mn[i] -= PAD; mx[i] += PAD; }

// Axis mapping: [u, v, proj] where `proj` is the axis we sample across and
// `u`/`v` are the image axes.
const AXIS = {
  side:  { u: 2, v: 1, proj: 0 }, // Y-Z plane, project over X
  front: { u: 0, v: 1, proj: 2 }, // X-Y plane, project over Z
  top:   { u: 0, v: 2, proj: 1 }, // X-Z plane, project over Y
}[VIEW];
if (!AXIS) { console.error('view must be side|front|top'); process.exit(1); }

const W = N, H = Math.round(N * (mx[AXIS.v] - mn[AXIS.v]) / (mx[AXIS.u] - mn[AXIS.u]));
const PROJ_LO = mn[AXIS.proj], PROJ_HI = mx[AXIS.proj];
const PROJ_STEPS = 40;

const px = Buffer.alloc(W * H * 3);
for (let r = 0; r < H; r++) {
  const v = mn[AXIS.v] + (H - 1 - r) / (H - 1) * (mx[AXIS.v] - mn[AXIS.v]);
  for (let c = 0; c < W; c++) {
    const u = mn[AXIS.u] + c / (W - 1) * (mx[AXIS.u] - mn[AXIS.u]);
    // min signed distance across the projection axis -> skeleton of the solid
    let best = Infinity;
    for (let s = 0; s <= PROJ_STEPS; s++) {
      const q = PROJ_LO + s / PROJ_STEPS * (PROJ_HI - PROJ_LO);
      const p: [number, number, number] = [u, 0, 0];
      p[AXIS.u] = u; p[AXIS.v] = v; p[AXIS.proj] = q;
      const d = sdBody(p, { prims, clusters });
      if (d < best) best = d;
    }
    // crisp silhouette: solid white where the body exists, else black
    const solid = Math.min(1, Math.max(0, -best * 5)); // -best>=0 inside, fade at surface
    const val = best <= 0 ? 0.55 + 0.45 * solid : Math.max(0, (0.5 - best) * 2);
    const out = Math.floor(Math.min(1, val) * 255);
    const i = (r * W + c) * 3;
    px[i] = out; px[i + 1] = out; px[i + 2] = out;
  }
}

// Minimal PNG encoder (8-bit RGB, color type 2). No dependencies so the
// renderer survives the sandbox that blocks sips' per-user temp scratch.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(path: string, w: number, h: number, rgb: Buffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, colour type 2 (truecolour)
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let r = 0; r < h; r++) {
    raw[r * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, r * (1 + w * 3) + 1, r * w * 3, (r + 1) * w * 3);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

writePng(OUT, W, H, px);
console.log(`wrote ${W}x${H} -> ${OUT}`);
