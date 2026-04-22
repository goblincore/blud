# Blud — Task Tracker

> **Session start: read this file first.** It's the cross-cutting status board.
> Per-milestone step-by-step tasks live in `docs/superpowers/plans/`.
> This file is **coarse-grained state only** — keep rows to ≤2 lines and link out for detail.

## Legend

| Mark | Meaning | | Prefix | Scope |
|------|---------|---|--------|-------|
| `[ ]` | todo | | `M<n>` | milestone |
| `[~]` | in progress | | `A<n>` | asset pipeline |
| `[x]` | done | | `R<n>` | research / reference |
| `[-]` | deferred | | `F<n>` | feel / physics tuning |
| `[!]` | blocked | | `P<n>` | process / tooling |

Subtasks use `.N`: `A5.1`, `F1.gibs`.

---

## Current focus

**M3 in flight** — plan at [docs/superpowers/plans/2026-04-21-blud-m3-feel-pass.md](docs/superpowers/plans/2026-04-21-blud-m3-feel-pass.md). Phases 1+2+4 + P6 + P7 merged. Tasks 7/8/9 + SFX map fix + Task 11 (palette-dither) + Task 12 (damage-pulse CA) + Task 13 (scanlines+barrel) all landed (`6c59491`). THROW_GRUNT disabled (`b5fa380` — CALEBM~1 had a bleed). Ambient parked at mute (1WIND baked too hot). **Next session: Task 14 bone-weight playtest (kill ~10 zombies, count bone:flesh ratio; bump/drop [boneWeight](src/game/gibs/tuning.ts:157) from 0.2 if outside 15-25%), then Task 15 M3 acceptance. Optional: Task 10 proper ambient (normalize 1WIND via `ffmpeg -filter:a loudnorm` OR swap for quieter AMB*).**

Key reference docs (open these before touching their area):
- Design spec — [docs/superpowers/specs/2026-04-20-blud-design.md](docs/superpowers/specs/2026-04-20-blud-design.md)
- NotBlood source map — [docs/dev-notes/2026-04-22-notblood-source-reference.md](docs/dev-notes/2026-04-22-notblood-source-reference.md)
- Animation system — [docs/dev-notes/2026-04-21-animation-system.md](docs/dev-notes/2026-04-21-animation-system.md)

---

## Milestones

- `M1`  [x]  Engine & Movement — `d05a306`
- `M2`  [x]  First kill + F1 dynamite port — `d721ed7`, playtest 2026-04-21
- `M3`  [~]  One-kill feel pass — in flight (plan above)
- `M4`  [!]  Full arsenal (Double-Wide, Cursed Phone, etc) — blocked on M3
- `M5`  [!]  Full bestiary + Phase 1 gate (30min arena = fun) — blocked on M4
- `M6`  [!]  Chunks & generator (Blender chunks + run stitcher) — blocked on M5
- `M7`  [!]  The Algorithm boss fight — blocked on M6
- `M8`  [!]  Polish (music, balance, HUD) — blocked on M7
- `M9`  [!]  Ship to itch.io — blocked on M8

## Asset pipeline

- `A1-A6`, `A9`, `A10`, `A11`  [x]  RFF/PAL/ART decoding, sprite extraction (axe-zombie, gibs, dynamite), animation system port, arena reskin — see git log + dev-notes
- `A6.5`  [x]  ~~Manual sprite sheets~~ — superseded by `A10` (QAV + SEQ manifests)
- `A7`    [-]  Voxelization pipeline (.vox per enemy) — deferred past M2
- `A8`    [-]  Clay shader / post-process — rolled into M3 feel pass

## Research / reference (reading list)

- `R1`   [x]  NotBlood tuning values → [docs/tuning-sources.md](docs/tuning-sources.md)
- `R2`   [x]  Gib picnum map → [docs/tuning-sources-gibs.md](docs/tuning-sources-gibs.md)
- `R3`   [x]  Sprite extraction toolchain → [docs/dev-notes/2026-04-20-blood-sprite-extraction.md](docs/dev-notes/2026-04-20-blood-sprite-extraction.md)
- `R4`   [x]  Blood palette decoding → [docs/dev-notes/2026-04-21-blood-palette-decoding.md](docs/dev-notes/2026-04-21-blood-palette-decoding.md)
- `R5`   [x]  Blood .MAP format + texture/asset co-occurrence → [docs/dev-notes/2026-04-21-blood-map-research.md](docs/dev-notes/2026-04-21-blood-map-research.md) (`4c0a0cf`)
- `R5.1` [x]  Vision-pass family labels + archetype clustering (addendum in R5's dev-note)
- `R6`   [x]  NotBlood source-code map + investigation recipe → [docs/dev-notes/2026-04-22-notblood-source-reference.md](docs/dev-notes/2026-04-22-notblood-source-reference.md)

## Feel / physics tuning

- `F1`       [x]  Dynamite throw arc + bundle sprite + sRGB fix — `18fca04` + follow-ups
- `F1.gibs`  [ ]  Port `actor.cpp` + `fx.cpp` gib constants into `src/game/gibs/tuning.ts`
- `F2`       [ ]  Broad feel sweep — audio table, palookup hit flash, AI timing, screenshake, decal growth. Revisit after M3 playtest; split into subtasks once prioritized.

## Process / tooling

- `P1`  [x]  Dispatch-UI setup (M1 tasks completed + merged)
- `P2`  [x]  Write M2 plan via `superpowers:writing-plans`
- `P3`  [-]  CI / GitHub Actions — defer until meaningful test coverage exists
- `P4`  [ ]  Dependency audit — `npm audit` flags 6 vulns (1 critical); likely transitive, safe for a web build
- `P5`  [-]  Prune old `dispatch/blud-m1-task-*` branches
- `P6`  [ ]  Theme-preview schema merge — write `scripts/build_theme_patterns.py` to join raw families + `labels.json` into the `{texture_families, map_archetypes}` shape that [theme-preview.ts](src/dev/theme-preview.ts) expects. R5.1 sidecar.
- `P7`  [x]  BUNFUSE extraction + cooking visual — `dynamite-fuse-burn.json`, `7081c14`

---

## Process notes

- **Completing a task:** flip `[ ]` → `[x]`, **collapse the row to a one-liner** (detail goes in the commit message + a dualmem checkpoint), commit.
- **Discovering a new task:** next available number in the right section, **one line**, commit.
- **Task rows are ≤2 lines.** If context needs more, put it in a linked dev-note / plan doc and leave a bare link on the row.
- **Milestone rollup:** when a milestone lands, collapse per-task detail into a single line with the commit range; the plan file + git log hold the rest.
- **Design questions:** re-read the design spec above before adjusting scope.
