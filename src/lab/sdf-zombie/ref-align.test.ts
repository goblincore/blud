import { describe, it, expect } from 'vitest';
import {
  BONE_MAP,
  MESHY_BIPED,
  DRAGON_BIPED,
  detectRig,
  groupByBone,
  refBones,
  ringBasis,
  toLocal,
  fromLocal,
  globalScale,
  refToBody,
  SCALE_AXIS_NAMES,
} from './ref-align';
import type { RefSkin } from './ref-skin';
import type { Vec3 } from './types';

describe('BONE_MAP', () => {
  it('is the meshy-biped rig table', () => {
    // BONE_MAP predates the rig registry; it must remain THE meshy-biped
    // table so existing callers and tests keep meaning the same thing.
    expect(BONE_MAP).toBe(MESHY_BIPED.boneMap);
  });

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
    const { byBone } = groupByBone(skin, MESHY_BIPED);
    expect(byBone.get('pelvis')).toHaveLength(2);
    expect(byBone.get('foot.l')).toHaveLength(1);   // the toe claims into foot
  });

  it('reports unmapped joints by name with a count, and never guesses', () => {
    const { unmapped } = groupByBone(skin, MESHY_BIPED);
    expect(unmapped.get('LeftHand')).toBe(1);
    expect(unmapped.get('Nonsense')).toBe(1);
    expect([...byBoneNames(skin)]).not.toContain('hand.l');
  });
});

function byBoneNames(skin: RefSkin): Set<string> {
  return new Set(groupByBone(skin, MESHY_BIPED).byBone.keys());
}

