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

## Task 3 — Chaingun, single rounds, CHAINGUN_TUNING

- [ ] `scripts/make-juggernaut-chaingun.py` -> `juggernaut-chaingun.glb` on the
  `GUN_GRIP` locators, with a named barrel-cluster node for spin.
- [ ] `hip` carry for all three states; check the left-hand IK reaches the carry handle.
- [ ] Widen `gunner.weapon` to include `'chaingun'`; game-main picks `CHAINGUN_TUNING`.
- [ ] `strafe: false` tuning flag: engage only closes radially toward
  preferredRange and never backs off. Brain tests: no lateral goal, never
  retreats, and a burst of 15 or more rounds.
- [ ] Single-round projectile (one pellet per shot) for `'chaingun'` ONLY. The
  cultist's SMG keeps its 8-pellet rounds (owner, 2026-09-25).
- [ ] Spin-up: barrel spin rate driven by brain state (aim, fire, settle) as
  plain data, applied by the view. Placeholder whine and brass casings.

## Task 4 — Armour that works + helmet + stagger resistance

- [ ] `plate-armor.ts` (pure): plates carry hit points, a hit maps to a plate by
  kit part, and a break-off emits a shed event. Tests: an intact plate absorbs
  hits, a broken plate lets damage through, and a head hit through an intact
  helmet does nothing.
- [ ] Wire into `game-actor` damage before `soldier-damage`; drive
  `kit-damage` break-off from the shed events.
- [ ] Stagger resistance: pellets do not stagger; slugs and blasts do.
- [ ] Higher injury thresholds (Juggernaut tuning of `SOLDIER_INJURY_TUNING`).

## Task 5 — Game spawn

- [ ] `?spawn=juggernaut` and/or a `RoomDef` slot; encounter director treats him
  as a ranged soldier.
- [ ] Playtest notes; update `TASKS.md`.
