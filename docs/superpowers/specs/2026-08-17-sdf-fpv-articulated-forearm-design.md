# X1.28 FPV Articulated Baked Forearm — Design

**Date:** 2026-08-17

**Status:** owner-approved direction; implementation not started

**Depends on:** X1.27 baked-SDF dynamite grip/release and the accepted long-forearm atlas from `bfbe85c`

**Owner gate:** the hand and dynamite keep their accepted framing and exact release handoff while the forearm remains anatomically believable throughout closing, shaking/cooking, release, follow-through, and recovery

## Why this slice exists

The long-forearm follow-up solved the disconnected wrist, but it exposed a
deeper animation problem. The grip atlas contains the hand and forearm as one
rigid field. During idle this can look plausible; during shaking and throwing,
the wrist arc rotates the entire volume like a stiff tube. The forearm then
sweeps across the lower-right of the image, its proximal end can enter frame,
and the limb reads as a rectangular rubber extrusion rather than an arm.

Two framing experiments did not address the cause:

- changing only the FPV FOV and whole-volume throw offsets moved the same rigid
  silhouette without articulating it (`150a22a`, rejected and unmerged);
- appending an analytic upper-arm capsule to the baked proximal cap hid the cap
  but left the rigid hand–forearm relationship intact (`be3a72f`, reference
  only and unmerged).

The correction must create a real wrist articulation boundary. The accepted
hand pose, dynamite seat, release marker, flight transfer, and finger clip stay
authoritative.

## Decisions

- Keep the hand and held dynamite on the exact X1.27 pose path. The dynamite
  remains derived only from `bakedDynamitePose(animatedHand, propContract)`.
- Reuse the accepted long-forearm grip atlas from `bfbe85c`; do not bake another
  atlas for this pass.
- Sample that atlas twice: once as a hand/wrist field under the accepted hand
  pose, and once as a forearm field under an independently solved wrist-pivoted
  pose.
- Clip the two samples into overlapping anatomical half-spaces around the
  authored wrist cut at local `y = -0.035 m`, then smooth-union them locally.
- The forearm solver keeps the wrist pivot fixed and aims local proximal `-Y`
  toward a camera-local elbow target below/right and outside the view. Roll is
  inherited from the hand's thumbward axis projected around the new bone axis.
- The proximal cap must remain outside the viewport for every animation phase.
  Do not add a visible upper arm in this slice. If a truthful pose cannot keep
  the cap out of view, stop at the owner gate and revisit limb coverage rather
  than hiding it with more camera tuning.
- Keep the lab camera FOV and the X1.27 wrist choreography unchanged. FOV is not
  an arm-animation control.
- Apply articulation only in `clip` mode. `prims` and the X1.26 static `baked`
  field remain behaviorally and visually unchanged.
- The existing atlas, GLB, attribution, and manifest hashes remain unchanged.

## Architecture

### One atlas, two rigid samples

The accepted clip field already contains both useful pieces. In anatomical
local space, the wrist pivot is the volume origin, the fingers extend along
`+Y`, and the forearm extends along `-Y`. The renderer therefore evaluates the
same adjacent atlas slabs under two transforms:

```text
world point
  ├─ inverse accepted hand pose    → clip to y >= split-overlap → hand distance
  └─ inverse articulated arm pose → clip to y <= split+overlap → arm distance

final distance = smoothUnion(hand distance, arm distance, wristBlendK)
```

The overlap covers the wrist neck, so neither half-space cut is exposed. The
hand sample keeps the existing clamped distal jiggle warp; the forearm sample
does not inherit digit jiggle. Both samples use the same `frame0`, `frame1`, and
`alpha`, although the baked forearm is pose-invariant across those frames.

This costs a second atlas evaluation only for the one FPV clip view. It adds no
asset memory and no new texture binding.

### Forearm pose solver

The solver is pure and camera-relative:

1. `wristWorld = animatedHand.centre` — the baker's anatomical origin.
2. Carry a fixed elbow target from camera-local space into world using the same
   `camBasis(yaw, pitch)` that places the hand.
3. Aim the forearm's local `-Y` from the wrist toward that target. Because the
   baked forearm has a fixed length, the target defines direction; the actual
   cap remains the transformed atlas endpoint.
4. Project the animated hand's thumbward `+X` axis perpendicular to the new
   forearm axis. This supplies stable roll without forcing the forearm to share
   the hand's pitch/yaw.
