# Humanoid SDF Wound Damage Design

**Date:** 2026-08-19
**Status:** Approved design. Follow-on to the humanoid sever spike; not a
replacement for it.

**Depends on:**
`docs/superpowers/specs/2026-08-17-humanoid-sdf-sever-spike-design.md`
(the baked bone-brick asset, manifest, pose model, cluster marcher and
complementary sever masks are all inputs here, not deliverables).

**Depends on:**
`docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md`
(`X1.sdf-authoring`, complete — Blender 5.2 + OpenVDB adapters qualified on
branch `claude/chisel-sdf-qualification-cont-e8f699`).

## Purpose

The procedural SDF zombie takes live wounds: `src/lab/sdf-zombie/damage.ts`
stamps a crater into the primitive nearest a world hit, stores it in that
primitive's local frame, and the marcher smooth-subtracts it from the composed
field with an everted rim. The baked humanoid has no primitives, so none of
that keying survives the change of representation.

This spec defines how the same wound model is re-keyed onto bone-local
distance bricks: which index a wound rides, how a world hit reaches brick-local
space, how craters compose with the sever masks that already carve the same
forearm brick, what the marcher's fixed-size wound payload has to become for a
clustered bone marcher, how the wound interior and the sever cap share one
layered flesh material, and what a click-to-shoot path would actually require.

The spike's damage interaction is one button-triggered mid-forearm sever with
no targeting. This spec is what turns that into damage the player can aim.

## Sequencing

**Owner decision (2026-08-19): folded into `X1.humanoid-sever-spike` rather
than sequenced after it.** Wounds are part of what the spike's owner gate is
actually judging — whether a baked representation keeps the live-wound feel of
the procedural zombie — so the testable build must carry them. This section
supersedes the original "lands after the gate" sequencing.

Consequences of folding in:

- The coarse CPU distance brick below stops being a recommendation and becomes
  a **requirement on the spike's baker**, emitted in the same pass as the
  distance and colour atlases. Adding it later costs a manifest version bump
  and a full byte-determinism revalidation.
- The spike's contact sheet grows the wound panels (11–17 below) instead of
  starting a second sheet.
- The spike's 50 ms interaction gate extends to the first shot after page load.

What does **not** change: the wound work still depends on the atlas, manifest,
pose model, cluster marcher and sever masks existing first, so it is the last
slice of the spike, not a parallel one.

### Note on the orphaned 2026-08-18 atlas

A textured humanoid bone atlas already exists at `ac0c28f` on
`codex/fpv-full-distal-arm-rebuild` (32 MiB distance + 64 MiB colour + a
22-bone manifest). **Do not build on it.** It was baked as a prerequisite for
the hybrid FPV arm, whose gate was owner-rejected at `9c261e7`; the branch
never merged, and the bake predates `X1.sdf-authoring`, so it uses the libigl
winding-number path rather than the qualified `direct-vdb` route.

It is, however, a useful reference: it is the reason the manifest field names
in this document (`occupiedBoundsMin/Max`, `bones[]`, `rightArm.cutPlaneLocal`)
are real rather than invented, and it was measured clean against the
`_edge_adjacency` defect — over its `RightForeArm` brick the fix produced 0 SDF
sign flips, 0.000 mm distance delta, 0 winding samples crossing 0.5, and a
mean colour delta of 0.00/255 on the visible shell.

## Product decisions

- Wounds key to a **bone brick index**, not a glTF joint index and not a name.
- The world-hit-to-local path goes through the bone's **posed rigid transform**,
  inverted analytically. `basisFromAxis`, the de-yawed axis basis, and the
  `bodyYaw` parameter are all deleted, not ported.
- Wounds stay **world-space at carve time** in the shader, exactly as today. The
  representation change is entirely on the CPU side of the upload.
- There is **one authoritative wound ring** on the humanoid. The attached and
  detached upload lists are derived per frame; the sever never moves wounds
  between rings, so reset stays trivially idempotent.
- The wound interior and the sever cap share **one layered flesh material**
  driven by one interior-depth function. The everted rim is geometry and stays
  wound-only.
- Baked source colour must be **suppressed inside every opening**, wound craters
  included. This is a correctness requirement of the baked path, not art
  direction.
- Click-to-shoot uses a **coarse CPU brick sphere-trace**, not a GPU readback
  and not a bounding-proxy hit point.
- `MAX_WOUNDS` becomes two numbers: a logical wound cap and a larger GPU **slot**
  budget, because cluster and cut-plane duplication consume slots.

