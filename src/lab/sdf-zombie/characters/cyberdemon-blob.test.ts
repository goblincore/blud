// src/lab/sdf-zombie/characters/cyberdemon-blob.test.ts
//
// Pins the cyberdemon's DESIGN INTENT. There is no reference mesh and no
// reference plate for this character — the brief was prose, by owner
// instruction — so, exactly as gargoyle-blob.test.ts says of its own file,
// these are STRUCTURAL PINS, not mesh-derived thresholds. Each one names a
// decision from the .blob header and fails if that decision is quietly undone:
//
//   * the asymmetry (left arm a stump, right arm whole) is the silhouette;
//   * the arms and legs have real daylight, which is the check that has cost
//     this project two owner rejections (the goblin);
//   * the cable loom is `strand=` bundles, not a fat painted tube;
//   * the eyes are EMISSIVE PRIMS, not texture — and the sheet's own glow is
//     gated off, because the all-white-sheet-glows-red trap is real;
//   * the head is authored prims on a nubbed face block, and the decal's hs
//     frame is the cranium (the thornbeast lesson: pick it deliberately).
//
// What this file CANNOT check is whether he READS as a heavy augmented brute.
// That took the turntable frames (see the authoring skill).
import { describe, it, expect } from 'vitest';
import src from './cyberdemon.blob?raw';
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
const DAYLIGHT = 0.02 * 2.15;

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

