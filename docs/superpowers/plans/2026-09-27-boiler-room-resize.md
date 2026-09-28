# Boiler Room Resize (8 × 28 m) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Night Train's Boiler Room (carriage rid 5) grows from 4.2 × 20 m to **8.0 × 28 m** at the same 3.4 m height ("bigger on the inside"). It keeps storm windows down both long walls and everything already in it: the strobe, the beacons, the disco ball, pistons and steam, the bar, and the DJ deck.

**Status:** layout approved by the owner on 2026-09-27 ("go with your recommendations"). Written as a **hand-off for a new session**.

## ▶ Next session starts here (updated 2026-09-28)

**Tasks 1 and 2 are DONE and on `main`** (pushed, `d401dddf`): `a2ea591f` kit, `92a088c1` level, `b4488086` the
level test. As built:
- The arch rise is 0.4 m up to 4.2 m and `min(0.8, 0.4 × w / 4.2)` above (0.76 m at 8 m). All 211 existing kit
  meshes were compared vertex for vertex and are identical. The centre pipe (h − 0.2) and the beacons (y 2.95)
  clear the new arch. The floor grate stays the fixed 1.2 m strip (noted, not widened).
- **Build `kit.blend` in place** (default `--out`). A kit saved elsewhere keeps texture paths relative to that
  folder and the exported GLB loses its 42 textures.
- A fresh kit rebuild does not reproduce the committed GLB byte for byte even with no change (the level JSON
  does); build from the committed kit to reproduce.
- JSON checked: room 5 is −4..4 × −90..−118, the tender and cab moved 8 m north, every entry south of the Boiler
  Room is unchanged; lights 21 → 23, furniture 58 → 62. Layout drawing: `docs/game/levels/01-night-train/layout-draft3.png`.
- `level-json.night-train.test.ts` is updated (width 8; nav probes at the dance floor, chill-out and DJ end).

**Remaining: Task 3 (the gate scripts), then Task 4.** Things that changed since this plan was written:
- **Light layers** (`src/lab/sdf-zombie/webgpu/light-layers.ts`, [notes](../../dev-notes/2026-09-28-light-layers/notes.md)):
  body lighting now has switches with an owner-chosen default (the list on; the old per-pixel torch while it is
  lit; S-curve off). The gates boot explicit `?layers=`: the disco and train gates `all`, the light gate
  `GATE_LAYERS` (all but `sCurve`). Keep that when editing their boot URLs.
- The **look check** (Task 4) should use the owner's default (no `?layers=` param), and should answer an open
  question: **do the red beacon sweeps still read on bodies under the default?** (They were built to reach bodies
  through the list; with the torch lit, bodies use the hybrid path.)
- Tube shadow maps: the owner approved **256²** (optimisation parked; see
  [optimisation-strategies.md](../../dev-notes/2026-09-28-light-layers/optimisation-strategies.md)). Don't fold that into
  the resize; measure the resize's cost at 512² first, as the plan says.