## Wound keying

### The index

```ts
export interface BoneWound {
  /** Index into manifest.bones[] — the same index space as poseMatrices,
   *  HumanoidPoseState.bones, and humanoid-sever's distalIndices. */
  boneIdx: number;
  /** Hit position in that bone's BIND-LOCAL frame, metres. */
  local: Vec3;
  radius: number;
  type: WoundType;   // reused verbatim from damage.ts
  ageSec: number;
}
```

`boneIdx` is the array position in `manifest.bones[]`, **not**
`HumanoidBrickManifest.jointIndex`. Those two differ: the checked-in
`zombie-humanoid.json` reports `boneCount: 24` with `bones.length: 22` because
`head_end` and `headfront` fold into `Head`, so joint index and array index
diverge past the first fold. Every runtime array the wound has to cooperate
with — `poseMatrices` (`bones.length * 16`), `HumanoidPoseState.bones`,
`descendantIndices` output, `humanoid-sever`'s `distalIndices` — is indexed by
array position. Keying on `jointIndex` would need a lookup at every use and
would silently address the wrong anatomy on any bone after a fold.

Wounds are per-body runtime state with a lifetime shorter than the manifest's,
so an index is safe; the manifest is loaded once per page and never swapped
under a live body. A `bone: string` field is **not** stored — it doubles the
ring's footprint to defend against a case (hot-swapped manifest) that the
loader already rejects.

### Choosing the owner brick

`worldHitToWound` currently picks the primitive whose nearer endpoint is
closest to the hit, skipping carves. Bricks are volumes, so the equivalent test
is distance to the brick's posed occupied region:

1. **Broad phase.** For each retained brick *i*, take
   `occupiedBoundsMin/Max`, push its eight corners through the bone's posed
   transform, and keep bricks whose posed AABB is within `radius + margin` of
   the hit. This is the same posed-corner sweep `humanoid-sever.ts` already does
   in `distalRadius`.
2. **Narrow phase.** For each survivor, map the hit into bind-local (below) and
   score it by the point-to-AABB distance against that brick's
   `occupiedBoundsMin/Max` — zero inside, positive outside.
3. Take the minimum. Ties break on the lower `boneIdx` so the result is
   deterministic and testable.
4. If nothing survives the broad phase, fall back to the nearest bone origin, so
   a hit can never fail to produce a wound. This preserves `damage.ts`'s
   "a body that can be hit always takes the wound" guarantee.

**Use `occupiedBoundsMin/Max`, never `boundsMin/Max`.** The latter carries the
exterior margin plus trilinear padding, so overlapping padded boxes in the
joint bands would hand shoulder hits to the spine.

Prefer the partition's weight-derived bind bounds
(`coverage.partitions[].boundsLocalMin/Max`) over a raw `face_owners`
owned-face AABB for any bounds test. Historically the owned-face AABB was
badly contaminated — `RightForeArm` carried 168 stray faces ~0.5 m away and a
body-sized 0.60 × 0.43 × 0.73 m box swallowing 11,872 `Hips` faces. That was
traced to a real defect in `_edge_adjacency` (`np.repeat` on block-stacked
edges where `np.tile` was needed), **fixed in `01fd701`**, after which the
stray count is 0 and the owned-face AABB agrees with the bind bounds. The
weight-derived bounds remain the stable choice because they never depended on
face ownership at all. See
`docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-notes.md`.

Brick selection is measurably better than the primitive heuristic it replaces.
`damage.ts` scores against capsule endpoints, so a hit on the middle of a long
thigh scores worse than a hit near a neighbouring hip blob's centre; the brick
test scores against the actual occupied volume.

## The world-hit to brick-local transform

Every posed bone transform is rigid: `HumanoidBonePose` is a position plus a
unit quaternion, and `poseMatrices` writes exactly that. So the inverse is
closed-form and exact — no matrix inversion, no orthonormalisation:

```
local = qConj(q_i) · (hitWorld − t_i)
world = t_i + q_i · local
```

where `(t_i, q_i)` is `HumanoidPoseState.bones[boneIdx]`. At rest the pose
equals `decomposeBindToModel(bindToModel)`, so a wound stamped at rest and read
at rest returns the identical point; `modelToBind` is needed only to bring a
model-space authored landmark into bind-local and never appears in the
per-frame path.

