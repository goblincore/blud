# Level 0: The Wake — Tasks (draft 1)

**Date:** 2026-09-10 · **Design:** [design.md](design.md) · **Scope:** [../../production-scope.md](../../production-scope.md) (G2, G4)

**Implementation:** [implementation.md](implementation.md) turns these tasks into
three agent-ready plans (level format + Blender pipeline, game loop, content).

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
**Deps** lists task IDs that must land first. Engine-heavy tasks get their own
superpowers spec/plan when they start; link it on the task.

---

## Pipeline spike (shared with the Flat)

The Wake is the first test of **route B/D**: levels built in Blender,
exported into the game. The flat uses the same path.

- [x] **P-1 Blender conventions.** Done 2026-09-23: [blender-conventions.md](../blender-conventions.md) (Plan 1 T4). Units and scale, collision vs. render
  meshes, naming for markers (player start, spawns, pickups, triggers, exit,
  lights, music sources, SDF parts). *Done when:* a short conventions doc.
- [x] **P-2 Exporter + importer.** Done 2026-09-23 (Plan 1 T1–T4, T6): Level Format v1 parser, `scripts/levels/export_level.py`,
  `?level=<id>` loads through `ctx.world.level`; `scripts/sdf-game-wake-gate.sh` passes. Export a Blender scene (glTF plus markers) and
  load it in the game: meshes, box/mesh collision, markers turned into entities.
  *Deps:* P-1. *Done when:* a test scene with a start, a spawn and an exit
  loads and plays.
- [ ] **P-3 Lighting hookup.** Probe lighting for imported levels (merge the
  existing probe-lighting branch first). *Deps:* P-2.
- [ ] **P-4 Pipeline verdict.** After the Wake blockout: keep, adjust or change
  the route. Write the decision into the production scope. *Deps:* W-B1.

## Game-loop pieces pulled forward (from G1)

The level can't be tested without these. Build them small.

- [ ] **L-1 Player health and damage.** Zombie hits hurt; soldier fire lands.
- [ ] **L-2 Death and restart** (restart the level).
- [ ] **L-3 Pickups:** weapon, ammo, health, CD (collectible with an ID).
- [ ] **L-4 Triggers and exit:** trigger volumes, a scripted "all mourners turn"
  event, and the level-exit event fired by the CD pickup.
- [ ] **L-5 Minimal HUD:** health, ammo.

## Design

- [x] **W-D0 Reference study.** Done 2026-09-23: [reference-study.md](reference-study.md). Blood E1M1/E1M2 as a type. Plan 1 Task 5a;
  process in the [level design guide](../level-design-guide.md).
- [~] **W-D1 Paper map.** [layout.md](layout.md) draft 1 written 2026-09-23; awaiting owner approval. Final flow and dimensions at goblin scale.
  *Deps:* W-D0, F-D5 (goblin scale). *Done when:* `layout.md` approved (Plan 1 Task 5b).
- [ ] **W-D2 Encounter script.** Zombie counts, spawn points, triggers per beat.
  *Deps:* W-D1. Part of `layout.md` (Plan 1 Task 5b). Zombies and soldiers only.
- [ ] **W-D3 Starting weapon decision.** *Deps:* W-B4.
- [ ] **W-D4 The first CD.** Artist, title, cover brief, liner notes.
- [ ] **W-D5 Secrets.** Placement and rewards. *Deps:* W-D1.
- [ ] **W-D6 Sound notes.** Expand design §8 into an emitter list.

## Build

- [~] **W-B1 Blockout in Blender.** Draft 0 built 2026-09-23 (plays at `?level=the-wake`, gate passes);
  rebuild from `layout.md` once approved. Untextured, playable: gates → grave →
  graveyard → crypt → funeral home → coffin. *Deps:* P-2, W-D1.
  *Done when:* walk start to CD pickup in the game.
- [ ] **W-B2 Encounters in.** Spawns and triggers from W-D2. *Deps:* W-B1, L-4.
- [ ] **W-B3 Playtest pass.** Timing (5–8 min target), difficulty, readability in
  fog/dark. *Deps:* W-B2, L-1, L-2.
- [ ] **W-B4 Melee prototype.** Shovel, pickaxe and axe as quick variants on a
  zombie: swing, hit, deformation read. *Deps:* none beyond the current game.
- [ ] **W-B5 Zombie tuning** for this level's pacing (slow mourners, the parlour turn).
- [ ] **W-B6 The bell set piece** (design §4.1). Shootable bell with toll
  events; each toll opens graves and spawns a wave; the first opens the crypt
  stairs; soft dents in the bell (SDF or decal first, decide). Needs
  zombie climb-out-of-grave spawns. *Deps:* W-B1, L-4.
  *Done when:* three tolls, three waves, crypt opens, playtested.
- [ ] **W-D7 Bell waves.** Wave sizes, grave positions, rewards per toll.
  *Deps:* W-D2.

## Art (Blender)

- [ ] **W-A1 Art kit designs.** Gates, headstones, mausoleum, fence, crypt,
  funeral-home parlour, pews, flowers, organ, coffin. Sketches/reference first.
  Rough placeholders come first, in the `.blend` (Plan 1 Task 5d).
- [!] **W-A2 Art kit models.** *Blocked on:* P-4 (pipeline verdict).
- [!] **W-A3 Art pass on the blockout.** *Deps:* W-A2, W-B3.
- [ ] **W-A4 Starting melee model** once W-D3 is decided.

## Hand-off to the frame

- [ ] **W-H1 Level end → pull-back.** The CD pickup ends the level and hands the
  camera to the flat's pull-back. *Deps:* L-4, F-T3 (flat camera transitions).
- [ ] **W-H2 Cold-open boot.** New game starts straight in the Wake: no title,
  no bezel. *Deps:* W-B1.

## Blocked / later

- [!] **Organ, party bleed, zombie voices** — need G3 audio. Place emitters now.
- [!] **The CD cover render** — after W-D4.

## Suggested order

W-B4 (melee prototype, starts now) · P-1 → P-2 · W-D1 → W-D2 · L-1…L-5 in
parallel → W-B1 → W-B2 → W-B3 → P-4 → art.
