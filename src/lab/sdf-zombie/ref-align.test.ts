import { describe, it, expect } from 'vitest';
import { BONE_MAP, groupByBone } from './ref-align';
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
