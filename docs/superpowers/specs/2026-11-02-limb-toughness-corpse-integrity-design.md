# Limb joint toughness and corpse integrity — Design

**Date:** 2026-11-02 · **Status:** awaiting owner review · Branch `claude/character-damage-ragdoll-9ca95f`

Two independent changes to the character damage model. Part 1 and Part 2 touch different code and can land
separately. All new values live in pure, renderer-free modules, so the Rust port takes them over unchanged.

## 1. What the owner asked for

1. Shooting an arm should usually take it off **at the elbow**, leaving a broken upper arm on the torso. The shoulder
   should be **quite difficult** to cut, because a whole arm flying off is a long, unattractive tube. The same rule
   applies to **legs** (owner, 2026-11-02): knee easy, hip hard.
2. A dying body should stop collapsing into itself. Keep the ragdoll, but make it hold its shape to a **tweakable**
   degree.

## 2. Measurements behind the design

Zombie only, with simulated hits and a forced collapse. These are not from live play.

**Severing.** Shots to a cut, or none in 30 shots:

| Shot lands at | Pellet (`severRadius` 0.10) | Slug (0.13) |
| --- | --- | --- |
| Shoulder | ~1 | 1 |
| Mid upper arm | none | none |
| Elbow | ~2 | 1 |
| Mid forearm | mostly none | wrist cut 16 of 40 tries |
| Wrist | 1 | 1 |

`cutChains` also tests the shoulder: its first joint (shoulder ball to upper arm) is a shoulder cut. So toughening
`cutLimbs` alone would change nothing.

**Falling.** Only elbows and knees have bend stops (`rig-bind.ts`), so the spine and neck are free hinges:

| Distance | Standing | Settled |
| --- | --- | --- |
| Head to pelvis | 0.71 m | 0.11 m |
| Chest to pelvis | 0.48 m | 0.20 m |

Two other causes, read from the code:

- **Flat corpses.** `applyFloorContact` uses one floor height for every joint, so all of them settle at y = 0.06 m
  whatever the flesh around them. That height comes from the foot joint's rest height minus `floorPad`.
- **The skull stays near upright.** For every non-soldier, `headFollowsRig` is false, so the skull stays clamped to the
  standing look cone (`IK_TUNING.headMaxYaw`/`headMaxPitch`) even when the body lies flat. A skull pointing up out of a
  flat torso is part of the "head through the body" look.

## 3. Part 1: joint toughness

### The rule

Connectivity scales each wound's sever radius by a factor for the joint being tested. The crater itself does not change.

| Joint class | Which joints | Starting factor | Effect |
| --- | --- | --- | --- |
| `root` | Attachment neck (`cutLimbs`), and any chain joint whose distal prim is on a root bone | 0.7 | Hard to cut |
| `mid` | The upper-to-lower boundary: elbow, knee | 1.4 | Wider, easier cut zone |
| `other` | Everything else, including the wrist and ankle | 1.0 | As today |

Scaling applies only to `armL`, `armR`, `legL` and `legR`. The neck, and limbs such as tails and wings, stay at 1.0.

### Classifying joints

Classify by **bone name**, never by chain index, because decoration prims act as fake joints (the bride).

- Root bones: `clavicle`, `upperArm`, `upperarm`, `thigh`, `femur`.
- Mid bones: `foreArm`, `forearm`, `shin`, `tibia`.
- A joint is `mid` when its distal prim is on a mid bone and its proximal prim is not.
- A joint whose distal prim is on a root bone is `root`.
- Unrecognised names are `other`, which is today's behaviour.

A test lists each registered character's arm and leg joints by class and fails on a limb with no `mid` joint unless that
character is on a written exception list. A silent miss would leave that character's limbs behaving as they do now.

### Tuning and targets

The factors live in one exported table in `connectivity.ts`, with a setter in the style of `setStumpLip`, and appear as
sliders in the wound panel. The 0.7 and 1.4 are starting values. Tune them against these targets, using the same zombie
harness as §2:

| Shot lands at | Target |
| --- | --- |
| Shoulder or hip, pellets | No cut in the first 12 hits |
| Shoulder or hip, slug | No cut on the first hit; a cut is allowed after sustained hits |
| Shoulder or hip, close blast | Can still take the limb (a dynamite signature) |
| Elbow or knee, pellets | At most 2 hits, as today |
| Elbow or knee, slug | 1 hit |
| Mid upper arm or mid thigh | Reaches the elbow or knee cut within a few hits, instead of never |
| Mid forearm or mid shin | Cuts at the elbow or knee, or at the wrist or ankle |

### What must not change

