// scripts/twinhead-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/twinhead.detail: the twinhead's BAKED muscle and surface detail
// (scripts/bake-body-normal.ts folds these lines into the body and bakes the difference into
// twinhead-body-n.png; nothing here is ever raymarched, so detail is free at runtime).
//
//   npx tsx scripts/twinhead-detail-gen.ts && npx tsx scripts/bake-body-normal.ts twinhead 512 256 \
//     --limb upperarm.l:0:1:0.17:96 --limb forearm.l:0:0.5:0.13:48 --limb upperarm.r:0:1:0.17:96 --limb forearm.r:0:0.5:0.13:48
//   (about 15 min, nearly all of it the torso; the arm regions take seconds)
//
// WHY GENERATED. Detail has to sit ON the skin: a ridge 2 mm proud reads, one 6 mm under it does nothing and
// one 6 mm out floats. So every element is placed by probing the marched torso (sdBody along a ray toward the
// torso axis, the same probe the bake uses), then sunk by a fixed amount under the skin and bound to the
// nearest spine bone with offset/tip, as the scar welts in twinhead.blob are. Edit the tables below and
// re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/twinhead.blob'), 'utf8');
const doc = parseBlob(src);
const built = buildBody(compileBlob(doc, compileFace(doc)));
const body = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'torso' })) } as typeof built;
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fv = (v: V) => `(${v.map(f).join(',')})`;
const AXIS_Z = 0.06;

/** The skin at height y, angle th (deg; 0 faces +z, +90 is the body's left, +x), and its outward normal. */
function skin(y: number, thDeg: number): { p: V; n: V } {
  const th = thDeg * Math.PI / 180;
  const dir: V = [Math.sin(th), 0, Math.cos(th)];
  const axis: V = [0, y, AXIS_Z];
  let t = 0.9, p = add(axis, mul(dir, t));
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
function boneFor(y: number) { return y < 1.337 ? 'spine1' : y < 1.625 ? 'chest' : 'spine2'; }
function boneAt(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, ((p[0] - head[0]) * d[0] + (p[1] - head[1]) * d[1] + (p[2] - head[2]) * d[2]) / (len(d) ** 2)));
  return { t, at: add(head, mul(d, t)) };
}

const out: string[] = [];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);

/** A raised ridge along a chain of (y, deg) skin points: bars sunk so `proud` metres stand out. */
function ridge(pts: [number, number][], r: number, proud: number, blend: number, r2?: number) {
  const S = pts.map(([y, th]) => { const s = skin(y, th); return add(s.p, mul(s.n, proud - r)); });
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!, B = S[i + 1]!;
    const mid = mul(add(A, B), 0.5);
    const sm = skin(mid[1], Math.atan2(mid[0], mid[2] - AXIS_Z) * 180 / Math.PI);
    let bend = mul(sub(add(sm.p, mul(sm.n, proud - r)), mid), 2);
    if (len(bend) > 0.008) bend = mul(bend, 0.008 / len(bend));
    const b = boneFor((A[1] + B[1]) / 2), { t, at } = boneAt(b, A);
    out.push(`  bar  torso on ${b} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} bend=${fv(bend)} r=${f(r)}${r2 ? ` r2=${f(r2)}` : ''} blend=${f(blend)}`);
  }
}
/** A swelling at a skin point: an ellipsoid sunk so `proud` metres stand out. `depth` is its semi-axis along
 *  the skin normal (r x deep for a flattened lump): sinking by r alone buried the flattened abs entirely. */
function lump(y: number, th: number, r: number, proud: number, blend: number, scale = '', depth = r) {
  const s = skin(y, th), c = add(s.p, mul(s.n, proud - depth));
  const b = boneFor(y), { t, at } = boneAt(b, c);
  out.push(`  blob torso on ${b} at=${f(t)} offset=${fv(sub(c, at))} r=${f(r)}${scale} blend=${f(blend)}`);
}

