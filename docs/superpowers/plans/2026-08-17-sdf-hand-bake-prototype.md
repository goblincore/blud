# Baked 3D-SDF hand prototype (X1.26) — NEXT SESSION OPENER

**Status:** queued (owner-approved direction, 2026-08-17). Do NOT drop into
the dispatch queue as-is — session opener; convert to a dispatch plan (or
Opus task) at session start.

**Goal, in the owner's words:** "a first-person view of a proper hand."
One hand, ONE SIMPLE POSE (relaxed/neutral open-ish hand — NOT the grips),
marched as a baked 3D SDF. Prove the pipeline before any pose set, props,
or tweening.

## Pipeline (half already exists)

1. **Bake**: extend `scripts/pose_measure_hands.py`'s import path (CC-BY
   model at `/Users/donny/Downloads/fps hands/first_person_hands_rigged/`,
   licence + skinning notes in `docs/dev-notes/2026-08-17-hand-detail-bake.md`
   — REUSE its inverse-bind skinning, the armature rest data is broken) to
   sample TRUE signed distance on a grid: ~96³ half-float over the hand's
   AABB + margin (calibrate voxel size vs finger thickness — first
   render decides). Output: raw binary + JSON header (dims, box, scale)
   in `public/assets/lab/`. CC-BY derivative → extend ATTRIBUTIONS.md.
2. **March**: hands already render as their OWN views
   (`webgpu/fpv-view.ts`); swap the hands' field fn from the 8-prim fold to
   a trilinear `texture_3d` sample (three `Data3DTexture`). Keep: carve
   pass (wounds), flesh material + legacy gamma, verlet jiggle as DOMAIN
   WARP on the sample point (fleshiness is the loved part — preserve it).
   Forearm stub can stay an analytic capsule smin'd on, or be part of the
   bake — whichever is simpler.
3. **Verify**: FPV screenshot. The single gate: does it read as a proper
   hand. benchGpu (expect ≤ current hands — 1 sample beats 8-prim folds).

## Notes

- Relief sheet optional in the prototype — real geometry may not need it.
- Pose tweening / grips / props / cigarette are all OUT OF SCOPE — this is
  a look test. If it reads, the pose set + `mix(sdfA, sdfB, t)` morphing is
  the follow-up; if it doesn't, the third-person pivot discussion decides.
- Candidate owner: the Opus hands agent (holds all context) or a fresh
  kimi/glm dispatch with this file as the plan body.
- Rejected-for-now alternatives (recorded in dualmem 2026-08-17): more
  SDF-primitive rounds (3 tried, "melted mess"), Hermite loft blends
  (stealable idea for anatomy transitions, from the Jin 2006 mesh-fusion
  paper — not a conversion method).
