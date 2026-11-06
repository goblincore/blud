// scripts/zombie-detail-gen.ts
//
// Generate src/lab/sdf-zombie/characters/zombie.detail: the base zombie's BAKED sutures, the "reconstituted flesh"
// look (scripts/bake-body-normal.ts folds these lines into the body and bakes the difference into zombie-body-n.png;
// nothing here is ever raymarched, so the stitches are free at runtime).
//
//   npx tsx scripts/zombie-detail-gen.ts && npx tsx scripts/bake-body-normal.ts zombie 768 400 \
//     --limb clavicle.l:0.3:1.1:0.12:104 --limb upperArm.l:-0.05:0.3:0.10:72 --limb foreArm.l:-0.15:1.25:0.10:284 \
//     --limb clavicle.r:0.3:1.1:0.12:104 --limb upperArm.r:-0.05:0.3:0.10:72 --limb foreArm.r:-0.15:1.25:0.10:284 \
//     --limb thigh.l:-0.2:0.35:0.14:168 --limb shin.l:-0.15:0.15:0.11:100 \
//     --limb thigh.r:-0.2:0.35:0.14:168 --limb shin.r:-0.15:0.15:0.11:100 --limb neck:-0.3:0.9:0.09:128
//   (about 30 s on the GPU; run `npm install` first if it says it is baking on the CPU). The limb regions are BANDS
//   round the seams only: a hit no region claims (mid upper arm, mid shin) simply wears no map. The foreArm region
//   carries both the elbow (t < 0 reaches back over the upper arm's end; same cluster) and the wrist, and runs
//   past the hand (its sphere ends at t ~1.21) so both sides of the wrist suture wear it; the shin
//   region carries the knee from both sides the same way. Texels are ~1-1.6 mm.
//
// THE TEMPLATE is scripts/twinhead-detail-gen.ts (probe the skin, sit each element a set number of mm proud, bind it
// to a bone with offset/tip). What is new here is WHERE the detail goes.
//
// WHY THE SEAMS ARE WHERE THEY ARE. The owner saw faint seams on the walking zombie at the shoulders, neck, waist and
// hips. They are the skin noise TEARING: every fbm the shader samples (the shading normal's noise, the grain, the
// mottle) is read at `restPoint` (webgpu/march/fields/carves.wgsl.ts), the hit mapped into the DOMINANT prim's rest
// frame. Where the dominant prim flips from one prim to its neighbour, and the two have moved differently since rest
// (any pose: an arm swing, a stride, a nod), the two sides read the noise at rest points centimetres apart, and the
// texture breaks along the flip line. At rest the tear is zero, which is why turntable frames never show it. A CPU
// probe on this .blob (validate.ts nearestPrim + the restPoint mapping): a 30 deg arm swing tears the shoulder 10 mm,
// a 25 deg stride the hip 42 mm, a 20 deg nod the neck 62 mm, a 15 deg spine bend the waist 13-31 mm.
//
// So the sutures are put ON those flip lines, found the same way: for each junction, rays round a junction axis find
// where nearestPrim changes from one prim set to the other. The seam the owner saw becomes the seam the body was sewn
// along. The body normal map tears there too (it is read through the same `anchor`), and the stitches hide that.
//
// EACH STITCH IS EMITTED ONCE PER CLUSTER THAT MEETS AT THE SEAM. A map region bakes only its own cluster (torso hits
// read the torso region, arm hits an arm region), so a stitch that crosses the shoulder line has to exist in both:
// the torso's copy is projected onto the torso-only skin, the arm's onto the arm-only skin, and at runtime each side
// of the line reads its own half.
//
// WHY THE NORMAL MAP AND NOT KIT MESH. These seams straddle two bones that move apart (that is why they tear), and
// the kit is skinned rigidly per bone (scripts/blender-kit.ts): a mesh stitch across the shoulder would shear open on
// every arm swing. They sit exactly where the zombie severs (shoulder, hip, neck), so a mesh would need its own shed
// logic per part (the imp's kit needed exactly that). Mesh laid flush on the SDF skin vanishes under the surface
// noise, and lifted the ~1 cm that fixes that it floats (biomech-style.md). The map costs nothing per pixel more
// than any other baked body, takes the skin's own colour, light and wound masking, and rides the same rest frame as
// the tear it covers.
//
// Edit the tables below and re-run; do not hand-edit the .detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { nearestPrim, sdBody } from '../src/lab/sdf-zombie/validate';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/zombie.blob'), 'utf8');
const doc = parseBlob(src);
const built = buildBody(compileBlob(doc, compileFace(doc)));
type Body = typeof built;
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(...a);
const norm = (a: V): V => mul(a, 1 / len(a));
const f = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fv = (v: V) => `(${v.map(f).join(',')})`;

