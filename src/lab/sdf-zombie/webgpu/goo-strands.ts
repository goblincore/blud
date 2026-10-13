// src/lab/sdf-zombie/webgpu/goo-strands.ts
//
// THE GOO (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 4): strands between the torn lip and the egg, beads
// sliding along them, and drips off the bezel's lower rim. Pure and deterministic: `gooAt(t)` re-runs a small Verlet sim from t = 0 in fixed steps,
// with the anchors read from the timeline and the field at every step, so a scrub and a playback show the same frame (the page never keeps state).
//
// OUT AND HEAL (plan Task 8): once the egg leaves the sac each strand's egg end moves to the point of the egg's surface FACING its lip end
// (always on the surface as the egg falls), the strands get slack and sag across the gap; late in the heal each strand LETS GO of the lip
// (its lip end falls free) and thins away. The drips stop at the desk top or the keyboard's (emergence-field's dripFloor) and what keeps
// coming POOLS: a slick under the egg once it lands and a small one under each drip that reaches the desk, uploaded as discs.
// LOOK ROUND 1: the drips hang in front of the CRT's chin (DRIP_FACE_Z), never inside the housing as the lip relaxes back, and retract with
// the heal (DRIP_RETRACT); their pools stay. `dripsAt` runs the drips alone (the housing test scans every 0.05 s with it).
// THE SECOND NOTES (2026-10-13): the keyboard never moves and is COVERED IN EGG GOO: a drip that lands on the keys feeds a blob of the
// keyboard's coat (emergence-field's COAT: its egg blob plus one per drip), and where the coat reaches the keyboard's front edge goo RUNS
// over it to the desk (N_RUNS short drips, each leaving a small pool).
import { paramsAt, DURATION, type EmergenceParams } from './emergence-timeline';
import {
  COAT, DESK_Y, EGG, FRAME_FACE_Z, GLASS, KEYBOARD_BODY_TOP, KEYBOARD_RECT, KEYBOARD_TOP, SLUMP, coatEggBlob, coatThickness, dripFloor, eggCentre, eggHeld,
  ellipsoidDist, lipOpening, smooth, tearEdge, tearRadius, type CoatBlob, type Vec3,
} from './emergence-field';

export const N_STRANDS = 6;
export const STRAND_POINTS = 6;
export const N_BEADS = 8;
export const N_DRIPS = 4;
/** The runs of goo over the keyboard's front edge to the desk. */
export const N_RUNS = 3;
/** The pools on the desk: the egg's slick, then one per drip, then one per run. */
export const N_POOLS = 1 + N_DRIPS + N_RUNS;
/** The keyboard coat's blobs: the egg's, then one per drip. */
export const N_COAT = 1 + N_DRIPS;
/** One texel per strand point, bead and drip or run end, the bounds, the pools, then the coat's blobs: the shader reads a row of RGBA32F
 *  texels of this width. */
export const GOO_TEXELS = 96;
const DT = 1 / 60;
const GRAVITY = -2.2;           // m/s^2, softened (mucus, not water)
const DRIP_MAX = 0.25;          // m (before the floor clamps it)
const ITER = 16;                  // relaxation passes per step: 4 left a segment 1.58x its rest length at t=12.18 while the egg slumps (anchors moving fast)

export interface Strand { live: boolean; points: Vec3[]; segMax: number; radius: number }
export interface Bead { pos: Vec3; radius: number }
/** `floor`: the height the drip stopped at (the desk's or the keyboard's top). */
export interface Drip { length: number; top: Vec3; tip: Vec3; radius: number; floor: number }
/** A wet disc on the desk top (y = DESK_Y), centre and radius (0: none). */
export interface Pool { centre: Vec3; radius: number }
/** `runs`: the goo running over the keyboard's front edge (drips from the edge to the desk); `coat`: the keyboard coat's blobs (COAT). */
export interface Goo { strands: Strand[]; beads: Bead[]; drips: Drip[]; runs: Drip[]; pools: Pool[]; coat: CoatBlob[] }

