// src/lab/sdf-zombie/sever.test.ts
import { describe, it, expect } from 'vitest';
import { severLimb } from './sever';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { packBody } from './pack';
import { sdBody } from './validate';

describe('severLimb', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);

  it('marks only the target cluster dead', () => {
    const { body: after } = severLimb(body, 'armL');
    expect(after.clusters.find(c => c.limb === 'armL')!.alive).toBe(false);
    expect(after.clusters.filter(c => c.limb !== 'armL').every(c => c.alive)).toBe(true);
  });

  it('never removes, reorders or re-packs primitives', () => {
    const { body: after } = severLimb(body, 'armL');
    expect(after.prims).toHaveLength(body.prims.length);
    expect(after.prims.map(p => p.limb)).toEqual(body.prims.map(p => p.limb));
    expect(Array.from(packBody(after).primA)).toEqual(Array.from(packBody(body).primA));
  });

  it('leaves the torso field bit-identical — the fold order is unchanged', () => {
    const { body: after } = severLimb(body, 'armL');
    const torso = body.clusters.find(c => c.limb === 'torso')!;
    // Sample inside the torso, far from the removed arm.
    for (const off of [[0, 0, 0], [0.03, 0.05, 0], [0, -0.06, 0.02]] as const) {
      const p = [torso.center[0] + off[0], torso.center[1] + off[1], torso.center[2] + off[2]] as const;
      expect(sdBody(p, after)).toBe(sdBody(p, body));
    }
  });

  it('returns a chunk group carrying exactly the severed primitives', () => {
    const { chunk } = severLimb(body, 'legR');
    const expected = body.prims.filter(p => p.limb === 'legR');
    expect(chunk.prims).toEqual(expected);
    expect(chunk.limb).toBe('legR');
  });

  it('stamps a stump wound bound to a surviving primitive', () => {
    const { stumpWound, body: after } = severLimb(body, 'armR');
    expect(stumpWound).not.toBeNull();
    const owner = after.prims[stumpWound!.primIdx]!;
    expect(after.clusters.find(c => c.limb === owner.limb)!.alive).toBe(true);
    expect(stumpWound!.radius).toBeGreaterThan(0);
  });

  it('is a no-op when the limb is already severed', () => {
    const once = severLimb(body, 'armL');
    const twice = severLimb(once.body, 'armL');
    expect(twice.chunk.prims).toHaveLength(0);
    expect(twice.stumpWound).toBeNull();
  });

  it('refuses to sever the torso', () => {
    expect(() => severLimb(body, 'torso')).toThrow(/torso/i);
  });
});
