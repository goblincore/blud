import { describe, expect, it } from 'vitest';
import { buildLightList, type LightSource } from './light-list';
import { pickLights, type Pick } from './light-pick';
import {
  CHUNK_LIST_GAIN, chunkListGainNow, setChunkListGain, chunkListAmbient, chunkPickBody, hasPicks, pickChunk,
} from './chunk-light-pick';

const tube = (x: number, z: number, rooms = [3]): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, z], color: [0.8, 0.9, 1], intensity: 7, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), rooms });

describe('chunk-light-pick (Task 12)', () => {
  it('pick body: the chunk itself is the centre and the feet; facing [0, 0] (orientation-free)', () => {
    const b = chunkPickBody([1, 0.15, -2], 4);
    expect(b.pos).toEqual([1, 0.15, -2]);
    expect(b.feetY).toBe(0.15);
    expect(b.room).toBe(4);
    expect(b.facing).toEqual([0, 0]);
    // rewritten in place: a reused body (an actor's, facing the camera) loses its front
    const reused = { pos: [9, 9, 9] as [number, number, number], feetY: 9, room: 1, facing: [0.6, -0.8] as [number, number] };
    expect(chunkPickBody([1, 0.15, -2], 4, reused)).toBe(reused);
    expect(reused.facing).toEqual([0, 0]);
  });

  it('orientation-free: the same tube on either side of a gib gives the same weight', () => {
    // A light at -z and one at +z (mirror images) weigh the same; with the old facing [0, 1]
    // the -z one took its profile's backKey falloff.
    const w = (z: number) => pickChunk(buildLightList([tube(0, z)]), [0, 0.1, 0], 3).weight[0]!;
    expect(w(-1.2)).toBeGreaterThan(0);
    expect(w(-1.2)).toBeCloseTo(w(1.2), 9);
    expect(pickChunk(buildLightList([tube(1.2, 0)]), [0, 0.1, 0], 3).weight[0]).toBeCloseTo(w(1.2), 9);
  });

  it('per piece: two piles under two tubes pick their own tube, not a centroid between them', () => {
    const list = buildLightList([tube(-4, 0), tube(4, 0)]);
    const out: Pick = { idx: [-1, -1, -1, -1], weight: [0, 0, 0, 0], packed: [-1, -1, -1, -1] };
    const body = chunkPickBody([0, 0, 0], 3);
    const a = pickChunk(list, [-4, 0.1, 0.3], 3, body, out).idx[0];
    const b = pickChunk(list, [4, 0.1, 0.3], 3, body, out).idx[0];
    expect(list[a!]!.pos[0]).toBe(-4);
    expect(list[b!]!.pos[0]).toBe(4);
  });

  it('a gib under a tube picks that tube as its dominant; one under the other tube the other', () => {
    const list = buildLightList([tube(-3, 0), tube(3, 0)]);
    const a = pickChunk(list, [-3, 0.1, 0.2], 3);
    const b = pickChunk(list, [3, 0.1, 0.2], 3);
    expect(list[a.idx[0]!]!.pos[0]).toBe(-3);
    expect(list[b.idx[0]!]!.pos[0]).toBe(3);
    // the same answer as pickLights on the equivalent body
    expect(a.packed).toEqual(pickLights(list, chunkPickBody([-3, 0.1, 0.2], 3)).packed);
  });

  it('room gating: another room -> no picks; room -1 (tunnel) matches every light', () => {
    const list = buildLightList([tube(0, 0, [3])]);
    expect(hasPicks(pickChunk(list, [0, 0.1, 0], 7))).toBe(false);
    expect(hasPicks(pickChunk(list, [0, 0.1, 0], -1))).toBe(true);
  });

  it('ambient: body 0 room factor divided out of the fill, the piece applied; bounce as today', () => {
    // body 0 in a dead room (0.25): its fill 0.05 is 0.2 at full; the piece's room is lit (1)
    expect(chunkListAmbient(0.05, 1, 0.01, 0.25, 1)).toBeCloseTo(0.21, 6);
    expect(chunkListAmbient(0.05, 0.5, 0.02, 0.25, 1)).toBeCloseTo(0.12, 6);
    expect(chunkListAmbient(0.05, 0.25, 0.03, 0.25, 1)).toBeCloseTo(0.08, 6);
    // same room as body 0: exactly today's ambient
    expect(chunkListAmbient(0.05, 1, 0.01, 0.25, 0.25)).toBeCloseTo(0.05 * 1 + 0.01, 6);
    // a zero factor never divides by zero
    expect(Number.isFinite(chunkListAmbient(0.05, 1, 0, 0, 0.5))).toBe(true);
  });

  it('the chunk trim: booted from CHUNK_LIST_GAIN, live-settable, NaN restores it, never negative', () => {
    expect(CHUNK_LIST_GAIN).toBeGreaterThan(0);
    expect(CHUNK_LIST_GAIN).toBeLessThanOrEqual(1);
    expect(chunkListGainNow()).toBe(CHUNK_LIST_GAIN);
    expect(setChunkListGain(0.7)).toBe(0.7);
    expect(chunkListGainNow()).toBe(0.7);
    expect(setChunkListGain(-1)).toBe(0);
    expect(setChunkListGain(Number.NaN)).toBe(CHUNK_LIST_GAIN);
  });
});
