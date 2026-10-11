// src/lab/sdf-zombie/webgpu/goo-strands.ts
//
// THE GOO (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md, section 4): strands between the torn lip and the egg, beads
// sliding along them, and drips off the bezel's lower rim. Pure and deterministic: `gooAt(t)` re-runs a small Verlet sim from t = 0 in fixed steps,
// with the anchors read from the timeline and the field at every step, so a scrub and a playback show the same frame (the page never keeps state).
import { paramsAt, DURATION, type EmergenceParams } from './emergence-timeline';
import { EGG, GLASS, eggCentre, lipOpening, sacZ, tearRadius, type Vec3 } from './emergence-field';

export const N_STRANDS = 6;
export const STRAND_POINTS = 6;
export const N_BEADS = 8;
export const N_DRIPS = 4;
/** One texel per strand point, bead and drip end: the shader reads a row of RGBA32F texels of this width. */
export const GOO_TEXELS = 64;
const DT = 1 / 60;
const GRAVITY = -2.2;           // m/s^2, softened (mucus, not water)
const DRIP_MAX = 0.25;          // m
const ITER = 16;                  // relaxation passes per step: 4 left a segment 1.58x its rest length at t=12.18 while the egg slumps (anchors moving fast)

export interface Strand { live: boolean; points: Vec3[]; segMax: number; radius: number }
export interface Bead { pos: Vec3; radius: number }
export interface Drip { length: number; top: Vec3; tip: Vec3; radius: number }
export interface Goo { strands: Strand[]; beads: Bead[]; drips: Drip[] }

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

/** Where strand i leaves the tear's lip (on the sheet) and where it lands on the egg, at the state `p` and time `t`. */
function anchors(p: EmergenceParams, i: number, t: number): { a: Vec3; b: Vec3 } {
  const th = STRAND_THETA[i]!, r = Math.max(0.02, tearRadius(p, th));
  const x = r * Math.cos(th), y = r * Math.sin(th);
  const a: Vec3 = [x, y, sacZ(p, x, y, t)];
  const c = eggCentre(p);
  // the egg end: a point on the egg's near surface, on the same side of the egg as the tear point
  const ex = (x / Math.max(r, 1e-3)) * EGG.rx * 0.55, ey = c[1] + (y / Math.max(r, 1e-3)) * EGG.ry * 0.55;
  const q = (ex / EGG.rx) ** 2 + ((ey - c[1]) / EGG.ry) ** 2;
  return { a, b: [ex, ey, c[2] + EGG.rz * Math.sqrt(Math.max(0, 1 - q))] };
}

interface Sim { pts: Vec3[][]; prev: Vec3[][]; born: boolean[] }

function stepSim(sim: Sim, p: EmergenceParams, t: number): void {
  for (let i = 0; i < N_STRANDS; i++) {
    if (t < STRAND_START[i]! || tearRadius(p, STRAND_THETA[i]!) <= 0) { sim.born[i] = false; continue; }
    const { a, b } = anchors(p, i, t);
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const seg = (chord * STRAND_SLACK[i]!) / (STRAND_POINTS - 1);
    if (!sim.born[i]) {                                        // born on the chord
      sim.born[i] = true;
      sim.pts[i] = Array.from({ length: STRAND_POINTS }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / (STRAND_POINTS - 1), a[1] + ((b[1] - a[1]) * k) / (STRAND_POINTS - 1), a[2] + ((b[2] - a[2]) * k) / (STRAND_POINTS - 1)] as Vec3);
      sim.prev[i] = sim.pts[i]!.map(v => [...v] as Vec3);
    }
    const P = sim.pts[i]!, Q = sim.prev[i]!;
    for (let k = 1; k < STRAND_POINTS - 1; k++) {            // verlet with a little damping
      const v = [(P[k]![0] - Q[k]![0]) * 0.985, (P[k]![1] - Q[k]![1]) * 0.985, (P[k]![2] - Q[k]![2]) * 0.985];
      Q[k] = [...P[k]!] as Vec3;
      P[k] = [P[k]![0] + v[0]!, P[k]![1] + v[1]! + GRAVITY * DT * DT, P[k]![2] + v[2]!] as Vec3;
    }
    P[0] = a; Q[0] = [...a] as Vec3; P[STRAND_POINTS - 1] = b; Q[STRAND_POINTS - 1] = [...b] as Vec3;
    for (let it = 0; it < ITER; it++) for (let k = 0; k < STRAND_POINTS - 1; k++) {
      const u = P[k]!, w = P[k + 1]!;
      const dx = w[0] - u[0], dy = w[1] - u[1], dz = w[2] - u[2], d = Math.hypot(dx, dy, dz) || 1e-9;
      if (d <= seg) continue;                                  // a rope: only the stretch is corrected
      const corr = (d - seg) / d, wu = k === 0 ? 0 : 0.5, ww = k + 1 === STRAND_POINTS - 1 ? 0 : 0.5, sum = wu + ww || 1;
      u[0] += (dx * corr * wu) / sum; u[1] += (dy * corr * wu) / sum; u[2] += (dz * corr * wu) / sum;
      w[0] -= (dx * corr * ww) / sum; w[1] -= (dy * corr * ww) / sum; w[2] -= (dz * corr * ww) / sum;
    }
  }
}

