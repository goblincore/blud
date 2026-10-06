// src/lab/sdf-zombie/webgpu/game-seams-skeleton.test.ts
//
// The split skull's two seams against the real segment mesh renderer: what they set, and what they refuse.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { HEAD_SPLIT } from '../head-split';
import type { GameContext } from './game-context';
import { createSkeletonSeams } from './game-seams-skeleton';
import { SegmentMeshCache } from './skeleton-spike/mesh';
import { createSegmentMeshRenderer } from './skeleton-spike/mesh-renderer';

const make = (withRenderer = true) => {
  const cache = new SegmentMeshCache();
  const renderer = withRenderer ? createSegmentMeshRenderer(cache) : null;
  const seams = createSkeletonSeams({ render: { segMeshRenderer: renderer } } as unknown as GameContext);
  return { seams, renderer, done: () => { renderer?.dispose(); cache.dispose(); } };
};
const J = HEAD_SPLIT.skull.jag;

describe('__sdfGame.skullSplit: the split skull\'s look, live', () => {
  it('reads the values in force; null without the mesh skeleton', () => {
    const { seams, done } = make();
    expect(seams.skullSplit()).toEqual({
      follow: null, zigAmp: J.zigAmp, zigLen: J.zigLen, chipAmp: J.chipAmp, chipLen: J.chipLen,
      wobble: J.wobble, wobbleAlong: J.wobbleAlong, wobbleUp: J.wobbleUp, upFreq: J.upFreq,
      inside: HEAD_SPLIT.skull.inside.map(v => expect.closeTo(v, 6)),
      rim: [...HEAD_SPLIT.skull.rim.color], rimWidth: HEAD_SPLIT.skull.rim.width,
    });
    done();
    expect(make(false).seams.skullSplit({ follow: 1 })).toBeNull();
  });
  it('sets what it is given and leaves the rest: a share, a table, the table back; the fracture; the wall and rim', () => {
    const { seams, renderer, done } = make();
    expect((seams.skullSplit({ follow: 0.5, zigAmp: 0.008 }) as { follow: unknown }).follow).toBe(0.5);
    expect(renderer!.splitLook.follow).toBe(0.5);
    expect(renderer!.splitLook.jag.value.toArray()).toEqual([0.008, J.zigLen, J.chipAmp, J.chipLen]);
    const table = [[0.55, 0.2], [1, 0.9]] as const;
    seams.skullSplit({ follow: table });
    expect(renderer!.splitLook.follow).toBe(table);
    expect(renderer!.splitLook.jag.value.x).toBe(0.008);   // untouched by a later set
    seams.skullSplit({ follow: null, wobbleAlong: 0, upFreq: 1.1 });
    expect(renderer!.splitLook.follow).toBeNull();
    expect(renderer!.splitLook.jagShape.value.toArray()).toEqual([J.wobble, 0, J.wobbleUp, 1.1]);
    const out = seams.skullSplit({ inside: [0, 1, 0], rim: [1, 0, 0], rimWidth: 0 }) as { inside: number[]; rim: number[]; rimWidth: number };
    expect([out.inside, out.rim, out.rimWidth]).toEqual([[0, 1, 0], [1, 0, 0], 0]);
    done();
  });
  it('refuses a set with anything that is not finite, whole: false, and nothing changes', () => {
    const { seams, done } = make();
    const before = seams.skullSplit();
    for (const bad of [
      { follow: NaN }, { follow: Infinity }, { follow: '1' }, { follow: [] }, { follow: [[0.8, 0.1], [0.5, 0.3]] }, { follow: [[0.5, NaN]] },
      { zigAmp: NaN }, { zigAmp: 0.008, chipLen: Infinity }, { wobble: '0.4' }, { rimWidth: NaN },
      { inside: [0, 1] }, { rim: [0, NaN, 0] }, { follow: 0.5, upFreq: NaN }, null, 3,
    ]) {
      expect(seams.skullSplit(bad as never), JSON.stringify(bad)).toBe(false);
      expect(seams.skullSplit()).toEqual(before);
    }
    done();
  });
});

describe('__sdfGame.meshSkeletonShow: draw or hide the bone meshes and the eyes', () => {
  it('reads and sets the two flags; refuses what is not a boolean; null without the mesh skeleton', () => {
    const { seams, renderer, done } = make();
    expect(seams.meshSkeletonShow()).toEqual({ bones: true, eyes: true });
    expect(seams.meshSkeletonShow({ eyes: false })).toEqual({ bones: true, eyes: false });
    expect(renderer!.show).toEqual({ bones: true, eyes: false });
    expect(seams.meshSkeletonShow({ bones: false, eyes: true })).toEqual({ bones: false, eyes: true });
    for (const bad of [{ bones: 0 }, { eyes: 'no' }, { bones: true, eyes: null }, null, 1]) {
      expect(seams.meshSkeletonShow(bad as never), JSON.stringify(bad)).toBe(false);
      expect(renderer!.show).toEqual({ bones: false, eyes: true });
    }
    done();
    expect(make(false).seams.meshSkeletonShow({ bones: false })).toBeNull();
  });
});