out.push(
  '# GENERATED by scripts/twinhead-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts twinhead. These are .blob `body` lines folded into the body ONLY for',
  '# the bake (twinhead-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

section('abs: an 8-pack, a deep linea alba between the columns, tendinous creases between the rows');
for (const [y, w] of [[1.165, 0.040], [1.225, 0.042], [1.285, 0.043], [1.345, 0.043]] as const)
  for (const s of [1, -1]) lump(y, s * 13, w, 0.007, 0.003, ' wide=1.05 tall=0.62 deep=0.50', w * 0.5);

section('external obliques: a long swell down each flank into the waist');
for (const s of [1, -1]) ridge([[1.40, s * 52], [1.30, s * 50], [1.20, s * 42], [1.13, s * 32]], 0.032, 0.006, 0.010);

section('serratus: four fingers per side under the armpit, interlocking the obliques');
for (const s of [1, -1]) for (const [y, th] of [[1.50, 64], [1.455, 61], [1.41, 58], [1.365, 56]] as const)
  ridge([[y + 0.01, s * (th + 10)], [y - 0.012, s * (th - 6)]], 0.012, 0.004, 0.003);

section('ribs: four arcs showing through the flank between the serratus and the lats');
for (const s of [1, -1]) for (const y of [1.50, 1.455, 1.41, 1.365])
  ridge([[y, s * 72], [y - 0.008, s * 92], [y - 0.022, s * 112]], 0.006, 0.002, 0.002);

// No pec fibres and no sternum ridges: a fan of striations across each pec and two ridges down the sternum
// read as bandage stripes and a seam (owner, first in-lab look 2026-10-21). The pecs' own marched masses already
// make the sternum valley and the underline.
section('nipples: an areola disc and a nipple on each pec, low and outboard of its centre');
for (const s of [1, -1]) {
  lump(1.535, s * 21, 0.017, 0.0015, 0.004, ' deep=0.30', 0.017 * 0.30);
  lump(1.535, s * 21, 0.0055, 0.0042, 0.002);
}

section('back: spinal erectors either side of a deep spinal groove, and the shoulder-blade ridges');
for (const s of [1, -1]) ridge([[1.16, s * 168], [1.30, s * 167], [1.44, s * 168], [1.56, s * 170]], 0.030, 0.008, 0.008);
for (const s of [1, -1]) ridge([[1.66, s * 148], [1.60, s * 140], [1.52, s * 134]], 0.012, 0.004, 0.004);

// Varicose veins (owner: "varicose veins prominently"): thick, tortuous, knotted. The first thin meandering
// veins (r 3.5 mm, 1.6 mm proud) did not read in the bake. Each trunk is a seeded serpentine walk down the skin,
// thick and well proud, with bulging knots along it and a couple of branches peeling off.
section('varicose veins: thick serpentine trunks with knots and branches');
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function varicose(y0: number, th0: number, y1: number, dth: number, r: number, proud: number, branches: number, depth = 0) {
  // A smooth meander sampled densely: alternating sides per sample (the first pass) baked as sharp zigzags.
  const n = Math.max(6, Math.round((y0 - y1) / 0.011));
  const pts: [number, number][] = [];
  let th = th0, phase = rnd() * 6.28;
  const amp = (4 + rnd() * 2) * (r / 0.006);
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * (i / n);
    pts.push([y, th + amp * Math.sin(phase)]);
    phase += 0.75 + rnd() * 0.5;
    th += dth / n + (rnd() - 0.5) * 1.2;
  }
  ridge(pts, r, proud, 0.0016);
  for (let i = 1; i < pts.length - 1; i++)   // knots: bulges every other bend
    if (rnd() < 0.22) { const [y, t] = pts[i]!; lump(y, t, r * (1.5 + rnd() * 0.6), proud * 1.35, 0.002); }
  for (let b = 0; b < branches; b++) {
    const [y, t] = pts[1 + Math.floor(rnd() * (pts.length - 3))]!;
    const side = rnd() < 0.5 ? -1 : 1;
    if (depth < 1) varicose(y, t, y - 0.06 - rnd() * 0.06, side * (14 + rnd() * 12), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
for (const s of [1, -1]) {
  varicose(1.50, s * 68, 1.16, -s * 14, 0.0062, 0.0042, 2);   // down the flank, toward the waist
  varicose(1.44, s * 38, 1.18, s * 6, 0.0055, 0.0038, 2);    // over the belly, outboard of the abs
  varicose(1.62, s * 48, 1.50, s * 10, 0.0048, 0.0032, 1);   // across the upper chest toward the armpit
  varicose(1.58, s * 140, 1.20, s * 8, 0.0060, 0.0040, 2);   // over the lats on the back
}

section('agitated flesh: clustered swellings round the cup seam and the chest scar');
const LUMPS: [number, number, number][] = [
  [1.20, 20, 0.010], [1.205, 34, 0.008], [1.19, -18, 0.011], [1.21, -40, 0.007], [1.195, 60, 0.009],
  [1.20, -75, 0.008], [1.20, 150, 0.010], [1.205, -160, 0.009], [1.215, 95, 0.007], [1.21, -110, 0.008],
  [1.58, 30, 0.006], [1.55, 20, 0.007], [1.52, 25, 0.005], [1.61, 40, 0.005], [1.50, 16, 0.006],
];
for (const [y, th, r] of LUMPS) lump(y, th, r, r * 0.55, 0.004);

// ---------------------------------------------------------------- arms
// The arms have their own normal-map regions (a cylinder round each bone; bake-body-normal.ts). Their detail is
// placed on the ARM skin (the arm clusters alone) and bound to the arm bone it lies on, one side at a time.
const armBody = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'armL' || c.limb === 'armR' })) } as typeof built;
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Arm skin round bone `b` at fraction t and angle ph (deg; 0 = the bone frame's front, +90 = outward). */
function armSkin(b: string, t: number, ph: number): { p: V; n: V } {
  const { head, tail } = bones.get(b)!;
  const u = norm(sub(tail, head));
  const fw = norm(sub([0, 0, 1], mul(u, u[2])));
  const s = cross(fw, u);                     // the bake's frame: s = f x axis
  const out = b.endsWith('.r') ? -1 : 1;      // s points +x; outward is +x on .l, -x on .r
  const a = ph * Math.PI / 180;
  const dir = norm(add(mul(fw, Math.cos(a)), mul(s, out * Math.sin(a))));
  const axis = add(head, mul(sub(tail, head), t));
  let r = 0.3, p = add(axis, mul(dir, r));
  for (let i = 0; i < 300; i++) {
    const d = sdBody(p, armBody);
    if (Math.abs(d) < 1e-4) break;
    r -= Math.max(Math.abs(d) * 0.9, 2e-4) * Math.sign(d);
    p = add(axis, mul(dir, r));
  }
  const e = 6e-4, d0 = sdBody(p, armBody);
  const n = norm([sdBody(add(p, [e, 0, 0]), armBody) - d0, sdBody(add(p, [0, e, 0]), armBody) - d0, sdBody(add(p, [0, 0, e]), armBody) - d0]);
  return { p, n };
}
function armBoneT(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, dotv(sub(p, head), d) / dotv(d, d)));
  return { t, at: add(head, mul(d, t)) };
}
function armVaricose(b: string, t0: number, t1: number, ph0: number, dph: number, r: number, proud: number, branches: number, depth = 0) {
  const [bone, side] = b.split('.') as [string, string];
  const n = Math.max(8, Math.round(Math.abs(t1 - t0) * 70));
  // A long, lazy meander (wavelength ~10 cm, swing ~1 cm): the first pass (~3.5 cm, ~1.4 cm) read as crumpled skin.
  let phase = rnd() * 6.28;
  const amp = 4.5 + rnd() * 3;
  const S: { c: V; t: number; ph: number; rr: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n), ph = ph0 + dph * (i / n) + amp * Math.sin(phase);
    phase += 0.22 + rnd() * 0.14;
    const k = Math.sin(Math.PI * Math.min(1, (i / n) * 1.1 + 0.05));   // taper at the ends
    const rr = r * (0.55 + 0.45 * k), sk = armSkin(b, t, ph);
    S.push({ c: add(sk.p, mul(sk.n, proud * (0.6 + 0.4 * k) - rr)), t, ph, rr });
  }
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!.c, B = S[i + 1]!.c, { t, at } = armBoneT(b, A);
    out.push(`  bar  arm on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.rr)} r2=${f(S[i + 1]!.rr)} blend=0.0016 side=${side}`);
  }
  for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.18) {
    const sk = armSkin(b, S[i]!.t, S[i]!.ph), kr = S[i]!.rr * (1.5 + rnd() * 0.6);
    const c = add(sk.p, mul(sk.n, proud * 1.3 - kr)), { t, at } = armBoneT(b, c);
    out.push(`  blob arm on ${bone} at=${f(t)} offset=${fv(sub(c, at))} r=${f(kr)} blend=0.002 side=${side}`);
  }
  for (let k = 0; k < branches && depth < 1; k++) {
    const s0 = S[2 + Math.floor(rnd() * (S.length - 5))]!;
    armVaricose(b, s0.t, Math.min(0.95, s0.t + 0.18 + rnd() * 0.15), s0.ph, (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 25), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
section('arm varicose veins: down the biceps, the outer arm and the back of each upper arm; the forearm flesh');
for (const sd of ['l', 'r']) {
  armVaricose(`upperarm.${sd}`, 0.06, 0.94, 10, 15, 0.0065, 0.0045, 1);
  armVaricose(`upperarm.${sd}`, 0.10, 0.90, 85, -20, 0.0058, 0.0040, 1);
  armVaricose(`upperarm.${sd}`, 0.12, 0.88, 170, 25, 0.0055, 0.0038, 1);
  armVaricose(`forearm.${sd}`, 0.02, 0.38, 20, 30, 0.0055, 0.0038, 1);
  armVaricose(`forearm.${sd}`, 0.03, 0.36, -110, -25, 0.0050, 0.0035, 1);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/twinhead.detail'), out.join('\n') + '\n');
console.log(`twinhead-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