describe('cyberdemon.blob', () => {
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

  it('declares humanoid and folds the knees forward', () => {
    expect(doc.stance).toBe('humanoid');
    const b = built();
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
  });

  it('is a 2.15 m brute whose crown reaches the declared height', () => {
    expect(doc.height).toBe(2.15);
    const head = clusterBounds(built(), 'head');
    expect(head.mx[1]).toBeGreaterThan(2.13);
    expect(head.mx[1]).toBeLessThan(2.17);
    // Ground contact: the foot masses sit ON the floor, not through it or
    // above it. A body whose feet float is the failure the mesh pipeline
    // spends raycasts to avoid; here it is one number.
    for (const side of ['legL', 'legR'] as const) {
      const foot = clusterBounds(built(), side);
      expect(foot.mn[1]).toBeGreaterThan(-0.02);
      expect(foot.mn[1]).toBeLessThan(0.03);
    }
  });

  // THE ASYMMETRY IS THE CHARACTER. The left arm is amputated mid-upper-arm
  // (the kit's hydraulic ram replaces it); the right arm is whole flesh. If
  // someone later authors a full left arm, or clips the right, this fails.
  it('keeps the left arm a stump and the right arm whole', () => {
    const b = built();
    const left = limb(b, 'armL');
    const right = limb(b, 'armR');
    expect(left.count).toBeLessThan(right.count);
    const elbow = b.bones.get('upperArm.l')!.tail[1];
    const stump = clusterBounds(b, 'armL');
    // The stump stops ABOVE the elbow joint — that is what "amputated above
    // the elbow" means geometrically.
    expect(stump.mn[1]).toBeGreaterThan(elbow);
    // The right arm reaches below its own elbow (a forearm and a fist).
    expect(clusterBounds(b, 'armR').mn[1]).toBeLessThan(b.bones.get('upperArm.r')!.tail[1] - 0.20);
  });

  // THE GOBLIN REGRESSION. clearOf reads centrelines; the render showed a
  // torso with arm-shaped bulges. daylightOf measures the air between
  // surfaces, ignoring the region where the limb legitimately merges into the
  // joint. Join radii here are the elbow and the knee, so what is measured is
  // the free part of each limb.
  it('hangs the flesh arm free of the torso below the elbow', () => {
    const b = built();
    const shoulder = b.bones.get('clavicle.r')!.tail;
    expect(daylightOf(b, limb(b, 'armR'), limb(b, 'torso'), shoulder, 0.36))
      .toBeGreaterThan(DAYLIGHT);
  });

  it.each(['legL', 'legR'] as const)('%s hangs free of the torso below the knee', leg => {
    const b = built();
    const hip = b.bones.get('pelvis')!.tail;
    expect(daylightOf(b, limb(b, leg), limb(b, 'torso'), hip, 0.45))
      .toBeGreaterThan(DAYLIGHT);
  });

  it('is still one body: arm and legs fuse to the torso', () => {
    const b = built();
    expect(fusedOf(b, limb(b, 'armR'), limb(b, 'torso'))).toBeLessThan(0);
    for (const leg of ['legL', 'legR'] as const)
      expect(fusedOf(b, limb(b, leg), limb(b, 'torso'))).toBeLessThan(0);
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    const b = built();
    expect(clearOf(b, limb(b, 'legL'), limb(b, 'legR'))).toBeGreaterThan(0.010);
    for (const c of b.clusters) {
      const gap = strandedOf(b, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });

  // BEAT 2 — THE LOOM. Exposed red cabling, authored as `strand=` bundles so
  // it reads as parallel conduits rather than one fat vein. Three bundles,
  // each of several strands, all red-dominant and glossy.
  it('carries the red cable loom as strand bundles', () => {
    const b = built();
    const torso = limb(b, 'torso');
    const cables = b.prims.slice(torso.start, torso.start + torso.count)
      .filter(p => p.strand !== undefined);
    expect(cables.length).toBeGreaterThanOrEqual(3);
    for (const p of cables) {
      expect(p.strand!.count).toBeGreaterThanOrEqual(4);
      expect(p.color).toBeDefined();
      const [r, g, bl] = p.color!;
      expect(r).toBeGreaterThan(g * 3);   // unmistakably red
      expect(r).toBeGreaterThan(bl * 3);
      expect(p.gloss).toBeGreaterThan(0); // rubber, not matte paint
    }
  });

  // BEAT 3 — LIT EYES. Emissive PRIMS, not texture: the brief wants them
  // readable in a dim room, and the sheet's own glow is deliberately gated
  // off below. Two, the same colour, and that colour is cool against the red
  // loom so the two "lit" cues never blur together.
  it('has two emissive optic eyes, cool against the red loom', () => {
    const b = built();
    const head = limb(b, 'head');
    const eyes = b.prims.slice(head.start, head.start + head.count)
      .filter(p => (p.glow ?? 0) > 0.5);
    expect(eyes).toHaveLength(2);
    const [a, c] = eyes;
    expect(a).toBeDefined();
    expect(c).toBeDefined();
    expect(a!.color).toEqual(c!.color);
    const [r, g, bl] = a!.color!;
    expect(bl).toBeGreaterThan(r);       // cyan-white, not amber
    expect(g).toBeGreaterThan(r);
  });

  // THE FACE ROAD (gargoyle precedent). No mesh means no bake, so all
  // structure is prims on a NUBBED face block and the decal carries the mouth
  // only. The hs frame — the fattest UNPAINTED head prim — must be the
  // cranium, because the decal projects from it: if a covering prim wins, the
  // mouth lands on the covering prim's frame (the soldier's flat-top lesson).
  it('authors the head as prims and leaves the face block a nub', () => {
    const face = compileFace(doc);
    expect(face.headRadius).toBeLessThan(0.002);
    expect(face.browHeavy).toBe(0);
    expect(face.noseLength).toBe(0);

    const b = built();
    const head = limb(b, 'head');
    const prims = b.prims.slice(head.start, head.start + head.count)
      .filter(p => p.op !== 'sub' && p.color === undefined && p.radius > 0.01);
    let best = prims[0]!;
    for (const p of prims)
      if (p.radius * Math.max(...p.scale) > best.radius * Math.max(...best.scale)) best = p;
    // The winner is the cranium: the widest-tallest unpainted mass, and the
    // only one with a semi-height above 0.15.
    expect(best.radius * best.scale[1]).toBeGreaterThan(0.15);
  });

  it('wears a generated mouth-only decal with the sheet glow gated off', () => {
    const sheet = compileSheet(doc)!;
    expect(doc.sheetImage).toBe('cyberdemon-face.png');
    expect(sheet.decal).toBe(0);          // MULTIPLY, so the mouth takes the body's light
    expect(sheet.eyeGlowCut).toBe(0.99);  // nothing in this texture may glow...
    expect(sheet.eyeGlowAmp).toBe(0);     // ...the eyes are prims
  });

  it('is registered, and its registry face is the PNG the sheet declares', () => {
    const entry = characterEntry('cyberdemon');
    expect(entry.src).toBe(src);
    expect(entry.face.url).toBe('/assets/lab/faces/cyberdemon-face.png');
  });

  // Ash-grey mauve, NOT the zombie's pink and not the gargoyle's blue stone.
  // Asserted loosely so art direction stays free, but the invariant that
  // matters is that the block EXISTS and sets the things no stock preset sets
  // (a nonzero mottle, a red wound interior) — a missing palette silently
  // renders every character as the same pink creature.
  it('wears its own ash-mauve palette rather than a stock preset', () => {
    const m = compilePalette(doc);
    expect(m).not.toBeNull();
    const [r, g, b] = m!.baseColor;
    expect(r).toBeGreaterThan(g);        // warm-grey, not green
    expect(g).toBeGreaterThanOrEqual(b); // ...but desaturated, not pink
    expect(r).toBeLessThan(0.5);         // dark: a man who has not seen sun
    expect(m!.mottleAmp).toBeGreaterThan(0.2);
    expect(m!.deepColor[0]).toBeGreaterThan(m!.deepColor[1]); // wounds stay red
  });
});
