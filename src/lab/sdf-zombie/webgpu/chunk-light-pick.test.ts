import { describe, expect, it } from 'vitest';
import { buildLightList, type LightSource } from './light-list';
import { pickLights } from './light-pick';
import {
  CHUNK_LIST_GAIN, chunkListGainNow, setChunkListGain, addToCentroid, centroidPos, chunkListAmbient, chunkLightState, chunkPickBody, hasPicks, pickChunk,
  type Centroid, type ChunkLightState,
} from './chunk-light-pick';

const tube = (x: number, z: number, rooms = [3]): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, z], color: [0.8, 0.9, 1], intensity: 7, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), rooms });

describe('chunk-light-pick (Task 12)', () => {
  it('centroid: running sums per key, mean out; empty or absent -> null', () => {
    const acc = new Map<string, Centroid>();
    addToCentroid(acc, 'a', 1, 0, 2);
    addToCentroid(acc, 'a', 3, 2, 4);
    addToCentroid(acc, 'b', -1, 0.1, 5);
    const out: [number, number, number] = [0, 0, 0];
    expect(centroidPos(acc.get('a'), out)).toEqual([2, 1, 3]);
    expect(centroidPos(acc.get('b'), out)).toEqual([-1, 0.1, 5]);
    expect(centroidPos(acc.get('c'), out)).toBeNull();
    expect(centroidPos([0, 0, 0, 0], out)).toBeNull();
  });

  it('pick body: the chunk itself is the centre and the feet; facing [0, 1]', () => {
    const b = chunkPickBody([1, 0.15, -2], 4);
    expect(b.pos).toEqual([1, 0.15, -2]);
    expect(b.feetY).toBe(0.15);
    expect(b.room).toBe(4);
    expect(b.facing).toEqual([0, 1]);
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

  it('state: list off or no pieces -> off with -1s; pieces -> on, with picks or without', () => {
    const list = buildLightList([tube(0, 0, [3])]);
    const s: ChunkLightState = { on: 1, packed: [9, 9, 9, 9] };
    expect(chunkLightState(false, list, [0, 0.1, 0], 3, s)).toEqual({ on: 0, packed: [-1, -1, -1, -1] });
    expect(chunkLightState(true, list, null, 3, s)).toEqual({ on: 0, packed: [-1, -1, -1, -1] });
    const lit = chunkLightState(true, list, [0, 0.1, 0], 3, s);
    expect(lit.on).toBe(1);
    expect(Math.floor(lit.packed[0])).toBe(0);
    expect(lit.packed[0] % 1).toBeGreaterThan(0.5);
    // a gib in a room no light reaches is still list-lit (fill + fresnel), not the old global key
    expect(chunkLightState(true, list, [0, 0.1, 0], 7, s)).toEqual({ on: 1, packed: [-1, -1, -1, -1] });
  });

  it('ambient: body 0 room factor divided out of the fill, the chunks applied; bounce as today', () => {
    const out: [number, number, number] = [0, 0, 0];
    // body 0 in a dead room (0.25): its fill 0.05 is 0.2 at full; the chunks' room is lit (1)
    chunkListAmbient(0.05, [1, 0.5, 0.25], [0.01, 0.02, 0.03], 0.25, 1, out);
    expect(out[0]).toBeCloseTo(0.21, 6);
    expect(out[1]).toBeCloseTo(0.12, 6);
    expect(out[2]).toBeCloseTo(0.08, 6);
    // a dark chunk room darkens only the fill
    // same room as body 0: exactly today's ambient
    chunkListAmbient(0.05, [1, 0.5, 0.25], [0.01, 0.02, 0.03], 0.25, 0.25, out);
    expect(out[0]).toBeCloseTo(0.05 * 1 + 0.01, 6);
    expect(out[2]).toBeCloseTo(0.05 * 0.25 + 0.03, 6);
    // a zero factor never divides by zero
    chunkListAmbient(0.05, [1, 1, 1], [0, 0, 0], 0, 0.5, out);
    expect(Number.isFinite(out[0])).toBe(true);
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
