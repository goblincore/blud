// scripts/zombie-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/<name>.detail: the zombie's BAKED flesh detail (scripts/bake-body-normal.ts
// folds these lines into the body and bakes the difference into <name>-body-n.png; nothing here is ever raymarched,
// so detail costs the crowd nothing at runtime).
//
//   npx tsx scripts/zombie-detail-gen.ts [name] [--incision] && npx tsx scripts/bake-body-normal.ts <name> 512 256 \
//     --limb upperArm.l:0:1:0.12:96 --limb foreArm.l:0:1:0.10:96 --limb upperArm.r:0:1:0.12:96 --limb foreArm.r:0:1:0.10:96 \\
//     --limb thigh.l:0:1:0.14:96 --limb thigh.r:0:1:0.14:96
//   name defaults to `zombie`; --incision adds the morgue's Y-incision and its stitches.
//
// THE TEMPLATE is scripts/flayer-detail-gen.ts (skin probes, the varicose recipe in biomech-style.md). The zombie's
// skeleton is NOT the butcher's (its spine runs y 1.06 -> 1.40, the chest top ~1.45, the gut sags to y 0.86), so
// every height here was re-probed off zombie.blob's torso. What the zombie wants is the newer creatures' standard
// (owner, 2026-10-26) on a plain, smooth body: collarbones and the lower ribs SHOWING through slack skin, folds round
// the sagging gut and the armpits, veins down the flanks and arms, the spine's knuckles and the shoulder blades.
// Kept lower and softer than the flayer's (it is not flayed): ribs 2.5 mm proud against the flayer's 3.8.
//
// WHY GENERATED. Detail has to sit ON the skin: every element is placed by probing the torso (sdBody along a ray
// toward the torso axis, the probe the bake uses), sunk so a fixed height stands proud, and bound to the nearest
// spine bone. Edit the tables and re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const NAME = args.find(a => !a.startsWith('--')) ?? 'zombie';
const INCISION = args.includes('--incision');
const src = readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${NAME}.blob`), 'utf8');
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
const AXIS_Z = 0.02;   // the torso masses' centre line (zombie.blob's spine blobs sit at z ~0.02)

/** The skin at height y, angle th (deg; 0 faces +z, +90 is the body's left, +x), and its outward normal. */
function skin(y: number, thDeg: number): { p: V; n: V } {
  const th = thDeg * Math.PI / 180;
  const dir: V = [Math.sin(th), 0, Math.cos(th)];
  const axis: V = [0, y, AXIS_Z];
  let t = 0.6, p = add(axis, mul(dir, t));
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
function boneFor(y: number) { return y < 1.06 ? 'pelvis' : 'spine'; }   // the spine starts at the pelvis tail
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
/** A swelling at a skin point: an ellipsoid sunk so `proud` metres stand out (`depth` = its semi-axis along the
 *  skin normal, r x deep for a flattened lump). */
function lump(y: number, th: number, r: number, proud: number, blend: number, scale = '', depth = r) {
  const s = skin(y, th), c = add(s.p, mul(s.n, proud - depth));
  const b = boneFor(y), { t, at } = boneAt(b, c);
  out.push(`  blob torso on ${b} at=${f(t)} offset=${fv(sub(c, at))} r=${f(r)}${scale} blend=${f(blend)}`);
}

out.push(
  '# GENERATED by scripts/zombie-detail-gen.ts: edit the tables there and re-run, then',
  `# npx tsx scripts/bake-body-normal.ts ${NAME}. These are .blob \`body\` lines folded into the body ONLY for`,
  `# the bake (${NAME}-body-n.png); they are never raymarched. Every element is placed on the probed skin.`,
);

section('collarbones: a ridge from the sternal notch out to each shoulder, the hollow above it left alone');
for (const s of [1, -1]) ridge([[1.448, s * 6], [1.452, s * 28], [1.440, s * 52], [1.418, s * 74]], 0.009, 0.0045, 0.004, 0.007);
lump(1.432, 0, 0.010, 0.002, 0.004);   // the manubrium's knob between them

