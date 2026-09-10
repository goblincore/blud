// src/lab/sdf-zombie/webgpu/gpu-pass-timing.ts
//
// PER-PASS GPU TIMESTAMPS — where the frame's milliseconds actually go.
//
// Every perf lever to date has been judged by a whole-frame fence, and every
// attribution study (close-up task 1b's Question A, task 3's prepass) sliced
// ONE fragment shader into walk / shading / wound. Nobody has measured that
// shader against the rest of the frame: the hull rasterisation, the
// composite, post-AA, the goo chain, the level, the tile-bin compute. The
// depth prepass halved the march's steps and the frame did not move — which
// says the budget is somewhere no counter was looking.
//
// HOW IT WORKS. three's WebGPU backend already writes a timestamp pair around
// EVERY render/compute pass when the renderer is created with
// trackTimestamp (lab-renderer.ts does). It keys each pair by a uid it
// builds in Backend.updateTimeStampUID — `r:<frameCalls>:<ctxId>:f<frame>` —
// and after resolveTimestampsAsync the pool's `timestamps` Map holds
// uid -> ms for every pass. Two things stop that being an attribution table
// on its own: the uid says nothing about WHICH pass it was, and info.frame
// only advances from the animation loop, so a hand-stepped bench frame
// repeats the same uids and later passes overwrite earlier ones in the Map.
//
// So this module (1) keeps a CURRENT PASS LABEL that the frame's pass sites
// set as they go (sdf-layer, post-aa, goo-layer, tile-bin-compute,
// character-effects), (2) wraps backend.getTimestampUID to prefix the
// label and its own frame counter onto three's uid — the pool's parser is
// `^(.*):f(\d+)$`, anchored at the END, so a prefix is invisible to it —
// and (3) drains the pool's Map after a resolve into labelled samples.
//
// The wrap costs one string concatenation per pass, on a path that already
// allocates a query pair; the label calls are assignments. Nothing here runs
// on the GPU. With trackTimestamp off (WebGL fallback) install() is a no-op
// and collect() returns nothing — the bench mode reports that, not zeros.
//
// WHAT THE TIMESTAMPS MEAN ON THIS MACHINE (Apple GPU, Chrome/Dawn, read
// from a raw dump 2026-09-07): every pass in a frame reports the SAME start
// — the command buffer's schedule time — and only the END times are real
// completion times. So `ms` (end - start) is pipeline residency, not cost:
// a fullscreen blit reads 4-8 ms behind a march it merely queued behind.
// attributePassSamples therefore charges by completion order, and a pass
// that completes alongside a heavier independent pass (the goo density
// quads finish with the march, since nothing reads them until the surface
// pass) is correctly charged ~0. A pass that drew nothing returns a stale
// end BEFORE its start; collect() drops those.

import type * as THREE from 'three/webgpu';

/** Label carried by passes that no site has claimed yet. A frame that shows
 *  time here has a pass this module does not know about — go label it. */
export const UNLABELLED_PASS = 'unlabelled';

const UID_PREFIX = 'p|';

let currentLabel = UNLABELLED_PASS;
let frameNo = 0;

/** Name the passes that follow until the next call. */
export function setPassLabel(label: string): void {
  currentLabel = label;
}

/** Run fn with the label set, restoring the previous label afterwards. */
export function withPassLabel<T>(label: string, fn: () => T): T {
  const prev = currentLabel;
  currentLabel = label;
  try { return fn(); } finally { currentLabel = prev; }
}

/** Advance the module's own frame counter. The bench calls this once per
 *  stepped frame, so samples group by the frame they were recorded in even
 *  though three's info.frame is frozen while the animation loop is off. */
export function beginPassFrame(): number {
  frameNo++;
  currentLabel = UNLABELLED_PASS;
  return frameNo;
}

export function currentPassFrame(): number {
  return frameNo;
}