This deletes the entire reason `damage.ts` has a `frame()` function. That
function exists because procedural primitives carry no rotation of their own:
spheres have no axis at all, vertical capsules hit `basisFromAxis`'s degenerate
fallback, and both cases produced a viewer-fixed basis that let craters stay
put while the body turned under them. The de-yaw/re-yaw threading of `bodyYaw`
through both `worldHitToWound` and `woundWorldPos` is a workaround for missing
rotation. A bone brick carries its full rotation — body yaw, torso twist, elbow
flexion and all — in `q_i`, so the workaround has nothing left to fix. **The
`bodyYaw` parameter, `basisFromAxis`, `qRotate`-on-`prim.orient`, and the
whole stamp-yaw/read-yaw matching contract do not port.** That contract was
also a live bug source: a mismatch between the yaw passed at stamp and the yaw
passed at read drifts the wound by the delta, silently.

Two properties fall out and are worth pinning as tests:

- **Articulation invariance.** A wound stamped with the elbow at 0° and read at
  100° is at the same bind-local offset, so it rides the flexion exactly. This
  is checkable with no renderer.
- **Detachment invariance.** After a sever, the distal bones are frozen relative
  to the chunk root. Their wounds need no fix-up whatsoever: the same
  `local → world` formula runs against `chunkRootPose ∘ frozenDistalBones[k]`
  instead of `poseMatrices[i]`. This is the payoff for keying bone-local rather
  than world-local, and it is why the detached hand keeps its bullet holes
  through the tumble.

## Composing with the sever masks

The spike samples the `RightForeArm` brick from two renderers with
complementary half-space masks around `manifest.rightArm.cutPlaneLocal`
(`[nx, ny, nz, w]`, forearm bind-local, shared `cutSeed` and `irregularityM`).
Wounds on that brick must respect the same plane.

### Partition, do not migrate

Keep one ring on the humanoid state. Each frame, derive the two upload lists:

```
s = dot(n, wound.local) + w          // forearm-local signed distance to the cut
s < 0                      -> attached list (proximal stump)
s > 0                      -> detached list (distal forearm + hand)
|s| <= radius + irregularityM -> BOTH lists
```

Wounds on any other bone go to whichever list owns that bone: everything in
`distalIndices` (forearm, hand, fingers) is detached, everything else attached.

**Straddlers must be duplicated, not assigned.** The masks decide which half of
the brick renders; the crater is real geometry in both halves. Give a straddler
to only one side and the other side's cut cap shows a bite taken out of one
face and not the other — which fails the spike's own "cut masks are
complementary" gate and reads on screen as a gap. The duplicate costs one GPU
slot on each side, and there can only be a couple: the band is
`radius + irregularityM` wide, at most 134 mm for a blast against a 4 mm
irregularity.

Deriving per frame rather than migrating at the sever frame means reset is a
no-op on the wound state. `severForearm` and `resetArm` never touch the ring.
That matches the spike's "reset is idempotent" requirement without adding a
second thing to restore.

### Order of operations in the field

Per marched point, per cluster:

1. sample each member brick, apply the bone-local softness warp;
2. apply the brick's half-space cut mask (`smax` against the irregular plane);
3. union the bricks — `smin` inside declared overlap bands, hard `min` outside;
4. `applyWounds` on the composed result.

Wounds carve **last, against the composed field**, exactly as `mapBody` does
today (`applyWounds(carved, …)`). Two consequences worth stating:

- A crater near the elbow correctly eats into both the upper arm and the
  forearm, because it sees the union rather than one brick. Desirable, and free.
- A crater that overlaps the cut cap composes as two `smax` subtractions, which
  is well-defined and produces the right silhouette: the cap keeps its flat
  irregular profile except where the crater has bitten through it.

### Known limitation: crater slide under high softness

The softness warp is bone-local and applied inside the brick sample; a
world-space wound sphere subtracted after the union does not wobble with it. At
maximum latex the crater lip can appear to slide over the wobbling surface by
up to the warp amplitude — a few millimetres. The current procedural lab has
exactly this behaviour, so this is not a regression.

If the visual gate flags it, the cheap fix comes first: evaluate the owning
bone's warp on the CPU at the wound centre once per frame (≤ 24 evaluations)
and pre-displace the uploaded world position by it. The expensive fix — carving
in bone-local space inside each brick sample, before the warp — multiplies the
wound loop by the cluster's sample-bone count and is not worth it until
measured.

## GPU payload for a clustered bone marcher

### Slots versus wounds

