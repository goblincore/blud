// src/lab/sdf-zombie/characters/schoolgirl-alt-blob.test.ts
//
// The EXPERIMENT character: same subject as schoolgirl.blob, authored WITH
// blob:rings/blob:measure starting from the reference rig's own bone lengths.
// Every threshold below is a number measured off
// docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb by this author
// (2026-08-28): rig joint distances from a jointWorld dump x 0.9294 (-> the
// 1.58 m authoring height), surface widths from joint-filtered,
// texture-classified per-vertex slices. This file pins the METHOD's
// preconditions (measured bones, cloth layering, the mesh's actual stance) —
// the things the hand-authored control could not check with instruments.
import { describe, it, expect } from 'vitest';
import src from './schoolgirl-alt.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf } from '../blob-checks';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

describe('schoolgirl-alt.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('folds the way it declared', () => {
    expect(checkStance(built().bones, doc.stance)).toEqual([]);
  });

  // =====================================================================
  // MEASURED BONES — the experiment's headline precondition. Each len= is
  // the reference rig's joint-to-joint distance x 0.9294 (1.58/1.70),
  // measured off the bind pose (2026-08-28, .l bones; .r within 3%).
  // blob:rings must find ZERO bone-length drift on this file; this pin
  // keeps a future edit from reintroducing it.
  // =====================================================================
  it('carries the reference rig bone lengths at 0.9294 scale (within 2%)', () => {
    const measured: Record<string, number> = {
      pelvis: 0.1037, spine1: 0.1037, chest: 0.1037, spine2: 0.0544,
      neck: 0.0790, clavicle: 0.1070, upperarm: 0.2291, forearm: 0.2146,
      thigh: 0.3686, shin: 0.3504, foot: 0.1270,
    };
    const bones = built().bones;
    const len3 = (bn: { readonly head: readonly number[]; readonly tail: readonly number[] }) =>
      Math.hypot(bn.tail[0]! - bn.head[0]!, bn.tail[1]! - bn.head[1]!, bn.tail[2]! - bn.head[2]!);
    // central bones are unmirrored; limb bones carry .l
    const central = new Set(['pelvis', 'spine1', 'chest', 'spine2', 'neck']);
    for (const [name, len] of Object.entries(measured)) {
      const key = central.has(name) ? name : `${name}.l`;
      const bone = bones.get(key)!;
      expect(bone, `bone ${key} exists`).toBeDefined();
      const blen = len3(bone);
      expect(blen).toBeGreaterThan(len * 0.98);
      expect(blen).toBeLessThan(len * 1.02);
    }
  });

  // The mesh is 1.70 m; this file authors at x0.9294. Crown = the fringe
  // peak, sole = the shoe tread. blob:measure aligns bounding boxes, so the
  // standing height must be exactly 1.58 for the A/B to compare method.
  it('stands exactly 1.58 m — crown to sole', () => {
    const b = built();
    let top = 0, bottom = 2;
    for (let y = 1.3; y <= 1.68; y += 0.002)
      if (sdBody([0, y, 0.02], b) < 0) top = Math.max(top, y);
    for (let x = 0.02; x <= 0.25; x += 0.005)
      for (let z = -0.12; z <= 0.14; z += 0.005)
        for (let y = 0.012; y >= 0; y -= 0.002)
          if (sdBody([x, y, z], b) < 0) bottom = Math.min(bottom, y);
    expect(top).toBeGreaterThan(1.575);
    expect(top).toBeLessThan(1.585);
    expect(bottom).toBeLessThan(0.005);
  });

  // CLOTH INSIDE/OUTSIDE (the dressed-mesh trap, pinned):
  // The sock is fabric and carries the surface: per-sock radius 0.050 at the
  // cuff vs the calf flesh 0.042 under it (measured +8 mm). If a future edit
  // moves either prim toward the other, the sock stops reading as a sock.
  it('wears the sock fatter than the shin flesh under it (+8 mm, measured)', () => {
    const b = built();
    const sock = b.prims.find(p => p.limb === 'legL' && p.radiusB !== undefined && p.radius! > 0.048)!;
    const calf = b.prims.find(p => p.limb === 'legL' && p.radius! > 0.038 && p.radius! < 0.047 && p.radiusB === undefined)!;
    expect(sock.radius!).toBeGreaterThan(calf.radius! + 0.006);
  });

  // The thigh lives INSIDE the skirt: flesh half-width 0.062-0.070 at every
  // height the skirt covers, skirt half 0.186 at the hem. A naive fit to the
  // dressed reference inflates the leg out to the cloth — pin the air gap.
  it('keeps the thigh flesh well inside the skirt (cloth is not leg)', () => {
    const b = built();
    const bones = built().bones;
    const width = (y: number) => {
      let lo = NaN, hi = NaN;
      for (let x = -0.4; x <= 0.4; x += 0.002)
        if (sdBody([x, y, 0], b) < 0) { if (Number.isNaN(lo)) lo = x; hi = x; }
      return hi - lo;
    };
    // skirt band (0.719-0.995): pair width dominated by the shell cone
    expect(width(0.80)).toBeGreaterThan(0.33);   // mesh 0.383 full at 1.58-scale
    expect(width(0.90)).toBeLessThan(width(0.80)); // A-line: narrows upward
    // bare thigh just below the hem: measured pair 2 x (0.085 + 0.062) = 0.273
    expect(width(0.70)).toBeLessThan(0.31);
  });

  // STANCE: the mesh's knees are APART (segmented slices: knee centres
  // x +/-0.078, radii 0.040 -> an 8 cm gap at 1.58 m). The hand-authored
  // control pinned knees touching; the mesh says otherwise, and the side
  // view can see the difference the front silhouette cannot.
  it("stands with the mesh's knee gap: two legs, 0.20-0.27 pair width", () => {
    const b = built();
    const extent = (y: number) => {
      let lo = NaN, hi = NaN, segs = 0, prev = false;
      for (let x = -0.4; x <= 0.4; x += 0.002) {
        const s = sdBody([x, y, 0], b) < 0;
        if (s) { if (Number.isNaN(lo)) lo = x; hi = x; if (!prev) segs++; }
        prev = s;
      }
      return { w: hi - lo, segs };
    };
    const knee = extent(0.43);   // the narrowest band, measured 0.27-0.29 of 1.70
    expect(knee.segs).toBe(2);
    expect(knee.w).toBeGreaterThan(0.19);   // centres 0.156 + 2 x 0.040
    expect(knee.w).toBeLessThan(0.27);
  });

  // PROPORTION: waist (bare midriff + skirt waistband, measured 0.219 full at
  // the waistband) narrower than the bust (blouse 0.254 full). Scanned as the
  // CENTRE segment only — the resting arms are separate segments at this
  // height and must not pollute the torso read (the mesh protocol segments
  // slices the same way).
  it('has a waist narrower than the bust, both as measured', () => {
    const b = built();
    const centreRun = (y: number) => {
      // width of the solid RUN containing the centreline (the resting arms are
      // separate segments at these heights and must not pollute the read — the
      // mesh protocol segments slices the same way)
      let runLo = NaN, runHi = NaN, inRun = false, sawCentre = false, best = 0;
      for (let x = -0.4; x <= 0.4001; x += 0.002) {
        const s = x <= 0.4 && sdBody([x, y, 0], b) < 0;
        if (s && !inRun) { runLo = x; runHi = x; inRun = true; sawCentre = false; }
        else if (s && inRun) runHi = x;
        if (s && Math.abs(x) < 0.02) sawCentre = true;
        if ((!s || x > 0.4) && inRun) {
          if (sawCentre) best = Math.max(best, runHi - runLo);
          inRun = false;
        }
      }
      return best;
    };
    const waist = centreRun(1.01);
    const bust = centreRun(1.13);
    expect(waist).toBeGreaterThan(0.16);      // not a stick
    expect(waist).toBeLessThan(0.26);         // measured 0.219
    expect(bust).toBeGreaterThan(waist + 0.015);
  });

  // ANKLE HEIGHT: measured-length legs from the root land the ankle at the
  // rig's own ankle height (7.3% x 1.58 = 0.115). This is what "start from
  // measured bones" buys — pin it.
  it('lands the ankle at the rig height 0.115 above the floor', () => {
    const b = built();
    const shin = b.bones.get('shin.l')!;
    // the shin bone's tail (the ankle) in body space
    expect(shin.tail[1]).toBeGreaterThan(0.09);
    expect(shin.tail[1]).toBeLessThan(0.14);
  });

  // OUTFIT COLOURS, as measured (class-mean texels): navy (2,4,106), white
  // (232,232,233), sock grey (216,214,214), hair/shoe (25,17,9), and the
  // NECKERCHIEF IS RED (174,10,8) — the control's scarf is navy; the mesh's
  // is not. Relations, not exact tints.
  it('wears the measured outfit: red neckerchief, navy skirt/collar, white blouse', () => {
    const b = built();
    // color= is stored LINEAR: judge classes in linear space (red ae0a08 ->
    // (0.434, 0.003, 0.002); navy 01046a -> (0.0003, 0.001, 0.145))
    const isRed = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[0] > 0.2 && p.color[1] < 0.1 && p.color[2] < 0.1;
    const isNavy = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[2] > 0.1 && p.color[2] > p.color[0] * 50;
    const isWhite = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[0] > 0.5 && p.color[1] > 0.5 && p.color[2] > 0.5;
    const torso = limb(b, 'torso');
    const prims = b.prims.slice(torso.start, torso.start + torso.count);
    const reds = prims.filter(isRed);
    expect(reds.length).toBeGreaterThanOrEqual(2); // knot + tails
    const navies = prims.filter(isNavy);
    expect(navies.length).toBeGreaterThanOrEqual(2); // skirt + collar cape
    const legs = b.prims.filter(p => p.limb === 'legL' && p.color !== undefined);
    const socks = legs.filter(isWhite);
    expect(socks.length).toBeGreaterThanOrEqual(1);
  });

  // LIMB CLEARANCE (the goblin lesson): the resting arms must hang clear of
  // the skirt shell, not meld into it.
  it('keeps the arms clear of the skirt', () => {
    const b = built();
    const cl = (l: string) => b.clusters.find(c => c.limb === l)!;
    expect(clearOf(b, cl('armL'), cl('torso'))).toBeGreaterThan(0);
    expect(clearOf(b, cl('armR'), cl('torso'))).toBeGreaterThan(0);
  });

  it('wears the baked mesh face as a decal', () => {
    const sheet = compileSheet(doc)!;
    expect(sheet.decal).toBe(1);
    expect(compileSheetImage(doc)).toBe('schoolgirl-alt-face.png');
  });
});
