// src/lab/sdf-zombie/webgpu/gpu-frame-summary.ts
//
// PER-FRAME GPU SUMMARIES for the gameplay recorder (telemetry v4, 2026-09-20).
//
// gpu-pass-timing.ts already turns three's timestamp pairs into exclusive
// per-pass charges; the recorder could not use them because "multipass
// timestamps are not attributable to individual frames". They are, given two
// things this module adds: the recorder advances the pass-frame counter every
// live frame (beginPassFrame), and the attribution CURSOR is carried across
// collect() batches, so the wait between one frame's last pass and the next
// frame's first is still charged — as gpu:idle, to the later frame.
//
// busyMs vs idleMs is the GPU-bound test. Under a frame cap a healthy frame
// reads busy << interval with the rest idle; a GPU-bound frame reads
// idle ~ 0, because the next frame was queued before this one drained.
//
// Pure: no renderer, no GPU. The recorder feeds it PassSample batches.

import { attributePassSamples, GPU_IDLE_LABEL, type PassSample } from './gpu-pass-timing';

export interface GpuFrameSummary {
  /** GPU timeline ms charged to this frame's passes (exclusive, so it sums). */
  busyMs: number;
  /** GPU timeline ms this frame's passes spent waiting for work to arrive. */
  idleMs: number;
  /** False when a sample lacked raw boundaries and wall durations were used —
   *  those overlap, so busyMs over-reads and idleMs is unknown (0). */
  exact: boolean;
  /** label -> exclusive ms, passes under 0.05 ms dropped, 0.01 ms resolution.
   *  (0.1 ms was too coarse to use a small constant-work pass as a GPU CLOCK
   *  reference: a 0.3 vs 0.4 ms fxaa is a 33% quantisation step.) */
  passes: Record<string, number>;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const tidy = (v: number, step: number) => Number(round(v, step).toFixed(2));

export function createGpuFrameAttributor(): {
  /** Summaries for every frame present in this batch. */
  add(samples: readonly PassSample[]): Map<number, GpuFrameSummary>;
} {
  let cursor: number | undefined;
  return {
    add(samples) {
      const out = new Map<number, GpuFrameSummary>();
      if (samples.length === 0) return out;
      const exact = samples.every((s) => s.start !== undefined && s.end !== undefined);
      const r = attributePassSamples(samples, cursor);
      if (exact) cursor = r.cursor;
      for (const [frame, byLabel] of r.exclusive) {
        let busy = 0, idle = 0;
        const passes: Record<string, number> = {};
        const ranked = [...byLabel].sort((a, b) => b[1] - a[1]);
        for (const [label, ms] of ranked) {
          if (label === GPU_IDLE_LABEL) { idle += ms; continue; }
          busy += ms;
          if (ms >= 0.05) passes[label] = tidy(ms, 0.01);
        }
        out.set(frame, { busyMs: tidy(busy, 0.01), idleMs: tidy(idle, 0.01), exact, passes });
      }
      return out;
    },
  };
}
