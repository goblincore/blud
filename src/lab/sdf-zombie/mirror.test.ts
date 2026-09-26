// src/lab/sdf-zombie/mirror.test.ts
import { describe, it, expect } from 'vitest';
import { expandMirror } from './mirror';
import type { BodyDef, Vec3 } from './types';

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

  /**
   * A MIRRORED SOURCE LINE IS ONE AUTHORED NUMBER APPLIED THROUGH A REFLECTION,
   * and a consumer that cannot see that will mis-apply anything x-signed. The
   * flag is set here, at the only place that knows, rather than inferred later
   * from two placed prims sharing a `src` — a TS-authored body has no `src` at
   * all, and a pair whose second copy is unmeasurable arrives downstream alone.
   */
  it('marks both copies of a mirrored prim as mirrored, and an unmirrored one not', () => {
    expect(out.prims.find(p => p.bone === 'thigh.l')!.mirrored).toBe(true);
    expect(out.prims.find(p => p.bone === 'thigh.r')!.mirrored).toBe(true);
    expect(out.prims.find(p => p.bone === 'pelvis')!.mirrored).toBeUndefined();
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

  it('MARKS BOTH COPIES AS MIRRORED — a downstream fit must be able to tell', () => {
    const out = expandMirror({
      ...skullOnly,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', offset: [0.04, 0.01, -0.05], mirrorOffset: true,
      }],
    });
    expect(out.prims.every(p => p.mirrored === true)).toBe(true);
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

describe('mirror reflects a prim\'s own x components onto the .r bone', () => {
  // A mirrored bone sits at -side, so a prim authored OUTWARD of its .l bone
  // has to be authored outward of its .r bone too. Without the flip the
  // mouse's SDF shoes — offset +0.045 from each foot bone — put the right
  // shoe at x ~0, and a finger fan authored as tipped bars pointed the right
  // index finger inward across the chest.
  it('negates offset, tip and bend x for the .r copy and leaves .l as authored', () => {
    const def = {
      name: 't', root: [0, 0, 0] as Vec3,
      bones: [
        { name: 'pelvis', parent: null, dir: [0, 1, 0] as Vec3, len: 0.1 },
        { name: 'foot', parent: 'pelvis', dir: [0, 0, 1] as Vec3, len: 0.1, side: 0.05, mirror: true },
      ],
      prims: [{
        bone: 'foot', at: 0, radius: 0.05, scale: [1, 1, 1] as Vec3, blendK: 0.01,
        limb: 'leg' as const, mirror: true,
        offset: [0.04, -0.08, 0.02] as Vec3, tip: [0.03, 0, 0.1] as Vec3, bend: [0.01, 0, 0.02] as Vec3,
      }],
    };
    const out = expandMirror(def as never);
    const l = out.prims.find(p => p.bone === 'foot.l')!, r = out.prims.find(p => p.bone === 'foot.r')!;
    expect(l.offset).toEqual([0.04, -0.08, 0.02]);
    expect(l.tip).toEqual([0.03, 0, 0.1]);
    expect(l.bend).toEqual([0.01, 0, 0.02]);
    expect(r.offset).toEqual([-0.04, -0.08, 0.02]);
    expect(r.tip).toEqual([-0.03, 0, 0.1]);
    expect(r.bend).toEqual([-0.01, 0, 0.02]);
  });
});

describe('single-sided prims (side=l|r)', () => {
  // The minotaur's machined right leg is why this exists: every limb prim
  // before `side=` was forced bilateral, so a one-sided prosthetic could not
  // be authored at all.
  const sided: BodyDef = {
    name: 'sided',
    root: [0, 1, 0],
    bones: [
      { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.2 },
      { name: 'thigh', parent: 'pelvis', dir: [0, -1, 0], length: 0.4, side: 0.09, mirror: true },
    ],
    prims: [
      { bone: 'thigh', at: 0.1, capTo: 0.9, radius: 0.09, scale: [1, 1, 1], blendK: 0.06, limb: 'leg', mirror: true },
      { bone: 'thigh', at: 0.3, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'leg', side: 'r' },
    ],
  };
  const out = expandMirror(sided);

  it('expands to ONE prim on the named side — concrete bone, concrete limb, not marked mirrored', () => {
    const copies = out.prims.filter(p => p.at === 0.3);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.bone).toBe('thigh.r');
    expect(copies[0]!.limb).toBe('legR');
    expect(copies[0]!.mirrored).toBeUndefined();
  });

  it('leaves the bilateral prims around it expanding as before', () => {
    expect(out.prims.filter(p => p.at === 0.1)).toHaveLength(2);
  });

  it('rejects side= together with mirror (TS-authored prims bypass the parser check)', () => {
    expect(() => expandMirror({
      ...sided,
      prims: [{ bone: 'thigh', at: 0.3, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'leg', mirror: true, side: 'r' }],
    })).toThrow(/already decide sides/);
  });

  it('rejects side= on a bone that is not mirrored', () => {
    expect(() => expandMirror({
      ...sided,
      prims: [{ bone: 'pelvis', at: 0.3, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'leg', side: 'l' }],
    })).toThrow(/not a mirrored bone/);
  });
});

// `lenR=` (bride, 2026-09-24): an ASYMMETRIC mirrored bone. The bride's sword
// forearm is longer than her off forearm, but a mirror block gives both sides
// one length, and a bone outside it cannot parent to `upperarm.l` (that name
// only exists after this expansion) nor carry arm prims (arm limbs need a
// side). So the right copy takes its own length and nothing else changes.
describe('expandMirror — lengthR', () => {
  const asym: BodyDef = {
    ...def,
    bones: [
      def.bones[0]!,
      { name: 'thigh', parent: 'pelvis', dir: [0, -1, 0], length: 0.4, lengthR: 0.46, side: 0.09, mirror: true },
    ],
  };
  const out = expandMirror(asym);

  it('gives the .r copy lengthR and the .l copy length', () => {
    expect(out.bones.find(b => b.name === 'thigh.l')!.length).toBe(0.4);
    expect(out.bones.find(b => b.name === 'thigh.r')!.length).toBe(0.46);
  });

  it('leaves no lengthR on the expanded copies', () => {
    for (const b of out.bones) expect(b.lengthR).toBeUndefined();
  });

  it('is a no-op when absent', () => {
    const plain = expandMirror(def);
    expect(plain.bones.find(b => b.name === 'thigh.r')!.length).toBe(0.4);
  });
});