/** The body with only these clusters alive. */
const only = (...limbs: string[]): Body => ({ ...built, clusters: built.clusters.map(c => ({ ...c, alive: limbs.includes(c.limb) })) }) as Body;
const grad = (p: V, b: Body): V => {
  const e = 5e-4;
  return norm([sdBody(add(p, [e, 0, 0]), b) - sdBody(sub(p, [e, 0, 0]), b), sdBody(add(p, [0, e, 0]), b) - sdBody(sub(p, [0, e, 0]), b),
    sdBody(add(p, [0, 0, e]), b) - sdBody(sub(p, [0, 0, e]), b)]);
};
/** p moved onto body b's skin along its gradient; null when that skin is not near (the cluster is not there). */
function project(p: V, b: Body, reach = 0.03): { p: V; n: V } | null {
  let q = p;
  for (let i = 0; i < 12; i++) {
    const d = sdBody(q, b);
    if (Math.abs(d) > reach) return null;
    if (Math.abs(d) < 2e-5) break;
    q = sub(q, mul(grad(q, b), d));
  }
  return { p: q, n: grad(q, b) };
}
/** The first skin a ray from `o` along `dir` meets on body b, within `max` metres; null if `o` starts inside. */
function rayHit(o: V, dir: V, b: Body, max: number): V | null {
  let t = 0;
  if (sdBody(o, b) <= 0) return null;
  for (let i = 0; i < 400 && t < max; i++) {
    const p = add(o, mul(dir, t)), d = sdBody(p, b);
    if (d < 1e-5) return p;
    t += Math.max(d * 0.9, 1e-5);
  }
  return null;
}

// ------------------------------------------------------------------------------------------- the seams
/** A junction: two prim sets in one body, and an axis the seam rings round (the scan runs along it from A into B). */
interface Junction {
  label: string; body: Body; inA: (i: number) => boolean; o: V; u: V; t0: number; t1: number; R: number; phis: number;
  /** Classify by POSITION instead of by dominant prim: a ring at a chosen place rather than on a flip line. */
  at?: (p: V) => boolean;
  /** Keep only seam points this accepts (an open, part-way suture: the back alone). */
  keep?: (p: V) => boolean;
}
const primsOf = (pred: (p: Body['prims'][number]) => boolean) => new Set(built.prims.flatMap((p, i) => (pred(p) ? [i] : [])));

/**
 * The flip line: for each angle round the axis, the point along it where nearestPrim leaves set A for set B, bisected
 * to a tenth of a millimetre. Angles whose ray starts inside the flesh, misses, or never crosses cleanly from A to B
 * (an armpit, a crotch) give null: a gap in the seam, where its stitches stop.
 */
