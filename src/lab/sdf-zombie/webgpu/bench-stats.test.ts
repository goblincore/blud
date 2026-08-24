// src/lab/sdf-zombie/webgpu/bench-stats.test.ts
import { describe, it, expect } from 'vitest';
import { BenchStats } from './bench-stats';

describe('BenchStats', () => {
  it('reports p50/p95/p99 over recorded frame deltas', () => {
    const s = new BenchStats();
    // 100 frames: 99 at 10 ms, one 50 ms spike
    for (let i = 0; i < 99; i++) s.record(10);
    s.record(50);
    const r = s.summary();
    expect(r.n).toBe(100);
    expect(r.p50).toBe(10);
    expect(r.p95).toBe(10);
    expect(r.p99).toBe(50);
  });
  it('drops the warm-up frames', () => {
    const s = new BenchStats({ warmup: 5 });
    for (let i = 0; i < 5; i++) s.record(100); // warm-up junk
    for (let i = 0; i < 10; i++) s.record(10);
    expect(s.summary().n).toBe(10);
    expect(s.summary().p99).toBe(10);
  });
});
