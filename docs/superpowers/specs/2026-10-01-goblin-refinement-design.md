# Goblin refinement pass: design (phase 1 in full: the body)

**Date:** 2026-10-01 · **Status:** structure and phase 1 approved by the owner ("yes looks right, write the spec");
phases 2–4 are scoped here and get their own specs.
**Look-dev:** [docs/dev-notes/2026-10-01-goblin-body-lookdev/](../../dev-notes/2026-10-01-goblin-body-lookdev/) (the
variant sheet; variant A's `.blob` is the starting point) · **Audit:** [characters.md, "Goblin refinement
pass"](../../tasks/characters.md)

## Why

The owner, 2026-10-01:

- the armour kit clips and fits badly;
- the buckler and the "axe" are poorly modelled and held nonsensically;
- the body is "a series of orbs" and should be smoother;
- the rig needs work, and the animation needs an overhaul.

The audit found the causes:

- **Body:** ball-joint nubs 1.3–1.8× the shaft radius, fillets of about 3–10 mm, and a torso of five stacked ellipsoids.
- **Kit:** a hand-copied skeleton and a near-rigid skin, tested only in the rest pose.
- **Weapons:** WAM groups rigid to a roll-less hand bone; the cleaver is anchored at the fingertip.
- **Animation:** none of its own; it falls back to the zombie's shamble, tuned in metres for legs nearly twice as long.

## Owner decisions (2026-10-01)

1. **The goblin is the protagonist, seen armed in-game.**
   - It appears in third person inside the game (cutscenes, the pull-back, the attract-mode ghost), in its armour, holding weapons.
   - It is also the Flat's goblin (vest and shorts, never its face).
   - It is not an enemy, so there is no AI.
2. **It holds the player's weapons**: the junk weapons, and later the mutated ones. **The buckler and the cleaver are retired.**
3. **The hands stay orbs, and some orb-iness is a style**: a throwback to early 3D games. A handle passes through an orb hand, the PS1 way, so no fist rig is needed.
   - Simple modelled hands were considered and set aside ("more trouble than its worth atm": they could not be SDF, and baked SDF or mesh hands would bring an animation problem).
4. **Body direction: variant A, "sinew"**, picked from three rendered variants. A is smooth and continuous with no joint orbs but the hands; B is wiry with modest joint orbs; C is gnarled and skeletal.
5. **Approach: re-author `goblin.blob` the way the zombie is built**, with tapered bars and wide blends. The grammar does not change: no new loft primitive, no baked volumes.

## The phases

| # | Phase | Decided | Open (its own brainstorm) |
| --- | --- | --- | --- |
| 1 | **Body**: re-author `goblin.blob` to variant A | Everything below | — |
| 2 | **Armour**: redesign, rebuild and fit to the new body | It stays: it is how the goblin looks in-game | What it is (junk armour to match the junk weapons?), WAM or Blender, which pieces |
| 3 | **Held weapons**: the player's weapons in the orb hands | Handle through the orb; use the existing held-prop system (`MotionProfile.prop`, `carry.ts`, `webgpu/held-prop.ts`) | Third-person grips per weapon, the off hand, LOD of the first-person models |
| 4 | **Rig and animation** | Authored, not AI: clips for the Flat and the in-game third-person shots, and a goblin gait to replace the zombie shamble | Authoring route (the emergence spec's "Blender armature → bone angles" vs code keyframes), hand roll, the 8–10 cm foot stretch |

Order matters: the armour is fitted to the body, the weapons are held by the rig, and the animation needs both.

## Phase 1: the body

### Target

Variant A from the look-dev, as rendered. Its lines in
[`goblin-a-sinew.blob`](../../dev-notes/2026-10-01-goblin-body-lookdev/goblin-a-sinew.blob) are the **starting point,
not the answer**: they were written for a look-dev, not measured, and have one known flaw (below).

- **Torso:** three continuous tapered bars, one on each of `pelvis`, `spine1` and `chest`, with blends of 0.014–0.016 (fillets about 3 cm wide), replacing the five stacked ellipsoids.
  - Narrow in x, deep in z: the arm-clearance budget `goblin.blob`'s comments explain still holds.
  - **Fix the look-dev's flaw:** `deep=` scales front and back equally, so A's side view bulges at the back of the waist. The gut must hang in **front** and the back must be **flatter**, so the spine beads read along it.
  - Done by offsetting the pelvis and spine bars forward (+z) and/or adding the gut as its own forward blob (as variant B does), then re-seating the spine beads on the new back surface.
- **Spine:** seven small vertebra beads (six on `spine1` and `chest`, one on `neck`), just proud of the back surface, at blend 0.005.
- **Neck:** one tapered bar (r 0.040 → 0.033), plus a pair of cords (`both`) from the collarbone notch up to behind the ears.
- **Arms:**
  - A small round at the shoulder (r 0.038), so the arm still attaches inside the chest's flesh (see the shoulder note in the skeleton block).
  - Tapered bars for the upper arm (0.031 → 0.024) and the forearm (0.027 → 0.018), with no elbow or wrist nub.
  - **The hands stay exactly as they are** (`blob arm on hand at=0.55 r=0.046 deep=0.90`). Only the blend changes, 0.0034 → 0.008.
- **Legs:**
  - Tapered bars for the thigh (0.046 → 0.031) and the shin (0.034 → 0.021), with no hip or knee nub.
  - A small ankle knob (r 0.026).
  - The foot keeps today's shaft-and-toe construction, slimmed.
- **Unchanged:** the skeleton, the head prims (ears, hooked nose, lips, mouth groove), the `face`, `sheet` and `palette` blocks, and the `bones` (wound) pass.
  - Check the wound pass's ribcage bar still sits inside the new chest. validateBody's breach check will say if not.

### Rules (from the authoring skill)

- **Every number has a source**, in the `.blob` comment beside it:
  - measured (e.g. the torso's half-width at the shoulder, read from `sdBody` or `blob:measure`);
  - "from the 2026-10-01 look-dev variant A, owner-picked";
  - or "eyeballed in the turntable, frame N".
  - No bare numbers.
- **Rewrite the comments**, not just the values. The "ARMS AND LEGS: ball joints, deliberately" block is now wrong, and so are the torso's "every ring here" notes. Say what changed and why (owner, 2026-10-01: smoother; orbs only at the hands as a style).
- **Fold order:** keep each limb's prims contiguous and in order.
- **Budget:** variant A is 41 prims, about the same as today's 42 (head 11, torso 5, arms 6 each, legs 7 each). Stay under the 64-per-cluster cap.

### What it touches

- **Tests that pin the body** get **re-baselined on purpose**: new measured value, plus a comment saying why it moved.
  Change the number, never the body, to make a pin pass, unless the pin catches a real defect (arms passing through
  the torso, a detached limb, a broken stance).
  - `characters/goblin-blob.test.ts`. Clean compile and validation, palette, and stance: unchanged and must pass. The pins that move:
    - arm daylight below the elbow above 30 mm (`:79`);
    - upper-arm daylight above 15 mm at 0.11 m (`:89`; its comment cites the old shoulder ball r 0.054);
    - `fusedOf` below 0 (`:98`): must still pass;
    - arm-to-leg clearance above 10 mm (`:105`);
    - hip at more than 0.50 of height (`:118`).
  - Any of these that read the goblin's body: `silhouette.test.ts`, `pack.test.ts`, `gait.test.ts`, `rig-bind.test.ts`, `taper.test.ts`, `bend.test.ts`, `blob-checks.test.ts`, `blob-emit.test.ts`, `panel.test.ts`, `strand-wiring.test.ts`, `character-registry.test.ts`, `webgpu/occluder-hull.test.ts`.
    The implementation plan's first task is to run them against variant A and list which actually move.
- **The first-person arms must not change.** `webgpu/goblin-skin.test.ts` and `webgpu/game-arms.test.ts` copy the
  palette and the hand radius 0.046, both unchanged. They must pass **untouched**; if either fails, phase 1 changed
  something it promised not to.
- **The kit will fit worse until phase 2.** `goblin-kit.test.ts` checks the kit's tuck against the body in the rest
  pose. If it fails because the body moved:
  - quarantine it (`describe.skip`) with a comment that names phase 2 and this spec;
  - list it on the characters task page;
  - do not tune the kit in phase 1.
  - That is acceptable because the goblin is in no level today (only `?spawn=goblin`).
- **Tapered prims and the occluder hull.** The skill's triage table: a perfectly round see-through hole where the CPU
  field is solid means the occluder hull sized a tapered prim from its fat end. Variant A is mostly tapered bars, so run
  `blob:render-check` before believing any hole is in the `.blob`.

### How we know it is done

1. `npm run blob:shot -- goblin` (with `LAB_TMP=.lab-tmp`, and `BLOB_DIST` set for a 1.3 m figure) shows:
   - a smooth, continuous body from every yaw: no stacked torso, no joint orbs but the hands;
   - in profile, a gut in front and a flat back with the spine beads;
   - arms that read as separate from the torso.
   Frames are committed to the look-dev folder.
2. `npm run blob:render-check -- goblin` exits 0 (the GPU agrees with the CPU field).
3. `buildBody` reports no errors, and `checkStance` passes.
4. The scoped vitest run passes:
   - `blob-{parse,compile,checks}.test.ts`, `characters/goblin-blob.test.ts`, `webgpu/goblin-skin.test.ts`, `webgpu/game-arms.test.ts`;
   - then the full `src/lab/sdf-zombie/` suite, with every re-baselined number commented and any quarantine listed.
5. **The owner looks at the lab turntable and agrees it reads as variant A.** That is the gate. The checks prove the body is closed and connected, not that it reads.

### Out of scope for phase 1

- The face and head.
- The palette.
- The armour (phase 2).
- Weapons and held props (phase 3).
- The rig, the gait and animation, and the foot stretch (phase 4).
- The first-person arm model (`goblin-arm.glb`). Its thickness may want to follow the slimmer forearm later; noted for phase 3, where the arms meet the weapons.
