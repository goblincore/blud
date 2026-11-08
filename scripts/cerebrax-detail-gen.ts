// scripts/cerebrax-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/cerebrax.detail: the cerebrax brain's BAKED folds (scripts/bake-body-normal.ts
// folds these lines into the body and bakes the difference into cerebrax-body-n.png; nothing here is ever raymarched).
//
//   npx tsx scripts/cerebrax-detail-gen.ts && \
//     npx tsx scripts/bake-body-normal.ts cerebrax 1024 320 --torso-axis 0,2.48,0.401:0,1.30,0.40 --torso-r0 1.1
//   (the GPU bake: seconds)
//
// THE FOLDS ARE A RANDOM-WAVE LABYRINTH. A brain's gyri are fat sausages of cortex packed side by side, meandering
// in long smooth curves, never crossing, separated by narrow creases (the sulci). Hand-placed folds read as rows or
// hoops (the teratoma's crown folds are bands at fixed heights). The NODAL LINES of a narrow-band random wave field
// (a sum of many plane waves of one wavelength, random directions and phases) are exactly that shape: a labyrinth of
// long meandering curves at a nearly constant spacing, which avoid each other rather than cross. So:
//   1. N(p) = sum of ~64 cos(k d_i . p + phase_i), evaluated in 3D at the brain's surface (no projection, so no
//      stretching of the pattern anywhere), with a slow domain warp so the spacing breathes;
//   2. its zero contour, traced by marching squares on a fine lat/lon grid of directions from the brain's centre;
//   3. each contour resampled every ~2 cm in 3D and laid on the PROBED skin (sdBody along the ray) as a chain of
//      rounded ridges, wide enough that neighbours meet: the crease where two meet is the sulcus.
// This is the vein recipe's rule applied to folds (biomech-style.md): long smooth meanders, short samples, never a
// per-sample zigzag.
//
// GAPS. No folds where the longitudinal fissure runs over the top between the hemispheres (it reads as a deep
// groove because both banks stop at it), along each lateral (Sylvian) fissure, over the face, and below the harness
// ring (hidden). Fold lines stop short of every gap and their ends taper.
//
// A SCALED body (`scale 1.60`): probing runs on the COMPILED body, so every number here is compiled metres, and each
// emitted offset, tip and radius is divided back by the scale (the .detail is folded in BEFORE compile), as
// scripts/seated-detail-gen.ts does for the gamer.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/cerebrax.blob'), 'utf8');
const doc = parseBlob(src);
const SC = doc.scale ?? 1;
const built = buildBody(compileBlob(doc, compileFace(doc)));
// The brain alone: only the skull-bound torso prims (the frame's metal bars run under it).
const brainPrims = built.prims.filter(p => p.limb === 'torso' && p.bone === 'skull');
const body = { ...built, split: undefined, prims: brainPrims, clusters: [{ ...built.clusters.find(c => c.limb === 'torso')!, start: 0, count: brainPrims.length, alive: true }] } as typeof built;
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;
/** The brain's centre: the skull bone's head, the aim pivot. Every detail prim binds there. */
const C = bones.get('skull')!.head;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
/** Compiled metres -> the authored numbers the .detail is written in. */
const fa = (n: number) => f(n / SC);
const fv = (v: V) => `(${v.map(fa).join(',')})`;
const D2R = Math.PI / 180;

/** Unit direction from the brain's centre: lat up from the equator, lon 0 facing +z (the face), +90 the body's left. */
function dirOf(lat: number, lon: number): V {
  const cl = Math.cos(lat * D2R);
  return [cl * Math.sin(lon * D2R), Math.sin(lat * D2R), cl * Math.cos(lon * D2R)];
}

/** The skin along the ray from the centre in direction d (marched inward from outside), and its outward normal. */
function skinDir(d: V): { p: V; n: V } | null {
  let t = 1.4, p = add(C, mul(d, t));
  for (let i = 0; i < 400; i++) {
    const s = sdBody(p, body);
    if (s < 1e-4) break;
    t -= Math.max(s * 0.9, 2e-4);
    if (t <= 0) return null;
    p = add(C, mul(d, t));
  }
  const e = 6e-4, d0 = sdBody(p, body);
  const n = norm([sdBody(add(p, [e, 0, 0]), body) - d0, sdBody(add(p, [0, e, 0]), body) - d0, sdBody(add(p, [0, 0, e]), body) - d0]);
  return { p, n };
}

