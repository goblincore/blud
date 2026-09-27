# Blud — Task Tracker

> **Session start: read this page first.** It is the front page of the task wiki: what is in flight,
> what is next, and where each area's detail lives. Keep it short (under ~120 lines); put detail on
> the area pages under [`docs/tasks/`](docs/tasks/), step-by-step plans in `docs/superpowers/plans/`,
> and hand-offs in `docs/dev-notes/`.
>
> **Latest hand-off:** [2026-09-27 Night Train: light list, Boiler Room](docs/dev-notes/2026-09-27-night-train-handoff.md).

## In flight / next

**Night Train (level 1)** — [levels](docs/tasks/levels.md) (items 4a–4k)
- [ ] **Scene contrast, light touch** (owner, 2026-09-27; softened after a replay, the train looks mostly fine):
  try a gentle S-curve in the grade (off / gentle / medium side-by-sides). Low priority: in the test-rooms level
  the coloured orbs swamp the torch (tune the orbs, not the torch). See the hand-off.
- [ ] **NEXT: Boiler Room resize to 8 × 28 m** (owner-approved layout, option B + recommendations):
  [plan](docs/superpowers/plans/2026-09-27-boiler-room-resize.md), [before/after](docs/game/levels/01-night-train/boiler-resize/boiler-before-after.png).
- [x] **Flashlight retune** (owner: "feels like a flashlight vs the ambient, but not blown out"):
  judged at the chest, hue-preserving tail; torch-only bodies pink and modelled at 1.5–6 m, 4.5–8×
  the torch-off body, 0% blown ([sheet](docs/dev-notes/2026-09-27-shared-light-list/flashlight-retune.png)).
  **Owner call open:** under a lit tube the torch adds only ~5% (lower the tube body level?); the
  default level reads a bit dark from 4 m.
- [x] **Optimisation pass** (owner), rounds 1–2: the frame was CPU-bound on draw calls. Static
  batching of the art (`batchArt`), the bone-exposure cull (unwounded enemies draw only their eyes)
  and instanced bone meshes took third class from ~440 to ~300 draws; bones + eyes ~3 draws; art
  +61..+164 draws / +3..+6 ms (budget +200 / +12 ms). The tube cones (shadowed spots) cost ~4–9 ms
  per carriage; part 3's shared light list is where that is won back.
- [~] **Part 3: haze + volumetric light, folded with hybrid lighting** — one shared light list with
  shadows read by the level shaders and the SDF march. **Plan 1 is done and merged to local main
  (owner: the pale baseline is fine; gibs have no fresnel)** ([dev note](docs/dev-notes/2026-09-27-shared-light-list/notes.md), A/B pairs inside):
  bodies, crowds, bones and gibs each light from their own 4 picks (`?lightlist=0` = the old key).
  Cost +0.0..0.4 ms against a +1.5 ms budget. The self-shadow was rejected (ships off). Open: tube
  shadow maps at 256² (indistinguishable, no saving — owner call), deleting the old path
  (`?lightlist=0`), then plan 2 (level materials on the list) — see [rendering](docs/tasks/rendering.md).
- [x] **Boiler Room emergency beacons** (4j): two red sweeping ceiling beacons with hard shadows come
  on as the strobe ends; +0.75 ms frame / +1.12 ms GPU ([dev note + sheet](docs/dev-notes/2026-09-27-boiler-room-beacons/notes.md)).
  Owner look pending: a body in the beam blows out flat red (tone the beacon down on bodies?).
- [x] **Boiler Room disco ball** (4k): mirror tiles and 96 stars sweeping the room, white at the party,
  flashing with the strobe, red pulses as the beacons pass the ball; ~0 ms ([dev note + sheet](docs/dev-notes/2026-09-27-disco-ball/notes.md)).
- [ ] Keys + locked doors (coloured placeholders); encounters (wake-up triggers), the Stoker.
- [ ] Owner tuning: lightning (rate, peak, rim, grade), lamp moods, game-loop defaults.

**Elsewhere** (see the area pages for the full lists)
- [ ] Characters: the **Warbull** (cyber-minotaur: rockets, charge, disarm) is in the arena, awaiting a local WAM kit build and playtest; the **Juggernaut** is playable
  (arena; owner playtest: works), armour aesthetic pass next;
  Grenadier variant deferred; cultist perf pass and cloth feel (paused), bride polish —
  [characters](docs/tasks/characters.md).
- [ ] Rendering: merged crowd march, baked mesh LOD, corpse bake for every character —
  [rendering](docs/tasks/rendering.md); the 0.25 march + checker work and telemetry v3 live in
  [combat and gore](docs/tasks/combat-and-gore.md) (older sections mixed topics).
- [ ] Engineering: the rest of the `game-main.ts` decomposition (`tick`, `setDrawFn`, `spawnEnemy`) —
  [engineering](docs/tasks/engineering.md).

## The wiki

| Page | What it covers | Open |
| --- | --- | --- |
| [Levels and game flow](docs/tasks/levels.md) | Night Train, the Wake, the Void and menu, level format, game design. | 8 open, 2 in progress |
| [Characters](docs/tasks/characters.md) | SDF characters: authoring, prims, the roster, blends. | 19 open, 1 in progress |
| [Combat, weapons and gore](docs/tasks/combat-and-gore.md) | Weapons, gibs, blood, burning, decapitation, shot visuals, the viewmodel. | 24 open, 6 in progress |
| [Rendering and performance](docs/tasks/rendering.md) | The march, temporal work, the upscaler, post, perf sessions. | 11 open, 1 in progress |
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
