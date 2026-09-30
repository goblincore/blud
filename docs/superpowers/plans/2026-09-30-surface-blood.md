# Persistent surface blood Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [x]`) syntax.

**Goal:** Deposited blood remains attached to floors, walls and static art after airborne goo disappears, with wet splash, dry stain and smear appearances.

**Spec:** `docs/superpowers/specs/2026-09-30-surface-blood-design.md` — read it first.

**Architecture:** Pure triangle queries, clipped decal projection and a bounded stain ledger hold collision/placement/lifetime data. A renderer bridge reads the level meshes, batches projected geometry and binds a hand-written WGSL surface mask to the existing lighting path. Surface mode is opt-in and the existing no-toggle sim is preserved.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts (`scripts/*.mjs`).

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
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is
  symlinked — do not reinstall.
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

## Task 1 — Pure impacts and stain state
Files: blood-surface.ts/test, blood-sim.ts/test.
- [x] Build bounded triangle index, swept nearest surface hit, receiver clipping and seeded stain shape/direction.
- [x] Add optional collision/deposit callback to blood simulation, preserving old behavior when absent.
- [x] Verify wall/floor hits, no fake expiry stamps, normal clipping, deterministic caps and off parity.

## Task 2 — WGSL appearance and renderer integration
Files: surface-blood.wgsl.ts, surface-blood-view.ts, game-state-vfx.ts, game-main.ts, game-seams-fx.ts.
- [x] Bind lit wetness, shape, bump and smears; batch per room/receiver.
- [x] Add opt-in boot flag and console seams; keep stains independent of airborne goo and bleed toggles.
- [x] Add a small comparison UI and deterministic showcase seam.

## Task 3 — Verification and evidence
Files: scripts/sdf-game-surface-blood-gate.*, docs/dev-notes/2026-09-30-surface-blood/notes.md.
- [x] Focused tests and TypeScript.
- [x] Warm-ready headless default-renderer captures: attachment/persistence, toggle A/B and finite buffers.
- [ ] Deferred capture: blocked by the same MeshBasicNodeMaterial fragment-output pipeline error on unchanged base eec99cca5. Baseline failure recorded; renderer repair is outside this task.
- [x] Inspect screenshots and measure cold boot vs base with fresh profiles; document limits.
