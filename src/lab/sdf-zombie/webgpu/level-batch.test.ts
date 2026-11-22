import { describe, expect, it } from 'vitest';
import { anySectorSeen, groupByZone, groupPickups, levelBatchOn, packShown, ROW_FLOATS } from './level-batch';

const row = (v: number) => Array.from({ length: ROW_FLOATS }, (_, k) => v * 100 + k);

describe('level-batch', () => {
  it('is on unless ?batch=0', () => {
    expect(levelBatchOn('')).toBe(true);
    expect(levelBatchOn('?level=doom-e1m1&batch=1')).toBe(true);
    expect(levelBatchOn('?batch=0')).toBe(false);
  });

  it('groups pickups by item in first-seen order, file order within', () => {
    const g = groupPickups([
      { id: 'a', item: 'health' }, { id: 'b', item: 'shells' }, { id: 'c', item: 'health' }, { id: 'd', item: 'cd' },
    ]);
    expect(g.map(x => x.item)).toEqual(['health', 'shells', 'cd']);
    expect(g[0]!.members.map(m => m.id)).toEqual(['a', 'c']);
  });

  it('groups barrels by zone in first-seen order', () => {
    expect(groupByZone([{ id: 'b1', zone: 3 }, { id: 'b2', zone: 1 }, { id: 'b3', zone: 3 }])).toEqual([[3, ['b1', 'b3']], [1, ['b2']]]);
  });

  it('packs the shown rows to the front, in order, and reports a change only when rows move', () => {
    const src = new Float32Array([...row(0), ...row(1), ...row(2), ...row(3)]);
    const dst = new Float32Array(4 * ROW_FLOATS);
    const shown = new Set([1, 3]);
    let r = packShown(src, 4, i => shown.has(i), dst);
    expect(r).toEqual({ count: 2, changed: true });
    expect([...dst.slice(0, 16)]).toEqual(row(1));
    expect([...dst.slice(16, 32)]).toEqual(row(3));
    r = packShown(src, 4, i => shown.has(i), dst);
    expect(r).toEqual({ count: 2, changed: false });
    shown.delete(1);   // a pickup taken: row 3 moves to slot 0
    r = packShown(src, 4, i => shown.has(i), dst);
    expect(r).toEqual({ count: 1, changed: true });
    expect([...dst.slice(0, 16)]).toEqual(row(3));
    expect(packShown(src, 4, () => false, dst)).toEqual({ count: 0, changed: false });
  });

  it('a thing over no sector is never culled; otherwise any seen sector shows it', () => {
    const seen = new Uint8Array([0, 1, 0]);
    expect(anySectorSeen([], seen)).toBe(true);
    expect(anySectorSeen([0, 2], seen)).toBe(false);
    expect(anySectorSeen([0, 1], seen)).toBe(true);
  });
});
