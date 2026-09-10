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
import { aggregatePassSamples, attributePassSamples, type PassSample } from './gpu-pass-timing';

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
  /**
   * Drain the per-pass GPU timestamps recorded since the last call (see
   * gpu-pass-timing.ts). Only the 'passes' mode calls it, once per fenced
   * chunk, so the samples cover exactly that chunk's frames. Optional: a page
   * without timestamp tracking runs 'passes' as plain throughput and reports
   * an empty pass table rather than zeros.
   */
  passTimings?(): Promise<PassSample[]>;
  /**
   * Drive one frame like step(), returning per-frame CPU ms by label
   * ('cpu:tick', 'cpu:draw', and any 'cpu:phase:*' the page measures).
   * Only the 'passes' mode uses it; the labels land in the same per-segment
   * tables as the GPU passes so CPU and GPU can be read side by side.
   */
  stepTimed?(dtSec: number): Record<string, number>;
  /**
   * THE FRAME HASH AT THE END OF THE LEG (deterministic demo recordings stage
   * 2, 2026-09-10). Optional, and called ONCE per leg AFTER the timed loop, so
   * it cannot contaminate a timing sample: a hash is a ~1M-float readback plus
   * a digest — tens of milliseconds of work that would be visible inside a
   * 17 ms frame.
   *
   * It is the frame-level companion to `census`. The census counts what the page
   * CONTAINS (bodies, droplets, goo quads); this digests what the page RENDERS.
   * The census cannot see a zeroed probe layer or a mistranscribed shader — both
   * shipped on 2026-09-10 and were caught by playtesting, not by a gate — and
   * the hash cannot see a droplet count that changed without changing a pixel.
   * Two repeats of one leg that hash differently were never measuring one
   * workload, whatever the census says.
   */
  endHash?(): Promise<import('./frame-hash').FrameHash>;
}

/** A cheap count of what the frame contained. */
export interface SceneCensus {
  /** Bodies inside the view frustum. */
  bodies: number;
  /** Total wounds carved across all bodies. */
  wounds: number;
  /** Gib chunks in flight. */
  chunks: number;
  /** Blood sim droplets alive (all kinds). */
  droplets?: number;
  /** Persistent floor splats. */
  splats?: number;
  /** Density quads the goo layer posed last frame (its live fill). */
  gooQuads?: number;
}

export type BenchMode = 'throughput' | 'spike' | 'passes';

