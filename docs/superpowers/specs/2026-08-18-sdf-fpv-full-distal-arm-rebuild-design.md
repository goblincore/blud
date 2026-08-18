# X1.hand-followups — Full Distal FPV Arm Rebuild Design

**Date:** 2026-08-18

**Status:** replanned after both the hybrid wrist and synthetic-forearm
reference were rejected; the next run uses Blender-native SDF fusion and the
original Blud two-hand choreography as pose authority.

**Implementation plan:** `docs/superpowers/plans/2026-08-18-sdf-fpv-full-distal-arm-rebuild.md`

**Supersedes:** `2026-08-18-sdf-fpv-hybrid-full-arm-design.md`

**Shared prerequisite:**
`docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md`

**Depends on:** the accepted X1.27 grip hand, dynamite seat, release marker and
flight handoff; the checked-in humanoid `RightArm` and `RightForeArm` source and
distance contracts; the reviewed fixed-length arm solver and exactly-once
handoff mechanics from the rejected hybrid branch. Its compact pose is negative
evidence, not motion authority.

**Owner gate:** the held pose must read as one continuous hand, wrist, forearm,
elbow and upper arm while preserving the original Blud animation's low, casual
dynamite hold. There may be no dark wrist separation, stepped cuff, floating
hand, swollen join or visible shoulder. The left lighter hand must reach the
fuse with a small plausible movement, ignite it and withdraw. At rest the right
elbow stays outside the viewport. During the underhand toss it may briefly enter
only the lower-right periphery.

## Why a new bake is required

The hybrid experiment proved that its mathematics and rendering plumbing work,
but failed the visual gate. It joined two unrelated signed-distance assets at
runtime: the accepted detailed grip hand and the humanoid forearm. The resulting
wrist remained visibly constructed, with a dark separation and stepped cuff,
while the limb read too large and cropped in the lower-right corner.

More runtime taper, clipping or smooth-union tuning would only disguise the
same incompatible cross-sections. The full rebuild removes the wrist boundary
from runtime entirely. It fuses the accepted hand mesh and the humanoid forearm
mesh offline, remeshes them as one watertight surface, and bakes that surface as
one distance field. The upper arm remains a separate authored segment because
the elbow must articulate.

The humanoid's native `RightHand` partition is not a suitable replacement. Its
source pose is open and the humanoid skeleton has no finger articulation needed
for the accepted dynamite grip. The X1.27 hand shape, six grip keys and prop seat
therefore remain authoritative.

The rejected synthetic-forearm reference also proved that a continuous asset is
not sufficient when its camera-space pose changes the performance. Its upright,
football-like hold moved the bundle away from the original low presentation,
made the lighter-to-fuse reach implausibly large, and suggested an overhand throw
instead of the accepted casual underhand toss. The rerun therefore evaluates
geometry and paired-hand choreography together.

## Decisions

- Bake one continuous **distal arm** field for every accepted X1.27 grip key.
  Each frame contains the complete hand, wrist bridge and humanoid forearm.
- Build the bridge from source meshes before voxelization. Runtime WGSL must
  never union, clip or taper separate hand and forearm fields at the wrist.
- Use Blender 5.2's built-in **Mesh to SDF Grid** and **SDF Grid Boolean** for
  offline hand/forearm fusion. Consume the shared qualification's selected
  direct-grid or explicit Grid-to-Mesh/libigl route; Chisel is not required.
- Preserve the grip hand's anatomical wrist frame, finger motion and
  hand-to-dynamite relationship exactly. The bridge and forearm remain rigid
  across all six grip frames.
- Reuse the humanoid `RightForeArm` surface and its elbow-side boundary so it
  stays compatible with the existing humanoid `RightArm` distance brick.
- Articulate only at the elbow for the first browser gate. The fused distal field
  carries hand and forearm under one rigid transform, so the wrist angle is
  authored rather than solved independently.
- Reuse the reviewed fixed-length two-bone chain and exactly-once release
  semantics, but do not treat the rejected compact wrist trajectory as pose
  authority. Refit modest 3D offsets inside the original Blud keyframe corridor
  and remove the hybrid wrist-swing/taper path.
- Judge the right distal arm together with the existing left pinch/lighter hand:
  low hold, short reach to the named fuse tip, ignition, withdrawal, cook and
  casual underhand release. The left hand is choreography scope, not a second
  full-arm rebake unless its existing geometry independently fails review.
- Shade distal and upper fields with one existing X1.27 flesh material. Do not
  sample humanoid color bricks.
- Keep the safe accepted hand-only fallback if rebuilt assets are missing or
  invalid.
- Stop after the neutral browser gate if the rebuilt wrist is not immediately
  clean. Do not start motion tuning on a rejected static asset.

## Offline asset construction

### Source surfaces

The deterministic baker consumes two source families:

1. the six capped X1.27 right-hand pose soups generated by
   `author_dynamite_grip.export_pose_soups`; and