`MAX_WOUNDS = 16` is currently both the logical wound cap and the number of
texture columns scanned. Cluster and cut-plane duplication break that identity,
so it splits:

```ts
export const MAX_BONE_WOUNDS = 12;   // logical wounds in the ring
export const MAX_WOUND_SLOTS = 24;   // texture columns written and scanned
```

Both fit the existing rows without widening anything: `ROW_WOUND` and
`ROW_WOUND_META` are `MAX_PRIMS` (48) columns wide, and the humanoid path uses
no primitive rows at all. `writeWounds()` in `zombie-gpu.ts` is reused verbatim
— it already takes parallel world-position / radius / type / age / splay /
offset arrays and returns the written count into `woundCfg.x`. Only its `n`
clamp and the three WGSL loop bounds change, and those literal `16`s become a
template constant in the shader source (they are already inside template
strings, so this is a parameter, not a rewrite).

The ring evicts oldest-first at `MAX_BONE_WOUNDS`, reusing `pushWound`. If
duplication would exceed `MAX_WOUND_SLOTS` in a frame, drop the **oldest**
duplicate copies first (never the primary entry), so an old wound degrades to
"visible from one cluster" rather than vanishing. The drop is counted and shown
in the page readout; a nonzero count during the visual gate means the budget is
wrong and should be raised, not silently tolerated.

### Per-cluster wound ranges

A ray marching the head should not scan a wound on the shin. Wounds are sorted
by cluster before upload and a per-cluster `(start, count)` pair is written to a
new row, mirroring the existing `ROW_CLUSTER_RANGE` layout
(`x = start, y = count, z = alive, w = oriented`) rather than inventing a
second convention:

```
row 10  woundRange   x = start slot, y = count, zw = 0
```