5. Rebuild the third axis with a cross product and extract a normalized
   local-to-world quaternion.

The pose is disabled instead of emitting NaNs if the target coincides with the
wrist or the projected roll axis degenerates. Tests run the real grip controller
at 240 Hz through the entire sequence and assert continuity.

### Shader and proxy

All march entry points receive two additional pose uniforms and one articulation
configuration uniform. Defaults disable the second sample, so bodies, chunks,
primitive hands, and the static baked hand retain the old field exactly.

The FPV proxy becomes the conservative union of:

- the transformed hand-side clipped AABB; and
- the transformed forearm-side clipped AABB.

Using the clipped bounds avoids drawing the full atlas box twice while still
including the wrist blend, wound margin, warp margin, and voxel pitch.

Wounds remain world-space operations applied after the joined field. The flesh
material, normal estimation, lighting, clay diagnostic, and sheet relief stay
shared.

## Runtime flow

Clip mode keeps this order:

1. Step `GripMotionState` and select adjacent atlas frames.
2. Derive the accepted base hand pose and apply the existing wrist motion.
3. Set that animated pose as the hand field pose.
4. Solve and set the independent forearm pose from the same wrist and camera.
5. Derive the held GLB transform from the hand pose only.
6. At `releaseNow`, transfer the rendered GLB root to flight exactly once.

The forearm never influences the dynamite transform or throw velocity.

## Rejected approaches

### Whole-volume FOV/offset tuning

Rejected after owner screenshots. It can improve one frame while making the
same rigid field more prominent in another; shaking and throwing reveal the
problem immediately.

### Add only an analytic upper arm

Rejected as the primary fix. It can hide a flat cap, but the baked hand and
forearm still rotate as one object. The user-visible failure occurs before the
cap: the forearm itself sweeps and deforms like a rigid tube.

### Bake a full arm into every grip frame

Deferred. It expands an already 51 MiB atlas and still bakes one shoulder pose
into every frame. A later full-arm/mesh-to-SDF pipeline may use a rigged source,
but it is unnecessary to prove the correct FPV articulation boundary.

### Continuous nonlinear bend of the single sample domain

Not selected. A proximal-only inverse warp avoids a second sample but is harder
to keep distance-conservative, can compress the wrist under large swings, and
is less directly testable than two clipped rigid fields.

## Acceptance criteria

### Automated

- The hand pose passed to `bakedDynamitePose` is bit-for-bit the accepted
  animated hand pose; articulation cannot alter it.
- Release remains exactly once with handoff error below `0.0001 m`.
- Forearm wrist position equals hand centre within `1e-6 m` on every frame.
- Forearm pose values remain finite and quaternion-normalized through a 240 Hz
  close/hold/throw/follow-through/recover sequence.
- Consecutive forearm orientations do not flip sign or jump; cap motion is
  bounded per step.
- The transformed proximal cap projects outside the lower or right viewport
  edge throughout the sequence at 16:9.
- With articulation disabled, generated WGSL follows the previous single-pose
  sample path and all existing tests pass.
- The proxy contains both clipped transformed bounds plus all existing margins.
- A visible WebGPU smoke has no shader compilation or validation errors.

### Visual owner gate

Capture and inspect the accepted viewport at:

- held/idle;
- closing or cooking/shaking;
- the release marker;
- maximum follow-through;
- recovery.

Pass only if the wrist has no gap or double surface, the forearm consistently
leads toward an offscreen elbow, no flat cap is visible, and the arm does not
dominate the lower-right view during shake or throw. Hand shape, dynamite seat,
and release continuity must still match X1.27.

### Performance evidence

Record a visible-page GPU comparison between the accepted rigid clip and the
articulated clip with `hiddenSteps == 0`. Atlas size must not change. Performance
is evidence for later optimization, not permission to compromise the visual
gate in this pass; investigate a median regression above `1.0 ms`.

## Branch and provenance guardrails

- Start execution from current `main` in a fresh `codex/` worktree.
- Port `bfbe85c` as the accepted long-forearm asset/pipeline baseline.
- Do not port `150a22a` (whole-volume reframe) or `be3a72f` (upper-arm patch).
- Preserve main's debug-panel toggle from `82deac5` while resolving the one
  overlapping `lab-main.ts` change.
