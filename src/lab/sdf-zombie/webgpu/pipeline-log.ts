// src/lab/sdf-zombie/webgpu/pipeline-log.ts
//
// PIPELINE-CREATION LOG (startup-hitch attribution, 2026-09-14).
//
// The boot warm-up (`warmPipelines` in game-main.ts) compiles the render
// pipelines it can see, but the owner still hits 2+ s frames at startup and on
// room entries. Attributing one needs to know WHICH pipelines were created
// (and when) — three creates them wherever the first draw or dispatch
// happens, mid-frame if that is where the draw is.
//
// HOW IT WORKS. WebGPUDevice.createRenderPipeline / createComputePipeline
// (+ their Async variants) are THE choke point: every path — three's sync
// mid-frame compile, compileAsync's async compile, compute dispatches — ends
// in one of these four. The descriptor's `label` (three stamps
// `renderPipeline_<material name>_<id>` / `computePipeline_<stage>`) names the
// pipeline. We wrap the four device methods as soon as the device exists and
// record {kind, name, ms, frame} per creation; the lab-renderer loop reports
// each presented frame's wall ms (noteFrameEnd) and any frame over
// LONG_FRAME_MS keeps the creations that overlapped it.
//
// Frame numbers are this module's own counter of COMPLETED presented frames —
// during the boot warm-up the loop is paused, so warm-time creations all carry
// the frame in flight when it paused (the probe distinguishes them by the
// `__warmDone` boundary, not by frame number).
//
// COST. The wraps are installed ALWAYS (they must be in place before the warm
// to count its creations) but the per-creation array pushes only run while
// enabled (`?pipelinelog=1` / `__sdfGame.setPipelineLog(true)`). Disabled, the
// cost is four closure hops per pipeline CREATION — a first-use-only event —
// plus two integer adds per frame and per renderer.compute() call.
//
// The same wrap counts renderer.compute() calls per frame (the crowd path
// dispatches four tile-bin kernels per type per frame through it), so a
// long frame with NO pipeline creations can still be attributed to a compute
// or submit stall rather than left unexplained.

import type * as THREE from 'three/webgpu';

/** Frames at or above this wall ms are recorded with their pipelines. */
export const LONG_FRAME_MS = 100;

export interface PipelineCreationRecord {
  kind: 'render' | 'compute';
  /** three's descriptor label, e.g. `renderPipeline_MarchNodeMaterial_42`
   *  or `computePipeline_fn kTileRange`. Truncated to 160 chars. */
  name: string;
  /** Wall ms from call to (async:) settle. */
  ms: number;
  /** The frame in flight when creation STARTED (see module comment). */
  frame: number;
  /** performance.now() at creation START — what noteFrameEnd partitions on. */
  t: number;
  /** True when created through the Async entry (compileAsync path). */
  async: boolean;
  /** For async creations: the renderer.compileAsync() session that was open
   *  when the creation was dispatched, as `compile#<n>@f<frame>` — or
   *  '<none>', meaning three dispatched it WITHOUT a caller-compileAsync
   *  (an internal lazy-async path worth naming). */
  via: string;
}

export interface LongFrameRecord {
  frame: number;
  /** Wall ms of the presented frame (tick callback + draw). */
  ms: number;
  /** performance.now() at the frame's start/end — the probe aligns page
   *  console lines (CDP timestamps minus performance.timeOrigin) against
   *  this window to name the concurrent event (a bake landing, a GLB
   *  finishing, a worker reply). */
  t0: number;
  t1: number;
  /** Pipeline creations that STARTED during this frame (warm frames: the
   *  paused loop's in-flight frame). */
  pipelines: PipelineCreationRecord[];
}

export interface PipelineLogSummary {
  installed: boolean;
  enabled: boolean;
  /** Long frames, oldest first. */
  frames: LongFrameRecord[];
  totalPipelines: number;
  totalCompileMs: number;
  /** The 16 slowest creations of the session regardless of which frame they
   *  landed in — names one-off stalls (an async creation settling seconds
   *  into the drive loop never shows up inside a long frame). */
  slowest: PipelineCreationRecord[];
  /** renderer.compute() census: per-frame call counts (the crowd tile-bin
   *  dispatches land here) and the max over frames. */
  compute: {
    total: number;
    maxPerFrame: number;
    byFrame: { frame: number; calls: number }[];
  };
}

/** Shorten labels but keep the material/stage name readable. */
function cleanLabel(label: unknown): string {
  const s = typeof label === 'string' && label.length > 0 ? label : '<unlabeled>';
  return s.length > 160 ? s.slice(0, 157) + '...' : s;
}

// -- module state (one renderer per page; the lab is single-renderer) -------
let installed = false;
let enabled = false;
let frameNo = 0; // COMPLETED frames; the frame in flight is frameNo + 1
let totalPipelines = 0;
let totalCompileMs = 0;
// Creations started during the frame in flight (promoted at noteFrameEnd).
let inFlight: PipelineCreationRecord[] = [];
// Long frames, bounded — a 600-frame probe produces at most a few dozen.
const longFrames: LongFrameRecord[] = [];
const MAX_LONG_FRAMES = 500;
// Session-wide slowest creations (always recorded — scalars plus a bounded
// 16-entry list; this is the one-off stall detector).
const slowest: PipelineCreationRecord[] = [];
const SLOWEST_KEEP = 16;
// renderer.compute() census.
let computeCallsThisFrame = 0;
let computeTotal = 0;
let computeMaxPerFrame = 0;
const computeByFrame: { frame: number; calls: number }[] = [];
const MAX_COMPUTE_FRAMES = 4000;
// The open renderer.compileAsync() session, for attributing async creations.
let activeCompile: string | null = null;
let compileSession = 0;

