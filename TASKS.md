# Blud — Task Tracker

> **Session start: read this page first.** It is the front page of the task wiki: what is in flight,
> what is next, and where each area's detail lives. Keep it short (under ~120 lines); put detail on
> the area pages under [`docs/tasks/`](docs/tasks/), step-by-step plans in `docs/superpowers/plans/`,
> and hand-offs in `docs/dev-notes/`.
>
> **Latest hand-offs:** [2026-10-01 design session — the egg (paused), the Flat's emergence, the game's shape, the retro-CGI look](docs/dev-notes/2026-10-01-design-session-handoff.md) (branch `claude/egg-shader-gooey-transitions-21fb04`, unmerged), [2026-10-01 Night Train ending — control room, egg, sequence system](docs/dev-notes/2026-10-01-night-train-ending-handoff.md) (branch `claude/train-monitor-transition-51f385`, unmerged; plan 4 next), [2026-09-29](docs/dev-notes/2026-09-29-handoff.md) (light layers, Boiler Room
> resize, zombie feet, level-list tier, march-hash on Chrome 154) and [2026-09-30 flail / head damage / wounds](docs/dev-notes/2026-09-30-flail-handoff/HANDOFF.md). Previous: [2026-09-27 Night Train](docs/dev-notes/2026-09-27-night-train-handoff.md).

## In flight / next

