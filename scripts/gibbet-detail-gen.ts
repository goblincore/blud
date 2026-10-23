// scripts/gibbet-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/gibbet.detail: the gibbet's BAKED flesh detail. The machinery here is
// scripts/gorehound-detail-gen.ts's (the bake's own cylinder frame, the vein recipe); only the tables and the
// projection axis differ. Nothing here is ever raymarched.
//
//   npx tsx scripts/gibbet-detail-gen.ts && npx tsx scripts/bake-body-normal.ts gibbet 512 320 \
//     --torso-axis 0,1.12,-0.025:0,0.08,0.395 --limb skull:0:1:0.14:96
//
// THE SAC'S FRAME. The flesh that matters is the sac hung on the `hem` pendulum, so the torso projection runs DOWN
// the pendulum (TORSO_AXIS = --torso-axis): hips at t 0, past the sac's bottom at t 1. ph 0 = the bake's f (rest +z
// made perpendicular to the axis: the sac's front-and-down side), 180 = its back. Every torso detail line binds to
// `hem`, so it swings with the sac. The head gets a limb region round the skull.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/gibbet.blob', 'utf8'));
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
export const TORSO_AXIS: [V, V] = [[0, 1.12, -0.025], [0, 0.08, 0.395]];

interface Region { head: V; tail: V; body: typeof built; limb: 'torso' | 'arm' | 'leg' | 'head'; side?: string }
const torso: Region = { head: TORSO_AXIS[0], tail: TORSO_AXIS[1], body: only(['torso']), limb: 'torso' };
const headRegion = (): Region => {
  const b = bones.get('skull')!;
  return { head: b.head, tail: b.tail, body: only(['head']), limb: 'head' };
};
const limbRegion = (bone: string): Region => {
  const b = bones.get(bone)!;
  const limb = bone.startsWith('upperarm') ? 'arm' : 'leg';
  return { head: b.head, tail: b.tail, body: only([limb + (bone.endsWith('.l') ? 'L' : 'R')]), limb, side: bone.split('.')[1] };
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

/** The bone a torso point binds to (rigid, like the scar welts): by z along the back. */
/** Every torso detail line rides the sac's pendulum, so it swings with the sac. */
function torsoBone(_p: V): string { return 'hem'; }
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
  const bone = R.limb === 'arm' ? 'upperarm' : 'thigh';
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
  '# GENERATED by scripts/gibbet-detail-gen.ts: edit the tables there and re-run, then bake (the command is in',
  '# that script\'s header). These are .blob `body` lines folded into the body ONLY for the bake',
  '# (gibbet-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

// t along TORSO_AXIS (hips 0 -> below the sac 1): the stalk ~0.20-0.38, the bulk ~0.45-0.85, the drip ~0.92.
section('the gather: radial creases where the sac is bunched into the stalk and hooked up');
for (let k = 0; k < 14; k++) {
  const ph = k * 360 / 14 + (k % 2) * 6;
  ridge(torso, [[0.20, ph], [0.27, ph + 4], [0.34, ph + 2], [0.40 + 0.03 * (k % 3), ph - 3]], 0.008, 0.0045, 0.003, 0.004);
}
section('sag folds: heavy creases rolling round the sac where its weight folds the skin over itself');
for (const [t, ph0, span] of [[0.47, 30, 120], [0.50, 200, 110], [0.62, 300, 90], [0.66, 100, 100], [0.80, 160, 140]] as const)
  ridge(torso, Array.from({ length: 9 }, (_, i) => [t + 0.012 * Math.sin(i), ph0 + span * i / 8] as [number, number]), 0.010, 0.005, 0.004);
section('striae: stretch marks, short parallel ridges where the meat is stretched over its own weight');
for (const [t0, ph0] of [[0.58, 60], [0.62, 230], [0.72, 330], [0.70, 140], [0.55, 280]] as const)
  for (let k = 0; k < 5; k++) ridge(torso, [[t0 - 0.035, ph0 + k * 5], [t0 + 0.035, ph0 + k * 5 + 3]], 0.0028, 0.0012, 0.0015);
section('varicose veins: from the gather down over the bulk toward the drip');
for (let k = 0; k < 7; k++) {
  const ph = k * 360 / 7 + 20;
  varicose(torso, 0.30, 0.86, ph, (k % 2 ? 1 : -1) * 35, 0.0062, 0.0042, 2);
}
section('agitated flesh: bruised swellings round the hook wounds and over the bulk');
for (const [t, ph, r] of [[0.40, 20, 0.012], [0.42, 200, 0.011], [0.43, 95, 0.010], [0.60, 15, 0.014], [0.68, 250, 0.012],
  [0.75, 120, 0.013], [0.82, 300, 0.010], [0.86, 40, 0.012]] as const)
  lump(torso, t, ph, r, r * 0.55, 0.004);

section('the head: veins over the bulb and creases under the sagging brow');
const head = headRegion();
for (const ph of [40, 130, 220, 310]) varicose(head, 0.15, 0.75, ph, 25, 0.0045, 0.0032, 1);
for (const t of [0.52, 0.57]) ridge(head, [[t, -60], [t + 0.01, -20], [t, 20], [t - 0.01, 60]], 0.006, 0.003, 0.003);

writeFileSync('src/lab/sdf-zombie/characters/gibbet.detail', out.join('\n') + '\n');
console.log(`gibbet-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