/** Enable/disable per-creation recording. Totals and compute counts run
 *  regardless (they are scalars); the arrays are what need the gate. */
export function setPipelineLogEnabled(on: boolean): void {
  enabled = on;
}

export function pipelineLogEnabled(): boolean {
  return enabled;
}

/**
 * Wrap the backend device's pipeline-creation methods and count
 * renderer.compute() calls. Call once, right after createLabRenderer resolves
 * (the device exists only after init). Idempotent; returns installed.
 */
export function installPipelineLog(renderer: THREE.WebGPURenderer): boolean {
  if (installed) return true;
  const backend = (renderer as unknown as { backend?: { device?: Record<string, unknown> } }).backend;
  const device = backend?.device;
  if (!device) return false;

  const wrap = (key: string, kind: 'render' | 'compute', async: boolean) => {
    const orig = device[key];
    if (typeof orig !== 'function') return;
    device[key] = function (this: unknown, ...args: unknown[]) {
      const t0 = performance.now();
      const frame = frameNo + 1;
      const desc = args[0] as { label?: string } | undefined;
      const result = (orig as (...a: unknown[]) => unknown).apply(this, args);
      const record: PipelineCreationRecord = {
        kind, name: cleanLabel(desc?.label), ms: 0, frame, t: t0, async,
        via: async ? (activeCompile ?? '<none>') : '',
      };
      const finish = () => {
        record.ms = performance.now() - t0;
        totalPipelines++;
        totalCompileMs += record.ms;
        // Slowest-16, insertion-sorted (creations are rare; 16 compares).
        let i = 0;
        while (i < slowest.length && slowest[i]!.ms >= record.ms) i++;
        if (i < SLOWEST_KEEP) {
          slowest.splice(i, 0, record);
          if (slowest.length > SLOWEST_KEEP) slowest.pop();
        }
        if (enabled) inFlight.push(record);
      };
      if (async && result instanceof Promise) {
        result.then(finish, finish); // a FAILED creation still counts (its cost was paid)
      } else {
        finish();
      }
      return result;
    };
  };
  wrap('createRenderPipeline', 'render', false);
  wrap('createRenderPipelineAsync', 'render', true);
  wrap('createComputePipeline', 'compute', false);
  wrap('createComputePipelineAsync', 'compute', true);

  // Name the compileAsync session async creations belong to. Without this,
  // a mid-play async creation cluster has no visible caller (three queues
  // the work; the stack at device level is all internals).
  const anyRenderer2 = renderer as unknown as Record<string, unknown>;
  const origCompileAsync = anyRenderer2.compileAsync;
  if (typeof origCompileAsync === 'function') {
    anyRenderer2.compileAsync = function (this: unknown, ...args: unknown[]) {
      const prev = activeCompile;
      compileSession++;
      activeCompile = `compile#${compileSession}@f${frameNo + 1}`;
      try {
        const r = (origCompileAsync as (...a: unknown[]) => unknown).apply(this, args);
        if (r instanceof Promise) return r.finally(() => { activeCompile = prev; });
        activeCompile = prev;
        return r;
      } catch (err) {
        activeCompile = prev;
        throw err;
      }
    };
  }

  // renderer.compute() census — instance-level shadow, the prototype method
  // stays. Every crowd tile-bin frame (4 kernels, 1 compute call) lands here.
  const anyRenderer = renderer as unknown as Record<string, unknown>;
  for (const key of ['compute', 'computeAsync'] as const) {
    const orig = anyRenderer[key];
    if (typeof orig !== 'function') continue;
    anyRenderer[key] = function (this: unknown, ...args: unknown[]) {
      computeCallsThisFrame++;
      computeTotal++;
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
  }

  installed = true;
  return true;
}

/**
 * The lab-renderer loop calls this once per PRESENTED frame with the frame's
 * wall ms (tick callback + draw, the rAF handler the browser measures for its
 * [Violation] lines) and the frame's start timestamp (performance.now() at
 * the top of the handler). Only creations that STARTED within the frame are
 * kept in its record: while the boot warm-up has the loop paused, its async
 * creations settle into `inFlight` and would otherwise be mis-attributed to
 * the first resumed frame. The warm's creations are still counted in the
 * totals and ranked in `slowest` — they are startup cost, just not THIS
 * frame's stall.
 */
export function noteFrameEnd(wallMs: number, startT: number): void {
  frameNo++;
  if (computeCallsThisFrame > 0) {
    computeByFrame.push({ frame: frameNo, calls: computeCallsThisFrame });
    if (computeByFrame.length > MAX_COMPUTE_FRAMES) computeByFrame.shift();
    if (computeCallsThisFrame > computeMaxPerFrame) computeMaxPerFrame = computeCallsThisFrame;
    computeCallsThisFrame = 0;
  }
  if (enabled && wallMs >= LONG_FRAME_MS) {
    longFrames.push({
      frame: frameNo,
      ms: Math.round(wallMs * 10) / 10,
      t0: Math.round(startT),
      t1: Math.round(startT + wallMs),
      pipelines: inFlight.filter((c) => c.t >= startT),
    });
    if (longFrames.length > MAX_LONG_FRAMES) longFrames.shift();
  }
  inFlight = [];
}

/** The `__sdfGame.pipelineLog()` payload. */
export function getPipelineLog(): PipelineLogSummary {
  return {
    installed,
    enabled,
    frames: longFrames,
    totalPipelines,
    totalCompileMs: Math.round(totalCompileMs),
    slowest: slowest.map((s) => ({ ...s })),
    compute: {
      total: computeTotal,
      maxPerFrame: computeMaxPerFrame,
      byFrame: computeByFrame,
    },
  };
}
