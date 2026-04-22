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

**M1–M2 landed ✅. R5 merged ✅. F1 dynamite port ✅. Next: R5.1 vision pass + M3 planning.**

- M1 plan: docs/superpowers/plans/2026-04-20-blud-m1-engine-movement.md — done, merged `d05a306`
- M2 plan: docs/superpowers/plans/2026-04-21-blud-m2-first-kill.md — code merged `d721ed7`, playtest signed off 2026-04-21 after F1 port (throw math + single-bundle sprite + sRGB fix).
- Animation system: docs/superpowers/plans/2026-04-21-blud-animation-system.md — landed, 124/124 tests green.
- R5 research: docs/dev-notes/2026-04-21-blood-map-research.md — merged `4c0a0cf`. 39-map parse + 181 texture families + theme template schema for M6.
- F1 feel-port: `18fca04` + follow-ups. Real Blood throw math (14 m/s max, 30° pitch-lob) + correct bundle sprite (picnum 3433) + three.js sRGB color-space fix. Playtest feels good.

---

## Task board

### Milestones

- `M1`  [x]  **Engine & Movement** — code merged (`d05a306`), 19/19 tests pass, build clean, browser smoke-test confirmed (WASD + mouse-look work)
- `M2`  [x]  **First kill** — code merged `d721ed7`, playtest signed off 2026-04-21. 131/131 tests green. F1 dynamite port + sRGB color fix landed in follow-ups.
- `M3`  [ ]  One-kill feel pass (clay shader, decals fade, impact FX polish, audio pass). **Next up — write plan via `superpowers:writing-plans`.**
- `M4`  [!]  Full arsenal (Double-Wide, Dynamite, Cursed Phone) — blocked on M3
- `M5`  [!]  Full bestiary + **Phase 1 gate** (30min arena = fun) — blocked on M4
- `M6`  [!]  Chunks & generator (20 Blender chunks + run stitcher) — blocked on M5. **Pre-work**: `R5` researches Blood `.MAP` binary format + texture/asset co-occurrence patterns so procgen can use Blood-style texture/sprite palettes without rendering Blood geometry verbatim.
- `M7`  [!]  The Algorithm boss fight — blocked on M6
- `M8`  [!]  Polish (music, audio pass, balance, HUD) — blocked on M7
- `M9`  [!]  Ship to itch.io — blocked on M8

### A — Asset pipeline (placeholders from Blood source, dev only)

- `A1`  [x]  RFF v3.1 FAT decryption (startKey = raw[0], XOR `((startKey + (i>>1)) & 0xFF)`)
- `A2`  [x]  BLOOD.PAL per-file content decryption (DICT_CRYPT flag `0x10` → XOR first 256 bytes with `(i>>1) & 0xFF`)
- `A3`  [x]  ART parser with column-major → row-major transpose; palette PNG dump
- `A4`  [x]  Contact-sheet generator (per-ART HTML, solid dark background, labeled tile numbers)
- `A5`  [x]  **Extract axe-zombie full sprite set → `public/assets/enemies/zombie-placeholder/`** — 89 frames, tile range **1170–1258** (visually confirmed), covers idle/walk/attack/death. Manifest + per-frame PNGs copied. M3 supersession: new animation system (QAV + SEQ manifests) replaces approximate segmentation; see A10.
- `A6`  [x]  **Extract gib chunk pool → `public/assets/gibs-placeholder/`** — 27 frames total:
  - Blood chunk family **2154–2158** (5 FX_13 variants)
  - Shared human body chunks: **1267/1268/1269/1454/1456** (head/arm/leg/torso/spine)
  - Severed zombie head rotation **3405–3421** (17 bouncing-head frames)
- `A9`  [x]  Extract M2 placeholders (dynamite bundle, explosion fireball, blood trail droplet)
- `A6.5` [x]  ~~Compose sprite sheets + refine manifest angle/animation metadata~~ — Superseded by animation system (2026-04-21), see A10.
- `A7`  [-]  Voxelization pipeline (.vox per enemy for Rapier gib explosion) — **deferred to M2 prep**
- `A10` [x]  **Animation system port (QAV + SEQ)** — see docs/superpowers/plans/2026-04-21-blud-animation-system.md and docs/dev-notes/2026-04-21-animation-system.md
- `A11` [x]  **Arena reskin — Blood 'crypt stone' family** — picnums 449 (floor, rusty stone), 458 (walls, grey striated), 273 (obstacles, bloody stone). Extracted from tiles001.art per R5 findings. Open-sky (no ceiling) + dusky-red gradient skybox matching Blood/Weird-West mood. Landed 2026-04-21.
- `A8`  [-]  Clay shader / post-process (dither, pixelation, chromatic aberration on hit) — **deferred to M3**

### R — Research / reference (done — reading list)

