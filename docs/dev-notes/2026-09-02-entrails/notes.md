# Entrails — cavity viscera, and guts that spill · evidence note

**Date:** 2026-09-02 · **Task:** 8 of 8 (gates + evidence) · branch
`dispatch/2026-09-02-entrails-task-8`, base `claude/continue-previous-work-91055b`.
**Spec:** `docs/superpowers/specs/2026-09-02-entrails-design.md` ·
**Plan:** `docs/superpowers/plans/2026-09-02-entrails.md` (both on that branch, not main)

## What shipped (tasks 1–7, on this branch before task 8)

- Per-wound **cavity flag** (`Wound.cavity`), set on the CPU at stamp time
  where cluster membership is free (`woundFromSlug`/`resolveExplosion`),
  riding a new wound texture row (`ROW_WOUND_FLAGS`, `DATA_ROWS` 19→20).
- **Viscera ramp stop**: torso-only fifth stop past `visceraDepth 0.045`,
  darker than muscle (value separation, per the rib lesson), lumped by the
  existing `fbm` at `anchor * 2.5`, gated per wound via `WOUND_MASK`'s third
  channel, amplitude-guarded so `visceraAmp 0` skips the fbm call itself and
  packs the exact pre-entrails uniform word (`surfCfg3.w` was SPARE=0).
- **`entrails.ts`**: pure verlet chain (10 nodes, 0.55 m), pinned each frame
  to `woundEmitAnchorAndNormal` so the rope rides the gait; tears free on a
  second qualifying hit or on collapse; freezes once settled.
- **`kind: 'gut'` droplets** in `blood-sim.ts` — skipped by `stepBlood`
  entirely (no integration/ageing/cull/splat); they exist so `GooLayer.sync`
  draws the chain as fused metaballs at `gutSize 0.3`.
- **Wiring** in `game-main.ts`: one rope per body (`shouldSpill`, rolled from
  the seeded `bleedRng`), hooked in three places (live fire via
  `registerBleed`; the capture twins `stampWoundAt`/`explode` call
  `spillVerdict` directly). Panel knobs: viscera, cavity knee, gut thickness,
  spill chance. `__sdfGame.guts()` evidence seam (task 8) reports live rope
  state per body.

## Task 8 gates (unit, `entrails-gates.test.ts` — all green)

1. **Off-state parity** — `visceraAmp 0`: the pack sources `surfCfg3.w` from
   `visceraAmp` (base branch hardcoded 0 into that SPARE slot, so amp 0
   reproduces the exact pre-entrails word); `wmCav` reaches the albedo ONLY
   as the amp-multiplied `tissueRamp` argument (3 occurrences pinned), the
   mix goes to identity at 0, and the fbm sits behind
   `surfCfg3.w > 0.0 && wmCav > 0.0` (amp first — cost parity).
   `spillChance 0`: zero spawns over 200 qualifying slug wounds, via the same
   shared-table mutation the panel knob uses.
2. **Determinism** — same seeded `mulberry32` stream over the same 200-wound
   sequence → identical spawn/tear decision arrays; a different seed
   demonstrably differs (gate not vacuous).
3. **Rope cap** — 50 qualifying hits across 10 bodies through the real
   `shouldSpill` + chain lifecycle: never more than one attached chain per
   body, tears actually detach, death leaks none, fallen chains settle
   (`settled` true after 900 steps). GUT_TUNING bounds pinned (10 nodes /
   0.55 m).

All gates were **mutation-checked** (guarded behaviour broken by hand → gate
red → reverted): the shader amp multiplier, the chance table read, and the
tear-detach each produced exactly the expected failure.

## The two bugs task 8 found and fixed

### 1. The slug spill roll was DEAD CODE (found by gate 1b + tsc)

`shouldSpill` keyed the roll on `wound.type === 'blast'`, but
`woundFromSlug` stamps **`type: 'blast'`** — the slug uses the blast crater
profile (`worldHitToWound(..., SLUG.woundRadius, 'blast', ...)`). So every
torso slug took the blast pin at **1.0** and `SPILL_CHANCE.slug = 0.35` was
unreachable, contradicting spec §3's trigger table (slug spills *on a roll*,
which is what stops disembowelment going stale). It hid because both the
gate's fixture (`type: 'slug'` — not a real `WoundType`; tsc's TS2367 caught
it) and the task-6 test (`pellet` + `cavity` — a shape no real wound ever
has) used fictional taxonomy. Fixed with a stamp-time **`Wound.spillCalibre`
marker** set in `woundFromSlug`; `shouldSpill` rolls on it; absent = blast
pin. Every present and future spill call site is right by construction
(the wound carries the calibre, the way it already carried the cavity flag).

### 2. A rope torn from REST froze mid-air (found by the browser capture)

The tear capture's first run reported `settled: true` three frames after
detachment with the tail still 0.47 m above the floor, and the after-tear
PNG shows the rope hanging motionless 4 s later. `stepGutChain`'s settle
metric summed the **carried velocity** (`pos - prev`) during integration —
~zero for a chain hanging at rest, which is the game's every death — so the
first free step read `moved < settleEps` and froze before gravity moved a
node. Task 4's momentum test missed it because `makeGutChain` seeds `prev`
upward, giving fresh chains artificial velocity. The metric is now the
**actual node displacement across the whole step** (after constraints and
the floor clamp), which also fixes the mirrored defect (a floor-resting
chain could never settle while gravity intended motion the clamp cancelled).
Unit test added; re-capture shows the torn rope landing and settling
(tail y 0.058, `settled: true`).

