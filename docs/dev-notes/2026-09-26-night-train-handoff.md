# Hand-off: new game flow, Night Train, the game loop (2026-09-26)

**Branch:** `claude/wake-level-pipeline-1afb01` (worktree `.claude/worktrees/wake-level-pipeline-1afb01`).
**Everything below is merged to `main`** (main = `654f01a3` at hand-off).
Previous hand-off: [2026-09-24 wake + outdoor](2026-09-24-wake-outdoor-handoff.md). Status board: [TASKS.md](../../TASKS.md) (top section).

## Where things stand

**New game flow** ([spec](../superpowers/specs/2026-09-24-new-game-flow-design.md)): Esc → New game → **the Void**
(the hub unlit: black, embers, a red Diablo-style portal with rail tracks in it) → walk in →
**Night Train** (level 1). The Wake moves later (reached when the train crashes to earth).

| Piece | State | Where |
| --- | --- | --- |
| Esc menu (Resume / New game / Levels (dev)) | done | `game-menu.ts`, `game-menu-dom.ts` |
| The Void + portal (WGSL portal, embers, glow pool; `void` rooms, `portals`) | done, gate 3/3 | [spec](../superpowers/specs/2026-09-24-void-portal-design.md), `game-void-leaves.ts`, `portal.wgsl.ts`, `scripts/sdf-game-void-gate.sh` |
| Level mesh key (Blender `dressing` → `<id>.art.glb`, kit linked + GPU-instanced, `shell: "art"`, art boxes collision-only, emission cap 1) | done | [spec](../superpowers/specs/2026-09-24-level-mesh-key-design.md), `game-art-leaves.ts`, `level-art.ts`, exporter; `scripts/sdf-game-art-gate.sh` (budget +75 draws / +5 ms) |
| Train carriage kit (window scenery WGSL, sway, sized shells) | done | [spec](../superpowers/specs/2026-09-25-train-carriage-kit-design.md), `game-train-leaves.ts`, `train-window*.ts`, `train-motion.ts` |
| Night Train **layout draft 1** (5 carriages as chains of rooms: van 3 rooms, dining saloon + island + galley, sleeper corridor + 5 compartments, party, cab) | approved + built | [layout.md](../game/levels/01-night-train/layout.md), `scripts/levels/night_train_layout.py` (the tables), `build_night_train.py` |
| **Art direction v2** (grimy industrial prison train: scratched steel, pipes, gears, cages, booths, soot, party remnants) | built | [spec](../superpowers/specs/2026-09-25-night-train-art-v2-design.md), `build_train_kit.py` (baked colour/roughness/normal) |
| **Game loop** (health, bites, damage, death, pickups, finite ammo, triggers, gates, completion, `?god`) | done, gate 5/5 | [plan](../superpowers/plans/2026-09-26-game-loop.md), `game-loop-leaves.ts`, `player-vitals.ts`, `pickups.ts`, `level-events.ts`, `scripts/sdf-game-loop-gate.sh` |

Train gate (`scripts/sdf-game-train-gate.sh`): windows, sway, a 24-waypoint walk through every room
(`?nospawn`), cost within **+350 draws / +12 ms** (owner-raised; the frame check is load-sensitive).

## Next session, in order

1. **Part 2: dynamic light and the flashlight** ([spec](../superpowers/specs/2026-09-26-night-train-dynamic-light-design.md),
   decisions done): the flashlight as a pickup on a hook in the dark baggage hold (picking it up
   wakes the trunk zombie); a `storm` window preset (clouds, rain on glass, bolts); **lightning and
   passing-light sweeps** through one shadowed directional "window light" per carriage (idle
   shadow like the moon); lamp moods + scripted blackouts on level events; furnace/firebox glow.
   Still open: the storm's look, the exact blackout moments. Needs a `flashlight` pickup item.
2. **Part 3: haze + raymarched volumetric light for every light** (shadowed lights get occluded
   shafts; lamps glow in the haze), reduced resolution + temporal.
3. **Layout draft 2** (owner ideas): coloured keys + locked doors (placeholders; the loop's gates
   and pickups are ready for it), a longer train (third class, coat check, tender).
4. **Encounters**: wake-up triggers (the trunk, coffins, compartments), `wave`/`alert-room`
   commands (Wake Plan 3 Task 5), the Stoker (static).
5. **Optimise once the look is set** (owner): small-dressing shadows off, then one draw per kit
   piece (texture atlas); the art file is 7.4 MB.

## Defaults the owner may tweak (game loop)

Health 100 · zombie bite 10 within 0.9 m, every 0.8 s at most · the bride's sword 15 · soldier
pellets and cultist rounds 3 · health pickup +25 · shells +8 (reserve max 40) · the sawn-off comes
loaded (2) + 4 spare. All in `VITALS` (`player-vitals.ts`) and `PICKUP` (`pickups.ts`).

## Gotchas found

- **A level with no bodies** had never booted: body-1 light seeds are now guarded (the Void).
- **`wgslFn` includes:** pass the `wgslFn` result itself (a proxy of its FunctionNode), not
  `.functionNode`; WGSL has no nested `fn`.
- **Zombies never report melee contact** (only the sword mind does): bites are by proximity; the
  sword mind's kind is `'zombie'`, so sword users are bite-exempt.
- **Frozen enemies block the player** (bodies are soft colliders): layout walks use `?nospawn`.
- **Nav grid** inflates boxes by 0.34 m on a 0.4 m grid: props closer than ~0.7 m pinch lanes shut
  (the dining island had to move 0.5 m); the level test routes into every room.
- **Kit textures** resolve relative to where the kit is saved (`--out`); `--width/--ceilings` build
  one-off kits for comparisons.
- **The shorty gate pins `&god`:** the death camera moves the viewmodel it measures.
- **This machine is often loaded** (load 12–20): compare frame times A/B in one page, never across boots.
- **Reference files** (Blood, the RE0 Sketchfab train) are reference only: nothing derived is committed.
