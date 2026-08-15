// src/lab/sdf-zombie/mirror.test.ts
import { describe, it, expect } from 'vitest';
import { expandMirror } from './mirror';
import type { BodyDef } from './types';

const def: BodyDef = {
  name: 'test',
  root: [0, 1, 0],
  bones: [
    { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.2 },
    { name: 'thigh', parent: 'pelvis', dir: [0, -1, 0], length: 0.4, side: 0.09, mirror: true },
  ],
  prims: [
    { bone: 'pelvis', at: 0.5, radius: 0.18, scale: [1, 1, 0.8], blendK: 0.08, limb: 'torso' },
    { bone: 'thigh', at: 0.1, capTo: 0.9, radius: 0.09, scale: [1, 1, 1], blendK: 0.06, limb: 'leg', mirror: true },
  ],
};

describe('expandMirror', () => {
  const out = expandMirror(def);

  it('leaves unmirrored bones and prims untouched', () => {
    expect(out.bones.filter(b => b.name === 'pelvis')).toHaveLength(1);
    expect(out.prims.filter(p => p.bone === 'pelvis')).toHaveLength(1);
  });

  it('splits a mirrored bone into .l and .r with negated side offset', () => {
    const l = out.bones.find(b => b.name === 'thigh.l');
    const r = out.bones.find(b => b.name === 'thigh.r');
    expect(l).toBeDefined();
    expect(r).toBeDefined();
    expect(l!.side).toBe(0.09);
    expect(r!.side).toBe(-0.09);
    expect(out.bones.find(b => b.name === 'thigh')).toBeUndefined();
  });

  it('splits a mirrored prim, retargets its bone, and resolves limb to L/R', () => {
    const l = out.prims.find(p => p.bone === 'thigh.l');
    const r = out.prims.find(p => p.bone === 'thigh.r');
    expect(l!.limb).toBe('legL');
    expect(r!.limb).toBe('legR');
    expect(l!.radius).toBe(0.09);
    expect(r!.capTo).toBe(0.9);
  });

  it('resolves an unmirrored limb base directly', () => {
    expect(out.prims.find(p => p.bone === 'pelvis')!.limb).toBe('torso');
  });

  it('retargets a mirrored bone to the matching side of its mirrored parent', () => {
    const nested: BodyDef = {
      name: 'nested',
      root: [0, 1, 0],
      bones: [
        { name: 'thigh', parent: null, dir: [0, -1, 0], length: 0.4, side: 0.09, mirror: true },
        { name: 'shin', parent: 'thigh', dir: [0, -1, 0], length: 0.4, mirror: true },
      ],
      prims: [],
    };
    const nestedOut = expandMirror(nested);
    expect(nestedOut.bones.find(b => b.name === 'shin.l')!.parent).toBe('thigh.l');
    expect(nestedOut.bones.find(b => b.name === 'shin.r')!.parent).toBe('thigh.r');
  });

  it('throws when a non-mirrored bone hangs off a mirrored parent', () => {
    // There is no correct side for it — silently picking one would render the
    // part off-centre with no error, which is exactly what must not happen.
    const bad: BodyDef = {
      name: 'tailed',
      root: [0, 1, 0],
      bones: [
        { name: 'hip', parent: null, dir: [0, 1, 0], length: 0.2, side: 0.09, mirror: true },
        { name: 'tail', parent: 'hip', dir: [0, 0, -1], length: 0.3 },
      ],
      prims: [],
    };
    expect(() => expandMirror(bad)).toThrow(
      /bone "tail" has mirrored parent "hip" but is not itself mirrored/,
    );
  });

  it('throws when a mirrored prim names a bone that is not mirrored', () => {
    const bad: BodyDef = {
      ...def,
      prims: [{ bone: 'pelvis', at: 0.5, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'arm', mirror: true }],
    };
    expect(() => expandMirror(bad)).toThrow(/pelvis/);
  });
});

describe('mirrorOffset', () => {
  const skullOnly: Omit<BodyDef, 'prims'> = {
    name: 'test',
    root: [0, 1, 0],
    bones: [{ name: 'skull', parent: null, dir: [0, 1, 0], length: 0.2 }],
  };

  it('emits a +x and a -x copy on a bone that was never mirrored', () => {
    const out = expandMirror({
      ...skullOnly,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', offset: [0.04, 0.01, -0.05], mirrorOffset: true,
      }],
    });
    expect(out.prims).toHaveLength(2);
    expect(out.prims[0]!.offset).toEqual([0.04, 0.01, -0.05]);
    expect(out.prims[1]!.offset).toEqual([-0.04, 0.01, -0.05]);
    // Both stay in the head cluster — the fold order must not gain a cluster.
    expect(out.prims.every(p => p.limb === 'head')).toBe(true);
  });

  it('carries op through expansion', () => {
    const out = expandMirror({
      ...skullOnly,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', op: 'sub', offset: [0.04, 0, 0], mirrorOffset: true,
      }],
    });
    expect(out.prims.every(p => p.op === 'sub')).toBe(true);
  });

  it('rejects a prim that asks for both mirror modes', () => {
    expect(() => expandMirror({
      ...skullOnly,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', mirror: true, mirrorOffset: true,
      }],
    })).toThrow(/both mirror and mirrorOffset/);
  });
});