let seed = 90210;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function randUnit(): V {
  const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

// --- THE FIELD --------------------------------------------------------------------------------------------------
// WAVELENGTH sets the gyri: neighbouring nodal lines of a random wave field lie about half an (effective, on-surface)
// wavelength apart. On a 1.34 m brain, gyri the proportion of a man's (about 1 cm on a 14 cm brain) are ~9-10 cm:
// a 3D wavelength of 0.24 m gives lines ~9 cm apart on the surface (measured by the generator's `spacing` print).
const WAVELENGTH = 0.20;
const K = 2 * Math.PI / WAVELENGTH;
const WAVES = Array.from({ length: 64 }, () => ({ d: randUnit(), ph: rnd() * Math.PI * 2 }));
// A slow warp (one wavelength ~0.9 m, 6 cm swing) so the spacing breathes and no region reads as a regular weave.
const WARP = Array.from({ length: 3 }, () => Array.from({ length: 6 }, () => ({ d: randUnit(), ph: rnd() * Math.PI * 2 })));
const WK = 2 * Math.PI / 0.9, WAMP = 0.06;
function field(p: V): number {
  const w: V = [0, 0, 0];
  for (let a = 0; a < 3; a++) for (const s of WARP[a]!) w[a] += Math.cos(WK * dot(s.d, p) + s.ph) / Math.sqrt(6);
  const q = add(p, mul(w, WAMP));
  let n = 0;
  for (const s of WAVES) n += Math.cos(K * dot(s.d, q) + s.ph);
  return n;
}

/** The plain brain's surface point for a lat/lon, as a cheap ellipsoid (the probe is spent only on emitted points):
 *  the compiled semi-axes of the brain's envelope, measured by probing (printed below). */
const AX: V = [0, 0, 0];
for (const [i, d] of [[0, [1, 0, 0]], [1, [0, 1, 0]], [2, [0, 0, 1]]] as [number, V][]) AX[i] = len(sub(skinDir(d)!.p, C));
function ellPoint(lat: number, lon: number): V {
  const d = dirOf(lat, lon);
  const k = 1 / Math.sqrt((d[0] / AX[0]) ** 2 + (d[1] / AX[1]) ** 2 + (d[2] / AX[2]) ** 2);
  return mul(d, k);   // relative to C
}

// --- WHERE THERE ARE NO FOLDS -----------------------------------------------------------------------------------
/** The face (compiled offset from C ~(0, -0.27, 0.59): lat -25, lon 0), a little wider than its prims. */
function faceGap(lat: number, lon: number): number {
  const dl = (lat + 26) / 30, dn = lon / 34;
  return Math.hypot(dl, dn) - 1;   // < 0 inside
}
/** Metres to the longitudinal fissure: the top midline (x = 0) over the brain, from the frontal pole to the back. */
function fissureDist(p: V, lat: number): number {
  return lat > -5 ? Math.abs(p[0]) : Infinity;
}
/** Metres to the lateral fissure on side s (+1 left): a line on the brain's side from low at the front up and back. */
function sylvianDist(p: V, s: number): number {
  const a = sub(ellPoint(-12, s * 55), [0, 0, 0]), b = ellPoint(16, s * 128);
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return len(sub(p, add(a, mul(ab, t))));
}
const LAT_MIN = -42;   // below this the harness ring hides the brain
/** True where a fold may lie. */
function foldable(lat: number, lon: number): boolean {
  if (lat < LAT_MIN) return false;
  if (faceGap(lat, lon) < 0) return false;
  const p = ellPoint(lat, lon);
  if (fissureDist(p, lat) < 0.030) return false;
  if (sylvianDist(p, 1) < 0.026 || sylvianDist(p, -1) < 0.026) return false;
  return true;
}

// --- MARCHING SQUARES ON THE LAT/LON GRID ------------------------------------------------------------------------
const STEP = 0.5;                              // degrees: ~6 mm at the equator
const NLON = Math.round(360 / STEP), LAT0 = LAT_MIN - 2, LAT1 = 89;
const NLAT = Math.round((LAT1 - LAT0) / STEP) + 1;
const grid = new Float64Array(NLAT * NLON);
for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
  const lat = LAT0 + i * STEP, lon = -180 + j * STEP;
  grid[i * NLON + j] = field(add(C, ellPoint(lat, lon)));
}
const G = (i: number, j: number) => grid[i * NLON + ((j % NLON) + NLON) % NLON]!;
/** An edge crossing as (lat, lon), keyed by its grid edge so neighbouring cells join. */
type Pt = { lat: number; lon: number; key: string };
function cross(i0: number, j0: number, i1: number, j1: number): Pt {
  const a = G(i0, j0), b = G(i1, j1), t = a / (a - b);
  const lat = LAT0 + (i0 + (i1 - i0) * t) * STEP, lon = -180 + (j0 + (j1 - j0) * t) * STEP;
  const jj0 = ((j0 % NLON) + NLON) % NLON, jj1 = ((j1 % NLON) + NLON) % NLON;
  const key = i0 < i1 || (i0 === i1 && jj0 < jj1) ? `${i0},${jj0}-${i1},${jj1}` : `${i1},${jj1}-${i0},${jj0}`;
  return { lat, lon, key };
}
const segs: [Pt, Pt][] = [];
for (let i = 0; i + 1 < NLAT; i++) for (let j = 0; j < NLON; j++) {
  const v = [G(i, j), G(i, j + 1), G(i + 1, j + 1), G(i + 1, j)];
  const c = (v[0]! > 0 ? 1 : 0) | (v[1]! > 0 ? 2 : 0) | (v[2]! > 0 ? 4 : 0) | (v[3]! > 0 ? 8 : 0);
  if (c === 0 || c === 15) continue;
  const e = [cross(i, j, i, j + 1), cross(i, j + 1, i + 1, j + 1), cross(i + 1, j, i + 1, j + 1), cross(i, j, i + 1, j)];
  // Edges: 0 bottom, 1 right, 2 top, 3 left. The standard table (saddles split by the centre's sign).
  const centre = (v[0]! + v[1]! + v[2]! + v[3]!) > 0;
  const T: Record<number, number[][]> = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]],
    11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
    5: centre ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]], 10: centre ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]],
  };
  for (const [a, b] of T[c]!) segs.push([e[a!]!, e[b!]!]);
}
// Join segments into polylines by their shared edge keys.
const byKey = new Map<string, number[]>();
segs.forEach(([a, b], k) => { for (const p of [a, b]) { const l = byKey.get(p.key) ?? []; l.push(k); byKey.set(p.key, l); } });
const used = new Uint8Array(segs.length);
const lines: Pt[][] = [];
for (let s0 = 0; s0 < segs.length; s0++) {
  if (used[s0]) continue;
  used[s0] = 1;
  const line: Pt[] = [segs[s0]![0], segs[s0]![1]];
  for (const dir of [1, -1]) {
    for (;;) {
      const end = dir === 1 ? line[line.length - 1]! : line[0]!;
      const next = (byKey.get(end.key) ?? []).find(k => !used[k]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next]!;
      const far = a.key === end.key ? b : a;
      if (dir === 1) line.push(far); else line.unshift(far);
    }
  }
  lines.push(line);
}

