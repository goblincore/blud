// src/lab/sdf-zombie/characters/schoolgirl-described-blob.test.ts
//
// The DESCRIBED schoolgirl: same subject as schoolgirl.blob, authored from
// the plate alone (no blob:rings/blob:measure — fitting is the thing this
// run is compared against). These pins are therefore DESIGN pins, not
// measured facts: the three silhouette beats (red neckerchief, white slouch
// boots wider than the leg, the navy/white/red block grammar) and the
// invariants every character owes (compiles, folds, no floaters, arms
// clear of the skirt).
import { describe, it, expect } from 'vitest';
import src from './schoolgirl-described.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf } from '../blob-checks';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));

describe('schoolgirl-described.blob', () => {
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

  // LIMB CLEARANCE (the goblin lesson): the resting arms must hang clear of
  // the skirt shell, not meld into it.
  it('keeps the arms clear of the skirt', () => {
    const b = built();
    const cl = (l: string) => b.clusters.find(c => c.limb === l)!;
    expect(clearOf(b, cl('armL'), cl('torso'))).toBeGreaterThan(0);
    expect(clearOf(b, cl('armR'), cl('torso'))).toBeGreaterThan(0);
  });

  // THE BLOCK GRAMMAR: red neckerchief (knot + tails), navy skirt + collar,
  // white blouse. color= is stored LINEAR — judge classes in linear space
  // (red b01018 -> (0.464, 0.004, 0.008); navy 0b1278 -> (0.002, 0.005,
  // 0.195)).
  it('wears the sailor blocks: red neckerchief, navy skirt/collar, white blouse', () => {
    const b = built();
    const isRed = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[0] > 0.2 && p.color[1] < 0.1 && p.color[2] < 0.1;
    const isNavy = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[2] > 0.1 && p.color[2] > p.color[0] * 20;
    const isWhite = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[0] > 0.5 && p.color[1] > 0.5 && p.color[2] > 0.5;
    const torso = b.clusters.find(c => c.limb === 'torso')!;
    const prims = b.prims.slice(torso.start, torso.start + torso.count);
    expect(prims.filter(isRed).length).toBeGreaterThanOrEqual(2); // knot + tails
    expect(prims.filter(isNavy).length).toBeGreaterThanOrEqual(3); // skirt + cape + V points
    expect(prims.filter(isWhite).length).toBeGreaterThanOrEqual(1);
  });

  // THE SLOUCH BOOT: the shaft is CLOTH-LOOSE leather, wider than the calf
  // flesh inside it — if an edit slims the boot to the leg, it stops being
  // a slouch boot and becomes a sock.
  it('wears the boot fatter than the shin flesh under it', () => {
    const b = built();
    const isWhite = (p: { color?: readonly [number, number, number] }) =>
      !!p.color && p.color[0] > 0.5 && p.color[1] > 0.5 && p.color[2] > 0.5;
    const legs = b.prims.filter(p => p.limb === 'legL');
    const boot = legs.filter(isWhite).reduce((a, p) => (p.radius! > a.radius! ? p : a));
    const calf = legs.filter(p => !isWhite(p) && p.radiusB === undefined && p.radius! < 0.05)
      .reduce((a, p) => (p.radius! > a.radius! ? p : a));
    expect(boot.radius!).toBeGreaterThan(calf.radius! + 0.008);
  });

  it('wears the baked mesh face as a decal', () => {
    const sheet = compileSheet(doc)!;
    expect(sheet.decal).toBe(0); // MULTIPLY — the face takes the body's light
    expect(compileSheetImage(doc)).toBe('schoolgirl-described-face.png');
  });
});
