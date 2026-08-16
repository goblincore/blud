// src/lab/sdf-zombie/sever.test.ts
import { describe, it, expect } from 'vitest';
import { gibAllPieces, severLimb } from './sever';
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

describe('gibAllPieces', () => {
  const body2 = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const torso = body2.clusters.find(c => c.limb === 'torso')!;

  it('splits every non-head cluster into one piece per add-prim', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    for (const cl of body2.clusters) {
      const pieces = chunks.filter(g => g.limb === cl.limb);
      const addPrims = body2.prims
        .slice(cl.start, cl.start + cl.count)
        .filter(p => p.op !== 'sub');
      if (cl.limb === 'head') {
        expect(pieces).toHaveLength(1); // head stays whole (face carves)
      } else {
        expect(pieces).toHaveLength(addPrims.length);
        for (const piece of pieces) expect(piece.prims).toHaveLength(1);
      }
    }
  });

  it('pieces exactly partition each split cluster (no prim lost or doubled)', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    const armPrims = body2.prims.filter(p => p.limb === 'armL' && p.op !== 'sub');
    const pieces = chunks.filter(g => g.limb === 'armL').flatMap(g => g.prims);
    expect(pieces).toHaveLength(armPrims.length);
    for (const p of armPrims) expect(pieces).toContain(p);
  });

  it('marks every cluster dead, like gibAll', () => {
    const { body: after } = gibAllPieces(body2, torso.center);
    expect(after.clusters.every(c => !c.alive)).toBe(true);
  });

  it('gives every piece at least one torn point, at joints or the attach end', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    for (const g of chunks) {
      expect(g.tornAt.length).toBeGreaterThanOrEqual(1);
      expect(g.tornAt.length).toBeLessThanOrEqual(2);
    }
  });

  it('piece origins sit at their prim midpoints', () => {
    const { chunks } = gibAllPieces(body2, torso.center);
    const piece = chunks.find(g => g.limb === 'legR')!;
    const p = piece.prims[0]!;
    expect(piece.origin[0]).toBeCloseTo((p.a[0] + p.b[0]) / 2, 6);
    expect(piece.origin[1]).toBeCloseTo((p.a[1] + p.b[1]) / 2, 6);
  });
});
