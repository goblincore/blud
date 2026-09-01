import { describe, expect, it } from 'vitest';
import { deriveBones, DEFAULT_BONE_RATIO } from './bone-derive';
import type { PrimDef } from './types';

const thigh: PrimDef = {
  kind: 'bar', bone: 'thigh', at: 0.05, to: 0.95, radius: 0.082,
  scale: [1, 1, 1], blendK: 0.0175, limb: 'leg', mirror: true,
} as unknown as PrimDef;

const nose: PrimDef = {
  kind: 'blob', bone: 'skull', at: 0.5, radius: 0.012,
  scale: [1, 1, 1], blendK: 0.005, limb: 'head',
} as unknown as PrimDef;

const cranium: PrimDef = {
  kind: 'blob', bone: 'skull', at: 0.55, radius: 0.118,
  scale: [1, 1, 1], blendK: 0.01, limb: 'head',
} as unknown as PrimDef;

describe('deriveBones', () => {
  it('emits one bone twin per eligible prim, at ratio x radius', () => {
    const out = deriveBones([thigh], DEFAULT_BONE_RATIO);
    expect(out).toHaveLength(1);
    expect(out[0]!.op).toBe('bone');
    expect(out[0]!.radius).toBeCloseTo(0.082 * DEFAULT_BONE_RATIO, 6);
  });

  it('keeps the source placement so the bone rides the same rig point', () => {
    const [b] = deriveBones([thigh], DEFAULT_BONE_RATIO);
    expect(b!.bone).toBe('thigh');
    expect(b!.at).toBe(0.05);
    // `to` is an extra property that is NOT on PrimDef (the real field is
    // `capTo`) — it is here to prove unknown source fields ride the spread.
    expect((b as unknown as { to?: number }).to).toBe(0.95);
    expect(b!.limb).toBe('leg');
    expect(b!.mirror).toBe(true);
  });

  it('drops the source shaping — a bone is not a squashed blob', () => {
    const wide = { ...thigh, scale: [1.3, 1, 0.7] as const } as unknown as PrimDef;
    const [b] = deriveBones([wide], DEFAULT_BONE_RATIO);
    expect(b!.scale).toEqual([1, 1, 1]);
  });

  it('skips detail prims below half the fattest radius on the same bone', () => {
    // The nose is 0.012 against the cranium's 0.118 on the same skull bone,
    // so it is detail, not mass. A nose must not grow a bone of its own.
    const out = deriveBones([cranium, nose], DEFAULT_BONE_RATIO);
    expect(out).toHaveLength(1);
    expect(out[0]!.radius).toBeCloseTo(0.118 * DEFAULT_BONE_RATIO, 6);
  });

  it('skips carves, grooves and existing bone prims', () => {
    const carve = { ...thigh, op: 'sub' as const };
    const groove = { ...thigh, op: 'groove' as const };
    const bone = { ...thigh, op: 'bone' as const };
    expect(deriveBones([carve, groove, bone], DEFAULT_BONE_RATIO)).toEqual([]);
  });

  it('emits nothing at ratio 0, so a character can opt out', () => {
    expect(deriveBones([thigh], 0)).toEqual([]);
  });
});
