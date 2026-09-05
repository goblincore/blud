# Zoned baked wounds: head and main torso

Date: 2026-09-04
Status: proposed prototype design for later dispatch; no implementation started.
Planning baseline: main ea7d989. Re-read the current checkout before execution.
Owner scope: BOTH head and main torso. Torso close-up is the primary visual and performance case; a head-only result does not satisfy the request.

## 1. Question and success

Can authored wound shapes and deformation playback replace repeated analytic wound evaluation with bounded sampled damage, while preserving convincing persistent damage on moving flesh?

Build a toggleable zombie prototype, not a replacement for all characters. Make the result visible in a torso filling the screen, with head damage visible in the same body and separately framed for detail. Report animation peaks as well as settled cost. No performance gain is assumed.

Candidate performance gate: at least 15% AND 2 ms less median end-to-end cost in the torso-heavy, eight-hit settled case, larger than the measured repeat spread. This is a proposed engineering gate, not an owner-promised gain. Also report the existing game objective of p95 <= 33 ms using actual frame intervals, separately from fenced throughput. A visually worthwhile but slower result is reported as LOOK-ONLY, never promoted as an optimization.

Only owner acceptance of the motion reel can approve the new appearance. Numeric improvement is not artistic approval.

## 2. Selected approach and alternatives

Use authored 3D wound stamps, accumulated on hit events into persistent damage caches attached to the head and four torso masses. During a short transition sample source and target caches; once settled sample only target. Shader work scales with the bounded number of spatial caches, not with the historical list of head/torso impacts.

Alternatives considered:
- Preset curves driving current applyWounds: useful art control, but leaves its recurring field loop; not the primary experiment.
- Full pre-baked head/torso state combinations: simple lookup but multi-zone combinations grow rapidly and later states can erase earlier wounds.
- Per-hit baked stamps sampled forever: easier, but retains per-wound runtime scaling. Allowed as the CPU reference, not the final candidate renderer.

The existing analytic body stays in place. This work bakes DAMAGE OPERATORS, not the whole posed body or a new mesh. Ordinary limbs, burns, and unsupported effects retain the current path. Do not restart hull extraction, tile binning or adaptive resolution.

## 3. Content and regions

One existing zombie, unchanged intact proportions/materials/rig.
Logical regions:
- Head: front, back, left, right, in its moving local frame. Neck stays on the analytic path.
- Torso: upper/lower x front/back/left/right = eight logical regions. Cover chest, belly and flanks, not just a tiny chest decal.
These are hit-selection labels, NOT new CLUSTER_ORDER entries or new renderer clusters.

A small authored library: puncture, ragged crater and split, each with three seeded variants and three size/severity stages. Pellet/blast choose compatible recipes. Use current pellet radius 0.055 m and blast radius 0.13 m as initial scale references; retain existing measured flesh-depth caps. All content values name their measured or art-directed source. No AI-generated external assets or licensing dependency is required: build the first library from offline combinations of cutters and lip envelopes.

Zone selects compatible content. Preserve actual local impact location and normal; do not snap every left-side shot to the same hole. Region classification uses outward surface direction in local coordinates, with deterministic tie-breaking; torso height splits at the midpoint of the measured torso extent. A boundary hit chooses one label once, but its stamp can extend across the boundary. Do not clip stamps to logical-zone borders.

Use a stable event seed, modest orientation variation, and monotonic damage stages: hits 1, 2-3, 4+ select stages 1, 2, 3. Existing gameplay decides severing. Stage 3 must not silently replace that rule.

## 4. Spatial caches and motion

Five physical cache frames: one rigid head frame and one for EACH of the four authored torso masses in zombie.blob. The main torso is not a single rigid chunk. Resolve owners from compiled source/bone metadata at initialization; do not hard-code primitive indexes that can change when the face compiler adds parts. Assert the fixture has the expected four torso masses; a different layout takes the analytic fallback with a diagnostic.

Head frame follows the existing rigid head rotation and translation. Torso cache frames reproduce the primitive-local wound transport already used by damage.ts and game-actor.ts, including bodyYaw. This is essential for the spherical torso prims whose axes cannot carry yaw. Existing wound anchors/rig jitter must continue to agree with the cache.

A stamp is stored in the hit owner's physical cache and can affect the full nearby flesh field, as current wounds do. A sample queries active cache bounds; overlapping caches combine rather than choosing a cache from the nearest-primitive ID (which changes at smooth joins). One cache is selected per hit, so boundary hits do not double-stamp.

Start with 64^3 cells per cache and evaluate 96^3 for close-up quality. Empty caches allocate no volume. Bounds derive from the owner/eligible head parts plus maximum stamp/lip support and a two-voxel guard. Cache allocation excludes no outward lip; query bounds also cover it. Pack caches as guarded slabs in two 3D texture atlases and clamp sampling to each slab. Five 64^3 RGBA16F bricks x two endpoints are approximately 20 MiB before guards; five 96^3 pairs approximately 67.5 MiB. Record exact allocated CPU/GPU bytes. Hard experimental GPU ceiling: 96 MiB for this one candidate actor, not a suggested crowd budget. No silent resolution reduction on overflow.

