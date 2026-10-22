// scripts/seated-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/<chair|gamer>.detail: the seated men's BAKED surface detail (scripts/
// bake-body-normal.ts folds these lines into the body and bakes the difference into <name>-body-n.png; nothing
// here is ever raymarched). CHARACTER picks the body (default chair). twinhead-detail-gen.ts's recipe.
//
// A SCALED body (the gamer: `scale 1.30`): probing runs on the COMPILED body, so every number is compiled metres,
// and each emitted offset, tip and radius is divided back by the scale (the .detail is folded in BEFORE compile).
//
// THE CHAIR:
//   - varicose veins (the owner: "would be cool to have more varicose veins baked in"), the recipe in
//     biomech-style.md: ~10 cm wavelength, ~1 cm swing, 5-11 mm samples, knots, a branch;
//   - veins spreading out of him across the skin MEMBRANE of the backboard;
//   - his ribs showing through the gaunt flanks;
//   - the Y-incision and two welts as raised keloid with stitch bumps across the cut. They were kit tubes
//     first, painted red: "too bright and look like plastic straws". In relief only, they take the skin's
//     colour and light.
//
//   npx tsx scripts/seated-detail-gen.ts && npx tsx scripts/bake-body-normal.ts chair 512 320 \
//     --limb clavicle.l:0:1:0.11:64 --limb clavicle.r:0:1:0.11:64 --limb upperarm.l:0:1:0.08:64 --limb upperarm.r:0:1:0.08:64
//
// THE GAMER: varicose veins over his chest, flanks and gut, stretch marks across the gut's sides, veins down his
// thighs and calves (owner: the gamer "just needs more details ... with the normal mapping and veins").
//
//   CHARACTER=gamer npx tsx scripts/seated-detail-gen.ts && npx tsx scripts/bake-body-normal.ts gamer 512 320 \
//     --limb clavicle.l:0:1:0.15:64 --limb clavicle.r:0:1:0.15:64 --limb upperarm.l:0:1:0.10:64 --limb upperarm.r:0:1:0.10:64 \
//     --torso-seg stick:0,1.06,0.585:0,1.355,0.591:0.075:96 \
//     --torso-seg forearm.l:0.33,1.03,0.08:0.08,1.13,0.58:0.085:64 --torso-seg forearm.r:-0.33,1.03,0.08:-0.08,1.13,0.58:0.085:64 \
//     --torso-seg upperarm.l:0.255,1.33,0.048:0.31,1.02,0.135:0.095:64 --torso-seg upperarm.r:-0.255,1.33,0.048:-0.31,1.02,0.135:0.095:64
//   The --torso-seg regions give the joystick and his arms (torso flesh, in front of the gut) their own cylinders:
//   with the torso's alone, the arms and stick occluded the gut and smeared.
//
// Every element is placed by PROBING the marched skin (torso cluster for the torso, the arm clusters for the legs),
// then sunk so `proud` metres stand out. Edit the tables below and re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CH = process.env.CHARACTER ?? 'chair';
const doc = parseBlob(readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${CH}.blob`), 'utf8'));
const SC = doc.scale ?? 1;
const built = buildBody(compileBlob(doc, compileFace(doc)));
const only = (limbs: string[]) => ({ ...built, clusters: built.clusters.map(c => ({ ...c, alive: limbs.includes(c.limb) })) }) as typeof built;
const torso = only(['torso']);
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fv = (v: V) => `(${v.map(n => f(n / SC)).join(',')})`;
const fr = (n: number) => f(n / SC);

type Skin = { p: V; n: V };
function normalAt(p: V, body: typeof built): V {
  const e = 6e-4, d0 = sdBody(p, body);
  return norm([sdBody(add(p, [e, 0, 0]), body) - d0, sdBody(add(p, [0, e, 0]), body) - d0, sdBody(add(p, [0, 0, e]), body) - d0]);
}
/** March from `from` along `dir` to the first surface of `body`. */
function march(from: V, dir: V, body: typeof built): Skin | null {
  let t = 0, p = from;
  for (let i = 0; i < 500; i++) {
    const d = sdBody(p, body);
    if (d < 1e-4) return { p, n: normalAt(p, body) };
    t += Math.max(d * 0.85, 2e-4);
    if (t > 1.2) return null;
    p = add(from, mul(dir, t));
  }
  return null;
}
/** The torso skin seen from the FRONT at (x, y): his chest and belly, and the membrane beside him. */
// The gamer's joystick reaches z 0.63, so his probe starts further out (the march gives up past 1.2 m, so the
// chair's must stay at 0.6 or its membrane, behind z 0, falls out of reach).
const FRONT_Z = CH === 'gamer' ? 1.0 : 0.6;
const front = (x: number, y: number) => march([x, y, FRONT_Z], [0, 0, -1], torso);

function boneFor(y: number) { const sp = bones.get('spine')!.tail[1], ch = bones.get('chest')!.tail[1]; return y < sp ? 'spine' : y < ch ? 'chest' : 'neck'; }
function boneAt(b: string, p: V): { t: number; at: V } {
  const { head, tail } = bones.get(b)!;
  const d = sub(tail, head);
  const t = Math.min(1, Math.max(0, dot(sub(p, head), d) / dot(d, d)));
  return { t, at: add(head, mul(d, t)) };
}

const out: string[] = [
  '# GENERATED by scripts/seated-detail-gen.ts: edit the tables there and re-run, then bake (the command is in',
  `# that script's header). These are .blob \`body\` lines folded into the body ONLY for the bake (${CH}-body-n.png);`,
  '# they are never raymarched. Every element is placed on the probed skin.',
];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);

