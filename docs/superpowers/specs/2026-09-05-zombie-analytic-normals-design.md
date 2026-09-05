# Zombie analytic normals — approved design

Date: 2026-09-05. Status: owner approved the design ("yes lgtm"), including **zombie first, with fallback**. Implementation has not started and no new dispatch has been requested. Planning inspection baseline: main `b268695`; execution must inspect current main and active wound-cache work again.

## Objective

Reduce the cost of the zombie's post-hit normal calculation while retaining its silhouette, wet highlights, skin texture and wound readability. Determine whether computing geometric gradients directly is cheaper than four full field samples on the real wounded close-up scene.

The first output is a default-off, measurable prototype with a reliable legacy fallback. Full Blobforge primitive coverage is not an initial requirement. AO/scatter work is a separate experiment and does not block this one.

## What is analytic, and what remains approximate

The current normal is a finite-difference estimate: evaluate the field at four positions around the hit and infer its slope. At differentiable points, the new path computes the gradient of the implemented scalar field through derivative rules. This is not an average of nearby primitive normals, and it need not simplify the surface.

For a sphere, `d(p) = length(p-c)-r` and its gradient is `(p-c)/length(p-c)` away from the center. Scaled capsules and blends need additional derivative rules. The field may itself be a distance estimate rather than an exact Euclidean SDF; differentiate the field actually rendered, not a substituted ideal shape.

Carry the unnormalized gradient and scalar value together through composition. Normalize only at the final normal. Nonuniform transforms require the chain rule, and the scalar distance scale must also scale the gradient. Normalizing individual gradients before blending loses their magnitudes and changes the resulting direction.

Analytic point gradients are not guaranteed to look identical to the existing 1.5 mm finite stencil: that stencil has its own spatial averaging and truncation error. Mathematical agreement and owner visual acceptance are separate gates. At hard joins, centers, degenerate configurations or unstable detail ownership there may be no unique smooth gradient; use the existing normal calculation rather than inventing a direction.

## Approach selection

Recommended: a hand-authored value-and-gradient shader path for the existing zombie's common operations, invoked only after a primary hit. Use selective legacy fallback for unsupported or ambiguous cases.

Alternatives:

- Nearest-primitive normals or unit-normal blending: cheap, but changes the blended surface's shading. Not the selected approach.
- A general automatic-differentiation compiler/framework for all Blobforge operations: potentially broad coverage, but introduces tooling and code-generation work before this optimization has demonstrated value. Not required for the prototype.
- Screen-space derivative normals: already visually rejected in the prior probe experiment; do not reuse that implementation and describe it as analytic field gradients.

## Code boundaries

Existing code to inspect:

- `src/lab/sdf-zombie/webgpu/march.wgsl.ts`: scalar primitive/blend/carve/wound functions, `foldGroup`, `mapBody`, `restPoint`, noise, `calcNormal`, and final-hit normal call.
- `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`: helper registration, shader variants and uniforms.
- `src/lab/sdf-zombie/webgpu/game-main.ts`: experimental toggle and reporting, including actor/chunk propagation patterns.
- `src/lab/sdf-zombie/characters/zombie.blob`, `blob-compile.ts`, `pack.ts`: actual authored and compiled operations, active flags, data layout and posed frames.
- `src/lab/sdf-zombie/validate.ts`: CPU scalar implementation for comparison; do not change collision semantics as part of this experiment.
- `scripts/closeup-woundcull-capture.mjs`, `scripts/lib/sdf-closeup-stage.mjs`, `scripts/lab-servers.sh`: reuse current staging and owned-resource cleanup patterns. The prior `closeup-probes-capture.mjs` exists only in earlier investigation history and is not a current-main dependency.

Proposed new modules:

