// src/lab/sdf-zombie/webgpu/bench-stats.ts
//
// Pure frame-time accumulator for the bench page. Wall-clock rAF deltas,
// because GPU timestamps are unreliable across this renderer's multi-pass
// frames (see adaptive-scale.ts header). Percentiles by sorted index —
// n is small (a 15 s orbit at 60 Hz is ~900 samples).
export interface BenchSummary { n: number; p50: number; p95: number; p99: number; mean: number }

export class BenchStats {
  private samples: number[] = [];
  private skip: number;
  constructor(opts: { warmup?: number } = {}) { this.skip = opts.warmup ?? 0; }
  record(deltaMs: number): void {
    if (this.skip > 0) { this.skip--; return; }
    this.samples.push(deltaMs);
  }
  summary(): BenchSummary {
    const s = [...this.samples].sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
    const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), mean };
  }
}
