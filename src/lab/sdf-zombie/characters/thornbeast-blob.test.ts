// src/lab/sdf-zombie/characters/thornbeast-blob.test.ts
//
// Pins the thornbeast's authored intent: humanoid knee fold that passes
// checkStance, ground contact at the toe pads, the absurd arm reach with
// hands clear of the thighs, and the thorn inventory (pale-bone paint) plus
// the two ember eyes. The reference (docs/dev-notes/refs/
// thornbeast-reference.png, a Meshy AI concept plate) is INSPIRATION, not a
// fit target — owner instruction, 2026-09-08: no mesh was provided so none
// of these pins are mesh-derived thresholds. What this file cannot check is
// whether it READS as the plate; that took the turntable frames.
import { describe, it, expect } from 'vitest';
import src from './thornbeast.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));

describe('thornbeast.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so a
  // face/sheet/palette key typo is invisible unless each block is compiled
  // explicitly — same trap the cyclops test records.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('declares humanoid and folds the knees forward of the hip->ankle chord', () => {
    expect(doc.stance).toBe('humanoid');
    const b = built();
    for (const side of ['l', 'r'] as const) {
      const thigh = b.bones.get(`thigh.${side}`)!;
      const shin = b.bones.get(`shin.${side}`)!;
      expect(thigh).toBeDefined();
      expect(shin).toBeDefined();
      const [hip, knee, ankle] = [thigh.head, thigh.tail, shin.tail];
      const t = (knee[1] - hip[1]) / (ankle[1] - hip[1]);
      const off = knee[2] - (hip[2] + (ankle[2] - hip[2]) * t);
      expect(off).toBeGreaterThan(0.004); // knee forward = the man-fold
    }
  });

  it('stands on its toe pads at the ground, ankles clear of it', () => {
    const b = built();
    const foot = b.bones.get('foot.l')!;
    expect(foot.tail[1]).toBeLessThan(0.05); // toe joint at the ground
    const ankle = b.bones.get('shin.l')!.tail;
    expect(ankle[1]).toBeGreaterThan(0.05);
  });

  it('hangs its hands at thigh height or below, in front of the thighs', () => {
    const b = built();
    for (const side of ['l', 'r'] as const) {
      const hand = b.bones.get(`hand.${side}`)!.tail;
      expect(hand[1]).toBeLessThan(0.95); // the plate's absurd reach
      expect(hand[2]).toBeGreaterThan(0.12); // in FRONT of the body (z)
      expect(Math.abs(hand[0])).toBeGreaterThan(0.18); // outside the thigh
    }
  });

  it('sinks the head into the yoke: jaw mass dips below the shoulder tops', () => {
    const b = built();
    // Shoulder top = clavicle tail height; the cheek/jaw mass's LOWEST flesh
    // (centre minus its semi-y) must hang below it for the head to read as
    // SUNKEN, not perched. y is UP here — the bottom is centre - semi.
    const shoulderY = b.bones.get('clavicle.l')!.tail[1];
    const skull = b.bones.get('skull')!;
    // The skull bone itself rides above the yoke; the sunk read comes from
    // the cheek mass (at=0.40, offset y -0.130, semi-y r*tall = 0.115).
    const cheekCentreY = skull.head[1] + (skull.tail[1] - skull.head[1]) * 0.40 - 0.130;
    expect(cheekCentreY - 0.115).toBeLessThan(shoulderY + 0.02);
  });

  it('carries the thorn inventory in pale bone paint', () => {
    // Body thorns: 6 mirrored authoring lines (hand knuckle, 2 forearm rows,
    // 2 yoke-burst quills, 2 back-fan quills) double to 12 prims; the head
    // adds 11: centre crown + crown pair (via `both`) = 3, brow-ridge pair =
    // 2, and 4 upper teeth (two `both` lines) hanging into the maw slot.
    // Total 23. Bone c9b896, from the plate's pale thorns, compared as the
    // parser stores it — sRGB-decoded to linear (blob-parse.ts's toLinear),
    // not the raw hex bytes. Claws stay dark 26201a, the maw slot 1a0f08,
    // and the eyes ff6a1a must NOT be counted. (Cheek thorns were removed:
    // see the .blob's head section.)
    const toLinear = (c: number) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const bone = [0xc9, 0xb8, 0x96].map((h) => toLinear(h / 255));
    const b = built();
    const isBone = (p: { color?: [number, number, number] }) =>
      p.color !== undefined &&
      p.color.every((v, i) => Math.abs(v - bone[i]!) < 0.004);
    expect(b.prims.filter(isBone).length).toBe(23);
  });

  it('has no tail and no wings — the gargoyle owns those', () => {
    const b = built();
    expect(b.bones.get('tail')).toBeUndefined();
    expect(b.bones.get('wing1.l')).toBeUndefined();
  });
});
