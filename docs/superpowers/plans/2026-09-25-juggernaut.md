# Juggernaut Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A playable soldier variant: a bigger power-armoured chaingunner who
plants, spins up and hoses the room, with armour that has to be stripped.

**Spec:** `docs/superpowers/specs/2026-09-25-juggernaut-design.md` (read it first).

**Architecture:** Soldier-family behaviour is keyed on `MotionProfile.family`
(`isSoldierFamily`), not the name. The brain is the soldier's with a
`CHAINGUN_TUNING`. Armour absorption lives in a pure `plate-armor.ts` that feeds
the existing kit-damage visuals and soldier injury rules.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest,
headless-Chrome capture scripts (`scripts/*.mjs`), Blender scripts for props.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production
  scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**
    (no `three` import; plain data in, plain data out — the `burn-state`,
    `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module
    only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string
    modules). TSL node graphs are for thin glue (binding, blending), not for
    the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module —
    never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no
    wall-clock in logic) and console/capture seams in plain data.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is
  symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`.
  Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
  Capture scripts require `window.__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance,
  frame-to-frame change, GPU ms, boot time) and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders or materials reports
  cold-boot `drawOnce` against the base branch (fresh profile each run).
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

## Task 1 — Soldier family trait ✅ (2026-09-25)

**Files:** `motion-profile.ts` (+ `family`, `isSoldierFamily`), `motion.ts`,
`actor.ts`, `webgpu/{character-view,lab-main,game-actor,flame-lab-main,game-gibs-leaves,game-burning}.ts`,
`motion-profile.test.ts`, `webgpu/flame-lab-main.test.ts` (source grep).

- [x] `family?: 'soldier'` on `MotionProfile`; `SOLDIER_PROFILE.family = 'soldier'`.
- [x] Every `profile.name === 'soldier'` / `entry.name === 'soldier'` now calls `isSoldierFamily(...)`. No behaviour change.
- [x] Test: a renamed copy of `SOLDIER_PROFILE` is still the family; the cultist gunner is not.
- Left as-is on purpose: `mind.kind === 'soldier'` (the brain kind, which is
  already right for variants), the `skeleton-spike/` experiment, and game-main's
  spawn table (`room.soldiers` names the character).
- Follow-up in Task 3: `createShotgunCasings()` fires for the whole family, so
  the chaingun wants brass casings from its own weapon, not its family.

## Task 2 — Body + power armour, lab only (owner look gate) — authored 2026-09-25

Notes: `docs/dev-notes/2026-09-25-juggernaut/NOTES.md`.

- [x] `juggernaut.blob`: soldier.blob scaled (H 1.15, torso 1.13/1.06 extra,
  arms 1.12, legs and hips 1.10, neck 1.15), no hair, upper arm tilt 12.
  2.291 m tall with 1.30x the soldier's shoulder span. 10 tests.
- [x] `juggernaut-kit.wam`: classic power armour (spec, "The read"). Skeleton
  derived from the `.blob` to six places. Helmet, snout and lenses are on the skull.
- [x] `JUGGERNAUT_PROFILE` (MARCH only, cruise 0.9, turn 1.8, placeholder
  shotgun), registry entry, `lens` look.
- [ ] **Compile the kit** (`scripts/build-wam-kit.sh juggernaut`, needs WAM,
  which is outside the repo; the cloud session's sandbox would not run it),
  then make `juggernaut-kit.test.ts` green (it skips until the glTF exists).
- [ ] GPU frames next to the soldier (front, side, 3/4, walk); STOMP vs slowed
  MARCH, owner's pick. A CPU flesh-only comparison is in the notes.

## Task 3 — Chaingun, single rounds, CHAINGUN_TUNING — done 2026-09-26

Notes: `docs/dev-notes/2026-09-25-juggernaut/NOTES.md` ("Task 3").

- [x] `scripts/make-juggernaut-chaingun.ts` -> `juggernaut-chaingun.glb`. It is
  a TS glTF writer, not Blender (Blender is not available in the cloud
  session). Six barrels on a `Barrels` node, receiver, motor, pistol grip, top
  carry handle, brass feed stub.
- [x] New `heavy` carry, grid-solved on the juggernaut rig, plus `CarrySpec.gunYaw`
  (a cocked wrist) and `prop.foreHand` (the top carry handle). The shared
  fore-end was out of reach in every forward-pointing hip hold.
- [x] `GunnerWeapon` gains `'chaingun'`; `GUNNER_TUNING` maps weapon to tuning (game-main).
- [x] Brain flags `strafe` / `retreat` / `sweepFire` / `burstMin` (the soldier's
  values reproduce the old behaviour); `CHAINGUN_TUNING`: 0.9 s spin-up, 15-24
  rounds at ~10/s, sweep, 0.6 s spin-down, 1.5 s cooldown, no strafe or back-off.
- [x] `spawnRound`: one round per trigger event for `'chaingun'` ONLY. The
  cultist's SMG keeps its 8-pellet rounds (owner, 2026-09-25). Rounds keep the
  gun's heading (the sweep) and take their pitch from the player's chest.
- [x] Barrel spin: `barrel-spin.ts` (pure), driven by the mind's aim, fire and
  recover states, so it winds up before the first round. The actor steps it
  and `held-prop` spins the `Barrels` node. Brass casings (256-slot pool).
- [ ] Audio (spin-up whine, stream, spin-down): none yet, same as the cultist SMG.
- [ ] GPU frames of the hold and the spin (the carry is solved and pinned
  headless; nobody has seen it rendered).

## Task 4 — Armour that works + helmet + stagger resistance — done 2026-09-26

- [x] `plate-armor.ts` (pure, 5 tests). One plate per bone group:
  - helmet (skull and neck) 8;
  - cuirass (chest, spine2, spine1) 20;
  - upper arm 8, forearm 6, thigh 8, shin 6.

  The pelvis is bare: it is the weak spot. A round on an intact plate is
  absorbed; the hit that breaks a plate is absorbed too; after that, rounds
  wound the flesh. Blasts are never absorbed, and crack each plate they reach
  once per explosion (10).
- [x] `game-actor`, only for profiles with `armor`:
  - `applyProjectileHit` asks the plates first. An absorbed round returns
    null (no wound, no injury, no bleed), queues a spark and shoves at 0.35x.
  - A slug on armour still medium-staggers.
  - Explosions crack plates through `armorBlast`.
  - `armorView()` feeds the kit.
- [x] `kit-damage` plate mode: the actor's shed set decides. Every kit island
  skinned to a shed plate's bones goes, so the lenses and snout go with the
  helmet. Sparks come from the actor's impact points (also with no kit loaded).
- [x] Stagger resistance: pellets never stagger him (no flinch signal, no
  progressive or volley stagger); slugs and blasts do.
- [x] `JUGGERNAUT_INJURY_TUNING` (soldier x 1.5); `soldierInjury` and
  `soldierArmCutAllowed` take a tuning.
- Found while testing: in the chaingun hold his left gauntlet crosses the
  chest, so frontal chest fire strips the forearm plate first (pinned).
- [ ] Lab hero (`lab-main`) still uses the soldier's thresholds and no plates;
  plates are a game-actor feature.
- [ ] Optional: the ammo drum cook-off.

## Task 5 — Game spawn

- [ ] `?spawn=juggernaut` and/or a `RoomDef` slot; encounter director treats him
  as a ranged soldier.
- [ ] Playtest notes; update `TASKS.md`.