Initial ownership allows one experimental actor; other actors remain baseline. Scaling memory to a crowd is a separate decision after the result.

## 5. Damage representation and composition

Store four linear, non-color channels per voxel:
R: signed distance to the accumulated CUTTER (negative inside removed space), in local metres.
G: nonnegative outward lip displacement envelope, in metres.
B: local wound/material-support mask, 0..1.
A: cavity ambient-occlusion factor, 0..1; neutral 1.

Neutral: positive far cutter distance, zero lip/mask, AO 1. Outside a brick return an explicit identity, not repeated edge texels.

Reference operation:
    damagedFlesh = max(preWoundFlesh - lip, -cutterDistance)
Accumulate cutters by minimum, lip/support by maximum, cavity AO by minimum. The cutter is applied AFTER lip expansion, so a later lip cannot refill previously cut space. Across overlapping physical caches combine the sampled cutter minima and envelope maxima before the operation. This is a NEW authored visual model; do not promise bit parity with the current sequential smax/Gaussian wounds.

Only after flesh damage apply the existing bone/organ handling. Preserve the pre-wound flesh value needed by the tissue ramp. Cached mask contributes to nearWound, material selection and shadow gating; do not remove analytic wounds without replacing those consumers.

The bake must supply a conservative interpolation/quantization error and gradient bound in the runtime manifest. Texture samples are not automatically exact distance. Derive bounds from trilinear corner differences plus quantization, and account for composition with the lip. Keep raw field values for surface/material decisions, and a SEPARATE safe distance for advancing march/cone/shadow rays. Do not divide the field and feed that scaled value into the existing AO/material thresholds.

Record and test safety against a dense CPU reference, including the previously identified default-omega deep crossing on a raised lip. Never raise relax above 1.0 to hide a slow candidate. If safe tracing is prohibitively expensive, record NO-GO rather than weakening correctness.

Include the base flesh field's gradient bound and transforms in the safe-advance calculation; a cutter-only bound is insufficient. All proxy bounds and first-hit accelerators must include the outward lip and use compatible geometry. A stale intact hull or cone result must not skip new flesh. If an accelerator cannot be made conservative in this prototype, disable it in BOTH matched comparison legs and report that configuration separately from shipping defaults.

## 6. Event updates and playback

Offline bake a library of compact stamp volumes with manifest, bounds, gradients, variant and stage metadata. At an impact:
1. Select recipe/variant/stage and compute the stamp transform in its owner's cache frame.
2. Batch same-frame pellets before touching cache data.
3. If playback is active, materialize its current interpolated field as the new source ONCE.
4. Build new target by combining the PREVIOUS TARGET with all new stamps. This preserves pending and committed wounds.
5. Upload changed cache data, set transition start and play a deterministic 160 ms cubic ease-out.
6. Once settled, query target only; no per-frame re-bake or history replay.

This two-endpoint field transition plus the existing physical flinch is phase-0 canned deformation playback. It is intentionally bounded, not a general animation editor. The visible tear/lip motion must be judged; if it merely fades in, do not call the animation gate passed. Additional keyframes require a separate measured extension, not an implicit scope increase.

Preserve source and target versions, merge multiple hits deterministically, and account for the latest queued updates before a new shot. CPU brick updates are the initial path, confined to affected voxel ranges. Full texture uploads caused by three's Data3DTexture are allowed for the first proof ONLY if measured and included in impact spikes; do not claim partial GPU uploads just because CPU work was localized. If the impact gate fails, task 5 includes a narrowly scoped GPU dirty-brick update option.

## 7. Shading modes and causal comparison

Candidate first retains dynamic wound shadow, normal, AO and scatter probes using the NEW field. This isolates replacing the wound loop from deleting shading.

A second explicit option uses cached cavity AO/tissue metadata and disables the dynamic wound-shadow ray ONLY for cache-owned wounds. Ordinary limb/burn shadows remain. Name this mode baked-cavity, not equivalent-shadow: ambient darkening does not track a moving flashlight's cast shadow. Do not multiply full baked darkness and the old wound shadow together by default.

Compare:
- analytic: existing geometry and shading;
- cached-dynamic: new field with dynamic shadow;
- cached-cavity: same cached field with authored cavity shading.

No normals/scatter/global illumination rewrite in this program. Both candidate legs keep the same cache content, resolution and hit sequence.

## 8. Gameplay and lifecycle

Opt-in feature, default OFF. Preserve existing Wound records for damage accounting, recoil and sever decisions. Distinguish cache-owned visual wounds from analytic fallback wounds during upload, so supported wounds do not pay twice. Keep an immutable prototype impact log for replay/reset; do not depend on the 16-entry wound ring to retain persistent cache state.

