# Soldier combat and animation polish — 2026-09-06

Branch: `codex/soldier-polish`, worktree `.worktrees/soldier-polish`, based on `0a1906d0` (the lab/game refactor now merged into main). Owner feel check pending; not merged.

## What changed

- The soldier holds a useful firing position between decisions. Repositioning commits to one short endpoint, checks swept body clearance, and ends on arrival, blockage, or timeout. Sidestepping and retreat preserve facing toward the threat.
- Body turning is soldier-specific (5.5 rad/s). Firing waits for the visible telegraph and actual facing alignment. Obstructed sight or leaving effective range cancels the shot; leaving the room cancels it immediately even during alert grace.
- The actor now sends its fire event into motion, applies the hand/shoulder kicks, and releases pellets from the current gun pose. Previously the callback ran before motion and `sinceFire` remained Infinity. Pellets now stop at solid level geometry.
- New forward aiming carry and smooth transitions keep both hands attached. Reduced muzzle rise and a lowered running carry avoid the gun waving across the face.
- Soldier gait phase accumulates continuously through speed changes instead of recomputing `elapsedTime * newFrequency`. The old expression jumped by almost an entire stride late in a session. Cadence stops while idle; backpedal feet follow travel while knees still bend forward.
- The run uses the smoother helmeted soldier reference already in the repository, replacing the zombie-biped run source. The raw sample files remain reproducible via `scripts/gait-from-clip.ts`.
- Fixed the lab's run control: it had reused the reduced patrol cruise, so selecting run still played march. The lab now exposes `__sdfLab.holdPose('aim')` alongside walk, run, and hip.

## Research applied

[Game AI Pro: From Behavior to Animation](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter10_A_Reactive_AI_Architecture_for_Networked_First-Person_Shooter_Games.pdf) describes separate behavior selection and animation responsibilities, including reactive aiming/shooting layers. Applied here as a small explicit contract between decision, movement, and current gun pose rather than introducing a new behavior-tree system.

[Three States and a Plan: The AI of F.E.A.R.](https://gdcvault.com/play/1013282/Three-States-and-a-Plan) is a useful reference for composing explicit actions. This patch retains the existing state machine; its practical change is to make movement actions bounded and give firing explicit prerequisites.

Full cover selection, cover peeking animations, and dodge rolls remain future work. The SDF game still has no player health; soldier shots remain visual combat feedback, with environment collision added here.

## Verification and playtest

Use Node 22: `fnm exec --using=22.22.1 npm test`. A fresh nested worktree picked Homebrew Node 25 and produced 11 unrelated `panel.test.ts` failures (`localStorage.clear is not a function`). The unchanged tests pass with the project's Node 22.

Focused actor regressions cover actual fire clock/kicks/current muzzle, blocked sight, solid geometry, and movement away from a crate contact. Brain regressions cover alignment, sight loss, room exit, first-frame weapon raise, fixed endpoints, arrival, blockage, and timeout. Motion tests use the real soldier rig for reachable hand grips, preserved segment lengths, running gun placement, backward movement anatomy, and late-session phase continuity. Zombie gait pins and actor damage tests remain unchanged.

Live WebGPU captures booted both game and lab without runtime exceptions. Lab presets reported march/low, run/chest, and march/aim correctly. Game samples show aim → recover → settle → hold → short sidestep, with the root stationary during the firing beat. Screenshots are pose evidence, not a substitute for the owner's animation feel check.

Preview: [game](http://localhost:5184/sdf-game.html), [soldier lab](http://localhost:5184/sdf-lab-webgpu.html?character=soldier). In the lab, comma/period select walking/running; F fires. The soldier is in the game's starting room.


Final checks: Node 22 full suite: 3,606 passed / 1 failed (223 files), where the failing new running-carry regression ran during its red/green adjustment. Final rerun of all affected motion, carry, soldier actor, and profile files: 69/69 passed. Earlier independent review verification: 71/71 passed; zombie actor/damage/gait pins: 63/63 passed. Production build (TypeScript + Vite) passed; only the existing bundle-size warning remains. Diff whitespace check passed.