- Decapitation, whole-body gibbing, burns, torso cloth decals.
- `severRadius: 0` still means "cannot cut" (the cultist's pellets, flail head hits).
- The soldier family's explicit `injury.sever` is not scaled. Wound-driven cuts on those characters do go through the
  table, and their existing tests must still pass.

### Elbow cuts become common, so a lost hand must count

`missingLimbs()` counts an arm as missing only when the whole cluster dies, while a leg counts on any distal cut. With
elbow cuts now the usual outcome, a gunner could lose a forearm and keep holding a floating gun.

Fix: an arm with any dead add prim counts as missing, matching `legGone`. That drops the prop and stops the arm's
carry and swing (`motion.ts`), so the stump should hang loose. Soldiers use `soldierInjury` and stay as they are.

## 4. Part 2: corpse integrity

### Approaches considered

| Approach | Verdict |
| --- | --- |
| **Distance braces in the existing verlet rig** | **Chosen.** Small change, keeps the ragdoll and its feel, adapts to any body shape |
| Physics-engine articulated ragdoll | No. Rapier is only in the retired game, and it adds a large dependency to the Rust port |
| Authored death animations | No. The owner likes ragdoll, and animation alone would not react to the shot |

### Braces

Add `collapseBraces(names, restPose)` beside `collapseRopes` in `collapse.ts`. A brace is a two-sided limit between two
joints that have no bone between them: `{a, b, min, max}`. Joints a body lacks are skipped, as ropes already do.

| Group | Pairs | Purpose |
| --- | --- | --- |
| Trunk | chest–pelvis, chest–hips, each shoulder to each hip, shoulder–shoulder, hip–hip | The torso keeps its length and does not shear flat |
| Head | head–chest, head–pelvis, head–each shoulder | The head stays out of the torso, with room to loll |

### The integrity value

`COLLAPSE_TUNING.integrity` runs from 0 to 1, starting at 0.7. Each group turns it into a tolerance around the rest
distance:

```
min = rest * (1 - tolerance)
max = rest * (1 + tolerance)
tolerance = lerp(group.looseTol, group.tightTol, integrity)
```

The head group's tolerances are wider than the trunk's.

- **Integrity 0** adds no braces at all, so a fall stays bit-identical to today. A test pins this.
- **Overrides:** `MotionProfile.corpseIntegrity` sets a per-character value.
- **Live tuning:** a debug slider and a `__sdfGame` seam set the global value, for side-by-side comparison.

### Solving

Braces relax inside the same sub-step as the ropes, in both rig loops: `actor.ts` and `game-actor.ts`. Ropes get one
pass by design, but braces need several (start at 4) to hold a shape against gravity and impact. The order is:
`stepRig`, ropes, braces, floor contact, a final brace pass. Corrections change position only, so verlet carries them
as velocity. A test bounds settled motion to catch the solve pumping energy into the body.

### A stiff torso has to topple

Today's torso folds as it lands. A braced torso can come straight down and balance on its pelvis, so the fall needs a
push. When the fall starts, add a small lean at the chest along the killing shot's direction. With no shot (a forced
collapse) use a lean drawn from the actor's seeded RNG, which keeps it deterministic.

### Lying on the floor with thickness

`applyFloorContact` takes a per-point rest height:

```
restHeight(point) = trueFloor + girth(point)
trueFloor = groundY - girth(foot joint)
```

Girth is computed once per rig point at bind time, from the live add prims at that point, and capped so one large
ellipsoid cannot lift a corpse. A foot still rests where it does today. A floater, with no feet, uses y = 0 as
`trueFloor`.

### The skull follows the body

Once a body is collapsed, `headFollowsRig` becomes true for every character, so the head lies with the neck. To avoid a
snap, the clamp blends out during the rest-pull release (`fallReleaseTime`). The rule that passes the blend to
`headPose` and `headTransform` must keep the painted face and the skull on the same rotation.

### Limbs and the torso

The existing torso guards stay on during a fall for every character that already uses them (`wantsTorsoGuards`). No new
limb collision is added here. Legs passing through each other or through the torso is left for playtest to judge.

### What must not change

- The soldier family's structural fall (`soldierFallPose`, no ropes). Their braces stay off.
- The soft-target death throw. Its rest pull still drops to zero at once, and braces apply as they do to any other body.
- A corpse stays shootable, severable and gibbable. Braces whose joint has lost its flesh (a severed head) stay
  active on the invisible rig point, which is harmless and avoids rebuilding the set on every sever.

## 5. Acceptance tests

Pure, fast tests beside the changed modules. Run `npm run typecheck` and `npm run test:changed`; CI runs the rest.

**Part 1 (`connectivity.test.ts`):**
- The §3 target table, as a zombie harness over arms and legs.
- Factors of 1.0 reproduce today's cuts.
- `severRadius: 0` never cuts.
- The neck is unscaled.
- The per-character classification listing.
- Existing sever and explosion pins hold, or are consciously updated with the reason recorded.

**Part 2 (`collapse.test.ts`, `actor.test.ts`), at integrity 0.7 over several seeds:**
- Settled head-to-pelvis distance is at least 70% of rest (today it is 15%).
- Settled chest-to-pelvis distance is at least 80% of rest (today it is 42%).
- Every joint stays at or above its own rest height.
- The corpse actually lies down: the chest settles below 0.5 m.
- Settled joint speed is near zero.
- Integrity 0 is bit-identical to today.
- A hound-shaped body (one quadruped character) settles under the same checks, with its numbers recorded rather than
  assumed to match.

**In the game, on `npm run dev:arena`:**
- Shoot the arms and legs of the zombie and at least one other character, and capture a stump and a detached forearm.
- Kill bodies at integrity 0, 0.7 and 1 and capture each from the side. That comparison goes to the owner, who judges
  the final values.

## 6. Out of scope

- Severed limbs as physical debris, which is already its own task.
- Authored death performances.
- The bride's wider toughness plan.
- New limb-to-limb collision.