section('ribs: the lower four arcs a side SHOWING through slack skin, under the pecs and round the flank');
for (const s of [1, -1]) for (const [i, y] of [1.33, 1.29, 1.25, 1.21].entries()) {
  const th0 = 20 + i * 4;   // the costal margin opens downward
  // r 0.009 at 1.8 mm proud: the first bake (r 0.0065, 2.5 mm) read as ladder rungs, too crisp for skin over bone
  ridge([[y + 0.010, s * th0], [y, s * 44], [y - 0.010, s * 72], [y - 0.020, s * 100], [y - 0.026, s * 118]], 0.009, 0.0018, 0.006);
}

section('pecs: a sagging lower edge, and the sternum between them');
for (const s of [1, -1]) ridge([[1.37, s * 8], [1.355, s * 30], [1.36, s * 55], [1.38, s * 72]], 0.012, 0.004, 0.008);
ridge([[1.43, 0], [1.38, 0], [1.32, 0]], 0.007, 0.0022, 0.004);

section('gut: a slack fold over the sag, above the belt');
// Short, soft and broken: a fold right round the front read as a belt in the first bake.
for (const s of [1, -1]) ridge([[1.075 - 0.006, s * 14], [1.075 - 0.002, s * 33], [1.075 + 0.007, s * 52]], 0.013, 0.0025, 0.010);

// ---------------------------------------------------------------- the trousers (below the waist)
// The labourer's trousers are PAINT on the pelvis mass and the thighs (zombie.blob); their cloth is relief here, under
// the kit belt (y 1.025-1.065). Seams and placket edges are narrow ridges; folds are soft and broad.
section('trousers: gathers under the belt, the fly, front and back pockets, side seams, crotch folds');
for (let th = -170; th <= 180; th += 9) if (Math.abs(th) > 14) ridge([[1.024, th], [1.004, th + 1.5]], 0.0035, 0.0018, 0.003);
ridge([[1.022, 4], [0.985, 4], [0.952, 5], [0.935, 8]], 0.006, 0.0022, 0.004);                    // the fly's placket
ridge([[1.020, 13], [0.975, 13], [0.950, 11], [0.938, 6]], 0.0022, 0.0015, 0.0015);               // its stitched edge
for (const s of [1, -1]) {
  ridge([[1.022, s * 30], [1.000, s * 40], [0.982, s * 54], [0.976, s * 66]], 0.0028, 0.0018, 0.002);   // front pocket mouth
  // back pocket: a raised patch with stitched edges
  lump(0.965, s * 152, 0.034, 0.0016, 0.006, ' wide=1.0 tall=1.05 deep=0.25', 0.034 * 0.25);
  ridge([[0.998, s * 136], [0.998, s * 168]], 0.0022, 0.0016, 0.0015);
  ridge([[0.998, s * 136], [0.936, s * 139], [0.926, s * 152], [0.936, s * 165], [0.998, s * 168]], 0.0020, 0.0014, 0.0015);
  ridge([[1.022, s * 90], [0.97, s * 90], [0.90, s * 91]], 0.0045, 0.0018, 0.003);                     // side seam
  for (let k = 0; k < 3; k++)                                                                            // crotch smile folds
    ridge([[0.915 + 0.018 * k, s * 6], [0.925 + 0.020 * k, s * 22], [0.945 + 0.022 * k, s * 40]], 0.007, 0.0028, 0.006);
}

