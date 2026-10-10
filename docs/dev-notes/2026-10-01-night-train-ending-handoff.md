# Hand-off — 2026-10-01: the Night Train ending (control room, egg, sequence system)

**Start here for the next session on the ending.** Branch `claude/train-monitor-transition-51f385` (worktree
`.claude/worktrees/train-monitor-transition-51f385`), 20 commits on top of `main` at `644aea34`; **not merged, not pushed**
— the owner is still evaluating the assets. Do not merge or push without asking. Spec:
[the ending spec](../superpowers/specs/2026-09-30-night-train-egg-ending-design.md). Plans 1-3 are built; **plan 4 (the
montage) is next and not yet written.**

## State: what exists

| Piece | Where | Notes |
| --- | --- | --- |
| **Control room** (8 × 10 m, replaces the cab; z −130.4…−140.4) | kit pieces in `scripts/levels/build_train_kit.py`, table in `scripts/levels/night_train_layout.py` (rid 8 `control-room`), build in `build_night_train.py` | CRT wall + big monitor (north), consoles/racks both sides, firebox door (east), cable trays. [Plan 1](../superpowers/plans/2026-09-30-night-train-control-room.md) · [notes](2026-09-30-egg-ending/plan1-notes.md) |
| **The egg** (nested, alive) | pure `egg-look.ts`, WGSL `egg.wgsl.ts`, leaf `game-egg-leaves.ts` (`ctx.world.egg`) | Red-veined transparent outer egg → milky spotted inner egg → soft dark figure on a warm glow; pulses on the train clock; a proxy box in the SDF layer's late scene. [Plan 2](../superpowers/plans/2026-09-30-night-train-egg-pass.md) · [notes](2026-09-30-egg-ending/plan2-notes.md) |
| **Sequence system** | pure `ending-sequence.ts`, leaf `game-sequence-leaves.ts` (`ctx.world.sequence`), command in `level-events.ts` | Timeline of shots (camera + overlay) driven by the sim step. **Two-shot stub:** `pull` (4 s) then `black` + "NIGHT TRAIN" (2 s). [Plan 3](../superpowers/plans/2026-09-30-night-train-sequence-system.md) · [notes](2026-09-30-egg-ending/plan3-notes.md) |
| **Level wiring** | `night-train.level.json` | Trigger `egg.touch` (box x ±1.6, z −135.1…−138.3) → cue `sequence.ending` → `completeOn: ending.end`. |

All gates pass at `a09c85b1`: `scripts/sdf-game-loop-gate.sh` (section 5 walks the sequence), `sdf-game-train-gate.sh`,
`sdf-egg-check.sh` (ports 5373/9373), `sdf-disco-check.sh`; 53 unit tests in the touched files; `tsc` shows one
**pre-existing** error (`pack-golden.test.ts`, `node:crypto` types) — ignore only that one.

## What the owner is evaluating right now

The assets: the control room and the egg. Look at them in the owner's own Chrome (the in-app browser loses WebGPU):

```bash
npm run dev    # or the blud-lab preview config; port 5173
# http://localhost:5173/sdf-game.html?level=night-train&god&nospawn&torch
# then in the console: __sdfGame.setPose(0, -131.4, 0, 0)    # the door of the control room, facing the egg
```

Walk to within ~1.6 m of the egg and the (stub) ending plays. Reference images, all in `docs/dev-notes/2026-09-30-egg-ending/`:
`egg-pass.png` (6-frame contact sheet: door, near r0, near r1, behind, pulse 0/1), `egg-pass-before-tuning.png`,
`control-room-ingame.png`, the **Blender blockout** (`control-room-door.png`, `control-room-overview.png`, `egg-close.png`,
`controlroom_blockout.blend`), and the four sequence frames `seq-pull-0/2/4.png`, `seq-black.png`.
**Wait for the owner's verdict on the egg look before polishing it.** The owner's standing preference: lighting/visual
changes **slowly, one lever at a time, with side-by-side sheets**.

### Known gaps vs the blockout (the owner may ask for any of these)

- The core glow is a broad flat peach, not a bright core falling off to dimmer milk, so the figure reads as a dark *patch*
  more than a silhouette against a backlight. The limbs are barely legible.
- Spots are flat discs (the blockout's were similar but fewer/smaller); the outer shell is a plain ellipsoid (no taper).
- The last frame of the pull (`seq-pull-4.png`) looks dim and slightly faceted at full zoom.
- The egg's room light (a `fire`-mood lamp) and the consoles' screens do **not** follow the pulse.
- The consoles' CRT screens are static emissive colours (no animation).

## Plan 4 — the montage (next)

Spec §4 has the shot table (pull, vein, wall static, spot, figure, egg in space, train as a sperm, inside, black + title,
~30 s, hard cuts, one flash). The stub covers shot 1 and 9. What plan 4 needs that does not exist yet:

1. **A per-shot scene selector.** `Shot` has a camera and an overlay but no scene; the egg-in-space and exterior-train shots
   need a different scene (stars, the egg alone, a distant train silhouette). Add a `scene` field to `Shot` and a leaf that
   shows/hides the right world (the late scene is the established place for effects).
2. **More camera kinds** in `ending-sequence.ts` (`CameraSpec`): macro/close-up on a named anchor (a vein, a spot), an orbit,
   authored `fixed` poses. `cameraAt` returns `null` to hold; extend it, keep it pure and tested.
3. **`eggShade` has no inside-the-shell case** (the eye must be outside the outer ellipsoid). The "inside" shot (milk thinning
   to white) needs one, and the extreme close-ups (vein, spot) get very near the shell: check the proxy box's front-face depth
   trick still holds when the eye is within ~0.2 m of the box. The plinth keeps the *player* out of the box; the *sequence
   camera* is free to go anywhere.
4. **The exterior train silhouette** (shot 7): built from the level's room widths/lengths (tail = the 3.6-4.2 m carriages,
   head = the 8 m Boiler Room + control room) — see `night_train_layout.py` `CARRIAGES`. Seen once, far away, lit windows.