- Headless capture gotcha: treat a missing `window.__warmGate` as NOT ready; step once more before shooting (the
  torch's wall pool lags one placement).

**Architecture:**
- **Layout.** The table in `scripts/levels/night_train_layout.py` changes.
- **Build.** A few values written straight into `scripts/levels/build_night_train.py` move with it.
- **Kit.** The kit (`build_train_kit.py`) already makes shell pieces for any carriage width. It needs a rebuild plus one change: the ceiling arch's rise must scale with width.
- **Export.** The level is re-exported through the real Blender pipeline.
- **Runtime.** The game-side lighting, disco stars, window light and beacons all read the room box from level data, so they adapt without changes.
- **Checks.** Gates and tests that hard-code room-5 coordinates get updated.

**Tech Stack:** Python (layout, build and export scripts), headless Blender 5.2 (`/opt/homebrew/bin/blender`), TypeScript/Vitest, headless-Chrome CDP gates.

---

## Where things stand (read first)

- **Branch and main.**
  - Branch: `claude/wake-level-pipeline-1afb01`, in the worktree `.claude/worktrees/wake-level-pipeline-1afb01`.
  - Local `main` was fast-forwarded to `83dcd38c` on 2026-09-27. It is **not pushed** to GitHub.
  - The branch itself is pushed as far as PR #25's merge (`fd0c000f`). Later commits are local.
- **Proposal.** `docs/game/levels/01-night-train/boiler-resize/`:
  - `boiler-before-after.png`: before on top, the approved plan below.
  - `proposed_rid5.py`: the proposed table, plus the build-script constants that must move with it. It re-renders the images into `out/` with rsvg-convert.
- **Background.**
  - Beacons: `docs/dev-notes/2026-09-27-boiler-room-beacons/notes.md`.
  - Disco ball: `docs/dev-notes/2026-09-27-disco-ball/notes.md`.
  - Shared light list: `docs/dev-notes/2026-09-27-shared-light-list/notes.md`.
- **Level pipeline.** `night_train_layout.py` holds the tables. `build_night_train.py` builds `assets-source/levels/night-train.blend` with headless Blender, and `export_level.py` writes `public/assets/levels/night-train.level.json` plus `night-train.art.glb`. The unchanged pipeline was verified to reproduce the committed JSON and GLB byte for byte (2026-09-27), so any diff comes from your change.
- **In flight when this was written:** a flashlight retune. The flashlight is judged at the chest instead of the feet, and bodies in the beam must read pink and modelled at 1.5–6 m, at least about 2× brighter than outside the beam, with their hue kept.
  - It may have landed as a commit titled "fix(light): flashlight judged at the chest, retuned…".
  - Check `git log`. If it landed, review it before building on it: the owner wants a before/after sheet, `docs/dev-notes/2026-09-27-shared-light-list/flashlight-retune.png`.
  - If it didn't land, redo it from the brief in the notes' "Flashlight up close" section, plus the owner's framing: contrast against the surroundings, and hue-preserving compression.

## Owner decisions (2026-09-27)

1. **Size:** 8.0 wide × 28.0 long × 3.4 high. The doors at both ends stay centred (tunnel x −0.7..0.7).
2. **Beacons:** **2**, at (0, u 7) and (0, u 21), y 2.95, spin +0.7 / −0.7. Add more only if two feel thin in play (candidates: (±2.4, u 14) flanking the ball). Each beacon re-renders a shadow every frame, and about 4 would sit near the +1.5 ms budget.
3. **Windows:** all **14 bays per side**, unbroken.
4. **Stage:** **no raised stage.** The game has no step-up, so the DJ end is just floor, marked by the deck and dressing.
5. **Ceiling lights:** keep **one centre row of 4 tubes** (u 3.5, 10.5, 17.5, 24.5; all mood `steady`, so the strobe owns the beat). The darker wall strips suit the Doom 3 darkness and give the beacons and stars more to do. If the contact sheet shows it too dark, `lamps()` can take two rows.
6. **Ceiling arch:** **scale the rise with the width**, so an 8 m ceiling doesn't look flat.
7. **Favour tables:** keep the new **third table** (east, past the boiler).
8. **Deferred:** a lit dance-floor art piece.

## The approved rid-5 table

The frame is x across (−4 west .. +4 east) and u along from the south door (0) to the north door (28). The bay ribs are at u = 0.7 + 1.9k. This is the table from `proposed_rid5.py`, with the stage label changed to "DJ end" (no riser):

```python
dict(rid=5, name="boiler-room", w=8.0, L=28.0, h=3.4,
     walls=[],
     areas=[("favours + boiler (entrance)", -4.0, 4.0, 0, 8.3),
            ("dance floor (6 x 10 m) under the disco ball", -3.0, 3.0, 9.0, 19.0),
            ("chill-out", -4.0, 4.0, 19.7, 24.8),
            ("DJ end", -4.0, 4.0, 24.8, 28.0)],
     props=[("favours", -4.0, -3.3, 2.0, 3.6, 0.76), ("favours", -4.0, -3.3, 4.5, 6.1, 0.76),
            ("favours", 3.3, 4.0, 3.0, 4.6, 0.76),
            ("pillar", -2.55, -2.25, 8.4, 8.7, 3.4), ("pillar", 2.25, 2.55, 8.4, 8.7, 3.4),
            ("pillar", -2.55, -2.25, 19.3, 19.6, 3.4), ("pillar", 2.25, 2.55, 19.3, 19.6, 3.4),
            ("bar", 3.4, 4.0, 10.0, 16.0, 1.1),
            ("piston", -4.0, -3.3, 11.7, 12.5, 3.4), ("piston", -4.0, -3.3, 13.6, 14.4, 3.4),
            ("piston", -4.0, -3.3, 15.5, 16.3, 3.4),
            ("dj deck", -2.9, -1.1, 25.8, 26.6, 1.1)],
     spawns=[*[(f"dancer-{i}", "zombie", x, u) for i, (x, u) in
               enumerate(((-1.6, 11.0), (1.4, 12.4), (-0.8, 15.6), (1.8, 17.2)), 1)],
             ("soldier-bar-1", "soldier", 2.9, 12.8), ("soldier-dj", "soldier", -2.0, 27.2)],
     pickups=[("favour-dynamite", "dynamite", -3.65, 3.0), ("bar-health", "health", 3.4, 16.8),
              ("dj-cd", "cd", -3.5, 27.4)],
     gates=[], moods=["steady", "steady", "steady", "steady"],
     fires=[("party-boiler", 3.4, 0.7, 0.6, 1.0)],
     triggers=[("strobe", "light.strobe.room.5", -4.0, 4.0, 5.5, 6.5)],
     beacons=[(0.0, 7.0, 2.95, 0.7), (0.0, 21.0, 2.95, -0.7)])
```

**Build-script values that move with it** (`build_night_train.py` hard-codes them):
- **Disco ball:** at u **14.0**. It was `put("disco-ball", 0, h - 0.33, g(10.0))`.
- **Steam vents:** `((-2.9, 10.8), (-2.9, 13.05), (-2.9, 14.95), (-2.9, 17.0), (2.8, 21.5))`. They were `((1.6, 6.8), (-1.6, 12.6), (1.6, 18.6))`.
- **DJ deck:** it now stands **across the far end, facing south**. `prop()` always places it at the west wall facing +x, so it needs a new yaw branch.
- **Pistons:** 3, centred on the bay ribs, so every west window stays clear.
- **Fire:** x = w/2 − 0.6 = 3.4.

Everything north of the Boiler Room (the tender and cab) shifts **+8 m** along the train.

---

## Task 1: Kit — scale the ceiling-arch rise with width

**Files:** `scripts/levels/build_train_kit.py`. The ceiling bay uses `CEIL_PROFILE`, stretched sideways by w/3, with a fixed 0.4 m rise.

- [x] Make the rise proportional to the width, with the 4.2 m carriages staying exactly as they are: rise = 0.4 × (w / 4.2), capped at about 0.8 m for 8 m. Also check the centre ceiling pipe (`ceiling_bay`, radius 0.13 at h − 0.2), because the beacons hang at y 2.95 to clear it. At 8 m the pipe may need to follow the arch.
- [x] Also check:
  - the floor grate: a fixed 1.2 m centre strip. Widen it for w 8, or accept it and note it.
  - the caged lamp in each ceiling bay: fixed at x 0.4. Fine to keep.
- [x] Rebuild the kit. Confirm that the 4.2 m pieces are unchanged (byte-identical or visually identical) and that the new `-80-34` / `-80` pieces exist.
- [x] Commit: `feat(kit): ceiling arch rise scales with carriage width (8 m Boiler Room)`.

## Task 2: Layout, build and export

**Files:**
- `scripts/levels/night_train_layout.py`: replace the rid-5 table.
- `scripts/levels/build_night_train.py`: the disco ball u, the steam vents, a new DJ-deck yaw branch, and the fire x if it's hard-coded.
- The regenerated `assets-source/levels/night-train.blend`, `public/assets/levels/night-train.level.json` and `public/assets/levels/night-train.art.glb`.
- `docs/game/levels/01-night-train/layout.md`: the carriage-5 row and the layout drawing, `layout-draft2.png` or its successor.

- [x] Put in the table and the build values above.
- [x] Run the real pipeline: headless Blender builds the level, and `export_level.py` writes the JSON and GLB.
- [x] Check the JSON diff: room 5 is bigger, and everything north of it shifts by +8 m. Nothing else in the south carriages changes.
- [x] Re-render the layout SVG and PNG, and update `layout.md`.
- [x] Commit: `feat(level): Boiler Room 8 x 28 m (bigger on the inside)`.

## Task 3: Fix everything that hard-codes room-5 or north-of-room-5 coordinates

**Known breakages:**
- `src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts`: its widths array has 4.2 for boiler-room; the nav points `z('boiler-room', 10 / 18.3)`; the beacon positions and heights (keep the "below h − 0.33" check).
- `scripts/sdf-disco-check.mjs`: room 5 is hard-coded as x −2.1..2.1, z −90..−110, along with the trigger z.
- `scripts/sdf-game-train-gate.mjs`: probe points for the boiler, vestibule 6, tender and cab, plus the `boiler` pose.
- `scripts/sdf-game-light-gate.mjs`:
  - the Boiler Room poses in section 6 (the strobe);
  - section 6b (beacons);
  - the list and cost poses `(0, -96.0, …)`;
  - anything with z ≤ −90.
- Anything else: `grep -rn "\-9[0-9]\.\|\-1[0-2][0-9]\." scripts src/lab/sdf-zombie/webgpu/*.test.ts` for Night Train z coordinates past the Boiler Room start, the tender and the cab (`level.end` at the firebox).
- The level's `COMPLETE_ON` / firebox trigger positions move with the cab; check the loop gate (`scripts/sdf-game-loop-gate.sh`).

- [ ] Update each file. Prefer deriving positions from the level JSON (room bounds) over new hard-coded numbers.
- [ ] Commit: `test(level): gates and tests follow the resized Boiler Room`.

## Task 4: Verify, look, cost

- [ ] Run the targeted vitest (`level-json*`, `game-context`, the disco, beacon and light tests) and `npx tsc --noEmit`.
- [ ] Run the headless gates with `LAB_TMP=.lab-tmp`. Each script owns its servers; never touch port 5180, the owner's dev server. All must PASS:
  - `bash scripts/sdf-game-light-gate.sh`
  - `bash scripts/sdf-disco-check.sh`
  - `bash scripts/sdf-game-train-gate.sh`
  - `bash scripts/sdf-game-loop-gate.sh`
- [ ] **Look check for the owner**, at `docs/dev-notes/2026-09-27-boiler-room-beacons/` or a new `boiler-resize/` notes folder. Capture from the south door and from the dance floor:
  - the party before the strobe (tubes, disco stars);
  - after the strobe, with the beacons sweeping and the red stars pulsing;
  - one shot of the windows on both walls.

  **Look at the images.** Report whether the wall strips are too dark with one row of tubes (decision 5), and how the disco stars read at 4 m walls. They get sparser and bigger there, so `DISCO.count` might need raising.
- [ ] **Cost:** the Boiler Room frame time (the light gate's cost section plus beacons on/off) against the +1.5 ms budget. There are about 4 more bays of kit pieces, so re-measure the train gate's frame-time budget too. Measure at a 1-minute load average under 4.
- [ ] **march-hash:** `node scripts/march-hash.mjs`. The pins probably don't move (it captures room 1), but confirm.
- [ ] **Docs:** the notes, `TASKS.md` (one line), and `docs/tasks/levels.md`.
- [ ] Commit: `docs(level): Boiler Room resize — sheet, cost, notes`.

## Rules

- **Pure logic, no `main()` bindings.** Game logic goes in pure modules with tests; no new `main()` bindings.
- **Git:**
  - Never `git stash`.
  - Stage your own files explicitly.
  - Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Headless only** (`LAB_TMP=.lab-tmp`). Never use the in-app browser pane, which loses the WebGPU device.
- **Assets:** extracted Blood assets are dev placeholders, never committed. This task only touches the tracked kit and level files.
- **Memory:** use dualmem, not MEMORY.md. Obsidian notes go only under `Claude Notes/`.
