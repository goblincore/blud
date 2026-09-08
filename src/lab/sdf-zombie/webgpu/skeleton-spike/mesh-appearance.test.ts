import { describe, expect, it } from 'vitest';
import { meshAppearanceCoord, skullFeatureMasks } from './mesh-appearance';

const headBounds = {
  min: [-0.09, 1.49, 0.01] as [number, number, number],
  max: [0.09, 1.74, 0.22] as [number, number, number],
};

describe('meshAppearanceCoord', () => {
  it('maps source-local head bounds to a stable signed frame', () => {
    meshAppearanceCoord(headBounds, [0, 1.615, 0.115]).forEach(v => expect(v).toBeCloseTo(0, 12));
    expect(meshAppearanceCoord(headBounds, headBounds.min)).toEqual([-1, -1, -1]);
    expect(meshAppearanceCoord(headBounds, headBounds.max)).toEqual([1, 1, 1]);
  });
});

describe('skullFeatureMasks', () => {
  it('makes both eye sockets broad and symmetric on the frontal cranium', () => {
    const left = skullFeatureMasks([-0.36, 0.22, 0.82]);
    const right = skullFeatureMasks([0.36, 0.22, 0.82]);
    expect(left.sockets).toBeGreaterThan(0.75);
    expect(right.sockets).toBeCloseTo(left.sockets, 8);
    expect(skullFeatureMasks([0, 0.22, 0.82]).sockets).toBeLessThan(0.1);
  });

  it('keeps the nasal cavity central and distinct from the sockets', () => {
    const nose = skullFeatureMasks([0, -0.08, 0.9]);
    expect(nose.nose).toBeGreaterThan(0.7);
    expect(nose.sockets).toBeLessThan(0.15);
    expect(skullFeatureMasks([0.3, -0.08, 0.9]).nose).toBeLessThan(0.05);
  });

  it('limits the tooth row to the front lower jaw and exposes separators', () => {
    const tooth = skullFeatureMasks([0.22, -0.53, 0.9]);
    expect(tooth.mouth).toBeGreaterThan(0.6);
    expect(tooth.teeth).toBeGreaterThan(0.25);
    expect(tooth.seams).toBeGreaterThan(0.15);
    expect(skullFeatureMasks([0.22, -0.53, -0.8]).mouth).toBe(0);
    expect(skullFeatureMasks([0.8, -0.53, 0.9]).mouth).toBeLessThan(0.01);
  });
});