5. **Draw budget.** The train gate's worst pose (office) is **+182 of +200** art draws; the control room cost ~+18 draws at
   *every* pose because nothing culls art by room. Per-room art visibility (reuse `nearRoomMask`) would give ~18+ back (rooms
   1-7 are ~120 batches). Do this first if plan 4 adds art. Findings: [plan1-notes.md](2026-09-30-egg-ending/plan1-notes.md).
6. Smaller: freeze enemies during a sequence (only input and damage are frozen now); the end title is a DOM stand-in;
   no sound / beat clock (cuts are authored in seconds, on a half-second grid); the 4 px centre dot and the dev panels
   (VHS/WOUND/LIGHT LAYERS) are still visible during the pull (the z-44 overlay covers them for the black shot).

**Open design questions for the owner** (do not decide for them): does the figure stay a smudge the whole way or sharpen as
you approach (`EGG.resolveDefault` = 0.5 today; one tunable parameter); who is the figure (the goblin? left open);
should the egg react to the player earlier in the level; what does the `dj-cd` pickup do (still just a collectible); does
the egg carry you out at the end (the vision's "pull-back out of the CRT" needs the Flat and CRT render-to-texture, which
do not exist; the spec chose scope B = montage then black).

## Things a new agent must know (learned the hard way, 2026-09-30)

- **Build the kit IN PLACE**: `blender --background --factory-startup --python scripts/levels/build_train_kit.py`. A kit saved
  elsewhere loses its textures on export. A fresh kit rebuild may rewrite `kit-textures/*.png` — `git checkout` them; and it
  does not reproduce the committed art GLB byte-for-byte, so if `night-train.art.glb` shows modified with no art change,
  restore it. The level JSON *is* reproducible; use its diff to check a change (rooms 1-7 must not move).
- **Level pipeline**: tables (`night_train_layout.py`) → `build_night_train.py` → `export_level.py -- public/assets/levels/night-train.level.json`.
  Hard-coded coordinates live in `level-json.night-train.test.ts`, `scripts/sdf-game-train-gate.mjs`, `sdf-game-loop-gate.mjs`.
- **Art draws are batched per (room, material, shadow flag)** in `batchArt()` (`game-art-leaves.ts`); instanced vs joined makes
  no runtime difference. More materials in a room = more draws at every pose.
- **`tick()` runs live even with `?frozen`** (that only freezes wanderers), so the sequence clock advances in real time
  between CDP evaluates. Captures: `setPose`, then `stepN` immediately. The loop gate's windows leave ~0.4 s of margin.
- **Import cycle**: `game-sequence-leaves.ts` must not import `game-loop-leaves.ts` (it imports the sequence leaf); the end
  event is pushed straight onto `ctx.world.loop.pending`.
- **New `ctx.world` fields** need three edits in `game-state-world.ts` (type, default, `WORLD_BINDINGS`) and a bump of the
  binding-count assertion in `game-state-world.test.ts` (34 now). State on `ctx`, never new `main()` bindings.
- **The WGSL approach** (`egg.wgsl.ts`): analytic ray-ellipsoid intersections in a fixed order (no transparency sorting),
  Gaussians integrated in closed form along the ray (no marching), output premultiplied rgb + `alpha = 1 − T`. Tunables are the
  `EGG` / `FIGURE` tables in `egg-look.ts` (the WGSL is generated from them): `figureStrength`, `coreGain`, `coreScale`,
  `milkSigma`, `spots`, `shellAlpha`. Two formula tweaks beyond constants are documented in plan2-notes.md.
  `wgslFn` takes one `fn` per string; helpers go in as includes; nothing in node compiles WGSL (the headless boot is the compiler).
- **The check script's contrast boxes are pose-specific** (`scripts/sdf-egg-check.mjs`): if you change the spot layout, re-check
  the boxes against fresh frames (adjust the boxes, never the thresholds).
- **Headless gotchas** (from earlier hand-offs, still true): wait for `window.__warmGate.phase === 'ready'`; cost gates need a
  quiet machine (load under 4, the owner's game tabs closed); `export LAB_TMP=.lab-tmp`; never kill a server you did not start.

## Where to look

`docs/tasks/levels.md` item **4n** (status), `TASKS.md` (front page), the three plan notes under
`docs/dev-notes/2026-09-30-egg-ending/`, and dualmem (`claude:blud`): the checkpoint "night-train egg ending" and the decision
entries on the sequence system and the art-draw finding.