// A tiny deterministic generator so the strands' angles, lags and sags are fixed per index (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(20261011);
const STRAND_THETA = Array.from({ length: N_STRANDS }, (_, i) => (i / N_STRANDS) * Math.PI * 2 + (R() - 0.5) * 0.5);
const STRAND_START = Array.from({ length: N_STRANDS }, (_, i) => 7.2 + i * 0.35 + R() * 0.2);   // when each strand forms
const STRAND_SLACK = Array.from({ length: N_STRANDS }, () => 1.04 + R() * 0.12);
const DRIP_X = Array.from({ length: N_DRIPS }, (_, i) => ((i + 0.5) / N_DRIPS - 0.5) * 2 * GLASS.hw * 0.8 + (R() - 0.5) * 0.03);
const DRIP_START = Array.from({ length: N_DRIPS }, (_, i) => 8.2 + i * 0.8);
const BEAD_STRAND = Array.from({ length: N_BEADS }, (_, i) => i % N_STRANDS);
const BEAD_U0 = Array.from({ length: N_BEADS }, () => 0.2 + R() * 0.6);
/** When each strand lets go of the lip, and how long it takes to thin away. Early in the heal (11.9 to 12.8 s), while the tear is still
 *  nearly full width: later, the knit drags the lip ends in toward the axis and the strands fold up inside the egg before they let go. */
const STRAND_LETGO = Array.from({ length: N_STRANDS }, (_, i) => 11.9 + i * 0.15 + R() * 0.1);
const LETGO_S = 0.7;
/** Extra slack (fraction of the chord) once the egg is out: the strands sag across the gap. */
const FREE_SLACK = 0.18;
/** The drip's tip is this many times its radius; it rests on the floor. */
export const DRIP_TIP = 1.6;
/** The egg's slick on the desk round the keyboard (the egg rests on the keyboard; the slick is what ran off it): its radius once spread (m;
 *  0.12, so that crept and wobbled it stays on the lab desk short of the knees: POOL_REACH), how long (slump) it takes to spread after the
 *  landing, and how far it creeps with the heal. */
const POOL = { r: 0.12, spread: 0.2, creep: 0.25, drip: 0.03, dripFill: 0.08 } as const;
/** The furthest the egg's slick reaches from its centre: its spread radius, crept, and the shader's edge wobble (scrPool: up to 1.15x). The
 *  lab page brings the desk's front edge out to it, so the slick lies on wood. */
export const POOL_REACH = POOL.r * (1 + POOL.creep) * 1.15;
/** THE RUNS over the keyboard's front edge: at x `RUN_X`, each starts when the coat at the edge (`probe` m inside it) is `h0` thick, hangs
 *  from just over the edge (radius `r`, its tip DRIP_TIP times that) and grows at `rate` + `acc` age (m/s, m/s^2) to the desk, where it pools
 *  (radius up to `pool`, fed over `fill` m of growth past its room). They stay through the heal (the keyboard stays covered). */
export const RUN = { r: 0.006, probe: 0.006, h0: 0.0025, rate: 0.03, acc: 0.04, pool: 0.022, fill: 0.02 } as const;
export const RUN_X = [-0.085, 0.02, 0.1] as const;
/** Each run's radius as a share of RUN.r (they are not all alike). */
export const RUN_W = [1.0, 0.7, 0.85] as const;

/** Where strand i leaves the tear's lip (on the sheet) and where it lands on the egg, at the state `p` and time `t`. */
function anchors(p: EmergenceParams, i: number, t: number): { a: Vec3; b: Vec3 } {
  const th = STRAND_THETA[i]!;
  // on the tear's edge (the field's tearEdge: on the sheet, at the tear's radius from the tip), never closer to the axis than 2 cm
  const e = tearEdge(p, th, t), re = Math.hypot(e[0], e[1]);
  const r = Math.max(0.02, re), x = re > 0 ? (e[0] / re) * r : r * Math.cos(th), y = re > 0 ? (e[1] / re) * r : r * Math.sin(th);
  const a: Vec3 = [x, y, e[2]];
  const c = eggCentre(p);
  // the egg end while the sac holds the egg: a point on the egg's front, on the same side of the egg as the tear point (the strands cross its face)
  const ex = (x / Math.max(r, 1e-3)) * EGG.rx * 0.55, ey = c[1] + (y / Math.max(r, 1e-3)) * EGG.ry * 0.55;
  const q = (ex / EGG.rx) ** 2 + ((ey - c[1]) / EGG.ry) ** 2;
  const held: Vec3 = [ex, ey, c[2] + EGG.rz * Math.sqrt(Math.max(0, 1 - q))];
  // once it is out: the surface point facing the lip end. Blended, then put back on the surface along the ray from the centre, so the egg end
  // stays ON the egg however it moves.
  const w = 1 - eggHeld(p);
  const v: Vec3 = [held[0] + (a[0] - held[0]) * w, held[1] + (a[1] - held[1]) * w, held[2] + (a[2] - held[2]) * w];
  return { a, b: onEgg(c, v) };
}

