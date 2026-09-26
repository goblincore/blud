# Night Train rebuild from the approved layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `night-train` from the approved layout ([layout.md](../../game/levels/01-night-train/layout.md)): five carriages at their own widths, rooms made with thin partitions, the new props, zombie and cultist spawns, pickups, the locked C5; walkable room by room.

**Architecture:** One source of truth: `scripts/levels/night_train_layout.py` (tables). The kit script builds the width/height-specific shell pieces the layout needs, plus the new props; width-independent pieces (walls, pillars, partitions) are modelled at the wall plane (x = 0) and placed by the build script. The build script reads the tables and places kit pieces, partitions, furniture boxes, solids, spawns, pickups and gates. The format gains a `cultist` spawn kind.

**Tech Stack:** Blender 5.2 scripts, TypeScript (level format + game spawn), vitest, CDP gate.

**Spec:** [carriage kit spec](../specs/2026-09-25-train-carriage-kit-design.md) (§3–§4 superseded in part by the layout).

---

### Task 1: `cultist` spawn kind

**Files:** `level-def.ts` (`SpawnDef.kind`), `level-json.ts` (accept `cultist`), `active-level.ts` (`LevelSpawn.kind`), `game-main.ts` (`spawnAll`), `scripts/levels/export_level.py` (already passes `spawn:<kind>:<id>` through); test in `level-json.test.ts`.

- [ ] Test: a level with `{ "id": "c", "kind": "cultist", ... }` parses with `kind: 'cultist'`; `kind: 'imp'` is rejected with `kind must be zombie, soldier or cultist`.
- [ ] `SpawnDef.kind: 'zombie' | 'soldier' | 'cultist'`; the parser's message updated; `spawnAll`: `const name = s.kind === 'zombie' ? spawnOverride ?? 'zombie' : s.kind;` (`?spawn=` swaps zombies only).
- [ ] `night_train_layout.py`: cultists become `cultist` spawns (drop the `soldier` placeholder).
- [ ] Run the level tests + tsc. **Commit** `feat(level): cultist spawn kind`.

### Task 2: Kit: width-independent walls, sized shells, new props

**Files:** `scripts/levels/build_train_kit.py`.

- [ ] **Walls at the wall plane:** `bay-wall-*`, `bay-pillar` are modelled with the wall face at local x = 0 (the room side is +x); the build script places the west piece at x = −w/2 and the east piece turned 180° at x = +w/2.
- [ ] **Sized shells:** the kit imports `night_train_layout.CARRIAGES` and builds, for every (width, ceiling) pair the layout uses (except the cab): `bay-ceiling-<w>-<h>`, `end-wall-door-<w>-<h>`; for every width: `bay-floor-planks-<w>`, `bay-floor-runner-<w>` (`<w>`, `<h>` in decimetres, e.g. `bay-ceiling-42-30`). `--width/--ceilings` stay for one-off builds.
- [ ] **Partitions:** `partition-<h>` for each ceiling height: a 1 m long, 0.1 m thick wall along −z (local z ∈ [−1, 0], x ∈ [−0.05, 0.05]), dado and panel on both faces, a wood cap on its free ends; scaled along its length by the instance and turned 90° for transverse partitions.
- [ ] **New props** (origins at the floor, centred on their footprint unless noted): `desk` (0.8 × 1.6 × 0.8, wood + brass lamp), `stove` (0.6 × 0.8 × 1.2, iron + `train.firebox` door), `buffet-island` (1.2 × 3.2 × 1.0, wood + brass top), `galley-stoves` (0.8 × 1.9 × 1.0, iron + two firebox glows), `galley-counter` (0.5 × 1.2 × 1.0, wood), `bar` (0.6 × 6.0 × 1.1, wood + brass rail + velvet front), `pillar-round` (Ø0.3, `train.brass` capital and base, `train.wood-dark` shaft, height 3.4), `bunk` (0.8 × 2.6: lower bunk 0.6 high in velvet on wood, an upper bunk at 1.5, a ladder), `trunk-big` (1.1 × 0.9 × 0.7).
- [ ] Rebuild + piece renders; look at them. **Commit** `feat(train): kit — wall-plane walls, sized shells, partitions, layout props`.

### Task 3: Build script from the layout tables

**Files:** `scripts/levels/build_night_train.py` (rewritten), regenerated `night-train.blend`, `.level.json`, `.art.glb`; `level-json.night-train.test.ts` (updated).

- [ ] **Test first:** five rooms `guards-van, dining-car, sleeper, party-carriage, cab` in order, widths 3.6/4.2/4.0/4.2/3.0, heights 2.8/3.0/2.8/3.4/2.6; four vestibules ≥ 1.4 m; spawns 18 zombies + 5 cultists; pickups include `shotgun` (van), `dynamite` in the sleeper and the party carriage, the `cd` in the party carriage; gate `c5-door`; at least 5 compartment partitions in the sleeper (solids); the start in the van facing −z; the art file named.
- [ ] **Script:** `sys.path` gets `scripts/levels`; `from night_train_layout import CARRIAGES, VESTIBULE, placed`. Per carriage (south end z from `placed()`): the room (`shell: "art"`), lights (one per 8 m; the cab's firebox light), bays (walls with windows except the van's bays 2 and 5 only; the sleeper corridor side and compartment side both windowed), sized ceilings/floors (runner in dining, sleeper corridor and party), end walls (the cab's own shell instead), pillars; **partitions** from `walls` (a `partition-<h>` instance per wall segment, scaled to its length, turned 90° when it runs across the carriage) plus a `solids` box each; **props** from `props` by label → kit piece (`trunks` → two `trunk` stacked, `big trunk` → `trunk-big`, `coffin`, `desk`, `stove`, `table` → `dining-table` + two `dining-chair` at its ends, `buffet island`, `stoves` → `galley-stoves`, `counter` → `galley-counter`, `bunk`, `favours` → `favour-table`, `pillar` → `pillar-round`, `bar`, `jukebox`, `backhead` → none, the cab shell has it) plus a `furniture` box each; luggage racks on the van's walls; curtains on dining and party windows; hanging lamps in the party carriage; **markers**: spawns (`spawn:<kind>:<id>`), pickups, the gate box (`gate:never:c5-door` in `gates`), the start.
- [ ] Build, export, run the test; render eye-height views of every room in Blender and look at them. **Commit** `feat(train): night-train rebuilt from the approved layout`.

### Task 4: Game checks

**Files:** `scripts/sdf-game-train-gate.mjs`.

- [ ] **Walk room by room** (frozen AI): waypoints through the hold, the west door, the cage, the east door, the office, the dining saloon, the island's west lane, the galley door, the galley, the sleeper corridor, into C3 and back, the north lobby, the party carriage round a pillar, the cab. Each waypoint must be reached within 0.8 m (walkTo, poll, walkCancel).
- [ ] Window pose moves to the new dining car's first west window; the cost poses become van office, dining saloon, sleeper corridor, party.
- [ ] Run the train, Void, Wake, art and shorty gates and the full suite. Re-measure the cost; if it's over **+175 draws / +10 ms**, report to the owner before changing the budget. Screenshots of each carriage for the owner.
- [ ] TASKS.md. **Commit** `test(train): walk every room of the rebuilt train`.
