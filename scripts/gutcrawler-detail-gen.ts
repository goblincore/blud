// scripts/gutcrawler-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/gutcrawler.detail: the gutcrawler's BAKED flesh detail, a naked
// mole-rat's hide (owner, 2026-10-23: "like a naked mole"). The machinery is scripts/gibbet-detail-gen.ts's (the
// bake's own cylinder frame, the vein recipe); the tables and the projection axis are new. Nothing here is ever
// raymarched.
//
//   npx tsx scripts/gutcrawler-detail-gen.ts && npx tsx scripts/bake-body-normal.ts gutcrawler 768 640 --shards 8 \
//     --torso-axis 0,0.10,-1.14:0,0.30,0.64 \
//     --limb upperarm.l:0:1:0.12:128 --limb upperarm.r:0:1:0.12:128 --limb forearm.l:0:1:0.10:128 --limb forearm.r:0:1:0.10:128
//
// THE GRUB'S FRAME. The torso lies along z, rear to front, so the projection runs along the body (TORSO_AXIS =
// --torso-axis): the tail tip at t 0, the chest at t 1. ph 0 = the bake's f (rest +z made perpendicular to the
// axis: nearly straight DOWN, the belly), +-90 the flanks, 180 the back (here the man's chest, belly-up, sits on
// top at the front). Lines bind to the bone under them by z (torsoBone), so the rear wrinkles ride the tail
// pendulums and writhe with the rings.
//
// A MOLE-RAT'S HIDE is wrinkles, not muscle: loose skin in fine irregular folds ringing the body (~1.6 cm apart,
// each an arc of 50-140 deg with a slow wobble, never a full hoop, so it reads as skin and not as rings), deeper
// folds bunched in each crease between two rings and down the sagging flanks, and a few veins showing through the
// thin skin (the vein recipe, biomech-style.md). The arms wrinkle across the elbow.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/gutcrawler.blob', 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const only = (limbs: string[]) => ({ ...built, clusters: built.clusters.map(c => ({ ...c, alive: limbs.includes(c.limb) })) }) as typeof built;
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fv = (v: V) => `(${v.map(f).join(',')})`;

/** The torso projection axis: KEEP IN STEP with the bake's --torso-axis (header). */
export const TORSO_AXIS: [V, V] = [[0, 0.10, -1.14], [0, 0.30, 0.64]];

interface Region { head: V; tail: V; body: typeof built; limb: 'torso' | 'arm' | 'leg' | 'head'; side?: string; bone?: string }
const torso: Region = { head: TORSO_AXIS[0], tail: TORSO_AXIS[1], body: only(['torso']), limb: 'torso' };
const limbRegion = (bone: string): Region => {
  const b = bones.get(bone)!;
  return { head: b.head, tail: b.tail, body: only(['arm' + (bone.endsWith('.l') ? 'L' : 'R')]), limb: 'arm', side: bone.split('.')[1], bone: bone.split('.')[0] };
};

/** The skin round region R at fraction t and angle ph (deg, from f toward s), and its outward normal. */
function skin(R: Region, t: number, ph: number): { p: V; n: V } {
  const A = norm(sub(R.tail, R.head));
  const fw = norm(sub([0, 0, 1], mul(A, A[2])));
  const s = cross(fw, A);
  const a = ph * Math.PI / 180;
  const dir = norm(add(mul(fw, Math.cos(a)), mul(s, Math.sin(a))));
  const axis = add(R.head, mul(sub(R.tail, R.head), t));
  let r = 0.6, p = add(axis, mul(dir, r));
  for (let i = 0; i < 400 && r > 0; i++) {
    const d = sdBody(p, R.body);
    if (d < 1e-4) break;
    r -= Math.max(d * 0.9, 2e-4);
    p = add(axis, mul(dir, r));
  }
  const e = 6e-4, d0 = sdBody(p, R.body);
  const n = norm([sdBody(add(p, [e, 0, 0]), R.body) - d0, sdBody(add(p, [0, e, 0]), R.body) - d0, sdBody(add(p, [0, 0, e]), R.body) - d0]);
  return { p, n };
}

/** The bone a torso point binds to, by z along the body: the front rings ride the spine, the rear ones the tail
 *  pendulums (hem -> hem2 -> hem3), so the wrinkles writhe with the rings they are on. Splits at the joints. */
function torsoBone(p: V): string { return p[2] >= 0 ? 'spine' : p[2] > -0.398 ? 'hem' : p[2] > -0.771 ? 'hem2' : 'hem3'; }
function boneAt(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, dot(sub(p, head), d) / dot(d, d)));
  return { t, at: add(head, mul(d, t)) };
}
/** How a detail line binds: the .blob word and bone name (mirrored bones are written bare plus `side=`), and the
 *  full bone name for measuring t along it. */