2. the canonical checked-in humanoid GLB used by `bake_humanoid_sdf.py`, from
   which the `RightForeArm`-owned surface and elbow overlap band are extracted.

Both inputs are hash-bound. Temporary source soups and remesh intermediates stay
outside git. The committed output is a derived R16F atlas, a strict manifest,
and reproducible diagnostic reports/previews.

### Anatomical alignment

The X1.27 hand wrist frame remains authoritative because it owns the grip and
prop seat. The humanoid forearm is aligned to it with one proper rigid transform
and one uniform scale shared with the upper arm. The fit uses:

- the X1.27 wrist origin, distal axis and thumbward/dorsal axes;
- the humanoid elbow-to-wrist axis;
- the humanoid wrist cross-section principal axes; and
- a measured forearm length and wrist circumference target.

Reflections, non-uniform whole-arm scale and per-frame alignment are forbidden.
The transform is solved once and written to the manifest. All six frames use the
same forearm vertices and transform.

### One watertight distal surface

For each grip key, the baker overlaps the aligned forearm with the hand's wrist
by an authored 35 mm band. A short bridge surface interpolates the two boundary
loops with monotone cross-sections and consistent winding. Blender converts the
closed hand, bridge and forearm inputs onto one explicit 1.5 mm SDF grid and
unions them with **SDF Grid Boolean**. The shared qualification decides whether
the baker consumes that direct signed grid or uses **Grid to Mesh** at threshold
zero/adaptivity zero before the deterministic libigl final sampler.

Filtering is local and restrained. It may not move the grip/contact region or
elbow boundary, erase fingers, inflate the palm, or alter the source pose. If a
clean wrist requires global smoothing, the asset fails rather than trading one
visible regression for another.

The remeshed result must be one closed connected component. It is rejected if
it contains a wrist bottleneck, self-intersection, internal shell, open edge,
normal inversion, or a cross-section area jump above 12% between adjacent
5 mm slices through the bridge. The hand's dynamite contact surface may move no
more than 0.75 mm from the accepted firm-grip source.

The six watertight surfaces are baked on one common endpoint-inclusive grid and
depth-packed exactly like the accepted hand clip. The grid covers the hand and
entire forearm through the elbow overlap. Target pitch is 1.5 mm. If the atlas
exceeds the explicit transport budget, the task stops for design review; it may
not silently reduce resolution.

### Distal asset contract

The version-1 manifest records:

- `kind: "fpv-distal-arm-sdf-clip"`;
- source manifest/binary hashes for the accepted hand clip and humanoid bake;
- the canonical humanoid source hash;
- six ordered labels and keys matching the accepted grip clip;
- per-frame and atlas dimensions, bounds, voxel pitch, encoding and byte hash;
- the one hand-from-distal transform used for prop seating;
- the one distal-from-humanoid-forearm fit transform and uniform arm scale;
- elbow centre, elbow axis and the retained elbow overlap width;
- remesh pitch, connected-component count, boundary-edge count, contact error,
  and bridge cross-section diagnostics; and
- Blender version, selected SDF output route, canonical Geometry Nodes contract
  hash and all intermediate source/support hashes; and
- a hash-covered canonical JSON source section sufficient to reproduce and
  verify the bake.

The loader rejects unknown versions/kinds, missing fields, non-finite or
non-invertible matrices, path traversal, byte/hash mismatches, changed grip
labels/timing, changed prop seat, or incompatible humanoid elbow metadata.

## Animation authority and paired-hand sequence

Before any new arm motion is authored, capture the existing Blud-derived
dynamite timeline and accepted X1.27 output at deterministic camera settings.
The rerun records a small keyframe corridor rather than requiring pixel-identical
2D sprites: the right hand/bundle and left pinch hand may receive modest depth,
roll and anatomical adjustments, but their screen-space centres, silhouettes
and ordering must still read as the same performance.

The first complete motion gate is:

1. low right-hand bundle hold;
2. left lighter/pinch hand enters from its existing side;
3. its ignition point reaches the named `FuseTip` with a short movement;
4. ignition occurs without moving the bundle into a football pose;
5. the left hand withdraws and the right hand cooks in the low hold; and
6. the right arm performs the accepted casual underhand release.

The lighter reach and right-hand hold are solved together. Tuning one while the
other is hidden is forbidden because their spatial relationship is the reason
the previous candidate failed.

## Runtime arm architecture

### Two pieces, one joint

The runtime field has only two anatomical pieces:

```text
continuous distal clip: fingers + hand + wrist + forearm
                              │ humanoid-authored elbow overlap
humanoid RightArm brick: upper arm
                              │
                     offscreen shoulder anchor
```

The distal field is sampled once per ray step, interpolating adjacent grip
frames as the hand clip already does. The upper-arm field is sampled once under
its solved transform. A bounded elbow smooth union is allowed only in the
retained humanoid overlap band. There is no wrist branch in WGSL.

### Pose and motion

