// src/lab/sdf-zombie/body-scale.test.ts
import { describe, it, expect } from 'vitest';
import { scaleBodyDef } from './body-scale';
import type { BodyDef, PrimDef } from './types';

// EVERY PrimDef key populated: `Required<PrimDef>` makes this fail to compile when a field is added to PrimDef, which is the
// prompt to decide (in body-scale.ts) whether the new field is a length.
const FULL_PRIM: Required<PrimDef> = {
  bone: 'spine', src: 7, at: 0.5, capTo: 0.9, radius: 0.10, radiusB: 0.05, scale: [1, 2, 3], blendK: 0.02,
  blendProfile: 'chamfer', bend: [0.01, 0.02, 0.03], limb: 'torso', mirror: true, side: 'l', op: 'add',
  grooveDepth: 0.004, grooveWidth: 0.005, offset: [0.1, 0.2, 0.3], tip: [0.4, 0.5, 0.6], mirrorOffset: true,
  color: [0.1, 0.2, 0.3], gloss: 0.5, metal: true, glow: 0.3, core: true, rigid: true, when: 'dead',
  shell: { thickness: 0.002, clipNormal: [0, 1, 0], clipOffset: 0.03, rim: 0.004, warpAmp: 0.01, warpFreq: [20, 0, 40] },
  box: { round: 0.25 }, strand: { count: 5, wave: 0.2, cycles: 2, fat: 0.5 },
};

const DEF: BodyDef = {
  name: 'test', root: [0, 0.6, 0],
  bones: [
    { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.1 },
    { name: 'clavicle', parent: 'pelvis', dir: [1, 0, 0], length: 0.04, lengthR: 0.05, side: 0.036, mirror: true },
  ],
  prims: [FULL_PRIM],
  bonePrims: [{ ...FULL_PRIM, op: 'bone' }],
  boneRatio: 0.38,
};

const K = 2;

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

describe('scaleBodyDef', () => {
  it('is the identity at k = 1 (the same object, so nothing else pays for it)', () => {
    expect(scaleBodyDef(DEF, 1)).toBe(DEF);
  });

  it('rejects a scale that is not a positive finite number', () => {
    for (const k of [0, -1, NaN, Infinity]) expect(() => scaleBodyDef(DEF, k)).toThrow(/positive/);
  });

  it('does not mutate its input', () => {
    const frozen = deepFreeze(structuredClone(DEF));
    const before = JSON.stringify(frozen);
    expect(() => scaleBodyDef(frozen, K)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('scales the root and the bone lengths, lengthR and side; leaves directions, names and flags', () => {
    const out = scaleBodyDef(DEF, K);
    expect(out.root).toEqual([0, 1.2, 0]);
    expect(out.bones[0]).toEqual({ name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.2 });
    expect(out.bones[1]).toEqual({ name: 'clavicle', parent: 'pelvis', dir: [1, 0, 0], length: 0.08, lengthR: 0.1, side: 0.072, mirror: true });
    expect(out.boneRatio).toBe(0.38);
  });

  it('scales every length on a prim, in body prims and in bone prims alike', () => {
    const out = scaleBodyDef(DEF, K);
    for (const p of [out.prims[0]!, out.bonePrims![0]!]) {
      expect(p.radius).toBeCloseTo(0.2, 12);
      expect(p.radiusB).toBeCloseTo(0.1, 12);
      expect(p.blendK).toBeCloseTo(0.04, 12);
      expect(p.grooveDepth).toBeCloseTo(0.008, 12);
      expect(p.grooveWidth).toBeCloseTo(0.01, 12);
      expect(p.offset).toEqual([0.2, 0.4, 0.6]);
      expect(p.tip).toEqual([0.8, 1.0, 1.2]);
      expect(p.bend).toEqual([0.02, 0.04, 0.06]);
    }
  });

  it('scales the shell lengths and DIVIDES its wrinkle frequency (radians per metre)', () => {
    const s = scaleBodyDef(DEF, K).prims[0]!.shell!;
    expect(s.thickness).toBeCloseTo(0.004, 12);
    expect(s.clipOffset).toBeCloseTo(0.06, 12);
    expect(s.rim).toBeCloseTo(0.008, 12);
    expect(s.warpAmp).toBeCloseTo(0.02, 12);
    expect(s.warpFreq).toEqual([10, 0, 20]);
    expect(s.clipNormal).toEqual([0, 1, 0]);
  });

  it('leaves every fraction, ratio, direction, colour and flag alone', () => {
    const p = scaleBodyDef(DEF, K).prims[0]!;
    expect(p.at).toBe(0.5);
    expect(p.capTo).toBe(0.9);
    expect(p.scale).toEqual([1, 2, 3]);
    expect(p.box).toEqual({ round: 0.25 });
    expect(p.strand).toEqual({ count: 5, wave: 0.2, cycles: 2, fat: 0.5 });
    expect(p.color).toEqual([0.1, 0.2, 0.3]);
    expect(p.bone).toBe('spine');
    expect(p.side).toBe('l');
    expect(p.limb).toBe('torso');
    expect(p.when).toBe('dead');
  });

  it('keeps an absent optional field absent (no NaN, no undefined key)', () => {
    const bare: BodyDef = { name: 'b', root: [0, 1, 0], bones: [], prims: [{ bone: 'x', at: 0, radius: 0.1, scale: [1, 1, 1], blendK: 0.01, limb: 'torso' }] };
    const p = scaleBodyDef(bare, K).prims[0]!;
    expect(Object.keys(p).sort()).toEqual(['at', 'blendK', 'bone', 'limb', 'radius', 'scale']);
    expect(p.radius).toBeCloseTo(0.2, 12);
  });

  it('scales EXACTLY the length fields: the whole scaled prim and shell equal the expected ones', () => {
    const expectedShell = { thickness: 0.004, clipNormal: [0, 1, 0], clipOffset: 0.06, rim: 0.008, warpAmp: 0.02, warpFreq: [10, 0, 20] };
    const expected = {
      ...FULL_PRIM,
      radius: 0.2, radiusB: 0.1, blendK: 0.04, bend: [0.02, 0.04, 0.06], grooveDepth: 0.008, grooveWidth: 0.01,
      offset: [0.2, 0.4, 0.6], tip: [0.8, 1.0, 1.2], shell: expectedShell,
    };
    const out = scaleBodyDef(DEF, K);
    expect(out.prims[0]).toEqual(expected);
    expect(out.bonePrims![0]).toEqual({ ...expected, op: 'bone' });
    expect(out.prims[0]!.shell).toEqual(expectedShell);
  });

  it('scales the shell in bonePrims as well as prims', () => {
    const s = scaleBodyDef(DEF, K).bonePrims![0]!.shell!;
    expect(s.thickness).toBeCloseTo(0.004, 12);
    expect(s.clipOffset).toBeCloseTo(0.06, 12);
    expect(s.warpFreq).toEqual([10, 0, 20]);
  });

  it('leaves bonePrims absent when the input has none', () => {
    const { bonePrims: _omit, ...noBones } = DEF;
    const out = scaleBodyDef(noBones, K);
    expect('bonePrims' in out).toBe(false);
    expect(out.prims[0]!.radius).toBeCloseTo(0.2, 12);
  });

  it('throws on a field that has no unit (a new PrimDef key that bypassed the type guard)', () => {
    const rogue = { ...FULL_PRIM, mystery: 3 } as unknown as PrimDef;
    expect(() => scaleBodyDef({ ...DEF, prims: [rogue] }, K)).toThrow(/no unit for field "mystery"/);
  });
});