function seam(J: Junction): (V | null)[] {
  const u = norm(J.u);
  const e1 = norm(cross(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), e2 = cross(u, e1);
  const ring: (V | null)[] = [];
  for (let k = 0; k < J.phis; k++) {
    const ph = (2 * Math.PI * k) / J.phis, dir = add(mul(e1, Math.cos(ph)), mul(e2, Math.sin(ph)));
    const at = (t: number): { p: V; a: boolean } | null => {
      const p = rayHit(add(add(J.o, mul(u, t)), mul(dir, J.R)), mul(dir, -1), J.body, J.R);
      return p ? { p, a: J.at ? J.at(p) : J.inA(nearestPrim(p, J.body)) } : null;
    };
    const N = 60;
    let found: V | null = null;
    let prev = at(J.t0), tp = J.t0;
    for (let i = 1; i <= N && !found; i++) {
      const t = J.t0 + (J.t1 - J.t0) * (i / N), cur = at(t);
      if (prev && cur && prev.a && !cur.a) {
        let lo = tp, hi = t, pLo = prev.p;
        for (let it = 0; it < 22; it++) {
          const m = (lo + hi) / 2, cm = at(m);
          if (!cm) break;
          if (cm.a) { lo = m; pLo = cm.p; } else hi = m;
        }
        // Reject a "flip" that jumps across the body: the two rays must land on the same stretch of skin.
        const pHi = at(hi)?.p;
        if (pHi && len(sub(pHi, pLo)) < 0.01) found = mul(add(pLo, pHi), 0.5);
      }
      prev = cur; tp = t;
    }
    ring.push(found && (!J.keep || J.keep(found)) ? found : null);
  }
  return ring;
}

/** Split a ring with gaps into runs; a gapless ring is one closed run. Runs shorter than `minPts` are dropped. */
function runs(ring: (V | null)[], minPts = 4): { pts: V[]; closed: boolean }[] {
  if (ring.every(p => p)) return [{ pts: ring as V[], closed: true }];
  const n = ring.length, start = ring.findIndex(p => !p), out: { pts: V[]; closed: boolean }[] = [];
  let cur: V[] = [];
  for (let k = 1; k <= n; k++) {
    const p = ring[(start + k) % n];
    if (p) cur.push(p);
    else { if (cur.length >= minPts) out.push({ pts: cur, closed: false }); cur = []; }
  }
  if (cur.length >= minPts) out.push({ pts: cur, closed: false });
  return out;
}

/** Smooth a run (bisection jitters a millimetre or two), drop outliers, keep it on body b, resample every `step` m. */
function tidy(run: { pts: V[]; closed: boolean }, b: Body, step: number): { p: V; n: V }[] {
  let P = run.pts;
  const n = P.length, at = (i: number) => P[run.closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i))]!;
  for (let it = 0; it < 6; it++) {
    P = P.map((p, i) => {
      const m = mul(add(add(at(i - 1), at(i + 1)), mul(p, 2)), 0.25);
      return project(m, b)?.p ?? p;
    });
  }
  const pts = run.closed ? [...P, P[0]!] : P;
  const out: { p: V; n: V }[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i]!, B = pts[i + 1]!, L = len(sub(B, A));
    let s = carry;
    while (s < L) { const q = project(add(A, mul(sub(B, A), s / L)), b); if (q) out.push(q); s += step; }
    carry = s - L;
  }
  return out;
}

// ------------------------------------------------------------------------------------------- the copies
/** Where one copy of a stitch lands: a cluster's own skin, the bones it may bind to, and its .blob limb word. */
interface Target { body: Body; limb: string; side: '' | 'l' | 'r'; bones: string[] }
const T = (limb: string, cluster: string, side: '' | 'l' | 'r', boneNames: string[]): Target =>
  ({ body: only(cluster), limb, side, bones: boneNames });
/** The nearest of the target's bones to p, and the bone point the offset is measured from. */
function bind(tg: Target, p: V): { bone: string; t: number; at: V } {
  let best = { bone: '', t: 0, at: p as V, d: Infinity };
  for (const name of tg.bones) {
    const key = tg.side ? `${name}.${tg.side}` : name;
    const { head, tail } = bones.get(key)!;
    const d = sub(tail, head), t = Math.min(1, Math.max(0, dot(sub(p, head), d) / dot(d, d))), at = add(head, mul(d, t));
    const dist = len(sub(p, at));
    if (dist < best.d) best = { bone: name, t, at, d: dist };
  }
  return best;
}
const sideWord = (tg: Target) => (tg.side ? ` side=${tg.side}` : '');

