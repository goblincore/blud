import { describe, expect, it } from 'vitest';
import { BARREL, barrelCentre, catchBlast, chainDelay, hitBarrel, makeBarrels, segmentHitsBarrel, stepBarrels } from './barrel-state';

const two = () => makeBarrels([{ id: 'b1', pos: [0, 0, 0] }, { id: 'b2', pos: [1.1, 0, 0] }, { id: 'b3', pos: [9, 0, 0] }]);

describe('barrels', () => {
  it('hits take HP; at 0 the barrel is lit with no delay and goes up on the next step', () => {
    let [b] = two();
    b = hitBarrel(b!, 'pellet'); expect(b.hp).toBe(BARREL.hp - BARREL.damage.pellet); expect(b.phase).toBe('intact');
    b = hitBarrel(b, 'slug'); expect(b.phase).toBe('lit'); expect(b.fuse).toBe(0);
    const s = stepBarrels([b], 1 / 60);
    expect(s.detonations).toEqual([{ id: 'b1', at: barrelCentre(b) }]);
    expect(s.barrels[0]!.phase).toBe('gone');
    expect(hitBarrel(s.barrels[0]!, 'slug')).toBe(s.barrels[0]);              // a gone barrel ignores hits
  });
  it('a blast lights barrels in reach after 0.1–0.3 s, deterministically; far ones stay', () => {
    const lit = catchBlast(two(), barrelCentre(two()[0]!), 1);
    expect(lit[0]!.phase).toBe('lit'); expect(lit[1]!.phase).toBe('lit'); expect(lit[2]!.phase).toBe('intact');
    for (const b of lit.slice(0, 2)) { expect(b.fuse).toBeGreaterThanOrEqual(0.1); expect(b.fuse).toBeLessThanOrEqual(0.3); }
    expect(lit[1]!.fuse).toBe(chainDelay('b2', 1));
    expect(catchBlast(two(), [0, 0.5, 0], 1)).toEqual(lit);
  });
  it('reaches 4.5 m centre to centre (E1M1 b48–b50 are 4.3 m apart), not further', () => {
    const at = (x: number) => makeBarrels([{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [x, 0, 0] }]);
    expect(BARREL.catchRadiusM).toBe(4.5);
    expect(catchBlast(at(4.3), barrelCentre(at(4.3)[0]!), 1)[1]!.phase).toBe('lit');
    expect(catchBlast(at(4.5), barrelCentre(at(4.5)[0]!), 1)[1]!.phase).toBe('lit');
    expect(catchBlast(at(4.51), barrelCentre(at(4.51)[0]!), 1)[1]!.phase).toBe('intact');
    const up = makeBarrels([{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [4.3, 1.5, 0] }]);   // 3D: √(4.3² + 1.5²) ≈ 4.55
    expect(catchBlast(up, barrelCentre(up[0]!), 1)[1]!.phase).toBe('intact');
  });
  it('a second blast keeps a lit barrel\'s fuse and leaves a gone barrel gone', () => {
    const first = catchBlast(two(), [0, 0.5, 0], 1);
    const again = catchBlast(first, [0, 0.5, 0], 2);
    expect(again[0]!.fuse).toBe(first[0]!.fuse); expect(again[0]!.phase).toBe('lit');
    expect(again[0]).toBe(first[0]);
    const gone = stepBarrels([hitBarrel(two()[0]!, 'slug')], 1 / 60).barrels;
    const after = catchBlast(gone, [0, 0.5, 0], 3);
    expect(after[0]!.phase).toBe('gone'); expect(after[0]).toBe(gone[0]);
  });
  it('a shielded barrel does not catch', () => {
    const lit = catchBlast(two(), [0, 0.5, 0], 1, (_a, b) => b[0] > 1);
    expect(lit[1]!.phase).toBe('intact');
  });
  it('a chain ripples: b1 goes up, b2 a delay later', () => {
    let bs = two().map((b, i) => (i === 0 ? hitBarrel(b, 'slug') : b));
    let t = 0; const log: [string, number][] = []; let blast = 0;
    for (let i = 0; i < 60; i++) {
      t += 1 / 60;
      const s = stepBarrels(bs, 1 / 60); bs = s.barrels;
      for (const d of s.detonations) { log.push([d.id, t]); bs = catchBlast(bs, d.at, ++blast); }
    }
    expect(log.map((l) => l[0])).toEqual(['b1', 'b2']);
    expect(log[1]![1] - log[0]![1]).toBeGreaterThanOrEqual(0.1 - 1 / 60);
    expect(log[1]![1] - log[0]![1]).toBeLessThanOrEqual(0.3 + 1 / 60);
  });
  it('segment vs drum: side, over the top, down into the lid, short', () => {
    const [b] = two();
    expect(segmentHitsBarrel([-2, 0.5, 0], [2, 0.5, 0], b!)).toBeCloseTo((2 - BARREL.radiusM) / 4, 9);
    expect(segmentHitsBarrel([-2, 1.2, 0], [2, 1.2, 0], b!)).toBeNull();
    expect(segmentHitsBarrel([0, 2, 0], [0, 0.5, 0], b!)).toBeCloseTo((2 - BARREL.heightM) / 1.5, 9);
    expect(segmentHitsBarrel([-2, 0.5, 0], [-1, 0.5, 0], b!)).toBeNull();
    expect(segmentHitsBarrel([0, 0.5, 0], [2, 0.5, 0], b!)).toBe(0);           // starts inside
  });
});