function bindOf(R: Region, p: V): { word: string; bone: string; full: string; sideTag: string } {
  if (R.limb === 'torso') { const b = torsoBone(p); return { word: 'torso', bone: b, full: b, sideTag: '' }; }
  if (R.limb === 'head') return { word: 'head', bone: 'skull', full: 'skull', sideTag: '' };
  const bone = R.bone ?? (R.limb === 'arm' ? 'upperarm' : 'thigh');
  return { word: R.limb, bone, full: `${bone}.${R.side}`, sideTag: ` side=${R.side}` };
}

const out: string[] = [];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);

/** A raised ridge through skin samples (t, ph), bars sunk so `proud` stands out, radius tapering r0 -> r1. */
function ridge(R: Region, pts: [number, number][], r0: number, proud: number, blend: number, r1 = r0) {
  const S = pts.map(([t, ph], i) => {
    const r = r0 + (r1 - r0) * (i / Math.max(1, pts.length - 1));
    const sk = skin(R, t, ph);
    return { c: add(sk.p, mul(sk.n, proud - r)), r };
  });
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!.c, B = S[i + 1]!.c;
    if (len(sub(B, A)) < 1e-4) continue;
    const { word, bone, full, sideTag } = bindOf(R, A), { t, at } = boneAt(full, A);
    out.push(`  bar  ${word} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.r)} r2=${f(S[i + 1]!.r)} blend=${f(blend)}${sideTag}`);
  }
}
/** A swelling at a skin point, sunk so `proud` stands out (depth = its semi-axis along the normal). */
function lump(R: Region, t: number, ph: number, r: number, proud: number, blend: number, scale = '', depth = r) {
  const sk = skin(R, t, ph), c = add(sk.p, mul(sk.n, proud - depth));
  const { word, bone, full, sideTag } = bindOf(R, c), { t: bt, at } = boneAt(full, c);
  out.push(`  blob ${word} on ${bone} at=${f(bt)} offset=${fv(sub(c, at))} r=${f(r)}${scale} blend=${f(blend)}${sideTag}`);
}