let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Bars along skin points, each sunk so `proud` stands out; radius per point. */
function ridgeAt(S: Skin[], r: number[], proud: number, blend: number) {
  const C = S.map((s, i) => add(s.p, mul(s.n, proud - r[i]!)));
  for (let i = 0; i + 1 < C.length; i++) {
    const A = C[i]!, B = C[i + 1]!, b = boneFor(A[1]), { t, at } = boneAt(b, A);
    out.push(`  bar  torso on ${b} from=${f(t)} to=${f(t)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${fr(r[i]!)} r2=${fr(r[i + 1]!)} blend=${fr(blend)}`);
  }
}
function lumpAt(s: Skin, r: number, proud: number, blend: number, scale = '') {
  const c = add(s.p, mul(s.n, proud - r)), b = boneFor(c[1]), { t, at } = boneAt(b, c);
  out.push(`  blob torso on ${b} at=${f(t)} offset=${fv(sub(c, at))} r=${fr(r)}${scale} blend=${fr(blend)}`);
}
/** Front-probed skin along a 2-D (x, y) polyline, `n` samples. */
function frontPath(pts: [number, number][], n: number): Skin[] {
  const S: Skin[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n * (pts.length - 1), k = Math.min(Math.floor(u), pts.length - 2), t = u - k;
    const s = front(pts[k]![0] + (pts[k + 1]![0] - pts[k]![0]) * t, pts[k]![1] + (pts[k + 1]![1] - pts[k]![1]) * t);
    if (s) S.push(s);
  }
  return S;
}

