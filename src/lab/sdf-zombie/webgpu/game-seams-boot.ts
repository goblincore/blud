// src/lab/sdf-zombie/webgpu/game-seams-boot.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { type DeferredDebugView } from './deferred-layer';
import { hashFrame } from './demo-hash';
import { type GameDeferredRendererDiagnostics, type GameSurfaceHash } from './game-deferred-renderer';

// Type aliases copied from game-main.ts, where they are module-scope and
// not exported.
type GraphicsLevel = 'default' | 'high';

export function createBootSeams(ctx: GameContext) {
  return {
    /** Prototype: per-ray sphere compaction of the tile list. Only has an
     *  effect while tiles are on (tiles-playtest). */
    setTileRayCull: (on: boolean) => ctx.boot.gameTiles.setRayCull(on),
    tiles: () => ctx.boot.gameTiles.diagnostics(),
    backend: ctx.boot.handle.backend,
    setLoopRunning: (on: boolean) => ctx.boot.handle.setLoopRunning(on),
    /** THE FRAME HASH (deterministic demo recordings stage 2, 2026-09-10).
     *  Hashes the CURRENT rendered state — it does NOT step or mutate
     *  anything, which is what makes a recorded frame reproducible: the
     *  caller owns freeze/step ordering, this only measures.
     *
     *  `frame` is the caller's recording frame index, echoed back so a
     *  recording is self-describing.
     *
     *  Reads the march target and the gather's dynamic layer. The dynamic
     *  layer is when the gather is bound, which is the shipped configuration,
     *  so a missing layer means the gather is off rather than that the hash
     *  is broken — but an unreadable MARCH TARGET throws, because a hash
     *  seam that silently hashes nothing reports "identical" forever and
     *  gets trusted.
     *
     *  Usage (see scripts/sdf-demo-hash.mjs for the whole recipe):
     *    __sdfGame.setDemoHold(true);          // pin the render-side clocks
     *    __sdfGame.setLightClockFrozen(true);  // pin the flicker clock
     *    __sdfGame.step(90); __sdfGame.step(2);
     *    await __sdfGame.frameHash(0);         // step first, hash second
     */
    frameHash: async (frame = 0) =>
      hashFrame(ctx.boot.frameHashDeps, frame),
    /** THE PRESENTED FRAME, as the browser composes it.
     *
     *  WHY THIS IS A SEPARATE PATH from `frameHash`. `frameHash` reads GPU
     *  targets (the march target, the gather's layers) — the right instrument for
     *  asking "did the RENDERER change", and the one that catches a zeroed probe
     *  layer or a mistranscribed kernel. But it is NOT the image the owner looks
     *  at: everything downstream of the march — the interlaced field's held rows,
     *  FXAA, the VHS pass with its own temporal blend and 60/24 Hz row-noise
     *  hashes — runs after it, and a shader bug in any of those would be invisible
     *  to it. This returns the CANVAS instead, so a caller can hash what is
     *  actually on screen.
     *
     *  The trade, stated plainly: `toDataURL` yields 8-BIT premultiplied sRGB, so
     *  a difference below one 8-bit step is invisible here — and the 2026-09-05
     *  flicker wobble lives at exactly that level. Use this to check what the
     *  owner SEES; use `frameHash` to check what the renderer COMPUTED. Neither
     *  subsumes the other.
     *
     *  Returns base64 PNG without the data-URL prefix. The caller decodes and
     *  hashes it (scripts/sdf-demo-hash.mjs, using the same tested byte digest),
     *  so no image codec is needed in the page. */
    presentedShot: (): string => {
      const canvas = ctx.boot.handle.renderer.domElement as HTMLCanvasElement;
      const url = canvas.toDataURL('image/png');
      const comma = url.indexOf(',');
      return comma >= 0 ? url.slice(comma + 1) : url;
    },
    frameMs: () => ctx.boot.frameEma,
    // -------------------------------------------------------------------
    // BENCH SEAMS (2026-08-31). Everything the ablation legs toggle, plus
    // the fence the harness times against. Ship defaults are unchanged —
    // these only move when a driver moves them.
    // -------------------------------------------------------------------
    /** The GPU completion fence. Trust the fence, never a timestamp value. */
    resolveGpu: () => ctx.boot.handle.resolveGpu(),
    /** Per-pass GPU timestamps since the last call, labelled by pass site
     *  (gpu-pass-timing.ts). Ad-hoc probe; the bench's 'passes' mode is the
     *  measured form. `installed` false = no timestamp tracking on this page. */
    passTimings: async () => ({ installed: ctx.boot.passTiming.installed, samples: await ctx.boot.passTiming.collect() }),
    passCounts: () => ctx.boot.passTiming.countsSinceLast(),
    /** Median ms of `n` still frames, each drawn then fenced (CPU + GPU, no vsync or
     *  frame cap in the number). The mesh key gate's cost probe. */
    timeDraws: async (n = 30) => {
      const ms: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        ctx.boot.handle.drawOnce();
        await ctx.boot.handle.resolveGpu();
        ms.push(performance.now() - t0);
      }
      return ms.sort((a, b) => a - b)[n >> 1]!;
    },
    // ---------------------------------------------------------------
    // FRAME PACING. setFrameCap(fps) presents on a fixed cadence; 0
    // uncaps and restores the raw rAF behaviour. Default 30, matching
    // adaptiveBudgetMs. `refreshMs` is MEASURED from raw tick gaps
    // (the loop still wakes every vsync under a cap, so the skipped
    // ticks measure the display for free) -- check it before trusting
    // any arithmetic that assumes 60 Hz.
    // ---------------------------------------------------------------
    setFrameCap: (fps: number) => {
      ctx.boot.handle.setFrameCap(fps);
      return { frameCap: ctx.boot.handle.frameCap, refreshMs: ctx.boot.handle.refreshMs };
    },
    get frameCap() { return ctx.boot.handle.frameCap; },
    get refreshMs() { return ctx.boot.handle.refreshMs; },
    // DRAW CENSUS (spike program): per-frame draw/compute totals from the
    // renderer's info. This frame is MANY render() calls (one per pass), and
    // info auto-resets per call by default, so the seam flips autoReset off
    // and the caller samples then resets — one drawStats(true) per frame is
    // the per-frame total.
    drawStats(reset = false) {
      const info = ctx.boot.handle.renderer.info;
      info.autoReset = false;
      const out = {
        drawCalls: info.render.drawCalls,
        triangles: info.render.triangles,
        computeCalls: (info as unknown as { compute?: { drawCalls?: number } }).compute?.drawCalls ?? null,
      };
      if (reset) info.reset();
      return out;
    },
    // ---------------------------------------------------------------
    // DEFERRED RENDERER SEAM (M2 task 5). Everything is null-safe: on a
    // legacy boot they are no-ops / report the legacy mode, so a capture
    // script can call them unconditionally. diagnostics() is a bounded,
    // JSON-serialisable record for the task-6 gate: routes, unsupported
    // materials, light selection, shadow generation-vs-sampling counters
    // (deliberately SEPARATE toggles), sizes and errors.
    // ---------------------------------------------------------------
    get renderMode() { return ctx.boot.deferredMode ? 'deferred' : 'legacy'; },
    deferredDiagnostics: (): GameDeferredRendererDiagnostics | { mode: 'legacy' } =>
      ctx.boot.deferredApi ? ctx.boot.deferredApi.diagnostics() : { mode: 'legacy' as const },
    /** Shadow map GENERATION. false skips both raster passes; the boot
     *  ?spotshadow=0 seeds this. */
    setSpotShadow: (on: boolean) => ctx.boot.deferredApi?.setShadowGeneration(on),
    get spotShadow() { return ctx.boot.deferredApi?.diagnostics().shadow.generationRequested ?? null; },
    /** Diagnostic SAMPLING-only toggle: maps keep rendering, the lit stage
     *  ignores them. Its counter state lives in deferredDiagnostics().shadow
     *  (sampling flag vs renderedMaps — the two never conflate). */
    setSpotShadowSampling: (on: boolean) => ctx.boot.deferredApi?.setShadowSampling(on),
    /** The one exposure knob — scales the CONVERTED deferred lights without
     *  touching the source THREE lights (task 6/7 calibration seam). */
    setDeferredLightGain: (v: number) => ctx.boot.deferredApi?.setLightGain(v),
    setDeferredDebugView: (v: DeferredDebugView) => ctx.boot.deferredApi?.setDebugView(v),
    /** RAW G-buffer sample at an NDC point (composition review fix evidence
     *  seam): lets a gate assert the gun/hand SURFACE CHANNELS — not just
     *  metadata — follow setGunTuning on the live frame. Draws a still frame
     *  FIRST by default so the sample always reflects the CURRENT state;
     *  pass drawStill=false for BULK scans of an already-rendered locked
     *  frame (each still is a full render). Null-safe on legacy. */
    readSurfaceAt: (ndcX: number, ndcY: number, drawStill = true) => {
      if (!ctx.boot.deferredApi) return Promise.resolve(null);
      if (drawStill) ctx.boot.handle.drawOnce();
      return ctx.boot.deferredApi.readSurfaceAt(ndcX, ndcY);
    },
    /** Depth-gate color before FXAA/lens; null when presenting to canvas. */
    readCompositeAt: (ndcX: number, ndcY: number) => {
      if (!ctx.boot.deferredApi) return Promise.resolve(null);
      ctx.boot.handle.drawOnce();
      return ctx.boot.deferredApi.readCompositeAt(ndcX, ndcY);
    },
    /** BOUNDED MULTI-POINT surface sample (task-6 lattice scans): one
     *  readback set for up to 512 NDC points. Draws a still first so the
     *  samples reflect the current state. Null-safe on legacy. */
    sampleSurfacePoints: (points: Array<{ x: number; y: number }>) => {
      if (!ctx.boot.deferredApi) return Promise.resolve(null);
      ctx.boot.handle.drawOnce();
      return ctx.boot.deferredApi.sampleSurfacePoints(points);
    },
    /** WHOLE-G-buffer digest (task-6 regression-gate seam): four per-
     *  attachment FNV-1a digests over the logical texels plus the class
     *  histogram and depth extent, computed IN PAGE — raw attachments never
     *  cross CDP. Draws a still frame FIRST, so two consecutive calls are
     *  two SEPARATE renders of the current state — the no-change repeated-
     *  render control the gate needs — not one target read twice. Null on
     *  a legacy boot. */
    hashSurface: (): Promise<GameSurfaceHash | null> => {
      if (!ctx.boot.deferredApi) return Promise.resolve(null);
      ctx.boot.handle.drawOnce();
      return ctx.boot.deferredApi.hashSurface();
    },
    /** The boot's graphics level (`?graphics=high`) — which SHIPPED_UPSCALE entry was loaded.
     *  Not a setter: 'high' allocates the normal attachments + refine targets at boot. */
    graphics: (): GraphicsLevel => ctx.boot.graphics,
    /**
     * STARTUP ATTRIBUTION SEAM (2026-09-16). `bootMarks` are main()'s phase
     * marks (performance.now()), `warmDone` the warm-up's own sub-phase record,
     * `gpuDiagnostics` the device-loss / uncaptured-error channel, and
     * `loopRunning` the current rAF state (so a caller can prove the warm did
     * not restart a loop it had deliberately paused).
     */
    bootMarks: () => ctx.boot.marks.slice(),
    gpuDiagnostics: () => ctx.boot.handle.gpuDiagnostics,
    loopRunning: () => ctx.boot.handle.loopRunning,
    uptime: () => (performance.now() - ctx.boot.time) / 1000,
    /**
     * THE SURFACE 'bodies' COMPOSITES INTO, read back (2026-09-10).
     *
     * WHY THIS EXISTS. The march target and the composited output are DIFFERENT
     * textures, and the frame hash only ever read the former — which is why the
     * h/3 and h/4 investigation could prove the flesh is marched (3.9% of the
     * march target is surface at every divisor) and still not see that it never
     * reaches the frame. Chasing that without this seam means guessing, and three
     * guesses were already wrong.
     *
     * Returns the same padded float readback shape as `__sdfGameDebug`
     * .readMarchTarget() — base64 rgba32f plus the real width and height — because
     * a multi-megabyte float readback must not cross CDP as a returnByValue
     * object. WIDTH AND HEIGHT ARE THE LOGICAL ONES; the caller must de-pad with
     * `stride = Math.ceil(w * 16 / 256) * 64` floats, exactly as the hash does.
     *
     * Null when there is no redirect (nothing is rendering into an offscreen
     * target, so "the output" is the canvas — use presentedShot for that).
     */
    readOutputTarget: async (): Promise<{ w: number; h: number; rgba32f: string } | null> => {
      const rt = ctx.render.sdfLayer.outputTarget;
      if (!rt) return null;
      const w = rt.width, h = rt.height;
      const raw = new Float32Array(await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h));
      const bytes = new Uint8Array(raw.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { w, h, rgba32f: btoa(binary) };
    },

    warmDone: () => (window as unknown as Record<string, unknown>).__warmDone ?? null,
    /** DEFER-COMPILE (2026-09-19): the background-compile state machine —
     *  `{ gib, crowd }` each pending|compiling|ready|failed. A driver reads it
     *  to know whether a gib/crowd draw will use the fast path or degrade. */
    warmBackground: () => ctx.boot.warmBackground.snapshot(),
  };
}
