# Defer the Gib + Crowd March Compiles Off the Loader — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cut the cold boot (a march-shader change or a Chrome/driver update) from ~198 s to ~50 s by compiling the gib/chunk march variant and the crowd march variant in the BACKGROUND after the game is playable, instead of behind the loader — without ever compiling them synchronously mid-game and without enemies or gibs vanishing while they compile.

**Evidence:** `docs/dev-notes/2026-09-19-shader-compile/NOTES.md` (read it all). A cold boot is exactly four ~48 s serialized compiles, one per distinct (march shape × render target): **body** (rgba32float), **crowd** (rgba32float, 5-location instanced), **chunk/gib in the march MRT** (rgba32float) and **chunk/gib in the gib shutter** (rgba16float). Recommendations (1) and (2) there are this plan. The warm-up is `warmPipelines` in `src/lab/sdf-zombie/webgpu/game-main.ts` (search `THE GIB / CHUNK MARCH VARIANT`, `phases.asyncFirst`, `phases.gibVariant`); the precompile helpers are `ctx.render.sdfLayer.precompilePasses` and `ctx.gibs.shutter.precompileSubject`.

**Why it is in the loader today (do not regress this):** `87b8f71c` moved the gib variant into the warm-up because the first dismemberment built it SYNCHRONOUSLY mid-game: a 47.8 s freeze (plus a second stall) with a cold Metal cache, and the same GPU-watchdog exposure that loses the device. The comments above the warm-up also record that a pipeline queued by `compileAsync` reads as NOT READY and three SKIPS the draw rather than stalling — that skip is the mechanism to lean on.

**Architecture:** Split the warm-up into a **boot set** (what frame 1 needs: body march, level, gun, post chain, fire pass) awaited behind the loader, and a **background set** (gib/chunk in both targets, crowd) started right after `ready` with the same async precompile calls, never awaited by the loader. While a background program is not ready, the feature using it must degrade (skip a draw, or use an already-compiled path), never trigger a synchronous compile.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL, Vitest, headless Chrome via CDP.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):** logic in pure renderer-free tested modules (the "is this program ready / what do I do if not" decision is a good pure unit); load-bearing rendering in hand-written WGSL; state on `ctx` or inside a feature module — never new `main()` bindings (`npm test -- game-context-coverage`); deterministic sim; plain-data seams.
- **No shader text changes.** `scripts/march-hash.mjs` room 1 must stay `8f2b74e71ff18dd04a99c05fe19392b96dd80c9d`; the march golden (`npm test -- march-golden`) must pass untouched.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** plus `npx tsc --noEmit`. Pre-existing failures (also on main): `game-actor-torso-slug` (2), `march-step-soundness` "near-wound step multiplier" (1), `surface-nets-cpu` "BAND COVERAGE" (1).
- Headless capture only. **Boot time is the gate**, and a fresh `--user-data-dir` is NOT enough to get a cold boot — the Metal cache is machine-global. Use the census's documented method: a TRANSIENT constant change in `march/math.wgsl.ts` (`hash13`'s `0.1031` → `0.10311`), boot, then REVERT immediately and confirm with `git diff -- src/lab/sdf-zombie/webgpu/march/` (empty) and `shasum`. Never commit it. Each cold boot costs minutes: plan your runs.
- `scripts/compile-census.mjs` and `__sdfGame.pipelineCensus()` (`?pipelinelog=1`) are your instruments.
- Kill anything you start outside a script in the same step.
- Commit with the trailer `Co-Authored-By: DeepSeek Flash <noreply@deepseek.com>`.

---

## Task 1: Boot set vs background set, with safe degradation

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (warm-up only: `warmPipelines` and its caller), plus whichever module owns "is the chunk/crowd program ready" (find it: the chunk view / gib shutter / crowd type draw paths)
- Create: a small pure module for the background-compile state machine (e.g. `webgpu/warm-background.ts` + test): states `pending → compiling → ready | failed`, what each consumer does per state
- Modify: `scripts/compile-census.mjs` only if a new measurement needs it
- Notes: `docs/dev-notes/2026-09-19-defer-compile/NOTES.md`

- [ ] **Step 1: Map the consumers.** For the gib/chunk variant and the crowd variant, find every draw path that uses them, and answer in the notes: (a) if the pipeline is not ready at draw time, does three currently skip the draw, or build it synchronously? (the notes above say `compileAsync`-queued pipelines are skipped; confirm for THESE materials, both render targets); (b) for crowd: is there an already-compiled fallback (per-body views draw through the body program) that crowd members can use until the crowd program is ready? Which rooms spawn a crowd at boot (the default boot room / `?room=`)?
- [ ] **Step 2: Pure state machine + tests.** Write the background-compile tracker (pure, no three import): `start(name)`, `settle(name, ok)`, `state(name)`, plus the policy the consumers call (`gibDraw: 'draw' | 'skip'`, `crowdPath: 'crowd' | 'fallback'`). Test it first.
- [ ] **Step 3: Split the warm-up.** Remove the gib warm view + `precompileSubject` and the crowd precompile from the loader-awaited path; start them right after `__warmGate` reaches `ready` (after the loader hides), as async compiles that nothing awaits, reporting into the tracker. Keep the body march, drawOnce and the rest of the boot set exactly as is. `__warmDone.phases` gains `backgroundStart`/`backgroundDone` per program so a script can read when each settled.
- [ ] **Step 4: Degrade, never stall.**
  - Gibs while the chunk program is not ready: pieces must not trigger a synchronous compile. Acceptable: skip drawing the pieces (they still simulate) and show them once ready; better, if cheap: keep the body drawn a moment longer. State which in the notes.
  - Crowd while the crowd program is not ready: members must stay VISIBLE. If a per-body fallback exists (Step 1b), route them through it; if not, keep the crowd compile in the boot set **for rooms that spawn a crowd at boot** and defer it only otherwise — say which you did and why.
- [ ] **Step 5: Measure (cold, via the transient-constant method).** Two cold boots before (base branch state) and two after, each reverted immediately:
  - loader hidden / `ready` time (`warmMs`) — target ~50 s cold (from ~198 s);
  - when each background program settled;
  - trigger a dismemberment (`__sdfGame` has gib/dynamite/slug seams — find one, e.g. `fireSlug` at a body) **(a) before** the chunk program is ready and **(b) after**: record the longest frame for each (must be < 100 ms: no synchronous compile — confirm with `pipelineCensus()` that no `createRenderPipeline` (sync) for a march-family module happened mid-game);
  - one warm boot before/after (must be within noise, ~3–8 s).
- [ ] **Step 6: Gates + commit.** `npm test -- <your new test> game-context-coverage march-golden pipeline-log` + `npx tsc --noEmit`; `march-hash` room 1 unchanged; `git diff -- src/lab/sdf-zombie/webgpu/march/` empty. Notes with every number and the Step 1 answers. Commit.
