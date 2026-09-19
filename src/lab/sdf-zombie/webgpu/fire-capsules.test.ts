import { describe, it, expect } from 'vitest';
import { fireCapsules, capsuleVelocities, FIRE_CAPSULES_PER_BODY } from './fire-capsules';
import { buildTestBody } from './fire-capsules.fixture';

describe('fireCapsules', () => {
  it('returns at most FIRE_CAPSULES_PER_BODY capsules with positive radius', () => {
    const caps = fireCapsules(buildTestBody());
    expect(caps.length).toBeGreaterThan(4);
    expect(caps.length).toBeLessThanOrEqual(FIRE_CAPSULES_PER_BODY);
    for (const c of caps) expect(c.radius).toBeGreaterThan(0);
  });
  it('includes a crown above the head', () => {
    const caps = fireCapsules(buildTestBody());
    const crown = caps.find(c => c.crown);
    expect(crown).toBeDefined();
    const top = Math.max(...caps.filter(c => !c.crown).map(c => Math.max(c.a[1], c.b[1])));
    expect(crown!.a[1]).toBeGreaterThanOrEqual(top - 0.05);
  });
  it('skips subtractive and painted prims', () => {
    for (const c of fireCapsules(buildTestBody())) expect(c.source).not.toBe('sub');
  });
});

describe('fireCapsules legKitRadius', () => {
  it('widens only the leg capsules to the kit radius', () => {
    const bare = fireCapsules(buildTestBody());
    const kit = fireCapsules(buildTestBody(), { legKitRadius: 0.5 });
    expect(kit.length).toBe(bare.length);
    kit.forEach((c, i) => {
      if (c.limb === 'legL' || c.limb === 'legR') expect(c.radius).toBe(0.5);
      else expect(c.radius).toBe(bare[i]!.radius);
    });
    expect(kit.some(c => c.limb === 'legL' || c.limb === 'legR')).toBe(true);
  });
});

describe('capsuleVelocities', () => {
  it('is (cur - prev) / dt per endpoint midpoint, zero when prev is missing', () => {
    const prev = [{ a: [0, 0, 0], b: [0, 1, 0] }] as const;
    const cur = [{ a: [1, 0, 0], b: [1, 1, 0] }] as const;
    expect(capsuleVelocities(prev as any, cur as any, 0.5)[0]).toEqual([2, 0, 0]);
    expect(capsuleVelocities(null, cur as any, 0.5)[0]).toEqual([0, 0, 0]);
  });
});