`applyWounds`, `woundMask` and `charMask` take the active cluster's `(start,
count)` instead of `(0, woundCfg.x)`. `woundCfg.x` keeps its meaning as the
total written count for the non-clustered chunk/hands paths, which are
untouched.

**Cluster-boundary duplication.** A wound within `radius + rimReach` of a
neighbouring cluster's `sweepBoundsMin/Max` is written into both clusters'
ranges, or the crater is sliced off at the cluster seam. `rimReach` is the
everted lip's outer extent, `radius * woundCfg.w * rimOffsetScale +
radius * woundCfg2.x` — the same quantity `applyWounds` uses to place the
Gaussian ring, so the duplication test cannot drift from the geometry it is
protecting.

The detached piece gets its own view with its own small ring (typically one to
three wounds plus the torn-end blast the chunk path already parks there), using
the unmodified `writeWounds` and the existing single-cluster chunk shader.

## Wound interior and cut-cap material

The spike specifies a layered cut cap: skin edge, wet red tissue, darker
central depth, with source exterior texture never stretching across the cap.
The procedural lab already has `woundMask` (a wet-interior term) and
`charMask`, feeding a wet red blend and a wetness boost.

**These share one function, not two.** Define a single interior-depth term,
0 at the outer skin and 1 at maximum depth into any opening:

```
interiorDepth(p) = max(woundInterior(p), cutCapInterior(p))
```

and drive one ramp — skin edge → wet red tissue → darker depth — off that. The
`charMask` term stays separate; burns are a surface state, not a depth.

Three reasons this is the right shape:

- **It prevents a known bug class.** Where a crater meets the cut cap, two
  independent wetness terms stack. `X1.17` was exactly this failure: wound
  wetness plus fresnel rim-light clipped whole patches to white. The fix there
  was to fade fresnel *inside* wounds; a second, cap-shaped wetness producer
  would reintroduce the same stacking from a new direction. One term, one ramp,
  one place to clamp.
- **It is what the owner gate is actually judging.** A crater and a severed cap
  are the same tissue seen at different depths. Two ramps tuned separately will
  read as two materials on one arm.
- **The existing fresnel fade, wet-specular retention, and gore wetness boost
  all already key off the wound term** and pick up the cap for free.

The **everted rim is not shared**. `applyWounds` splays displaced flesh into a
raised lip because a projectile peels flesh outward; a sever is a clean torn
cross-section and gets a narrow analytic torn rim instead. Rim geometry stays
wound-only, keyed by `rimSplayScale`/`rimOffsetScale` from `WOUND_PROFILES`.
Summary: **shading layer shared, rim geometry not shared.**

### Texture suppression is mandatory, not cosmetic

The colour brick stores nearest-surface source colour extended through the
sampling band, so voxels *inside* the flesh carry skin colour. Sampling colour
normally inside a crater therefore paints skin tone on the inside of a bullet
hole — visibly wrong, and a failure mode the procedural lab could not have,
because it had no baked texture. Source colour must be suppressed wherever
`interiorDepth > ε`, for wounds and the cap alike, with the layered flesh ramp
taking over. The spike already requires this for the cap; this design extends
the identical gate to craters and makes it one code path.

## Click-to-shoot targeting

The spike has no targeting: severing is a button. Aimed damage needs a
world-space hit point *on the flesh*, plus the bone that owns it. Four pieces:

**1. A CPU-readable field.** The distance atlas is a 33.5 MiB R16F upload; it is
not kept CPU-side and should not be. Ray-versus-posed-OBB alone is not enough —
the hit lands on a bounding box, so craters float off thin limbs like forearms
and fingers by centimetres. The recommendation is a **coarse CPU brick per
bone**: the same field resampled to ≤ 16³, f32, ~16 KiB per bone and ~350 KiB
for 22 bones, shipped in the manifest and validated by the same hash contract
as the atlases. Sphere-trace that in bind-local space.

Accuracy: a 16³ brick over a forearm is roughly a 20 mm pitch, so the trace
lands within about a voxel; a short secondary refinement along the ray using
the same field converges to a few millimetres, which is well inside a 55 mm
pellet crater. Good enough to place a wound, and cheap enough to run on click.

**2. Broad phase, then trace.** Ray versus each bone's posed occupied-bounds
OBB gives the candidate set and an entry `t`; sphere-trace the coarse brick of
each candidate from its entry point, take the nearest surface crossing. The
bone whose field was minimal at the hit **is** the owner — no nearest-endpoint
heuristic, and better attribution than `damage.ts` gets today.

**3. Raycast the POSED body.** Wounds are bone-local, so the ray must be tested
against `poseMatrices`, not against the bind pose. This is the same rule the rig
work already recorded for the procedural path (`X1.22` task 4: rest-space
raycasting breaks the moment wander or collapse displaces the body); here the
displacement is elbow flexion and any future locomotion. Pin it in a test.

**4. The detached piece is a target too.** Once severed, the distal forearm is a
chunk with its own root transform. Include it in the broad phase against
`chunkRootPose ∘ frozenDistalBones`, and route its hits to the detached ring. A
severed arm that ignores gunfire while lying on the floor reads as a bug
immediately.

Plumbing reuses the lab's existing pointer→ray path in `lab-main.ts` and the
existing `WOUND_PROFILES` calibres. Whoever verifies this in the browser pane
should know that the pane fires a real pointer click at the last cursor
position on re-composite, which stealth-stamps pellets; park verification reads
early and treat wound-count growth *between* tool calls as harness noise, not as
an input loop.

`explosion-aoe.ts`'s blast fan-out (one impact into several wounds) needs no
change beyond the new hit→bone mapping, but torso blasts and multi-wound
clusters stay deferred with the spike until the single-wound path passes its
gate.

## Net-new versus reusable

**Reused unchanged, imported from `damage.ts` / `zombie-gpu.ts` / `march.wgsl.ts`:**

| Thing | Why it survives the representation change |
| --- | --- |
| `WoundType`, `WOUND_PROFILES` | Calibres are weapon properties. A blast is 130 mm with a tamed 0.45 splay whether it lands on a capsule or a brick. |
| `pushWound` | Ring append with oldest-eviction; cap becomes a parameter. |
| `writeWounds()` | Already takes flat world-space arrays and returns the count. Only the clamp changes. |
| `APPLY_WOUNDS`, `WOUND_MASK`, `CHAR_MASK` (WGSL) | Semantics are "world-space spheres against a composed field", which is still true. Loop bound and range args are the only edits. |
| `woundCfg` / `woundCfg2` vec4 semantics | Unchanged, including the `X1.21.2` shell-amp and relaxation channels. |
| `ROW_WOUND` / `ROW_WOUND_META` texel layout | Unchanged: xyz+radius, then (type, age, splay, offset). |
| `explosion-aoe.ts` fan-out | Needs a hit→bone mapping, not a new model. |

**Net-new:**

- `src/lab/sdf-zombie/humanoid-damage.ts`: `BoneWound`, `worldHitToBoneWound`,
  `boneWoundWorldPos`, and the posed-AABB broad phase.
- Cut-plane partition with straddler duplication, and the per-frame derivation
  of the attached/detached upload lists.
- `MAX_BONE_WOUNDS` / `MAX_WOUND_SLOTS` split, `ROW_WOUND_RANGE`, per-cluster
  ranges, and cluster-boundary duplication.
- Shared `interiorDepth` unifying the wound interior and the sever cap, plus the
  mandatory source-colour suppression inside openings.
- Coarse CPU bricks in the baker/manifest, and the sphere-trace targeting path.

**Deliberately not ported:**

- `frame()`, `basisFromAxis`, and the `bodyYaw` de-yaw/re-yaw threading —
  subsumed by the bone's own rigid transform, along with the stamp-yaw /
  read-yaw matching contract that was a silent drift source.
- The `p.op === 'sub'` carve skip — bricks have no carve primitives; the eye
  sockets are in the baked field.
- Nearest-endpoint owner selection — replaced by occupied-volume distance and,
  once targeting lands, by the trace's own minimal-field bone.

## Validation

### Pure tests (no renderer)

- Round trip: `boneWoundWorldPos(worldHitToBoneWound(hit))` returns `hit` to
  1e-6 m at rest and at 100° elbow flexion.
- Articulation invariance: a wound stamped at 0° has an identical `local` when
  read at 50° and 100°; its world position tracks the flexed forearm.
- Owner selection: a hit on the mid-forearm shaft keys to `RightForeArm`, not to
  `RightArm` or `RightHand`; a hit inside the 30 mm elbow overlap band resolves
  deterministically and stably across the sweep.
- Bounds discipline: the broad phase reads `occupiedBounds*` only. A test
  asserts no wound code path references `boundsMin/boundsMax` or any owned-face
  extent.
- Cut partition: wounds either side of `cutPlaneLocal` land in exactly one list;
  a wound within `radius + irregularityM` lands in both; the two lists' union
  minus duplicates equals the ring.
- Detachment: after `severForearm`, a hand wound's world position is continuous
  across the sever frame (no pop) and thereafter follows the chunk.
- Reset idempotence: `severForearm` → `resetArm` → `severForearm` produces
  identical lists; the ring is bit-identical before and after a reset.
- Slot budget: duplication never writes past `MAX_WOUND_SLOTS`; overflow drops
  duplicates, never primaries, and increments the reported counter.
- Cluster ranges partition the slot array with no gaps and no overlap except
  declared boundary duplicates.
- Targeting: rays are tested against `poseMatrices`, never the bind pose — a
  flexed-elbow ray that would hit the bind-pose forearm and miss the flexed one
  must miss.

### Live visual gate

Extend the spike's contact sheet rather than starting a new one:

11. three pellets across the mid-forearm, elbow at 0°;
12. the same three at 100° flexion (craters ride the flesh, no slide, no seam);
13. a pellet placed deliberately on the cut plane, pre-sever;
14. the sever frame for that straddling wound — both halves show the bite;
15. the detached piece in flight, bullet holes intact;
16. a crater spanning the shoulder cluster boundary (no slicing at the seam);
17. a fresh crater beside the settled cut cap, for side-by-side material
    comparison of the shared layered ramp.

Reject on: colour swimming or skin tone visible inside a crater; a wetness
white-out where a crater meets the cap; a crater sliced at a cluster seam; a
crater that drifts off its landmark under flexion; a straddling wound that bites
only one half; a wound that survives on the stump but vanishes from the
detached piece or the reverse.

### Performance

Report the wound-scan cost as a delta against the spike's steady-state timing at
0, 6 and 12 logical wounds, and the click-to-shoot trace cost per hit. The
spike's hard 50 ms interaction gate extends to the first shot after page load:
firing must not compile a pipeline or allocate a view for the first time.

## Explicitly deferred

- Bone-local wound carving inside the brick sample (the expensive fix for crater
  slide) — only if the visual gate rejects the CPU pre-displacement mitigation.
- Torso blasts, multi-wound clusters, and whole-body gib chains, as in the spike.
- Wound fluid / gushing gore on the baked path (`X1.18` is still open on the
  procedural path and should land there first).
- Skeleton reveal under baked flesh (`X1.20`) — bone bricks are flesh volumes,
  and what a wound reveals underneath is a separate asset question.
- Severing at any plane other than the baked mid-forearm cut. Arbitrary cut
  planes need the mask pair generalised and are not required to aim a gun.
- Integration into the game and replacement of the procedural zombie.