export interface BenchOpts {
  /**
   * 'passes' is throughput's fence-per-chunk timing PLUS a per-pass GPU
   * timestamp table: after each chunk's fence the page's timestamp pools are
   * drained and every frame's passes are summed by label. Its frame numbers
   * are comparable to throughput's (same fencing); its pass numbers are GPU
   * pass durations, which exclude CPU submit and inter-pass gaps, so they
   * add up to LESS than the fenced frame. Read the pass table for SHARES.
   */
  mode: BenchMode;
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

/** Per-pass GPU time for one segment: label -> summary over that segment's
 *  frames (one sample per frame per label). */
export interface PassSegmentSummary {
  name: string;
  /** Frames that contributed pass samples. */
  frames: number;
  /** EXCLUSIVE ms per label (attributePassSamples): completion-order
   *  charges that partition the frame's GPU span. THE number to read. */
  labels: Record<string, SegmentSummary>;
  /** Wall ms per label (pass end minus start). Overlapping passes make
   *  these sum past the frame; kept for the overlap it reveals. */
  wall: Record<string, SegmentSummary>;
  /** The frame's GPU span, first pass start to last pass end. */
  span: SegmentSummary;
}

export interface PassReport {
  /** False when the page recorded no pass samples at all (no timestamp
   *  tracking, or the install did not take) — the table is then empty. */
  available: boolean;
  overall: PassSegmentSummary;
  segments: PassSegmentSummary[];
}

export interface BenchResult {
  mode: BenchMode;
  label: string;
  /** Frame hash of the leg's ENDING state, when the page supplies one. Compare
   *  ACROSS REPEATS of the same leg: two repeats that hash differently were not
   *  running the same frame, so no delta between them is attributable. See
   *  BenchDeps.endHash. */
  endHash?: import('./frame-hash').FrameHash;
  /** False when any frame was stepped while the page was hidden. */
  valid: boolean;
  hiddenSteps: number;
  frames: number;
  chunkFrames: number;
  overall: SegmentSummary;
  segments: SegmentSummary[];
  /** Only in 'passes' mode. */
  passes?: PassReport;
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
  const cpuTimed = opts.mode === 'passes' && typeof deps.stepTimed === 'function';
  const cpuBySegment = new Map<string, Map<string, number[]>>();
  const cpuAll = new Map<string, number[]>();
  const pushCpu = (m: Map<string, number[]>, label: string, ms: number) => {
    let a = m.get(label); if (!a) { a = []; m.set(label, a); } a.push(ms);
  };
  let currentSeg = '';
  const stepOnce = (frame: number) => {
    if (deps.hidden()) hiddenSteps++;
    for (const a of actionsAt(scenario, frame)) deps.perform(a);
    if (cpuTimed) {
      const cpu = deps.stepTimed!(dt);
      let seg = cpuBySegment.get(currentSeg);
      if (!seg) { seg = new Map(); cpuBySegment.set(currentSeg, seg); }
      for (const [label, ms] of Object.entries(cpu)) { pushCpu(seg, label, ms); pushCpu(cpuAll, label, ms); }
    } else {
      deps.step(dt);
    }
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
  // 'passes' mode: label -> per-frame ms, per segment and overall.
  const passMode = opts.mode === 'passes' && typeof deps.passTimings === 'function';
  const passBySegment = new Map<string, Map<string, number[]>>();
  const passAll = new Map<string, number[]>();
  const wallBySegment = new Map<string, Map<string, number[]>>();
  const wallAll = new Map<string, number[]>();
  const spanBySegment = new Map<string, number[]>();
  const spanAll: number[] = [];
  let passFramesAll = 0;
  const passFramesBySegment = new Map<string, number>();
  const push = (m: Map<string, number[]>, label: string, ms: number) => {
    let a = m.get(label); if (!a) { a = []; m.set(label, a); } a.push(ms);
  };
  // Samples recorded during warmup (and by the live loop before the bench)
  // are drained and DISCARDED so the first chunk's table is only its own.
  if (passMode) await deps.passTimings!();
  const recordPasses = async (segName: string) => {
    const samples = await deps.passTimings!();
    const wallPerFrame = aggregatePassSamples(samples);
    const { exclusive, span } = attributePassSamples(samples);
    let seg = passBySegment.get(segName);
    if (!seg) { seg = new Map(); passBySegment.set(segName, seg); }
    let wseg = wallBySegment.get(segName);
    if (!wseg) { wseg = new Map(); wallBySegment.set(segName, wseg); }
    let sseg = spanBySegment.get(segName);
    if (!sseg) { sseg = []; spanBySegment.set(segName, sseg); }
    for (const [frame, byLabel] of exclusive) {
      passFramesAll++;
      passFramesBySegment.set(segName, (passFramesBySegment.get(segName) ?? 0) + 1);
      for (const [label, ms] of byLabel) { push(seg, label, ms); push(passAll, label, ms); }
      for (const [label, ms] of wallPerFrame.get(frame) ?? []) { push(wseg, label, ms); push(wallAll, label, ms); }
      const sp = span.get(frame) ?? 0;
      sseg.push(sp); spanAll.push(sp);
    }
  };
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
    currentSeg = seg.name;
    let f = seg.from;
    while (f < seg.to) {
      const n = Math.min(chunkFrames, seg.to - f);
      const t0 = deps.now();
      for (let i = 0; i < n; i++) stepOnce(f + i);
      await deps.resolveGpu();
      record(seg.name, (deps.now() - t0) / n);
      if (passMode) await recordPasses(seg.name);
      f += n;
    }
    const lastCensus = takeCensus();
    if (firstCensus && lastCensus) {
      censusBySegment.set(seg.name, { first: firstCensus, last: lastCensus });
    }
  }

  // CPU labels ride the same maps as the GPU passes (distinguished by their
  // 'cpu:' prefix), so one table reads both sides of the frame.
  const merged = (gpu: Map<string, number[]>, cpu: Map<string, number[]> | undefined): Map<string, number[]> => {
    if (!cpu) return gpu;
    const out = new Map(gpu);
    for (const [k, v] of cpu) out.set(k, v);
    return out;
  };
  const summariseLabels = (m: Map<string, number[]>): Record<string, SegmentSummary> => {
    const out: Record<string, SegmentSummary> = {};
    // Largest first, so a table reads top-down without sorting.
    const entries = [...m.entries()].map(([label, xs]) => summarise(label, xs))
      .sort((a, b) => b.p50 - a.p50);
    for (const s of entries) out[s.name] = s;
    return out;
  };
  const passes: PassReport | undefined = opts.mode === 'passes' ? {
    available: passFramesAll > 0,
    overall: {
      name: 'overall', frames: passFramesAll,
      labels: summariseLabels(merged(passAll, cpuAll)), wall: summariseLabels(wallAll), span: summarise('span', spanAll),
    },
    segments: scenario.segments.map((s) => ({
      name: s.name,
      frames: passFramesBySegment.get(s.name) ?? 0,
      labels: summariseLabels(merged(passBySegment.get(s.name) ?? new Map(), cpuBySegment.get(s.name))),
      wall: summariseLabels(wallBySegment.get(s.name) ?? new Map()),
      span: summarise('span', spanBySegment.get(s.name) ?? []),
    })),
  } : undefined;

  // AFTER every timing sample. `endHash` is deliberately the last thing this
  // function does, so its readback cost cannot land inside a measured frame.
  const endHash = deps.endHash ? await deps.endHash() : undefined;

  return {
    mode: opts.mode,
    label: opts.label ?? '',
    ...(passes ? { passes } : {}),
    ...(endHash ? { endHash } : {}),
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
