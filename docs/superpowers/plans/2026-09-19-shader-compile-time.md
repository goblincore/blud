# Shader Compile Time — Measurement Plan (step 1 of the compile-time work)

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax. **MEASURE ONLY** — this plan changes no rendering behaviour.

**Goal:** Find out exactly where cold-boot shader compile time goes in the SDF game (`/sdf-game.html`) and what causes the intermittent 100–135 s cold boots, so the fix (fewer/smaller march variants, a staged warm-up) is chosen from numbers.

**Background:**
- Cold boots on this Mac are usually ~1.3–6 s (`__warmDone.phases.drawOnce` / `__warmDone.ms`), but intermittently take **100–135 s** even with the warm-up fixes (`028ece84` awaits the async march compile before `drawOnce`; `87b8f71c` precompiles the gib/chunk march variant). Seen in `docs/dev-notes/2026-09-18-march-split/NOTES.md` ("Cold boot — interleaved A/B": one base run `warmMs 135434`). During those boots `MTLCompilerService` sits at ~100% CPU; a browser tab that stalls this way often never recovers (device lost / blank page).
- ~205 pipelines are created at boot. The march shader (`webgpu/march.wgsl.ts`, now a barrel over `webgpu/march/`) is ~277 KB of WGSL and its body entry is one ~2,100-line function with ~100 positional params, so each march variant is a very large Metal compile.
- Existing tools: `webgpu/pipeline-log.ts` (pipeline creation log; read its header), `webgpu/warm-gate.ts`, `scripts/boot-time.mjs` (fresh-profile cold boot → `{drawOnce, warmMs}`), `scripts/sdf-demo-hash.mjs`.
- Release target is a Rust + wgpu port (production scope §4.6), so findings about variant structure matter beyond the browser.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless Chrome via CDP.

## Rules for every task

- **Port-ready by construction:** logic in pure renderer-free tested modules; load-bearing rendering in hand-written WGSL; state on `ctx` or in a feature module; deterministic sim; plain-data seams. (Instrumentation here should be a plain-data seam.)
- **MEASURE ONLY.** Do not change shaders, materials, variant keys or the warm-up order. Instrumentation must be default-off or zero-cost (behind a URL flag such as `?pipelinelog=1` or the existing seam), and `scripts/march-hash.mjs` must stay identical.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`. Pre-existing failures (also on main): `game-actor-torso-slug` (2), `march-step-soundness` "near-wound step multiplier" (1), `surface-nets-cpu` "BAND COVERAGE" (1).
- Headless capture only. **Every cold boot uses a FRESH `--user-data-dir`** (a warm profile hides the problem). Another agent may be using the GPU in parallel — record wall-clock time of each run so contention can be spotted, and never run two of your own boots at once.
- Kill anything you start outside a script in the same step. `game-main.ts` must keep `ctx` as its only `main()` state binding (`npm test -- game-context-coverage`).
- Commit with the trailer `Co-Authored-By: DeepSeek Flash <noreply@deepseek.com>`.

---

## Task 1: Per-pipeline compile census + the slow-boot reproduction

**Files:**
- Modify (instrumentation only): `src/lab/sdf-zombie/webgpu/pipeline-log.ts` (+ test) and, if needed, one seam in `game-seams-*.ts`
- Create: `scripts/compile-census.mjs`
- Notes: `docs/dev-notes/2026-09-19-shader-compile/NOTES.md` (+ `census.json`)

- [ ] **Step 1: Read the existing tools.** `pipeline-log.ts` (what it records, how it is enabled), `warm-gate.ts` (the warm-up phases and what `drawOnce` covers), `scripts/boot-time.mjs`. Write down in the notes what is already measurable.
- [ ] **Step 2: Per-pipeline timing.** Make the pipeline log record, per render/compute pipeline created during boot: a stable label (material name / pass label), whether it was created sync or async (`createRenderPipelineAsync`), wall time from request to ready (for async: promise resolution; for sync: the call's own duration), the WGSL byte length of its vertex + fragment/compute modules, and a variant key (three's render cache key or the material's `customProgramCacheKey` / node cache key — whatever distinguishes two march variants). Expose it as plain data via a seam (e.g. `__sdfGame.pipelineCensus()`), off unless `?pipelinelog=1`.
- [ ] **Step 3: Census script.** `scripts/compile-census.mjs [runs]`: own vite + headless Chrome, FRESH profile per run, load `/sdf-game.html?pipelinelog=1`, wait for `__warmGate.phase` to be `ready` (or a 240 s timeout — record which), then dump the census plus `__warmDone`. Run **6 cold boots** sequentially. Save `census.json`.
- [ ] **Step 4: Analyse and report.** In the notes:
  - Top 15 pipelines by compile time (median over runs) with label, variant key, WGSL bytes, sync/async.
  - **Every march-family pipeline** (anything built from `march/` sources: body, refine, chunk/gib, depth prepass, crowd, deferred, cone march): how many distinct variants, total compile ms, and — by diffing their variant keys / WGSL — **what makes each variant different** (which define, flag, uniform count or include list).
  - Share of total boot compile time that is march-family vs everything else.
  - For any SLOW run (warmMs > 30 s): which pipeline(s) were outstanding when the time went, and whether their compile time itself ballooned or they waited behind others. Is it one pathological variant, or everything slowing uniformly?
  - Correlation of compile time with WGSL size across the march variants.
- [ ] **Step 5: Recommendation, ranked by expected boot-time win, with the evidence for each:** e.g. collapse variant X and Y (runtime uniform instead of compile-time branch), stop compiling variant Z at boot (lazy + background), shrink the march function (phase 2 of `docs/superpowers/specs/2026-09-18-march-wgsl-refactor-design.md`), stage the warm-up (compile what frame 1 needs, then the rest in the background). Do NOT implement any of them.
- [ ] **Step 6: Gates + commit.** `npm test -- pipeline-log game-context-coverage` + `npx tsc --noEmit`; `march-hash` room 1 unchanged vs `docs/dev-notes/2026-09-18-march-split/NOTES.md`. Commit the script, instrumentation, notes and `census.json`.
