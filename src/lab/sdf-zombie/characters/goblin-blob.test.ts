// src/lab/sdf-zombie/characters/goblin-blob.test.ts
//
// The goblin has no TypeScript twin to diff against the way zombie.blob has
// `makeZombie()`, so there is nothing to pin it to except its own measured
// properties. These are the ones that have actually broken, twice each, in the
// course of art-directing it — every threshold below is a number an owner
// review rejected the geometry over, not a round figure picked for looks.
//
// What this file CANNOT check is whether the goblin reads as a goblin. That
// needs the turntable and an eye (see the authoring skill). These tests exist
// so a future tweak to the torso does not silently undo a fix that took a
// render to find in the first place.
import { describe, it, expect } from 'vitest';
import src from './goblin.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { checkStance, clearOf, daylightOf, fusedOf } from '../blob-checks';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;

describe('goblin.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  // compileBlob's face default only fires when the argument is OMITTED, and
  // the lab always passes one — so a face-key typo is invisible unless
  // something calls compileFace explicitly. Same for the sheet block.
  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // The goblin is the reason palettes exist: before it declared its own flesh
  // the whole cast wore one global preset and read as the same pink creature
  // in different shapes. Asserting it is green rather than pinning exact
  // channels, so art direction stays free to move.
  it('wears its own green flesh rather than the lab default', () => {
    const m = compilePalette(doc)!;
    expect(m).not.toBeNull();
    const [r, g, b] = m.baseColor;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    // Wounds stay red — a green creature bleeding green reads as a plant.
    expect(m.deepColor[0]).toBeGreaterThan(m.deepColor[1]);
    // And the mottle is actually on, since it is off in every stock preset.
    expect(m.mottleAmp).toBeGreaterThan(0);
  });

  it('folds its knees the way it declared', () => {
    const b = built();
    expect(checkStance(b.bones, doc.stance)).toEqual([]);
  });

  // THE ARMS MUST READ AS ARMS. This is the regression that has bitten twice:
  // every geometric check passed while the render showed a torso with arm-
  // shaped bulges. clearOf is not enough — it measures centrelines, and the
  // arms were 5.4 mm of daylight away from the body while clearOf read a
  // comfortable +13.4 mm. See daylightOf's docstring.
  //
  // Split into two assertions because the arm is not equally free along its
  // length, and shouldn't be. The clearance profile rises smoothly from the
  // shoulder: 0.6 mm of air 60 mm out, 20 mm at 115 mm, 32 mm at 143 mm. The
  // buried part is the deltoid — an upper arm that springs clear of the chest
  // the instant it leaves the shoulder ball reads as glued on, so the top of
  // that shaft is meant to merge. Only past it does daylight become the point.
  it.each(['armL', 'armR'] as const)('%s hangs free below the elbow', arm => {
    const b = built();
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    // 0.235 m from the shoulder IS the elbow — the upper arm's length. Below
    // it there is no anatomical excuse for touching the body, and this is the
    // exact stretch the owner rejected: the forearm ran into the gut. Measured
    // at 43.6 mm; 30 mm is roughly where separation became visible from every
    // yaw in the turntable rather than only on the shadowed side.
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.235))
      .toBeGreaterThan(0.030);
  });

  it.each(['armL', 'armR'] as const)('%s upper arm emerges from the chest', arm => {
    const b = built();
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    // 0.11 m clears the shoulder ball (r 0.054) and the deltoid merge above.
    // Measured at 27.8 mm. The failure this catches is the whole upper arm
    // descending INSIDE the ribcage, which is what tilt=7 did before.
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.11))
      .toBeGreaterThan(0.015);
  });

  // ...but still attached. The opposite failure, and equally easy to trip:
  // pushing the shoulder out far enough to clear the torso detaches the arm
  // entirely, and past a point validateBody reports the cluster disconnected.
  it.each(['armL', 'armR'] as const)('%s is nonetheless fused to the torso', arm => {
    const b = built();
    expect(fusedOf(b, limb(b, arm), limb(b, 'torso'))).toBeLessThan(0);
  });

  // The hands sat 12 mm inside the thighs at rest, which would have become a
  // visible intersection the moment the walk cycle swung either limb.
  it.each([['armL', 'legL'], ['armR', 'legR']] as const)('%s does not pass through %s', (a, l) => {
    const b = built();
    expect(clearOf(b, limb(b, a), limb(b, l))).toBeGreaterThan(0.010);
  });

  // The elongated silhouette is the whole art direction — an earlier pass read
  // as "an egg with stumps" and the fix was making the legs about half the
  // standing height. A torso that creeps back down over the legs undoes it.
  it('keeps legs at roughly half its standing height', () => {
    const b = built();
    // `height` is optional in the grammar, so assert it is declared rather
    // than defaulting: a goblin with no height silently passing this test
    // would be the check quietly turning itself off.
    expect(doc.height).not.toBeNull();
    const hip = b.bones.get('thigh.l')!.head[1];
    expect(hip / doc.height!).toBeGreaterThan(0.50);
  });
});
