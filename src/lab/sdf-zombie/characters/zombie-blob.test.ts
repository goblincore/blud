// src/lab/sdf-zombie/characters/zombie-blob.test.ts
import { describe, it, expect } from 'vitest';
import src from './zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { packBody } from '../pack';
import { CLUSTER_ORDER, type LimbId, type Primitive } from '../types';
import { makeZombie } from '../body';

const fromBlob = () => buildBody(compileBlob(parseBlob(src)));
const fromTs = () => buildBody(makeZombie());

describe('zombie.blob is the zombie', () => {
  it('compiles with no validation errors', () => {
    expect(fromBlob().errors).toEqual([]);
  });

  it('produces the same primitive and cluster counts', () => {
    expect(fromBlob().prims).toHaveLength(fromTs().prims.length);
    expect(fromBlob().clusters.map(c => c.limb)).toEqual(fromTs().clusters.map(c => c.limb));
  });

  // dir is normalised at resolve time, so bone POSITIONS are the honest
  // comparison — not the raw dir arrays, which differ in magnitude by design.
  it('resolves every bone to the same head and tail within 0.1 mm', () => {
    const a = fromBlob().bones, b = fromTs().bones;
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [name, bone] of a) {
      const ref = b.get(name)!;
      bone.head.forEach((v, i) => expect(v, `${name} head[${i}]`).toBeCloseTo(ref.head[i]!, 4));
      bone.tail.forEach((v, i) => expect(v, `${name} tail[${i}]`).toBeCloseTo(ref.tail[i]!, 4));
    }
  });

  // Bone is authored only in the .blob (a `bones` block); the legacy TS body is
  // the reference for FLESH. Comparing bone prims would assert that the TS body
  // has content it was never meant to have.
  it('places every primitive at the same endpoints and radius', () => {
    const flesh = (b: { prims: Primitive[] }) => b.prims.filter(p => p.op !== 'bone');
    const a = flesh(fromBlob()), b = flesh(fromTs());
    a.forEach((p, i) => {
      expect(p.radius, `prim[${i}] ${p.limb} radius`).toBeCloseTo(b[i]!.radius, 6);
      expect(p.blendK, `prim[${i}] ${p.limb} blendK`).toBeCloseTo(b[i]!.blendK, 6);
      expect(p.limb, `prim[${i}] limb`).toBe(b[i]!.limb);
      p.a.forEach((v, j) => expect(v, `prim[${i}] ${p.limb} a[${j}]`).toBeCloseTo(b[i]!.a[j]!, 4));
      p.b.forEach((v, j) => expect(v, `prim[${i}] ${p.limb} b[${j}]`).toBeCloseTo(b[i]!.b[j]!, 4));
    });
  });
});

// Wound pass r2 task 10: the two places players actually shoot get AUTHORED
// bone — a cranium dome (a scaled face ellipsoid is not a cranium) and a
// ribcage plate (a scaled torso blob is not a ribcage). Authored lines win
// per bone, so these REPLACE the auto-derived twins on skull/spine.
describe('zombie.blob authors its shot-magnet bones', () => {
  const bones = () => fromBlob().bonePrims ?? [];
  const inCluster = (limb: LimbId) =>
    bones().filter(p => p.op === 'bone' && p.cluster === CLUSTER_ORDER.indexOf(limb));

  // Pins INTENT, not the exact numbers the shapes happened to have — those are
  // being tuned on screen. What must not regress is the STRUCTURE: the owner's
  // playtest read the first version as "a really small round ball, and there's
  // no jaw" and "a big white central pillar running through the torso", and
  // both complaints are about shape, which is what these assert.
  it('gives the skull a cranium AND a jaw, and the cranium fills the head', () => {
    const head = inCluster('head');
    expect(head.length, 'cranium + jaw').toBeGreaterThanOrEqual(2);
    // The face block's head ellipsoid has semi-axes ~(0.090, 0.137, 0.105).
    // A cranium much under this reads as a marble rattling inside the skull —
    // the exact playtest complaint. Half the head's width is the floor.
    const cranium = head.reduce((a, b) => (a.radius >= b.radius ? a : b));
    expect(cranium.radius, 'cranium is not a marble').toBeGreaterThan(0.075);
    // A jaw is a SECOND, smaller mass — not a bigger dome.
    const jaw = head.filter(p => p !== cranium).reduce((a, b) => (a.radius >= b.radius ? a : b));
    expect(jaw.radius).toBeLessThan(cranium.radius);
  });

  it('builds the ribcage out of ribs, not one wide plate', () => {
    const torso = inCluster('torso');
    // The plate this replaced was a single prim at scale.x 1.45. A ribcage is
    // MANY thin prims; if this ever collapses back to one fat one, the "white
    // central pillar" is back.
    expect(torso.length, 'ribs + sternum + spine rod').toBeGreaterThanOrEqual(6);
    // "Slab" means EFFECTIVE half-width, not radius: the plate this replaced
    // was r 0.052 at scale.x 1.45 = 0.0754 across. A chunky pelvis is fine; a
    // 75 mm-wide bar running the length of the chest is the pillar.
    const halfWidth = (p: Primitive) => p.radius * p.scale[0];
    expect(Math.max(...torso.map(halfWidth)), 'no prim is a slab').toBeLessThan(0.070);
    // Ribs come in mirrored pairs, so the torso bones are not all on the
    // midline — a symmetric spread in x is what makes it read as a cage.
    const xs = torso.map(p => (p.a[0] + p.b[0]) / 2);
    expect(Math.max(...xs), 'ribs reach right').toBeGreaterThan(0.03);
    expect(Math.min(...xs), 'ribs reach left').toBeLessThan(-0.03);
  });
});

