# Grenade Launcher FPV Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [x]`) syntax.

**Goal:** Build and integrate a gothic single-shot break-action FPV prototype.

**Spec:** `docs/superpowers/specs/2026-09-29-grenade-launcher-design.md` — read it first.

**Architecture:** Pure launcher timing/state supplies pose and cartridge beats to a renderer module. Reuse the existing Standard-material GLB/arm pipeline; no new shader effect.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest,
headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production
  scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**
    (no `three` import; plain data in, plain data out — the `burn-state`,
    `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module
    only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string
    modules). TSL node graphs are for thin glue (binding, blending), not for
    the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module —
    never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no
    wall-clock in logic) and console/capture seams in plain data.
- Work in the user-authorized checkout; preserve unrelated untracked plans. Never `git stash` or reinstall dependencies.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`.
  Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
  Capture scripts require `window.__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance,
  frame-to-frame change, GPU ms, boot time) and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders or materials reports
  cold-boot `drawOnce` against the base branch (fresh profile each run).
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a
  light's `.visible`. Never sample the render target you are writing. In
  `march.wgsl.ts`'s positional uniform lists never put a `:` inside a comment.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

## Task 1 — model
- [x] Reproducible Blender script, editable source, textured GLB and model renders.
- [x] Verify moving-node hierarchy, hollow bore, triangle count and size.

## Task 2 — motion and integration
- [x] Pure single-shot cycle/reload pose tests, renderer and reused arms.
- [x] Opt-in slot 4, controls and diagnostics.

## Task 3 — evidence
- [x] Focused tests and TypeScript, headless visual/cycle gate.
- [x] Inspect images, record limits and follow-up pass.

## Task 4 — owner correction: readable breech
- [x] Present the action sideways and pitch it before opening; keep the loading presentation fixed through seating.
- [x] Make the bore interior matte/dark so an empty chamber reads as open.
- [x] Inspect revised empty-breech/load frames and regenerate review clip; targeted tests and TypeScript.

## Task 5 — owner correction: forestock grip
- [x] Remove the latch reach; hold the moving forestock through opening and extraction, then fetch/load.
- [x] Verify support-grip contact in the runtime gate, inspect revised motion and regenerate the review clip.