const out: string[] = [];
const section = (s: string) => out.push('', `  # ---- ${s} ----`);
let prims = 0;

/** A bar from a to b (skin points of target tg), sunk so `proudA`/`proudB` stand out, arched through `proudMid`. */
function barOn(tg: Target, a: V, b: V, r: number, proudA: number, proudB: number, proudMid: number, blend: number, r2?: number) {
  const A = project(a, tg.body), B = project(b, tg.body), M = project(mul(add(a, b), 0.5), tg.body);
  if (!A || !B || !M) return;
  const pa = add(A.p, mul(A.n, proudA - r)), pb = add(B.p, mul(B.n, proudB - (r2 ?? r)));
  const mid = mul(add(pa, pb), 0.5), want = add(M.p, mul(M.n, proudMid - ((r + (r2 ?? r)) / 2)));
  let bend = mul(sub(want, mid), 2);
  if (len(bend) > 0.008) bend = mul(bend, 0.008 / len(bend));
  const { bone, t, at } = bind(tg, pa);
  out.push(`  bar  ${tg.limb} on ${bone} from=${f(t)} to=${f(t)} offset=${fv(sub(pa, at))} tip=${fv(sub(pb, pa))} bend=${fv(bend)} r=${f(r)}${r2 !== undefined ? ` r2=${f(r2)}` : ''} blend=${f(blend)}${sideWord(tg)}`);
  prims++;
}
/** A lump at a skin point of target tg, sunk so `proud` stands out. */
function lumpOn(tg: Target, p: V, r: number, proud: number, blend: number) {
  const S = project(p, tg.body);
  if (!S) return;
  const c = add(S.p, mul(S.n, proud - r)), { bone, t, at } = bind(tg, c);
  out.push(`  blob ${tg.limb} on ${bone} at=${f(t)} offset=${fv(sub(c, at))} r=${f(r)} blend=${f(blend)}${sideWord(tg)}`);
  prims++;
}

// ------------------------------------------------------------------------------------------- the suture
// Crude and bold, because it has to read on a walking body at game range on a map of ~1 mm texels: a puckered welt
// either side of the cut (the cut itself is the valley between them), thick thread crossing it on a slant every 2 cm
// and arching over the welt, and a pucker where each stitch pierces the skin. Half-sized stitches are lost in the
// skin noise; this is the scale a mortician's baseball stitch has.
// First pass (welts 5.5 mm out, thread r 2.1 mm, stitches every 2 cm) read as a fine ladder at 1 m and aliased to
// speckle beyond it: everything is ~1.5x that now.
const S = {
  step: 0.006,        // seam resample spacing; the welt bars are this long
  lipOff: 0.0080,     // each welt's distance from the cut
  lipR: 0.0055, lipProud: 0.0028,
  gap: 0.030,         // stitch spacing along the seam
  half: 0.018,        // half the stitch's span across the cut
  slant: 18,          // deg off square to the cut; every stitch the same way, like a running whip stitch
  threadR: 0.0032, threadEnd: 0.0022, threadMid: 0.0065,
  puckR: 0.0042, puckProud: 0.0018,
};