describe('ringBasis', () => {
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

describe('detectRig', () => {
  // Every joint the meshy-biped table names (a superset is fine — the real
  // files also carry head_end/headfront, which no table names).
  const MESHY_JOINTS = [
    'Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  ];
  const DRAGON_JOINTS = Array.from({ length: 29 }, (_, i) => `Bone_${String(i).padStart(3, '0')}`);

  it('selects the meshy rig by joint-name signature', () => {
    expect(detectRig(MESHY_JOINTS)).toBe(MESHY_BIPED);
  });

  it('selects the dragon rig from Bone_000..Bone_028, which the meshy rig cannot map at all', () => {
    expect(detectRig(DRAGON_JOINTS)).toBe(DRAGON_BIPED);
  });

  it('fails loudly, naming the reference joints and every known rig, when nothing matches', () => {
    expect(() => detectRig(['Femur', 'Tibia', 'Horn']))
      .toThrow(/no known rig matches.*Femur.*meshy-biped.*dragon-biped/s);
  });

  it('fails loudly when more than one rig matches, rather than guessing', () => {
    // A file carrying BOTH rigs' joints satisfies both signatures.
    expect(() => detectRig([...MESHY_JOINTS, ...DRAGON_JOINTS])).toThrow(/ambiguou/i);
  });
});

describe('DRAGON_BIPED', () => {
  /**
   * Verified against green_dragon_rigged.glb (29 joints, bind pose, no tail
   * chain). The chain is Bone_001 (pelvis/tail base) -> Bone_005 -> Bone_004
   * -> Bone_003 -> Bone_002, with the neck 028 -> 027 -> 026 hanging off
   * Bone_002 — so spine2 spans Bone_003 -> Bone_028, ending exactly where the
   * neck chain begins. UNLIKE the meshy rig, the numbering ASCENDS the chain:
   * Bone_005 is the LOWEST spine joint. The two rigs are opposites; pinning
   * both is what stops one being "fixed" into the other.
   */
  it('walks the spine in chain order, ending where the neck chain begins', () => {
    expect(DRAGON_BIPED.boneMap['pelvis']).toEqual({
      head: 'Bone_001', tail: 'Bone_005', claims: ['Bone_001', 'Bone_000'],
    });
    expect(DRAGON_BIPED.boneMap['spine1']!.head).toBe('Bone_005');
    expect(DRAGON_BIPED.boneMap['spine1']!.tail).toBe('Bone_004');
    expect(DRAGON_BIPED.boneMap['chest']!.head).toBe('Bone_004');
    expect(DRAGON_BIPED.boneMap['chest']!.tail).toBe('Bone_003');
    expect(DRAGON_BIPED.boneMap['spine2']!.head).toBe('Bone_003');
    expect(DRAGON_BIPED.boneMap['spine2']!.tail).toBe('Bone_028');
    expect(DRAGON_BIPED.boneMap['neck']!.head).toBe('Bone_028');
    expect(DRAGON_BIPED.boneMap['neck']!.tail).toBe('Bone_027');
  });

  it('claims Bone_000 into the pelvis and Bone_003/Bone_002 into spine2', () => {
    // Bone_000 is the root joint but its vertex cloud sits at the pelvis/tail
    // underside, so the pelvis claims it. Bone_003/Bone_002 carry no dominant
    // vertices (the wing shoulders take that surface) — claimed into spine2
    // so the mapping stays explicit about who owns the shoulder bridge.
    expect(DRAGON_BIPED.boneMap['spine2']!.claims).toEqual(['Bone_003', 'Bone_002']);
  });

  it('reads the wings as the arm chain and the hind legs as a digitigrade leg', () => {
    // Wing chain 020 -> 019 -> 018 -> 017 -> 016: three bones map onto it and
    // the tip (017, 016 — the wing "hand") stays unmapped, like the meshy
    // hands. Leg chain 010 -> 009 -> 008 -> 007 -> 006 hits the GROUND at 007
    // (y 0.035): the digitigrade foot spans hock -> toe and claims the whole
    // load-bearing assembly.
    expect(DRAGON_BIPED.boneMap['clavicle.l']).toEqual({ head: 'Bone_020', tail: 'Bone_019', claims: ['Bone_020'] });
    expect(DRAGON_BIPED.boneMap['upperarm.l']).toEqual({ head: 'Bone_019', tail: 'Bone_018', claims: ['Bone_019'] });
    expect(DRAGON_BIPED.boneMap['forearm.l']).toEqual({ head: 'Bone_018', tail: 'Bone_017', claims: ['Bone_018'] });
    expect(DRAGON_BIPED.boneMap['thigh.l']).toEqual({ head: 'Bone_010', tail: 'Bone_009', claims: ['Bone_010'] });
    expect(DRAGON_BIPED.boneMap['shin.l']).toEqual({ head: 'Bone_009', tail: 'Bone_008', claims: ['Bone_009'] });
    expect(DRAGON_BIPED.boneMap['foot.l']).toEqual({
      head: 'Bone_008', tail: 'Bone_006', claims: ['Bone_008', 'Bone_007', 'Bone_006'],
    });
  });

  it('mirrors every limb bone', () => {
    for (const b of ['clavicle', 'upperarm', 'forearm', 'thigh', 'shin', 'foot']) {
      expect(DRAGON_BIPED.boneMap[`${b}.l`]).toBeDefined();
      expect(DRAGON_BIPED.boneMap[`${b}.r`]).toBeDefined();
    }
  });

  it('leaves the head, horns and wing tips unmapped', () => {
    // Bone_027 alone carries 24% of the mesh — head, jaw and horns (its cloud
    // spans y 1.01..1.60, x +-0.36, far above the 1.065 neck-end joint). The
    // head is out of scope, as on the meshy rig; the wing tips are the
    // hands-equivalent.
    const claimed = new Set(Object.values(DRAGON_BIPED.boneMap).flatMap((e) => e.claims));
    for (const j of ['Bone_026', 'Bone_027', 'Bone_016', 'Bone_017', 'Bone_021', 'Bone_022'])
      expect(claimed.has(j)).toBe(false);
  });

  it('groups dragon verts onto its bones and reports head joints as unmapped', () => {
    const skin: RefSkin = {
      verts: [
        { joint: 'Bone_020', position: [1, 0, 0] },
        { joint: 'Bone_008', position: [2, 0, 0] },
        { joint: 'Bone_027', position: [3, 0, 0] },
      ],
      jointWorld: new Map(), total: 3, dropped: 0,
    };
    const { byBone, unmapped } = groupByBone(skin, DRAGON_BIPED);
    expect(byBone.get('clavicle.l')).toHaveLength(1);
    expect(byBone.get('foot.l')).toHaveLength(1);
    expect(unmapped.get('Bone_027')).toBe(1);
  });

  it('derives bones from joint world positions via the dragon table', () => {
    const jw = new Map<string, Vec3>([
      ['Bone_001', [0, 0, 0]], ['Bone_005', [0, 0.2, 0]],
      ['Bone_020', [1, 1, 0]], ['Bone_019', [1.3, 1, 0]],
    ]);
    const ref = refBones(jw, DRAGON_BIPED);
    expect(ref.get('pelvis')).toEqual({ head: [0, 0, 0], tail: [0, 0.2, 0] });
    expect(ref.get('clavicle.l')).toEqual({ head: [1, 1, 0], tail: [1.3, 1, 0] });
    // Joints the table needs but the map lacks skip that bone only.
    expect(ref.has('neck')).toBe(false);
  });
});
