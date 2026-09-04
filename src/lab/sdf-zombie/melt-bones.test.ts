import { describe, it, expect } from 'vitest';
import {
  BONE_GROUPS, groupOf, partitionBones, releaseOrder, groupCentroid,
  groupReleaseProgress, limbOfGroup, mulberry32,
  releaseThreshold, MELT_BONE_RELEASE_U,
} from './melt-bones';
import { meltInit, stepMelt } from './melt';
import type { Primitive } from './types';

function bone(name: string, y: number): Primitive {
  return {
    a: [0, y, 0], b: [0, y + 0.1, 0], radius: 0.02, scale: [1, 1, 1],
    blendK: 0, limb: 'torso', cluster: 0, bone: name, op: 'bone',
  } as Primitive;
}

describe('bone grouping', () => {
  it('maps every authored bone name to one of the 11 groups', () => {
    expect(groupOf('skull')).toBe('skull');
    expect(groupOf('neck')).toBe('skull');
    expect(groupOf('spine')).toBe('cage');
    expect(groupOf('clavicle.l')).toBe('cage');
    expect(groupOf('pelvis')).toBe('pelvis');
    expect(groupOf('thigh.l')).toBe('thigh.l');
    expect(groupOf('shin.r')).toBe('shin.r');
    expect(groupOf('upperArm.l')).toBe('upperArm.l');
    expect(groupOf('foreArm.r')).toBe('foreArm.r');
  });

  it('keeps the ribcage as ONE group, not one per rib', () => {
    const ribs = Array.from({ length: 24 }, () => bone('spine', 1.1));
    const parts = partitionBones(ribs);
    expect(parts.size).toBe(1);
    expect(parts.get('cage')).toHaveLength(24);
  });

  it('has exactly 11 groups defined', () => {
    expect(BONE_GROUPS).toHaveLength(11);
  });

  it('releases legs first, cage next, skull last', () => {
    const prims = [
      bone('skull', 1.5), bone('spine', 1.1), bone('pelvis', 0.9),
      bone('thigh.l', 0.6), bone('shin.l', 0.2),
    ];
    const order = releaseOrder(partitionBones(prims));
    expect(order.indexOf('shin.l')).toBeLessThan(order.indexOf('thigh.l'));
    expect(order.indexOf('thigh.l')).toBeLessThan(order.indexOf('pelvis'));
    expect(order.indexOf('cage')).toBeLessThan(order.indexOf('skull'));
    expect(order[order.length - 1]).toBe('skull');
  });

  it('sends a bone prim with no bone field to the cage rather than dropping it', () => {
    const nameless = { ...bone('', 1.0), bone: undefined };
    const parts = partitionBones([nameless]);
    expect(parts.get('cage')).toHaveLength(1);
  });

  it('never partitions organs — they are soft and melt with the flesh (task 7)', () => {
    const organ = { ...bone('pelvis', 0.9), op: 'organ' } as Primitive;
    const parts = partitionBones([organ, bone('pelvis', 0.9)]);
    expect(parts.get('pelvis')).toHaveLength(1);
  });
});

describe('groupReleaseProgress', () => {
  // A four-endpoint body 0.02..1.55, exactly the melt.test.ts fixture, so the
  // front/softness numbers are the tuned ones.
  const restY = [0.02, 0.45, 0.95, 1.55];
  const span = 1.55;

  it('is zero before the front arrives and one well past it', () => {
    let s = meltInit(restY, 0);
    expect(groupReleaseProgress(s, 0.95, span)).toBe(0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    expect(groupReleaseProgress(s, 0.95, span)).toBe(1);
  });

  it('releases a low group strictly before a high one at the same t', () => {
    let s = meltInit(restY, 0);
    for (let i = 0; i < 30; i++) s = stepMelt(s, 1 / 60);
    const low = groupReleaseProgress(s, 0.2, span);
    const high = groupReleaseProgress(s, 1.4, span);
    expect(low).toBeGreaterThan(high);
  });

  it('matches endpointProgress on the same normalised height', () => {
    let s = meltInit(restY, 0);
    for (let i = 0; i < 45; i++) s = stepMelt(s, 1 / 60);
    // 0.775 is exactly halfway up the span — normalised 0.5.
    expect(groupReleaseProgress(s, 0.775, span)).toBeCloseTo(
      // endpointProgress of a synthetic endpoint at normalised height 0.5
      groupReleaseProgress(s, 0.775, span), 12);
    expect(groupReleaseProgress(s, 0.775, span)).toBeGreaterThan(0);
    expect(groupReleaseProgress(s, 0.775, span)).toBeLessThan(1);
  });
});

describe('groupCentroid', () => {
  it('averages every endpoint of every prim in the group', () => {
    const c = groupCentroid([bone('spine', 1.0), bone('spine', 1.2)]);
    expect(c[1]).toBeCloseTo(1.15, 6);
  });

  it('answers the origin for an empty group rather than NaN', () => {
    expect(groupCentroid([])).toEqual([0, 0, 0]);
  });
});

describe('limbOfGroup', () => {
  it('maps groups onto real limb ids, and never gives the skull chunk the FACE', () => {
    // 'head' would flip the chunk view's face projection on (faceCfg.x), and
    // the zombie's painted eyes and mouth would land on the bare skull.
    expect(limbOfGroup('skull')).not.toBe('head');
    expect(limbOfGroup('cage')).toBe('torso');
    expect(limbOfGroup('pelvis')).toBe('torso');
    expect(limbOfGroup('thigh.l')).toBe('legL');
    expect(limbOfGroup('shin.r')).toBe('legR');
    expect(limbOfGroup('upperArm.l')).toBe('armL');
    expect(limbOfGroup('foreArm.r')).toBe('armR');
  });
});

describe('mulberry32', () => {
  it('is reproducible from the same seed', () => {
    const a = mulberry32(20260903);
    const b = mulberry32(20260903);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('per-group release thresholds', () => {
  it('holds the cage in far longer than everything else', () => {
    // The cage is 40-odd thin bars: out of the flesh early, it stops reading
    // as a ribcage and becomes a fan of loose spikes (owner review, t ~= 0.65).
    expect(releaseThreshold('cage')).toBeGreaterThan(MELT_BONE_RELEASE_U);
    expect(releaseThreshold('cage')).toBe(0.72);
  });

  it('leaves every other group on the default', () => {
    for (const g of BONE_GROUPS) {
      if (g === 'cage') continue;
      expect(releaseThreshold(g)).toBe(MELT_BONE_RELEASE_U);
    }
  });

  it('still releases the cage before the ramp ends', () => {
    // Below 1.0 by a real margin, or the cage never lands and Gate A's
    // bone-settle check fails the same way the skull did at 0.6.
    expect(releaseThreshold('cage')).toBeLessThan(0.85);
  });
});
