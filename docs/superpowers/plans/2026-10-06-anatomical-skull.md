# Anatomical skull Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace forward humanoid enemy skulls with a simplified anatomical skull, preserving named fracture pieces and baked detail.

**Spec:** `docs/superpowers/specs/2026-10-06-anatomical-skull-design.md` — read it first.

**Architecture:** Blender builds stable named pieces and a shared normal atlas offline. Pure data describes piece pivots and bounds; existing actor bone meshes remain the integration seam.

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

## Task 1 — asset generation

**Files:** `scripts/simplify_anatomical_skull.py`, `public/assets/lab/anatomical-skull.{glb,json}`, ignored `.scratch/anatomical-skull/`, `docs/dev-notes/2026-10-06-anatomical-skull/NOTES.md`.

- [x] Inspect source transforms, animation and provenance.
- [x] Decimate independently while keeping anatomical boundaries.
- [x] Bake normal detail; export GLB, Blender scene and piece metadata.
- [x] Inspect assembled, exploded and wireframe previews; verify budgets and export roundtrip.

## Task 2 — review and integration

- [x] Resolve permission for distributing the modified source. User confirmed separate permission on 2026-10-06.
- [x] Fit skull behind humanoid flesh, retain existing eye placements and inspect game captures.
- [x] Integrate fracture state in pure tested logic, then renderer and gib physics; measure game captures and boot.

Implemented in the attached anatomical-skull worktree on `codex/anatomical-skull`. Primary checkout unchanged; no merge. See the linked dev notes for measurements, verification and scope limits.