/** The point of the egg's surface on the ray from its centre c through v. */
function onEgg(c: Vec3, v: Vec3): Vec3 {
  const d = [v[0] - c[0], v[1] - c[1], v[2] - c[2]] as const;
  const k = Math.hypot(d[0] / EGG.rx, d[1] / EGG.ry, d[2] / EGG.rz);
  if (k < 1e-9) return [c[0], c[1], c[2] + EGG.rz];
  return [c[0] + d[0] / k, c[1] + d[1] / k, c[2] + d[2] / k];
}

/** The sim's state: strand points, their previous positions, whether each is born, its rope segment length (frozen when it lets go), and each
 *  drip's length (it creeps toward its target, so a floor moving away under it does not snap it longer in one frame). */
interface Sim { pts: Vec3[][]; prev: Vec3[][]; born: boolean[]; seg: number[]; drip: DripSim }
/** The drips' own state: each drip's length, and the pool each has fed on the desk (its radius only grows; its centre is fixed where it
 *  formed, so it does not slide back with the relaxing lip, and it stays when the drip retracts). */
interface DripSim {
  len: number[]; poolR: number[]; poolC: (Vec3 | null)[];
  /** each drip's coat blob on the keys (its feed 0..1 only grows, its centre fixed where it formed) */
  coatF: number[]; coatC: ([number, number] | null)[];
  /** each run's start time (NaN: not yet), length and pool radius */
  runT0: number[]; runLen: number[]; runPoolR: number[];
  /** the last step's time */
  lastT: number;
}
const newDripSim = (): DripSim => ({
  len: Array(N_DRIPS).fill(0), poolR: Array(N_DRIPS).fill(0), poolC: Array(N_DRIPS).fill(null), coatF: Array(N_DRIPS).fill(0), coatC: Array(N_DRIPS).fill(null),
  runT0: Array(N_RUNS).fill(NaN), runLen: Array(N_RUNS).fill(0), runPoolR: Array(N_RUNS).fill(0), lastT: 0,
});

/** A drip's free growth (m) at `age` seconds, before any floor. */
const dripGrowth = (age: number) => (age <= 0 ? 0 : Math.min(DRIP_MAX, 0.04 * age + 0.012 * age * age));
/** A drip's top (on the bezel's lower rim, but never behind DRIP_FACE_Z: outside the chin) and the room below it to its floor (the tip sphere
 *  resting on it). */
function dripRoom(p: EmergenceParams, i: number): { top: Vec3; floor: number; room: number } {
  const lip = lipOpening(p);
  const top: Vec3 = [DRIP_X[i]!, -lip.hh, Math.max(lip.z, DRIP_FACE_Z)];
  const floor = dripFloor(top[0], top[2]);
  return { top, floor, room: Math.max(0, top[1] - floor - DRIP_R * DRIP_TIP) };
}
export const DRIP_R = 0.008;
/** THE RETRACT (look round 1: the drips clipped into the CRT's chin once the lip relaxed back behind its face): over this span of the heal
 *  each drip's length eases to zero from the bottom up (its tip rising to its top, never lengthening again) and it thins (radius times the
 *  square root of what is left); the pool it fed stays. After it, no drip. */
export const DRIP_RETRACT = [0.15, 0.7] as const;
/** The drip's top never goes behind this z: the CRT frame's face plus the drip's fattest radius (the tip's) plus 4 mm, so the whole drip
 *  hangs in front of the chin even as the lip's rim relaxes back behind the face late in the heal. */
export const DRIP_FACE_Z = FRAME_FACE_Z + DRIP_R * DRIP_TIP + 0.004;
/** What is left of the drips at `p`: 1 before the retract, easing to 0 across DRIP_RETRACT. */
export const dripLeft = (p: EmergenceParams) => 1 - smooth((p.heal - DRIP_RETRACT[0]) / (DRIP_RETRACT[1] - DRIP_RETRACT[0]));
/** A strand's radius at full thickness (it thins with the heal: gooAt). */
const STRAND_R = 0.006;
/** How fast a drip may lengthen toward its target (m/s): a floor sliding away lets it slump down, it does not jump. */
const DRIP_CREEP = 0.25;

