// src/lab/sdf-zombie/sever.test.ts
import { describe, it, expect } from 'vitest';
import { gibAll, gibAllPieces, severDistal, severLimb } from './sever';
import { cutChains, type ChainCut } from './connectivity';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { packBody } from './pack';
import { sdBody } from './validate';
import { worldHitToWound, woundWorldPos } from './damage';
import { applyRig, bindRig } from './rig-bind';
import type { Vec3 } from './types';

describe('severLimb', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);

  it('marks only the target cluster dead', () => {
    const { body: after } = severLimb(body, 'armL');
    expect(after.clusters.find(c => c.limb === 'armL')!.alive).toBe(false);
    expect(after.clusters.filter(c => c.limb !== 'armL').every(c => c.alive)).toBe(true);
  });

  it('never removes, reorders or re-packs primitives', () => {
    const { body: after } = severLimb(body, 'armL');
    expect(after.prims).toHaveLength(body.prims.length);
    expect(after.prims.map(p => p.limb)).toEqual(body.prims.map(p => p.limb));
    // FLESH rows byte-identical (wound pass r2: the bone rows past primCount
    // legitimately differ — severing drops the dead cluster's bones there, so
    // a full-array compare can no longer hold. The prims-length and limb-order
    // assertions above are the 'never removes or reorders' contract.)
    const a = packBody(after);
    const b = packBody(body);
    expect(Array.from(a.primA.slice(0, a.primCount * 4)))
      .toEqual(Array.from(b.primA.slice(0, b.primCount * 4)));
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

  it('a severed head keeps its face orientation — the frozen orient rides the chunk', () => {
    // Pose the head first so the skull prims carry a real orient, then cut.
    // The chunk must keep that quat: the GPU chunk view writes the quat row
    // ONCE at spawn (frozen at sever time), and a copy that dropped the field
    // would render the flying head's brow world-aligned — the visor bug,
    // mid-air.
    const posed = applyRig(body, {
      ...bound,
      rig: { ...bound.rig, points: bound.rig.points.map((p, i) =>
        i === bound.head!.tip ? { ...p, pos: [p.pos[0] + 0.5, p.pos[1], p.pos[2]] as Vec3 } : p) },
    });
    const oriented = posed.prims.filter(p => p.limb === 'head' && p.orient);
    expect(oriented.length).toBeGreaterThanOrEqual(4);
    const { chunk } = severLimb(posed, 'head');
    for (const p of oriented) {
      expect(chunk.prims).toContain(p); // reference-carried, orient and all
      expect(Math.abs(1 - p.orient![3])).toBeGreaterThan(0.05);
    }
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

// --- severDistal: mid-limb severing ---------------------------------------

describe('severDistal', () => {
  const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
  const torso = body.clusters.find(c => c.limb === 'torso')!;

  // legL's chain: thigh (topmost midpoint), foot (degenerate ball), shin (the
  // rest); knee = the closest endpoint pair across thigh/shin.
  const leg = body.clusters.find(c => c.limb === 'legL')!;
  const legPrims = body.prims.slice(leg.start, leg.start + leg.count)
    .filter(p => p.op !== 'sub');
  const midY = (p: (typeof legPrims)[number]) => (p.a[1] + p.b[1]) / 2;
  const thigh = legPrims.reduce((m, p) => (midY(p) > midY(m) ? p : m));
  const foot = legPrims.find(p =>
    Math.hypot(p.a[0] - p.b[0], p.a[1] - p.b[1], p.a[2] - p.b[2]) < 1e-6)!;
  const shin = legPrims.find(p => p !== thigh && p !== foot)!;
  let knee = thigh.b;
  {
    let best = Infinity;
    for (const e of [thigh.a, thigh.b]) for (const f of [shin.a, shin.b]) {
      const d = Math.hypot(e[0] - f[0], e[1] - f[1], e[2] - f[2]);
      if (d < best) {
        best = d;
        knee = [(e[0] + f[0]) / 2, (e[1] + f[1]) / 2, (e[2] + f[2]) / 2];
      }
    }
  }
  const dist3 = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

  const cut: ChainCut = cutChains(body, [worldHitToWound(body.prims, knee, 0.16, 'blast')])[0]!;

  it('keeps the cluster alive — only the proximal prims remain in it', () => {
    const { body: after } = severDistal(body, cut);
    expect(after.clusters.find(c => c.limb === 'legL')!.alive).toBe(true);
    expect(after.clusters.filter(c => c.limb !== 'legL').every(c => c.alive)).toBe(true);
  });

  it('marks exactly the distal prims dead — nothing removed or reordered', () => {
    const { body: after } = severDistal(body, cut);
    expect(after.prims).toHaveLength(body.prims.length);
    expect(after.prims.map(p => p.limb)).toEqual(body.prims.map(p => p.limb));
    expect(after.prims[body.prims.indexOf(shin)]!.dead).toBe(true);
    expect(after.prims[body.prims.indexOf(foot)]!.dead).toBe(true);
    expect(after.prims[body.prims.indexOf(thigh)]!.dead).toBeUndefined();
  });

  it('chunks exactly the distal prims as live copies, torn at the joint', () => {
    const { chunk } = severDistal(body, cut);
    expect(chunk.limb).toBe('legL');
    expect(chunk.prims).toHaveLength(2);
    expect(chunk.prims.every(p => !p.dead)).toBe(true);
    expect(chunk.tornAt).toHaveLength(1);
    expect(dist3(chunk.tornAt[0]!, knee)).toBeLessThan(0.03);
  });

  it('stamps a blast stump wound at the joint, sized by the joint girth', () => {
    const { stumpWound } = severDistal(body, cut);
    expect(stumpWound).not.toBeNull();
    expect(stumpWound!.type).toBe('blast');
    expect(dist3(woundWorldPos(body.prims, stumpWound!), knee)).toBeLessThan(0.03);
    expect(stumpWound!.radius).toBeGreaterThan(0.05);
    expect(stumpWound!.radius).toBeLessThan(0.15);
  });

  it('packBody writes w=2 for the dead prims only', () => {
    const packed = packBody(severDistal(body, cut).body);
    expect(packed.primScale[body.prims.indexOf(shin) * 4 + 3]).toBe(2);
    expect(packed.primScale[body.prims.indexOf(foot) * 4 + 3]).toBe(2);
    expect(packed.primScale[body.prims.indexOf(thigh) * 4 + 3]).toBe(0);
  });

  it('the CPU field no longer registers the dead prims', () => {
    const after = severDistal(body, cut).body;
    const p = foot.a; // the foot ball's centre
    expect(sdBody(p, body)).toBeLessThan(0);
    expect(sdBody(p, after)).toBeGreaterThan(0);
  });

  it('gibAllPieces does not resurrect the dead distal prims', () => {
    const after = severDistal(body, cut).body;
    const { chunks } = gibAllPieces(after, torso.center);
    const legPieces = chunks.filter(g => g.limb === 'legL');
    expect(legPieces).toHaveLength(1); // the thigh only
    expect(legPieces[0]!.prims).toHaveLength(1);
  });

  it('gibAll skips the dead prims too', () => {
    const after = severDistal(body, cut).body;
    const { chunks } = gibAll(after);
    const legGroup = chunks.find(g => g.limb === 'legL')!;
    expect(legGroup.prims).toHaveLength(1);
  });

  it('a later severLimb of the same limb must not resurrect the hand', () => {
    const after = severDistal(body, cut).body;
    const { chunk } = severLimb(after, 'legL');
    expect(chunk.prims).toHaveLength(1);
  });
});