**Player melee: spike flail** (branch `claude/melee-weapon-design-7d1423`, PR #22) — [combat and gore](docs/tasks/combat-and-gore.md)
- [~] **Flail v1.5b built; owner playtest pending.** Torn, splayed, wet-red lips on flail wounds; gun wounds get the
  wet red lip; flying flesh bits built but OFF by default. Queued: billboard flesh, red matter strings, an
  optimization pass (torn-wound cost, first-swing hitch, grey gib-blur smears). Gate `scripts/flail-gate.mjs`.
- [~] **Melee head damage model v2 built; owner playtest pending** — regions, 3D eyes that pop, brain gib, jelly
  wobble, the skull deforms with the flesh. Gate `scripts/head-damage-gate.mjs`.

**Night Train (level 1)** — [levels](docs/tasks/levels.md) (items 4a–4k)
- [x] **Body lighting settled** (owner, 2026-09-28): LIGHT LAYERS panel (`light-layers.ts`) — every body-lighting
  change since the melee branch behind a live switch. Default = the owner's pick: the list on; with the torch lit,
  the old per-pixel beam under the list; S-curve off. `?layers=none` is the melee look. [Hand-off](docs/dev-notes/2026-09-28-light-layers/notes.md).
- [x] **Boiler Room resize to 8 × 28 m** (2026-09-28): kit, level, gates, look sheet, cost — all PASS; +60 draws /
  +6.7 ms art, beacons +1.05 ms. [Notes + sheets](docs/dev-notes/2026-09-28-boiler-resize/notes.md). **Owner calls, done 2026-09-29** ([notes + sheets](docs/dev-notes/2026-09-29-boiler-calls/notes.md)): second tube row (8 tubes;
  only 4 cast shadows — WebGPU's 16-texture limit), `DISCO.count` 144, and a `beaconTorch` look switch for beacon
  weight on torch-lit bodies (**2.5, owner's pick**). Frame cost of the extra
  spots not yet measured (needs a quiet machine).
- [ ] **Optimisation (owner 2026-09-29, in progress):** DONE — tube shadow maps 256²; every tube's omni spill list-only
  (−3 ms Boiler Room); the Boiler Room's second tube row list-only (+2 ms, not +10); the cost harness can now measure
  live tube shadows (`LIGHT_GATE_TUBE_SHADOW=1`). **Finding: the static/dynamic tube-shadow bake would save <1 ms — dropped.**
  Level materials on the shared list, cheap tier: **default ON (owner: no visible difference in play), ~free; `?levellist=0` opts out** ([notes](docs/dev-notes/2026-09-29-level-list/notes.md)). Left: retire paths the chosen look leaves unused
  (needs owner sign-off on the look). Numbers: [optimisation-strategies.md](docs/dev-notes/2026-09-28-light-layers/optimisation-strategies.md).
- [x] **Zombies float — fixed with real feet** (owner, 2026-09-29): the model stopped 0.199 m above the floor (legs too
  short for the hip, no foot bone). Thigh 0.46 / shin 0.50 and a foot bone with heel + sole: lowest point 0.004 m,
  height unchanged. [Notes + turntable](docs/dev-notes/2026-09-29-zombie-feet/notes.md). **Open:** feet a little
  small (~0.19 m; foot `len`), the walk with longer legs not yet judged in play; kit characters (soldier 0.10,
  juggernaut 0.11) assumed hidden by boots — verify.
- [ ] **Ending: the control room, the egg, the montage** (owner, 2026-09-30, scope B) — [spec](docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md) · [blockout](docs/dev-notes/2026-09-30-egg-ending/). The cab becomes an 8 × 10 m control room with a nested, alive egg (red veiny outer, milky spotted inner, soft silhouette); contact starts a ~30 s abstract montage (jump cuts, the train seen as a sperm), then black and a title card. The Flat and the pull-back stay later. **Plans 1 (room), 2 (egg pass) and 3 (sequence system) built.** Egg look rework approved 2026-10-01 ([spec](docs/superpowers/specs/2026-10-01-egg-candled-caul-design.md)): a candled egg in a torn caul of wet flesh. The egg is **paused** (owner thinking). **In design (drafts awaiting the owner, 2026-10-01):** the Flat set and the screen emergence ([spec](docs/superpowers/specs/2026-10-01-flat-screen-emergence-design.md), [animatic](docs/dev-notes/2026-10-01-flat-emergence-lookdev/)), then goblin animation and the playable Flat; a [design statement](docs/game/design-statement-draft.md) for vision draft 4. **The room** ([look-dev](docs/dev-notes/2026-10-01-flat-room-lookdev/), 2026-10-01): castle stone for the bones, Giger's industrial decay for the veins, otaku cute for the stuff, and the machine's last stage as a "Giger iMac". **Goblin refinement pass**: phase 1 (body) done (owner-approved 2026-10-01); body grain (the face's texture on the body, two octaves) done (owner-approved 2026-10-02) ([spec](docs/superpowers/specs/2026-10-02-body-grain-design.md)); next armour, held weapons, rig and animation ([spec](docs/superpowers/specs/2026-10-01-goblin-refinement-design.md), [tasks](docs/tasks/characters.md)).
- [ ] Check the beacon sweeps read on bodies under the owner's default; explain the light gate's `?lightlist=0` gib
  reading (0.296 vs 0.163 earlier, passes).
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
- [x] **Playtest fixes** (2026-10-02, branch `claude/shotgun-flail-weapon-bugs-4626b5`): the double-shotgun reload plays again on finite levels (two ammo initialisers raced; `resolveInfiniteAmmo`); flail hits no longer pull the torso off the thighs (stagger root offset now carries the hip sockets); zombie arms can no longer pass through the head (verlet `headKeepOut` in `rig.ts`); the shotgun fires per-barrel flame jets (`muzzle-flash.ts`, `game-muzzle-flash.ts`) with a visible-but-modest recoil (`RECOIL`; double shot ~4 cm / ~8 deg, kept low because a high muzzle hides the wounds; hands ride the kick via `recoil-carry.ts`). The bare ring now reloads for people (unlimited reserve, two-shell magazine); automated browsers and `?ammo=unlimited` keep the no-reload default. Owner-confirmed on the flash; recoil strength is a tuning knob in `RECOIL`.
- [~] **Grenade launcher** (2026-09-29): owner accepted the original M79-inspired gothic FPV model, fire/recoil and break-action reload with forestock grip (`?launcher=1` / slot 4). Next pass: arcing projectile, bounces, explosive/fragment damage and embedding in fleshy actors. [Source, controls and gates](docs/dev-notes/2026-09-29-grenade-launcher/notes.md).
- [ ] Characters: the **Warbull** (cyber-minotaur: rockets, charge, disarm; second draft from the owner's reference plate) is in the arena, awaiting a local WAM kit build and playtest; the **Juggernaut** is playable
  (arena; owner playtest: works), armour aesthetic pass next;
  Grenadier variant deferred; cultist perf pass and cloth feel (paused), the **bride is shelved** (2026-09-30; engine fixes merged, game-LOD work on branch `claude/bride-game-lod`) —
  [characters](docs/tasks/characters.md).
- [ ] Rendering: merged crowd march, baked mesh LOD, corpse bake for every character, early-Z stage 1 behind `?earlyz=1` (owner look pending) —
  [rendering](docs/tasks/rendering.md); the 0.25 march + checker work and telemetry v3 live in
  [combat and gore](docs/tasks/combat-and-gore.md) (older sections mixed topics).
- [ ] Engineering: the rest of the `game-main.ts` decomposition (`tick`, `setDrawFn`, `spawnEnemy`) —
  [engineering](docs/tasks/engineering.md).

## The wiki

| Page | What it covers | Open |
| --- | --- | --- |
| [Levels and game flow](docs/tasks/levels.md) | Night Train, the Wake, the Void and menu, level format, game design. | 8 open, 2 in progress |
| [Characters](docs/tasks/characters.md) | SDF characters: authoring, prims, the roster, blends. | 19 open, 1 in progress |
| [Combat, weapons and gore](docs/tasks/combat-and-gore.md) | Weapons, gibs, blood, burning, decapitation, shot visuals, the viewmodel. | 27 open, 9 in progress |
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
