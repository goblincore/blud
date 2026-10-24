// scripts/imp-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/imp.detail: the imp's BAKED sinew, ribs and veins (scripts/bake-body-normal.ts
// folds these lines into the body and bakes the difference into imp-body-n.png; nothing here is ever raymarched).
//
//   npx tsx scripts/imp-detail-gen.ts && npx tsx scripts/bake-body-normal.ts imp 512 256 \
//     --torso-axis 0,1.56,0.19:0,0.90,-0.06 \
//     --limb upperArm.l:0:1:0.13:80 --limb foreArm.l:0:1:0.12:80 --limb upperArm.r:0:1:0.13:80 --limb foreArm.r:0:1:0.12:80 \
//     --limb thigh.l:0:1:0.15:80 --limb shin.l:0:1:0.12:80 --limb foot.l:0:1:0.09:64 \
//     --limb thigh.r:0:1:0.15:80 --limb shin.r:0:1:0.12:80 --limb foot.r:0:1:0.09:64
//
// THE TEMPLATE is scripts/flayer-detail-gen.ts (probes, ridges, lumps and biomech-style.md's varicose recipe). What
// differs for the imp:
//   - THE TORSO LEANS 26 deg (imp.blob's hunch), so the torso is probed and baked round a TILTED axis along the
//     spine (--torso-axis above; AXIS below must match it) rather than the zombie's vertical one;
//   - the ribs are a starved cage, but they start out at the chest wound's edges (the spreader holds the middle);
//   - SINEW, not muscle mass: long cords down each forearm (the reference's ropy forearms), down the backs of the
//     shins to the hock and along the metatarsals; veins by the recipe on the flanks, the upper arms and the thighs.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/imp.blob'), 'utf8');
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
// The torso's axis, leaning forward up the hunch: the same segment the bake takes (--torso-axis, head then tail).
const AX0: V = [0, 1.56, 0.19], AX1: V = [0, 0.90, -0.06];
const axisZ = (y: number) => AX1[2] + (AX0[2] - AX1[2]) * (y - AX1[1]) / (AX0[1] - AX1[1]);

/** The skin at height y, angle th (deg; 0 faces +z, +90 is the body's left, +x), and its outward normal. */
function skin(y: number, thDeg: number): { p: V; n: V } {
  const th = thDeg * Math.PI / 180;
  const dir: V = [Math.sin(th), 0, Math.cos(th)];
  const axis: V = [0, y, axisZ(y)];
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
    const sm = skin(mid[1], Math.atan2(mid[0], mid[2] - axisZ(mid[1])) * 180 / Math.PI);
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
  '# GENERATED by scripts/imp-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts imp. These are .blob `body` lines folded into the body ONLY for',
  '# the bake (imp-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

section('abs: a faint, starved four-pack under the wound');
for (const [y, w] of [[1.17, 0.028], [1.22, 0.029]] as const)
  for (const s of [1, -1]) lump(y, s * 13, w, 0.0035, 0.003, ' wide=1.05 tall=0.62 deep=0.50', w * 0.5);

section("ribs: a starved cage, six arcs a side from the wound's edge round to the back");
for (const s of [1, -1]) for (const [i, y] of [1.44, 1.40, 1.36, 1.32, 1.28, 1.24].entries()) {
  // The wound and its spreader take the middle (x within ~0.09, ~30 deg at this radius): start outside it.
  const th0 = 34 + i * 2;
  ridge([[y + 0.010, s * th0], [y, s * 55], [y - 0.010, s * 78], [y - 0.022, s * 102], [y - 0.030, s * 126]], 0.0080, 0.0042, 0.003);
}

section('back: the spinous processes as a row of knuckles, erectors either side, shoulder blades');
for (let y = 1.10; y <= 1.44; y += 0.034) lump(y, 180, 0.011, 0.005, 0.003);
for (const s of [1, -1]) ridge([[1.04, s * 164], [1.15, s * 163], [1.26, s * 164], [1.37, s * 166]], 0.020, 0.005, 0.008);
for (const s of [1, -1]) ridge([[1.47, s * 146], [1.42, s * 136], [1.34, s * 128]], 0.013, 0.006, 0.004);

// Varicose veins: biomech-style.md's recipe (the twinhead's three attempts). Purple in the reference; the map
// carries only their relief, the palette's mottle the bruising.
section('varicose veins: thick serpentine trunks with knots and branches');
let seed = 9191;
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
  varicose(1.36, s * 66, 1.08, -s * 12, 0.0054, 0.0038, 1);   // down the flank
  varicose(1.30, s * 130, 1.10, s * 6, 0.0052, 0.0036, 1);   // over the lats
}

section("agitated flesh: swellings round the wound's edges, where the spreader's blades bite");
const LUMPS: [number, number, number][] = [
  [1.40, 30, 0.010], [1.34, 31, 0.009], [1.29, 27, 0.009], [1.40, -30, 0.010], [1.34, -31, 0.009], [1.29, -27, 0.009],
];
for (const [y, th, r] of LUMPS) lump(y, th, r, r * 0.55, 0.004);