The reviewed two-bone solver continues to provide shoulder, elbow and wrist
positions with fixed upper-arm and forearm lengths. For the rebuilt field, the
distal segment transform is derived directly from the solved elbow-to-wrist
frame. The authored hand-from-distal transform then yields the final hand and
prop pose. No independent wrist swing or hand-target correction is applied.

The Blud-faithful underhand toss remains reach-constrained. The shoulder stays outside the
viewport in all phases; the elbow stays outside at rest and may enter only the
outer lower/right 15% briefly during toss. Limb screen coverage is explicitly
bounded so the forearm cannot dominate the frame again.

The held dynamite is derived exclusively from the final authored hand pose.
The accepted release marker fires exactly once, and its world pose and velocity
come from the same rendered hand transform, preventing a visual/physics jump.

## Rendering and placement

The dedicated FPV arm renderer binds the rebuilt distal atlas plus the existing
humanoid distance atlas. It owns one material, one conservative proxy and one
set of arm uniforms. The generic body marcher and zombie renderer remain
unchanged.

The proxy is the transformed union of the full distal bounds, upper-arm brick,
elbow blend margin and normal-estimation margin. The renderer uses the existing
SDF compositor output contract, including hit depth and non-opaque alpha.

Neutral placement is calibrated against the accepted viewport before motion:

- wrist in the lower-right quadrant, fully inside the image;
- hand and forearm large enough to read but not cropped at rest;
- elbow and shoulder outside the frame;
- dynamite seated exactly in the accepted firm grip; and
- continuous flesh pixels across every visible wrist slice.

## Verification gates

### Historical reference gate — rejected

The previously validated one-piece X1.27 hand plus synthetic 190 mm forearm was
articulated against the humanoid upper arm and reviewed on 2026-08-18. Although
it removed the floating wrist, its synthetic forearm and upright bundle pose
regressed from the accepted hand, read like an overhand football hold, and made
the lighter-to-fuse movement implausibly large. It remains diagnostic evidence
only and may not be promoted or used as the next motion baseline.

### Gate A — offline bake

- deterministic repeated output bytes and canonical manifest;
- shared Blender SDF qualification, selected route and node-contract hash match;
- exactly six ordered frames on one common grid;
- one closed connected component per frame and zero boundary edges;
- contact-region error at or below 0.75 mm;
- bridge slice-area jump at or below 12%;
- valid source and output hashes; and
- diagnostic contact/bridge/whole-distal previews reviewed by the implementer.

### Gate B — neutral live browser (first owner-visible milestone)

A real headed WebGPU run must show the firm-grip frame with the rebuilt distal
field and upper arm. Automated evidence must establish:

- no page, WebGPU, shader or pipeline errors;
- rebuilt view visible and old hand view hidden;
- arm ON/OFF produces a deterministic prop-excluded ROI delta;
- repeat captures of the same state are pixel-identical or within a pinned
  noise bound;
- hand/prop contact error remains at or below 0.75 mm;
- elbow and shoulder are outside the viewport; and
- the rebuilt asset, not a debug proxy or old hand, produced the pixels.

The owner then gives the static verdict against a side-by-side capture of the
accepted X1.27 low hold. Any dark wrist gap, cuff, scale jump, floating hand,
oversized/cropped limb, visible shoulder, football-like hold or excessive
lighter-to-fuse distance rejects the asset and stops the plan before motion.

### Gate C — two-hand lighting performance

Capture low hold, lighter entry, fuse contact/ignition, lighter withdrawal and
cook. Verify short fuse reach, no bundle relocation to accommodate the lighter,
stable prop seating, elbow/shoulder visibility bounds and the approved brighter
skin response. Owner approval is required before the toss gate.

### Gate D — motion and release

After Gate C approval, capture cook, pre-release, casual underhand release,
follow-through and recovery in a real headed run. Verify finite matrices, fixed
bone lengths, temporal quaternion continuity, original-keyframe corridor,
compact screen coverage, allowed elbow exposure, exactly one release, zero prop
seating jump and clean pointer-lock cleanup.

## Scope exclusions

- No generic zombie marcher rewrite.
- No humanoid color-atlas sampling for the FPV arm.
- No per-finger runtime skeleton; the accepted six baked grip frames remain the
  hand animation.
- No full left-arm rebake in this pass; the existing left pinch/lighter hand is
  included to constrain and judge the right-hand pose.
- No shoulder visibility or torso geometry.
- No reuse of the rejected runtime wrist adaptor, taper or clip logic.
- No development-only extracted Blood asset in runtime or git.

## Rejected alternatives

- **Native humanoid `RightHand`:** open/static and cannot reproduce the accepted
  dynamite grip.
- **More hybrid seam tuning:** already failed the owner gate and preserves the
  architectural mismatch.
- **Analytic capsule bridge:** would restore the synthetic rubber-tube look and
  still leave a runtime wrist join.
- **One rigid full arm:** removes elbow articulation and cannot sell the toss.
- **Full per-finger skeletal hand rewrite now:** unnecessary risk when the
  accepted X1.27 grip frames and prop relationship already work.
