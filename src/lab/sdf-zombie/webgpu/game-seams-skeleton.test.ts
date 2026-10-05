// src/lab/sdf-zombie/webgpu/game-seams-skeleton.test.ts
//
// The split skull's two seams against the real segment mesh renderer: what they set, and what they refuse.
import { describe, expect, it } from 'vitest';
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
  it('lists the copies by piece (bone or eye) and counts the actor\'s draws; a closed head has none; null without the renderer or the actor', () => {
    const a = { id: 7 }, b = { id: 8 };
    const draw = (owner: unknown, eye: boolean, piece: 0 | 1 | 2 | null) => ({ owner, eye, piece });
    const drawn = [draw(a, false, null), draw(a, false, 0), draw(a, false, 1), draw(a, false, 2), draw(a, true, 1), draw(a, true, 2), draw(b, false, null), draw(b, true, null)];
    const seams = createSkeletonSeams({ world: { actors: [a, b] }, render: { segMeshRenderer: { drawn } } } as unknown as GameContext);
    expect(seams.skullDrawn(7)).toEqual({ draws: 6, copies: [{ eye: false, piece: 0 }, { eye: false, piece: 1 }, { eye: false, piece: 2 }, { eye: true, piece: 1 }, { eye: true, piece: 2 }] });
    expect(seams.skullDrawn(8)).toEqual({ draws: 2, copies: [] });
    expect(seams.skullDrawn(9)).toBeNull();
    expect(createSkeletonSeams({ world: { actors: [a] }, render: { segMeshRenderer: null } } as unknown as GameContext).skullDrawn(7)).toBeNull();
  });
});
