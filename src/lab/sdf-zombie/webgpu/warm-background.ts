// src/lab/sdf-zombie/webgpu/warm-background.ts
//
// THE BACKGROUND-COMPILE POLICY (defer-compile task, 2026-09-19).
//
// A cold boot used to be four ~48 s serialized march compiles behind the
// loader: body, crowd, chunk-MRT and chunk-shutter. Only the body (and the
// level/gun/post/fire passes) is needed for frame 1. The crowd and the
// gib/chunk variant are compiled AFTER `ready`, and until each program is
// READY its consumer degrades rather than waiting or stalling:
//
//   gib   pending -> compiling -> ready | failed   gibDraw():   draw | skip
//   crowd pending -> compiling -> ready | failed   crowdPath(): crowd | fallback
//
// WHY THE DEGRADE IS THE WHOLE POINT. Three.js SKIPS a draw whose pipeline was
// queued through `compileAsync` and has not resolved (`Renderer._renderObjectDirect`
// -> `Pipelines.isReady` -> no `backend.draw`). A draw that reaches a pipeline
// NOT in the cache builds it SYNCHRONOUSLY (`WebGPUPipelineUtils.createRenderPipeline`,
// promises === null), which on a cold Metal cache is the 47.8 s mid-game freeze
// `87b8f71c` was written to prevent. So the consumer must never submit the draw
// until this tracker says ready. `failed` degrades forever for the same reason:
// we would rather show nothing (gibs still simulate; they re-appear once a
// future boot compiles the program) than freeze the game.
//
// PURE, renderer-free, port-ready: the release is a Rust + wgpu port, so the
// "is this program ready / what do I do if not" decision is a plain state
// machine with no three import. `game-main.ts` owns the async compiles and
// reports into this; the draw paths read the two policy flags.

/** The two programs compiled off the loader path. */
export type WarmJobName = 'gib' | 'crowd';

/**
 * `pending`  — not started (the program has never been queued).
 * `compiling`— queued through the async API, not yet ready.
 * `ready`    — the async pipeline(s) resolved; the fast path may draw.
 * `failed`   — the async compile threw or timed out; the fast path stays off.
 */
export type WarmJobState = 'pending' | 'compiling' | 'ready' | 'failed';

/** What the gib/chunk draw path does while the chunk program is not ready. */
export type GibDrawPolicy = 'draw' | 'skip';
/** Which path a crowd member takes while the crowd program is not ready. */
export type CrowdPathPolicy = 'crowd' | 'fallback';

export interface WarmBackgroundSnapshot {
  readonly gib: WarmJobState;
  readonly crowd: WarmJobState;
}

export interface WarmBackgroundTracker {
  /** Mark a job as queued. A no-op once it is compiling or settled. */
  start(name: WarmJobName): void;
  /** Record the async compile's outcome. A no-op once the job is terminal. */
  settle(name: WarmJobName, ok: boolean): void;
  state(name: WarmJobName): WarmJobState;
  isReady(name: WarmJobName): boolean;
  /** `draw` ONLY when the chunk program is ready; else the pieces are skipped. */
  gibDraw(): GibDrawPolicy;
  /** `crowd` ONLY when the crowd program is ready; else the per-body fallback. */
  crowdPath(): CrowdPathPolicy;
  /** Plain-data copy for `__warmDone` / a driver to read. */
  snapshot(): WarmBackgroundSnapshot;
}

/**
 * Creates the tracker. Both jobs begin `pending`, which is the degrade state:
 * nothing has been queued yet, so nothing may draw through it.
 *
 * Terminality: `ready` and `failed` are FINAL. A settle that lands after the
 * job already settled (a late timeout racing a success, a duplicate callback)
 * must not flip the policy — a `ready` fast path that a late `failed` can turn
 * off would make the draw set flap; a `failed` job that a late success turns on
 * would draw through a program we already decided not to trust.
 */
export function createWarmBackgroundTracker(): WarmBackgroundTracker {
  const states = new Map<WarmJobName, WarmJobState>([
    ['gib', 'pending'],
    ['crowd', 'pending'],
  ]);

  const state = (name: WarmJobName): WarmJobState => states.get(name) ?? 'pending';
  const terminal = (name: WarmJobName): boolean => {
    const s = state(name);
    return s === 'ready' || s === 'failed';
  };

  return {
    start(name) {
      if (state(name) !== 'pending') return;
      states.set(name, 'compiling');
    },
    settle(name, ok) {
      if (terminal(name)) return;
      states.set(name, ok ? 'ready' : 'failed');
    },
    state,
    isReady: (name) => state(name) === 'ready',
    gibDraw: () => (state('gib') === 'ready' ? 'draw' : 'skip'),
    crowdPath: () => (state('crowd') === 'ready' ? 'crowd' : 'fallback'),
    snapshot: () => ({ gib: state('gib'), crowd: state('crowd') }),
  };
}
