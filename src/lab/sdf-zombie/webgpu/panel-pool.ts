// src/lab/sdf-zombie/webgpu/panel-pool.ts
//
// A small job pool for the sector materials' off-thread texture builds (game-sector-mesh.ts). Each
// lane owns one worker and takes the next job when its last one answers. A worker that cannot be
// made (CSP, bad path, no module workers) or that errors on a job is never left hanging: the job is
// built IN PLACE on the main thread, the worker is terminated, and the lane goes on — with a fresh
// worker after a first failure, on the main thread after a second (a worker script that fails to
// load fails everywhere). Every job is answered exactly once; `done` fires once at the end.
//
// No DOM or three: the worker factory, the in-place build and the clock are injected (tests use fakes).

export interface PoolWorker {
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string; preventDefault?: () => void }) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

export interface PoolStats { ms: number; workers: number; offThread: number; inPlace: number; failures: number }

export interface PoolOptions<J> {
  size: number;
  /** A new worker; may throw or return null (then the lane builds in place). */
  spawn: () => PoolWorker | null;
  message: (job: J) => unknown;
  /** A worker's answer for `job`. */
  onResult: (job: J, data: unknown) => void;
  /** Build `job` on this thread (the fallback). */
  inPlace: (job: J) => void;
  label: (job: J) => string;
  warn: (msg: string) => void;
  done: (stats: PoolStats) => void;
  now?: () => number;
  /** How the main-thread fallback yields between jobs (default setTimeout 0). */
  defer?: (fn: () => void) => void;
}

/** Workers that fail before the pool stops making new ones and drains on the main thread. */
const MAX_FAILURES = 2;

export function runPool<J>(jobs: readonly J[], o: PoolOptions<J>): void {
  const now = o.now ?? (() => performance.now());
  const defer = o.defer ?? ((fn: () => void) => { setTimeout(fn, 0); });
  const t0 = now();
  let next = 0, answered = 0, offThread = 0, inPlace = 0, failures = 0, workers = 0, finished = false;
  const finish = () => {
    if (++answered === jobs.length && !finished) {
      finished = true;
      o.done({ ms: now() - t0, workers, offThread, inPlace, failures });
    }
  };
  const buildHere = (job: J) => {
    try { o.inPlace(job); } catch (e) { o.warn(`[sector-mat] ${o.label(job)}: in-place build failed too (${String(e)})`); }
    inPlace++;
    finish();
  };
  /** The main-thread lane: one job per tick until the queue is empty. */
  const drainHere = () => {
    const job = jobs[next++];
    if (job === undefined) return;
    buildHere(job);
    defer(drainHere);
  };
  const spawn = (): PoolWorker | null => {
    if (failures >= MAX_FAILURES) return null;
    try {
      const w = o.spawn();
      if (w) workers++;
      return w;
    } catch (e) {
      failures++;
      o.warn(`[sector-mat] could not start a texture worker (${String(e)}); building on the main thread`);
      return null;
    }
  };
  const lane = (w: PoolWorker | null) => {
    if (!w) { drainHere(); return; }
    const job = jobs[next++];
    if (job === undefined) { w.terminate(); return; }
    let settled = false;
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      failures++;
      o.warn(`[sector-mat] texture worker failed on ${o.label(job)} (${why}); building it on the main thread`);
      w.onmessage = w.onerror = w.onmessageerror = null;
      try { w.terminate(); } catch { /* already gone */ }
      buildHere(job);
      lane(spawn());
    };
    w.onmessage = (ev) => {
      if (settled) return;
      settled = true;
      try { o.onResult(job, ev.data); offThread++; finish(); }
      catch (e) { settled = false; fail(`bad result: ${String(e)}`); return; }
      lane(w);
    };
    w.onerror = (ev) => { ev.preventDefault?.(); fail(ev.message || 'error'); };
    w.onmessageerror = () => fail('message could not be read');
    try { w.postMessage(o.message(job)); } catch (e) { fail(`postMessage: ${String(e)}`); }
  };
  if (jobs.length === 0) { o.done({ ms: 0, workers: 0, offThread: 0, inPlace: 0, failures: 0 }); return; }
  const size = Math.max(1, Math.min(o.size, jobs.length));
  for (let k = 0; k < size; k++) lane(spawn());
}