export interface PassSample {
  /** This module's frame counter at record time. */
  frame: number;
  label: string;
  kind: 'render' | 'compute';
  /** Pass wall time on the GPU timeline, end minus start. On a tile-based
   *  GPU passes OVERLAP (the next pass's vertex stage starts before this
   *  one's fragments finish), so these sum to MORE than the frame. */
  ms: number;
  /** Raw pass boundaries in ms, relative to the first timestamp this
   *  session read. Present when the raw query buffer could be read. */
  start?: number;
  end?: number;
}

/** Parse a uid this module prefixed: `p|<label>|<frame>|<three's uid>`.
 *  Returns null for uids recorded before install() wrapped the backend. */
export function parsePassUid(uid: string): { label: string; frame: number } | null {
  if (!uid.startsWith(UID_PREFIX)) return null;
  const rest = uid.slice(UID_PREFIX.length);
  const a = rest.indexOf('|');
  if (a < 0) return null;
  const b = rest.indexOf('|', a + 1);
  if (b < 0) return null;
  const label = rest.slice(0, a);
  const frame = Number(rest.slice(a + 1, b));
  if (!Number.isFinite(frame)) return null;
  return { label, frame };
}

export function makePassUid(label: string, frame: number, threeUid: string): string {
  return `${UID_PREFIX}${label}|${frame}|${threeUid}`;
}

/** Sum wall durations into frame -> label -> ms. Render and compute passes
 *  with the same label add together. */
export function aggregatePassSamples(samples: readonly PassSample[]): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  for (const s of samples) {
    let byLabel = out.get(s.frame);
    if (!byLabel) { byLabel = new Map(); out.set(s.frame, byLabel); }
    byLabel.set(s.label, (byLabel.get(s.label) ?? 0) + s.ms);
  }
  return out;
}

/** Label for GPU time inside a frame's span where NO pass was running:
 *  the GPU waiting on the CPU. Time here is a CPU-bound frame, not a pass
 *  cost — the first sweep charged it to whichever pass happened to come
 *  next (a fullscreen quad pass read 20 ms) before this label existed. */
export const GPU_IDLE_LABEL = 'gpu:idle';

/**
 * EXCLUSIVE attribution by completion order — the number to read.
 *
 * Passes overlap on the GPU, so wall durations double-count. Sorting a
 * frame's passes by END and charging each one the time the GPU timeline
 * advanced since the previous pass ended partitions the frame's GPU span
 * exactly: the charges sum to last end minus first start, whatever
 * overlapped with what. A pass whose fragments queued behind heavier work
 * is charged only for the tail it actually added. Time between the
 * previous pass's end and this pass's START — the GPU sitting idle — goes
 * to GPU_IDLE_LABEL, never to the pass. Samples without raw boundaries fall
 * back to wall ms.
 *
 * Returns frame -> label -> exclusive ms, plus frame -> GPU span (the
 * timeline advance charged to that frame's passes; sums over a batch to
 * last end minus first start).
 */
export function attributePassSamples(samples: readonly PassSample[]): {
  exclusive: Map<number, Map<string, number>>;
  span: Map<number, number>;
} {
  const exclusive = new Map<number, Map<string, number>>();
  const span = new Map<number, number>();
  const charge = (frame: number, label: string, ms: number) => {
    let byLabel = exclusive.get(frame);
    if (!byLabel) { byLabel = new Map(); exclusive.set(frame, byLabel); }
    byLabel.set(label, (byLabel.get(label) ?? 0) + ms);
    span.set(frame, (span.get(frame) ?? 0) + ms);
  };
  const raw = samples.filter((s): s is PassSample & { start: number; end: number } => s.start !== undefined && s.end !== undefined);
  if (raw.length === samples.length && raw.length > 0) {
    // ONE timeline across every frame in the batch, not one per frame.
    // Frames pipeline: frame N's first pass starts before frame N-1's tail
    // has drained, and a per-frame cursor charged that whole tail to it
    // (spans read 9-13 ms over the fenced frame, all on the first pass).
    // Carrying the cursor across frames charges each pass only for the
    // time the timeline advanced while it was the one completing. The
    // batch's first pass is charged from its own start.
    const sorted = [...raw].sort((a, b) => a.end - b.end);
    let cursor = Math.min(...sorted.map((s) => s.start));
    for (const s of sorted) {
      const idle = Math.max(0, s.start - cursor);
      if (idle > 0) charge(s.frame, GPU_IDLE_LABEL, idle);
      charge(s.frame, s.label, Math.max(0, s.end - Math.max(cursor, s.start)));
      cursor = Math.max(cursor, s.end);
    }
  } else {
    for (const s of samples) charge(s.frame, s.label, s.ms);
  }
  return { exclusive, span };
}