// ---------------------------------------------------------------- varicose veins (biomech-style.md's recipe)
/** A trunk from (x0, y0) toward (x1, y1) on the front-probed skin: a lazy meander, knots, `branches` branches. */
function varicose(x0: number, y0: number, x1: number, y1: number, r: number, proud: number, branches: number, depth = 0, ampK = 1) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(8, Math.round(L / 0.011));
  const along: [number, number] = [(x1 - x0) / L, (y1 - y0) / L], perp: [number, number] = [-along[1], along[0]];
  let phase = rnd() * 6.28;
  const amp = (0.008 + rnd() * 0.005) * ampK;
  const S: Skin[] = [], R: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, w = amp * Math.sin(phase);
    phase += 0.55 + rnd() * 0.30;                               // ~10 cm wavelength at 11 mm samples
    const s = front(x0 + (x1 - x0) * u + perp[0] * w, y0 + (y1 - y0) * u + perp[1] * w);
    if (!s) continue;
    S.push(s); R.push(r * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05))));
  }
  if (S.length < 3) return;
  ridgeAt(S, R, proud, 0.0016);
  for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.18) lumpAt(S[i]!, R[i]! * (1.5 + rnd() * 0.6), proud * 1.3, 0.002);
  for (let b = 0; b < branches && depth < 1; b++) {
    const s0 = S[1 + Math.floor(rnd() * (S.length - 3))]!, a = Math.atan2(y1 - y0, x1 - x0) + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.45);
    const l = 0.05 + rnd() * 0.05;
    varicose(s0.p[0], s0.p[1], s0.p[0] + Math.cos(a) * l * ampK, s0.p[1] + Math.sin(a) * l * ampK, r * 0.65, proud * 0.75, 1, depth + 1, ampK);
  }
}
if (CH === 'gamer') {
  // Compiled metres (scale 1.30). His forearms and hands lie across the gut in front, so the front probe there
  // lands on them too: veins on his forearms are welcome.
  section('varicose veins: over his chest and flanks, down his gut and its sides');
  for (const s of [1, -1]) {
    varicose(s * 0.16, 1.30, s * 0.20, 1.06, 0.0075, 0.0050, 2);   // down the flank
    varicose(s * 0.07, 1.30, s * 0.12, 1.16, 0.0065, 0.0045, 1);   // over the breast
    varicose(s * 0.14, 1.02, s * 0.20, 0.82, 0.0075, 0.0050, 2);   // down the gut's side
    varicose(s * 0.05, 0.98, s * 0.09, 0.80, 0.0065, 0.0045, 1);   // low on the gut, under his arms
    varicose(s * 0.27, 1.30, s * 0.31, 1.10, 0.0065, 0.0045, 1);   // down the upper arm
  }
  // THE JOYSTICK (owner: its veins, sores and pustules as prims "looks like tubes and skittles ... can be done in
  // normal map"). It has its own torso region in the bake (--torso-seg stick, along its axis), so its detail is
  // placed ALL ROUND it by probing in toward that axis: grip y 1.06-1.22, the tip to its point at 1.35, z ~0.59.
  const stickAxis = (y: number): V => [0, y, y < 1.219 ? 0.585 : 0.585 + 0.005 * (y - 1.219) / 0.130];
  const stickSkin = (y: number, ph: number) => {
    const a = ph * Math.PI / 180, dir: V = [Math.sin(a), 0, Math.cos(a)];
    return march(add(stickAxis(y), mul(dir, 0.12)), mul(dir, -1), torso);
  };
  section('the joystick: fine veins winding up the grip and the cone, all round');
  for (const [ph0, turn] of [[20, 110], [110, -90], [200, 80], [290, -100]] as const) {
    const S: Skin[] = [], R: number[] = [];
    let phase = rnd() * 6.28;
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const u = i / n, y = 1.07 + 0.25 * u, ph = ph0 + turn * u + 9 * Math.sin(phase);
      phase += 0.5 + rnd() * 0.3;
      const sk = stickSkin(y, ph);
      if (sk) { S.push(sk); R.push(0.0036 * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05)))); }
    }
    ridgeAt(S, R, 0.0026, 0.0012);
    for (let i = 2; i < S.length - 2; i++) if (rnd() < 0.15) lumpAt(S[i]!, R[i]! * 1.6, 0.0034, 0.0015);
  }
  section('the joystick: an infected crust round the orifice at the point, and sores');
  for (let k = 0; k < 22; k++) {
    const sk = stickSkin(1.305 + rnd() * 0.038, rnd() * 360);
    if (sk) lumpAt(sk, 0.0030 + rnd() * 0.0030, 0.0020 + rnd() * 0.0020, 0.0015);
  }
  for (const [cy, cph] of [[1.250, 40], [1.275, -60], [1.230, 170], [1.26, 250]] as const)
    for (let k = 0; k < 7; k++) {
      const a = 2 * Math.PI * k / 7, sk = stickSkin(cy + 0.007 * Math.sin(a), cph + 14 * Math.cos(a));
      if (sk) lumpAt(sk, 0.0024, 0.0018, 0.0010);
    }
  section('veins off the grip over the backs of his hands');
  for (const s of [1, -1]) {
    varicose(s * 0.030, 1.175, s * 0.100, 1.160, 0.0042, 0.0030, 1, 0, 0.4);
    varicose(s * 0.028, 1.135, s * 0.095, 1.120, 0.0038, 0.0028, 0, 0, 0.4);
  }
  section('stretch marks: shallow raised streaks fanning across the gut\'s sides');
  for (const s of [1, -1]) for (let k = 0; k < 6; k++) {
    const y = 0.86 + k * 0.035, x = 0.19 + 0.01 * Math.sin(k * 1.7);
    const S = frontPath([[s * x, y], [s * (x - 0.03), y + 0.012], [s * (x - 0.065), y + 0.016]], 6);
    ridgeAt(S, S.map((_, i) => 0.0030 * (0.6 + 0.4 * Math.sin(Math.PI * i / Math.max(1, S.length - 1)))), 0.0012, 0.0012);
  }
} else {
  // ---------------------------------------------------------------- scars: keloid with stitch bumps
  section('scars: the Y-incision and two welts, raised keloid, stitch bumps across the cut');
  const SCARS: { pts: [number, number][]; n: number; stitched: boolean }[] = [
    { pts: [[0.135, 1.020], [0.070, 0.975], [0.000, 0.935]], n: 14, stitched: true },
    { pts: [[-0.135, 1.020], [-0.070, 0.975], [0.000, 0.935]], n: 14, stitched: true },
    { pts: [[0.000, 0.935], [0.004, 0.840], [-0.004, 0.760]], n: 18, stitched: true },
    { pts: [[-0.115, 0.960], [-0.075, 0.900], [-0.060, 0.860]], n: 10, stitched: false },
    { pts: [[0.095, 0.860], [0.125, 0.820], [0.130, 0.780]], n: 10, stitched: false },
  ];
  for (const sc of SCARS) {
    const S = frontPath(sc.pts, sc.n);
    ridgeAt(S, S.map(() => 0.0040), 0.0022, 0.0012);
    if (!sc.stitched) continue;
    for (let i = 1; i + 1 < S.length; i += 2) {                 // a stitch: a bump either side of the cut
      const d = norm(sub(S[i + 1]!.p, S[i - 1]!.p)), side = norm(cross(d, S[i]!.n));
      for (const k of [-1, 1]) {
        const s = front(S[i]!.p[0] + side[0] * 0.008 * k, S[i]!.p[1] + side[1] * 0.008 * k);
        if (s) lumpAt(s, 0.0028, 0.0018, 0.0008);
      }
    }
  }

  // ---------------------------------------------------------------- ribs
  section('ribs: arcs showing through the gaunt flanks');
  for (const s of [1, -1]) for (const [y, x0, x1] of [[0.98, 0.07, 0.14], [0.94, 0.08, 0.15], [0.90, 0.09, 0.15], [0.86, 0.10, 0.145]] as const) {
    const S = frontPath([[s * x0, y + 0.012], [s * (x0 + x1) / 2, y], [s * x1, y - 0.020]], 6);
    ridgeAt(S, S.map(() => 0.006), 0.0020, 0.003);
  }

  section('varicose veins: down his flanks and belly, over his shoulders and down his upper arms');
  for (const s of [1, -1]) {
    varicose(s * 0.11, 1.03, s * 0.13, 0.78, 0.0060, 0.0040, 2);   // down the flank
    varicose(s * 0.05, 0.86, s * 0.09, 0.66, 0.0055, 0.0038, 1);   // over the belly
    varicose(s * 0.17, 1.05, s * 0.21, 0.82, 0.0055, 0.0038, 1);   // down the front of the upper arm
    varicose(s * 0.06, 1.06, s * 0.16, 1.04, 0.0045, 0.0032, 1);   // across the collarbone
  }
  section('veins spreading out of him across the membrane of the backboard');
  for (const s of [1, -1]) {
    varicose(s * 0.12, 1.12, s * 0.20, 1.40, 0.0065, 0.0045, 2);   // up beside his head
    varicose(s * 0.13, 1.08, s * 0.21, 1.15, 0.0060, 0.0042, 2);   // out from his shoulders
    varicose(s * 0.15, 0.95, s * 0.21, 0.70, 0.0060, 0.0042, 2);   // down behind his arms
    varicose(s * 0.06, 1.30, s * 0.12, 1.44, 0.0050, 0.0036, 1);   // over the top of his head
  }

}

