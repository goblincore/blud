# Blud — Task Tracker

> **Session start: read this file first.** It's the cross-cutting status board for the project.
> Per-milestone step-by-step tasks live inside each milestone's plan at `docs/superpowers/plans/`.
> Per-task execution state for M1 dispatch tasks lives in each file's YAML `status:` field at `~/.claude/dispatch/plans/`.
> This file tracks **coarse-grained state**: milestones, cross-cutting work, and reference docs.

## Legend

| Mark   | Meaning          |
| ------ | ---------------- |
| `[ ]`  | todo             |
| `[~]`  | in progress      |
| `[x]`  | done             |
| `[-]`  | deferred / punt  |
| `[!]`  | blocked          |

Task IDs use a letter-prefix + number scheme so they're greppable:

- `M<n>` — milestone (per-milestone granularity)
- `A<n>` — asset pipeline (cross-cutting dev work on placeholder/final assets)
- `R<n>` — research / reference (mostly done, kept as a reading list)
- `P<n>` — process / tooling (dispatch, CI, etc)

Subtasks append `.N`: `A5.1`, `A5.2`.

---

## Current focus

**M1 landed ✅ — browser smoke-test pending. Next: extract placeholder sprites (A5/A6) and write the M2 plan.**

- M1 plan: [docs/superpowers/plans/2026-04-20-blud-m1-engine-movement.md](docs/superpowers/plans/2026-04-20-blud-m1-engine-movement.md)
- M1 dispatch execution: all 11 tasks `status: done` (exit_code 0) between `2026-04-21T01:48Z` and `02:19Z`. Merged into main as commit `d05a306`.
- M1 automated verification: **19/19 vitest tests pass** (input, loop, player-motion — all TDD'd) and **`npm run build` succeeds cleanly**.
- M1 manual verification (`M1.11`): `npm run dev` → click canvas → confirm WASD/mouse-look/jump/collision in the browser. **Not yet done — do this before starting M2.**

---

## Task board

### Milestones

- `M1`  [x]  **Engine & Movement** — code merged (`d05a306`), 19/19 tests pass, build clean, browser smoke-test confirmed (WASD + mouse-look work)
- `M2`  [ ]  First kill (revolver + 1 enemy + voxel-gib MVP) — **next plan to write** via `superpowers:writing-plans`
- `M3`  [!]  One-kill feel pass (clay shader, decals, impact FX, audio) — blocked on M2
- `M4`  [!]  Full arsenal (Double-Wide, Dynamite, Cursed Phone) — blocked on M3
- `M5`  [!]  Full bestiary + **Phase 1 gate** (30min arena = fun) — blocked on M4
- `M6`  [!]  Chunks & generator (20 Blender chunks + run stitcher) — blocked on M5
- `M7`  [!]  The Algorithm boss fight — blocked on M6
- `M8`  [!]  Polish (music, audio pass, balance, HUD) — blocked on M7
- `M9`  [!]  Ship to itch.io — blocked on M8

### A — Asset pipeline (placeholders from Blood source, dev only)

- `A1`  [x]  RFF v3.1 FAT decryption (startKey = raw[0], XOR `((startKey + (i>>1)) & 0xFF)`)
- `A2`  [x]  BLOOD.PAL per-file content decryption (DICT_CRYPT flag `0x10` → XOR first 256 bytes with `(i>>1) & 0xFF`)
- `A3`  [x]  ART parser with column-major → row-major transpose; palette PNG dump
- `A4`  [x]  Contact-sheet generator (per-ART HTML, solid dark background, labeled tile numbers)
- `A5`  [x]  **Extract axe-zombie full sprite set → `public/assets/enemies/zombie-placeholder/`** — 89 frames, tile range **1170–1258** (visually confirmed), covers idle/walk/attack/death. Manifest + per-frame PNGs copied; animation segmentation is approximate and needs SEQ-file verification during M2 billboard wiring.
- `A6`  [x]  **Extract gib chunk pool → `public/assets/gibs-placeholder/`** — 27 frames total:
  - Blood chunk family **2154–2158** (5 FX_13 variants)
  - Shared human body chunks: **1267/1268/1269/1454/1456** (head/arm/leg/torso/spine)
  - Severed zombie head rotation **3405–3421** (17 bouncing-head frames)
- `A6.5` [ ]  Compose sprite sheets + refine manifest angle/animation metadata once M2 plan defines the billboard loader shape
- `A7`  [-]  Voxelization pipeline (.vox per enemy for Rapier gib explosion) — **deferred to M2 prep**
- `A8`  [-]  Clay shader / post-process (dither, pixelation, chromatic aberration on hit) — **deferred to M3**

### R — Research / reference (done — reading list)

- `R1`  [x]  NotBlood tuning values (enemy HP, damage, gib threshold=160, knockback, speeds) → [docs/tuning-sources.md](docs/tuning-sources.md)
- `R2`  [x]  Gib picnum map (32 tiles across ART files) → [docs/tuning-sources-gibs.md](docs/tuning-sources-gibs.md)
- `R3`  [x]  Sprite extraction toolchain overview → [docs/dev-notes/2026-04-20-blood-sprite-extraction.md](docs/dev-notes/2026-04-20-blood-sprite-extraction.md)
- `R4`  [x]  Blood palette canonical decoding → [docs/dev-notes/2026-04-21-blood-palette-decoding.md](docs/dev-notes/2026-04-21-blood-palette-decoding.md)

### P — Process / tooling

- `P1`  [x]  Dispatch-UI setup (11 M1 tasks staged + all completed + merged)
- `P2`  [ ]  Write M2 plan via `superpowers:writing-plans` once browser smoke-test passes
- `P3`  [-]  CI / GitHub Actions — defer until there's meaningful code to test
- `P4`  [ ]  Dependency audit — `npm audit` flagged 6 vulns (1 critical). Skim before M2; probably transitive and safe to ignore for a web build
- `P5`  [-]  Prune old `dispatch/blud-m1-task-*` branches after M1 smoke-test passes (kept for now as safety-net)

---

## Process notes for future sessions

- **Completing a task:** flip `[ ]` → `[x]`, commit. If it produced a non-obvious insight, save a dualmem memory (`~/go/bin/dualmem add --type decision|warning ...`).
- **Discovering a new task:** give it the next available number in the right section, add a one-line description, commit.
- **Starting a session:** read [CLAUDE.md](CLAUDE.md) → this file → scan the `[~]` and `[ ]` entries → pick one.
- **Plans vs this file:** detailed step-by-step tasks live in `docs/superpowers/plans/` (each plan = one milestone). This file stays coarse-grained; don't duplicate plan steps here.
- **Design questions:** re-read [docs/superpowers/specs/2026-04-20-blud-design.md](docs/superpowers/specs/2026-04-20-blud-design.md) before adjusting scope.
