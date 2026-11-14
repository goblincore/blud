// scripts/organ-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/organ.detail: the organ's BAKED flesh detail (the bellows' leathery pleat
// wrinkles, veins feeding the flank mouths, puckered flesh where the saddle presses, the upper legs' muscle), folded
// into the body by scripts/bake-body-normal.ts and baked into organ-body-n.png. Nothing here is ever raymarched.
// Copied from scripts/gorehound-detail-gen.ts (same rig, same frame; the helpers are unchanged).
//
//   npx tsx scripts/organ-detail-gen.ts && npx tsx scripts/bake-body-normal.ts organ 512 320 \
//     --torso-axis 0,0.86,-0.36:0,0.92,1.20 \
//     --limb upperarm.l:0:1:0.20:96 --limb upperarm.r:0:1:0.20:96 --limb thigh.l:0:1:0.21:96 --limb thigh.r:0:1:0.21:96
//
// THE QUADRUPED'S FRAME (the gorehound's). twinhead-detail-gen.ts probes round a VERTICAL torso axis; the gorehound's torso lies
// along z, so this probes round the SAME segment the bake is told to use (TORSO_AXIS below = --torso-axis), in
// the bake's own frame: A = the axis, f = rest +z made perpendicular to A (here: nearly straight DOWN, the
// belly), s = f x A (here: -x, the body's right). An angle ph is measured from f toward s, so ph 0 = belly,
// +-90 = the flanks (+90 the right, -90 the left), 180 = the spine. t runs rump (0) -> neck (1).
// The limbs use the same frame round each bone, exactly as the bake's limb regions do.
//
// The vein recipe is biomech-style.md's (the twinhead's third attempt): trunks 5-6.5 mm thick and 3.5-4.5 mm
// proud, sampled every 5-11 mm, a sine meander of ~10 cm wavelength and ~1 cm swing (never alternating sides per
// sample: that bakes as zigzags), tapered at both ends, a knot every ~5 samples, branches peeling off at 30-55 deg.
// Edit the tables below and re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const doc = parseBlob(readFileSync('src/lab/sdf-zombie/characters/organ.blob', 'utf8'));
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
export const TORSO_AXIS: [V, V] = [[0, 0.86, -0.36], [0, 0.92, 1.20]];

interface Region { head: V; tail: V; body: typeof built; limb: 'torso' | 'arm' | 'leg'; side?: string }
const torso: Region = { head: TORSO_AXIS[0], tail: TORSO_AXIS[1], body: only(['torso']), limb: 'torso' };
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
function torsoBone(p: V): string { return p[2] < 0.05 ? 'pelvis' : p[2] < 0.86 ? 'spine' : p[2] < 1.02 ? 'chest' : 'neck'; }
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

let seed = 7151;
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
  '# GENERATED by scripts/organ-detail-gen.ts: edit the tables there and re-run, then bake (the command is in',
  '# that script\'s header). These are .blob `body` lines folded into the body ONLY for the bake',
  '# (organ-body-n.png); they are never raymarched. Every element is placed on the probed skin.',
);

// ---------------------------------------------------------------- torso
// ph: 0 belly, +-90 the flanks, 180 the spine. t: rump 0 -> neck 1 along TORSO_AXIS (z = -0.36 + 1.56 t).
// The five folds' crowns (organ.blob, spine t 0.08..0.92: z 0.068 / 0.248 / 0.427 / 0.606 / 0.786) sit at
// t 0.274 / 0.390 / 0.504 / 0.619 / 0.735; the mouths are on the middle three at ph ~+-92.
const FOLDS = [0.274, 0.390, 0.504, 0.619, 0.735];
const MOUTHS = [0.390, 0.504, 0.619];
/** True near a flank mouth (its lips and teeth must stay clean: detail there reads as a scar across the lips). */
const nearMouth = (t: number, ph: number) => MOUTHS.some(m => Math.abs(t - m) < 0.065 && Math.abs(Math.abs(ph) - 92) < 26);

section('pleat wrinkles: the bellows\' leather creased round the barrel on every fold, like an accordion\'s hide');
for (const t of FOLDS) for (const dt of [-0.028, 0, 0.028]) for (const s of [1, -1]) {
  // arcs round the barrel from the belly to the saddle's edge, broken where a mouth sits
  let run: [number, number][] = [];
  for (let ph = 18; ph <= 150; ph += 11) {
    const tt = t + dt + 0.004 * Math.sin(ph * 0.11 + t * 40);
    if (nearMouth(tt, ph)) { if (run.length > 1) ridge(torso, run, 0.007, 0.003, 0.003); run = []; continue; }
    run.push([tt, s * ph]);
  }
  if (run.length > 1) ridge(torso, run, 0.007, 0.003, 0.003);
}
// Thicker than the recipe's 5-6.5 mm (7.5-8 mm, 5 mm proud): on a 0.7 m barrel the recipe's trunks baked as cracks.
section('veins feeding the mouths: trunks from the belly and the saddle\'s edge converging on each mouth\'s corners');
for (const s of [1, -1]) for (const m of MOUTHS) {
  varicose(torso, m - 0.10, m - 0.055, s * 40, s * 25, 0.0078, 0.0052, 1);    // up from the belly to the rear corner
  varicose(torso, m + 0.10, m + 0.055, s * 140, s * -22, 0.0075, 0.0050, 1);  // down from the saddle to the front corner
}
section('veins down the haunch and the shoulders');
for (const s of [1, -1]) {
  varicose(torso, 0.24, 0.06, s * 120, s * -30, 0.0080, 0.0052, 2);
  varicose(torso, 0.76, 0.86, s * 110, s * -30, 0.0075, 0.0050, 1);
}
section('agitated flesh: swellings puckered round the saddle\'s edge, where the windchest presses in');
for (const s of [1, -1]) for (const t of [0.30, 0.38, 0.47, 0.55, 0.63, 0.71])
  lump(torso, t + 0.01 * Math.sin(t * 50), s * (158 - 4 * Math.cos(t * 30)), 0.011, 0.006, 0.004);

// ---------------------------------------------------------------- flesh upper limbs: humerus and femur
section('upper limbs: muscle separations and varicose veins on the humerus and the haunch');
for (const sd of ['l', 'r']) {
  const arm = limbRegion(`upperarm.${sd}`), leg = limbRegion(`thigh.${sd}`);
  ridge(arm, [[0.15, 160], [0.45, 165], [0.80, 170]], 0.016, 0.005, 0.006);
  varicose(arm, 0.10, 0.85, 80, 20, 0.0060, 0.0042, 1);
  ridge(leg, [[0.10, 30], [0.45, 25], [0.85, 20]], 0.018, 0.005, 0.006);
  varicose(leg, 0.08, 0.85, 95, -20, 0.0062, 0.0042, 1);
}

writeFileSync('src/lab/sdf-zombie/characters/organ.detail', out.join('\n') + '\n');
console.log(`organ-detail-gen: ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims`);
