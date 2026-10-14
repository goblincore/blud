# Blud — Task Tracker

> **Session start: read this page first.** It is the front page of the task wiki: what is in flight,
> what is next, and where each area's detail lives. Keep it short (under ~120 lines); put detail on
> the area pages under [`docs/tasks/`](docs/tasks/), step-by-step plans in `docs/superpowers/plans/`,
> and hand-offs in `docs/dev-notes/`.
>
> **Latest hand-offs:** [2026-10-08 frame cost: the heavy scenes toward a stable 30 fps](docs/dev-notes/2026-10-08-frame-cost/HANDOFF.md) (branch `claude/quizzical-williams-66ec4e`, PR goblincore/blud#41), [2026-10-05 the axe and the head split](docs/dev-notes/2026-10-04-head-split/HANDOFF.md) (branch `claude/head-cleaving-effect-ef9515`, PR goblincore/blud#31), [2026-10-01 design session — the egg (paused), the Flat's emergence, the game's shape, the retro-CGI look](docs/dev-notes/2026-10-01-design-session-handoff.md) (branch `claude/egg-shader-gooey-transitions-21fb04`, unmerged), [2026-10-01 Night Train ending — control room, egg, sequence system](docs/dev-notes/2026-10-01-night-train-ending-handoff.md) (branch `claude/train-monitor-transition-51f385`, unmerged; plan 4 next), [2026-09-29](docs/dev-notes/2026-09-29-handoff.md) (light layers, Boiler Room
> resize, zombie feet, level-list tier, march-hash on Chrome 154) and [2026-09-30 flail / head damage / wounds](docs/dev-notes/2026-09-30-flail-handoff/HANDOFF.md). Previous: [2026-09-27 Night Train](docs/dev-notes/2026-09-27-night-train-handoff.md).

## In flight / next

