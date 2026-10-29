import { describe, expect, it } from 'vitest';
import { createGoreQueue, goreSpreadOn, warmRng } from './gore-spread';

describe('gore-spread', () => {
  it('is on unless ?gorespread=0', () => {
    expect(goreSpreadOn('')).toBe(true);
    expect(goreSpreadOn('?level=arena')).toBe(true);
    expect(goreSpreadOn('?gorespread=1')).toBe(true);
    expect(goreSpreadOn('?level=arena&gorespread=0')).toBe(false);
  });

  it('never runs a job in the frame that queued it', () => {
    const q = createGoreQueue<string>();
    const ran: string[] = [];
    q.push(5, 'a');
    expect(q.drain(5, 10, j => ran.push(j))).toBe(0);
    expect(q.drain(6, 10, j => ran.push(j))).toBe(1);
    expect(ran).toEqual(['a']);
    expect(q.size).toBe(0);
  });

  it('runs oldest first, at most budget a drain, and leaves this frame\'s jobs', () => {
    const q = createGoreQueue<number>();
    for (let i = 0; i < 20; i++) q.push(1, i);
    q.push(3, 100);
    const ran: number[] = [];
    expect(q.drain(2, 8, j => ran.push(j))).toBe(8);
    expect(q.drain(3, 8, j => ran.push(j))).toBe(8);
    expect(q.drain(3, 8, j => ran.push(j))).toBe(4);   // 100 was queued on frame 3: not yet
    expect(ran).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(q.drain(4, 8, j => ran.push(j))).toBe(1);
    expect(ran.at(-1)).toBe(100);
  });

  it('drops a job that throws and keeps the rest', () => {
    const q = createGoreQueue<number>();
    q.push(0, 1); q.push(0, 2);
    expect(() => q.drain(1, 8, j => { if (j === 1) throw new Error('boom'); })).toThrow('boom');
    const ran: number[] = [];
    q.drain(1, 8, j => ran.push(j));
    expect(ran).toEqual([2]);
  });

  it('clear drops everything', () => {
    const q = createGoreQueue<number>();
    q.push(0, 1);
    q.clear();
    expect(q.size).toBe(0);
    expect(q.drain(9, 8, () => { throw new Error('ran'); })).toBe(0);
  });

  it('warmRng is deterministic and in [0, 1)', () => {
    const a = warmRng(7), b = warmRng(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