Use the same cached field/transforms at projectile hit tests and surface aim for the candidate actor. Bleeding attaches to the actual resulting surface, not an intact face behind a visible hole. Existing sever gameplay remains authoritative, but collision/render mismatch must be recorded and cannot pass. Source frame -> posed world -> severed chunk must preserve damage. When a piece detaches, transfer or share the appropriate cache state with an explicit lifetime reference. Do not silently resurrect flesh by switching a cached piece to pristine analytic geometry. If a clean transfer is not ready, the prototype must report that lifecycle gate as FAIL and remain disabled.

Burns and limb hits remain analytic. Unsupported anatomy/assets/effects explicitly use the baseline, with fallback counts in the report. Keep data readiness checks before suppressing analytic upload. Avoid async first-hit loss and zero-count stale texture state. Reset/disable disposes caches after safe GPU use, clears masks, and restores the baseline upload from records/replay. Off/on/off tests must show no resource growth or stale cuts.

## 9. Visual reel and measurement

REQUIRED reel, fixed cameras and labeled modes:
- Head plus main torso in frame; isolated head inset/detail camera.
- Torso-heavy camera: >=50% intact framebuffer flesh coverage, >=35% torso area; frame includes torso boundaries rather than camera-inside crop.
- 1, 4, 8, 16 impacts; repeated same zone; front+side and upper+lower combinations; boundary hit.
- Turning 90/180 degrees, walking, impact flinch and settling; move flashlight across a cavity.
- Neck/shoulder seam impacts and a sever carrying a damaged part.
- Bone/organ exposure and no return of previously removed tissue.
- Actual playback frames at 0/40/80/120/160/320 ms.

Do not require new damage pixels to match analytic wounds. Require off-mode parity, correct attachment/interiors, persistent damage, and owner acceptance of the intended authored look. Capture CPU/GPU diagnostic fields separately from artistic beauty frames.

Timing:
- Reuse scripts/sdf-game-closeup-bench.mjs staging; task 1b's scripts/lib/sdf-closeup-stage.mjs is currently running elsewhere, so re-read current main at execution and import it if merged. Do not copy stale staging or await an unmerged helper implicitly.
- 1280x800 CSS/deviceScaleFactor 1 staging; SDF scale fixed 1.0; record actual SDF target dimensions and capped post-AA content size.
- Separate one-actor no-blood geometry tests from effects-on end-to-end tests.
- Freeze only the settled microbenchmark; keep rig/time alive for animation and gameplay legs.
- Fresh page and replay identical impact script each leg; minimum five balanced/rotating interleaved repetitions; record machine load and actual configuration.
- The existing throughput result is chunk-mean latency, NOT per-frame p95. Use it for paired throughput. Capture normal frame intervals and GPU timestamps when reliable for frame-time p95; fenced spike ratios are supplementary and not interchangeable with ordinary frame timings.
- Report p50/p95/p99/max, sample count, repeat spread, impact frame/settled segments, coverage, body/zone/cache/legacy-wound counts, bytes allocated/uploaded, update CPU time, texture fetch/field-probe counts where measurable.
- Census and hit-surface diagnostics must prevent an empty or less-damaged scene from looking faster. Match intended damage extent; report measured screen coverage/removed-area differences rather than treating different holes as perfect work equality.

Timing is DEFERRED if other heavy work prevents repeatability; do not turn noisy results into PASS. The prototype can be a valid negative result.

## 10. Current-state warnings and non-goals

The old texture-distance decay was scene fog. Fixed on main in 8da0bdd (material.fog=false on numeric prepasses). Do not reopen it. Numeric data passes for this experiment also disable fog, tone mapping, color conversion and blending and prove a distance round-trip.
The frozen-from-boot missing-hull issue is also fixed there; retain its regression coverage.
Other closeup/post-hit/goo work is active in parallel. Tasks rebase on current main and explicitly reconcile shared march/game seams; never overwrite unrelated fixes.

No changes to src/sim or src/game; prototype stays under src/lab/sdf-zombie and scripts. No new anatomical cluster IDs, global limit increases, global noise changes, adaptive resolution, per-frame extraction, whole-character draft tooling or full corpse system. No automatic default flip, merge or dispatch of follow-up projects.

## 11. Delivery and stop gates

Six sequential dispatch tasks: fixture/contracts -> baker and state -> GPU field -> actor/lifecycle -> art and shading -> verdict.
Task 3 may stop with a numerical/memory NO-GO; task 4 may stop with a motion/lifecycle NO-GO. Dependents read the gate record and record skipped-by-gate without implementing further features if a prerequisite failed.
Final outcomes: PASS-CANDIDATE (requires owner look approval), LOOK-ONLY, NO-GO, or TIMING-DEFERRED. All leave the shipping default OFF.
