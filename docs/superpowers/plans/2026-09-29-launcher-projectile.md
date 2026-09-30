# Launcher Projectile Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add arcing, bouncing and flesh-embedding grenades with explosive/fragment damage.

**Spec:** `docs/superpowers/specs/2026-09-29-launcher-projectile-design.md`.

**Architecture:** Pure swept collision, fixed-step flight, fuse and primitive attachment modules feed a pooled world renderer. The launcher emits from its live muzzle, and delegates detonation to the existing blast pipeline.

**Tech Stack:** TypeScript, three.js WebGPU, existing WGSL VFX, Vitest, headless Chrome.

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

## Task 1 — pure physics and attachment
**Files:** `src/lab/sdf-zombie/grenade-flight.ts`, `grenade-collision.ts`, `grenade-attachment.ts` and tests.
- [x] Sweep world/actor contacts, integrate gravity/bounce/rest/fuse with fixed steps, deterministic fragments.
- [x] Test thin walls, nearest-hit ordering, fuse, frame partitions, arc, flesh embed and attachment loss.

## Task 2 — game integration
**Files:** `webgpu/game-launcher-projectiles.ts`, `game-launcher-view.ts`, `game-main.ts`, `game-seams-fire.ts`.
- [x] Pool projectile/fragment visuals before warm-up, emit from live muzzle using free aim.
- [x] Route blast and fragment wounds; follow posed flesh and keep simulation active when holstered.

## Task 3 — evidence
**Files:** `scripts/sdf-game-grenade-gate.*`, `docs/dev-notes/2026-09-29-launcher-projectile/`.
- [x] Focused tests and TypeScript; runtime arc/bounce/embed/damage/expiry gate and inspected captures/clip.
- [x] Sequential fresh-profile boot measurements against accepted FPV commit; notes, task board and DualMem checkpoint.