describe('__sdfGame.skullDrawn: an actor\'s split skull copies among this frame\'s bone draws', () => {
  // The renderer's batches as the seam reads them: one mesh a geometry, on a named material.
  const geo = (position: object = {}) => ({ getAttribute: (name: string) => (name === 'position' ? position : undefined) });
  const M = new THREE.Matrix4().makeTranslation(1, 2, 3), m = M.toArray();
  it('lists the copies by piece (bone or eye) and counts the actor\'s draws; a closed head has none; null without the renderer or the actor', () => {
    const a = { id: 7 }, b = { id: 8 };
    const bone = geo(), boneSplit = geo(), eye = geo(), eyeSplit = geo();
    const draw = (owner: unknown, geometry: unknown, piece: 0 | 1 | 2 | null) => ({ owner, eye: geometry === eye || geometry === eyeSplit, piece, matrix: M, geometry });
    const drawn = [draw(a, bone, null), draw(a, boneSplit, 0), draw(a, boneSplit, 1), draw(a, boneSplit, 2), draw(a, eyeSplit, 1), draw(a, eyeSplit, 2), draw(b, bone, null), draw(b, eye, null)];
    const children = [[bone, 'skeleton-bone'], [boneSplit, 'skeleton-bone-split'], [eye, 'skeleton-eye'], [eyeSplit, 'skeleton-eye-split']].map(([geometry, name]) => ({ geometry, material: { name } }));
    const seams = createSkeletonSeams({ world: { actors: [a, b] }, render: { segMeshRenderer: { drawn, object: { children } }, skeletonSources: new Map() } } as unknown as GameContext);
    const row = (eyeRow: boolean, piece: number | null, material: string) => ({ eye: eyeRow, piece, matrix: m, material, plate: null });
    expect(seams.skullDrawn(7)).toEqual({
      draws: 6,
      copies: [row(false, 0, 'skeleton-bone-split'), row(false, 1, 'skeleton-bone-split'), row(false, 2, 'skeleton-bone-split'), row(true, 1, 'skeleton-eye-split'), row(true, 2, 'skeleton-eye-split')],
      whole: [row(false, null, 'skeleton-bone')],
    });
    expect(seams.skullDrawn(8)).toEqual({ draws: 2, copies: [], whole: [row(false, null, 'skeleton-bone'), row(true, null, 'skeleton-eye')] });
    expect(seams.skullDrawn(9)).toBeNull();
    expect(createSkeletonSeams({ world: { actors: [a] }, render: { segMeshRenderer: null } } as unknown as GameContext).skullDrawn(7)).toBeNull();
  });
  it('names the plate of each bone drawn plate by plate, closed or as its twin\'s copy; the whole skull and an eye have none', () => {
    const a = { id: 7 }, head = { segment: 'head' };
    // A plate's split twin has a geometry of its own on the plate's position attribute.
    const frontalAt = {}, mandibleAt = {};
    const frontal = geo(frontalAt), mandible = geo(mandibleAt), mandibleTwin = geo(mandibleAt), merged = geo(), eye = geo();
    const pieces = [{ id: 'frontal', geometry: frontal }, { id: 'mandible', geometry: mandible }];
    const draw = (geometry: unknown, piece: 0 | 1 | 2 | null) => ({ owner: a, eye: geometry === eye, piece, matrix: M, geometry });
    const drawn = [draw(frontal, null), draw(mandibleTwin, 0), draw(mandibleTwin, 2), draw(merged, null), draw(eye, null)];
    const children = [[frontal, 'skeleton-plate'], [mandibleTwin, 'skeleton-plate-split'], [eye, 'skeleton-eye']].map(([geometry, name]) => ({ geometry, material: { name } }));
    const seams = createSkeletonSeams({
      world: { actors: [a] },
      render: { segMeshRenderer: { drawn, object: { children } }, segMeshCache: { skullKit: { head: () => ({ pieces }) } }, skeletonSources: new Map([[a, { sources: [head] }]]) },
    } as unknown as GameContext);
    const out = seams.skullDrawn(7)!;
    expect(out.copies.map(c => [c.plate, c.piece, c.material])).toEqual([['mandible', 0, 'skeleton-plate-split'], ['mandible', 2, 'skeleton-plate-split']]);
    // A geometry no batch draws (none here for the merged skull) has no material to name.
    expect(out.whole.map(c => [c.plate, c.eye, c.material])).toEqual([['frontal', false, 'skeleton-plate'], [null, false, null], [null, true, 'skeleton-eye']]);
  });
});

