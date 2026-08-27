import { describe, it, expect } from 'vitest';
import {
  BONE_MAP,
  groupByBone,
  ringBasis,
  toLocal,
  fromLocal,
  globalScale,
  refToBody,
  SCALE_AXIS_NAMES,
} from './ref-align';
import type { RefSkin } from './ref-skin';

describe('BONE_MAP', () => {
  it('maps the spine in chain order, lowest joint first', () => {
    // Reference chain: Hips -> Spine02 -> Spine01 -> Spine -> shoulders/neck.
    // The numbering is misleading; this pins the real order.
    expect(BONE_MAP['spine1']!.head).toBe('Spine02');
    expect(BONE_MAP['chest']!.head).toBe('Spine01');
    expect(BONE_MAP['spine2']!.head).toBe('Spine');
    expect(BONE_MAP['spine2']!.tail).toBe('neck');
  });

  it('gives the foot both the ankle and the toe', () => {
    expect(BONE_MAP['foot.l']!.claims).toEqual(['LeftFoot', 'LeftToeBase']);
  });

  it('does not map hands or head joints', () => {
    const claimed = new Set(Object.values(BONE_MAP).flatMap((e) => e.claims));
    for (const j of ['LeftHand', 'RightHand', 'Head', 'head_end', 'headfront'])
      expect(claimed.has(j)).toBe(false);
  });

  it('mirrors every arm and leg bone', () => {
    for (const b of ['clavicle', 'upperarm', 'forearm', 'thigh', 'shin', 'foot']) {
      expect(BONE_MAP[`${b}.l`]).toBeDefined();
      expect(BONE_MAP[`${b}.r`]).toBeDefined();
    }
  });
});

describe('groupByBone', () => {
  const skin: RefSkin = {
    verts: [
      { joint: 'Hips', position: [0, 0, 0] },
      { joint: 'Hips', position: [1, 0, 0] },
      { joint: 'LeftToeBase', position: [0, 1, 0] },
      { joint: 'LeftHand', position: [0, 0, 1] },
      { joint: 'Nonsense', position: [2, 2, 2] },
    ],
    jointWorld: new Map(), total: 5, dropped: 0,
  };

  it('groups claimed joints under their bone', () => {
    const { byBone } = groupByBone(skin);
    expect(byBone.get('pelvis')).toHaveLength(2);
    expect(byBone.get('foot.l')).toHaveLength(1);   // the toe claims into foot
  });

  it('reports unmapped joints by name with a count, and never guesses', () => {
    const { unmapped } = groupByBone(skin);
    expect(unmapped.get('LeftHand')).toBe(1);
    expect(unmapped.get('Nonsense')).toBe(1);
    expect([...byBoneNames(skin)]).not.toContain('hand.l');
  });
});

function byBoneNames(skin: RefSkin): Set<string> {
  return new Set(groupByBone(skin).byBone.keys());
}

describe('ringBasis', () => {
  it('picks held/solved axes from the bone direction', () => {
    expect(ringBasis([0,0,0], [0,1,0]).heldAxis).toBe(0);    // y-bone: hold wide
    expect(ringBasis([0,0,0], [0,1,0]).solvedAxis).toBe(2);  //         solve deep
    expect(ringBasis([0,0,0], [1,0,0]).heldAxis).toBe(1);    // x-bone: hold tall
    expect(ringBasis([0,0,0], [1,0,0]).solvedAxis).toBe(2);  //         solve deep
    expect(ringBasis([0,0,0], [0,0,1]).heldAxis).toBe(0);    // z-bone: hold wide
    expect(ringBasis([0,0,0], [0,0,1]).solvedAxis).toBe(1);  //         solve tall
  });

  it('names the axes for the report', () => {
    expect(SCALE_AXIS_NAMES).toEqual(['wide', 'tall', 'deep']);
  });

  it('is orthonormal', () => {
    const b = ringBasis([0, 0, 0], [0.3, 1, 0.2]);
    const d = (p: readonly number[], q: readonly number[]) => p[0]!*q[0]! + p[1]!*q[1]! + p[2]!*q[2]!;
    expect(d(b.e1, b.e2)).toBeCloseTo(0, 10);
    expect(d(b.e1, b.u)).toBeCloseTo(0, 10);
    expect(d(b.e2, b.u)).toBeCloseTo(0, 10);
    expect(d(b.e1, b.e1)).toBeCloseTo(1, 10);
  });
});

describe('pose independence', () => {
  it('gives identical bone-local coordinates for two differently-posed bones', () => {
    // Same bone, two poses: straight up, and rotated 90 degrees onto world x.
    const up = ringBasis([0, 0, 0], [0, 1, 0]);
    const out = ringBasis([0.4, 0.9, 0], [1.4, 0.9, 0]);

    // A point on the surface of the "up" pose.
    const p: [number, number, number] = [0.1, 0.5, 0.02];
    const local = toLocal(p, up);

    // Placed into the other pose and read back, the locals must match exactly.
    const q = fromLocal(local, out);
    const back = toLocal(q, out);
    expect(back.x1).toBeCloseTo(local.x1, 12);
    expect(back.x2).toBeCloseTo(local.x2, 12);
    expect(back.along).toBeCloseTo(local.along, 12);
  });

  // The round-trip above holds for ANY orthonormal frame, so it cannot fail on
  // a wrong basis. These two pin the property that actually matters.
  it('is invariant to where the bone sits in the world', () => {
    const here = ringBasis([0, 0, 0], [0, 1, 0]);
    const there = ringBasis([3, -7, 2], [3, -6, 2]);
    const a = toLocal([0.1, 0.5, 0.02], here);
    const b = toLocal([3.1, -6.5, 2.02], there);
    expect(b.x1).toBeCloseTo(a.x1, 12);
    expect(b.x2).toBeCloseTo(a.x2, 12);
    expect(b.along).toBeCloseTo(a.along, 12);
  });

  it('carries a reference point into a differently-posed bone of ours', () => {
    // Reference arm: 100 units long, along world +y from the origin.
    const ref = ringBasis([0, 0, 0], [0, 100, 0]);
    // Our arm: same bone, posed along world +x, and 100x smaller.
    const ours = ringBasis([0.2, 1.3, 0], [1.2, 1.3, 0]);

    // Halfway down the reference bone, 10 units out along +x.
    const q = refToBody([10, 50, 0], ref, ours, 0.01);

    // 0.5 along our bone (+x) and 0.1 out along our held axis (+y).
    expect(q[0]).toBeCloseTo(0.2 + 0.5, 12);
    expect(q[1]).toBeCloseTo(1.3 + 0.1, 12);
    expect(q[2]).toBeCloseTo(0, 12);
  });
});

describe('globalScale', () => {
  it('takes the median ratio and names the bone furthest from it', () => {
    const ref = new Map([
      ['a', { head: [0,0,0] as const, tail: [0,100,0] as const }],
      ['b', { head: [0,0,0] as const, tail: [0,100,0] as const }],
      ['c', { head: [0,0,0] as const, tail: [0,100,0] as const }],
    ]);
    const ours = new Map([
      ['a', { head: [0,0,0] as const, tail: [0,1,0] as const }],   // ratio 0.01
      ['b', { head: [0,0,0] as const, tail: [0,1,0] as const }],   // ratio 0.01
      ['c', { head: [0,0,0] as const, tail: [0,2,0] as const }],   // ratio 0.02
    ]);
    const g = globalScale(ref as never, ours as never);
    expect(g.scale).toBeCloseTo(0.01, 12);
    expect(g.worstBone).toBe('c');
    expect(g.n).toBe(3);
  });
});
