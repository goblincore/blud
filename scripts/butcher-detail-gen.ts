// scripts/butcher-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/butcher.detail: the butcher's BAKED muscle and surface detail
// (scripts/bake-body-normal.ts folds these lines into the body and bakes the difference into
// butcher-body-n.png; nothing here is ever raymarched, so detail is free at runtime).
//
//   npx tsx scripts/butcher-detail-gen.ts && npx tsx scripts/bake-body-normal.ts butcher 512 256 \
//     --limb upperArm.l:0:1:0.15:96 --limb foreArm.l:0:1:0.13:96 --limb upperArm.r:0:1:0.15:96 --limb foreArm.r:0:0.9:0.13:96
//   (the torso takes most of it; the arm regions take seconds)
//
// THE TEMPLATE is scripts/twinhead-detail-gen.ts (same probes, same vein recipe, biomech-style.md); the tables are
// re-measured for the zombie's lower, shorter torso (pelvis bone to y 1.14, spine to 1.475) and his bone names.
//
// WHY GENERATED. Detail has to sit ON the skin: a ridge 2 mm proud reads, one 6 mm under it does nothing and
// one 6 mm out floats. So every element is placed by probing the marched torso (sdBody along a ray toward the
// torso axis, the same probe the bake uses), then sunk by a fixed amount under the skin and bound to the
// nearest spine bone with offset/tip, as the scar welts in butcher.blob are. Edit the tables below and
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
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/butcher.blob'), 'utf8');
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
const AXIS_Z = 0.03;   // the torso masses' centre line (spine at=0.5 z 0.03)

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
function boneFor(y: number) { return y < 1.14 ? 'pelvis' : 'spine'; }
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
  '# GENERATED by scripts/butcher-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts butcher. These are .blob `body` lines folded into the body ONLY for',
  '# the bake (butcher-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

section('abs: a 6-pack over the gut, a linea alba between the columns, creases between the rows');
for (const [y, w] of [[1.17, 0.036], [1.23, 0.037], [1.29, 0.037]] as const)
  for (const s of [1, -1]) lump(y, s * 13, w, 0.006, 0.003, ' wide=1.05 tall=0.62 deep=0.50', w * 0.5);

section('external obliques: a long swell down each flank into the waist');
for (const s of [1, -1]) ridge([[1.36, s * 54], [1.27, s * 52], [1.17, s * 44], [1.09, s * 34]], 0.028, 0.006, 0.010);

section('serratus: four fingers per side under the armpit');
for (const s of [1, -1]) for (const [y, th] of [[1.40, 64], [1.365, 61], [1.33, 58], [1.295, 56]] as const)
  ridge([[y + 0.01, s * (th + 10)], [y - 0.012, s * (th - 6)]], 0.011, 0.004, 0.003);

section('ribs: four arcs showing through the flank');
for (const s of [1, -1]) for (const y of [1.40, 1.365, 1.33, 1.295])
  ridge([[y, s * 72], [y - 0.008, s * 92], [y - 0.020, s * 112]], 0.0055, 0.002, 0.002);

section('nipples');
for (const s of [1, -1]) {
  lump(1.375, s * 24, 0.015, 0.0015, 0.004, ' deep=0.30', 0.015 * 0.30);
  lump(1.375, s * 24, 0.005, 0.004, 0.002);
}

section('back: spinal erectors either side of the groove (the pump sits over the upper back), shoulder blades');
for (const s of [1, -1]) ridge([[1.05, s * 166], [1.16, s * 165], [1.27, s * 166], [1.38, s * 168]], 0.026, 0.007, 0.008);
for (const s of [1, -1]) ridge([[1.47, s * 146], [1.42, s * 138], [1.35, s * 132]], 0.011, 0.004, 0.004);

// Varicose veins: biomech-style.md's recipe (the twinhead's three attempts). Purple in the reference; the map
// carries only their relief, the palette's mottle the bruising.
section('varicose veins: thick serpentine trunks with knots and branches');
let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function varicose(y0: number, th0: number, y1: number, dth: number, r: number, proud: number, branches: number, depth = 0) {
  // A smooth meander sampled densely: alternating sides per sample baked as sharp zigzags on the twinhead.
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
  for (let i = 1; i < pts.length - 1; i++)
    if (rnd() < 0.2) { const [y, t] = pts[i]!; lump(y, t, r * (1.5 + rnd() * 0.6), proud * 1.35, 0.002); }
  for (let b = 0; b < branches; b++) {
    const [y, t] = pts[1 + Math.floor(rnd() * (pts.length - 3))]!;
    const side = rnd() < 0.5 ? -1 : 1;
    if (depth < 1) varicose(y, t, y - 0.06 - rnd() * 0.05, side * (14 + rnd() * 12), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
for (const s of [1, -1]) {
  varicose(1.40, s * 70, 1.08, -s * 14, 0.0060, 0.0042, 2);   // down the flank, toward the waist
  varicose(1.34, s * 36, 1.10, s * 6, 0.0054, 0.0038, 2);    // over the gut, outboard of the abs
  varicose(1.46, s * 50, 1.38, s * 10, 0.0046, 0.0032, 1);   // across the upper chest toward the armpit
  varicose(1.44, s * 120, 1.10, s * 8, 0.0058, 0.0040, 2);   // over the lats, outboard of the pump
}

section('agitated flesh: swellings round the chest hose port, the pump seam and the hip grafts');
const LUMPS: [number, number, number][] = [
  [1.455, 34, 0.007], [1.43, 46, 0.006], [1.405, 36, 0.007], [1.44, 26, 0.005],
  [1.40, 150, 0.009], [1.36, 158, 0.008], [1.26, 152, 0.009], [1.40, -150, 0.009], [1.32, -156, 0.008], [1.25, -150, 0.007],
  [1.08, 70, 0.010], [1.06, 84, 0.009], [1.09, -72, 0.010], [1.065, -86, 0.008],
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
  armVaricose(`upperArm.${sd}`, 0.06, 0.94, 10, 15, 0.0060, 0.0042, 1);
  armVaricose(`upperArm.${sd}`, 0.10, 0.90, 85, -20, 0.0055, 0.0038, 1);
  armVaricose(`upperArm.${sd}`, 0.12, 0.88, 170, 25, 0.0052, 0.0036, 1);
  // The butcher's forearms are flesh to the wrist (the twinhead's stop at a third): the whole length.
  armVaricose(`foreArm.${sd}`, 0.04, 0.85, 20, 30, 0.0052, 0.0036, 1);
  armVaricose(`foreArm.${sd}`, 0.05, 0.80, -110, -25, 0.0048, 0.0034, 1);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/butcher.detail'), out.join('\n') + '\n');
console.log(`butcher-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
