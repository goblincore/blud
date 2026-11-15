// scripts/tallow-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/tallow.detail: the tallow's BAKED surface detail (scripts/bake-body-normal.ts
// folds these lines into the body and bakes the difference into tallow-body-n.png; nothing here is ever raymarched).
// Adapted from venus-detail-gen.ts (the heavy-body recipe in biomech-style.md): FAT ROLLS on the back and flanks, the
// creases under the breasts and under the apron, a deep navel, CELLULITE over the rear, hips and apron, STRETCH MARKS
// on the gut, flanks, breasts and upper arms, and VARICOSE VEINS by the recipe (sine meander ~10 cm wavelength, ~1 cm
// swing). The veins go where the eye goes and where his story is (the gamer's lesson: few, placed): swollen veins
// RADIATING from the boiler's rim on his back and from the cannon blocks back up the forearm sleeves (the machine is
// drinking him), a few over the gut and the breasts.
//
//   npx tsx scripts/tallow-detail-gen.ts && npx tsx scripts/bake-body-normal.ts tallow 1024 384 --torso-r0 0.95 \
//     --limb upperarm.l:0:1:0.28:128 --limb upperarm.r:0:1:0.28:128 --limb forearm.l:0:0.62:0.21:80 \
//     --limb forearm.r:0:0.62:0.21:80 --limb thigh.l:0:1:0.27:128 --limb thigh.r:0:1:0.27:128
//
// --torso-r0 0.95: his gut reaches 0.68 m from the axis, past the bake's default 0.6 m ray start (the cerebrax's
// lesson). 1024 wide: his torso is ~3.6 m round, so 512 would be a 7 mm texel.
//
// Every element is placed by probing the marched skin and sunk so a fixed amount stands proud; a probe that misses
// (the crotch, under the apron) is skipped. Edit the tables below and re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/tallow.blob'), 'utf8');
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
// The probe axis sits forward of the spine: the gut (front z 0.64) outweighs the back (z -0.40).
const AXIS_Z = 0.08;
const TORSO_MIN_Y = 0.62;

/** The skin at height y, angle th (deg; 0 faces +z, +90 is the body's left, +x), and its outward normal; null when
 *  the ray from the axis finds no torso there. */
function skin(y: number, thDeg: number): { p: V; n: V } | null {
  const th = thDeg * Math.PI / 180;
  const dir: V = [Math.sin(th), 0, Math.cos(th)];
  const axis: V = [0, y, AXIS_Z];
  let t = 1.0, p = add(axis, mul(dir, t)), hit = false;
  for (let i = 0; i < 500; i++) {
    const d = sdBody(p, body);
    if (d < 1e-4) { hit = true; break; }
    t -= Math.max(d * 0.9, 2e-4);
    if (t < 0.03) break;
    p = add(axis, mul(dir, t));
  }
  if (!hit) return null;
  const e = 6e-4, d0 = sdBody(p, body);
  const n = norm([sdBody(add(p, [e, 0, 0]), body) - d0, sdBody(add(p, [0, e, 0]), body) - d0, sdBody(add(p, [0, 0, e]), body) - d0]);
  return { p, n };
}
// tallow.blob's spine: pelvis 0.78-0.88, spine1 to 1.158, chest to 1.456, spine2 above.
function boneFor(y: number) { return y < 0.88 ? 'pelvis' : y < 1.158 ? 'spine1' : y < 1.456 ? 'chest' : 'spine2'; }
function boneAt(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, dotv(sub(p, head), d) / (len(d) ** 2)));
  return { t, at: add(head, mul(d, t)) };
}
const radAt = (y: number, th: number) => { const s = skin(y, th); return s ? Math.max(0.12, len(sub(s.p, [0, y, AXIS_Z]))) : 0.35; };

const out: string[] = [];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);
let seed = 7171;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A raised ridge along a chain of (y, deg) skin points: bars sunk so `proud` metres stand out. Breaks where a probe
 *  misses. */
