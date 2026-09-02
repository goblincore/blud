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

  it('carries an authored cranium dome in the head cluster', () => {
    const dome = bones().find(p => p.op === 'bone' && p.cluster === CLUSTER_ORDER.indexOf('head'));
    expect(dome, 'no head-cluster bone prim').toBeDefined();
    expect(dome!.radius).toBe(0.072);
    expect(dome!.scale).toEqual([0.88, 0.95, 0.86]);
  });

  it('carries an authored ribcage plate in the torso cluster', () => {
    const plate = bones().find(p => p.op === 'bone' && p.cluster === CLUSTER_ORDER.indexOf('torso'));
    expect(plate, 'no torso-cluster bone prim').toBeDefined();
    expect(plate!.radius).toBe(0.052);
    expect(plate!.scale).toEqual([1.45, 1, 0.55]);
    // A PLATE spans the chest — endpoints distinct, unlike a scaled torso blob.
    expect(plate!.a).not.toEqual(plate!.b);
  });

  // Wound pass r2 task 11: the shader's nearWound gate is only SOUND because
  // min(flesh, bone) === flesh wherever flesh is intact — a FIELD claim, so
  // it is tested on the field's input, not on pixels (two captures of the
  // same build differ by 52-82k px on this harness — there is no pixel floor
  // here to stand on). sdBody, the CPU mirror, already excludes bone by
  // design, so the comparable object is the PACKED DATA the march actually
  // reads: derivation must never perturb the flesh rows — neither their
  // values nor their count. Authored bones ride in BOTH arms of this test
  // (they are part of the model, like flesh), so what this isolates is the
  // derived set.
  it('an undamaged body folds bit-identically with and without bone', () => {
    const withBone = packBody(buildBody(compileBlob(parseBlob(src))));
    const noBone = packBody(buildBody({ ...compileBlob(parseBlob(src)), boneRatio: 0 }));
    // The flesh row COUNT may not move either: bones packed among the flesh
    // rows would enter the shader's additive fold (rows [0, counts.x)) and
    // lump every bone into the skin at full strength.
    expect(withBone.primCount).toBe(noBone.primCount);
    const n = noBone.primCount * 4;
    expect(Array.from(withBone.primA.slice(0, n))).toEqual(Array.from(noBone.primA.slice(0, n)));
    expect(Array.from(withBone.primScale.slice(0, n))).toEqual(Array.from(noBone.primScale.slice(0, n)));
    // ratio 0 kills only the DERIVED set — the authored bones (cranium,
    // ribcage) are present in both arms, so the comparison above is not
    // vacuously passing on two boneless bodies.
    expect(noBone.boneCount).toBeGreaterThan(0);
    expect(withBone.boneCount).toBeGreaterThan(noBone.boneCount);
  });
});