- `webgpu/normal-gradient.wgsl.ts`: derivative helpers and final-hit gradient evaluator, kept out of the already large main shader string where feasible.
- `webgpu/normal-gradient-reference.ts` and associated tests: supported-operation CPU checks and independent finite-difference oracle support.
- `scripts/zombie-normal-gradient-check.mjs`: actual WGSL numerical readback and rendered A/B driver.
- `docs/dev-notes/2026-09-05-zombie-analytic-normals/`: coverage, numerical evidence, motion captures and performance verdict.

Detailed exported interfaces and task boundaries are in `docs/superpowers/plans/2026-09-05-zombie-analytic-normals.md`. Do not add a new Blobforge language feature, texture format or renderer subsystem merely to carry three derivative components.

## Stage 1 — common geometry, detail preserved

Inventory the compiled zombie, rather than assuming the authoring text lists every emitted primitive. Start with ordinary capsules, point/sphere degeneracies, anisotropic scaling, orientation and the production polynomial smooth min/max. Preserve production fold order and the effective `4*k` blend-width convention.

Evaluate gradients only for the final hit's shading. Primary, cone and shadow traversal remain scalar. Do not carry derivative vectors through every march step: that can spend more than the normal optimization saves. Initially call the gradient evaluator once after the existing marcher; reusing its final iteration is not a prerequisite.

Retain skin detail from the start. Two acceptable strategies to compare are:

1. Analytic geometric gradient plus a small finite-difference stencil of the **noise function only**, with correct gradient scaling and the existing rest-frame transform.
2. Analytic geometric and noise gradients, including the rest-frame Jacobian.

The first is the recommended visual-risk reduction: it keeps the current detail sampling footprint without four whole-body folds. It must not silently freeze the dominant primitive's detail frame where that identity changes across the stencil. Establish a conservative ownership-stability condition over the sample neighborhood, including culled candidates, or fall back there. Do not perform four full field queries just to decide whether four full field queries can be avoided.

Avoid a duplicate capability scan on every pixel: summarize immutable actor capabilities during packing where useful, and detect local unsupported contributions during the required fold. That summary must not reject every intact pixel merely because the actor contains curved internal bones.

Report both whole-body and head/torso pixel coverage for analytic versus fallback paths. A successful primitive demo with nearly all game pixels falling back is not a performance result.

## Stage 2 — current procedural wounds and internal surfaces

First preserve legacy normals in unsupported wounded regions and demonstrate Stage 1 in a mixed wounded scene. Then extend to the current sphere/slab cutter, smooth intersection and everted rim. A wounds-disabled statue is a useful diagnostic but cannot satisfy the original goal.

Important production dependency: the rim amplitude is gated by `rimLocal(dIn)`, where `dIn` is the pre-wound flesh value. Its derivative must include the incoming flesh gradient as well as the radial Gaussian derivative. Treating the gate as constant would omit a real contribution to the lip normal.

Preserve burn depth/amplitude cases, bounded wound reach, analytic fallback wounds, fold order and the near-wound/internal-surface rules. Discrete support and material-owner transitions need explicit testing; an apparently tiny scalar discontinuity can produce a visible specular seam.

The zombie's curved ribs and organs make complete internal-surface differentiation more involved. Retain the full legacy normal wherever an unsupported operation can affect the result. Support can expand after measured fallback coverage demonstrates its value. Do not assume only the single winning primitive matters inside a blend.

Fallback must produce the existing full normal, including detail, not partially mix an invalid gradient with a legacy unit normal. Record failure categories: unsupported operation, degenerate gradient, hard boundary, unstable detail owner, sampled-cache mode, and other explicitly identified cases.

## Stage 3 — visual and performance verdict

Use three separate comparisons:

