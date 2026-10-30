import { describe, expect, it } from 'vitest';
import { createKeyedPool, meatPoolKey, meatPoolOn } from './meat-pool';

describe('meat pool', () => {
  it('reads the toggle', () => {
    expect(meatPoolOn('')).toBe(true);
    expect(meatPoolOn('?meatpool=0')).toBe(false);
    expect(meatPoolOn('?level=arena&meatpool=1')).toBe(true);
  });
  it('keys by variant, size bucket and material', () => {
    expect(meatPoolKey(3, 0.22, 7)).toBe('3:0.220:7');
    expect(meatPoolKey(3, 0.22000000001, 7)).toBe(meatPoolKey(3, 0.22, 7));
    expect(meatPoolKey(3, 0.24, 7)).not.toBe(meatPoolKey(3, 0.22, 7));
    expect(meatPoolKey(3, 0.22, 8)).not.toBe(meatPoolKey(3, 0.22, 7));
  });
  it('hands back only what it was given, by key', () => {
    const p = createKeyedPool<{ n: number }>();
    expect(p.take('a')).toBeUndefined();
    const a1 = { n: 1 }, a2 = { n: 2 }, b1 = { n: 3 };
    p.adopt('a', a1); p.adopt('a', a2); p.adopt('b', b1);
    expect(p.made('a')).toBe(2);
    expect(p.size).toBe(3);
    expect(p.take('a')).toBeUndefined(); // adopted objects are live, not free
    expect(p.give(a1)).toBe(true);
    expect(p.give(a1)).toBe(false); // already free
    expect(p.free('a')).toBe(1);
    expect(p.take('b')).toBeUndefined();
    expect(p.take('a')).toBe(a1);
    expect(p.free('a')).toBe(0);
    expect(p.give({ n: 9 })).toBe(false); // never adopted
    p.adopt('a', a1); // adopting twice does not double-count
    expect(p.made('a')).toBe(2);
  });
  it('recycles: a capped stream of throws makes no more than the cap', () => {
    const p = createKeyedPool<object>();
    const live: object[] = [];
    for (let i = 0; i < 200; i++) {
      let m = p.take('k');
      if (!m) { m = {}; p.adopt('k', m); }
      live.push(m);
      if (live.length > 16) p.give(live.shift()!);
    }
    expect(p.made('k')).toBe(17);
  });
});