// ---------------------------------------------------------------- arms
// The arms have their own normal-map regions (a cylinder round each bone; bake-body-normal.ts). Their detail is
// placed on the ARM skin (the arm clusters alone) and bound to the arm bone it lies on, one side at a time.
const armBody = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'armL' || c.limb === 'armR' })) } as typeof built;
const legBody = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'legL' || c.limb === 'legR' })) } as typeof built;
const limbOf = (b: string) => /^(thigh|shin|foot)/.test(b) ? 'leg' : 'arm';
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
    const d = sdBody(p, limbOf(b) === 'leg' ? legBody : armBody);
    if (Math.abs(d) < 1e-4) break;
    r -= Math.max(Math.abs(d) * 0.9, 2e-4) * Math.sign(d);
    p = add(axis, mul(dir, r));
  }
  const lb = limbOf(b) === 'leg' ? legBody : armBody;
  const e = 6e-4, d0 = sdBody(p, lb);
  const n = norm([sdBody(add(p, [e, 0, 0]), lb) - d0, sdBody(add(p, [0, e, 0]), lb) - d0, sdBody(add(p, [0, 0, e]), lb) - d0]);
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
    out.push(`  bar  ${limbOf(b)} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.rr)} r2=${f(S[i + 1]!.rr)} blend=0.0016 side=${side}`);
  }
  for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.18) {
    const sk = armSkin(b, S[i]!.t, S[i]!.ph), kr = S[i]!.rr * (1.5 + rnd() * 0.6);
    const c = add(sk.p, mul(sk.n, proud * 1.3 - kr)), { t, at } = armBoneT(b, c);
    out.push(`  blob ${limbOf(b)} on ${bone} at=${f(t)} offset=${fv(sub(c, at))} r=${f(kr)} blend=0.002 side=${side}`);
  }
  for (let k = 0; k < branches && depth < 1; k++) {
    const s0 = S[2 + Math.floor(rnd() * (S.length - 5))]!;
    armVaricose(b, s0.t, Math.min(0.95, s0.t + 0.18 + rnd() * 0.15), s0.ph, (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 25), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
/** A SINEW CORD: a long, nearly straight ridge down a limb at angle ph, thickest in its middle (a tendon standing
 *  out of a starved limb). Sampled densely like the veins; no meander, no knots. */
function sinew(b: string, t0: number, t1: number, ph: number, dph: number, r: number, proud: number) {
  const [bone, side] = b.split('.') as [string, string];
  const n = Math.max(6, Math.round(Math.abs(t1 - t0) * 24));   // ~1.4 cm samples: a straight cord needs no more
  const S: { c: V; rr: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n), k = Math.sin(Math.PI * (i / n));
    const rr = r * (0.45 + 0.55 * k), sk = armSkin(b, t, ph + dph * (i / n));
    S.push({ c: add(sk.p, mul(sk.n, proud * (0.5 + 0.5 * k) - rr)), rr });
  }
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!.c, B = S[i + 1]!.c, { t, at } = armBoneT(b, A);
    out.push(`  bar  ${limbOf(b)} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.rr)} r2=${f(S[i + 1]!.rr)} blend=0.002 side=${side}`);
  }
}

section("forearm sinew: four cords down each forearm, the reference's ropy forearms");
for (const sd of ['l', 'r']) for (const [ph, dph] of [[15, 10], [70, -15], [-60, 10], [160, -10]] as const)
  sinew(`foreArm.${sd}`, 0.10, 0.92, ph, dph, 0.0060, 0.0040);

section('arm varicose veins: down the biceps and the back of each upper arm, and one on each forearm');
for (const sd of ['l', 'r']) {
  armVaricose(`upperArm.${sd}`, 0.06, 0.94, 10, 15, 0.0058, 0.0040, 1);
  armVaricose(`upperArm.${sd}`, 0.12, 0.88, 170, 25, 0.0050, 0.0036, 1);
  armVaricose(`foreArm.${sd}`, 0.08, 0.80, 110, 20, 0.0048, 0.0034, 0);
}

section("legs: veins down the outer thigh, the calf's two cords to the hock, tendons along the metatarsal");
for (const sd of ['l', 'r']) {
  armVaricose(`thigh.${sd}`, 0.10, 0.90, 80, -20, 0.0058, 0.0040, 1);
  armVaricose(`thigh.${sd}`, 0.15, 0.85, -40, 15, 0.0052, 0.0036, 0);
  // The digitigrade shin's back is its calf: two cords down it into the hock (the Achilles).
  sinew(`shin.${sd}`, 0.20, 0.95, 160, 0, 0.0070, 0.0045);
  sinew(`shin.${sd}`, 0.25, 0.95, -160, 0, 0.0060, 0.0040);
  sinew(`shin.${sd}`, 0.08, 0.80, 15, 0, 0.0050, 0.0035);
  for (const ph of [20, -25, 170]) sinew(`foot.${sd}`, 0.08, 0.92, ph, 0, 0.0045, 0.0032);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/imp.detail'), out.join('\n') + '\n');
console.log(`imp-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
