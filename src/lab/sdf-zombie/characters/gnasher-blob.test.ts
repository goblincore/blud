// src/lab/sdf-zombie/characters/gnasher-blob.test.ts
//
// Pins gnasher's DESIGN INTENT. There is no reference mesh and no reference
// plate — the brief was prose, by owner instruction — so, exactly as
// gargoyle-blob.test.ts says of its own file, these are STRUCTURAL PINS, not
// mesh-derived thresholds. Each names a decision from the .blob header:
//
//   * the digitigrade fold that checkStance verifies (declared, not implied);
//   * the MAW dominates the skull: the upper jaw is a wider mass than the
//     cranium, and the gape between the jaws is a real gap with teeth in it;
//   * the eyes are exactly two EMISSIVE PRIMS, not texture;
//   * the arms reach the ground — the knuckle-dragger read;
//   * the arms and legs have real daylight, the check that has cost this
//     project two owner rejections (the goblin's fused arms);
//   * the face block is a nub and the head is authored prims.
//
// What this file CANNOT check is whether it READS as a charging animal. That
// took the turntable frames (see the authoring skill).
import { describe, it, expect } from 'vitest';
import src from './gnasher.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
import { characterEntry } from '../character-registry';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;
/** 2% of standing height: the separation the authoring skill calls visible
 *  from every yaw rather than only the shadowed side. */
const DAYLIGHT = 0.02 * 1.90;

/** World-space extents of a cluster's SOLID prims, honouring per-axis scale. */
function clusterBounds(b: ReturnType<typeof built>, l: string) {
  const c = limb(b, l);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of b.prims.slice(c.start, c.start + c.count)) {
    if (p.op === 'sub') continue;
    for (const e of [p.a, p.b]) {
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i]!, e[i]! - p.radius * p.scale[i]!);
        mx[i] = Math.max(mx[i]!, e[i]! + p.radius * p.scale[i]!);
      }
    }
  }
  return { mn, mx };
}

