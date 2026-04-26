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

**M5-A shotgun cultist landed** — cultist enemy with CultistBrain FSM (Idle/Chase/Aim/Fire/Recoil/Dead), pellet projectile (swept raycast, cone spread), ZombieCluster spawns both AxeZombie and ShotgunCultist, debug T-key for solo testing. See `docs/superpowers/specs/2026-04-25-blud-shotgun-cultist.md`. **Next: M5-B weapon-switching** (parallel dispatch), then manual playtest of M4 + M5-A.

Key reference docs (open these before touching their area):
- Design spec — [docs/superpowers/specs/2026-04-20-blud-design.md](docs/superpowers/specs/2026-04-20-blud-design.md)
- NotBlood source map — [docs/dev-notes/2026-04-22-notblood-source-reference.md](docs/dev-notes/2026-04-22-notblood-source-reference.md)
- Animation system — [docs/dev-notes/2026-04-21-animation-system.md](docs/dev-notes/2026-04-21-animation-system.md)

---

## Milestones

- `M1`  [x]  Engine & Movement — `d05a306`
- `M2`  [x]  First kill + F1 dynamite port — `d721ed7`, playtest 2026-04-21
- `M3`  [x]  One-kill feel pass — `6c59491`; bone-weight + acceptance pending playtest
- `M4`  [~]  Full arsenal — flare gun + wave runner landed (`eb4a3ee..6000486`), more weapons next
- [x] M4-FPV: Flare gun FPV asset port + hotkeys (1/2/Q switch, Shift+F quick-equip)
- `M5-B` [x]  Single-fire-button weapon switching (1/2/Q slot swap; left-click fires current) — `1a142ad..3b3786d`
- `M5`  [~]  Full bestiary + Phase 1 gate (30min arena = fun) — first enemy M5-A landed; M5-C landed
- [x] M5-A: Shotgun cultist with pellet projectile + minimal AI
- [x] M5-C: NotBlood-faithful flare burn behavior + projectile graphic + cultist anim gap fix
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
- `F2.bone-visibility` [ ] Bones are 20% per spec but visually indistinct through palette dither + scanlines; needs bigger scale, brighter tone, or different treatment.
- `F2.dynamite-throw-distance` [ ] Feels too heavy vs NotBlood reference; investigate `DYNAMITE_COOK.maxVelocityMps` tuning.
- `F2.blood-trails-density` [ ] Sparser than NotBlood reference; investigate trail spawn rate in particles.ts.
- `F2.cascade-gibs` [ ] NotBlood spawns smaller secondary gibs when chunks hit ground; requires source-code dig.
- `F2.flare.charred-death` [-] Charred-corpse death sprite for burn-killed enemies — burn-death sprites now play; charred-corpse corpse-persistence art deferred.
- `F2.flare.sfx` [ ] Replace `FLARE_BURN_LOOP` placeholder with a real looping crackle sample.
- `F2.flare.cap` [ ] Cap max concurrent flares per enemy if stacking-too-many proves cheesy in playtest.
- `F2.cultist.gibs` [ ] Cultist-specific gib palette (blood color, flesh picnums) — currently reuses ZOMBIE_GIB_PROFILE.
- `F2.cultist.dodge` [ ] Dodge/strafe behavior (NotBlood `cultistDodge` / `aiMoveDodge`).
- `F2.cultist.search` [ ] Search-after-LOS state for cultist (scans area when player breaks LOS).
- `F2.cultist.los` [ ] Real LOS raycast for cultist; currently uses distance-only approximation.
- `F2.cultist.sfx` [ ] Replace placeholder cultist SFX (reuses zombie aggro/death sounds).

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
