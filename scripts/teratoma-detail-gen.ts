// scripts/teratoma-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/teratoma.detail: the teratoma's BAKED flesh detail (scripts/bake-body-normal.ts
// folds these lines into the body and bakes the difference into teratoma-body-n.png; nothing here is ever raymarched).
//
//   npx tsx scripts/teratoma-detail-gen.ts && npx tsx scripts/bake-body-normal.ts teratoma 512 256
//
// The template is scripts/twinhead-detail-gen.ts: every element is placed by probing the marched torso (sdBody along a
// ray toward a vertical axis through the ball's centre), sunk a fixed amount under the skin and bound to the pelvis
// (the ball's centre) with offset/tip. Edit the tables below and re-run; do not hand-edit the .detail.
//
// WHAT THE PLATE SHOWS: the hide is ROPED, heavy rounded folds lying across the crown and down the back and flanks like
// a brain's gyri or a walrus' neck, crowding round the brow and radiating from the mouth's corners; between them
// knotted veins and swollen nodules. So: folds first (thick, 2.2 cm, 8 mm proud: thinner ones vanish in the bake,
// the twinhead's vein lesson), then mouth-corner creases, then veins and knots.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/teratoma.blob'), 'utf8');
const doc = parseBlob(src);
const built = buildBody(compileBlob(doc, compileFace(doc)));
const body = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof built;
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;
const PELVIS = bones.get('pelvis')!.head;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fv = (v: V) => `(${v.map(f).join(',')})`;

/** The skin at height y, angle th (deg; 0 faces +z, +90 is the body's left, +x), and its outward normal. */
function skin(y: number, thDeg: number): { p: V; n: V } {
  const th = thDeg * Math.PI / 180;
  const dir: V = [Math.sin(th), 0, Math.cos(th)];
  const axis: V = [0, y, 0];
  let t = 1.0, p = add(axis, mul(dir, t));
  for (let i = 0; i < 400; i++) {
    const d = sdBody(p, body);
    if (d < 1e-4) break;
    t -= Math.max(d * 0.9, 2e-4);
    p = add(axis, mul(dir, t));
  }
  const e = 6e-4, d0 = sdBody(p, body);
  const n = norm([sdBody(add(p, [e, 0, 0]), body) - d0, sdBody(add(p, [0, e, 0]), body) - d0, sdBody(add(p, [0, 0, e]), body) - d0]);
  return { p, n };
}

const out: string[] = [];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);

/** A raised ridge along a chain of (y, deg) skin points: bars sunk so `proud` metres stand out. */
function ridge(pts: [number, number][], r: number, proud: number, blend: number) {
  const S = pts.map(([y, th]) => { const s = skin(y, th); return add(s.p, mul(s.n, proud - r)); });
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!, B = S[i + 1]!;
    const mid = mul(add(A, B), 0.5);
    const sm = skin(mid[1], Math.atan2(mid[0], mid[2]) * 180 / Math.PI);
    let bend = mul(sub(add(sm.p, mul(sm.n, proud - r)), mid), 2);
    if (len(bend) > 0.012) bend = mul(bend, 0.012 / len(bend));
    out.push(`  bar  torso on pelvis from=0 to=0 offset=${fv(sub(A, PELVIS))} tip=${fv(sub(B, A))} bend=${fv(bend)} r=${f(r)} blend=${f(blend)}`);
  }
}
/** A swelling at a skin point, sunk so `proud` metres stand out. */
function lump(y: number, th: number, r: number, proud: number, blend: number) {
  const s = skin(y, th), c = add(s.p, mul(s.n, proud - r));
  out.push(`  blob torso on pelvis at=0 offset=${fv(sub(c, PELVIS))} r=${f(r)} blend=${f(blend)}`);
}

let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Where the face is: the eye socket under the brow and the whole maw. No detail there (the kit eye, the teeth and
 *  the dark gullet own it; folds across the lips read as stitches). */
function onFace(y: number, th: number): boolean {
  const a = Math.abs(th);
  return (y < 1.71 && y > 1.50 && a < 34) || (y <= 1.50 && y > 0.98 && a < 58);
}
/** A fold: a wavy line of constant-ish height from th0 to th1, clipped wherever it crosses the face. */
function fold(y: number, th0: number, th1: number, r: number, proud: number, wave = 0.016) {
  const step = 9, n = Math.max(2, Math.round(Math.abs(th1 - th0) / step));
  const ph = rnd() * 6.28, freq = 0.06 + rnd() * 0.05;
  let run: [number, number][] = [];
  const flush = () => { if (run.length >= 2) ridge(run, r, proud, 0.007); run = []; };
  for (let i = 0; i <= n; i++) {
    const th = th0 + (th1 - th0) * (i / n);
    const yy = y + wave * Math.sin(ph + th * freq);
    if (onFace(yy, th)) { flush(); continue; }
    run.push([yy, th]);
  }
  flush();
}