1. Numeric correctness against the actual scalar field at identical fixed sample positions. Compare scalar outputs plus directional derivatives against an independent finite-difference oracle over several decreasing epsilon values. Test capsule interiors/endcaps, rotations/scales, blend boundaries, wound lips and slab corners. Separate nondifferentiable cases and verify their fallback behavior instead of hiding them in an average error.
2. Legacy versus candidate beauty renders, with production skin noise and wet highlights enabled. Stage the same actor/pose/camera/light in one page and pin flicker. Inspect close torso and head, moving flashlight, walking limbs, new slug wounds, overlapping wounds, dismemberment and exposed bones. Capture a motion reel, not only still-image differences. Separate point-gradient differences from bugs and from the legacy stencil's averaging.
3. Quiet-machine paired frame measurements on current shipping settings, fixed resolution and matched actor coverage. Include intact, wounded, two-body close-up and mixed unsupported-character cases. Record median and p95/p99, analytic/fallback coverage, gradient work and field-query counters. Include both normal-only diagnostics and complete-frame timing. Counter reductions alone do not establish a win.

The toggle-off path must preserve the current result. Compare hit positions/depth independently: changing the shading-normal calculation must not move geometry or change ray convergence. The legacy fallback should match the legacy result on identical inputs.

Reject a candidate that loses the wet surface read, causes shimmering/ownership seams, mostly falls back in the target scene, or adds more GPU cost than it removes. One gradient fold has extra arithmetic and live values, so four-to-one field evaluations is not a four-times rendering promise. Measure register/compile costs where tools expose them; a larger shader can regress even when counters improve.

No fixed millisecond promise is made. Require a repeatable net win beyond paired-run variation and no material regression in the supported gameplay cases. Owner visual acceptance remains necessary before default enablement.

## Stage 4 — optional wound-cache integration

Do not make the current baked-wound chain wait for analytic normals. Initially fall back when its experimental mode is active; the two experiments need independent verdicts.

If both succeed, differentiate the represented trilinear cached field from its cell values and compose that gradient with flesh, including source/target playback and frame transforms. This is not equivalent to blindly interpolating pre-normalized normal vectors. Slab boundaries and cell-gradient changes need close-up motion checks. Do not alter the cache's ray-advance safety bounds or silently change the scalar field to make normals look better.

Run a combined comparison; savings from two separate benchmarks are not additive by assumption. Any extra sampled-field texture loads belong in the combined cost.

## Separate AO/scatter investigation

Measure the costs of normal, AO and scatter separately before building a reduced-rate shading pipeline. Treat disabled-effect timings as diagnostic bounds, not shippable images. Keep scene resolution, actor coverage and the other effects fixed. The current default-off wound-shadow routine is not available savings unless the tested configuration actually enables it.

If the two broad lighting probes have enough measured cost, try reduced-rate AO/scatter with depth/normal-aware reconstruction while retaining full-rate normals and direct/specular response. Account for render-target traffic, the extra pass and filtering. Reusing an accurate full-rate normal buffer may itself require new output bandwidth; it is not free infrastructure.

This is a separate scope and can be scheduled later. It does not delay gradient feasibility, and its measurement artifacts should be reusable for that work.

## Execution safeguards and review

- Default off; no changes to `src/sim` or `src/game`, no alteration of wound gameplay, scalar tracing rules or shipped material tuning to mask errors.
- Preserve the removed wound-clutch behavior and reconcile newer main changes before editing shared shader files.
- Isolated worktree; serialize changes against active wound-cache integration where files overlap. Do not interrupt unrelated dispatcher work.
- Actual WebGPU compilation/readback is mandatory; WGSL string tests alone cannot validate this change.
- Targeted tests only under appropriate machine load; one owned browser/device at a time. Do not repeat the prior GPU-tab leak or spend hours waiting for performance conditions.
- Save unresolved evidence as pending or negative; do not weaken visual coverage, singular-case handling or fallback reporting to mark a task complete.

Self-review: proposal separates exact derivatives from look parity; supports the owner-selected zombie scope; explicitly preserves noise, incoming rim derivatives and nonunit gradient magnitudes; keeps wounded coverage and fallback cost visible; leaves AO/scatter and cache integration independent. No implementation has started.

Background on derivative propagation versus numerical differences: Baydin et al., [Automatic differentiation in machine learning: a survey](https://arxiv.org/abs/1502.05767). The implementation proposed here is a small set of explicit derivative rules, not adoption of a general AD framework.
