import { describe, it, expect } from 'vitest';
import { woundThreatMasks, type ThreatGroup } from './wound-threat';

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
