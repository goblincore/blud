# Goblin gait: design (refinement phase 4a)

**Date:** 2026-10-02 · **Status:** approved by the owner in conversation (gait first; "scheming scamper").
**Parent:** [goblin refinement design](2026-10-01-goblin-refinement-design.md), phase 4 (rig and animation). Phase 4 is two
jobs; this spec is only the first, the **in-game gait**. The Flat's authored poses and clips (sit, type, recoil, stand,
reach) are the second, with their own spec ([emergence spec](2026-10-01-flat-screen-emergence-design.md), part 2) and
come after.
**Builds on:** phase 1 body, phase 2 armour, phase 3 thin shotgun pass (the goblin already carries the player's
shorty on `GOBLIN_PROFILE` with a `SHAMBLE_CARRY` gait).

## Why

`GOBLIN_PROFILE` still walks on the zombie's SHAMBLE, whose metres are tuned for 0.96 m legs and the zombie's decay; the
goblin's legs are 0.56 m (thigh 0.29 + shin 0.27). The goblin is the protagonist and is seen in third person (cutscenes,
the pull-back, the attract-mode ghost), so its walk is on screen. The bar is the soldier family: clip-derived stride
mechanics, planted feet, carry arms.

## Decisions

1. **Feel: "scheming scamper"** (owner, 2026-10-02). Quick short light steps on a stooped, forward-leaning body, head bob,
   a little sneaky sway. Not a swagger, not a trudge.
2. **Build it on the existing gait system, not a new one.** A goblin walk and run are two `GaitProfile`s in `gait.ts`
   in the soldier's CURVE MODE: the stride SHAPE (thigh and knee angles per phase, hip bob) comes from the soldier's
   sampled clips (`gait-curves/soldier-walk.ts`, `soldier-run.ts`), which are normalised by leg length so the goblin's
   proportions cancel; the goblin's character is the profile's other numbers (cadence, stoop, bob, sway, arm sway).
   Precedent: the bride's STALK is MARCH retimed and re-posed.
3. **The curve source is swappable.** If the owner later wants a hand-authored goblin walk, a skinned clip goes through
   `npm run gait:curves` and replaces `SOLDIER_WALK` in the profile with no other change. That authoring route is a
   decision for the Flat spec, not this one.
4. **Carry arms stay** (the shotgun owns them, `SHAMBLE_CARRY`'s reason). The profile's `armSwing` only rides the shoulders.
5. **Speeds come from measurement,** not guesses: `implied speed = travel x legLen x freq / duty` (gait-from-clip.ts), then
   `cruise` and `runBand` are set from it, with `cruise < runBand.from` so it marches without blending toward the run
   (the soldier's overshoot lesson, motion-profile.ts).
6. **The foot stretch is checked and fixed if real.** The audit logged "goblin/gnasher feet +8-10 cm, posed vs rest"
   (characters.md, "other posed-vs-rest stretch, not investigated"). Phase 3's armour removed the goblin's flesh-foot
   prims, which may already have ended it for the goblin; it is measured first, not assumed.

## Starting numbers (to be tuned in the lab turntable, each with its derivation in the code comment)

| | Walk | Run | Why |
| --- | --- | --- | --- |
| curves | `SOLDIER_WALK` | `SOLDIER_RUN` | clip mechanics, proportion-free |
| `strideFreq` | 1.5 Hz (soldier walk 0.937 x 1.6) | to measure (soldier run 1.5 Hz x ~1.4) | short legs step quickly: a pendulum's period goes with sqrt(length), 0.56/0.84 gives x1.22 and the scamper adds more |
| `strideLen` | 0.20 m | 0.28 m | the soldier's 0.34 / 0.42 on 0.84 m legs, x 0.667 leg ratio, less a hair (reach must not straighten the swing leg) |
| implied speed | ~1.2 m/s | to measure | travel 0.888 leg-lengths x 0.56 m x 1.5 Hz / duty 0.63 |
| `torsoLean` | 8 deg | 14 deg | the stoop; the `.blob` already hunches at rest |
| `bobAmp` | 0.02 m | 0.03 m | head bob is the scamper's signature; the body is small, so metres scale down |
| `swayAmp` / `shoulderSway` | 0.025 / 0.45 | 0.025 / 0.5 | a touch of sneaky sway |

## Constraints

- **Boots are the feet** (the flesh feet are removed): the kit's boot is skinned to the shin/foot bones, so any stretch or
  slide of the foot shows as the boot detaching. Check boots in the walk, not just the legs.
- **Armour in motion:** the pauldrons, yoke and collar are rigid on `upperarm`/`chest`/`neck`; a lean and a bob must not
  drive them into the head, the shades or the gun. Checked by eye at several phases, as phase 2 did.
- The held shotgun stays on the carry system; the gait must not break its grip (the aim and low carries).
- Port-ready: gait data stays pure data in `gait.ts` (no `three`), tests in `gait.test.ts` / `motion-profile.test.ts` style.

## Out of scope

- Idle, turn-in-place, hit reactions, death (the existing generic ones apply), the Flat's clips, hand roll, firing recoil
  for the goblin, other weapons.

## Done when

1. In the lab turntable (`BLOB_POSE=walk` and `run`, several phases) the goblin reads as a quick stooped scamper: feet
   plant without skating, knees bend forward, boots stay on the feet, no armour or gun clipping, shotgun still held.
2. Profile tests pin the numbers' relationships (cruise < runBand.from, stride reach < leg length, implied speeds) and
   the full `src/lab/sdf-zombie/` suite passes.
3. **The owner looks at it and agrees it is a scamper.** That is the gate.
