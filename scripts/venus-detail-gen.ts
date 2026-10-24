// scripts/venus-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/venus.detail: the venus's BAKED surface detail (scripts/bake-body-normal.ts
// folds these lines into the body and bakes the difference into venus-body-n.png; nothing here is ever raymarched,
// so detail is free at runtime). The twinhead's generator (twinhead-detail-gen.ts) adapted to a heavy body: no
// muscle definition (she is not muscled); instead FAT ROLLS on the back and flanks, CELLULITE dimpling over the rear
// and thighs, STRETCH MARKS on hips, belly and breasts, a navel, and VARICOSE VEINS by the recipe in
// .claude/skills/authoring-sdf-characters/biomech-style.md (sine meander ~10 cm wavelength, ~1 cm swing; never
// alternating sides per sample), on the torso, the upper arms and the thighs.
//
//   npx tsx scripts/venus-detail-gen.ts && npx tsx scripts/bake-body-normal.ts venus 512 320 \
//     --limb upperarm.l:0:1:0.15:96 --limb upperarm.r:0:1:0.15:96 --limb thigh.l:0:1:0.20:128 --limb thigh.r:0:1:0.20:128
//   (most of the time is the torso)
//
// Every element is placed by probing the marched skin (the bake's own probe) and sunk so a fixed amount stands
// proud. Edit the tables below and re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/venus.blob'), 'utf8');
const doc = parseBlob(src);
const built = buildBody(compileBlob(doc, compileFace(doc)));
const only = (limbs: string[]) =>
  ({ ...built, clusters: built.clusters.map(c => ({ ...c, alive: limbs.includes(c.limb) })) }) as typeof built;
const body = only(['torso']);
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fv = (v: V) => `(${v.map(f).join(',')})`;
// The torso's axis sits a little behind centre: the rear (z -0.26) outweighs the bust (z +0.24).
const AXIS_Z = -0.01;
// Below this the torso cluster is only the crotch: a probe there misses (NaN). A vein branch that wanders this low
// is cut off here.
const TORSO_MIN_Y = 0.84;

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
// venus.blob's spine: pelvis 0.92-1.02, spine1 to 1.19, chest to 1.369, spine2 above.
function boneFor(y: number) { return y < 1.02 ? 'pelvis' : y < 1.19 ? 'spine1' : y < 1.369 ? 'chest' : 'spine2'; }
function boneAt(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, dotv(sub(p, head), d) / (len(d) ** 2)));
  return { t, at: add(head, mul(d, t)) };
}

