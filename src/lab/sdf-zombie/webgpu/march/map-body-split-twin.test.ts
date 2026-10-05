// src/lab/sdf-zombie/webgpu/march/map-body-split-twin.test.ts
//
// A HAND TWIN of the head split in map-body.wgsl.ts, run against head-split.ts splitField.
//
// Nothing in this repo compiles WGSL, so the march's split slot (the piece caps, the unmoved side's merge, the
// compare-swap into ascending cap order, the early skip, the caps on the finished field, the region shell) is written
// out again below in TypeScript, statement for statement, and compared by VALUE with the CPU's split field at seeded
// points: inside and outside the region, on every seam, and with another slot's value already in the running union.
// It also counts field evaluations per sample, so a change to the piece order or the skip can be judged without a
// boot.
//
// THE TWIN IS A COPY: `twinSlot` MUST BE EDITED TOGETHER WITH THE WGSL. A change to MAP_BODY's split block moves the
// march golden snapshot; when it does, make the same change here. The order of the statements the twin copies is
// pinned at the bottom, and the slot's structure (the loader gate, the hit bookkeeping, the continue / break audit) in
// map-body.wgsl.test.ts.
import { describe, expect, it } from 'vitest';
import { MAP_BODY } from './map-body.wgsl';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { makeZombie } from '../../body';
import { applyRig, bindRig, headQuatOf } from '../../rig-bind';
import { sdBodyClosed } from '../../validate';
import { headShape } from '../flame-anchors';
import {
  REGION_MARGIN, forcedSplit, headFrameOf, rotAxis, splitField, splitWarpOf, unwarpPoint,
  type SplitPresetId, type SplitWarp,
} from '../../head-split';
import { add, cross, dot, len, scale, sub } from '../../vec';
import type { Vec3 } from '../../types';