function suture(label: string, J: Junction, targets: Target[]) {
  const ring = seam(J);
  const found = ring.filter(p => p).length;
  section(`${label}: a suture along the ${J.label} flip line (${found}/${ring.length} angles found it)`);
  for (const run of runs(ring)) {
    const P = tidy(run, J.body, S.step);
    if (P.length < 3) continue;
    const frame = P.map((s, i) => {
      const tan = norm(sub(P[Math.min(P.length - 1, i + 1)]!.p, P[Math.max(0, i - 1)]!.p));
      return { tan, side: norm(cross(s.n, tan)) };
    });
    for (const tg of targets) {
      // The welts: one bar per resample step either side of the cut, tapering to nothing at an open run's ends.
      for (const k of [-1, 1]) {
        for (let i = 0; i + 1 < P.length; i++) {
          const end = run.closed ? 1 : Math.min(1, Math.min(i, P.length - 2 - i) / 3);
          const r = S.lipR * (0.55 + 0.45 * end);
          barOn(tg, add(P[i]!.p, mul(frame[i]!.side, k * S.lipOff)), add(P[i + 1]!.p, mul(frame[i + 1]!.side, k * S.lipOff)),
            r, S.lipProud * (0.5 + 0.5 * end), S.lipProud * (0.5 + 0.5 * end), S.lipProud * (0.5 + 0.5 * end), 0.0015);
        }
      }
      // The stitches.
      const every = Math.max(1, Math.round(S.gap / S.step)), a = S.slant * Math.PI / 180;
      for (let i = run.closed ? 0 : 2; i < P.length - (run.closed ? 0 : 2); i += every) {
        const { tan, side } = frame[i]!, across = norm(add(mul(side, Math.cos(a)), mul(tan, Math.sin(a))));
        const e0 = add(P[i]!.p, mul(across, -S.half)), e1 = add(P[i]!.p, mul(across, S.half));
        barOn(tg, e0, e1, S.threadR, S.threadEnd, S.threadEnd, S.threadMid, 0.001);
        lumpOn(tg, e0, S.puckR, S.puckProud, 0.0015);
        lumpOn(tg, e1, S.puckR, S.puckProud, 0.0015);
      }
    }
  }
}

out.push(
  '# GENERATED by scripts/zombie-detail-gen.ts: edit the tables there and re-run, then',
  '# npx tsx scripts/bake-body-normal.ts zombie (the full command is in the generator\'s header). These are .blob',
  '# `body` lines folded into the body ONLY for the bake (zombie-body-n.png); they are never raymarched. Every',
  '# element sits on the probed skin, along the flip line where the skin noise tears in motion.',
);

