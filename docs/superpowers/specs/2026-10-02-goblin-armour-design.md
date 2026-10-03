# Goblin armour: design (refinement phase 2)

**Date:** 2026-10-02 · **Status:** approved by the owner in conversation ("yes that chest read is right, dark
fatigue grey pants, go ahead").
**Parent:** [goblin refinement design](2026-10-01-goblin-refinement-design.md), phase 2 (armour). That spec left
"what it is, WAM or Blender, which pieces" open; this answers it.
**Base:** the phase-1 body (`goblin.blob`, variant A "sinew") plus the body grain, both merged in from
`claude/egg-shader-gooey-transitions-21fb04`.

## Why

The owner, 2026-10-02, looking at the goblin:

- the kit is "simple metallic meshes with clipping issues";
- "the pelvic skirt thing is completely messed up", and so are the boots;
- the breastplate should read like the reference photo (a soldier in riveted, bulbous metal shoulder pads, an X of
  cartridge bandoliers over a dark shirt): "kinda like American football pads, but made of metal";
- wanted: rust or wear on the metal, the crossed bandoliers, a utility belt, and pants that do not clip.

The phase-1 body made it worse: it is slimmer, so every ring in `goblin-kit.wam` is now loose, and the kit's
measured ring table (header of the `.wam`) describes flesh that no longer exists. `goblin-kit.test.ts` still passes
because it only asks whether armour pokes *into* flesh, never whether armour floats off it.

## Decisions

1. **Pants are paint, not mesh.** `color=` on the SDF hip, thigh and shin prims, dark fatigue grey, as the soldier's
   trousers are. They cannot clip by construction, and leg wounds, gibbing and a barefoot variant keep working
   because the SDF legs are still there. Rejected: mesh pants over hidden SDF legs (needs a hide-legs variant, knee
   skinning risk, leg wounds would reveal nothing).
2. **The torso wears a dark painted undershirt** (same technique). That is the reference's dark shirt, and it ends
   the "crop top" problem for good, so the plate no longer has to cover the belly.
3. **Mesh pieces carry the hard detail**: boots, boot-top cuffs (gaiters) that hide the paint seam, small knee
   plates, the belt and its pouches, the pauldrons, a chest plate, the bandoliers, rivets. Owner's rule
   (2026-09-08): accessories are mesh, flesh stays SDF.
4. **Chest read:** big football-pad pauldrons, a *shallow* chest plate or yoke between them, over the dark shirt.
   Not a full cuirass.
5. **The fauld (pelvic skirt) is deleted**, not repaired.
6. **The cleaver and the buckler are removed from the kit.** The refinement spec retired them (owner decision 2,
   2026-10-01); phase 3 gives the goblin the player's weapons. The smartwatch stays (it matches the first-person
   arm asset).
7. **The goblin is the protagonist, seen armed in third person** (refinement spec). The armour therefore has to
   survive animation, not just the rest pose.

## The pieces

| Piece | Kind | Notes |
| --- | --- | --- |
| Pants (hips, thighs, shins) | SDF paint | dark fatigue grey; `color=` on the leg and pelvis prims |
| Undershirt | SDF paint | dark grey-brown, a shade off the pants, on the torso bars |
| Boots | WAM | shaft plus foot shell sized from the *new* flesh; if heel or side leaks survive, drop the flesh foot as `soldier.blob` did and leave a commented restore line |
| Cuffs / gaiters | WAM | cover the paint seam at the ankle; a little fabric silhouette |
| Knee plates | WAM | small, proud, no wrap |
| Utility belt | WAM | wide leather band, buckle kept; pouches at the *front corners* (the hanging forearm swallows anything at the hip: soldier-kit lesson), one at the back |
| Pauldrons | WAM | bulbous domed shells with a second overlapping lip, riveted; replace the flared tubes |
| Chest plate | WAM | shallow, sternum/yoke between the pauldrons |
| Bandoliers | WAM | two straps crossing in an X on the chest, brass cartridges along each (boxes, 8 vertices each), proud of the plate and tucked under the pauldron edge |
| Rust and wear | texture, LOOK | own worn-steel material (the owner's shiny "iron" stays for anything else); rust patches, dents, rivets as small attached boxes |

## Constraints

- **Re-measure everything.** Every ring comes from marching the *new* `sdBody`, per limb-isolated cluster, as the
  header of `goblin-kit.wam` describes. Do not reuse the old table.
- **The skeleton does not change.** The phase-1 body kept the skeleton, so the kit's hand transcription stays valid.
  The test in the plan re-asserts that rather than trusting it (units are height fractions, pitch negates on every
  `down` bone).
- **The kit is near-rigid.** Chain lofts across a joint are skinned (the ogre and clown kits do it across the knee),
  rigid per-bone pieces are not. Pieces that cross a joint must be chain lofts or must be built to tolerate the
  bend.
- **Tested in motion.** The refinement audit found the kit was "tested only in the rest pose". This phase adds a
  posed check (walk and arm-swing frames) for kit-against-flesh clipping.
- **WAM palette entries take only `<name> #rrggbb`** (no `metal=`, `rough=`); finish is runtime, in `kit-overlay.ts`'s
  LOOK table. A box attach emits exactly 8 vertices.
- **UNVERIFIED: rust in WAM textures.** I have not confirmed the texture DSL can lay a coloured patch (it has
  `gradient`, `noise`, `ao`, `streaks`). Step 6 of the plan checks first. If it cannot, rust is a baked PNG
  texture instead, and that fallback is part of the plan, not a surprise.
- **UNVERIFIED: painted prims under the body grain.** The grain is a palette-level field. Step 1 of the plan looks
  at whether `color=` on legs keeps a plausible fabric read or inherits flesh grain, and decides from the render.
- Frames and numbers go to the look-dev folder. Per the owner's standing preference, changes land one piece at a
  time with a turntable render after each, not as one batch.

## Out of scope

- Held weapons and grips (phase 3), the rig and gait (phase 4).
- The Flat's goblin outfit (vest and shorts).
- The first-person arm model.
- The body, face, palette and `bones` wound pass (phase 1 is done).

## Done when

1. `blob:shot -- goblin` shows, from every yaw, no kit piece visibly floating off or poking out of the flesh, and
   the silhouette reads as the reference (football-pad shoulders, X bandoliers, belt, dark pants and shirt).
2. `goblin-kit.test.ts` (rewritten for the new pieces) passes: no kit vertex inside flesh, a new floating-gap bound
   per piece, and a posed-frame clip check.
3. `blob:render-check -- goblin` exits 0, and the scoped vitest run plus the full `src/lab/sdf-zombie/` suite pass.
4. **The owner looks at the turntable and agrees.** That is the gate; the checks only prove closure and fit.
