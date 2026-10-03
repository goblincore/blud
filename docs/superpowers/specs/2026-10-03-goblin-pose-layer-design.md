# Goblin pose layer: design (refinement phase 4b, first slice)

**Date:** 2026-10-03 · **Status:** first slice approved by the owner in conversation ("pose layer + held poses").
**Parent:** [goblin refinement design](2026-10-01-goblin-refinement-design.md), phase 4 (rig and animation), the second job
after the in-game gait (4a, built). **Serves:** the [Flat emergence spec](2026-10-01-flat-screen-emergence-design.md), §3.3
("the goblin in two held poses, type and recoil; part 2 replaces them with authored animation") and part 2 ("sit, type,
recoil, stand, reach"). That spec's *plan* was to find "the narrowest seam to make the rig hold a recompiled rest pose";
this is that seam, built so it is also the one authored clips play through.

## Why

The goblin's rig is driven by a procedural gait and a few carries; nothing can say "hold this pose". The Flat's shots need a
goblin sitting hunched at the desk typing, then thrown back with the arms up, then standing. The look-dev already has the
numbers (bone pitches) and proved they fit, but only by rewriting the `.blob` text and re-meshing in Blender. The engine
needs a layer that takes a pose and makes the rig hold it.

## Decisions

1. **A pose is bone angles**, written like the `.blob`'s own bone lines: per bone, an absolute `pitch` and/or `tilt` in
   degrees (`thigh pitch=86`). `.blob` bone directions are ABSOLUTE (not cumulative down the chain), so a pose is just
   "replace these bones' directions", and the forward kinematics is the existing `resolveBones` (head = parent tail +
   side offset; tail = head + dir x length). The look-dev's `TYPE`/`RECOIL` strings are valid poses unchanged.
2. **Blend in angle space, never in position space.** Lerping joint positions shortens a limb by 29% at the midpoint of a
   90-degree swing. Keys interpolate per-bone pitch/tilt and the skeleton is re-resolved every frame (about 35 bones).
3. **A clip is a list of timed keys; a held pose is a one-key clip.** Bones a key does not mention take their rest angle,
   so "sit" blends from the standing rest with no extra data. A clip authored in Blender and exported as the same key
   list plays unchanged: the authoring route stays open (Blender armature or text), which is the Flat spec's open question.
4. **The layer writes the rig's targets and pins every point.** `MotionFrame.restPose` takes the posed joint positions
   (world: body yaw about the pelvis line, then root shift) and `posePins` lists every rig point, so the Verlet rig neither
   lags nor sags. This is how the soldier's structural fall already replaces targets (`soldierFallPose`).
5. **Ground-lock by default.** The pose's lowest foot joint is put on the rest ground height, so sitting lowers the pelvis
   instead of lifting the feet; a pose may opt out (airborne) or add a root offset in z/x.
6. **Entry is from a standstill.** While a pose is active the gait is ignored entirely (no blend from a walk); the Flat's
   cutscenes start from a standing or seated goblin. A pop on entry from a moving gait is a known, documented limit.
7. **Pure module, port-ready:** `pose.ts` is plain data and arithmetic (no `three`), tested on its own, per the project's
   rule that logic lives in renderer-free modules.

## The first poses and clips

From the look-dev ([notes](../../dev-notes/2026-10-01-flat-emergence-lookdev/notes.md)), numbers to be re-judged in the lab:

- **type:** `spine1 20, chest 27, neck 24, skull -6, thigh 86, shin -4, upperarm 40, forearm 80, hand 70`
- **recoil:** `spine1 -6, chest -12, neck -2, skull -14, thigh 78, shin 2, upperarm 150, forearm 172, hand 175`
- **stand -> sit** and **sit -> stand** as short two-key clips (about 0.8 s, eased), and **type -> recoil** (about 0.25 s,
  snappy) for the egg's emergence.

## Constraints

- **The armour kit and the SDF body must both follow:** the kit is skinned to the same rig points, so it should, but a
  pose with big angles (arms at 150-175 degrees) is the case that breaks rigid kit pieces. Checked in the lab.
- **The pauldron spikes, yoke and collar** against the head when the spine pitches 20-27 and the neck 24: checked.
- **Bone pitches above about 90 degrees "do not take"** in the look-dev's text-override route (characters.md, "Also"). The
  engine route sets `pitchDeg` directly and calls `dirVector`, which is a plain cos/sin, so it should: pinned by a test
  with the recoil's 150-175.
- **At home the goblin wears a vest and shorts, not armour** (Flat decision 7). That is a separate slice (outfit); until it
  exists the poses are judged on the armoured goblin.

## Out of scope

The Flat scene, the chair, the desk and the CRT; the vest and shorts; Blender export/import (the key list is its target);
IK contact with props (hands on a keyboard); transitions from a moving gait; other characters (the module is generic by
construction: it reads the character's own `.blob` bones).

## Done when

1. `pose.ts` is pure and tested: FK matches the compiled rest skeleton at the rest pose, bone lengths are preserved at every
   key and every blend, the recoil's >90 degree pitches resolve, ground-lock puts the lowest foot on the ground.
2. `stepMotion` honours `cfg.pose`: `restPose` is the posed targets, every point pinned; a test with the goblin proves a held
   pose reaches the rig and stays put over many frames.
3. In the lab (`BLOB_POSE=pose:type` etc.) the goblin visibly sits, types and recoils, kit and body together, no limb
   shortening mid-blend, no armour or head clipping, frames in `docs/dev-notes/2026-10-03-goblin-poses/`.
4. **The owner looks at the poses and agrees they read.** That is the gate.
