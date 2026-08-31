// src/lab/sdf-zombie/webgpu/game-bench.ts
//
// Runs a Scenario against the page and reports per-segment frame cost.
//
// EVERYTHING THE PAGE CAN DO IS INJECTED (BenchDeps), so the timing logic,
// the segment attribution and the invalid-run detection are all testable
// against a synthetic clock with no GPU in the room.
//
// TWO MODES, AND THEY MUST NOT BE COMPARED TO EACH OTHER.
//
//   throughput — submit a chunk of frames, THEN fence. The queue stays full
//     for all but the chunk's last frame, so the number describes execution
//     rather than submission. This is the mode for every A/B. Its sample is a
//     CHUNK MEAN, so it is blind to spikes by construction: one 200 ms frame
//     in a 20-frame chunk averages down to ~19.5 (there is a test for exactly
//     that, because it is the trap).
//   spike — fence after EVERY frame, so each sample is one real frame. This is
//     the only way to see the blow-ups "stable 30" is actually about. It also
//     drains the queue every frame, which lets the GPU clock down between
//     frames — lab-main measured that route swinging 13/36/21 ms across three
//     runs of one config. So spike absolutes are junk; only the ratios WITHIN
//     one spike run mean anything.
//
// Chunking happens INSIDE a segment, never across one. A chunk that straddled
// the walk/fire boundary would blend a cheap frame into an expensive mean and
// put the cost in the wrong column.

import { actionsAt, segmentAt, type BenchAction, type Scenario } from './game-bench-scenario';

export interface BenchDeps {
  /** Drive exactly one frame at this timestep. */
  step(dtSec: number): void;
  /** Await a real GPU completion fence. */
  resolveGpu(): Promise<void>;
  /** A monotonic clock in milliseconds. */
  now(): number;
  /** Whether the page is currently uncomposited. */
  hidden(): boolean;
  /** Apply one scenario action to the page. */
  perform(action: BenchAction): void;
  /**
   * What is actually on screen right now. Optional, and the single most
   * important field in the result.
   *
   * A perf number without a census is unreadable. The first run of this bench
   * reported the firing segments at ~9 ms against ~40 ms walking and looked
   * like firing was cheap; in fact the shots had shredded every zombie in the
   * room and the cheap segments were timing an empty floor. A census makes
   * that visible in the output instead of leaving it to be discovered.
   */
  census?(): SceneCensus;
}

/** A cheap count of what the frame contained. */
export interface SceneCensus {
  /** Bodies inside the view frustum. */
  bodies: number;
  /** Total wounds carved across all bodies. */
  wounds: number;
  /** Gib chunks in flight. */
  chunks: number;
}

export interface BenchOpts {
  mode: 'throughput' | 'spike';
  /** Frames per fenced chunk. Forced to 1 in spike mode. */
  chunkFrames?: number;
  /** Frames run and discarded before sampling starts. */
  warmup?: number;
  dtSec?: number;
  label?: string;
}

export interface SegmentSummary {
  name: string; n: number;
  p50: number; p95: number; p99: number; max: number; mean: number;
  /** Census at the START and END of the segment, when deps supply one. */
  census?: { first: SceneCensus; last: SceneCensus };
}

export interface BenchResult {
  mode: 'throughput' | 'spike';
  label: string;
  /** False when any frame was stepped while the page was hidden. */
  valid: boolean;
  hiddenSteps: number;
  frames: number;
  chunkFrames: number;
  overall: SegmentSummary;
  segments: SegmentSummary[];
}

export const BENCH_DEFAULTS = {
  chunkFrames: 20,
  warmup: 40,
  dtSec: 1 / 60,
} as const;

/** Percentiles by sorted index — n is small, so nothing cleverer is warranted. */
export function summarise(name: string, samples: number[]): SegmentSummary {
  if (samples.length === 0) {
    return { name, n: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    name,
    n: s.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: s[s.length - 1]!,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

export async function runBench(
  deps: BenchDeps,
  scenario: Scenario,
  opts: BenchOpts,
): Promise<BenchResult> {
  const chunkFrames = opts.mode === 'spike' ? 1 : (opts.chunkFrames ?? BENCH_DEFAULTS.chunkFrames);
  const warmup = opts.warmup ?? BENCH_DEFAULTS.warmup;
  const dt = opts.dtSec ?? BENCH_DEFAULTS.dtSec;

  let hiddenSteps = 0;
  const stepOnce = (frame: number) => {
    if (deps.hidden()) hiddenSteps++;
    for (const a of actionsAt(scenario, frame)) deps.perform(a);
    deps.step(dt);
  };

  // Warmup performs frame 0's actions ONCE up front, so the page is already in
  // the scenario's starting state (right room, wanderers unfrozen) by the time
  // sampling begins. Frame 0's actions run again when the first segment starts;
  // they are idempotent (teleport, freeze), which is why that is harmless.
  for (let i = 0; i < warmup; i++) {
    if (deps.hidden()) hiddenSteps++;
    if (i === 0) for (const a of actionsAt(scenario, 0)) deps.perform(a);
    deps.step(dt);
  }
  await deps.resolveGpu();

  const bySegment = new Map<string, number[]>();
  const censusBySegment = new Map<string, { first: SceneCensus; last: SceneCensus }>();
  const all: number[] = [];
  const record = (name: string, ms: number) => {
    let bucket = bySegment.get(name);
    if (!bucket) { bucket = []; bySegment.set(name, bucket); }
    bucket.push(ms);
    all.push(ms);
  };

  // Chunk WITHIN each segment. A chunk never crosses a boundary.
  for (const seg of scenario.segments) {
    // Census is taken OUTSIDE the timed region, so counting never shows up
    // as cost. Wrapped: a census that throws must not fail a bench.
    const takeCensus = (): SceneCensus | null => {
      if (!deps.census) return null;
      try { return deps.census(); } catch { return null; }
    };
    const firstCensus = takeCensus();
    let f = seg.from;
    while (f < seg.to) {
      const n = Math.min(chunkFrames, seg.to - f);
      const t0 = deps.now();
      for (let i = 0; i < n; i++) stepOnce(f + i);
      await deps.resolveGpu();
      record(seg.name, (deps.now() - t0) / n);
      f += n;
    }
    const lastCensus = takeCensus();
    if (firstCensus && lastCensus) {
      censusBySegment.set(seg.name, { first: firstCensus, last: lastCensus });
    }
  }

  return {
    mode: opts.mode,
    label: opts.label ?? '',
    valid: hiddenSteps === 0,
    hiddenSteps,
    frames: scenario.frames,
    chunkFrames,
    overall: summarise('overall', all),
    segments: scenario.segments.map((s) => {
      const summary = summarise(s.name, bySegment.get(s.name) ?? []);
      const c = censusBySegment.get(s.name);
      return c ? { ...summary, census: c } : summary;
    }),
  };
}

/** Re-exported so the page seam does not need a second import. */
export { segmentAt };