describe('__sdfGame.skullPlates / skullFragments: the anatomical skull\'s plates and the fragments in flight', () => {
  it('lists each fitted plate\'s pivot in the head segment\'s frame; null without the kit, the actor or its head', () => {
    const a = { id: 7 }, b = { id: 8 }, head = { segment: 'head' }, spine = { segment: 'axial:x-y' };
    const pieces = [{ id: 'frontal', pivot: [0, 0.1, 0.06], min: [-0.05, 0.07, 0.03], max: [0.05, 0.17, 0.09] }, { id: 'mandible', pivot: [0, 0.02, 0.05], min: [-0.05, -0.02, 0.01], max: [0.05, 0.07, 0.09] }];
    const asked: unknown[] = [];
    const ctx = (kit: unknown) => ({
      world: { actors: [a, b] },
      render: { segMeshCache: kit ? { skullKit: kit } : {}, skeletonSources: new Map<unknown, unknown>([[a, { sources: [spine, head] }], [b, { sources: [spine] }]]) },
    }) as unknown as GameContext;
    const seams = createSkeletonSeams(ctx({ head: (s: unknown) => { asked.push(s); return { pieces }; } }));
    expect(seams.skullPlates(7)).toEqual(pieces);
    expect(asked).toEqual([head]);
    // Copies: the caller cannot move the kit's own pivot or box.
    for (const k of ['pivot', 'min', 'max'] as const) expect(seams.skullPlates(7)![0]![k]).not.toBe(pieces[0]![k]);
    expect(seams.skullPlates(8)).toBeNull();   // no head segment
    expect(seams.skullPlates(9)).toBeNull();   // no such actor
    expect(createSkeletonSeams(ctx(null)).skullPlates(7)).toBeNull();   // ?skull=sculpt
    expect(createSkeletonSeams(ctx({ head: () => null })).skullPlates(7)).toBeNull();   // a head the kit does not fit
  });
  it('skullShot hands one round\'s ray to the renderer\'s fractureSkull with the actor\'s sources; refuses a ray or a round that is not one', () => {
    const a = { id: 7 }, sources = [{ segment: 'head' }];
    const calls: unknown[][] = [];
    const renderer = { fractureSkull: (...args: unknown[]) => { calls.push(args); return 1; } };
    const seams = createSkeletonSeams({ world: { actors: [a] }, render: { segMeshRenderer: renderer, skeletonSources: new Map([[a, { sources }]]) } } as unknown as GameContext);
    expect(seams.skullShot(7, [1, 2, 3], [0, 0, -1])).toBe(1);
    expect(seams.skullShot(7, [1, 2, 3], [0, 0, -1], 'slug')).toBe(1);
    expect(calls).toEqual([[a, sources, [1, 2, 3], [0, 0, -1], 'pellet'], [a, sources, [1, 2, 3], [0, 0, -1], 'slug']]);
    for (const bad of [[[1, 2], [0, 0, -1]], [[1, 2, NaN], [0, 0, -1]], [[1, 2, 3], '0,0,-1'], [[1, 2, 3], [0, 0, -1], 'axe']]) {
      expect((seams.skullShot as (...args: unknown[]) => unknown)(7, ...bad), JSON.stringify(bad)).toBe(false);
    }
    expect(calls).toHaveLength(2);
    expect(seams.skullShot(9, [1, 2, 3], [0, 0, -1])).toBeNull();   // no such actor
    expect(createSkeletonSeams({ world: { actors: [a] }, render: { segMeshRenderer: null } } as unknown as GameContext).skullShot(7, [1, 2, 3], [0, 0, -1])).toBeNull();
  });
  it('lists the skull fragments among the mesh gibs, oldest first, by plate', () => {
    const gib = (tag: string, name: string, pos: number[], vel: number[]) => ({ tag, object: { name }, state: { pos, vel } });
    const meshGibs = [gib('skull', 'skull-fragment:frontal', [1, 2, 3], [0, 4, 0]), gib('brain', 'brain', [5, 5, 5], [0, 0, 0]), gib('skull', 'skull-fragment:parietal-left', [2, 2, 2], [1, 1, 1])];
    const seams = createSkeletonSeams({ gibs: { meshGibs } } as unknown as GameContext);
    expect(seams.skullFragments()).toEqual([
      { plate: 'frontal', pos: [1, 2, 3], vel: [0, 4, 0] }, { plate: 'parietal-left', pos: [2, 2, 2], vel: [1, 1, 1] },
    ]);
    expect(seams.skullFragments()[0]!.pos).not.toBe(meshGibs[0]!.state.pos);
  });
});