let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** A varicose trunk from (t0, ph0) to t1, drifting dph degrees, on region R (whose length sets the sampling). */
function varicose(R: Region, t0: number, t1: number, ph0: number, dph: number, r: number, proud: number, branches: number, depth = 0) {
  const L = len(sub(R.tail, R.head)) * Math.abs(t1 - t0);
  const n = Math.max(8, Math.round(L / 0.008));                 // a sample every ~8 mm
  // swing ~1 cm on this region's radius at the start: deg = 0.01 m / r * 180/pi
  const rad = len(sub(skin(R, t0, ph0).p, add(R.head, mul(sub(R.tail, R.head), t0))));
  const amp = (0.008 + rnd() * 0.004) / Math.max(rad, 0.05) * 180 / Math.PI;
  // phase per sample for a ~10 cm wavelength at ~8 mm samples: 2pi * 0.008 / 0.10 = 0.50 rad, jittered
  let phase = rnd() * 6.28, drift = 0;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([t0 + (t1 - t0) * u, ph0 + dph * u + drift + amp * Math.sin(phase)]);
    phase += 0.40 + rnd() * 0.20;
    drift += (rnd() - 0.5) * 0.6;
  }
  // tapered 55% -> 100% -> 55%
  const S = pts.map(([t, ph], i) => {
    const k = Math.sin(Math.PI * Math.min(1, (i / n) * 1.1 + 0.05));
    const rr = r * (0.55 + 0.45 * k);
    const sk = skin(R, t, ph);
    return { c: add(sk.p, mul(sk.n, proud * (0.6 + 0.4 * k) - rr)), rr, t, ph };
  });
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!.c, B = S[i + 1]!.c;
    const { word, bone, full, sideTag } = bindOf(R, A), { t, at } = boneAt(full, A);
    out.push(`  bar  ${word} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.rr)} r2=${f(S[i + 1]!.rr)} blend=0.0016${sideTag}`);
  }
  for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.19) {   // a knot every ~5 samples
    lump(R, S[i]!.t, S[i]!.ph, S[i]!.rr * (1.5 + rnd() * 0.6), proud * 1.3, 0.002);
  }
  for (let k = 0; k < branches && depth < 1; k++) {
    const s0 = S[2 + Math.floor(rnd() * (S.length - 5))]!;
    const dir = rnd() < 0.5 ? -1 : 1;
    const span = (0.12 + rnd() * 0.10) * (t1 > t0 ? 1 : -1);
    varicose(R, s0.t, Math.max(0.02, Math.min(0.98, s0.t + span)), s0.ph, dir * (30 + rnd() * 25), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}


out.push(
  '# GENERATED by scripts/gutcrawler-detail-gen.ts: edit the tables there and re-run, then bake (the command is in',
  '# that script\'s header). These are .blob `body` lines folded into the body ONLY for the bake',
  '# (gutcrawler-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

const zAt = (t: number) => TORSO_AXIS[0][2] + (TORSO_AXIS[1][2] - TORSO_AXIS[0][2]) * t;
const tAt = (z: number) => (z - TORSO_AXIS[0][2]) / (TORSO_AXIS[1][2] - TORSO_AXIS[0][2]);
// The ring segments' centres (gutcrawler.blob, THE MAGGOT), front to back, and the creases between them.
const RINGS = [0.28, 0.12, -0.04, -0.19, -0.34, -0.49, -0.63, -0.76, -0.88, -0.98, -1.06];
const CREASES = RINGS.slice(1).map((z, i) => (z + RINGS[i]!) / 2);

section('fine wrinkles: irregular arcs ringing the grub every ~1.6 cm, the loose hide');
for (let z = -1.08; z <= 0.40; z += 0.016) {
  let ph = rnd() * 360;
  while (ph < 360 + 0) {
    const span = 50 + rnd() * 90, n = Math.max(3, Math.round(span / 14));
    const t0 = tAt(z + (rnd() - 0.5) * 0.006);
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([t0 + 0.004 * Math.sin(i * 1.3 + rnd()), ph + span * i / n]);
    ridge(torso, pts, 0.0034, 0.0016, 0.0016, 0.0024);
    ph += span + 15 + rnd() * 35;
  }
}
section('crease folds: the hide bunched deep in each crease between two rings');
for (const z of CREASES) for (const off of [-0.012, 0.012]) {
  let ph = rnd() * 60;
  while (ph < 360) {
    const span = 70 + rnd() * 60, n = Math.round(span / 12);
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([tAt(z + off) + 0.003 * Math.sin(i), ph + span * i / n]);
    ridge(torso, pts, 0.0060, 0.0030, 0.0025, 0.0040);
    ph += span + 20 + rnd() * 30;
  }
}
section('flank folds: long loose folds running down the sagging sides');
for (const s of [1, -1]) for (let k = 0; k < 9; k++) {
  const ph0 = s * (55 + k * 6 + rnd() * 4), z0 = 0.30 - rnd() * 0.15, z1 = -0.70 + rnd() * 0.2;
  const n = 20, pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([tAt(z0 + (z1 - z0) * i / n), ph0 + s * 4 * Math.sin(i * 0.9 + k)]);
  ridge(torso, pts, 0.0050, 0.0022, 0.0020, 0.0030);
}
section('veins under the thin skin: over the back of the grub and down the flanks');
for (let k = 0; k < 8; k++) {
  const ph = 180 + (k - 3.5) * 22;
  varicose(torso, tAt(0.25 - rnd() * 0.1), tAt(-0.75 + rnd() * 0.2), ph, (k % 2 ? 1 : -1) * 25, 0.0045, 0.0026, 1);
}

section('arms: loose skin wrinkled across the elbows and along the forearms');
for (const sd of ['l', 'r']) {
  const up = limbRegion(`upperarm.${sd}`), fo = limbRegion(`forearm.${sd}`);
  for (let k = 0; k < 7; k++) {
    const t = 0.72 + k * 0.04;
    ridge(up, Array.from({ length: 7 }, (_, i) => [t + 0.01 * Math.sin(i), -80 + i * 27] as [number, number]), 0.0030, 0.0014, 0.0014);
  }
  for (let k = 0; k < 6; k++) {
    const t = 0.04 + k * 0.035;
    ridge(fo, Array.from({ length: 7 }, (_, i) => [t + 0.01 * Math.sin(i + 1), 100 + i * 27] as [number, number]), 0.0030, 0.0014, 0.0014);
  }
  for (let k = 0; k < 10; k++) {
    const t = 0.25 + k * 0.06, ph = rnd() * 360;
    ridge(fo, [[t, ph], [t + 0.01, ph + 40], [t, ph + 80]], 0.0026, 0.0012, 0.0012);
  }
}

writeFileSync('src/lab/sdf-zombie/characters/gutcrawler.detail', out.join('\n') + '\n');
console.log(`gutcrawler-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