// ---------------------------------------------------------------- the legs: thighs (clavicle) and shins (upperarm)
const legs = only(['armL', 'armR']);
/** Leg skin round bone `b` at fraction t and angle ph (deg; 0 = the bake frame's front, +90 = outward). */
function legSkin(b: string, t: number, ph: number): Skin | null {
  const { head, tail } = bones.get(b)!;
  const u = norm(sub(tail, head)), fw = norm(sub([0, 0, 1], mul(u, u[2]))), s = cross(fw, u);
  const o = b.endsWith('.r') ? -1 : 1, a = ph * Math.PI / 180;
  const dir = norm(add(mul(fw, Math.cos(a)), mul(s, o * Math.sin(a))));
  const axis = add(head, mul(sub(tail, head), t));
  const hit = march(add(axis, mul(dir, 0.3)), mul(dir, -1), legs);
  return hit;
}
function legVein(b: string, t0: number, t1: number, ph0: number, dph: number, r: number, proud: number) {
  const [bone, side] = b.split('.') as [string, string];
  const { head, tail } = bones.get(b)!, d = sub(tail, head);
  const n = Math.max(8, Math.round(Math.abs(t1 - t0) * len(d) / 0.011));
  let phase = rnd() * 6.28;
  const amp = 8 + rnd() * 6;
  const C: { c: V; rr: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * (i / n), ph = ph0 + dph * (i / n) + amp * Math.sin(phase);
    phase += 0.55 + rnd() * 0.30;
    const k = Math.sin(Math.PI * Math.min(1, (i / n) * 1.1 + 0.05)), rr = r * (0.55 + 0.45 * k), sk = legSkin(b, t, ph);
    if (sk) C.push({ c: add(sk.p, mul(sk.n, proud - rr)), rr });
  }
  for (let i = 0; i + 1 < C.length; i++) {
    const A = C[i]!.c, B = C[i + 1]!.c;
    const tt = Math.min(1, Math.max(0, dot(sub(A, head), d) / dot(d, d))), at = add(head, mul(d, tt));
    out.push(`  bar  arm on ${bone} from=${f(tt)} to=${f(tt)} offset=${fv(sub(A, at))} tip=${fv(sub(B, A))} r=${fr(C[i]!.rr)} r2=${fr(C[i + 1]!.rr)} blend=${fr(0.0016)} side=${side}`);
  }
}
if (CH === 'gamer') {
  section('leg veins: over each swollen thigh and down each calf');
  for (const sd of ['l', 'r']) {
    legVein(`clavicle.${sd}`, 0.20, 0.90, 30, 25, 0.0075, 0.0050);
    legVein(`clavicle.${sd}`, 0.25, 0.85, 95, -20, 0.0070, 0.0046);
    legVein(`upperarm.${sd}`, 0.08, 0.85, 0, 30, 0.0065, 0.0045);
    legVein(`upperarm.${sd}`, 0.10, 0.80, 100, -25, 0.0060, 0.0042);
  }
} else {
  section('leg veins: over each thigh and down each shin');
  for (const sd of ['l', 'r']) {
    legVein(`clavicle.${sd}`, 0.20, 0.90, 30, 25, 0.0060, 0.0042);
    legVein(`clavicle.${sd}`, 0.25, 0.85, 95, -20, 0.0055, 0.0038);
    legVein(`upperarm.${sd}`, 0.08, 0.85, 0, 30, 0.0050, 0.0035);
    legVein(`upperarm.${sd}`, 0.10, 0.80, 100, -25, 0.0045, 0.0032);
  }

}

writeFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${CH}.detail`), out.join('\n') + '\n');
console.log(`seated-detail-gen ${CH}: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
