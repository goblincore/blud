import { describe, it, expect } from 'vitest';
import { cutLipAmp, cutThreatWound, woundThreatMasks, type ThreatGroup } from './wound-threat';
import { CUT_SHADE, cutCarve } from '../cut-wound';
import type { Vec3 } from '../types';

// Two clusters: 0 = a torso group at the origin, 1 = a limb with a near and a far group.
const groups: ThreatGroup[] = [
  { center: [0, 0, 0], radius: 0.2, distort: 1 },
  { center: [0.3, 0, 0], radius: 0.05, distort: 1 },
  { center: [0.3, -0.8, 0], radius: 0.05, distort: 1 },
];
const clusterGroups: [number, number][] = [[0, 1], [1, 2]];

describe('woundThreatMasks', () => {
  it('names a foreign cluster whose group reaches the carve sphere, and never the owner', () => {
    const [m] = woundThreatMasks([{ pos: [0.15, 0, 0], radius: 0.1, owner: 0 }], groups, clusterGroups, 0.02);
    expect(m).toBe(1 << 2);
  });
  it('drops a cluster that is out of reach', () => {
    const [m] = woundThreatMasks([{ pos: [-0.15, 0, 0], radius: 0.1, owner: 0 }], groups, clusterGroups, 0.02);
    expect(m).toBe(0);
  });
  it('is conservative in the margin', () => {
    const [m] = woundThreatMasks([{ pos: [-0.15, 0, 0], radius: 0.1, owner: 0 }], groups, clusterGroups, 0.4);
    expect(m).toBe(1 << 2);
  });
  it('an unscoped wound threatens nobody: it is applied in every re-fold, never foreign', () => {
    const [m] = woundThreatMasks([{ pos: [0.15, 0, 0], radius: 0.5, owner: -1 }], groups, clusterGroups, 0.5);
    expect(m).toBe(0);
  });
  it('the depth slab excludes flesh behind the cap plane', () => {
    // Wound on the +x face of the torso, inward normal -x: the limb at +0.3 is OUTSIDE the
    // surface (negative depth) so the slab keeps it; flip the normal and it sits 0.15 past a 2 cm cap.
    const w = { pos: [0.15, 0, 0] as [number, number, number], radius: 0.3, owner: 0 };
    expect(woundThreatMasks([{ ...w, cap: { n: [-1, 0, 0], depth: 0.02 } }], groups, clusterGroups, 0.02)[0]).toBe(1 << 2);
    expect(woundThreatMasks([{ ...w, cap: { n: [1, 0, 0], depth: 0.02 } }], groups, clusterGroups, 0.02)[0]).toBe(0);
  });
  it('a distorted group widens the sphere test and skips the slab', () => {
    const fat = [groups[0]!, { ...groups[1]!, distort: 10 }, groups[2]!];
    const w = { pos: [-0.15, 0, 0] as [number, number, number], radius: 0.1, owner: 0, cap: { n: [1, 0, 0] as [number, number, number], depth: 0.001 } };
    expect(woundThreatMasks([w], fat, clusterGroups, 0.02)[0]).toBe(1 << 2);
  });
  it('stays below 512 so mask / 1024 keeps a 0/1 flag readable in the same texel', () => {
    const many: [number, number][] = Array.from({ length: 8 }, () => [0, 1] as [number, number]);
    const m = woundThreatMasks([{ pos: [0, 0, 0], radius: 1, owner: 0 }], groups, many, 1)[0]!;
    expect(m).toBeLessThan(512);
    expect(1 + m / 1024 > 0.5 && m / 1024 < 0.5).toBe(true);
  });
});

describe('a cut row (flag 32): cutThreatWound', () => {
  // The owner (cluster 0) is a 0.2 m ball at the origin; a 0.1 m cut (half-length 0.05) on its +z face, inward -z,
  // along +y, 0.06 deep, sag 0.01, kerf 0.01. Cluster 1 gets one group per case.
  const owner: ThreatGroup = { center: [0, 0, 0], radius: 0.2, distort: 1 };
  const mid: Vec3 = [0, 0, 0.2], inward: Vec3 = [0, 0, -1], along: Vec3 = [0, 1, 0];
  const halfLen = 0.05, depth = 0.06, sag = 0.01, kerf = 0.01, margin = 0.005;
  const reachR = halfLen * Math.max(2, 2 * 1.15 + 3 * 0.42) + 4 * 0.015 + 0.25;   // the game's woundCfg / woundCfg2
  const cut = cutThreatWound(mid, 0, halfLen, inward, depth, sag, along, kerf, reachR);
  const maskWith = (g: ThreatGroup) => woundThreatMasks([cut], [owner, g], [[0, 1], [1, 1]], margin)[0];
  it('a foreign hand crossing the channel above the cut is threatened (the slot carves it), though far outside the half-length', () => {
    const hand: ThreatGroup = { center: [0, 0, 0.35], radius: 0.03, distort: 1 };
    // Really carved: cutCarve with dIn = the union field is positive inside the hand, on the slot's line.
    const field = (p: Vec3) => Math.min(Math.hypot(p[0], p[1], p[2]) - 0.2, Math.hypot(p[0], p[1], p[2] - 0.35) - 0.03);
    const inHand: Vec3 = [0, 0, 0.35 - 0.03 + 0.002];
    expect(cutCarve(inHand, mid, halfLen, along, inward, depth, kerf, field(inHand), sag)).toBeGreaterThan(0);
    // The crater form (the half-length sphere) would have missed it.
    expect(woundThreatMasks([{ pos: mid, radius: halfLen, owner: 0, cap: { n: inward, depth } }], [owner, hand], [[0, 1], [1, 1]], margin)[0]).toBe(0);
    expect(maskWith(hand)).toBe(1 << 2);
  });
  it('the slab is sag + depth deep: a group just past the depth but above the floor is kept, one past the floor dropped', () => {
    const widen = (1 / CUT_SHADE.carveK - 1) * (0.01 + margin);
    const atDepth = (below: number): ThreatGroup => ({ center: [0, 0, 0.2 - below - 0.01], radius: 0.01, distort: 1 });
    expect(maskWith(atDepth(depth + 0.5 * sag))).toBe(1 << 2);
    expect(maskWith(atDepth(sag + depth + margin + widen + 0.001))).toBe(0);
  });
  it('the box: a group inside the reach but well beside the slot, or past its tips, is dropped', () => {
    expect(maskWith({ center: [0.08, 0, 0.25], radius: 0.02, distort: 1 })).toBe(0);
    expect(maskWith({ center: [0, 0.12, 0.25], radius: 0.02, distort: 1 })).toBe(0);
    // ...but a distorted group only gets the (reach) sphere test.
    expect(maskWith({ center: [0.08, 0, 0.25], radius: 0.02, distort: 1.5 })).toBe(1 << 2);
  });
  it('the lip amplitude is kerf-sized, not half-length-sized', () => {
    expect(cutLipAmp(kerf, 0.8)).toBeCloseTo(kerf * CUT_SHADE.lipHeight * 0.8, 12);
    expect(cutLipAmp(kerf, 0.8)).toBeLessThan(halfLen * 0.55 * 0.8);
  });
});