function stepDrips(ds: DripSim, p: EmergenceParams, t: number): void {
  const retracting = p.heal >= DRIP_RETRACT[0];
  ds.lastT = t;
  for (let i = 0; i < N_DRIPS; i++) {
    const { top, floor, room } = dripRoom(p, i), growth = dripGrowth(t - DRIP_START[i]!);
    const target = Math.min(growth, room) * dripLeft(p);
    ds.len[i] = target < ds.len[i]! || retracting ? Math.min(target, ds.len[i]!) : Math.min(target, ds.len[i]! + DRIP_CREEP * DT);
    // where it lands it leaves goo, fed by what keeps coming after it touched (its free growth past its room): a pool on the DESK, a blob of
    // the coat on the KEYBOARD
    const resting = ds.len[i]! >= room - 1e-6;
    if (resting && floor === DESK_Y) {
      const r = POOL.drip * smooth((growth - room) / POOL.dripFill);
      if (r > ds.poolR[i]!) { ds.poolR[i] = r; ds.poolC[i] ??= [top[0], DESK_Y, top[2]]; }
    } else if (resting && floor === KEYBOARD_TOP) {
      const f = smooth((growth - room) / COAT.drip.fill);
      if (f > ds.coatF[i]!) { ds.coatF[i] = f; ds.coatC[i] ??= [top[0], top[2]]; }
    }
  }
  // the runs: once the coat reaches the keyboard's front edge at a run's x, goo runs over it to the desk and pools there
  const blobs = coatBlobs(ds, p);
  for (let i = 0; i < N_RUNS; i++) {
    if (Number.isNaN(ds.runT0[i]!) && coatThickness(blobs, RUN_X[i]!, KEYBOARD_RECT.z1 - RUN.probe) >= RUN.h0) ds.runT0[i] = t;
    if (Number.isNaN(ds.runT0[i]!)) continue;
    const growth = runGrowth(t - ds.runT0[i]!), room = runRoom(i);
    ds.runLen[i] = Math.min(growth, room);
    if (growth >= room) ds.runPoolR[i] = Math.max(ds.runPoolR[i]!, RUN.pool * RUN_W[i]! * smooth((growth - room) / RUN.fill));
  }
}

/** A run's free growth (m) at `age` seconds. */
const runGrowth = (age: number) => (age <= 0 ? 0 : RUN.rate * age + RUN.acc * age * age);
/** A run's top: on the keyboard's front edge (its sphere over the edge's corner, its fat tip clinging to the front face: the tip sphere
 *  reaches 40% of its radius into it), and the room below it to the desk (its tip resting on the desk). */
const runR = (i: number) => RUN.r * RUN_W[i]!;
const runTop = (i: number): Vec3 => [RUN_X[i]!, KEYBOARD_BODY_TOP - 0.25 * runR(i), KEYBOARD_RECT.z1 + 0.6 * runR(i) * DRIP_TIP];
export const runRoom = (i: number) => KEYBOARD_BODY_TOP - 0.25 * runR(i) - DESK_Y - runR(i) * DRIP_TIP;

/** The coat's blobs from the drip state at `p`: the egg's, then each drip's. */
function coatBlobs(ds: DripSim, p: EmergenceParams): CoatBlob[] {
  return [coatEggBlob(p), ...ds.coatC.map((c, i) => (c ? { x: c[0], z: c[1], r: COAT.drip.r * ds.coatF[i]!, h: COAT.drip.h * ds.coatF[i]! } : { x: 0, z: 0, r: 0, h: 0 }))];
}

/** What the drips leave: the drips, the runs, their pools on the desk (the drips' then the runs') and the keyboard coat's blobs. */
export interface DripsOut { drips: Drip[]; runs: Drip[]; pools: Pool[]; coat: CoatBlob[] }

