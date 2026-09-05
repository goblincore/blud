// src/lab/sdf-zombie/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveBones, placePrims } from './resolve';
import type { BoneDef } from './types';
import type { ExpandedPrim } from './mirror';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import { sdBody, type Body } from './validate';
import type { Vec3 } from './types';

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

describe('groove channel geometry survives placement', () => {
  // THE BUG THIS PINS. `placePrims` builds its output as an explicit object
  // literal, and it copied `op` while dropping `grooveDepth`/`grooveWidth`.
  // A groove then reached both fields as `op: 'groove'` with no channel, and
  // `sdGroove(d, sd, 0, 0)` computes `inBand = 0 - |b|` — never positive — so
  // it returns the field UNTOUCHED. Every authored groove in every character
  // was a silent no-op, in the CPU field and, through pack.ts reading the
  // same two fields, in the shader.
  //
  // It survived because `sdGroove` itself is well tested and the only test
  // that ever named these fields hand-built a `Primitive` (taper.test.ts),
  // skipping placement entirely. So this test asserts the SEAM, not the
  // operator: a groove authored in `.blob` text, compiled and placed, must
  // arrive with a channel that can cut.
  it('carries depth and width from the authored line to the placed prim', () => {
    const src = [
      'model t', '  height 1.0', '', 'skeleton', '  root pelvis at 0.5 len=0.2',
      '  bone skull parent=pelvis dir=up len=0.16', '',
      'body',
      '  blob torso on pelvis at=0.5 r=0.2 blend=0.01 core',
      '  groove torso on pelvis at=0.5 offset=(0,0,0.15) r=0.1 wide=1.0 tall=0.05 depth=0.011 width=0.007',
      '',
    ].join('\n');
    const built = buildBody(compileBlob(parseBlob(src)));
    const g = built.prims.filter((p) => p.op === 'groove');
    expect(g).toHaveLength(1);
    expect(g[0]!.grooveDepth).toBe(0.011);
    expect(g[0]!.grooveWidth).toBe(0.007);
  });

  it('and that channel actually moves the field', () => {
    // The property test above would still pass if `sdGroove` ignored them, so
    // this one asserts the CONSEQUENCE: two depths, one field, different
    // answers. It is the assertion whose absence let the bug live.
    const mk = (depth: number) => buildBody(compileBlob(parseBlob([
      'model t', '  height 1.0', '', 'skeleton', '  root pelvis at 0.5 len=0.2',
      '  bone skull parent=pelvis dir=up len=0.16', '',
      'body',
      '  blob torso on pelvis at=0.5 r=0.2 blend=0.01 core',
      `  groove torso on pelvis at=0.5 offset=(0,0,0.12) r=0.1 wide=1.0 tall=0.05 depth=${depth} width=0.02`,
      '',
    ].join('\n'))));
    const probe: Vec3 = [0, 0.6, 0.2];
    const shallow = sdBody(probe, mk(0.005) as unknown as Body);
    const deep = sdBody(probe, mk(0.040) as unknown as Body);
    expect(deep).toBeGreaterThan(shallow + 0.01);
  });
});
