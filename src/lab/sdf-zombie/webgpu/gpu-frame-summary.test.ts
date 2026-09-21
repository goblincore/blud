import { describe, expect, it } from 'vitest';
import { createGpuFrameAttributor } from './gpu-frame-summary';
import type { PassSample } from './gpu-pass-timing';

const pass = (frame: number, label: string, start: number, end: number): PassSample =>
  ({ frame, label, kind: 'render', ms: end - start, start, end });

describe('per-frame GPU summaries for the gameplay recorder', () => {
  it('splits a frame into busy and idle, and ranks the passes by exclusive time', () => {
    const a = createGpuFrameAttributor();
    // Apple/Dawn shape: every pass of a frame shares the start; ends are real.
    const out = a.add([pass(1, 'sdf:polys', 0, 3), pass(1, 'sdf:march', 0, 10), pass(1, 'post:blit', 0, 11)]);
    expect(out.get(1)).toEqual({ busyMs: 11, idleMs: 0, exact: true, passes: { 'sdf:march': 7, 'sdf:polys': 3, 'post:blit': 1 } });
  });

  it('charges the wait between frames to the LATER frame as idle, across batches too', () => {
    const a = createGpuFrameAttributor();
    a.add([pass(1, 'sdf:march', 0, 10)]);
    // Same batch: frame 2 starts 23 ms after frame 1 finished.
    const b = a.add([pass(2, 'sdf:march', 33, 45)]);
    expect(b.get(2)).toMatchObject({ busyMs: 12, idleMs: 23 });
    // Next batch: the cursor carries over, so frame 3's idle is still seen.
    const c = a.add([pass(3, 'sdf:march', 66, 80)]);
    expect(c.get(3)).toMatchObject({ busyMs: 14, idleMs: 21 });
  });

  it('a GPU-bound frame shows no idle: the next frame queued before this one drained', () => {
    const a = createGpuFrameAttributor();
    const out = a.add([pass(1, 'sdf:march', 0, 40), pass(2, 'sdf:march', 33, 78)]);
    expect(out.get(2)).toMatchObject({ busyMs: 38, idleMs: 0 });
  });

  it('falls back to wall durations, flagged inexact, when raw boundaries are missing', () => {
    const a = createGpuFrameAttributor();
    const out = a.add([{ frame: 5, label: 'sdf:march', kind: 'render', ms: 9 }]);
    expect(out.get(5)).toEqual({ busyMs: 9, idleMs: 0, exact: false, passes: { 'sdf:march': 9 } });
  });

  it('drops sub-0.05 ms passes and rounds to 0.01 ms to keep recordings small', () => {
    const a = createGpuFrameAttributor();
    const out = a.add([pass(1, 'tiny', 0, 0.02), pass(1, 'sdf:march', 0, 5.12345)]);
    expect(out.get(1)!.passes).toEqual({ 'sdf:march': 5.1 });
    expect(out.get(1)!.busyMs).toBe(5.12);
  });
});