## What the captures show (combat range, under the beam — judged by looking)

All at `sdf-game.html`, dungeon ON, beam, slug mode, wanderers frozen for
the pose. `predictSlugHit()` → `stampWoundAt(..., 'slug', id)` staging;
predictor-vs-stamp agreement 3.26 cm.

- `captures/01-before-stamp.png` — standing body, no wounds.
- `captures/02-rope-hanging.png` — **a slug to the lower torso opens a
  crater and a rope hangs from it**: a thick glossy red rope, unmistakably a
  rope rather than a spray, swinging on the gait (log: 10 nodes, 10 droplets,
  wound `cavity:true`, `spillCalibre:'slug'`, span 0.44 m at rest).
- `captures/03-after-tear-fallen.png` — second qualifying slug: the rope
  tears free, falls, and settles as a coiled red heap on the floor between
  the feet; the wound cavity stays open behind it, bone plug at its base
  (wound-r2's spine — two stacked slugs reach it).
- `captures/04-viscera-ON.png` / `05-viscera-OFF.png` — one slug, no rope
  (`spillChance 0`), 1.8 m, `visceraAmp` 1 vs 0 (live uniform write; readback
  `surfCfg3 [1,0.004,0.014,1] → [...,0]`). **Honest finding: the viscera
  tint itself is not discernible by look at this range on this body.** The
  cavity reads as a deep wet hole with something in it (dark interior + bone
  plug), but the ON/OFF interiors are not visibly different: the bone claims
  the crater floor at `boneRatio 0.38` just past `visceraDepth 0.045`, and
  the viscera band is a ring a few pixels wide. The spec's own constraint
  bites: at combat range only large value blocks read, and the bone plug IS
  the value block. Whether to push viscera harder (darker, shallower knee,
  or the deferred distinct tint) is an owner call — the mechanics all work;
  this is a look-strength question.

No pixel diffs anywhere: this harness has 52–82k px of same-build flicker.

## Bench (reported, not blocking) — goo baseline now EXISTS

`scripts/sdf-game-entrails-bench.mjs`, room 4 (which owns **4** bodies — the
"nine bodies" in the old note were visible across tunnel sightlines), 3
alternating repeats, fresh page per leg:

- `goo-base` — ship defaults, `spillChance 0` (firefight rolls spill RNG
  identically, spawns nothing). **p50 10.21 ms** (spread 10.10–10.51, 4%).
  This is the goo layer's first-ever baseline: the outstanding item on
  `X1.blood-viscosity` is closed.
- `guts-all` — every body in the room disembowelled BEFORE the measured
  frames (4/4 each rep, 40 `gut` droplets; spillChance 0 during measurement
  so the workload difference is exactly the ropes). **p50 10.29 ms**
  (spread 10.27–11.25, 10%).
- **Delta 0.8% — UNRESOLVED** (under both legs' spread). The earlier same-day
  run read +12–16% with a broken stager (4 of 9 ropes) and a mislabelled leg
  — both discarded; with staging verified complete the delta does not clear
  the noise floor. The verlet step (4×10 nodes) and 40 goo droplets do not
  produce a p50 cost measurable above this machine's noise; the amplitude
  guards remain the containment, and the goo-pass cost is now bounded by the
  baseline above rather than unknown.

`bench.json` holds the full per-run data, including per-leg staging records.

## What did NOT work (the traps, so nobody pays them twice)

1. **Fictional test taxonomy.** Building fixtures with wound types the data
   model cannot produce (`type: 'slug'`, `pellet`+`cavity`) makes gates pass
   on dead code. Always build wound fixtures through the real stamp paths
   (`woundFromSlug`) or assert on the markers those paths set.
2. **Aim → predictor → stamp are three instants.** Bodies wander between
   them; unstaged captures/benches must freeze, stage, then unfreeze.
3. **Aiming "at body X" in a cluster fights the geometry** — the predictor
   resolves the NEAREST body along the ray. Stage by accepting whichever
   *ropeless* body the predictor confirms, and never stamp a body that
   already has a rope entry (a qualifying stamp TEARS it — the cap working).
4. **Room 4 owns 4 bodies**, not 9. The crowd census counts frustum-visible
   bodies across tunnel sightlines.
5. **The setPose readback mismatch**: the wound panel can show a stale slider
   value after `setWoundTuning` changed the field underneath (the panel
   record seeds at open). Cosmetic; drag to snap. Worth remembering when
   reading captures: trust `__sdfGame.woundTuning`, not the slider.
6. **Capture scripts must `process.exit()`** — the CDP WebSocket keeps node
   alive after the work is done; the first capture run "hung" at 600 s
   having finished minutes earlier.

## Suites

`tsc --noEmit` clean; `npm test` 2660 passed, 7 failed — all seven are the
pre-existing `scripts/blob-measure.test.ts` `spawnSync ... ELOOP`
node_modules-symlink artifact documented in the task brief (unchanged by this
branch; they fail identically on its base).
