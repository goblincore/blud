# The egg emerges in the Flat (in the level, in the game): design

**Date:** 2026-10-16 · **Status:** approved by the owner 2026-10-16, plan written, not built · **Branch:** `claude/emergence-in-the-flat` (stacked on `claude/screen-emergence-lab`, PR goblincore/blud#47, which merged the expressions work, PR #48) ·
**Parents:** [the screen emergence lab spike](2026-10-11-screen-emergence-lab-spike-design.md) (the pass, the timeline, the goblin choreography, built and in look rounds) · [goblin facial expressions](2026-10-13-goblin-expressions-design.md) (the `goblin-cinematic` head, expression clips) · [the Flat in the engine](2026-10-11-flat-room-design.md) ·
[the screen emergence draft](2026-10-01-flat-screen-emergence-design.md) §3.1 (two scenes in one page: this spec does not need it) ·
**Owner (2026-10-16):** "it would be cool to see the egg transition in the actual level space"; the first look is a **debug-triggered scene in the Flat** (not the train hookup, not just the pass on the iMac); keep the machine light (render at 320 x 240, no heavy tasks); the lab page stays the tweaking bench.

## 1. Why

The lab page proves the look on a stage set; the owner wants to see it where it will live: the goblin's apartment, the real room, the real kotatsu, the game's lighting and cameras. It also forces the pieces the final game needs anyway (the screen pass in the game's SDF layer, a scripted goblin, an emergence sequence, the early stage of the Flat) without building the Night Train hookup yet.

## 2. What the owner will do

Open `?level=flat-early&emergence=1&res=320` (320 x 240). The Flat as it is, but the kotatsu holds a CRT, a keyboard and a lamp, with a cushion beside it, and no Giger iMac. About two seconds after load the first-person view is taken over and the emergence plays, in cuts, with the goblin (the cinematic head with his expressions, in his home clothes) typing, flinching, bracing, the tear, the egg landing on the goo-coated keyboard, and him sitting up and looking at it with an evil grin. Then the player's view takes his seated eye position looking at the egg, the puppet vanishes, and the player can walk. A console command replays it.

## 3. The design

| Unit | Does | Notes |
| --- | --- | --- |
| **`flat-early` level** | The Flat's art and level JSON built by the same Blender script with a stage flag, **without** the Giger iMac, its umbilicus and hoses, and with the iMac's lights replaced by a lamp light and a screen-glow light at the kotatsu | The game's art is exported per room and material (`art:1:giger_shell`, `art:1:screen`...), so the iMac cannot be hidden at runtime; a variant art file is the clean route and is the first "earlier stage" of the flat. About 21 MB committed (owner: file size is no concern). `?level=<id>` loads `/assets/levels/<id>.level.json` generically |
| **`screen-pass.ts`** | The screen pass (the proxy box, the WGSL, the per-frame uniform update from the emergence parameters and the goo, the picture) extracted from `screen-lab-main.ts` | Both the lab page and the game use it, so they always match |
| **`screen-set.ts`** | The set builders (CRT, keyboard, lamp, zabuton, kotatsu skirt) extracted from the lab page, parameterised by a parent object and the layout | In the game the table, the room and the floor are the level's; the set builds only the CRT, keyboard, lamp and cushion |
| **`emergence-placement.ts`** (pure) | The transform between the screen frame (origin at the glass centre, +z out of the screen, metres) and the world: the kotatsu's centre from `flat_layout.py` (`KX`, `KY`, the board at 0.44 m above the room floor; Blender y becomes game -z), the screen facing the room (game +z) | A round-trip test; the camera presets and the goblin's position go through it |
| **`goblin-puppet.ts`** | The goblin's view, skin, pose pinning (`pinToPose`, so the game does not fold his crossed legs: `pinTips` and `constrainRigBends` run after the pose is pinned, found in the lab) and expression driving, extracted from the lab page, taking the SDF layer's dependencies as an argument | In the game the dependencies come from `ctx.render.sdfLayer` as `game-spawn.ts` passes them |
| **`goblin-cinematic-home.blob`** | `goblin-cinematic.blob` plus the home clothes block (vest, shorts, bare feet) of `goblin-home.blob`, with the same kind of guard test | The expression library, the pose library and the registry get the new name |
| **`emergence-expressions.ts`** (pure) | The expression cues for the sequence, derived from the goblin's cue times (`goblinCues()`): neutral typing; surprise at the flinch; a shout or scowl through the tear; the evil grin as he sits up and looks; blinks | Crossfades between the library clips (`neutral`, `surprise`, `scowl`, `shout`, `evil-grin`); first-round values, tuned in the lab |
| **`game-emergence.ts`** | The runtime on `ctx.world.emergence`: builds the set at the kotatsu on load when `?emergence=1` (or the level is `flat-early`), adds the pass proxy to the SDF layer's late scene (like `game-egg.ts`), makes the puppet, runs an `emergence` sequence on the existing sequence system (camera override, gun and HUD hidden, input blocked), steps the clock on the sim step, and at the end hands back to the player | Seams: `__sdfGame.emergence()`, `startEmergence()`, `skipEmergence()` |
| **Cameras** | The lab's shot presets re-authored for the room (the lab's push and out cameras sit 2.4 to 3 m from the kotatsu, outside the Flat's 2.7 m-wide room), as a table in the screen frame, placed through `emergence-placement`; every eye must lie inside the room box (a test) | The sequence system's `fixed` camera kind is used per shot, built at runtime from the placement |
| **Resolution** | A `320` rung in the game's `RES_RUNGS` (320 x 240, 4:3, fixed) and `?res=320` | The lab page already takes `?res=WxH` |

**The shared clock.** The sequence's `t` is the sim time; the emergence parameters (`paramsAt`), the goo (`gooAt`), the goblin's clips, root offset and expressions are all pure functions of `t` (the lab's design), so the game scene shows the same frames as the lab at the same `t`.

## 4. The hand-off

At the end (about 14.5 s) the sequence's last shot ends: the puppet is hidden, the pass and the set stay (the egg sits on the keyboard in its goo), the player's camera is placed at the goblin's seated eye height (about 0.6 m above the floor he sits on) on the cushion's spot looking at the egg's centre, input is released (the sequence system's end), and the player can stand and walk (the first-person controller resumes from that position: it clips to the room's collision). The emergence does not replay unless asked.

## 5. Verification (light: the owner's machine is busy)

- **Pure units:** placement round trip; the camera presets inside the room box; the expression cues (cue times derived from `goblinCues`, the expressions' order, channel ranges, continuity at crossfades); the res rung; the `flat-early` level JSON (parses, the iMac materials absent from the art's GLB, start position inside the room, lights within the cap).
- **One headless boot check at 320 x 240** (`scripts/flat-emergence-check.mjs`, own ports, one Chrome at a time): the level boots with no console errors or WebGPU validation messages, the sequence starts, `skipEmergence`-style stepping to key times, five frames into a sheet, a single cost read (recorded, not gated), and the hand-off leaves control with the player. **Not** the full 1280 x 800 matrix; the lab's `emergence:check` stays as it is.
- **The owner is the judge of the look** in his own browser at 320 x 240.

## 6. Out of scope

The Night Train ending's hookup and the two-scene seam; the sequence being a level command from a trigger in the world (the flag and the seam are the triggers for now); a live CRT picture (the picture is the committed Night Train still); an openable front door; the later stages of the Flat (more early-stage clutter, the apartment's other rooms); sound; the base goblin's expression-less head; the game's zombie-face bug in `faceFor` (`game-wound-vfx.ts`); making the hand orb follow its bone (an owner and engine call, noted in the lab notes); cost optimisation (the cinematic head is heavy: +47 ms close-up in the lab at full res; at 320 x 240 and a few shots it is the owner's to judge).

## 7. Risks

- **The game's SDF layer and a scripted body.** The puppet must draw through the game's layer (the lab page uses its own layer); the dependencies and the lights differ (the game's practical lamps, the Flat's light list, the cap of 32). The first look is a boot check; expect to tune the puppet's lighting (he was dark from behind in the lab).
- **The cinematic head's cost** in a game frame already carrying the Flat (about 9 to 10 ms) and the pass; mitigated by 320 x 240 and by the sequence being short.
- **Camera presets in a small room** (2.7 m wide): shots that were wide in the lab have to be tighter or inside the room.
- **The pose path** (`pinTips`, `constrainRigBends`) must be bypassed in the game exactly as `pinToPose` does in the lab, or the legs fold again.
- **Level art variant drift:** `flat-early` is a second 21 MB art file that must be rebuilt when the Flat's script changes; the plan records the command, and the stage flag keeps the two from diverging in code.