/** The drips, the runs and what they leave (from the drip state at the end of the run). */
function dripsOut(ds: DripSim, p: EmergenceParams): DripsOut {
  const radius = DRIP_R * Math.sqrt(dripLeft(p));
  const drips: Drip[] = Array.from({ length: N_DRIPS }, (_, i) => {
    const { top, floor } = dripRoom(p, i);
    const length = ds.len[i]!;
    return { length, top, tip: [top[0], top[1] - length, top[2]], radius, floor };
  });
  const pools: Pool[] = Array.from({ length: N_DRIPS }, (_, i) => {
    const c = ds.poolC[i];
    if (c) return { centre: [...c] as Vec3, radius: ds.poolR[i]! };
    const { top } = dripRoom(p, i);
    return { centre: [top[0], DESK_Y, top[2]], radius: 0 };
  });
  const runs: Drip[] = Array.from({ length: N_RUNS }, (_, i) => {
    const top = runTop(i), length = ds.runLen[i]!;
    // it thickens in over its first 0.3 s (born at full radius it popped)
    const age = Number.isNaN(ds.runT0[i]!) ? 0 : ds.lastT - ds.runT0[i]!;
    return { length, top, tip: [top[0], top[1] - length, top[2]], radius: runR(i) * smooth(age / 0.3), floor: DESK_Y };
  });
  const runPools: Pool[] = Array.from({ length: N_RUNS }, (_, i) => {
    const top = runTop(i);
    return { centre: [top[0], DESK_Y, top[2]], radius: ds.runPoolR[i]! };
  });
  return { drips, runs, pools: [...pools, ...runPools], coat: coatBlobs(ds, p) };
}

/** The steps' times up to `tt`: fixed DT steps, the last one at tt itself. */
function stepTimes(t: number): { tt: number; steps: number } {
  const tt = Math.min(Math.max(t, 0), DURATION);
  return { tt, steps: Math.floor(tt / DT) };
}

/** The drips, the runs and what they leave at time `t` (gooAt's drips, runs, coat and pools after the egg's slick, without the strands' sim:
 *  cheap). */
export function dripsAt(t: number): DripsOut {
  const { tt, steps } = stepTimes(t), ds = newDripSim();
  for (let s = 0; s <= steps; s++) { const ts = s === steps ? tt : s * DT; stepDrips(ds, paramsAt(ts), ts); }
  return dripsOut(ds, paramsAt(tt));
}

function stepSim(sim: Sim, p: EmergenceParams, t: number): void {
  stepDrips(sim.drip, p, t);
  for (let i = 0; i < N_STRANDS; i++) {
    const freed = t >= STRAND_LETGO[i]!;
    if (freed && !sim.born[i]) continue;
    if (!freed && (t < STRAND_START[i]! || tearRadius(p, STRAND_THETA[i]!) <= 0)) { sim.born[i] = false; continue; }
    const { a, b } = anchors(p, i, t);
    if (!freed) {
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      sim.seg[i] = (chord * (STRAND_SLACK[i]! + FREE_SLACK * (1 - eggHeld(p)))) / (STRAND_POINTS - 1);
    }
    const seg = sim.seg[i]!;
    if (!sim.born[i]) {                                        // born on the chord
      sim.born[i] = true;
      sim.pts[i] = Array.from({ length: STRAND_POINTS }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / (STRAND_POINTS - 1), a[1] + ((b[1] - a[1]) * k) / (STRAND_POINTS - 1), a[2] + ((b[2] - a[2]) * k) / (STRAND_POINTS - 1)] as Vec3);
      sim.prev[i] = sim.pts[i]!.map(v => [...v] as Vec3);
    }
    const P = sim.pts[i]!, Q = sim.prev[i]!;
    for (let k = freed ? 0 : 1; k < STRAND_POINTS - 1; k++) {  // verlet with a little damping (the lip end too, once it has let go)
      const v = [(P[k]![0] - Q[k]![0]) * 0.985, (P[k]![1] - Q[k]![1]) * 0.985, (P[k]![2] - Q[k]![2]) * 0.985];
      Q[k] = [...P[k]!] as Vec3;
      P[k] = [P[k]![0] + v[0]!, P[k]![1] + v[1]! + GRAVITY * DT * DT, P[k]![2] + v[2]!] as Vec3;
    }
    if (!freed) { P[0] = a; Q[0] = [...a] as Vec3; }
    P[STRAND_POINTS - 1] = b; Q[STRAND_POINTS - 1] = [...b] as Vec3;
    // A let-go strand hangs from the egg: its free points drape over the egg (pushed out of it) and stop on the desk.
    if (freed) {
      const c = eggCentre(p);
      for (let k = 0; k < STRAND_POINTS - 1; k++) {
        const v = P[k]!, d = [v[0] - c[0], v[1] - c[1], v[2] - c[2]] as const;
        const sd = ellipsoidDist([d[0], d[1], d[2]], [EGG.rx, EGG.ry, EGG.rz]);
        if (sd < STRAND_R) {
          const g = [d[0] / EGG.rx ** 2, d[1] / EGG.ry ** 2, d[2] / EGG.rz ** 2], gl = Math.hypot(g[0]!, g[1]!, g[2]!) || 1;
          for (let j = 0; j < 3; j++) v[j] = v[j]! + (g[j]! / gl) * (STRAND_R - sd);
        }
        const fl = dripFloor(v[0], v[2]) + STRAND_R;          // the desk, or the keyboard's top (it never moves)
        if (v[1] < fl) v[1] = fl;
      }
    }
    for (let it = 0; it < ITER; it++) for (let k = 0; k < STRAND_POINTS - 1; k++) {
      const u = P[k]!, w = P[k + 1]!;
      const dx = w[0] - u[0], dy = w[1] - u[1], dz = w[2] - u[2], d = Math.hypot(dx, dy, dz) || 1e-9;
      if (d <= seg) continue;                                  // a rope: only the stretch is corrected
      const corr = (d - seg) / d, wu = k === 0 && !freed ? 0 : 0.5, ww = k + 1 === STRAND_POINTS - 1 ? 0 : 0.5, sum = wu + ww || 1;
      u[0] += (dx * corr * wu) / sum; u[1] += (dy * corr * wu) / sum; u[2] += (dz * corr * wu) / sum;
      w[0] -= (dx * corr * ww) / sum; w[1] -= (dy * corr * ww) / sum; w[2] -= (dz * corr * ww) / sum;
    }
  }
}