section('back: the spinous processes as knuckles, the erectors either side, the shoulder blades');
for (let y = 1.07; y <= 1.43; y += 0.033) lump(y, 180, 0.010, 0.0045, 0.003);
for (const s of [1, -1]) ridge([[1.00, s * 166], [1.10, s * 165], [1.22, s * 166], [1.34, s * 168]], 0.018, 0.0045, 0.008);
for (const s of [1, -1]) ridge([[1.43, s * 150], [1.38, s * 140], [1.30, s * 132]], 0.013, 0.006, 0.004);
for (const s of [1, -1]) ridge([[1.43, s * 150], [1.42, s * 128], [1.40, s * 112]], 0.010, 0.0045, 0.004);   // the spine of the scapula

section('armpits: a fold where the arm meets the chest');
for (const s of [1, -1]) ridge([[1.40, s * 62], [1.36, s * 80], [1.32, s * 92]], 0.010, 0.004, 0.006);

// Varicose veins: biomech-style.md's recipe (the twinhead's three attempts).
section('varicose veins: serpentine trunks with knots and branches down the flanks and over the lats');
let seed = 4417;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function varicose(y0: number, th0: number, y1: number, dth: number, r: number, proud: number, branches: number, depth = 0) {
  const n = Math.max(6, Math.round((y0 - y1) / 0.009));
  const pts: [number, number][] = [];
  let th = th0, phase = rnd() * 6.28;
  // The recipe's ~1 cm swing, in degrees at this body's ~0.15 m flank radius.
  const amp = (3 + rnd() * 1.5) * (r / 0.006);
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * (i / n);
    pts.push([y, th + amp * Math.sin(phase)]);
    phase += 0.25 + rnd() * 0.12;
    th += dth / n + (rnd() - 0.5) * 0.8;
  }
  ridge(pts, r, proud, 0.0016);
  for (let i = 1; i < pts.length - 1; i++)
    if (rnd() < 0.17) { const [y, t] = pts[i]!; lump(y, t, r * (1.5 + rnd() * 0.6), proud * 1.3, 0.002); }
  for (let b = 0; b < branches; b++) {
    const [y, t] = pts[1 + Math.floor(rnd() * (pts.length - 3))]!;
    const side = rnd() < 0.5 ? -1 : 1;
    if (depth < 1) varicose(y, t, y - 0.07 - rnd() * 0.05, side * (14 + rnd() * 12), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
for (const s of [1, -1]) {
  varicose(1.38, s * 70, 1.04, -s * 14, 0.0055, 0.0038, 2);   // down the flank into the gut
  varicose(1.36, s * 128, 1.08, s * 8, 0.0052, 0.0036, 1);    // over the lats
  varicose(1.42, s * 36, 1.30, s * 12, 0.0045, 0.0032, 1);    // across the upper chest to the armpit
}

if (INCISION) {
  // THE MORGUE'S Y-INCISION: shoulder -> sternum on each side, then one cut down to the pubis. A cut cannot be carved
  // in a body normal map's detail (carve is head-only, and the map only adds), so it is the way a sutured cut heals:
  // a puckered welt with the stitches crossing it every ~2 cm, each stitch a short bar pulled into the skin.
  section('Y-incision: a puckered welt from each shoulder to the sternum and down to the pubis, stitched across');
  const arms: [number, number][][] = [
    [[1.43, 62], [1.40, 44], [1.36, 24], [1.33, 6], [1.32, 0]],
    [[1.43, -62], [1.40, -44], [1.36, -24], [1.33, -6], [1.32, 0]],
    [[1.32, 0], [1.24, 0], [1.16, 1], [1.08, 0], [1.00, -1], [0.92, 0]],
  ];
  for (const a of arms) ridge(a, 0.0055, 0.0030, 0.002);
  // Stitches: walk each arm of the Y by arc length and lay a bar ACROSS the cut every 2 cm, standing a little prouder.
  for (const a of arms) {
    const P = a.map(([y, th]) => skin(y, th).p);
    let carry = 0.01;
    for (let i = 0; i + 1 < P.length; i++) {
      const A = P[i]!, B = P[i + 1]!, L = len(sub(B, A));
      for (let d = carry; d < L; d += 0.02) {
        const c = add(A, mul(sub(B, A), d / L)), u = norm(sub(B, A));
        const { n } = skin(c[1], Math.atan2(c[0], c[2] - AXIS_Z) * 180 / Math.PI);
        const across = norm([u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]]);
        const r = 0.0022, s0 = add(add(c, mul(across, -0.009)), mul(n, 0.0040 - r));
        const bn = boneFor(c[1]), { t, at } = boneAt(bn, s0);
        out.push(`  bar  torso on ${bn} from=${f(t)} to=${f(t)} offset=${fv(sub(s0, at))} tip=${fv(mul(across, 0.018))} r=${f(r)} blend=0.001`);
        carry = d + 0.02 - L;
      }
    }
  }
}

// ---------------------------------------------------------------- arms
// The arms have their own normal-map regions (a cylinder round each bone). Their detail is placed on the ARM skin
// (the arm clusters alone) and bound to the arm bone it lies on, one side at a time.
const armBody = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'armL' || c.limb === 'armR' })) } as typeof built;
const legBody = { ...built, clusters: built.clusters.map(c => ({ ...c, alive: c.limb === 'legL' || c.limb === 'legR' })) } as typeof built;
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Limb skin round bone `b` at fraction t and angle ph (deg; 0 = the bone frame's front, +90 = outward). */
function limbSkin(b: string, t: number, ph: number, field: typeof built): { p: V; n: V } {
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
function limbVaricose(limb: 'arm' | 'leg', b: string, t0: number, t1: number, ph0: number, dph: number, r: number, proud: number, branches: number, depth = 0) {
  const field = limb === 'arm' ? armBody : legBody;
  const [bone, side] = b.split('.') as [string, string];
  const n = Math.max(8, Math.round(Math.abs(t1 - t0) * 70));
  // A long, lazy meander (wavelength ~10 cm, swing ~1 cm): the twinhead's ~3.5 cm read as crumpled skin.
  let phase = rnd() * 6.28;
  const amp = 4.5 + rnd() * 3;
  const S: { c: V; t: number; ph: number; rr: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n), ph = ph0 + dph * (i / n) + amp * Math.sin(phase);
    phase += 0.22 + rnd() * 0.14;
    const k = Math.sin(Math.PI * Math.min(1, (i / n) * 1.1 + 0.05));   // taper at the ends
    const rr = r * (0.55 + 0.45 * k), sk = limbSkin(b, t, ph, field);
    S.push({ c: add(sk.p, mul(sk.n, proud * (0.6 + 0.4 * k) - rr)), t, ph, rr });
  }
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!.c, B = S[i + 1]!.c, { t, at } = limbBoneT(b, A);
    out.push(`  bar  ${limb} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${f(S[i]!.rr)} r2=${f(S[i + 1]!.rr)} blend=0.0016 side=${side}`);
  }
  for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.18) {
    const sk = limbSkin(b, S[i]!.t, S[i]!.ph, field), kr = S[i]!.rr * (1.5 + rnd() * 0.6);
    const c = add(sk.p, mul(sk.n, proud * 1.3 - kr)), { t, at } = limbBoneT(b, c);
    out.push(`  blob ${limb} on ${bone} at=${f(t)} offset=${fv(sub(c, at))} r=${f(kr)} blend=0.002 side=${side}`);
  }
  for (let k = 0; k < branches && depth < 1; k++) {
    const s0 = S[2 + Math.floor(rnd() * (S.length - 5))]!;
    limbVaricose(limb, b, s0.t, Math.min(0.95, s0.t + 0.18 + rnd() * 0.15), s0.ph, (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 25), r * 0.65, proud * 0.75, 1, depth + 1);
  }
}
/** A soft ridge along a limb (a tendon, the edge of a muscle), from (t0, ph0) to (t1, ph1). */
function limbRidge(limb: 'arm' | 'leg', b: string, t0: number, t1: number, ph0: number, ph1: number, r: number, proud: number) {
  const field = limb === 'arm' ? armBody : legBody;
  const [bone, side] = b.split('.') as [string, string];
  const n = 8, S: V[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, sk = limbSkin(b, t0 + (t1 - t0) * k, ph0 + (ph1 - ph0) * k, field);
    S.push(add(sk.p, mul(sk.n, proud * Math.sin(Math.PI * (0.1 + 0.8 * k)) - r)));
  }
  for (let i = 0; i + 1 < n; i++) {
    const { t, at } = limbBoneT(b, S[i]!);
    out.push(`  bar  ${limb} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(S[i]!, at))} tip=${fv(sub(S[i + 1]!, S[i]!))} r=${f(r)} blend=0.004 side=${side}`);
  }
}
section('arms: veins down the biceps, outer arm and forearm; the forearm tendons into the wrist');
for (const sd of ['l', 'r']) {
  limbVaricose('arm', `upperArm.${sd}`, 0.08, 0.92, 15, 15, 0.0055, 0.0040, 1);
  limbVaricose('arm', `upperArm.${sd}`, 0.12, 0.88, 160, 25, 0.0050, 0.0035, 1);
  limbVaricose('arm', `foreArm.${sd}`, 0.05, 0.86, 25, 25, 0.0050, 0.0036, 1);
  limbVaricose('arm', `foreArm.${sd}`, 0.06, 0.82, -110, -25, 0.0046, 0.0033, 0);
  for (const ph of [-20, 15, 50]) limbRidge('arm', `foreArm.${sd}`, 0.55, 0.92, ph, ph * 0.8, 0.0040, 0.0025);
  limbRidge('arm', `upperArm.${sd}`, 0.70, 0.98, 175, 180, 0.010, 0.004);   // the elbow's point
}
section('trouser legs: seams, the long folds a leg hangs in, the knee, crotch drag folds, a knee patch');
let fseed = 771;
const frnd = () => ((fseed = (fseed * 16807) % 2147483647) / 2147483647);
for (const sd of ['l', 'r']) {
  const b = `thigh.${sd}`;
  limbRidge('leg', b, 0.03, 0.97, 90, 90, 0.0045, 0.0018);                 // outseam
  limbRidge('leg', b, 0.08, 0.97, -90, -92, 0.0045, 0.0018);               // inseam
  for (const ph of [-35, 20, 60, 140, -150]) {                            // hanging folds, wandering a little
    const p1 = ph + (frnd() - 0.5) * 30;
    limbRidge('leg', b, 0.10 + frnd() * 0.08, 0.55 + frnd() * 0.15, ph, p1, 0.010, 0.0030);
  }
  for (let k = 0; k < 4; k++) {                                           // compression folds behind the knee
    const t = 0.80 + 0.045 * k;
    limbRidge('leg', b, t, t + 0.01, 130, 230, 0.0065, k % 2 ? 0.0020 : 0.0034);
  }
  for (let k = 0; k < 2; k++) limbRidge('leg', b, 0.86 + 0.05 * k, 0.87 + 0.05 * k, -40, 40, 0.006, 0.0022);   // over the knee
  for (let k = 0; k < 3; k++) limbRidge('leg', b, 0.04 + 0.07 * k, 0.24 + 0.07 * k, -100, -30, 0.008, 0.0028);   // crotch drag
}
// a knee patch on the left leg: a raised panel and its stitched edge
limbRidge('leg', 'thigh.l', 0.80, 0.98, -10, 15, 0.030, 0.0018);
for (const ph of [-28, 32]) limbRidge('leg', 'thigh.l', 0.78, 0.99, ph, ph, 0.0022, 0.0016);

const path = resolve(ROOT, `src/lab/sdf-zombie/characters/${NAME}.detail`);
writeFileSync(path, out.join('\n') + '\n');
console.log(`zombie-detail-gen: ${NAME}.detail, ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
