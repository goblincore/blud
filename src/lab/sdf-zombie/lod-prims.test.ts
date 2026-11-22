// src/lab/sdf-zombie/lod-prims.test.ts
//
// DISTANCE LOD FOR DETAIL PRIMS (PrimDef.lod; zombie hands, 2026-11-22): the `lod=` grammar, the per-body sticky
// near/far choice, and packBody's swap -- near groups parked, far stand-ins revived only while their palm lives.
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import { packBody, boundGroups, lodAnchorAlive, CLUSTER_STRIDE, PRIM_STRIDE, W_ADD, W_DEAD } from './pack';
import { severDistal } from './sever';
import { sdBody } from './validate';
import { detailFarSticky, DETAIL_MIN_PX, LOD_HYSTERESIS } from './lod';
import zombieSrc from './characters/zombie.blob?raw';

const body = buildBody(compileBlob(parseBlob(zombieSrc)));
const arm = body.clusters.find(c => c.limb === 'armL')!;
const idx = (lod: 'near' | 'far') => body.prims.flatMap((p, i) => (p.lod === lod && p.cluster === arm.id ? [i] : []));

describe('lod= in the .blob', () => {
  it('parses near and far, and rejects anything else', () => {
    expect(idx('near').length).toBe(5);   // four fingers and the thumb
    expect(idx('far').length).toBe(2);    // the finger stand-in and the straight thumb
    expect(() => parseBlob(zombieSrc.replace('lod=near', 'lod=mid'))).toThrow(/lod= takes near or far/);
  });

  it('builds far stand-ins dead, so the CPU body (hits, hulls, gibs) is the near shape', () => {
    for (const i of idx('far')) expect(body.prims[i]!.dead).toBe(true);
    for (const i of idx('near')) expect(body.prims[i]!.dead).toBeFalsy();
    // A point inside the stand-in but between two fingers: the CPU field does not see the stand-in.
    const s = body.prims[idx('far')[0]!]!;
    const mid: [number, number, number] = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
    const live = { ...body, prims: body.prims.map(p => (p.lod === 'far' ? { ...p, dead: false } : p.lod === 'near' ? { ...p, dead: true } : p)) };
    expect(sdBody(mid, live as never)).toBeLessThan(0);
    expect(sdBody(mid, body as never)).toBeGreaterThan(sdBody(mid, live as never));
  });
});

describe('detailFarSticky', () => {
  const band = DETAIL_MIN_PX * LOD_HYSTERESIS;
  it('swaps only once clear of the band either side of DETAIL_MIN_PX', () => {
    expect(detailFarSticky(DETAIL_MIN_PX + band + 1, true)).toBe(false);
    expect(detailFarSticky(DETAIL_MIN_PX, true)).toBe(true);
    expect(detailFarSticky(DETAIL_MIN_PX, false)).toBe(false);
    expect(detailFarSticky(DETAIL_MIN_PX - band - 1, false)).toBe(true);
  });
});

describe('packBody lodFar', () => {
  it('never puts lod and non-lod prims in one bound group', () => {
    for (const g of boundGroups(body.prims, arm.start, arm.count)) {
      const kinds = new Set(body.prims.slice(g.start, g.start + g.count).map(p => p.lod ?? 'always'));
      expect(kinds.size).toBe(1);
    }
  });

  const groupsOf = (lodFar: boolean) => {
    const p = packBody(body, undefined, { lodFar });
    const out: { start: number; count: number; r: number; lod: string }[] = [];
    for (let g = 0; g < p.groupCount; g++) {
      const o = g * CLUSTER_STRIDE;
      const start = p.groupRange[o]!;
      out.push({ start, count: p.groupRange[o + 1]!, r: p.groupBounds[o + 3]!, lod: body.prims[start]!.lod ?? 'always' });
    }
    return { p, groups: out };
  };

  it('near (default): far groups parked, near groups live, stand-ins dead', () => {
    const { p, groups } = groupsOf(false);
    for (const g of groups) expect(g.count > 0, g.lod).toBe(g.lod !== 'far');
    for (const i of idx('far')) expect(p.primScale[i * PRIM_STRIDE + 3]).toBe(W_DEAD);
  });

  it('far: near groups parked, stand-ins live, everything else as before', () => {
    const near = groupsOf(false), far = groupsOf(true);
    for (const g of far.groups) expect(g.count > 0, g.lod).toBe(g.lod !== 'near');
    for (const i of idx('far')) expect(far.p.primScale[i * PRIM_STRIDE + 3]).toBe(W_ADD);
    near.groups.forEach((g, k) => { if (g.lod === 'always') expect(far.groups[k]).toEqual(g); });
  });

  it('a hand cut off at the wrist takes its stand-ins with it', () => {
    // The wrist cut (connectivity cutChains): from the palm, the arm's first extremity prim.
    const palm = body.prims.findIndex(p => p.cluster === arm.id && p.extremity);
    const cut = severDistal(body, { limb: 'armL', fromPrim: palm }).body;
    expect(cut.prims[palm]!.dead).toBe(true);
    for (const i of idx('far')) expect(lodAnchorAlive(cut.prims, i)).toBe(false);
    const p = packBody(cut, undefined, { lodFar: true });
    for (const i of idx('far')) expect(p.primScale[i * PRIM_STRIDE + 3]).toBe(W_DEAD);
  });
});

describe('the outer hull holds both LOD sets', () => {
  it.each([
    ['no LOD sets given: one sphere holds both', 'both'],
    ['the body drawn near: its fingers chained', 'near'],
    ['the body drawn far: its stand-ins chained', 'far'],
  ])('every surface point of the hand it draws sits inside a hull sphere (%s)', async (_, mode) => {
    const { buildOuterHullInstances } = await import('./webgpu/shell-hull-outer');
    const hull = buildOuterHullInstances([body], mode === 'both' ? {} : { lodFar: new Set(mode === 'far' ? [body] : []) });
    const inside = (q: readonly number[]) => hull.some(s => Math.hypot(q[0]! - s.centre[0], q[1]! - s.centre[1], q[2]! - s.centre[2]) <= s.radius);
    const far = { ...body, prims: body.prims.map(p => (p.lod === 'far' ? { ...p, dead: false } : p.lod === 'near' ? { ...p, dead: true } : p)) };
    for (const b of mode === 'both' ? [body, far] : mode === 'far' ? [far] : [body]) {
      const hand = b.prims.filter(p => p.cluster === arm.id && p.extremity && !p.dead);
      let probed = 0;
      for (const p of hand) for (let t = 0; t <= 1; t += 0.1) for (let k = 0; k < 16; k++) {
        // March outward from the prim's axis to the surface along 16 directions round it.
        const c = [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t, p.a[2] + (p.b[2] - p.a[2]) * t];
        const dir = [Math.cos(k * 0.39), Math.sin(k * 0.39) * 0.7, Math.sin(k * 0.39 + 1)];
        const l = Math.hypot(dir[0]!, dir[1]!, dir[2]!);
        for (let s = 0; s < 0.08; s += 0.001) {
          const q: [number, number, number] = [c[0]! + dir[0]! / l * s, c[1]! + dir[1]! / l * s, c[2]! + dir[2]! / l * s];
          if (sdBody(q, b as never) >= 0) { expect(inside(q), `${b === far ? 'far' : 'near'} ${q.map(v => v.toFixed(3))}`).toBe(true); probed++; break; }
        }
      }
      expect(probed).toBeGreaterThan(100);
    }
  });
});