/** A strand (and its beads) thickens from nothing over BIRTH_S after it forms (it is born on the chord at full length: at full radius it
 *  popped in one frame). */
const BIRTH_S = 0.35;
const birth = (age: number) => { const u = Math.min(1, Math.max(0, age / BIRTH_S)); return u * u * (3 - 2 * u); };
/** A strand's (and its beads') thickness over its life: thickening in from its birth, thinning away after it lets go. */
const life = (i: number, t: number) => birth(t - STRAND_START[i]!) * (1 - smooth((t - STRAND_LETGO[i]!) / LETGO_S));

/** The goo at time `t` (seconds): re-run from 0 in fixed steps, deterministic. */
export function gooAt(t: number): Goo {
  const { tt, steps } = stepTimes(t);
  const sim: Sim = {
    pts: Array.from({ length: N_STRANDS }, () => []), prev: Array.from({ length: N_STRANDS }, () => []), born: Array(N_STRANDS).fill(false),
    seg: Array(N_STRANDS).fill(0), drip: newDripSim(),
  };
  for (let s = 0; s <= steps; s++) { const ts = s === steps ? tt : s * DT; stepSim(sim, paramsAt(ts), ts); }
  const p = paramsAt(tt);
  const strands: Strand[] = Array.from({ length: N_STRANDS }, (_, i) => {
    const live = sim.born[i]! && sim.pts[i]!.length === STRAND_POINTS;
    const P = live ? sim.pts[i]!.map(v => [...v] as Vec3) : [];
    return { live, points: P, segMax: live ? sim.seg[i]! * 1.5 + 1e-3 : 0, radius: (STRAND_R - 0.0025 * Math.min(1, p.heal * 2)) * life(i, tt) };
  });
  const beads: Bead[] = BEAD_STRAND.map((si, bi) => {
    const s = strands[si]!;
    if (!s.live) return { pos: [0, -9, 0] as Vec3, radius: 0 };
    const u = Math.min(0.95, Math.max(0.05, BEAD_U0[bi]! + 0.08 * Math.sin(tt * 0.9 + bi)));
    const f = u * (STRAND_POINTS - 1), k = Math.min(STRAND_POINTS - 2, Math.floor(f)), w = f - k, A = s.points[k]!, B = s.points[k + 1]!;
    return { pos: [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w, A[2] + (B[2] - A[2]) * w] as Vec3, radius: 0.011 * life(si, tt) };
  });
  const { drips, runs, pools: dripPools, coat } = dripsOut(sim.drip, p);
  // THE POOLS: the egg's slick spreads once it lands and creeps with the heal; then the drips' (dripsOut).
  const c = eggCentre(p);
  const land = smooth((p.slump - SLUMP.land + 0.03) / POOL.spread);
  const pools: Pool[] = [{ centre: [c[0], DESK_Y, c[2]], radius: POOL.r * land * (1 + POOL.creep * smooth(p.heal)) }, ...dripPools];
  return { strands, beads, drips, runs, pools, coat };
}