const torsoT = T('torso', 'torso', '', ['spine', 'pelvis']);
const armT2 = (sd: 'l' | 'r') => T('arm', sd === 'l' ? 'armL' : 'armR', sd, ['upperArm', 'foreArm']);
for (const sd of ['l', 'r'] as const) {
  const sx = sd === 'l' ? 1 : -1, arm = sd === 'l' ? 'armL' : 'armR', leg = sd === 'l' ? 'legL' : 'legR';
  const armT = T('arm', arm, sd, ['clavicle', 'upperArm']), legT = T('leg', leg, sd, ['thigh']);
  const torsoIdx = primsOf(p => p.limb === 'torso');
  // SHOULDER: torso into the shoulder mound (the clavicle blob) and the upper arm, scanned outward along x.
  const sh = bones.get(`upperArm.${sd}`)!.head;
  suture(`shoulder.${sd}`, {
    label: 'torso / arm', body: only('torso', arm), inA: i => torsoIdx.has(i),
    o: [0, sh[1], sh[2]], u: [sx, 0, 0], t0: 0.04, t1: 0.27, R: 0.22, phis: 144,
  }, [torsoT, armT]);
  // HIP: the pelvis into the thigh, scanned down the thigh bone from above its head.
  const th = bones.get(`thigh.${sd}`)!, tu = norm(sub(th.tail, th.head));
  suture(`hip.${sd}`, {
    label: 'pelvis / thigh', body: only('torso', leg), inA: i => torsoIdx.has(i),
    o: th.head, u: tu, t0: -0.10, t1: 0.22, R: 0.24, phis: 144,
  }, [torsoT, legT]);
  // ELBOW, WRIST, KNEE: one cluster each, so one copy. Not in the owner's list, but in a walk these are the LOUDEST
  // seams on the body (crisp bright rings round the reaching forearms in blob:shot BLOB_POSE=walk): the hand and the
  // shoulder mound are point prims (`blob ... at=`), and restPoint used to give a point prim no axis to swing, so a
  // raised arm's hand read the noise unrotated against a forearm that turned with the arm. applyRig now stamps a
  // point prim's bone rotation as a noise-only orient (src/lab/sdf-zombie/orient-shape.ts), which closes the ring
  // on an unsutured body; the stitches stay because a body sewn from parts is sewn at every joint.
  const fa = bones.get(`foreArm.${sd}`)!, fu = norm(sub(fa.tail, fa.head));
  const isBar = (i: number) => len(sub(built.prims[i]!.b, built.prims[i]!.a)) > 1e-4;
  suture(`elbow.${sd}`, {
    label: 'upper arm / forearm', body: only(arm), inA: i => !built.prims[i]!.bone.startsWith('foreArm'),
    o: fa.head, u: fu, t0: -0.10, t1: 0.10, R: 0.16, phis: 96,
  }, [armT2(sd)]);
  // WRIST: the forearm capsule into the hand ball, on its flip line (t ~0.85). It sat on a cuff up the forearm (t 0.60)
  // while the hand, a point prim, read the map through an unrotated rest frame and smeared the stitches into bars
  // across the back of a reaching hand. The hand turns with the forearm now (applyRig's point-prim pose orient), so
  // its rest points stay put and the suture can sit on the seam it hides.
  suture(`wrist.${sd}`, {
    label: 'forearm / hand', body: only(arm), inA: isBar,
    o: fa.head, u: fu, t0: 0.60 * len(sub(fa.tail, fa.head)), t1: 1.05 * len(sub(fa.tail, fa.head)), R: 0.16, phis: 96,
  }, [armT2(sd)]);
  const sn = bones.get(`shin.${sd}`)!;
  suture(`knee.${sd}`, {
    label: 'thigh / shin', body: only(leg), inA: i => built.prims[i]!.bone.startsWith('thigh'),
    o: sn.head, u: norm(sub(sn.tail, sn.head)), t0: -0.12, t1: 0.12, R: 0.18, phis: 96,
  }, [T('leg', leg, sd, ['thigh', 'shin'])]);
}
// NECK: the shoulders into the neck, scanned up the neck bone.
{
  const nk = bones.get('neck')!, torsoIdx = primsOf(p => p.limb === 'torso');
  suture('neck', {
    label: 'torso / neck', body: only('torso', 'head'), inA: i => torsoIdx.has(i),
    o: nk.head, u: norm(sub(nk.tail, nk.head)), t0: -0.08, t1: 0.14, R: 0.20, phis: 144,
  }, [torsoT, T('head', 'head', '', ['neck'])]);
}
// WAIST: inside the torso, the spine's blobs into the pelvis and the flank capsule across it. One cluster, so one
// copy: the torso region is the whole torso.
{
  const spineIdx = primsOf(p => p.limb === 'torso' && p.bone === 'spine');
  suture('waist', {
    label: 'spine / pelvis', body: only('torso'), inA: i => spineIdx.has(i),
    o: [0, 1.25, 0.01], u: [0, -1, 0], t0: 0, t1: 0.36, R: 0.45, phis: 192,
  }, [torsoT]);
  // BACK: the chest blob into the belly blob, across the back only. Not in the owner's list either, but from behind a
  // walk shows it as a thin diagonal tear across the shoulder blades (the shoulders counter-rotate over the hips, and
  // the spine's blobs are point prims, so neither side's noise turns with them). Round the front the same line crossed
  // the chest and read as a strap, so the suture is cut to the back, a long incision between the shoulder blades.
  const chest = primsOf(p => p.limb === 'torso' && p.bone === 'spine' && p.a[1] > 1.30);
  suture('back', {
    label: 'chest / belly', body: only('torso'), inA: i => chest.has(i),
    o: [0, 1.42, 0.01], u: [0, -1, 0], t0: 0, t1: 0.30, R: 0.45, phis: 192,
    keep: p => p[2] < -0.04,
  }, [torsoT]);
}

writeFileSync(resolve(ROOT, 'src/lab/sdf-zombie/characters/zombie.detail'), out.join('\n') + '\n');
console.log(`zombie-detail-gen: ${prims} detail prims`);
for (const l of out.filter(l => l.includes('# ----'))) console.log(l.trim());
