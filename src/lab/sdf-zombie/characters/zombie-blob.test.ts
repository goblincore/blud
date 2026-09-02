// src/lab/sdf-zombie/characters/zombie-blob.test.ts
import { describe, it, expect } from 'vitest';
import src from './zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { packBody } from '../pack';
import { CLUSTER_ORDER, type Primitive } from '../types';
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
  const inCluster = (limb: string) =>
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
