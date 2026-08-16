# SDF lab FPV + dynamite — design (Spec C)

**Date:** 2026-08-16
**Status:** approved (brainstormed with project owner)
**Scope:** SDF zombie lab only, **WebGPU path only** (WebGL frozen). No game-side changes; game modules are imported only where they are pure data.
**Sequencing:** after the rig motion pass (X1.22) — the explosion's stagger/
collapse reactions must exist when dynamite arrives — and before the skeleton
reveal (X1.20).

## Why

The lab needs a real weapon to playtest the gore stack as a game loop instead
of a god poking a statue. Owner decisions: **dynamite** (the game's throw/
fuse/explosion behavior is playtested and stays authoritative — graphics get
replaced); **full FPV walk mode** (pointer-lock look + WASD, toggled with the
god-cam); and first-person hands that are **fleshy** — the game's thesis is
flesh, so the hands are made of it.

## 1. FPV mode

- Pointer-lock look + WASD on the arena floor, eye height from the game's
  playtested 1.75 m; `Tab` toggles between FPV and the existing god-cam (all
  god-cam tooling — panel, orbit, click-shoot — keeps working in god mode).
- In FPV, left-click = throw (hold to cook, release to throw); the god-cam
  click-shoot pipeline is untouched.
- Minimal HUD: a cook-charge bar. No crosshair needed for lobbed throws
  (the hands ARE the sight). Sound out of scope.

## 2. SDF hands

**Decision: SDF, not mesh.** Mesh hands would imitate the latex flesh; SDF
hands ARE it — same march, same material family, and the claymation style
wants chunky mitten hands anyway:

- **4–6 prims per hand** (palm, thumb, fused-finger mass, forearm stub) in a
  small camera-anchored proxy box — its own tiny field, marched like a chunk.
- **Animation = keyframed prim poses**, tweened at runtime: idle bob, light,
  cook (fuse sparking, hands tense), throw, recover. Pose timing and
  silhouettes are authored against the game's existing 2D QAV dynamite frames
  as reference (the owner's "baked following the 2D reference frames").
  Poses are plain data constants — hand-tunable, no assets.
- **Verlet jiggle rides the poses** (the rig tech) so the cook-hold wobbles —
  fleshy weight in the player's own hands.
- **Flourish: splash damage marks the hands.** Cook too long / detonate too
  close and the hands gain wounds via the existing wound pipeline (they are
  just another small body). Cheap, on-theme, nobody else has it.
- **Perf gate**: hands cover meaningful screen area up close — benchGpu with
  hands enabled is measured in the first implementation task, same discipline
  as the shell experiment.

## 3. Dynamite behavior — the game's, verbatim by constants

- Trajectory, cook and fuse reuse the game's **pure-data tuning**
  (`DYNAMITE_COOK`: 2.0 s max charge, 6→28 m/s velocity band, fuse/impact
  rules) imported from `src/game/gibs/tuning.ts`-style modules — never
  re-derived, never copied. The lab implements a small local ballistic
  integrator mirroring the sim kThing mover's behavior (gravity, floor/wall
  bounce with Blood's elastic feel) using those constants; the game's sim
  module itself stays un-imported (it owns SimState, which the lab doesn't
  have).
- The stick is a cheap mesh prop (cylinder bundle + fuse spark particle) in
  hand and in flight; it is not flesh.

## 4. Explosion → the gore stack

- Detonation applies the game's AOE model: wounds stamped on every body
  point within radius (blast profile, radius-scaled falloff), **launch
  impulses** into the rig (`impulseAt`) and any live chunks, damage-meter
  credit (motion pass) so close blasts kill, sever/chain-cut checks run — a
  good bundle placement takes limbs off, and the gib threshold turns a
  near-corpse into gobs + goo + scraps.
- Air-vs-ground burst visual selection copies the game's
  `GROUND_BURST_THRESHOLD_M` logic; the explosion renders with the game's
  already-extracted SEQ atlases (air fireball / ground dome→mushroom) as
  billboards. Screenshake: a simple FPV camera kick scaled by proximity.

## 5. Testing

- Pure units: cook charge→velocity mapping (against the game constants),
  ballistic integrator (range ballpark vs the game's simulated ~68 m
  full-charge on flat ground, floor/wall bounce), pose tween math
  (keyframe interpolation, phase transitions light→cook→throw), AOE wound
  placement falloff, hand-splash wound gating.
- Visual (WebGPU lab): hands read as latex flesh with jiggle; throw arc feels
  like the game; ground vs air bursts pick the right atlas; a well-placed
  bundle staggers, severs, or gibs; hands scorch on a too-close blast.

## Out of scope

- Other weapons (flare gun etc. — later, on this FPV foundation).
- Sound, HUD beyond the charge bar.
- Skeleton (X1.20), cloth, game-side changes of any kind.