**The goblin's face moves** (owner, 2026-10-13) — [characters](docs/tasks/characters.md)
- [~] **Built 2026-10-13/14, owner look pending.** A jaw bone with its own hinge (`hinge=0.06` at the lip line), the mouth opening at the
  lip line, 11 jagged teeth with two fangs, and keyed expression clips (neutral, grin, scowl, shout, plus a blink) driving the jaw and the
  generated face sheet. Judged in the lab (`?character=goblin`, panel section "expression"; `BLOB_EXPR=grin npm run blob:shot -- goblin`;
  `scripts/goblin-expression-sheet.sh`). [Notes and the expression sheet](docs/dev-notes/2026-10-13-goblin-expressions/NOTES.md) ·
  [spec](docs/superpowers/specs/2026-10-13-goblin-expressions-design.md) · [plan](docs/superpowers/plans/2026-10-13-goblin-expressions.md).
  Open for the owner: is the grin evil enough (the kit's sunglasses hide the brows and eyes); the box-shaped mouth and the puffier rest jaw
  (approach C, per-prim morphs, pre-approved but not built); surprise and sneer; the screen-lab wiring after PRs #46/#47. Cost: +47 ms a frame on a face close-up in the lab (54 -> 101; the buried teeth and interior are 30 of it), not trimmed.

**The Flat's room in the engine** (owner, 2026-10-11) — [levels](docs/tasks/levels.md) (4o)
- [~] **Slice 1 built 2026-10-11 (the owner liked it); the Giger iMac built the same day, owner look pending** (alpha-blended shell; the WGSL shell is a later spike). A walkable `?level=flat`: the last-stage room from the
  look-dev (stone shell, Giger layer, hero props, the iMac) through the Blender level route, grown into a small apartment (2026-10-11): an arched entry hall with the front door, and a bathroom with a white claw-foot tub, toilet, sink and a dark-glass mirror; 50 draws, about 423k triangles, about 9 to 10 ms a frame measured (cheaper than a Night Train carriage; no pass needed).
  [Notes and the engine-vs-look-dev sheet](docs/dev-notes/2026-10-11-flat-room/NOTES.md). Owed: the shell's depth and veins, the bone/spine/radiator look, an optimisation pass. [Spec](docs/superpowers/specs/2026-10-11-flat-room-design.md)
  (branch `claude/flat-room`). Separate task: the goblin to human height ([characters](docs/tasks/characters.md)).

**Frame cost: the heavy scenes at a stable 30 fps** (owner's goal, 2026-10-08) — [rendering](docs/tasks/rendering.md)
- [~] **Measured and ranked 2026-10-08; two changes built (PR goblincore/blud#41), owner look pending.** With PR 43's quad dispatch
  merged the three heavy scenes are under 33.3 ms with margin. [Notes](docs/dev-notes/2026-10-08-frame-cost/NOTES.md); the full entry is on the rendering page.

**Player melee: spike flail** (branch `claude/melee-weapon-design-7d1423`, PR #22) — [combat and gore](docs/tasks/combat-and-gore.md)
- [~] **Flail v1.5b built; owner playtest pending.** Torn, splayed, wet-red lips on flail wounds; gun wounds get the
  wet red lip; flying flesh bits built but OFF by default. Queued: billboard flesh, red matter strings, an
  optimization pass (torn-wound cost, first-swing hitch, grey gib-blur smears). Gate `scripts/flail-gate.mjs`.
- [~] **Melee head damage model v2 built; owner playtest pending** — regions, 3D eyes that pop, brain gib, jelly
  wobble, the skull deforms with the flesh. Gate `scripts/head-damage-gate.mjs`.
- [~] **The gun and the zombie's head, redefined 2026-10-07; owner playtest pending** (branch `claude/sculpt-skull-2`): a precise
  close slug splits the head as the axe does, the slug that takes the head off pops it. The full entry is on the combat page.

**Cut wounds** — [combat and gore](docs/tasks/combat-and-gore.md)
- [~] **Cut wounds M1 (2026-10-04), the axe and the head split (2026-10-05, PR goblincore/blud#31), the sculpted skull as the default
  (2026-10-07), owner-playtested.** The open owner calls (the skull's fit, how far the bone opens, the open head's cost) are in the full entries on the combat page.

**Organs as mesh** — [rendering](docs/tasks/rendering.md)
- [x] **Merged 2026-10-07 (PRs 34 and 37):** organs as segment meshes (the owner's `wet` look), then low-poly swept tubes. Full entries on the rendering page.

**Night Train (level 1)** — [levels](docs/tasks/levels.md) (items 4a–4k)
- [x] **Done 2026-09-28/29** (full entries on the levels page): body light layers; the Boiler Room at 8 × 28 m (the extra spots' cost
  unmeasured); real zombie feet (open: the feet a little small, kit characters' boots unverified).
- [ ] **Optimisation (owner 2026-09-29, in progress):** DONE — tube shadow maps 256²; every tube's omni spill list-only
  (−3 ms Boiler Room); the Boiler Room's second tube row list-only (+2 ms, not +10); the cost harness can now measure
  live tube shadows (`LIGHT_GATE_TUBE_SHADOW=1`). **Finding: the static/dynamic tube-shadow bake would save <1 ms — dropped.**
  Level materials on the shared list, cheap tier: **default ON (owner: no visible difference in play), ~free; `?levellist=0` opts out** ([notes](docs/dev-notes/2026-09-29-level-list/notes.md)). Left: retire paths the chosen look leaves unused
  (needs owner sign-off on the look). Numbers: [optimisation-strategies.md](docs/dev-notes/2026-09-28-light-layers/optimisation-strategies.md).
- [ ] **Ending: the control room, the egg, the montage** (owner, 2026-09-30, scope B) — [spec](docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md) · [blockout](docs/dev-notes/2026-09-30-egg-ending/). The cab becomes an 8 × 10 m control room with a nested, alive egg (red veiny outer, milky spotted inner, soft silhouette); contact starts a ~30 s abstract montage (jump cuts, the train seen as a sperm), then black and a title card. The Flat and the pull-back stay later. **Plans 1 (room), 2 (egg pass) and 3 (sequence system) built.** Egg look rework approved 2026-10-01 ([spec](docs/superpowers/specs/2026-10-01-egg-candled-caul-design.md)): a candled egg in a torn caul of wet flesh. The egg is **paused** (owner thinking). **In design (drafts awaiting the owner, 2026-10-01):** the Flat set and the screen emergence ([spec](docs/superpowers/specs/2026-10-01-flat-screen-emergence-design.md), [animatic](docs/dev-notes/2026-10-01-flat-emergence-lookdev/)), then goblin animation and the playable Flat; a [design statement](docs/game/design-statement-draft.md) for vision draft 4. **The room** ([look-dev](docs/dev-notes/2026-10-01-flat-room-lookdev/), 2026-10-01): castle stone for the bones, Giger's industrial decay for the veins, otaku cute for the stuff, and the machine's last stage as a "Giger iMac". **Goblin refinement pass**: phase 1 (body) done (owner-approved 2026-10-01); body grain (the face's texture on the body) done, reworked 2026-10-02 to one small octave of pitted relief after the owner saw big pixels ([spec](docs/superpowers/specs/2026-10-02-body-grain-design.md)); **armour (phase 2) built 2026-10-02, awaiting the owner's final look** ([spec](docs/superpowers/specs/2026-10-02-goblin-armour-design.md), [notes](docs/dev-notes/2026-10-02-goblin-armour/notes.md)); **held weapons, thin shotgun pass done 2026-10-02** ([notes](docs/dev-notes/2026-10-02-goblin-shotgun/notes.md)); **in-game gait (phase 4a) built 2026-10-02, awaiting the owner's look in motion** ([spec](docs/superpowers/specs/2026-10-02-goblin-gait-design.md), [notes](docs/dev-notes/2026-10-02-goblin-gait/notes.md)); **the Flat's poses (phase 4b first slice: pose layer, type, recoil, sit, stand, jolt) built 2026-10-03, awaiting the owner's look** ([spec](docs/superpowers/specs/2026-10-03-goblin-pose-layer-design.md), [notes](docs/dev-notes/2026-10-03-goblin-poses/notes.md)); next the vest and shorts, `reach`, game wiring, more weapons ([spec](docs/superpowers/specs/2026-10-01-goblin-refinement-design.md), [tasks](docs/tasks/characters.md)).
- [ ] Check the beacon sweeps read on bodies under the owner's default; explain the light gate's `?lightlist=0` gib
  reading (0.296 vs 0.163 earlier, passes).
- [x] **Done 2026-09-27** (full entries on the levels page): the art draw-call pass, the Boiler Room beacons (open: a body in the
  beam blows out red) and its disco ball.
- [~] **Part 3: haze + volumetric light, folded with hybrid lighting**: plan 1 done and merged; open: the tube shadow maps at 256²,
  deleting `?lightlist=0`, then plan 2. The full entry is on the levels page.
- [ ] Keys + locked doors (coloured placeholders); encounters (wake-up triggers), the Stoker.
- [ ] Owner tuning: lightning (rate, peak, rim, grade), lamp moods, game-loop defaults.

**Elsewhere** (see the area pages for the full lists)
- [x] **Playtest fixes** (2026-10-02, branch `claude/shotgun-flail-weapon-bugs-4626b5`): the double-shotgun reload plays again on finite levels (two ammo initialisers raced; `resolveInfiniteAmmo`); flail hits no longer pull the torso off the thighs (stagger root offset now carries the hip sockets); zombie arms can no longer pass through the head (verlet `headKeepOut` in `rig.ts`) or the torso (per-ellipsoid `torsoGuards`, unarmed profiles only via `wantsTorsoGuards`; found after the hip fix let the lower torso slide into the upper arm on angled hits); the shotgun fires per-barrel flame jets (`muzzle-flash.ts`, `game-muzzle-flash.ts`) with a visible-but-modest recoil (`RECOIL`; double shot ~4 cm / ~8 deg, kept low because a high muzzle hides the wounds; hands ride the kick via `recoil-carry.ts`). The bare ring now reloads for people (unlimited reserve, two-shell magazine); automated browsers and `?ammo=unlimited` keep the no-reload default. Owner-confirmed on the flash; recoil strength is a tuning knob in `RECOIL`.
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
> Which module owns what: [docs/architecture/module-index.md](docs/architecture/module-index.md) (generated).
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