// 2026-09-03 skeleton re-author: the owner's reference is a standard human
// torso skeleton. Pins the STRUCTURE the previous cage lacked — twelve pairs
// spanning the chest, as wide as the torso, closed at the flank into hoops,
// clavicles, and a pelvis whose wings flare wide — not the exact numbers,
// which scripts/zombie-skeleton-gen.ts owns.
describe('zombie.blob authors a full torso skeleton', () => {
  const torsoBones = () => fromBlob().bonePrims
    .filter(p => p.op === 'bone' && p.cluster === CLUSTER_ORDER.indexOf('torso'));
  const midY = (p: Primitive) => (p.a[1] + p.b[1]) / 2;
  const reachX = (p: Primitive) => Math.max(Math.abs(p.a[0]), Math.abs(p.b[0]));
  // A rib: a mirrored, bent torso bone in the chest band with its far end off
  // the midline. Sternum (x 0) and spine (x 0) are excluded by the reach test;
  // the clavicles by the collar band (above y 1.36 AND out to the shoulder).
  const isClavicle = (p: Primitive) => midY(p) > 1.36 && reachX(p) > 0.17;
  const ribs = () => torsoBones().filter(p => p.mirrored && p.bend !== undefined && midY(p) > 1.12 && reachX(p) > 0.03 && !isClavicle(p));

  it('has six rib pairs, each in two halves (24 rib prims)', () => {
    // Owner (2026-09-03, second look): twelve read as too many; six, thicker.
    expect(ribs().length).toBeGreaterThanOrEqual(24);
  });

  it('the cage spans the chest — at least 20 cm of spine, not 20 cm of stubs', () => {
    const ys = ribs().map(midY);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.20);
  });

  it('the cage is as wide as the torso — the flank reaches past x 0.15', () => {
    // Chest flesh half-width is ~0.19; the old cage stopped at ~0.06.
    expect(Math.max(...ribs().map(reachX))).toBeGreaterThan(0.15);
    expect(Math.min(...ribs().map(p => Math.min(p.a[0], p.b[0])))).toBeLessThan(-0.15);
  });

  it('ribs close into hoops — two halves meet at the flank', () => {
    // For every rib prim whose start is at the spine, some other rib prim
    // starts where this one ends (within 1 mm): that is the flank join.
    const rs = ribs();
    const backs = rs.filter(p => Math.abs(p.a[0]) < 0.03 && Math.abs(p.b[0]) > 0.05);
    expect(backs.length).toBeGreaterThanOrEqual(12);
    for (const b of backs) {
      const joined = rs.some(q => q !== b && Math.hypot(q.a[0] - b.b[0], q.a[1] - b.b[1], q.a[2] - b.b[2]) < 1e-3);
      const floating = midY(b) < 1.17; // ribs 11-12 have no front half
      expect(joined || floating, `rib half ending at ${b.b.map(v => v.toFixed(3))} has no front half`).toBe(true);
    }
  });

  it('has clavicles reaching the shoulder', () => {
    // A torso bone in the collar band whose far end is near the shoulder joint (0.2, 1.398).
    const collar = torsoBones().filter(isClavicle);
    expect(collar.length).toBeGreaterThanOrEqual(2);
  });

  it('has a pelvis with wide iliac wings and a closed ring below, as a solid mass', () => {
    const pelvis = torsoBones().filter(p => midY(p) < 1.12 && reachX(p) > 0.02);
    expect(pelvis.length).toBeGreaterThanOrEqual(10);
    // "A big solid mass, not doodly lines" (owner): the blades are fat.
    expect(Math.max(...pelvis.map(p => p.radius))).toBeGreaterThanOrEqual(0.028);
    // The crest flares out past x 0.12 (the old blades stopped at ~0.09).
    expect(Math.max(...pelvis.map(reachX))).toBeGreaterThan(0.12);
    // Something reaches down to the sit bones / symphysis, below y 0.94.
    expect(Math.min(...pelvis.map(p => Math.min(p.a[1], p.b[1])))).toBeLessThan(0.94);
  });

  it('stays under the shader ceiling with room: flesh + bone <= 120 of 128', () => {
    const b = fromBlob();
    expect(b.prims.length + b.bonePrims.length).toBeLessThanOrEqual(120);
  });
});

describe('zombie.blob authors a gut coil (organs r3)', () => {
  const organs = () => fromBlob().bonePrims.filter(p => p.op === 'organ');

  it('has organ prims, in the torso cluster', () => {
    expect(organs().length).toBeGreaterThanOrEqual(6);
    for (const o of organs()) {
      expect(o.cluster).toBe(CLUSTER_ORDER.indexOf('torso'));
    }
  });

  it('they are TUBES that LOOP — bent, not a straight stack', () => {
    // The whole read is round tubes in visible loops. A stack of straight
    // bars is the failure mode the ribcage already went through.
    const bent = organs().filter(o => o.bend !== undefined);
    expect(bent.length).toBeGreaterThanOrEqual(3);
  });

  it('sits low — a chest shot must still open onto ribs', () => {
    const ys = organs().map(o => (o.a[1] + o.b[1]) / 2);
    const ribs = fromBlob().bonePrims
      .filter(p => p.op === 'bone' && p.cluster === CLUSTER_ORDER.indexOf('torso'))
      .map(p => (p.a[1] + p.b[1]) / 2);
    expect(Math.max(...ys)).toBeLessThan(Math.max(...ribs));
  });

  it('compiles with no validation errors — organs are contained like bone', () => {
    expect(fromBlob().errors).toEqual([]);
  });
});