describe('gnasher.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, so a
  // face/sheet/palette key typo is invisible unless each block is compiled
  // explicitly — the same trap gargoyle-blob.test.ts and the cyclops record.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('declares digitigrade and folds the knees behind the hip->ankle chord', () => {
    expect(doc.stance).toBe('digitigrade');
    const b = built();
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
  });

  // THE MAW IS THE FACE. The upper jaw must out-mass the cranium, or the head
  // is a skull with a mouth instead of a mouth with a skull.
  it('makes the maw the dominant mass of the skull', () => {
    const b = built();
    const head = limb(b, 'head');
    const solids = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.op !== 'sub');
    // Biggest by volume proxy r^3 * scale product: the upper jaw.
    const vol = (p: (typeof solids)[number]) =>
      p.radius ** 3 * p.scale[0]! * p.scale[1]! * p.scale[2]!;
    const ranked = [...solids].sort((x, y) => vol(y) - vol(x));
    const top = ranked[0]!;
    // The upper jaw spans x > 0.19 m half-width and sits low (y < 1.60).
    expect(top.radius * top.scale[0]!).toBeGreaterThan(0.19);
    expect(top.a[1]).toBeLessThan(1.62);
    // And it is UNPAINTED flesh — the maw's dark interior and teeth are painted
    // and must not be the dominant mass.
    expect(top.color).toBeUndefined();
  });

  // The gape is geometry: the lower jaw's top sits below the upper jaw's
  // bottom by a real gap. This is what stops the mouth reading as a painted
  // line.
  it('drops the lower jaw so the mouth is a real gap', () => {
    const b = built();
    const head = limb(b, 'head');
    const solids = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.op !== 'sub' && p.color === undefined);
    // The two big unpainted jaw masses are the widest solids in the head after
    // the cranium; find the lowest one and the highest of the pair.
    const jawish = solids.filter(p => p.radius * p.scale[0]! > 0.15);
    const lowestTop = Math.max(...jawish.map(p => p.a[1] + p.radius * p.scale[1]!));
    const lower = jawish.reduce((a, p) => (p.a[1] < a.a[1] ? p : a));
    const upperBottom = Math.min(
      ...jawish.filter(p => p !== lower).map(p => p.a[1] - p.radius * p.scale[1]!));
    expect(lowestTop).toBeGreaterThan(upperBottom - 0.30); // sanity: same head
    expect(lower.a[1]).toBeLessThan(1.45); // the jaw really hangs
    expect(upperBottom - (lower.a[1] + lower.radius * lower.scale[1]!)).toBeGreaterThan(0.02);
  });

  it('carries two emissive eyes and nothing else that glows', () => {
    const b = built();
    const glowing = b.prims.filter(p => (p.glow ?? 0) > 0.5);
    expect(glowing).toHaveLength(2);
    const [a, c] = glowing;
    expect(a).toBeDefined();
    expect(c).toBeDefined();
    expect(a!.color).toEqual(c!.color);
    // Amber: red >= green > blue, and not the gargoyle's near-pure orange.
    const [r, g, bl] = a!.color!;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(bl * 2);
  });

  it('reaches the ground with its knuckles and stands on its toe pads', () => {
    const b = built();
    for (const side of ['l', 'r'] as const) {
      const hand = b.bones.get(`hand.${side}`)!.tail;
      expect(hand[1]).toBeLessThan(0.30); // knuckle-dragger reach
      expect(hand[2]).toBeGreaterThan(0.35); // carried FORWARD of the hips (z)
    }
    for (const l of ['legL', 'legR'] as const) {
      const foot = clusterBounds(b, l);
      expect(foot.mn[1]).toBeGreaterThan(-0.02);
      expect(foot.mn[1]).toBeLessThan(0.03);
    }
    // Hocks clear of the floor: the contact is the toe pad, not the heel.
    for (const side of ['l', 'r'] as const)
      expect(b.bones.get(`shin.${side}`)!.tail[1]).toBeGreaterThan(0.05);
  });

  // THE GOBLIN REGRESSION. clearOf reads centrelines; the render showed a
  // torso with arm-shaped bulges. daylightOf measures the air between
  // surfaces, ignoring the region where the limb legitimately merges into the
  // joint. This character's arms are heavy and hang close to a deep chest,
  // which is exactly the case that fails.
  it('hangs both arms free of the torso below the elbow', () => {
    const b = built();
    for (const side of ['armL', 'armR'] as const) {
      const shoulder = b.bones.get(
        side === 'armL' ? 'clavicle.l' : 'clavicle.r')!.tail;
      expect(daylightOf(b, limb(b, side), limb(b, 'torso'), shoulder, 0.40))
        .toBeGreaterThan(DAYLIGHT);
    }
  });

  it.each(['legL', 'legR'] as const)('%s hangs free of the torso below the knee', leg => {
    const b = built();
    const hip = b.bones.get('pelvis')!.tail;
    expect(daylightOf(b, limb(b, leg), limb(b, 'torso'), hip, 0.45))
      .toBeGreaterThan(DAYLIGHT);
  });

  it('is still one body: arms and legs fuse to the torso', () => {
    const b = built();
    for (const l of ['armL', 'armR', 'legL', 'legR'] as const)
      expect(fusedOf(b, limb(b, l), limb(b, 'torso'))).toBeLessThan(0);
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    const b = built();
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0.010);
    for (const c of b.clusters) {
      const gap = strandedOf(b, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });

  it('authors the head as prims and leaves the face block a nub', () => {
    const face = compileFace(doc);
    expect(face.headRadius).toBeLessThan(0.002);
    expect(face.browHeavy).toBe(0);
    expect(face.noseLength).toBe(0);
  });

  it('is registered, so ?character=gnasher does not render the zombie', () => {
    const entry = characterEntry('gnasher');
    expect(entry.src).toBe(src);
  });

  // Raw-meat brute hide, NOT the zombie's pink and not the minotaur's bright
  // wet pink. Asserted loosely so art direction stays free, but the invariant
  // that matters is that the block EXISTS and sets the things no stock preset
  // sets (a nonzero mottle, a red wound interior).
  it('wears its own dark raw-meat palette rather than a stock preset', () => {
    const m = compilePalette(doc);
    expect(m).not.toBeNull();
    const [r, g, b] = m!.baseColor;
    expect(r).toBeGreaterThan(g);        // red-brown, not green
    expect(g).toBeGreaterThanOrEqual(b); // ...and not pink
    expect(r).toBeLessThan(0.45);        // dark, grimy hide
    expect(m!.mottleAmp).toBeGreaterThan(0.3);
    expect(m!.deepColor[0]).toBeGreaterThan(m!.deepColor[1]); // wounds stay red
  });
});