/** The round cones in the texel row: the drips, then the runs (the shader draws them alike). */
export const N_CONES = N_DRIPS + N_RUNS;
/** Where the bounds start in the texel row: one per strand, then one for all the beads, then one for all the drips and runs. */
export const GOO_BOUND0 = N_STRANDS * STRAND_POINTS + N_BEADS + 2 * N_CONES;
/** Where the pools start: centre and radius per texel (w = 0: none). */
export const GOO_POOL0 = GOO_BOUND0 + N_STRANDS + 2;
/** Where the keyboard coat's blobs start: (x, peak, z, radius) per texel (w = 0: none). */
export const GOO_COAT0 = GOO_POOL0 + N_POOLS;

/** A bounding sphere (centre, radius) round spheres given as [x, y, z, r] (r > 0 only); radius 0 when there are none. */
function bound(spheres: readonly (readonly number[])[]): [number, number, number, number] {
  const live = spheres.filter(s => s[3]! > 0);
  if (live.length === 0) return [0, -9, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of live) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, s[k]! - s[3]!); hi[k] = Math.max(hi[k]!, s[k]! + s[3]!); }
  const c = [0, 1, 2].map(k => (lo[k]! + hi[k]!) / 2);
  let r = 0;
  for (const s of live) r = Math.max(r, Math.hypot(s[0]! - c[0]!, s[1]! - c[1]!, s[2]! - c[2]!) + s[3]!);
  return [c[0]!, c[1]!, c[2]!, r];
}

/** The goo as a row of RGBA32F texels for the shader: strand points (xyz + radius), then the beads, then each drip's and then each run's top
 *  and tip (unused texels are w = 0), then from GOO_BOUND0 a bounding sphere per strand, one for the beads and one for the drips and runs
 *  (w = 0: empty), so the shader skips whole strands it cannot reach (a tapered capsule or round cone lies inside the spheres at its ends'
 *  hull, so these hold them); from GOO_POOL0 the pools (centre, radius); from GOO_COAT0 the coat's blobs (x, peak, z, radius). */
export function gooTexels(g: Goo): Float32Array {
  const out = new Float32Array(GOO_TEXELS * 4);
  let n = 0;
  const put = (v: readonly number[], r: number) => { out[n * 4] = v[0]!; out[n * 4 + 1] = v[1]!; out[n * 4 + 2] = v[2]!; out[n * 4 + 3] = r; n++; };
  const sph = (i: number) => [out[i * 4]!, out[i * 4 + 1]!, out[i * 4 + 2]!, out[i * 4 + 3]!];
  for (const s of g.strands) for (let k = 0; k < STRAND_POINTS; k++) s.live ? put(s.points[k]!, s.radius) : put([0, -9, 0], 0);
  for (const b of g.beads) put(b.pos, b.radius);
  for (const d of [...g.drips, ...g.runs]) { put(d.top, d.length > 0 ? d.radius : 0); put(d.tip, d.length > 0 ? d.radius * DRIP_TIP : 0); }
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => sph(a + i));
  for (let i = 0; i < N_STRANDS; i++) { const b = bound(range(i * STRAND_POINTS, (i + 1) * STRAND_POINTS)); put(b, b[3]); }
  const b0 = N_STRANDS * STRAND_POINTS, d0 = b0 + N_BEADS;
  { const b = bound(range(b0, d0)); put(b, b[3]); }
  { const b = bound(range(d0, d0 + 2 * N_CONES)); put(b, b[3]); }
  for (const pl of g.pools) put(pl.centre, pl.radius);
  for (const c of g.coat) put([c.x, c.h, c.z], c.r > 0 && c.h > 0 ? c.r : 0);
  return out;
}
