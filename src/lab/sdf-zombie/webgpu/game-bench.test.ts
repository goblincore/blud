import { describe, it, expect } from 'vitest';
import { runBench, summarise, type BenchDeps } from './game-bench';
import { buildFirefight, type BenchAction } from './game-bench-scenario';

/** A fake page: a synthetic clock that charges a per-segment cost per frame. */
function fakeDeps(costPerFrame: (frame: number) => number, opts: {
  hiddenFrom?: number;
} = {}) {
  let t = 0;
  let frame = 0;
  const performed: BenchAction[] = [];
  const deps: BenchDeps = {
    step() { t += costPerFrame(frame); frame++; },
    async resolveGpu() { /* fence is free in the fake */ },
    now: () => t,
    hidden: () => opts.hiddenFrom !== undefined && frame >= opts.hiddenFrom,
    perform(a) { performed.push(a); },
  };
  return { deps, performed, frames: () => frame };
}

describe('summarise', () => {
  it('reports percentiles and the max', () => {
    const s = summarise('x', [1, 2, 3, 4, 100]);
    expect(s.n).toBe(5);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(3);
    expect(s.mean).toBeCloseTo(22, 5);
  });

  it('survives an empty sample set instead of returning NaN', () => {
    const s = summarise('x', []);
    expect(s).toEqual({ name: 'x', n: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 });
  });
});

describe('runBench throughput', () => {
  it('steps every frame of the scenario exactly once', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 40, fireFrames: 40, gibFrames: 40 });
    const { deps, frames } = fakeDeps(() => 10);
    await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(frames()).toBe(120);
  });

  it('performs each scheduled action once', async () => {
    const scenario = buildFirefight({ room: 2, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps, performed } = fakeDeps(() => 10);
    await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(performed).toContainEqual({ kind: 'teleport', room: 2 });
    expect(performed.filter(a => a.kind === 'fireSlug')).toHaveLength(1);
  });

  it('attributes cost to the right segment', async () => {
    // walk frames cost 10, fire 20, gib 40.
    const scenario = buildFirefight({ room: 4, walkFrames: 40, fireFrames: 40, gibFrames: 40 });
    const { deps } = fakeDeps(f => (f < 40 ? 10 : f < 80 ? 20 : 40));
    const r = await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    const seg = (n: string) => r.segments.find(s => s.name === n)!;
    expect(seg('walk').p50).toBeCloseTo(10, 5);
    expect(seg('fire').p50).toBeCloseTo(20, 5);
    expect(seg('gib').p50).toBeCloseTo(40, 5);
  });

  it('does not let a chunk straddle two segments', async () => {
    // 25 walk frames with chunkFrames 10 would straddle at frame 20 if the
    // driver chunked globally. Each segment must chunk within itself.
    const scenario = buildFirefight({ room: 4, walkFrames: 25, fireFrames: 25, gibFrames: 25 });
    const { deps } = fakeDeps(f => (f < 25 ? 10 : f < 50 ? 20 : 40));
    const r = await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(r.segments.find(s => s.name === 'walk')!.max).toBeCloseTo(10, 5);
    expect(r.segments.find(s => s.name === 'fire')!.max).toBeCloseTo(20, 5);
  });

  it('marks the run invalid when any frame was stepped while hidden', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps } = fakeDeps(() => 10, { hiddenFrom: 30 });
    const r = await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(r.hiddenSteps).toBeGreaterThan(0);
    expect(r.valid).toBe(false);
  });

  it('discards warmup frames from the samples', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps, frames } = fakeDeps(() => 10);
    await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 15 });
    expect(frames()).toBe(75); // 15 warmup + 60 scenario
  });
});