out.push(
  '# GENERATED by scripts/teratoma-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts teratoma. These are .blob `body` lines folded into the body ONLY for',
  '# the bake (teratoma-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

section('crown folds: heavy ropes lying across the top, each broken and offset like gyri');
for (let k = 0; k < 7; k++) {
  const y = 1.66 + k * 0.042;
  // Two or three overlapping runs per height, staggered, so no fold rings the head like a hoop.
  for (let j = 0; j < 3; j++) {
    const a = -170 + j * 120 + rnd() * 50, span = 70 + rnd() * 70;
    fold(y + (rnd() - 0.5) * 0.02, a, a + span, 0.022, 0.008);
  }
}

section('brow folds: two ropes along the brow shelf, over the eye');
fold(1.80, -48, 48, 0.018, 0.007, 0.008);
fold(1.845, -40, 44, 0.016, 0.006, 0.010);

section('flank and back folds: slanting ropes down the sides and back, under the horns to the underbelly');
for (let k = 0; k < 16; k++) {
  const y = 1.06 + k * 0.038;
  const side = k % 2 ? 1 : -1;
  const a = side * (62 + rnd() * 25), span = side * (60 + rnd() * 80);
  fold(y, a, a + span, 0.020, 0.0075, 0.03);
}

section('mouth-corner creases: fans of folds radiating back from each corner of the grin');
for (const s of [1, -1]) {
  ridge([[1.36, s * 60], [1.41, s * 70], [1.47, s * 82]], 0.016, 0.0065, 0.006);
  ridge([[1.33, s * 62], [1.34, s * 75], [1.37, s * 90]], 0.015, 0.006, 0.006);
  ridge([[1.28, s * 61], [1.22, s * 72], [1.16, s * 84]], 0.016, 0.0065, 0.006);
  ridge([[1.24, s * 58], [1.15, s * 63], [1.07, s * 70]], 0.014, 0.006, 0.006);
}

section('veins: knotted serpentine trunks over the back and flanks, with branches');
function vein(y0: number, th0: number, y1: number, dth: number, r: number, proud: number, branches: number, depth = 0) {
  const n = Math.max(6, Math.round(Math.abs(y0 - y1) / 0.012));
  const pts: [number, number][] = [];
  let th = th0, phase = rnd() * 6.28;
  const amp = 3 + rnd() * 2;
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * (i / n), t = th + amp * Math.sin(phase);
    if (onFace(y, t)) break;
    pts.push([y, t]);
    phase += 0.7 + rnd() * 0.5;
    th += dth / n + (rnd() - 0.5) * 1.5;
  }
  if (pts.length < 2) return;
  ridge(pts, r, proud, 0.0016);
  for (let i = 1; i < pts.length - 1; i++)
    if (rnd() < 0.25) { const [y, t] = pts[i]!; lump(y, t, r * (1.6 + rnd() * 0.6), proud * 1.35, 0.002); }
  for (let b = 0; b < branches && depth < 1; b++) {
    const [y, t] = pts[1 + Math.floor(rnd() * Math.max(1, pts.length - 3))]!;
    vein(y, t, y - 0.07 - rnd() * 0.07, (rnd() < 0.5 ? -1 : 1) * (15 + rnd() * 15), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
for (const s of [1, -1]) {
  vein(1.80, s * 95, 1.20, s * 30, 0.0062, 0.0042, 2);    // from under the horn down the flank
  vein(1.72, s * 140, 1.08, -s * 20, 0.0060, 0.0040, 2);  // down the back
  vein(1.62, s * 70, 1.30, s * 25, 0.0050, 0.0035, 1);    // behind the cheek
}

section('nodules: clustered swellings, the growths under the skin');
for (let i = 0; i < 26; i++) {
  const y = 1.05 + rnd() * 0.85, th = -180 + rnd() * 360;
  if (onFace(y, th)) continue;
  const r = 0.012 + rnd() * 0.02;
  lump(y, th, r, r * 0.5, 0.005);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/teratoma.detail'), out.join('\n') + '\n');
console.log(`teratoma-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