// --- RIDGES -----------------------------------------------------------------------------------------------------
const out: string[] = [
  '# GENERATED by scripts/cerebrax-detail-gen.ts: edit the tables there and re-run, then bake (the command is in',
  '# its header). These are .blob `body` lines folded into the body ONLY for the bake (cerebrax-body-n.png); they',
  '# are never raymarched. AUTHORED metres (the compiled body is `scale` 1.60 larger).',
];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);
/** One fold: a chain of rounded bars through compiled skin points (already sunk), radii tapering at both ends. */
function emitChain(S: { c: V; r: number }[], blend: number) {
  for (let i = 0; i + 1 < S.length; i++) {
    const A = S[i]!, B = S[i + 1]!;
    out.push(`  bar  torso on skull from=0 to=0 offset=${fv(sub(A.c, C))} tip=${fv(sub(B.c, A.c))} r=${fa(A.r)} r2=${fa(B.r)} blend=${fa(blend)} rigid`);
  }
}

// GYRUS SHAPE: radius 5.5 cm standing 2 cm proud, so each fold's footprint is ~8.5 cm wide on the skin and
// neighbours ~9-10 cm apart meet in a V crease ~1.5 cm deep: the sulcus. (5 cm / 1.8 cm left flat floors between.) A tight blend keeps the crease crisp.
const GYRUS_R = 0.055, GYRUS_PROUD = 0.020, GYRUS_BLEND = 0.004, SAMPLE = 0.02;
section('gyri: the random-wave labyrinth, laid on the skin');
let foldPrims = 0, foldLen = 0;
for (const line of lines) {
  // 3D points (ellipsoid), cut where not foldable, then resampled every SAMPLE metres of arclength.
  const runs: { lat: number; lon: number }[][] = [];
  let run: { lat: number; lon: number }[] = [];
  for (const p of line) {
    if (foldable(p.lat, p.lon)) run.push(p);
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  for (const r of runs) {
    const P = r.map(q => ellPoint(q.lat, q.lon));
    const L: number[] = [0];
    for (let i = 1; i < P.length; i++) L.push(L[i - 1]! + len(sub(P[i]!, P[i - 1]!)));
    const total = L[L.length - 1]!;
    if (total < 0.07) continue;   // a stub between gaps reads as a bead
    const n = Math.max(2, Math.round(total / SAMPLE));
    const S: { c: V; r: number }[] = [];
    let k = 0;
    for (let s = 0; s <= n; s++) {
      const at = total * s / n;
      while (k + 1 < L.length - 1 && L[k + 1]! < at) k++;
      const u = (at - L[k]!) / Math.max(1e-9, L[k + 1]! - L[k]!);
      const q = add(P[k]!, mul(sub(P[k + 1]!, P[k]!), u));
      const sk = skinDir(norm(q));
      if (!sk) continue;
      // Taper over the last ~6 cm at each end: folds dive into the gaps, they do not stop as blunt ends.
      const endK = Math.min(1, Math.min(at, total - at) / 0.06);
      const rr = GYRUS_R * (0.45 + 0.55 * Math.sqrt(endK));
      const proud = GYRUS_PROUD * (0.35 + 0.65 * endK);
      S.push({ c: add(sk.p, mul(sk.n, proud - rr)), r: rr });
    }
    if (S.length < 2) continue;
    emitChain(S, GYRUS_BLEND);
    foldPrims += S.length - 1; foldLen += total;
  }
}

// THE FISSURE BANKS: one long fold either side of the longitudinal fissure, front to back over the top, so the
// fissure reads as a deep straight-ish cleft between two rolled lips, not just a seam where the labyrinth stops.
section('fissure banks: a rolled fold either side of the longitudinal fissure');
for (const s of [1, -1]) {
  const S: { c: V; r: number }[] = [];
  for (let lat = 2; lat <= 178; lat += 1.6) {
    // Walk over the top in the x = 0 plane, then step out to the bank.
    const th = lat * D2R;
    const dir0 = norm([0, Math.sin(th), Math.cos(th)]);
    const top = skinDir(dir0)!.p;
    const sk = skinDir(norm(add(sub(top, C), [s * 0.055, 0, 0])));
    if (!sk) continue;
    const endK = Math.min(1, Math.min(lat - 2, 178 - lat) / 14);
    const rr = 0.044 * (0.5 + 0.5 * endK);
    // A slow meander along the bank (~0.4 m wavelength, 1.2 cm swing): the banks are folds too, not rails.
    const wob = 0.012 * Math.sin(lat * 0.09 + (s > 0 ? 0 : 1.7));
    const c = add(sk.p, add(mul(sk.n, 0.016 - rr), [s * wob, 0, 0]));
    if (faceGap(Math.asin(Math.max(-1, Math.min(1, (c[1] - C[1]) / len(sub(c, C))))) / D2R, 0) < 0) continue;
    S.push({ c, r: rr });
  }
  emitChain(S, GYRUS_BLEND);
}

// VEINS: a few cortical vessels lying over the folds, the varicose recipe (biomech-style.md): a sine meander of
// ~10 cm wavelength and ~1 cm swing, samples every ~9 mm, trunks ~6 mm thick and 4 mm proud, tapering to both ends,
// a knot about one sample in six, one branch. Here they run DOWN from the fissure over the hemispheres.
section('veins: cortical vessels from the fissure down over the hemispheres');
function vein(lat0: number, lon0: number, lat1: number, lon1: number, r: number, proud: number, branch: boolean) {
  const a = ellPoint(lat0, lon0), b = ellPoint(lat1, lon1);
  const n = Math.max(8, Math.round(len(sub(b, a)) / 0.009));
  let phase = rnd() * 6.28;
  const S: { c: V; r: number }[] = [];
  const knots: V[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const base = add(a, mul(sub(b, a), t));
    const side = norm([-(b[2] - a[2]), 0, b[0] - a[0]].map((v, k) => v + (k === 1 ? 0 : 0)) as V);
    const q = add(base, mul(side, 0.010 * Math.sin(phase)));
    phase += 0.22 + rnd() * 0.14;
    const sk = skinDir(norm(q));
    if (!sk) continue;
    const lat = Math.asin(norm(q)[1]) / D2R, lon = Math.atan2(q[0], q[2]) / D2R;
    if (faceGap(lat, lon) < 0 || lat < LAT_MIN) break;
    const k = Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
    const rr = r * (0.55 + 0.45 * k);
    // Over the folds: the vein's top sits `proud` above the gyrus crown (GYRUS_PROUD), so it is not buried in a sulcus.
    const c = add(sk.p, mul(sk.n, GYRUS_PROUD + proud * (0.6 + 0.4 * k) - rr));
    S.push({ c, r: rr });
    if (i > 2 && i < n - 2 && rnd() < 0.17) knots.push(add(sk.p, mul(sk.n, GYRUS_PROUD + proud * 1.3 - rr * 1.7)));
  }
  if (S.length < 3) return;
  emitChain(S, 0.0016);
  for (const c of knots) out.push(`  blob torso on skull at=0 offset=${fv(sub(c, C))} r=${fa(r * 1.7)} blend=${fa(0.002)} rigid`);
  if (branch) {
    const m = Math.floor(S.length * (0.3 + rnd() * 0.3));
    const lm = Math.asin(norm(sub(S[m]!.c, C))[1]) / D2R, nm = Math.atan2(S[m]!.c[0] - C[0], S[m]!.c[2] - C[2]) / D2R;
    vein(lm, nm, lm - 14 - rnd() * 8, nm + (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 10), r * 0.65, proud * 0.75, false);
  }
}
for (const s of [1, -1]) {
  vein(70, s * 20, 10, s * 70, 0.0062, 0.0042, true);
  vein(66, s * 100, 4, s * 118, 0.0060, 0.0040, true);
  vein(62, s * 150, 0, s * 152, 0.0058, 0.0040, true);
}

// THE FACE: the brain grew over a man's face, so its skin is the brain's, wrinkled into the snarl: forehead
// furrows bowed down over the scowl, crow's feet, and the deep nasolabial creases from the nose to the mouth's
// corners. Small: the face spans ~45 cm compiled.
section('the snarl: forehead furrows, crow\'s feet, nasolabial creases');
function faceRidge(pts: [number, number][], r: number, proud: number) {
  const S = pts.map(([lat, lon]) => { const sk = skinDir(dirOf(lat, lon))!; return { c: add(sk.p, mul(sk.n, proud - r)), r }; });
  emitChain(S, 0.003);
}
// Two furrows bowed DOWN into a V over the nose (a scowl), the upper one shorter: three level ones read as stacked
// bars (first look).
for (let k = 0; k < 2; k++) {
  const w = 20 - k * 5;
  faceRidge([[-4 + k * 5.5, -w], [-7.5 + k * 5.5, -w * 0.5], [-10 + k * 5.5, 0], [-7.5 + k * 5.5, w * 0.5], [-4 + k * 5.5, w]], 0.010, 0.005);
}
for (const s of [1, -1]) {
  faceRidge([[-19, s * 6], [-25, s * 9], [-31, s * 11], [-35, s * 10]], 0.011, 0.006);     // nasolabial
  faceRidge([[-16, s * 17], [-14, s * 22], [-12, s * 26]], 0.007, 0.004);                  // crow's feet
  faceRidge([[-18, s * 17], [-19, s * 23], [-20, s * 27]], 0.007, 0.004);
  faceRidge([[-20, s * 16], [-23, s * 21], [-26, s * 24]], 0.007, 0.004);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/cerebrax.detail'), out.join('\n') + '\n');
// The fold spacing: mean distance between neighbouring nodal lines ~ area / length.
const area = 4 * Math.PI * ((AX[0] * AX[1]) ** 1.6 + (AX[0] * AX[2]) ** 1.6 + (AX[1] * AX[2]) ** 1.6) ** (1 / 1.6) / 3 ** (1 / 1.6);
console.log(`cerebrax-detail-gen: semi-axes ${AX.map(v => v.toFixed(3)).join(' ')} m; ${lines.length} contours, ${foldLen.toFixed(1)} m of folds`
  + ` (spacing ~${(area * 0.72 / Math.max(1, foldLen)).toFixed(3)} m over the foldable ~72%), ${foldPrims} fold prims;`
  + ` ${out.filter(l => /^\s+(bar|blob)/.test(l)).length} detail prims in all`);