function ridge(pts: [number, number][], r: number, proud: number, blend: number, r2?: number) {
  const S = pts.filter(([y]) => y >= TORSO_MIN_Y).map(([y, th]) => { const s = skin(y, th); return s ? add(s.p, mul(s.n, proud - r)) : null; });
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i], B = S[i + 1];
    if (!A || !B || len(sub(B, A)) > 0.06) continue;
    const mid = mul(add(A, B), 0.5);
    const sm = skin(mid[1], Math.atan2(mid[0], mid[2] - AXIS_Z) * 180 / Math.PI);
    let bend: V = sm ? mul(sub(add(sm.p, mul(sm.n, proud - r)), mid), 2) : [0, 0, 0];
    if (len(bend) > 0.008) bend = mul(bend, 0.008 / len(bend));
    const b = boneFor((A[1] + B[1]) / 2), { t, at } = boneAt(b, A);
    out.push(`  bar  torso on ${b} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} bend=${fv(bend)} r=${f(r)}${r2 ? ` r2=${f(r2)}` : ''} blend=${f(blend)}`);
  }
}
/** A swelling at a skin point, sunk so `proud` stands out; `depth` is its semi-axis along the normal. */
function lump(y: number, th: number, r: number, proud: number, blend: number, scale = '', depth = r) {
  if (y < TORSO_MIN_Y) return;
  const s = skin(y, th); if (!s) return;
  const c = add(s.p, mul(s.n, proud - depth));
  const b = boneFor(y), { t, at } = boneAt(b, c);
  out.push(`  blob torso on ${b} at=${f(t)} offset=${fv(sub(c, at))} r=${f(r)}${scale} blend=${f(blend)}`);
}
const arc = (y: number, th0: number, th1: number, sag: number, n = 12): [number, number][] =>
  Array.from({ length: n + 1 }, (_, k) => [y - sag * Math.sin(Math.PI * k / n), th0 + (th1 - th0) * k / n] as [number, number]);

out.push(
  '# GENERATED by scripts/tallow-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts tallow (the command is in the generator\'s header). These are .blob `body`',
  '# lines folded into the body ONLY for the bake (tallow-body-n.png); they are never raymarched.',
);

// FAT ROLLS: broad, low, horizontal swells, spaced a little more than a roll's width apart so the skin between two
// is the crease. On a body this size they are wider and prouder than the venus's (r 0.022, 6 mm).
section('back fat rolls: under the yoke, round the boiler, down to the rear');
for (const [y, th0, th1, r, sag] of [[1.52, 125, 235, 0.030, 0.012], [1.13, 112, 248, 0.032, 0.016], [1.04, 108, 252, 0.030, 0.016], [0.95, 118, 242, 0.026, 0.012]] as const)
  ridge(arc(y, th0, th1, sag), r, 0.009, 0.014);
section('flank rolls: love handles stacked over the hips');
for (const s of [1, -1]) for (const [y, r] of [[1.15, 0.030], [1.06, 0.032], [0.97, 0.028]] as const)
  ridge([[y + 0.008, s * 58], [y, s * 78], [y - 0.006, s * 98], [y + 0.004, s * 118]], r, 0.009, 0.014);
section('the crease under each breast, and the apron\'s underfold');
// Curving UP at each side under each breast; at a 2 cm sag it read as one straight seam across the chest.
for (const s of [1, -1]) ridge(arc(1.30, s * 12, s * 62, 0.045, 10), 0.020, 0.008, 0.010);
ridge(arc(0.705, -62, 62, -0.035, 14), 0.026, 0.009, 0.012);
{ // the navel: a deep pucker, a ring of swellings round a centre left at skin level, low on the gut
  const cy = 0.98, cth = 0;
  for (let k = 0; k < 8; k++) { const a = 2 * Math.PI * k / 8; lump(cy + 0.014 * Math.sin(a), cth + 1.7 * Math.cos(a), 0.010, 0.005, 0.004); }
}
section('nipples: a low disc and a small swelling, low on each breast');
for (const s of [1, -1]) { lump(1.36, s * 24, 0.030, 0.0018, 0.005, ' deep=0.30', 0.030 * 0.30); lump(1.36, s * 24, 0.008, 0.005, 0.002); }

section('cellulite: soft swellings over the rear, the hips and the sides of the apron');
for (let i = 0; i < 260; i++) {
  const s = rnd() < 0.5 ? -1 : 1, zone = rnd();
  const [y, th] = zone < 0.55 ? [0.66 + rnd() * 0.26, s * (110 + rnd() * 70)]      // rear
    : zone < 0.85 ? [0.80 + rnd() * 0.25, s * (70 + rnd() * 40)]                   // hips
    : [0.64 + rnd() * 0.12, s * (25 + rnd() * 40)];                                // apron sides
  lump(y, th, 0.012 + rnd() * 0.008, 0.0028, 0.008);
}

// STRETCH MARKS: wider than the venus's (r 0.0028 read as scratch cuts there): r 0.004, 2 mm proud, in raking fans.
section('stretch marks: gut sides, flanks, breasts');
function streaks(cy: number, cth: number, n: number, angle: number, spread: [number, number]) {
  for (let i = 0; i < n; i++) {
    const y = cy + (rnd() - 0.5) * spread[0], th = cth + (rnd() - 0.5) * spread[1];
    const L = 0.04 + rnd() * 0.05, a = angle + (rnd() - 0.5) * 0.35, R = radAt(y, th);
    const dy = Math.cos(a) * L * 0.5, dth = Math.sin(a) * L * 0.5 / R * 180 / Math.PI;
    ridge([[y + dy, th - dth], [y, th], [y - dy, th + dth]], 0.004, 0.002, 0.002);
  }
}
for (const s of [1, -1]) {
  streaks(1.02, s * 52, 12, s * 0.5, [0.20, 24]);       // gut sides
  streaks(1.05, s * 92, 10, s * 0.15, [0.18, 20]);      // flanks
  streaks(1.36, s * 40, 6, s * 0.9, [0.08, 14]);        // breasts, outer side
}