/** fields/groups.wgsl.ts splitMoveBack. */
function splitMoveBack(p: Vec3, h: Vec3, a: Vec3, theta: number): Vec3 {
  const v = sub(p, h);
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  return add(add(add(h, scale(v, c)), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
}

type Piece = [cap: number, theta: number, id: number];

/** ONE SLOT of mapBody's union fold, for a slot whose record carries `w` (crowd-records.ts write(): null, or neither
 *  side turned, is the zero record), with the slot's own field `f` standing in for the slot body, and `dUnion0` the
 *  running union when the slot is reached (1e9: it is the first). */
function twinSlot(
  w: SplitWarp | null, f: (q: Vec3) => number, pIn: Vec3, dUnion0 = 1e9,
): { d: number; piece: number; evals: number } {
  // The record, and loadInstance's gInstSplitOpen.
  const rec = w && (w.thetaP !== 0 || w.thetaM !== 0) ? w : null;
  const gInstSplitN = rec ? rec.n : [0, 0, 0] as Vec3;
  const splitOpen = dot(gInstSplitN, gInstSplitN) > 0.5;
  let dUnion = dUnion0, pieceU = 0, evals = 0;

  let splitShell = 1e9;
  let pcA: Piece = [-1e9, 0, 0];
  let pcB: Piece = [1e9, 0, 1];
  let pcC: Piece = [1e9, 0, 2];
  if (splitOpen && rec) {
    const spN = rec.n, spH = rec.h, spA = rec.a;
    const spU = cross(spN, spA);
    const spDh = len(sub(pIn, spH));
    const spRho = rec.r - REGION_MARGIN;
    splitShell = REGION_MARGIN + Math.abs(spDh - rec.r);
    let cap0 = Math.min(dot(spU, sub(pIn, spH)), spRho - spDh);
    if (spDh <= rec.r) {
      const qP = splitMoveBack(pIn, spH, spA, rec.thetaP);
      const qM = splitMoveBack(pIn, spH, spA, rec.thetaM);
      const capP = Math.max(Math.max(-(dot(spN, qP) - rec.d0), -dot(spU, sub(qP, spH))), spDh - spRho);
      const capM = Math.max(Math.max(dot(spN, qM) - rec.d0, -dot(spU, sub(qM, spH))), spDh - spRho);
      if (rec.thetaP === 0) { cap0 = Math.min(cap0, capP); } else { pcB[0] = capP; pcB[1] = rec.thetaP; }
      if (rec.thetaM === 0) { cap0 = Math.min(cap0, capM); } else { pcC[0] = capM; pcC[1] = rec.thetaM; }
    }
    pcA[0] = cap0;
    if (pcB[0] < pcA[0]) { const sw = pcA; pcA = pcB; pcB = sw; }
    if (pcC[0] < pcB[0]) { const sw = pcB; pcB = pcC; pcC = sw; }
    if (pcB[0] < pcA[0]) { const sw = pcA; pcA = pcB; pcB = sw; }
  }
  for (let pc = 0; pc < 3; pc = pc + 1) {
    const piece = pc === 0 ? pcA : pc === 1 ? pcB : pcC;
    if (piece[0] >= Math.min(dUnion, splitShell)) { break; }
    let pMoved = pIn;
    if (piece[1] !== 0 && rec) { pMoved = splitMoveBack(pIn, rec.h, rec.a, piece[1]); }
    const p = pMoved;
    // ... the slot body: the fold, the carves, the wounds, the bones, the normal's noise ...
    const dmgFinal = f(p);
    evals++;
    let dPiece = dmgFinal;
    if (splitOpen) { dPiece = Math.max(dmgFinal, piece[0]); }
    if (dPiece < dUnion) {
      dUnion = dPiece;
      pieceU = piece[2];
    }
  }
  if (splitOpen) { dUnion = Math.min(dUnion, splitShell); }
  return { d: dUnion, piece: pieceU, evals };
}

// The posed zombie's closed body, and its head frame, as the split leaf measures it.
const BODY = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
const BOUND = bindRig(BODY);
const POSED = applyRig(BODY, BOUND, 0);
const FRAME = headFrameOf(headShape(POSED)!, headQuatOf(BOUND, 0) ?? [0, 0, 0, 1]);
const f = (q: Vec3) => sdBodyClosed(q, POSED);
const warp = (preset: SplitPresetId, sides: -1 | 0 | 1, offset: number, frac: number): SplitWarp =>
  splitWarpOf(forcedSplit(preset, sides, offset, frac)!, FRAME)!;

/** Seeded uniform [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** A point uniform in the ball of `radius` about `c`. */
function inBall(rnd: () => number, c: Vec3, radius: number): Vec3 {
  const rr = radius * Math.cbrt(rnd()), ct = 2 * rnd() - 1, st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * rnd();
  return [c[0] + rr * st * Math.cos(ph), c[1] + rr * ct, c[2] + rr * st * Math.sin(ph)];
}

/** Points within `e` of each seam of the split field: the old plane, the hinge plane, the rho sphere, the region
 *  sphere, and each opened half's cut face (the plane, turned with its half). */
function seamPoints(rnd: () => number, w: SplitWarp, each: number): Vec3[] {
  const u = cross(w.n, w.a), rho = w.r - REGION_MARGIN, out: Vec3[] = [];
  const eps = () => (rnd() < 0.5 ? -1 : 1) * 10 ** (-7 + 4 * rnd());   // 1e-7 .. 1e-3 either side
  for (let i = 0; i < each; i++) {
    const p = inBall(rnd, w.h, w.r), rel = sub(p, w.h), dir = scale(rel, 1 / (len(rel) || 1));
    const onPlane = sub(p, scale(w.n, dot(w.n, p) - w.d0 - eps()));
    out.push(onPlane);
    out.push(sub(p, scale(u, dot(u, rel) - eps())));
    out.push(add(w.h, scale(dir, rho + eps())));
    out.push(add(w.h, scale(dir, w.r + eps())));
    if (w.thetaP !== 0) out.push(add(w.h, rotAxis(sub(onPlane, w.h), w.a, w.thetaP)));
    if (w.thetaM !== 0) out.push(add(w.h, rotAxis(sub(onPlane, w.h), w.a, w.thetaM)));
  }
  return out;
}

/** Points per case: uniform in the ball of r + 15 cm about the hinge (about a third fall inside the region), and with
 *  a running union preloaded. */
const RANDOM = 8000, UNION = 1200;

const CASES: { name: string; w: SplitWarp; maxEvals: number; meanEvalsUnder: number }[] = [
  { name: 'middle, both sides, full', w: warp('middle', 0, 0, 1), maxEvals: 3, meanEvalsUnder: 1.8 },
  { name: 'middle, both sides, 0.3', w: warp('middle', 0, 0, 0.3), maxEvals: 3, meanEvalsUnder: 1.8 },
  { name: 'middle, + side', w: warp('middle', 1, 0.04, 1), maxEvals: 2, meanEvalsUnder: 1.45 },
  { name: 'middle, - side', w: warp('middle', -1, -0.04, 1), maxEvals: 2, meanEvalsUnder: 1.45 },
  { name: 'face', w: warp('face', 1, 0, 1), maxEvals: 2, meanEvalsUnder: 1.5 },
];

describe('the head split slot in mapBody, by value (a hand twin of the WGSL against splitField)', () => {
  it('a closed slot is the body itself, in one evaluation', () => {
    const rnd = rng(7);
    for (let i = 0; i < 300; i++) {
      const p = inBall(rnd, FRAME.centre, 0.5);
      for (const w of [null, { ...CASES[0]!.w, thetaP: 0, thetaM: 0 }]) {
        const t = twinSlot(w, f, p);
        expect(t.d).toBe(f(p));
        expect(t.evals).toBe(1);
        expect(t.piece).toBe(0);
      }
    }
  });

  for (const [ci, c] of CASES.entries()) {
    it(`${c.name}: equals splitField inside and outside the region and on every seam; the early skip is exact`, () => {
      const { w } = c, rnd = rng(1000 + ci);
      let maxDiff = 0, inN = 0, inEvals = 0, surfN = 0, surfEvals = 0, outN = 0;
      const check = (p: Vec3) => {
        const want = splitField(w, f, p), got = twinSlot(w, f, p);
        maxDiff = Math.max(maxDiff, Math.abs(got.d - want));
        expect(got.evals).toBeLessThanOrEqual(c.maxEvals);
        return { want, got };
      };
      // Inside and outside the region sphere.
      for (let i = 0; i < RANDOM; i++) {
        const p = inBall(rnd, w.h, w.r + 0.15), { want, got } = check(p);
        if (len(sub(p, w.h)) > w.r) { outN++; expect(got.evals).toBe(1); continue; }
        inN++; inEvals += got.evals;
        if (Math.abs(want) < 0.01) {
          surfN++; surfEvals += got.evals;
          // The winning piece is the CPU's (a side that does not move is part of the rest, piece 0).
          const cpu = unwarpPoint(w, p, f).piece;
          const merged = (cpu === 1 && w.thetaP === 0) || (cpu === 2 && w.thetaM === 0) ? 0 : cpu;
          expect(got.piece).toBe(merged);
        }
      }
      // Every seam.
      const seams = seamPoints(rnd, w, 400);
      for (const p of seams) check(p);
      // Another slot's value already in the running union: the slot can only lower it, and never costs more.
      for (let i = 0; i < UNION; i++) {
        const p = i % 4 === 0 ? seams[i]! : inBall(rnd, w.h, w.r + 0.1), other = -0.02 + 0.27 * rnd();
        const got = twinSlot(w, f, p, other);
        maxDiff = Math.max(maxDiff, Math.abs(got.d - Math.min(other, splitField(w, f, p))));
        expect(got.evals).toBeLessThanOrEqual(twinSlot(w, f, p).evals);
      }
      expect(inN).toBeGreaterThan(2000);
      expect(outN).toBeGreaterThan(4000);
      expect(surfN).toBeGreaterThan(100);
      expect(maxDiff).toBeLessThan(1e-12);
      // The cost a reorder would move: field evaluations per in-region sample (3 with no skip on a two-sided split).
      const mean = inEvals / inN;
      expect(mean).toBeLessThan(c.meanEvalsUnder);
      console.log(`split twin, ${c.name}: max |twin - splitField| ${maxDiff.toExponential(2)} over ${RANDOM + seams.length + UNION} points; `
        + `evaluations per in-region sample ${mean.toFixed(2)}, within 1 cm of the surface ${(surfEvals / surfN).toFixed(2)}`);
    });
  }

  it('the twin copies the WGSL\'s statements in the WGSL\'s order', () => {
    const order = [
      'let splitOpen = gInstSplitOpen;',
      'var splitShell = 1e9;',
      'var pcA = vec3<f32>(-1e9, 0.0, 0.0);',
      'var pcB = vec3<f32>(1e9, 0.0, 1.0);',
      'var pcC = vec3<f32>(1e9, 0.0, 2.0);',
      'if (splitOpen) {',
      'splitShell = ',
      'var cap0 = ',
      'if (spDh <= gInstSplitR.x) {',
      'let capP = ',
      'let capM = ',
      'if (gInstSplitN.w == 0.0) { cap0 = min(cap0, capP); } else {',
      'if (gInstSplitA.w == 0.0) { cap0 = min(cap0, capM); } else {',
      'pcA.x = cap0;',
      'if (pcB.x < pcA.x) { let sw = pcA; pcA = pcB; pcB = sw; }',
      'if (pcC.x < pcB.x) { let sw = pcB; pcB = pcC; pcC = sw; }',
      'if (pcB.x < pcA.x) { let sw = pcA; pcA = pcB; pcB = sw; }',
      'for (var pc = 0; pc < 3; pc = pc + 1) {',
      'let piece = select(select(pcC, pcB, pc == 1), pcA, pc == 0);',
      'if (piece.x >= min(dUnion, splitShell)) { break; }',
      'if (piece.y != 0.0) { pMoved = splitMoveBack(',
      'let p = pMoved;',
      'if (splitOpen) { dPiece = max(dmgFinal, piece.x); }',
      'if (dPiece < dUnion) {',
      'pieceU = i32(piece.z);',
      'if (splitOpen) { dUnion = min(dUnion, splitShell); }',
    ];
    let at = 0;
    for (const line of order) {
      const i = MAP_BODY.indexOf(line, at);
      expect(i, line).toBeGreaterThan(-1);
      at = i + line.length;
    }
  });
});
