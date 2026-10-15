// src/lab/sdf-zombie/morph.test.ts
import { describe, it, expect } from 'vitest';
import { parseMorph, mirrorMorph, morphOf, morphShape, type PrimMorph } from './morph';
import type { Vec3 } from './types';

describe('parseMorph', () => {
  it('reads a move, a tip, a bend, a radius factor and a scale factor', () => {
    expect(parseMorph('smile:(0.006,0.004,0)')).toEqual({ channel: 'smile', move: [0.006, 0.004, 0] });
    expect(parseMorph('smile:*1.2')).toEqual({ channel: 'smile', radius: 1.2 });
    expect(parseMorph('gape:*(1.15,1,0.9)')).toEqual({ channel: 'gape', scale: [1.15, 1, 0.9] });
    expect(parseMorph('smile:(-0.006,0.003,0)tip(0.012,0,0)bend(0,-0.008,0)*1.1')).toEqual({
      channel: 'smile', move: [-0.006, 0.003, 0], tip: [0.012, 0, 0], bend: [0, -0.008, 0], radius: 1.1,
    });
  });

  it('takes the terms in any order', () => {
    expect(parseMorph('browDown:*0.9bend(0,0.001,0)(0,-0.002,0)')).toEqual({
      channel: 'browDown', radius: 0.9, bend: [0, 0.001, 0], move: [0, -0.002, 0],
    });
  });

  it('rejects an unknown channel, naming the legal set', () => {
    expect(() => parseMorph('grin:(0,0,0)')).toThrow(/unknown morph channel "grin".*gape.*smile.*browDown.*lipCurl.*lid/);
  });

  it('rejects malformed values', () => {
    expect(() => parseMorph('smile')).toThrow(/channel:terms/);
    expect(() => parseMorph('smile:')).toThrow(/at least one/);
    expect(() => parseMorph('smile:(0,0)')).toThrow(/three numbers/);
    expect(() => parseMorph('smile:(0,a,0)')).toThrow(/three numbers/);
    expect(() => parseMorph('smile:*0')).toThrow(/above zero/);
    expect(() => parseMorph('smile:*(1,0,1)')).toThrow(/above zero/);
    expect(() => parseMorph('smile:(0,0,0)(0,0,0)')).toThrow(/twice/);
    expect(() => parseMorph('smile:*1.1*1.2')).toThrow(/twice/);
    expect(() => parseMorph('smile:wobble(0,0,0)')).toThrow(/cannot read/);
  });
});

describe('mirrorMorph', () => {
  it('reflects the move, tip and bend in x and leaves the factors', () => {
    const m: PrimMorph = { channel: 'smile', move: [0.006, 0.004, 0.001], tip: [0.01, 0, 0], bend: [0.002, -0.008, 0], radius: 1.2, scale: [1.1, 1, 1] };
    expect(mirrorMorph(m)).toEqual({ channel: 'smile', move: [-0.006, 0.004, 0.001], tip: [-0.01, 0, 0], bend: [-0.002, -0.008, 0], radius: 1.2, scale: [1.1, 1, 1] });
    expect(mirrorMorph({ channel: 'gape', radius: 0.8 })).toEqual({ channel: 'gape', radius: 0.8 });
  });
});

describe('morphOf', () => {
  const smile: PrimMorph = { channel: 'smile', move: [0.01, 0.002, 0], tip: [0.004, 0, 0], bend: [0, -0.006, 0], radius: 1.5, scale: [1.2, 1, 0.5] };

  it('is null with no morphs, no weights, a weight of 0 or a non-finite weight: nothing moves', () => {
    expect(morphOf(undefined, { smile: 1 })).toBeNull();
    expect(morphOf([smile], undefined)).toBeNull();
    expect(morphOf([smile], {})).toBeNull();
    expect(morphOf([smile], { smile: 0, gape: 1 })).toBeNull();
    expect(morphOf([smile], { smile: Number.NaN })).toBeNull();
  });

  it('scales every term linearly by the weight', () => {
    const r = morphOf([smile], { smile: 0.5 })!;
    expect(r.da).toEqual([0.005, 0.001, 0]);
    r.db.forEach((v, k) => expect(v).toBeCloseTo([0.007, 0.001, 0][k]!, 12));
    expect(r.bend).toEqual([0, -0.003, 0]);
    expect(r.radius).toBeCloseTo(1.25, 12);
    expect(r.scale[0]).toBeCloseTo(1.1, 12);
    expect(r.scale[1]).toBe(1);
    expect(r.scale[2]).toBeCloseTo(0.75, 12);
  });

  it('a negative weight runs it backwards, and the factors floor at zero', () => {
    const r = morphOf([smile], { smile: -1 })!;
    expect(r.da[0]).toBeCloseTo(-0.01, 12);
    expect(r.da[1]).toBeCloseTo(-0.002, 12);
    expect(r.radius).toBeCloseTo(0.5, 12);
    expect(morphOf([{ channel: 'smile', radius: 3 }], { smile: -1 })!.radius).toBe(0);
  });

  it('adds the offsets and multiplies the factors of several channels', () => {
    const r = morphOf([
      { channel: 'smile', move: [0.01, 0, 0], radius: 2 },
      { channel: 'gape', move: [0, -0.01, 0], tip: [0, 0, 0.002], radius: 1.5 },
    ], { smile: 1, gape: 1 })!;
    expect(r.da).toEqual([0.01, -0.01, 0]);
    expect(r.db).toEqual([0.01, -0.01, 0.002]);
    expect(r.radius).toBeCloseTo(3, 12);
    expect(r.bend).toBeNull();
  });
});

describe('morphShape', () => {
  const prim = { radius: 0.01, radiusB: 0.004, scale: [1.33, 0.56, 1.25] as const, bend: [0, 0, 0.024] as const };

  it('scales the radii and the axes and adds to the bend', () => {
    const r = morphOf([{ channel: 'smile', radius: 1.2, scale: [1.1, 1, 1], bend: [0, -0.008, 0] }], { smile: 1 })!;
    const s = morphShape(prim, r);
    expect(s.radius).toBeCloseTo(0.012, 12);
    expect(s.radiusB).toBeCloseTo(0.0048, 12);
    expect(s.scale[0]).toBeCloseTo(1.463, 12);
    expect(s.scale[1]).toBe(0.56);
    expect(s.bend).toEqual([0, -0.008, 0.024]);
  });

  it('gives an unbent prim the bend outright, and an untapered prim no radiusB', () => {
    const r = morphOf([{ channel: 'smile', bend: [0, -0.004, 0] }], { smile: 0.5 })!;
    const unbent: { radius: number; radiusB?: number; scale: Vec3; bend?: Vec3 } = { radius: 0.01, scale: [1, 1, 1] };
    const s = morphShape(unbent, r);
    expect(s.bend).toEqual([0, -0.002, 0]);
    expect('radiusB' in s).toBe(false);
  });

  it('leaves the bend alone when no morph bends', () => {
    const r = morphOf([{ channel: 'smile', radius: 2 }], { smile: 1 })!;
    expect(morphShape(prim, r).bend).toBe(prim.bend);
    expect('bend' in morphShape({ radius: 0.01, scale: [1, 1, 1] }, r)).toBe(false);
  });
});