// VARICOSE VEINS (biomech-style.md recipe), SCALED ~1.5x: at the recipe's 6 mm trunks they read as thin dark
// cracks on a body this size (the venus's scratch-cut warning). `VS` scales every vein's radius and proudness.
const VS = 1.5;
// VARICOSE VEINS. `vein` runs from one skin point to another in any direction: a sine
// meander perpendicular to the run, ~10 cm wavelength (phase 0.22-0.36 rad per ~9 mm sample), ~1 cm swing, a knot
// one sample in six, branches 65% as thick peeling off at 30-55 deg.
function vein(y0: number, th0: number, y1: number, th1: number, r: number, proud: number, branches: number, depth = 0) {
  if (depth === 0) { r *= VS; proud *= VS; }
  const R0 = radAt(y0, th0), toS = (th: number) => th * Math.PI / 180 * R0;
  const D: [number, number] = [y1 - y0, toS(th1 - th0)], L = Math.hypot(...D);
  if (L < 0.03) return;
  const P: [number, number] = [-D[1] / L, D[0] / L];
  const n = Math.max(6, Math.round(L / 0.009));
  const swing = (0.008 + rnd() * 0.004) * (r / 0.006) / VS;
  let phase = rnd() * 6.28;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const w = Math.sin(phase) * swing * Math.sin(Math.PI * Math.min(1, i / n * 1.2));
    pts.push([y0 + D[0] * i / n + P[0] * w, th0 + (D[1] * i / n + P[1] * w) / R0 * 180 / Math.PI]);
    phase += 0.22 + rnd() * 0.14;
  }
  ridge(pts, r, proud, 0.0016);
  for (let i = 1; i < pts.length - 1; i++) if (rnd() < 0.17) { const [y, t] = pts[i]!; lump(y, t, r * (1.5 + rnd() * 0.6), proud * 1.3, 0.002); }
  for (let b = 0; b < branches && depth < 1; b++) {
    const [y, t] = pts[1 + Math.floor(rnd() * (pts.length - 3))]!;
    const ang = Math.atan2(D[1], D[0]) + (rnd() < 0.5 ? -1 : 1) * (0.52 + rnd() * 0.44), bl = 0.06 + rnd() * 0.06;
    vein(y, t, y + Math.cos(ang) * bl, t + Math.sin(ang) * bl / R0 * 180 / Math.PI, r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
section('veins radiating from the boiler\'s rim (make_back.py: centre y 1.36 on the back, rim ~0.22 m out)');
for (let k = 0; k < 9; k++) {
  const a = 2 * Math.PI * (k + 0.3 * (rnd() - 0.5)) / 9;
  const y0 = 1.36 + 0.24 * Math.sin(a), th0 = 180 + 44 * Math.cos(a);
  const y1 = 1.36 + 0.42 * Math.sin(a), th1 = 180 + 80 * Math.cos(a);
  vein(y0, th0, y1, th1, 0.0065, 0.0045, 1);
}
section('veins over the gut and the breasts');
for (const s of [1, -1]) {
  vein(1.30, s * 30, 0.92, s * 48, 0.0060, 0.0042, 2);
  vein(1.40, s * 34, 1.30, s * 46, 0.0050, 0.0036, 1);
  vein(1.22, s * 70, 0.88, s * 84, 0.0060, 0.0042, 1);
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
section('limb veins: radiating from the cannon blocks back up the forearm sleeves, down the upper arms and thighs');
for (const sd of ['l', 'r']) {
  for (const ph of [0, 70, 140, 210, 290]) limbVaricose('arm', `forearm.${sd}`, 0.56, 0.08, ph, (rnd() - 0.5) * 50, 0.0066 * VS, 0.0046 * VS, 0);
  limbVaricose('arm', `upperarm.${sd}`, 0.08, 0.92, 15, 15, 0.0064 * VS, 0.0044 * VS, 1);
  limbVaricose('arm', `upperarm.${sd}`, 0.12, 0.88, 160, 20, 0.0060 * VS, 0.0042 * VS, 1);
  limbVaricose('leg', `thigh.${sd}`, 0.10, 0.85, 20, 25, 0.0066 * VS, 0.0046 * VS, 1);
  limbVaricose('leg', `thigh.${sd}`, 0.15, 0.90, 170, 15, 0.0060 * VS, 0.0042 * VS, 1);
  limbCellulite(`thigh.${sd}`, 90, 0.05, 0.7, 60, 220);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/tallow.detail'), out.join('\n') + '\n');
console.log(`tallow-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