/** The goo at time `t` (seconds): re-run from 0 in fixed steps, deterministic. */
export function gooAt(t: number): Goo {
  const tt = Math.min(Math.max(t, 0), DURATION);
  const sim: Sim = { pts: Array.from({ length: N_STRANDS }, () => []), prev: Array.from({ length: N_STRANDS }, () => []), born: Array(N_STRANDS).fill(false) };
  const steps = Math.floor(tt / DT);
  for (let s = 0; s <= steps; s++) { const ts = s === steps ? tt : s * DT; stepSim(sim, paramsAt(ts), ts); }
  const p = paramsAt(tt);
  const strands: Strand[] = Array.from({ length: N_STRANDS }, (_, i) => {
    const live = sim.born[i]! && sim.pts[i]!.length === STRAND_POINTS;
    const P = live ? sim.pts[i]!.map(v => [...v] as Vec3) : [];
    const chord = live ? Math.hypot(P[0]![0] - P[P.length - 1]![0], P[0]![1] - P[P.length - 1]![1], P[0]![2] - P[P.length - 1]![2]) : 0;
    return { live, points: P, segMax: live ? Math.max((chord * STRAND_SLACK[i]!) / (STRAND_POINTS - 1), 0) * 1.5 + 1e-3 : 0, radius: 0.006 - 0.0025 * Math.min(1, p.heal * 2) };
  });
  const beads: Bead[] = BEAD_STRAND.map((si, bi) => {
    const s = strands[si]!;
    if (!s.live) return { pos: [0, -9, 0] as Vec3, radius: 0 };
    const u = Math.min(0.95, Math.max(0.05, BEAD_U0[bi]! + 0.08 * Math.sin(tt * 0.9 + bi)));
    const f = u * (STRAND_POINTS - 1), k = Math.min(STRAND_POINTS - 2, Math.floor(f)), w = f - k, A = s.points[k]!, B = s.points[k + 1]!;
    return { pos: [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w, A[2] + (B[2] - A[2]) * w] as Vec3, radius: 0.011 };
  });
  const lip = lipOpening(p);
  const drips: Drip[] = Array.from({ length: N_DRIPS }, (_, i) => {
    const age = tt - DRIP_START[i]!;
    const length = age <= 0 ? 0 : Math.min(DRIP_MAX, 0.04 * age + 0.012 * age * age);
    const top: Vec3 = [DRIP_X[i]!, -lip.hh, lip.z];
    return { length, top, tip: [top[0], top[1] - length, top[2] + 0.01 * length], radius: 0.008 };
  });
  return { strands, beads, drips };
}

/** The goo as a row of RGBA32F texels for the shader: strand points (xyz + radius), then the beads, then each drip's top and tip; unused texels are w = 0. */
export function gooTexels(g: Goo): Float32Array {
  const out = new Float32Array(GOO_TEXELS * 4);
  let n = 0;
  const put = (v: readonly number[], r: number) => { out[n * 4] = v[0]!; out[n * 4 + 1] = v[1]!; out[n * 4 + 2] = v[2]!; out[n * 4 + 3] = r; n++; };
  for (const s of g.strands) for (let k = 0; k < STRAND_POINTS; k++) s.live ? put(s.points[k]!, s.radius) : put([0, -9, 0], 0);
  for (const b of g.beads) put(b.pos, b.radius);
  for (const d of g.drips) { put(d.top, d.length > 0 ? d.radius : 0); put(d.tip, d.length > 0 ? d.radius * 1.6 : 0); }
  return out;
}