/** Shape of the three internals this module reaches into. Kept minimal and
 *  duck-typed: none of it is public API, so the install guards every field
 *  and degrades to "not installed" rather than throwing at boot. */
// The repo's tsconfig carries no WebGPU lib types (three's own .d.ts hides
// them), so the handful of device/buffer members used here are duck-typed.
interface GpuBufferLike {
  mapState: string;
  mapAsync(mode: number, offset: number, size: number): Promise<void>;
  getMappedRange(offset: number, size: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
interface GpuDeviceLike {
  createBuffer(desc: { label?: string; size: number; usage: number }): GpuBufferLike;
  createCommandEncoder(): {
    copyBufferToBuffer(src: GpuBufferLike, srcOff: number, dst: GpuBufferLike, dstOff: number, size: number): void;
    finish(): unknown;
  };
  queue: { submit(buffers: unknown[]): void };
}
const gpuConst = (name: 'GPUBufferUsage' | 'GPUMapMode', key: string): number =>
  ((globalThis as unknown as Record<string, Record<string, number> | undefined>)[name]?.[key]) ?? 0;

interface TimestampPoolLike {
  trackTimestamp: boolean;
  timestamps: Map<string, number>;
  /** uid -> base query index, for the queries recorded since the last
   *  resolve. Cleared by three's resolve, which is why it is snapshotted
   *  from a wrap around backend.resolveTimestampsAsync. */
  queryOffsets?: Map<string, number>;
  currentQueryIndex?: number;
  /** The QUERY_RESOLVE | COPY_SRC buffer three resolves into; its contents
   *  (u64 ns per query) stay valid until the next resolve. */
  resolveBuffer?: GpuBufferLike;
  maxQueries?: number;
}
interface BackendLike {
  trackTimestamp?: boolean;
  device?: GpuDeviceLike;
  timestampQueryPool?: Record<string, TimestampPoolLike | undefined>;
  getTimestampUID?: (ctx: unknown) => string;
  resolveTimestampsAsync?: (type?: string) => Promise<unknown>;
}

export interface PassTiming {
  /** False when the renderer has no timestamp tracking (WebGL fallback, or
   *  the internals moved). collect() then always returns []. */
  installed: boolean;
  /** Resolve both pools and drain every labelled sample recorded since the
   *  last collect. Samples three recorded before install() are dropped. */
  collect(): Promise<PassSample[]>;
  /** Pass COUNT per label since the last call (draw census): a label whose
   *  pass count multiplies during fire is re-rendering the scene — shadow
   *  faces, per-light re-renders — even when its exclusive ms looks small. */
  countsSinceLast(): { label: string; passes: number }[];
}

export function installPassTiming(renderer: THREE.WebGPURenderer): PassTiming {
  const backend = (renderer as unknown as { backend?: BackendLike }).backend;
  const orig = backend?.getTimestampUID;
  if (!backend || typeof orig !== 'function' || backend.trackTimestamp !== true) {
    return { installed: false, async collect() { return []; }, countsSinceLast() { return []; } };
  }
  backend.getTimestampUID = (ctx: unknown) => {
    const uid = makePassUid(currentLabel, frameNo, orig.call(backend, ctx));
    const key = `${frameNo}|${currentLabel}`;
    passCounts.set(key, (passCounts.get(key) ?? 0) + 1);
    return uid;
  };

  // Per-frame per-label PASS COUNTS (draw census). Grows one entry per
  // (frame, label) pair between calls; the census drains it each sample.
  const passCounts = new Map<string, number>();

  // Raw boundaries. three's resolve clears the uid -> query-index map before
  // the GPU work even starts, so the map is snapshotted from a wrap around
  // the backend's resolve; the raw u64 timestamps are then copied out of
  // the pool's resolve buffer (still valid until the next resolve) on
  // collect. Everything here is best-effort: any failure leaves the sample
  // with its wall duration only, and attributePassSamples falls back.
  const snapshots: Record<string, Map<string, number>> = { render: new Map(), compute: new Map() };
  const origResolve = backend.resolveTimestampsAsync;
  if (typeof origResolve === 'function') {
    backend.resolveTimestampsAsync = async (type = 'render') => {
      const pool = backend.timestampQueryPool?.[type];
      if (pool?.queryOffsets && (pool.currentQueryIndex ?? 0) > 0) {
        const snap = snapshots[type] ?? (snapshots[type] = new Map());
        for (const [uid, base] of pool.queryOffsets) snap.set(uid, base);
      }
      return origResolve.call(backend, type);
    };
  }
  let staging: GpuBufferLike | null = null;
  let stagingBytes = 0;
  let timeBase: bigint | null = null;
  const readRaw = async (pool: TimestampPoolLike): Promise<BigUint64Array | null> => {
    const device = backend.device;
    const src = pool.resolveBuffer;
    if (!device || !src || !pool.maxQueries) return null;
    const bytes = pool.maxQueries * 8;
    try {
      if (!staging || stagingBytes !== bytes) {
        staging?.destroy();
        staging = device.createBuffer({ label: 'pass-timing-staging', size: bytes, usage: gpuConst('GPUBufferUsage', 'COPY_DST') | gpuConst('GPUBufferUsage', 'MAP_READ') });
        stagingBytes = bytes;
      }
      if (staging.mapState !== 'unmapped') return null;
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(src, 0, staging, 0, bytes);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(gpuConst('GPUMapMode', 'READ'), 0, bytes);
      const copy = new BigUint64Array(staging.getMappedRange(0, bytes).slice(0));
      staging.unmap();
      return copy;
    } catch {
      return null;
    }
  };

  return {
    installed: true,
    countsSinceLast() {
      const out: { label: string; passes: number }[] = [];
      for (const [key, passes] of passCounts) {
        const bar = key.indexOf('|');
        out.push({ label: key.slice(bar + 1), passes });
      }
      passCounts.clear();
      return out;
    },
    async collect() {
      const out: PassSample[] = [];
      for (const kind of ['render', 'compute'] as const) {
        const pool = backend.timestampQueryPool?.[kind];
        if (!pool || !pool.trackTimestamp) continue;
        // A pool with nothing pending returns its last value immediately, so
        // calling after the bench's own fence (which is this same resolve for
        // 'render') costs nothing extra.
        try { await renderer.resolveTimestampsAsync(kind); } catch { continue; }
        const snap = snapshots[kind];
        const raw = snap && snap.size > 0 ? await readRaw(pool) : null;
        for (const [uid, ms] of pool.timestamps) {
          const p = parsePassUid(uid);
          pool.timestamps.delete(uid);
          if (!p) { snap?.delete(uid); continue; }
          const sample: PassSample = { frame: p.frame, label: p.label, kind, ms };
          const base = snap?.get(uid);
          snap?.delete(uid);
          if (raw && base !== undefined && base + 1 < raw.length) {
            const t0 = raw[base]!;
            const t1 = raw[base + 1]!;
            // A pass that drew NOTHING (the goo density pass on a frame with
            // no blood) leaves its end-of-pass counter unsampled: the buffer
            // holds a stale value, typically hundreds of ms BEFORE the start.
            // Such a sample is not a measurement — drop it, or it sorts to
            // the front of the completion order and poisons the frame.
            if (t1 < t0) continue;
            if (timeBase === null || t0 < timeBase) timeBase = t0;
            sample.start = Number(t0 - timeBase) / 1e6;
            sample.end = Number(t1 - timeBase) / 1e6;
          } else if (ms < 0) {
            continue;
          }
          out.push(sample);
        }
        snap?.clear();
      }
      return out;
    },
  };
}
