# Night Train hand-off — 2026-09-27

**Branch:** `claude/wake-level-pipeline-1afb01`, in the worktree `.claude/worktrees/wake-level-pipeline-1afb01`.
- **`main`:** fast-forwarded and **pushed to GitHub** at `02b4d8a6`. The branch is pushed to the same commit.
- **Previous hand-off:** [2026-09-26](2026-09-26-night-train-handoff.md).

## What shipped today

1. **Part 3, plan 1: the shared light list.** [Notes](2026-09-27-shared-light-list/notes.md) · [spec](../superpowers/specs/2026-09-26-shared-light-list-design.md) · [plan](../superpowers/plans/2026-09-26-shared-light-list-plan-1.md)
   - One per-frame list of 32 lights. Each SDF body, crowd member, bone mesh and gib piece picks its own 4 lights and shades them with presentation profiles.
   - `?lightlist=0` gives the old key path.
   - Cost is about 0 ms. The earlier "+1.6 ms" was an artefact of Apple GPU pass timing; use `attributePassSamples`.
   - **Owner decisions:**
     - the self-shadow was **rejected** (too subtle, +1.3 ms), and ships off;
     - the pale body baseline is approved;
     - gibs have **no fresnel/edge rim**.
   - **Fixes made along the way:**
     - the skull catches the muzzle flash and dims in dark rooms;
     - gibs pick lights per object;
     - the flying arm gib no longer shows its bone through the motion blur.
2. **PR #25 merged:** march-hash is deterministic (the light-clock pin) and the pins were refreshed.
3. **Boiler Room emergency beacons.** [Notes](2026-09-27-boiler-room-beacons/notes.md)
   - Two red rotating ceiling spots with per-frame hard shadows, beams and domes.
   - They are armed by the strobe (the `emergency` script) and reach bodies through the list (`beacon` profile).
   - Cost: +0.7 ms frame.
4. **Boiler Room disco ball.** [Notes](2026-09-27-disco-ball/notes.md)
   - A mirror-tile ball throwing 96 stars cast against the room box: white at the party, flashing with the strobe, red pulses as the beacons pass.
   - Cost: about 0 ms. It also draws under `?renderer=deferred`.
5. **Flashlight** (`83dcd38c` shoulder, then `d88c7bb7` retune): see below.

## Flashlight retune — landed at hand-off (d88c7bb7, reviewed)

The torch is judged at the **chest** (profile `coverAt`), `FLASHLIGHT_LIST_TRIM` 2.8 → 0.43, flashlight `distFall` 0.01, and the beam tail in `compose.wgsl.ts` is a **hue-preserving** luminance Reinhard (bodies go bright pink, not white; glints still go white). Torch-only bodies: pink and modelled at 1.5–6 m, 4.5–8× the torch-off body, 0% blown. Sheet: `2026-09-27-shared-light-list/flashlight-retune.png`. Gate 7b sweeps 1.5/2.5/4/6 m with absolute bounds. **Open owner calls:** under a lit tube the torch adds only ~5% (lever: `LAMP_LIST_TRIM`, i.e. the approved tube look); the default level reads darker from 4 m; next lever the body dark floor (25% → 15/10%) side-by-sides. Review minors: `beamTail` (light-shade.ts) is a test-only twin of compose.wgsl.ts — keep in sync; gib picks ignore `coverAt` only because chunk `feetY === pos.y`; muzzle could also move to the chest.

## Next

0. **Scene contrast (owner, 2026-09-27, after the flashlight retune):** "things are visible now, but the overall scene lacks a little contrast — everything a bit medium grey". Start by measuring, not tuning: luminance histograms of a few Night Train frames (third class lit, a dead carriage with the torch, the Boiler Room after the strobe), before and after the final grade, to see where the greys come from. Suspects, in order:
   - the post grade: the black point (`STORM.grade.crush` is only 0.06, and applies during flashes), no S-curve;
   - the VHS/dither pass lifting blacks;
   - the distance fog colour/density flattening everything toward one grey;
   - the ambient and probe fill on the level;
   - the body dark floor (BODY_DARK_FLOOR 0.25);
   - the tube light spreading evenly.

   Then show the owner side-by-sides of one or two levers (e.g. a gentle S-curve plus a deeper black point in the final grade), keeping "never flat black" for zombies.

   **Update (owner, after a replay):** "softened a bit". The Night Train looks fine for the most part, so this is a **light touch**: still curious about a gentle S-curve, not a relight. Keep the side-by-sides small (S-curve strength off / gentle / medium).

   **Also noted (low priority, the test-rooms level only):** there the torch feels really weak, because the coloured room light orbs completely overpower it. The owner thinks it's probably just the coloured lights' tuning. The rooms level is for testing, so don't retune the flashlight for it. If it's touched at all, turn the orbs down in that level's data.

1. **The Boiler Room resize to 8 × 28 m.** The owner approved the layout. [Plan](../superpowers/plans/2026-09-27-boiler-room-resize.md) · [before/after](../game/levels/01-night-train/boiler-resize/boiler-before-after.png)
2. **Open owner items:**
   - tube shadow maps at 256² (they look identical and save nothing);
   - a body in a beacon beam blows out flat red (tone the beacon down on bodies?);
   - the disco stars stretch into ellipses on the side walls;
   - delete the old lighting path once the owner signs off, keeping `applyRoomFill` and `applyStormBodyKey`, which the list uses.
3. **Part 3, plan 2:** level materials on the list, plus the shadow atlas. See [rendering](../tasks/rendering.md).

## Gotchas learned today

- **Pass timing on Apple GPUs.** Every pass reports the same start time, so a pass's end − start is queue wait, not its cost. Charge each pass only from the previous pass's end (`attributePassSamples`). `timeDraws` doesn't advance the pass frame counter.
- **The march golden is a text-hash gate.** Deliberate WGSL changes must re-pin it with `-u` and say so in the commit.
- **Beacons are excluded** from the glass colour and the room fill (`countsAsRoomLamp` / `countsForRoomFill`).
- **The deferred router hides unlit `MeshBasicNodeMaterial` meshes under `levelGroup`.** Register them with `'forward'` (`c6c76b9f`).
- **This session's agents can't write outside their own worktree** (a hook). Run parallel work in the same worktree, and stage your own files explicitly.
- **The Night Train level pipeline** (layout → headless Blender 5.2 build → `export_level.py`) reproduces the committed JSON and GLB byte for byte, so any diff is real.
