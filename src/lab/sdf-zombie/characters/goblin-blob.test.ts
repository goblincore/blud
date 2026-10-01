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
import { sdBody } from '../validate';
import { lerp } from '../vec';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const limb = (b: ReturnType<typeof built>, l: string) => b.clusters.find(c => c.limb === l)!;
// Distance from p along the unit direction d to the body's surface (where the field turns positive), in 0.5 mm steps.
// Throws if p starts outside the body or the ray never leaves it: either would read as a plausible width.
const reach = (b: ReturnType<typeof built>, p: Vec3, d: Vec3, max = 0.3): number => {
  if (sdBody(p, b) > 0) throw new Error(`reach: start (${p.join(', ')}) is outside the body`);
  for (let t = 0; t < max; t += 0.0005)
    if (sdBody([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], b) > 0) return t;
  throw new Error(`reach: no surface within ${max} m of (${p.join(', ')})`);
};
// The point t (0..1) of the way along a resolved bone, head to tail.
const boneAt = (b: ReturnType<typeof built>, name: string, t: number): Vec3 => {
  const bone = b.bones.get(name)!;
  return lerp(bone.head, bone.tail, t);
};

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
  // length, and shouldn't be. On the ball-jointed body as first tuned, the
  // clearance rose smoothly from the shoulder: 0.6 mm of air 60 mm out, 20 mm
  // at 115 mm, 32 mm at 143 mm. The buried part is the deltoid — an upper arm
  // that springs clear of the chest the instant it leaves the shoulder round
  // reads as glued on, so the top of that shaft is meant to merge. Only past
  // it does daylight become the point.
  it.each(['armL', 'armR'] as const)('%s hangs free below the elbow', arm => {
    const b = built();
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    // 0.235 m from the shoulder IS the elbow — the upper arm's length. Below
    // it there is no anatomical excuse for touching the body, and this is the
    // exact stretch the owner rejected: the forearm ran into the gut. Measured
    // at 43.6 mm on the ball-jointed body, 48.5 mm on the 2026-10-01 rebuild;
    // 30 mm is roughly where separation became visible from every yaw
    // in the turntable rather than only on the shadowed side.
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.235))
      .toBeGreaterThan(0.030);
  });

  it.each(['armL', 'armR'] as const)('%s upper arm emerges from the chest', arm => {
    const b = built();
    const shoulder = b.bones.get(`clavicle.${arm === 'armL' ? 'l' : 'r'}`)!.tail;
    // 0.11 m clears the shoulder round (r 0.038 since the 2026-10-01 rebuild,
    // marked as the arm's core; it was a 0.054 ball) and the deltoid merge
    // above. Measured at 19.2 mm (29.0 on the old body; the chest's wide=1.00,
    // down from the look-dev's 1.06, is what keeps it above 15 mm: at 1.06 it
    // read 14.99). The failure this catches is the whole upper arm descending
    // INSIDE the ribcage, which is what tilt=7 did before.
    expect(daylightOf(b, limb(b, arm), limb(b, 'torso'), shoulder, 0.11))
      .toBeGreaterThan(0.015);
  });

  // ...but still attached. The opposite failure, and equally easy to trip:
  // pushing the shoulder out far enough to clear the torso detaches the arm
  // entirely, and past a point validateBody reports the cluster disconnected.
  // The fuse probe runs from the arm's `core` (its shoulder round; see
  // goblin.blob's arms-and-legs block) to the torso's: without that mark
  // the hand, the fattest arm prim, would be the start and the probe would
  // cross air.
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

  // 2026-10-01 refinement (docs/superpowers/specs/2026-10-01-goblin-refinement-design.md). The owner's read of the
  // old body was "a series of orbs": five ellipsoids stacked up the spine at tight blends, and a nub at every joint.
  // These three pin the rebuild (variant A, "sinew"). Unlike the pins above, their thresholds are not owner
  // rejections: each sits between the old body's measured value and the rebuilt one's (2026-10-01).

  // A stacked torso pinches between its rings. Switch the arms and legs off first: with them on, the thighs and the
  // old hip orbs own the bottom of every slice and the profile measures legs. Then slice the torso every 5 mm from
  // the pelvis to high on the chest and read its half-width. The deepest dip, how far a slice falls below the lower
  // of the highs on either side of it, is a pinch between rings. Old body: 20.5 mm, at the spine/chest joint,
  // between its spine and lower chest ellipsoids. Rebuilt: 5.0 mm, which is the waist.
  it('has one continuous torso, not stacked rings', () => {
    const b = built();
    for (const c of b.clusters) if (c.limb.startsWith('arm') || c.limb.startsWith('leg')) c.alive = false;
    const p0 = b.bones.get('pelvis')!.head;
    const p1 = boneAt(b, 'chest', 0.85);
    const width: number[] = [];
    for (let y = p0[1]; y <= p1[1]; y += 0.005) {
      const t = (y - p0[1]) / (p1[1] - p0[1]);
      width.push(reach(b, [0, y, p0[2] + (p1[2] - p0[2]) * t], [1, 0, 0]));
    }
    let deepest = 0;
    width.forEach((w, i) => {
      const dip = Math.min(Math.max(...width.slice(0, i + 1)), Math.max(...width.slice(i))) - w;
      deepest = Math.max(deepest, dip);
    });
    expect(deepest).toBeLessThan(0.010);
  });

  // deep= scales a prim front and back alike, so a deep torso on the spine's own axis bulges at the back of the
  // waist as much as at the belly (the look-dev's flaw). The gut hangs in front and the back stays flat enough for
  // the spine to read. Rebuilt: belly +27.0 mm, waist +14.7 mm (pelvis at=0.8, spine1 at=0.3, on the bone axis;
  // reach's 0.5 mm steps read the waist as 14.5). Old body: 0.0 and -9.5 mm.
  it('carries its gut in front, not bulging at the back', () => {
    const b = built();
    const gut = (p: Vec3) => reach(b, p, [0, 0, 1]) - reach(b, p, [0, 0, -1]);
    const belly = boneAt(b, 'pelvis', 0.8), waist = boneAt(b, 'spine1', 0.3);
    expect(gut(belly)).toBeGreaterThan(0.015);
    expect(gut(waist)).toBeGreaterThan(0.008);
  });

  // No ball joints on the limbs. The orbs that stay are a style the owner kept (early 3D): the hands, the shoulder
  // round (which is also the arm's `core`), the ankle knob and the toe pad. Any other point-blob on an arm or a leg
  // is a joint orb coming back.
  it('keeps orbs only at the shoulders, hands, ankles and toes', () => {
    const allowed = (p: { bone: string; at: number }) =>
      p.bone === 'hand' || (p.bone === 'foot' && p.at > 0.5) ||
      (p.bone === 'clavicle' && p.at === 1) || (p.bone === 'shin' && p.at === 1);
    const orbs = doc.parts.filter(p => p.kind === 'blob' && (p.limb === 'arm' || p.limb === 'leg'));
    expect(orbs.filter(p => !allowed(p)).map(p => `${p.bone} at=${p.at}`)).toEqual([]);
  });
});
