# Blud — Task Tracker

> **Session start: read this page first.** It is the front page of the task wiki: what is in flight,
> what is next, and where each area's detail lives. Keep it short (under ~120 lines); put detail on
> the area pages under [`docs/tasks/`](docs/tasks/), step-by-step plans in `docs/superpowers/plans/`,
> and hand-offs in `docs/dev-notes/`.
>
> **Latest hand-off:** [2026-09-26 Night Train](docs/dev-notes/2026-09-26-night-train-handoff.md).

## In flight / next

**Night Train (level 1)** — [levels](docs/tasks/levels.md) (items 4a–4i)
- [~] **Optimisation pass** (owner): round 1 done — the frame was CPU-bound on draw calls; static
  batching at load (`batchArt`: static art merged per room, material, shadow flag) took the art from
  +115..+329 draws / +7.7..+33.2 ms to **+61..+164 / +3.2..+5.8 ms**; budget back to +200 / +12 ms.
  Next: the bodies' own draws (116–355 per frame with no art), lamps/curtains that stay separate.
- [ ] **Part 3: haze + volumetric light, folded with hybrid lighting** — one shared light list with
  shadows read by the level shaders and the SDF march, each with its own stylized shading.
- [ ] Keys + locked doors (coloured placeholders); encounters (wake-up triggers), the Stoker.
- [ ] Owner tuning: lightning (rate, peak, rim, grade), lamp moods, game-loop defaults.

**Elsewhere** (see the area pages for the full lists)
- [ ] Characters: cultist perf pass and cloth feel (paused), bride polish; the cultist returns to
  Night Train when finished — [characters](docs/tasks/characters.md).
- [ ] Rendering: merged crowd march, baked mesh LOD, corpse bake for every character —
  [rendering](docs/tasks/rendering.md); the 0.25 march + checker work and telemetry v3 live in
  [combat and gore](docs/tasks/combat-and-gore.md) (older sections mixed topics).
- [ ] Engineering: the rest of the `game-main.ts` decomposition (`tick`, `setDrawFn`, `spawnEnemy`) —
  [engineering](docs/tasks/engineering.md).

## The wiki

| Page | What it covers | Open |
| --- | --- | --- |
| [Levels and game flow](docs/tasks/levels.md) | Night Train, the Wake, the Void and menu, level format, game design. | 8 open, 2 in progress |
| [Characters](docs/tasks/characters.md) | SDF characters: authoring, prims, the roster, blends. | 17 open, 0 in progress |
| [Combat, weapons and gore](docs/tasks/combat-and-gore.md) | Weapons, gibs, blood, burning, decapitation, shot visuals, the viewmodel. | 24 open, 6 in progress |
| [Rendering and performance](docs/tasks/rendering.md) | The march, temporal work, the upscaler, post, perf sessions. | 9 open, 1 in progress |
| [Gather dispatch R1 (history)](docs/tasks/rendering-gather-r1.md) | The probe-gather dispatch work of 2026-09-10 and its measurements. | 3 open, 0 in progress |
| [Engineering and process](docs/tasks/engineering.md) | Tests, harnesses, the game-main decomposition, tooling, process notes. | 7 open, 0 in progress |
| [Backlog and roadmap](docs/tasks/backlog.md) | Milestones, side quests, asset pipeline, research, feel tuning. | ID tables (M, A, R, F, P) |

Area pages keep their sections verbatim from the old single-file board (split 2026-09-26), dated,
newest near the top. When an area page grows past ~1,000 lines, move its finished sections to a
dated history page beside it (as [Gather dispatch R1](docs/tasks/rendering-gather-r1.md) was).

---

## Orientation — active vs. historical

> **The active project is the SDF-rendered FPS.** It lives in
> `src/lab/sdf-zombie/` (the "lab" name is historical, not obsolete). The
> **retired project** is the sprite/bestiary/arena procedural-generation game
> and the old NotBlood simulation — kept runnable only as a **behavior
> reference** for dynamite and gibbing.
>
> Entries below that describe the retired sprite game or the old NotBlood sim
> (the pre-SDF M-series and the old-game backlog) are **historical / reference
> only** — preserved for provenance, not current work. Do not treat historical
> roadmap entries as in-flight.
>
> Current vs. proposed source layout: [docs/architecture/repository-map.md](docs/architecture/repository-map.md).
> Legacy dynamite/gibbing reference: [docs/reference/legacy-dynamite-gibbing.md](docs/reference/legacy-dynamite-gibbing.md).

---

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
