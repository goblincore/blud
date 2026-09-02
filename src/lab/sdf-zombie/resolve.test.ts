// src/lab/sdf-zombie/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBones, placePrims } from './resolve';
import type { BoneDef } from './types';
import type { ExpandedPrim } from './mirror';

const bones: BoneDef[] = [
  { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.3 },
  { name: 'spine', parent: 'pelvis', dir: [0, 1, 0], length: 0.4 },
  { name: 'thigh.l', parent: 'pelvis', dir: [0, -1, 0], length: 0.4, side: 0.1 },
];

describe('resolveBones', () => {
  const out = resolveBones(bones, [0, 1, 0]);

  it('places the root at the given world position', () => {
    expect(out.get('pelvis')!.head).toEqual([0, 1, 0]);
    expect(out.get('pelvis')!.tail).toEqual([0, 1.3, 0]);
  });

  it('places a child at its parent tail, offset laterally by side', () => {
    expect(out.get('spine')!.head).toEqual([0, 1.3, 0]);
    // Float note: 1.3 + 0.4 is 1.7000000000000002 in IEEE-754, not the literal 1.7.
    const spineTail = out.get('spine')!.tail;
    expect(spineTail[0]).toBeCloseTo(0, 10);
    expect(spineTail[1]).toBeCloseTo(1.7, 10);
    expect(spineTail[2]).toBeCloseTo(0, 10);
    expect(out.get('thigh.l')!.head).toEqual([0.1, 1.3, 0]);
    expect(out.get('thigh.l')!.tail).toEqual([0.1, 0.9, 0]);
  });

  it('throws on an unknown parent', () => {
    expect(() => resolveBones([{ name: 'x', parent: 'nope', dir: [0, 1, 0], length: 1 }], [0, 0, 0]))
      .toThrow(/nope/);
  });

  it('throws on a cycle rather than looping forever', () => {
    const cyclic: BoneDef[] = [
      { name: 'a', parent: 'b', dir: [0, 1, 0], length: 1 },
      { name: 'b', parent: 'a', dir: [0, 1, 0], length: 1 },
    ];
    expect(() => resolveBones(cyclic, [0, 0, 0])).toThrow(/cycle|unresolved/i);
  });
});

describe('placePrims', () => {
  const resolved = resolveBones(bones, [0, 1, 0]);

  it('places a sphere prim at the normalised position along its bone', () => {
    const prims: ExpandedPrim[] = [
      { bone: 'pelvis', at: 0.5, radius: 0.2, scale: [1, 1, 1], blendK: 0.05, limb: 'torso' },
    ];
    const p = placePrims(prims, resolved)[0]!;
    expect(p.a).toEqual([0, 1.15, 0]);
    expect(p.b).toEqual([0, 1.15, 0]); // sphere: a === b
  });

  it('spans a capsule prim between at and capTo on the same bone', () => {
    const prims: ExpandedPrim[] = [
      { bone: 'thigh.l', at: 0.0, capTo: 1.0, radius: 0.09, scale: [1, 1, 1], blendK: 0.05, limb: 'legL' },
    ];
    const p = placePrims(prims, resolved)[0]!;
    expect(p.a).toEqual([0.1, 1.3, 0]);
    expect(p.b).toEqual([0.1, 0.9, 0]);
  });

  it('throws when a prim names a bone that does not exist', () => {
    const prims: ExpandedPrim[] = [
      { bone: 'ghost', at: 0.5, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'torso' },
    ];
    expect(() => placePrims(prims, resolved)).toThrow(/ghost/);
  });
});

describe('placePrims with offset and op', () => {
  const skull = new Map([['skull', { head: [0, 1, 0] as const, tail: [0, 1.2, 0] as const }]]);

  it('displaces both endpoints by the offset', () => {
    const [p] = placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
      limb: 'head', offset: [0.05, 0, -0.02],
    }] as ExpandedPrim[], skull as never);
    expect(p!.a).toEqual([0.05, 1.1, -0.02]);
    expect(p!.b).toEqual([0.05, 1.1, -0.02]);
  });

  it('carries the mirrored flag onto the placed primitive', () => {
    const mk = (mirrored?: true) => placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
      limb: 'head', ...(mirrored ? { mirrored } : {}),
    }] as ExpandedPrim[], skull as never)[0]!;
    expect(mk(true).mirrored).toBe(true);
    expect(mk().mirrored).toBeUndefined();
  });

  it('carries box through onto the placed primitive', () => {
    const mk = (box?: { round: number }) => placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
      limb: 'head', ...(box ? { box } : {}),
    }] as ExpandedPrim[], skull as never)[0]!;
    expect(mk({ round: 0.3 }).box).toEqual({ round: 0.3 });
    expect(mk().box).toBeUndefined();
  });

  it('defaults op to add and passes sub through', () => {
    const mk = (op?: 'add' | 'sub') => placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
      limb: 'head', ...(op ? { op } : {}),
    }] as ExpandedPrim[], skull as never)[0]!;
    expect(mk().op).toBe('add');
    expect(mk('sub').op).toBe('sub');
  });
});