describe('runBench spike mode', () => {
  it('samples one frame at a time, so a single spike survives', async () => {
    // One 200 ms frame inside an otherwise 10 ms run. A 20-frame chunk mean
    // would dilute it to ~19.5; spike mode must report it whole.
    const scenario = buildFirefight({ room: 4, walkFrames: 60, fireFrames: 20, gibFrames: 20 });
    const { deps } = fakeDeps(f => (f === 33 ? 200 : 10));
    const r = await runBench(deps, scenario, { mode: 'spike', warmup: 0 });
    expect(r.chunkFrames).toBe(1);
    expect(r.overall.max).toBeCloseTo(200, 5);
    expect(r.segments.find(s => s.name === 'walk')!.max).toBeCloseTo(200, 5);
  });

  it('is exactly the spike a chunked run would have hidden', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 60, fireFrames: 20, gibFrames: 20 });
    const cost = (f: number) => (f === 33 ? 200 : 10);
    const chunked = await runBench(fakeDeps(cost).deps, scenario, {
      mode: 'throughput', chunkFrames: 20, warmup: 0,
    });
    const spiked = await runBench(fakeDeps(cost).deps, scenario, { mode: 'spike', warmup: 0 });
    expect(chunked.overall.max).toBeLessThan(30);
    expect(spiked.overall.max).toBeCloseTo(200, 5);
  });
});

describe('runBench passes', () => {
  it('sums per-pass samples by label per frame, per segment and overall, largest first', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps } = fakeDeps(() => 10);
    // The fake page records two labels per stepped frame; the bench drains
    // them after each chunk. Frame numbering is the fake's own counter.
    let frame = 0;
    const pending: { frame: number; label: string; kind: 'render' | 'compute'; ms: number }[] = [];
    const step = deps.step;
    deps.step = (dt) => {
      frame++;
      pending.push({ frame, label: 'sdf:march', kind: 'render', ms: 6 });
      pending.push({ frame, label: 'post:blit', kind: 'render', ms: 1 });
      pending.push({ frame, label: 'compute:tile-bin', kind: 'compute', ms: 0.5 });
      step(dt);
    };
    deps.passTimings = async () => pending.splice(0);
    const r = await runBench(deps, scenario, { mode: 'passes', chunkFrames: 10, warmup: 5 });
    expect(r.mode).toBe('passes');
    expect(r.passes?.available).toBe(true);
    // Warmup samples were drained and discarded: only the 60 scenario frames count.
    expect(r.passes?.overall.frames).toBe(60);
    expect(Object.keys(r.passes!.overall.labels)).toEqual(['sdf:march', 'post:blit', 'compute:tile-bin']);
    expect(r.passes!.overall.labels['sdf:march']!.p50).toBe(6);
    expect(r.passes!.overall.labels['sdf:march']!.n).toBe(60);
    const walk = r.passes!.segments.find((s) => s.name === 'walk')!;
    expect(walk.frames).toBe(20);
    expect(walk.labels['post:blit']!.mean).toBe(1);
    // Frame timing still reported exactly as throughput would.
    expect(r.overall.p50).toBe(10);
  });

  it('folds per-frame CPU labels from stepTimed into the same tables', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 10, fireFrames: 10, gibFrames: 10 });
    const { deps } = fakeDeps(() => 10);
    const step = deps.step;
    deps.stepTimed = (dt) => { step(dt); return { 'cpu:tick': 7, 'cpu:draw': 2, 'cpu:phase:goo-sync': 3 }; };
    deps.passTimings = async () => [];
    const r = await runBench(deps, scenario, { mode: 'passes', chunkFrames: 10, warmup: 0 });
    expect(r.passes!.overall.labels['cpu:tick']!.p50).toBe(7);
    expect(r.passes!.overall.labels['cpu:tick']!.n).toBe(30);
    expect(r.passes!.segments.find((s) => s.name === 'fire')!.labels['cpu:phase:goo-sync']!.mean).toBe(3);
  });

  it('reports unavailable, not zeros, when the page has no pass timings', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 10, fireFrames: 10, gibFrames: 10 });
    const { deps } = fakeDeps(() => 10);
    const r = await runBench(deps, scenario, { mode: 'passes', chunkFrames: 10, warmup: 0 });
    expect(r.passes?.available).toBe(false);
    expect(r.passes?.overall.labels).toEqual({});
  });
});