- `R1`  [x]  NotBlood tuning values (enemy HP, damage, gib threshold=160, knockback, speeds) → [docs/tuning-sources.md](docs/tuning-sources.md)
- `R2`  [x]  Gib picnum map (32 tiles across ART files) → [docs/tuning-sources-gibs.md](docs/tuning-sources-gibs.md)
- `R3`  [x]  Sprite extraction toolchain overview → [docs/dev-notes/2026-04-20-blood-sprite-extraction.md](docs/dev-notes/2026-04-20-blood-sprite-extraction.md)
- `R4`  [x]  Blood palette canonical decoding → [docs/dev-notes/2026-04-21-blood-palette-decoding.md](docs/dev-notes/2026-04-21-blood-palette-decoding.md)
- `R5`  [x]  **Blood `.MAP` format + texture/asset co-occurrence research** — `scripts/map_parser.py` (v7 parser with dbCrypt + X-struct bitstreams), `scripts/analyze_maps.py` (39 maps → patterns.json), `docs/dev-notes/2026-04-21-blood-map-research.md` (findings + JSON schema for M6 procgen). 181 texture families; 8.1% special sectors; heavily looped maps; 72% enemies in large+ sectors.
- `R5.1` [x]  **Vision-pass on R5 outputs** — follow-up to R5. Two tasks best handled by a vision-capable model (rather than pure logic): (a) auto-label each texture family with a human-readable name by showing the cluster's constituent tile PNGs ("crypt stone with bone trim", "rusty industrial"); (b) render each Blood `.MAP` as a top-down PNG and cluster maps by layout style ("hub-and-spokes", "corridor chain", "arena-with-sidekicks"). Model options: GLM-4V / 4.5V (same z.ai stack), or Kimi K2 (2.6) if we want to test that. Requires R5 to land first so it has the family-cluster JSON + per-map geometry to render. Output: labels appended to `patterns.json` + a short addendum to R5's dev-note.

### F — Feel / physics tuning (transcribe Blood constants into Rapier config)

- `F1`  [x]  **Dynamite throw arc + bundle sprite + sRGB fix** — landed in session 2026-04-21. Ported Blood's `actFireThing` math: min/max velocity 3–14 m/s (was 3–6.5 — tuning comment had wrong interpretation of `mulscale30(nSpeed, cos)`); pitch-relative 30° upward lob via `throwVector()` (was a flat `+2.5` y-kicker). Swapped projectile from wrongly-labelled spray can (3467) → correct `kThingArmedTNTBundle` picnum 3433. Tuned projectile physics toward Blood `thingInfo[19]` (restitution=0.375, lower damping, smaller ball collider, lighter density). Also fixed a three.js r150+ sRGB color-space mismatch that was washing out all sprites loaded via the shared `loadTexture()` path. Commits: `18fca04` + follow-ups.
- `F1.gibs` [ ]  **Gib physics constants port** — separated from F1 — still TODO. Extract `actor.cpp` gibbing-path constants + `fx.cpp` velocity/bounce coefficients into `src/game/gibs/tuning.ts`. Current gib launch/damping/restitution numbers are hand-tuned during the M2 playtest salvage; Blood's values might feel different.
- `F2`  [ ]  **Broad feel sweep — port Blood constants across systems.** Candidates to transcribe:
  - **Audio** — SFX-per-event table from `sound.cpp` `dispatchEvent`, pitch/volume variance. Huge missing layer; we have zero audio.
  - **Palookup hit flash** — damage-taken red flash + fullbright frames on hit. Palette swap, not a shader; cheap.
  - **AI timing numbers** — chase distance, attack windup, post-hit cooldown (`aizombi.cpp` and per-enemy `ai*.cpp`). Makes enemies *decide* like Blood's do, distinct from HP/damage already in R1.
  - **Screenshake per event** — explosion magnitudes, weapon kickback, nearby-gib rumble from `view.cpp` tables.
  - **Blood decals + pools** — growth, merging, fade curve. NotBlood extends; pool behavior is a readability win.
  Schedule: revisit after M3 playtest; some of these may slot into M3 feel-pass itself rather than waiting. Split into subtasks once prioritized.

### P — Process / tooling

- `P1`  [x]  Dispatch-UI setup (11 M1 tasks staged + all completed + merged)
- `P2`  [x]  Write M2 plan via `superpowers:writing-plans` — written and executing
- `P3`  [-]  CI / GitHub Actions — defer until there's meaningful code to test
- `P4`  [ ]  Dependency audit — `npm audit` flagged 6 vulns (1 critical). Skim before M2; probably transitive and safe to ignore for a web build
- `P5`  [-]  Prune old `dispatch/blud-m1-task-*` branches after M1 smoke-test passes (kept for now as safety-net)
- `P6`  [ ]  **Theme-preview schema merge** — `analyze_maps.py` emits raw R5 (`campaignSummary`/`globalStats`/`perMap`); `generate_labels.py` emits `labels.json` (30 vision-tagged families); but [theme-preview.ts](src/dev/theme-preview.ts) + [validate_patterns_schema.py](scripts/validate_patterns_schema.py) expect a merged `{texture_families, map_archetypes}` shape that no script produces. Write a small `scripts/build_theme_patterns.py` that joins raw families with `labels.json` + computes weighted picnums, emitting the expected schema to `public/assets/map-research/patterns.json` (or rename to avoid collision). R5.1 sidecar — not on M3 critical path.

---

## Process notes for future sessions

- **Completing a task:** flip `[ ]` → `[x]`, commit. If it produced a non-obvious insight, save a dualmem memory (`~/go/bin/dualmem add --type decision|warning ...`).
- **Discovering a new task:** give it the next available number in the right section, add a one-line description, commit.
- **Starting a session:** read [CLAUDE.md](CLAUDE.md) → this file → scan the `[~]` and `[ ]` entries → pick one.
- **Plans vs this file:** detailed step-by-step tasks live in `docs/superpowers/plans/` (each plan = one milestone). This file stays coarse-grained; don't duplicate plan steps here.
- **Design questions:** re-read [docs/superpowers/specs/2026-04-20-blud-design.md](docs/superpowers/specs/2026-04-20-blud-design.md) before adjusting scope.