const out: string[] = [];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);
let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A raised ridge along a chain of (y, deg) skin points: bars sunk so `proud` metres stand out. */
function ridge(pts: [number, number][], r: number, proud: number, blend: number, r2?: number) {
  pts = pts.filter(([y]) => y >= TORSO_MIN_Y);
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
/** A swelling at a skin point, sunk so `proud` stands out; `depth` is its semi-axis along the normal. */
function lump(y: number, th: number, r: number, proud: number, blend: number, scale = '', depth = r) {
  if (y < TORSO_MIN_Y) return;
  const s = skin(y, th), c = add(s.p, mul(s.n, proud - depth));
  const b = boneFor(y), { t, at } = boneAt(b, c);
  out.push(`  blob torso on ${b} at=${f(t)} offset=${fv(sub(c, at))} r=${f(r)}${scale} blend=${f(blend)}`);
}

out.push(
  '# GENERATED by scripts/venus-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts venus (the command is in the generator\'s header). These are .blob `body`',
  '# lines folded into the body ONLY for the bake (venus-body-n.png); they are never raymarched.',
);

// FAT ROLLS: broad, low, horizontal swells. A roll is its own soft ridge with the skin between two rolls as the
// crease, so they are spaced a little more than a roll's width apart.
section('back fat rolls: above and below the corset, and under the shoulder blades');
for (const [y, th0, th1, r] of [[1.255, 112, 248, 0.022], [1.215, 118, 242, 0.020], [1.045, 125, 235, 0.020], [1.31, 128, 232, 0.018]] as const) {
  const pts: [number, number][] = [];
  for (let k = 0; k <= 10; k++) { const th = th0 + (th1 - th0) * k / 10; pts.push([y - 0.010 * Math.sin(Math.PI * k / 10), th]); }
  ridge(pts, r, 0.006, 0.010);
}
section('flank rolls: over the corset on the sides');
for (const s of [1, -1]) for (const [y, r] of [[1.235, 0.020], [1.04, 0.018]] as const)
  ridge([[y + 0.006, s * 60], [y, s * 82], [y + 0.004, s * 104]], r, 0.006, 0.010);

section('the belly: the apron\'s underfold crease (a roll above it) and the navel');
ridge([[1.005, -55], [0.985, -30], [0.978, 0], [0.985, 30], [1.005, 55]], 0.016, 0.006, 0.008);
{ // the navel: a ring of six small swellings round a centre that stays at skin level
  const cy = 1.085, cth = 0;
  for (let k = 0; k < 6; k++) {
    const a = 2 * Math.PI * k / 6;
    lump(cy + 0.009 * Math.sin(a), cth + 3.4 * Math.cos(a), 0.006, 0.003, 0.003);
  }
}

section('areolae: a low disc and a small nipple on each breast, low on its forward pole');
for (const s of [1, -1]) {
  lump(1.235, s * 24, 0.022, 0.0015, 0.004, ' deep=0.30', 0.022 * 0.30);
  lump(1.235, s * 24, 0.006, 0.0045, 0.002);
}

// CELLULITE: an orange-peel of small soft dimples-between-swellings over the rear, hips and belly sides.
section('cellulite: small soft swellings over the rear and hips');
for (let i = 0; i < 140; i++) {
  const s = rnd() < 0.5 ? -1 : 1;
  const y = 0.86 + rnd() * 0.17;
  const th = s * (95 + rnd() * 80);
  lump(y, th, 0.009 + rnd() * 0.006, 0.0022, 0.006);
}

// STRETCH MARKS: short, fine, roughly parallel streaks — vertical-ish on the hips, radiating on the belly sides
// and the breasts.
section('stretch marks: hips, belly sides, breasts');
function streaks(cy: number, cth: number, n: number, angle: number, spread: [number, number]) {
  for (let i = 0; i < n; i++) {
    const y = cy + (rnd() - 0.5) * spread[0], th = cth + (rnd() - 0.5) * spread[1];
    const L = 0.025 + rnd() * 0.035, a = angle + (rnd() - 0.5) * 0.35;
    const dy = Math.cos(a) * L * 0.5, dth = Math.sin(a) * L * 0.5 / 0.28 * 180 / Math.PI;
    ridge([[y + dy, th - dth], [y, th], [y - dy, th + dth]], 0.0028, 0.0014, 0.0015);
  }
}
for (const s of [1, -1]) {
  streaks(0.96, s * 80, 9, s * 0.25, [0.08, 20]);       // hips
  streaks(1.06, s * 45, 7, s * 0.6, [0.06, 18]);        // belly sides
  streaks(1.26, s * 38, 5, s * 0.9, [0.05, 12]);        // breasts, outer side
}

// VARICOSE VEINS (biomech-style.md recipe): a sine meander, ~10 cm wavelength (phase step 0.22-0.36 rad per
// ~1 cm sample), ~1 cm swing, trunks 5-6.5 mm thick and 3.5-4.5 mm proud, a knot about one sample in six, two
// branches on the torso, each 65% as thick.
section('varicose veins: flanks, belly, breasts, back');
function varicose(y0: number, th0: number, y1: number, dth: number, r: number, proud: number, branches: number, depth = 0) {
  const n = Math.max(8, Math.round(Math.abs(y0 - y1) / 0.009));
  const pts: [number, number][] = [];
  let th = th0, phase = rnd() * 6.28;
  const swing = (0.008 + rnd() * 0.004) * (r / 0.006);       // metres
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * (i / n);
    const rad = Math.max(0.12, len(sub(skin(y, th).p, [0, y, AXIS_Z])));
    pts.push([y, th + swing * Math.sin(phase) / rad * 180 / Math.PI]);
    phase += 0.22 + rnd() * 0.14;
    th += dth / n + (rnd() - 0.5) * 0.6;
  }
  ridge(pts, r, proud, 0.0016);
  for (let i = 1; i < pts.length - 1; i++)
    if (rnd() < 0.17) { const [y, t] = pts[i]!; lump(y, t, r * (1.5 + rnd() * 0.6), proud * 1.3, 0.002); }
  for (let b = 0; b < branches && depth < 1; b++) {
    const [y, t] = pts[1 + Math.floor(rnd() * (pts.length - 3))]!;
    const side = rnd() < 0.5 ? -1 : 1;
    varicose(y, t, y - 0.06 - rnd() * 0.06, side * (14 + rnd() * 14), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
for (const s of [1, -1]) {
  varicose(1.34, s * 66, 1.07, -s * 10, 0.0062, 0.0042, 2);   // down the flank, under the corset, into the hip
  varicose(1.17, s * 28, 0.99, s * 10, 0.0055, 0.0038, 2);    // over the belly
  varicose(1.33, s * 30, 1.22, s * 8, 0.0050, 0.0035, 1);     // over each breast
  varicose(1.36, s * 150, 1.07, s * 10, 0.0060, 0.0040, 2);   // over the back
  varicose(1.00, s * 135, 0.86, -s * 12, 0.0055, 0.0038, 1);  // down the rear
}

// ---------------------------------------------------------------- limbs
// Their own normal-map regions (a cylinder round each bone; bake-body-normal.ts). Detail is placed on that limb's
// skin alone and bound to its bone, one side at a time.
/** Limb skin round bone `b` at fraction t and angle ph (deg; 0 = the bone frame's front, +90 = outward). */
function limbSkin(b: string, field: typeof built, t: number, ph: number): { p: V; n: V } {
  const { head, tail } = bones.get(b)!;
  const u = norm(sub(tail, head));
  const fw = norm(sub([0, 0, 1], mul(u, u[2])));
  const s = cross(fw, u);                     // the bake's frame: s = f x axis
  const o = b.endsWith('.r') ? -1 : 1;        // s points +x; outward is +x on .l, -x on .r
  const a = ph * Math.PI / 180;
  const dir = norm(add(mul(fw, Math.cos(a)), mul(s, o * Math.sin(a))));
  const axis = add(head, mul(sub(tail, head), t));
  let r = 0.3, p = add(axis, mul(dir, r));
  for (let i = 0; i < 300; i++) {
    const d = sdBody(p, field);
    if (Math.abs(d) < 1e-4) break;
    r -= Math.max(Math.abs(d) * 0.9, 2e-4) * Math.sign(d);
    p = add(axis, mul(dir, r));
  }
  const e = 6e-4, d0 = sdBody(p, field);
  const n = norm([sdBody(add(p, [e, 0, 0]), field) - d0, sdBody(add(p, [0, e, 0]), field) - d0, sdBody(add(p, [0, 0, e]), field) - d0]);
  return { p, n };
}
function limbBoneT(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, dotv(sub(p, head), d) / dotv(d, d)));
  return { t, at: add(head, mul(d, t)) };
}
function limbVaricose(limb: 'arm' | 'leg', b: string, t0: number, t1: number, ph0: number, dph: number, r: number, proud: number,
  branches: number, depth = 0) {
  const [bone, side] = b.split('.') as [string, string];
  const field = only([limb === 'arm' ? (side === 'l' ? 'armL' : 'armR') : (side === 'l' ? 'legL' : 'legR')]);
  const L = len(sub(bones.get(b)!.tail, bones.get(b)!.head));
  const n = Math.max(8, Math.round(Math.abs(t1 - t0) * L / 0.009));
  let phase = rnd() * 6.28;
  const amp = 4.5 + rnd() * 3;                                // degrees: ~1 cm of swing on these limb radii
  const S: { c: V; t: number; ph: number; rr: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n), ph = ph0 + dph * (i / n) + amp * Math.sin(phase);
    phase += 0.22 + rnd() * 0.14;
    const k = Math.sin(Math.PI * Math.min(1, (i / n) * 1.1 + 0.05));
    const rr = r * (0.55 + 0.45 * k), sk = limbSkin(b, field, t, ph);
    S.push({ c: add(sk.p, mul(sk.n, proud * (0.6 + 0.4 * k) - rr)), t, ph, rr });
  }
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!.c, B = S[i + 1]!.c, { t, at } = limbBoneT(b, A);
    out.push(`  bar  ${limb} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.rr)} r2=${f(S[i + 1]!.rr)} blend=0.0016 side=${side}`);
  }
  for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.17) {
    const sk = limbSkin(b, field, S[i]!.t, S[i]!.ph), kr = S[i]!.rr * (1.5 + rnd() * 0.6);
    const c = add(sk.p, mul(sk.n, proud * 1.3 - kr)), { t, at } = limbBoneT(b, c);
    out.push(`  blob ${limb} on ${bone} at=${f(t)} offset=${fv(sub(c, at))} r=${f(kr)} blend=0.002 side=${side}`);
  }
  for (let k = 0; k < branches && depth < 1; k++) {
    const s0 = S[2 + Math.floor(rnd() * (S.length - 5))]!;
    limbVaricose(limb, b, s0.t, Math.min(0.95, s0.t + 0.18 + rnd() * 0.15), s0.ph, (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 25),
      r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
function limbCellulite(b: string, n: number, t0: number, t1: number, ph0: number, ph1: number) {
  const [bone, side] = b.split('.') as [string, string];
  const field = only([side === 'l' ? 'legL' : 'legR']);
  for (let i = 0; i < n; i++) {
    const t = t0 + rnd() * (t1 - t0), ph = ph0 + rnd() * (ph1 - ph0), r = 0.009 + rnd() * 0.005;
    const sk = limbSkin(b, field, t, ph), c = add(sk.p, mul(sk.n, 0.0022 - r)), at = limbBoneT(b, c);
    out.push(`  blob leg on ${bone} at=${f(at.t)} offset=${fv(sub(c, at.at))} r=${f(r)} blend=0.006 side=${side}`);
  }
}
section('limb varicose veins: down the upper arms and the thighs; cellulite on the outer and back thighs');
for (const sd of ['l', 'r']) {
  limbVaricose('arm', `upperarm.${sd}`, 0.08, 0.92, 15, 15, 0.0062, 0.0042, 1);
  limbVaricose('arm', `upperarm.${sd}`, 0.12, 0.88, 160, 20, 0.0058, 0.0040, 1);
  limbVaricose('leg', `thigh.${sd}`, 0.10, 0.85, 20, 25, 0.0064, 0.0044, 1);
  limbVaricose('leg', `thigh.${sd}`, 0.08, 0.80, -60, -20, 0.0060, 0.0042, 1);
  limbVaricose('leg', `thigh.${sd}`, 0.15, 0.90, 170, 15, 0.0058, 0.0040, 1);
  limbCellulite(`thigh.${sd}`, 70, 0.05, 0.6, 60, 200);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/venus.detail'), out.join('\n') + '\n');
console.log(`venus-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
