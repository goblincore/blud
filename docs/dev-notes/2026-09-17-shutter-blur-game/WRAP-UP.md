# Selective shutter blur — accepted 2026-09-17

Owner accepted the combined in-game blood and flying-gib look and authorized merging into main and cleaning up the task worktrees. The accepted implementation is the four-task game chain ending at `82aa3c9f` (substantive code `b4294efc`), plus the panel visibility fix `06b04a06`. The preceding three-task lab chain is included.

## Shipped behavior and controls

- Active FPS `/sdf-game.html`: blood and moving-gib blur default ON, **44.444 ms exposure / 120 content-pixel maximum streak**. This preserves the owner's screenshot: 320 degrees at explicit reference 20 fps. The displayed 1/30 preset was inactive under angle mode.
- **BLOOD + GIB BLUR** is the collapsed title bar at **bottom-right**. Click its title/caret to expand; **H** hides/shows all tuning panels. Blood/gib switches are independent; Exposure and Max trail are shared. For stronger smear, try **66.67 ms / 200 px**; 100 ms is also available.
- Exposure is fixed time, independent of live render FPS. Gib motion includes translation and per-surface rotational probes. Settled stationary pieces return to the sharp path. World, actors, viewmodel and HUD stay sharp.
- Query examples: `?bloodblur=0`, `?gibblur=0`, `?blurms=66.67&blurmax=200`. Disable both for the sharp comparison. Live API: `__sdfGame.shutterPanel(true)`, `setBloodBlur(on)`, `setGibBlur(on)`, `setBloodBlurExposure(ms)`, `setBloodBlurMaxStreak(px)`.
- `/sdf-blood-compare.html` remains the synchronized Sharp / Candidate / Sampled-reference lab.

## Missing panel — root cause and fix

Both shutter-panel and dynamite-panel requested `right:782px` in the same top-row shell. Dynamite was created later and painted over the blur panel; narrow viewports could also push that slot out of view. Fix: give the shutter panel its own bottom-right dock (`right:8px`, `bottom:8px`, `top:auto`), constrain its width to the viewport, and name both affected categories in the title. No shader or accepted appearance changed.

Root verification of the fix: 43 focused tests passed across panel-chrome, gib-shutter-layer and shutter-game-layer; `npx tsc --noEmit` passed. A lightweight DOM fixture using the real panel factories showed the expanded blur panel fully visible at bottom-right, separate from the top-row panels. This was a layout check, not a new gameplay/GPU benchmark.

## Evidence and practical limits

The dispatch [final report](TASK-4.md) records 302 focused tests, typecheck/build, real WebGPU gameplay comparisons, a rotation fixture, transitions and captured clips. Root reviewed the report and combined-blast comparison image; the owner then accepted the live game. No new full-suite run or independent GPU retiming is claimed for merge.

- **Marginal game cost remains unmeasured reliably:** foreign load caused timing spread larger than the differences. Do not substitute the earlier +0.46 ms ordinary *lab* number for in-game cost. Quiet-machine measurement is a tracked follow-up.
- Long streaks retain fine comb texture; each motion-seed texel has one owner. Moving/static blood no longer metaball-fuses during nonzero exposure. Current angular-velocity extrapolation does not resolve a spin reversal inside one exposure.
- Gib blur is explicitly unsupported in opt-in deferred mode; those pieces remain sharp. Default forward mode is the accepted route.
- Selected gib material compilation is not fully awaited at boot; a first-use hitch remains possible.
- Root's in-app-browser playtest lost its GPU during warm-up twice. The same default build reached **READY — CLICK TO START** in normal Chrome. Cause remains unproven; use Chrome for now and retain the issue rather than claiming it fixed.
- The second gib depth input improves blood/gib occlusion, but it is a current-surface depth approximation, not full time-integrated visibility of overlapping translucent streaks.

## Durable implementation lessons

Use clean scene color/depth behind moving opaque gibs; blurring a completed opaque frame cannot reveal vacated silhouettes. Carry premultiplied selected color/coverage through the exposure resolve; do not threshold density combined across shutter times. Avoid pre-clipping source blood to current scene depth when its swept destination can be visible. Keep motion units/camera conventions explicit and reset or gate invalid spawn/reuse motion.

Compare renderer output at a synchronized simulation instant and report the noise floor of remaining animated effects. A zero-speed center alone does not prove rotation blur; the controlled spin fixture and per-surface motion probes provide that evidence. Passing CPU/source tests or a dispatcher exit code is not visual acceptance.

The shutter review worktrees and owned preview servers are disposable now that the accepted code/evidence are on main. Other project worktrees and unrelated edits remain outside this cleanup.
