// src/lab/sdf-zombie/characters/gargoyle-blob.test.ts
//
// Pins the gargoyle's measured intent: digitigrade fold that passes
// checkStance, ground contact at the toe pads, hands hanging in front of
// the hips (the knuckle-dragger read), and the head riding forward of the
// chest. The reference (roth_gargoyle.glb) is INSPIRATION, not a fit target
// (owner, 2026-09-07) — so these are structural pins, not mesh-derived
// thresholds. What this file cannot check is whether it READS as the
// reference beast; that took the turntable frames (see the authoring skill).
import { describe, it, expect } from 'vitest';
import src from './gargoyle.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));

describe('gargoyle.blob', () => {
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

  it('declares digitigrade and folds the knees behind the hip->hock chord', () => {
    expect(doc.stance).toBe('digitigrade');
    const b = built();
    for (const side of ['l', 'r'] as const) {
      const thigh = b.bones.get(`thigh.${side}`)!;
      const shin = b.bones.get(`shin.${side}`)!;
      expect(thigh).toBeDefined();
      expect(shin).toBeDefined();
      const [hip, knee, ankle] = [thigh.head, thigh.tail, shin.tail];
      const t = (knee[1] - hip[1]) / (ankle[1] - hip[1]);
      const off = knee[2] - (hip[2] + (ankle[2] - hip[2]) * t);
      expect(off).toBeLessThan(-0.004); // hock forward = the bird fold
    }
  });

  it('stands on its toe pads at the ground, hocks clear of it', () => {
    const b = built();
    // The ground contact is the toe pad, not the hock: foot-bone masses
    // reach y ~0 while the hock blob stays a claw's width above it.
    const foot = b.bones.get('foot.l')!;
    expect(foot.tail[1]).toBeLessThan(0.05); // toe joint at the ground
    const hock = b.bones.get('shin.l')!.tail;
    expect(hock[1]).toBeGreaterThan(0.05);
  });

  it('hangs its hands in front of the body at hip height or below', () => {
    const b = built();
    for (const side of ['l', 'r'] as const) {
      const hand = b.bones.get(`hand.${side}`)!.tail;
      expect(hand[1]).toBeLessThan(0.45); // knuckle-dragger reach
      expect(hand[2]).toBeGreaterThan(0.15); // in FRONT of the hips (z)
    }
  });

  it('carries the head forward of the chest, wings and tail off the torso', () => {
    const b = built();
    const skull = b.bones.get('skull')!.tail;
    const chest = b.bones.get('chest')!.tail;
    expect(skull[2]).toBeGreaterThan(chest[2] + 0.05); // juts forward
    for (const name of ['wing1.l', 'wing1.r', 'wing2.l', 'wing2.r'])
      expect(b.bones.get(name)).toBeDefined();
    // The tail descends behind the pelvis toward the ground curl.
    const tail = b.bones.get('tail2')!.tail;
    expect(tail[2]).toBeLessThan(-0.3);
    expect(tail[1]).toBeLessThan(0.35);
  });
});
