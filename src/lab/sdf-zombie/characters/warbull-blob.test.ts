// src/lab/sdf-zombie/characters/warbull-blob.test.ts
//
// Pins the warbull body's DESIGN INTENT against the minotaur it is scaled
// from (warbull.blob's header): the minotaur's mesh-fitted flesh at 1.28x,
// its painted metal removed, the right horn and right eye handed to the kit,
// and a hump added. Structural pins, like juggernaut-blob.test.ts; whether
// he reads as a cyber-bull is the kit's and the frames' job.
import { describe, it, expect } from 'vitest';
import src from './warbull.blob?raw';
import minotaurSrc from './minotaur.blob?raw';
import soldierSrc from './soldier.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf, strandedOf } from '../blob-checks';
import { sdBody } from '../validate';
import { WALL_H } from '../webgpu/game-level';

const doc = parseBlob(src);
const minoDoc = parseBlob(minotaurSrc);
type Built = ReturnType<typeof buildBody>;
const build = (d: typeof doc): Built => buildBody(compileBlob(d, compileFace(d)));
const bull = build(doc);
const mino = build(minoDoc);
const soldier = build(parseBlob(soldierSrc));
const limb = (b: Built, l: string) => b.clusters.find(c => c.limb === l)!;
const S = 1.28;

/** Highest point of the SURFACE (a field march; a prim bound over-counts a
 *  tapered horn tip by its fat-end radius). */
const topOf = (b: Built) => {
  let top = 0;
  for (let x = -0.5; x <= 0.5; x += 0.01) for (let z = -0.3; z <= 0.4; z += 0.02) {
    let y = 3;
    while (y > top && sdBody([x, y, z], b) > 0.002) y -= 0.005;
    top = Math.max(top, y);
  }
  return top;
};
/** Head prims reaching further out than `x` on the given side. */
const headOut = (b: Built, side: 1 | -1, x: number) => {
  const c = limb(b, 'head');
  return b.prims.slice(c.start, c.start + c.count).filter(p => p.op !== 'sub' && Math.max(side * p.a[0], side * p.b[0]) > x);
};
/** Centreline back surface at height y (the most negative z still inside). */
const backAt = (b: Built, y: number) => {
  let z = -1;
  while (z < 0.5 && sdBody([0, y, z], b) > 0.001) z += 0.002;
  return z;
};

describe('warbull.blob', () => {
  it('compiles and validates clean', () => {
    expect(bull.errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  it('declares humanoid and passes the stance check', () => {
    expect(doc.stance).toBe('humanoid');
    expect(checkStance(bull.bones, doc.stance)).toEqual([]);
  });

  // Same bone NAMES as the soldier, so the soldier-family systems (carry,
  // regional injury, plates keyed by bone) can drive him.
  it('uses the soldier\'s bone names', () => {
    expect([...bull.bones.keys()].sort()).toEqual([...soldier.bones.keys()].sort());
  });

  it('is the minotaur scaled 1.28: every bone head moves by exactly S', () => {
    expect(doc.height! / minoDoc.height!).toBeCloseTo(S, 3);
    for (const [name, bone] of mino.bones)
      for (let k = 0; k < 3; k++)
        expect(bull.bones.get(name)!.head[k], `${name}[${k}]`).toBeCloseTo(bone.head[k]! * S, 3);
  });

  // The horn is his highest point, and it must clear no ceiling: rooms are
  // WALL_H (3.0 m) tall and his stride bobs.
  it('tops out at ~2.60 m on the horn, under the room ceiling with headroom', () => {
    const top = topOf(bull);
    expect(top).toBeGreaterThan(2.55);
    expect(top).toBeLessThan(WALL_H - 0.35);
  });

  it('keeps only the LEFT flesh horn and eye; the right side is the kit\'s', () => {
    // The horn sweep reaches x ~0.33 m; the root bosses stop at ~0.2.
    expect(headOut(bull, 1, 0.25).length).toBeGreaterThan(0);
    expect(headOut(bull, -1, 0.25)).toEqual([]);
    const glow = bull.prims.filter(p => (p.glow ?? 0) > 0);
    expect(glow.length).toBe(1);
    expect(glow[0]!.a[0]).toBeGreaterThan(0);
  });

  it('carries no painted metal: every hard surface is the kit\'s', () => {
    expect(bull.prims.filter(p => p.metal || p.box)).toEqual([]);
  });

  // The hump pushes the back of the neck out where the minotaur has only the
  // gap behind his traps.
  it('has a hump behind the neck at least 4 cm proud of the minotaur\'s back', () => {
    for (const y of [1.70, 1.75, 1.80])
      expect(backAt(bull, y), `y ${y}`).toBeLessThan(backAt(mino, y / S) * S - 0.04);
  });

  it('is still one body: arms, legs and head fuse to the torso', () => {
    for (const l of ['armL', 'armR', 'legL', 'legR', 'head'] as const)
      expect(fusedOf(bull, limb(bull, l), limb(bull, 'torso')), l).toBeLessThan(0);
  });

  // Uniform scale keeps every clearance ratio, so the pin is: no worse than
  // the minotaur, scaled.
  it.each(['armL', 'armR'] as const)('%s reads as a limb no worse than the minotaur\'s, scaled', arm => {
    const clav = arm === 'armL' ? 'clavicle.l' : 'clavicle.r';
    const dl = (b: Built, r: number) => daylightOf(b, limb(b, arm), limb(b, 'torso'), b.bones.get(clav)!.tail, r);
    expect(dl(bull, 0.45 * S)).toBeGreaterThanOrEqual(dl(mino, 0.45) * S - 0.002);
  });

  it('keeps the legs clear of each other and nothing stranded in a cluster', () => {
    expect(clearOf(bull, limb(bull, 'legL'), limb(bull, 'legR'))).toBeGreaterThan(0.010);
    for (const c of bull.clusters) {
      const gap = strandedOf(bull, c);
      if (gap !== null) expect(gap, `${c.limb} has a stranded prim`).toBeLessThan(0.005);
    }
  });
});
