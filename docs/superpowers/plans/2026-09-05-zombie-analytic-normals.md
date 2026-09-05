# Zombie Analytic Normals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Dispatch workers execute only their assigned task and read the complete shared contract and spec first.

**Goal:** Demonstrate a default-off zombie normal path that reduces post-hit field work while preserving wet highlights, skin detail and wounds, with explicit legacy fallback and an honest gameplay performance verdict.

**Architecture:** Compute scalar values and unnormalized geometric gradients together at the final hit only. Start with the zombie's common capsule/sphere operations and production blends; preserve detail with a cheap noise-only stencil under a certified stable rest-frame owner. Extend to current procedural wounds, then measure the complete implementation. Unsupported or ambiguous samples use the complete existing normal method.

**Tech Stack:** Existing TypeScript, Vitest, Three WebGPU/TSL/WGSL, Node test runner, Vite/CDP lab harnesses. No new runtime dependency or general automatic-differentiation framework.

**Spec:** `docs/superpowers/specs/2026-09-05-zombie-analytic-normals-design.md` — owner approved 2026-09-05; read it before execution.

## Global Constraints

- Zombie first, with fallback. Full Blobforge primitive coverage is not an initial requirement.
- Default off; no changes to `src/sim` or `src/game`, no alteration of wound gameplay, scalar tracing rules or shipped material tuning to mask errors.
- Calculate gradients after the hit only. Primary, cone and shadow traversal remain scalar.
- Carry unnormalized gradients through transforms/composition and normalize only at the final normal.
- Preserve the actual rendered scalar field, its fold order, effective `4*k` blend width, noise and rest-frame semantics. Exact derivatives do not imply identical finite-stencil appearance.
- Preserve skin detail from the first integrated candidate. Screen-space derivative normals and nearest-primitive normals are not this implementation.
- Keep fallback coverage, reasons and cost visible in intact AND wounded scenes.
- No fixed millisecond promise; require a repeatable net win beyond paired-run variation and no material regression in supported gameplay cases.
- Owner visual acceptance remains necessary before default enablement. Do not auto-enable, merge, push, or dispatch follow-up projects.
- Keep the current wound-cache chain independent. Cache mode initially uses legacy normals. Cache-gradient integration and reduced-rate AO/scatter are deferred follow-ups, not tasks in this chain.
- Reconcile current main, especially active edits to `march.wgsl.ts`, `zombie-gpu.ts` and `game-main.ts`; preserve wound-clutch removal, hit batching and wound step 1.0.
- Use an isolated worktree; do not modify another task's checkout or stop its processes. Read DualMem through the shared launcher; check cochange before edits and save findings with file associations.
- Actual WebGPU compilation/readback is mandatory. Tests of WGSL strings alone cannot validate gradients.
- Targeted tests only; one owned browser/device at a time. No full-repository Vitest suite or parallel browser/test load. Expensive GPU checks wait for load1 <=12; performance requires stable paired legs and records load at both ends. Do not consume hours in wait loops: checkpoint unresolved work and report it.
- A failed correctness gate stops dependent feature work. Task 5 still writes a negative/incomplete verdict. Missing or deferred gates never count as passes.

## Dependency and review boundaries

Five serial tasks: **1 mathematical contract → 2 GPU kernel proof → 3 intact/detail integration → 4 procedural wounds → 5 gameplay verdict**. Each produces an independently reviewable artifact/commit. Retain the previous task branch as the next task's implementation base. Do not use `queued` as a dispatcher status: future dispatch preparation must use the runtime's actual supported states and preserve `depends_on`.

The work may be prepared while wound-cache tasks run, but execution of shared-file edits must be coordinated. Do not assume their unmerged implementation exists or change that chain's dependencies automatically.

## Shared files, types and evidence contract

Task 1 creates `src/lab/sdf-zombie/webgpu/normal-gradient-reference.ts` with these exports. Vectors at this diagnostic boundary are tuples; adapt existing project Vec3 objects rather than changing project types.

```ts
export type V3 = readonly [number, number, number];
export type NgReason = 'ok' | 'unsupported' | 'degenerate' | 'hard-boundary'
  | 'owner-unstable' | 'wound-pending' | 'sampled-cache' | 'inactive';
export interface Dg { d: number; g: V3; reason: NgReason }
export interface CapsuleInput { a: V3; b: V3; r: number; scale: V3 }
export interface WoundInput {
  center: V3; depth: number; cap: number; inward: V3;
  blend: number; rimPosition: number; rimWidth: number; rimAmp: number;
}
export function capsuleGradient(p: V3, s: CapsuleInput): Dg;
export function smoothMinGradient(a: Dg, b: Dg, kIn: number): Dg;
export function smoothMaxGradient(a: Dg, b: Dg, kIn: number): Dg;
export function finiteGradient(f: (p: V3) => number, p: V3, eps: number): V3;
export function detailGradient(f: (p: V3) => number, p: V3, eps: number): V3;
// Added by Task 4; the base argument is the pre-wound flesh value/gradient.
export function woundGradient(base: Dg, p: V3, wounds: readonly WoundInput[]): Dg;
```

`WoundInput` holds already-resolved per-wound parameters, not a replacement GPU packing layout. `rimWidth` is the actual metre-valued denominator after the production max guard, `rimAmp` includes burn/profile factors, and `rimPosition` is the radial centre of the lip. The Task 4 adapter derives these from real uploaded rows/uniforms.

Task 1 also creates `scripts/lib/normal-gradient-gates.mjs` with `readNormalGates(path)` and `writeNormalGates(path, patch, evidence)`. Both preserve unrelated fields; writes use temp-file plus rename. Gate path: `docs/dev-notes/2026-09-05-zombie-analytic-normals/gates.json`.

```json
{
  "version": 1,
  "reference": "pending", "gpuKernel": "pending", "intact": "pending",
  "wounds": "pending", "visualEvidence": "pending", "timing": "pending",
  "ownerLook": "pending", "evidence": []
}
```

Gate values: `pending`, `pass`, `fail`, `deferred`, `skipped-by-gate`. Every write appends `{commit, command, artifact, reason}`. Only the owner can set `ownerLook: pass`. Keep small numerical summaries and representative images in Git; large recordings/raw probe arrays may live at explicitly recorded artifact paths.

Task 2 introduces `normal-gradient.wgsl.ts`, exporting `NORMAL_GRADIENT_HELPERS` in the existing helper registration pattern. GPU value/gradient convention is **vec4(distance, gradient.xyz)**, not a unit normal. Helper signatures are `ngCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32, scale: vec3<f32>) -> vec4<f32>`, `ngSmin(a: vec4<f32>, b: vec4<f32>, kIn: f32) -> vec4<f32>`, and `ngSmax` with the same signature as `ngSmin`. Local validity is carried by `gNgReason` with integer values in the order of `NgReason` above. Reset it at each top-level diagnostic/evaluator call; do not overwrite the march's fold-owner globals. Put any private declarations after the first function in a helper source where required by the current three parser.

Task 2 creates `webgpu/normal-gradient-probe.ts` for an isolated real-GPU diagnostic page, `normal-gradient-check.html` at repo root, and `scripts/zombie-normal-gradient-check.mjs`. The driver accepts `--phase kernel|intact|wounds|verdict`, `--out PATH`, `--vite PORT`, `--cdp PORT`. `kernel` uses the isolated page; subsequent phases use `sdf-game.html`. Default ports come from the existing lab helper environment. All modes produce JSON evidence, close their owned page in `finally`, exit nonzero on missing data or failed assertions, and cannot mark owner acceptance.

Task 3 adds an optional per-view uniform `normalGradientCfg` (x mode 0 legacy /1 hybrid, y diagnostic 0 beauty /1 normal /2 eligibility, z/w reserved zero). Do not reuse packed `perfCfg` slots. Game diagnostic API:

```ts
// Added to the existing __sdfGame debug API; mode changes reach live views.
setNormalGradient(mode: 0 | 1): void;
setNormalGradientDebug(mode: 0 | 1 | 2): void;
normalGradientStatus(): {
  mode: 0 | 1; diagnostic: 0 | 1 | 2;
  supportedBodies: number; legacyBodies: number;
};
```

Eligibility images encode the final reason per hit, with background distinct from `ok`. Count analytic/fallback pixels from this diagnostic pass at fixed resolution; performance measurements use beauty mode without diagnostic atomics/readbacks. Unsupported actor state can bypass the gradient fold entirely. Per-pixel fallback within an otherwise supported actor is decided by the fold without four extra scalar eligibility queries.

---

### Task 1: Establish derivative rules and the real zombie support inventory

**Files:**
- Create: `webgpu/normal-gradient-reference.ts`, `webgpu/normal-gradient-reference.test.ts` under `src/lab/sdf-zombie/`.
- Create: `scripts/lib/normal-gradient-gates.mjs`, `scripts/lib/normal-gradient-gates.test.mjs`.
- Create: evidence directory `inventory.json`, `gates.json`, `notes.md`.
- Read under `src/lab/sdf-zombie/`: `characters/zombie.blob`, `blob-compile.ts`, `build-body.ts`, `types.ts`, `pack.ts`, `validate.ts`, `webgpu/march.wgsl.ts`.

**Interfaces:** Produces all shared types and reference helpers except `woundGradient`, plus the gate helpers. No runtime renderer edits.

- [ ] Load current project/infra memory, inspect current main and resolve the existing compile/build fixture from `characters/zombie-blob.test.ts`. Record actual compiled primitive/profile counts by flesh, carve and internal rows. Include real posed orientations and identify generated face primitives. Do not assume the authored bars are the whole body.
- [ ] Write failing tests for point/sphere and capsule gradients, anisotropic scales and production smooth min/max. Use the production scalar helpers as the oracle, adapting to project Vec3. Include a known-answer unit sphere test:

```ts
const s = { a: [0,0,0], b: [0,0,0], r: 1, scale: [1,1,1] } as const;
const x = capsuleGradient([2,0,0], s);
expect(x.d).toBeCloseTo(1, 12);
expect(x.g).toEqual([1,0,0]);
expect(capsuleGradient([0,0,0], s).reason).toBe('degenerate');
```

- [ ] Implement the untapered scalar expression and derivative. For `q=p/scale`, endpoints transformed identically, closest point `c` on the segment and `v=q-c`, use `d=(length(v)-r)*minScale` and `g=(v/length(v))/scale*minScale`. Handle zero-length segments as points before dividing. Invalid scales and nonfinite inputs are rejected at the diagnostic boundary. Zero-length gradients trigger fallback, never `normalize(0)`.
- [ ] Implement smooth min with the exact production convention and no intermediate normalization. Core rule for constant positive k is:

```ts
const k = 4 * kIn;
const h = Math.max(k - Math.abs(a.d - b.d), 0) / k;
const wa = a.d <= b.d ? 1 - h / 2 : h / 2;
const d = Math.min(a.d, b.d) - h * h * k / 4;
const g = a.g.map((x, i) => wa * x + (1 - wa) * b.g[i]) as unknown as V3;
```

For k<=0, select the smaller branch, classifying a tie as `hard-boundary`. `smoothMaxGradient(a,b,k)` negates inputs and output around smooth min. Propagate invalid reasons if that branch contributes; prove any ignored invalid branch is outside support before discarding its reason. Preserve fold order.
- [ ] Add oriented tests by applying the actual world-to-primitive transform to points/endpoints and its Jacobian transpose to gradients. Test nonunit gradient magnitudes before combining shapes; normalizing too early must fail a constructed anisotropic blend test.
- [ ] Implement independent central differences and the tetrahedral detail stencil. For sign vectors `s` in `{(1,-1,-1),(-1,-1,1),(-1,1,-1),(1,1,1)}`, detail gradient is `sum(s*f(p+eps*s))/(4*eps)`. Verify this recovers the gradient of `f(p)=2px-3py+4pz`.
- [ ] Compare deterministic smooth points using eps 1e-3, 5e-4, 2.5e-4 metres, and adversarial points near joins/axes. Record convergence, scalar error and gradient error; keep named singular cases rather than removing them. Reference scalar tests use existing functions, not merely the new Dg.d output.
- [ ] Test atomic gate updates and preservation with Node's runner. Run `npx vitest run src/lab/sdf-zombie/webgpu/normal-gradient-reference.test.ts`, `node --test scripts/lib/normal-gradient-gates.test.mjs`, and `npx tsc --noEmit` under suitable load. Set `reference: pass` only on evidence; commit as `test(lab): establish zombie normal gradient reference`.

### Task 2: Prove the GPU derivative kernels independently

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts`, `normal-gradient.wgsl.test.ts`, `normal-gradient-probe.ts`.
- Create: `normal-gradient-check.html`, `scripts/zombie-normal-gradient-check.mjs`.
- Update: evidence `gates.json`, `notes.md`, `kernel.json`.
- Read: current `zombie-gpu.ts` helper registration and existing numeric readback harnesses.

**Interfaces:** Consumes Task 1 reference and gate helpers; produces WGSL helper exports and driver `--phase kernel` from the shared contract. No `MARCH_BODY` or gameplay changes yet.

- [ ] Require `reference: pass`. Add tests that feed sphere, capsule, nonuniform-scale, rotated and blend fixtures to the new helper registration. Observe the missing implementation fail before adding kernels.
- [ ] Translate the Task 1 operations to WGSL, with vec4 value/gradient returns and explicit fallback reason. Register each function through the existing `wgslFn` dependency pattern. No parentheses/colon in signature comments, no unsupported argument packing, no repeated helper declaration in generated modules.

```wgsl
// Core scalar-to-gradient combination; K and h follow production smin.
let wa = select(h * 0.5, 1.0 - h * 0.5, a.x <= b.x);
return vec4<f32>(min(a.x, b.x) - h * h * K * 0.25,
                 wa * a.yzw + (1.0 - wa) * b.yzw);
```

- [ ] Build the isolated diagnostic page using the real Three WebGPU backend. Render/read back `distance,gx,gy,gz`; use a separate diagnostic channel/pass for reason codes. Disable fog, tone mapping, blending and color conversion on numeric outputs. Require a WebGPU backend, nonempty result arrays, finite values and a clean shader console.
- [ ] Compare GPU kernels to CPU known answers and scalar-oracle finite differences. For smooth CPU/GPU derivative comparisons use `abs(error)<=2e-3 + 1e-2*abs(reference component)` and scalar `abs(error)<=5e-5 + 1e-4*abs(reference distance)` as initial acceptance tolerances. These are numerical tolerances, not a ray-distance safety proof. Report each named case; unsupported/singular cases must explicitly fall back, not return zero vectors and pass.
- [ ] Add a negative control: deliberately negate an output gradient component in the diagnostic configuration and require the driver to fail. This proves values are actually sampled and checked. Do not ship a mutation into production kernels.
- [ ] Run the two targeted reference/kernel suites, tsc, and `node scripts/zombie-normal-gradient-check.mjs --phase kernel --out /tmp/zombie-ng-kernel` via owned lab servers. Save actual arrays plus a numeric visualization; set `gpuKernel: pass` only after real readback succeeds. On failure record it and stop dependent feature work. Commit `feat(lab): verify analytic normal kernels on WebGPU`.

### Task 3: Integrate intact flesh gradients with preserved detail and fallback

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts`, its tests, `march.wgsl.ts`, `march.wgsl.test.ts`, `zombie-gpu.ts`, `game-main.ts`.
- Create: `src/lab/sdf-zombie/webgpu/normal-gradient-support.ts`, `normal-gradient-support.test.ts`.
- Modify only if necessary: `game-actor.ts` to propagate the mode to newly created actor/chunk views.
- Extend: `scripts/zombie-normal-gradient-check.mjs` with `--phase intact`; evidence `intact.json` and gate.

**Interfaces:** Produces `normalGradientCfg`, game debug API and final-hit evaluator `ngBody`, taking the same field resources as `mapBody`. `ngBody` returns vec4 scalar/gradient, sets `gNgReason`, and uses its own owner/candidate state. `normal-gradient-support.ts` exports `classifyNormalSupport(body: Body): { commonFlesh: boolean; reasons: NgReason[] }` with Body imported from `validate.ts`. It is a coarse capability summary, not permission to skip local checks.

- [ ] Require `gpuKernel: pass`. Add failing tests for mode off, unsupported actor fallback, internal curved bones not globally rejecting intact flesh, future actor/chunk mode propagation, and guard preservation. Add a check that primary/cone/shadow scalar functions do not call the new evaluator.
- [ ] Implement final-hit value/gradient folding for supported untapered primitives and smooth unions. Preserve scalar op ordering and support all relevant contributing primitives. Use existing culls only with the same proof/fields as production; unsupported or uncertain skipped contributors invalidate the candidate unless a conservative bound excludes them. Do not rewrite scalar `mapBody` to add gradients to every query.
- [ ] Establish detail-owner stability over the existing tetrahedron radius `sqrt(3)*0.0015`. For supported scaled capsules, verify their scalar Lipschitz bound (<=1 under the current minScale convention) and require competitor distance gaps greater than the sum of the two bounds times that radius. Culled groups need a bound proving their candidates cannot become the winner anywhere in that neighborhood; otherwise reason `owner-unstable`. Track candidates within the required fold, not four extra full field calls. Unit tests place an ownership boundary just outside and just inside the stencil.
- [ ] Initially reject points whose stencil neighborhood can be influenced by active procedural wounds, unsupported carves/internal geometry or sampled-cache mode. Use conservative support, not just the current hit material. Preserve enough per-region eligibility to accelerate intact flesh on an actor that also has a wound. Classify each fallback reason in the eligibility diagnostic.
- [ ] Preserve the normal-only detail using the Task 1 noise stencil. At each offset transform through the same stable owner's `restPoint`, multiply by the actual normal noise amplitude and use the production fbm frequency. Core composition is:

```wgsl
// eps=0.0015; ng.yzw is not normalized. detailG is noise-only stencil / (4*eps).
let candidate = ng.yzw + detailG;
// Only after validity, owner and finite/nonzero checks:
n = normalize(candidate);
```

Keep the later `surfCfg2` microdetail perturbation and face bump in their existing order, exactly once. Do not confuse those later effects with the noise already inside legacy `calcNormal`.
- [ ] Add the default-off uniform and API without stealing packed uniform slots. For invalid candidates execute the original complete `calcNormal` call. Protect private fold state used later in shading: the new query cannot change hit metadata or cause eligibility/debug queries to clobber production globals. Every shader variant and detached-piece material must bind a valid default.
- [ ] Extend the driver to compare identical hit depth/positions with mode 0 and mode 1, numeric base normals, final beauty and eligibility masks. Include scaled/rotated animated flesh, a real intact torso/head and a wounded actor with intact surrounding skin. Confirm unsupported cases use the legacy result. Do not infer real performance from a standalone sphere.
- [ ] Run targeted support/gradient/march tests, tsc and actual `--phase intact`. Save a short moving-light/body reel with noise, gloss and metal suppression at shipped settings. Record analytic/fallback pixels for head, torso and whole body. Set `intact: pass` only on correctness and usable coverage evidence; owner look remains pending. Commit `feat(lab): add zombie analytic normals with detail fallback`.

### Task 4: Extend the evaluator to procedural wound surfaces

**Files:**
- Modify: `normal-gradient-reference.ts` and tests, `normal-gradient.wgsl.ts` and tests, `normal-gradient-support.ts` and tests, `march.wgsl.ts` only at the normal integration seam if needed.
- Extend: `scripts/zombie-normal-gradient-check.mjs` with `--phase wounds`; evidence `wounds.json` and gate.
- Read: current `applyCarves`, `applyWounds`, `applyBones`, wound row packing and `damage.ts`; do not alter those production scalar operations.

**Interfaces:** Implements `woundGradient` from the shared contract and extends `ngBody` without changing its result convention or mode API. Unsupported bent/tapered internals and cache fields retain legacy fallback; this task must not expand to every Blobforge primitive.

- [ ] Require `intact: pass`. Write oracle tests for sphere/slab cutters, multiple ordered wound blends, burn parameters, rim support, radius degeneracy, cap corners, and hard boundaries. The independent scalar oracle must include the actual production wound equations; current `sdBody` alone does not include the uploaded runtime wound loop.
- [ ] Implement the cutter gradient and smooth max using the existing formulas. For cutter `min(depth-r, cap-dot(p-center,inward))`, the sphere gradient is `-(p-center)/r` and the slab gradient is `-inward`; ties and r=0 are explicit fallback cases. Differentiate supported ordinary subtractive primitives through the same fixed carve order, preserving blend widths. Other subtractive profiles remain fallback.
- [ ] Include BOTH terms of the rim product derivative. With `bump=amp*exp(-x*x)`, `x=(r-rimPosition)/rimWidth`, and `m=1-smoothstep(-0.3*amp,0.7*amp,base.d)`, the rule is:

```text
grad(d - bump*m) = grad(d) - m*grad(bump) - bump*grad(m)
grad(bump) = bump*(-2*x/rimWidth)*(p-center)/r
u = clamp((base.d + 0.3*amp)/amp, 0, 1)
grad(m) = -(6*u*(1-u)/amp)*base.g  inside the smoothstep interval; 0 outside
```

`base` stays the ORIGINAL pre-wound flesh across the wound loop, matching production `dIn`; do not substitute the evolving damaged d. Handle amp=0 before division. Add a test where the radial bump derivative is near zero but the flesh-gate derivative is nonzero, so omission of the second term cannot pass.
- [ ] Preserve internal-field participation. Differentiate supported straight internal capsules where useful; if a curved bone/organ can affect the result, return the legacy normal. Never skip skeleton evaluation to manufacture a saving, nor invalidate all intact flesh because such primitives exist. Handle bare-bones/melt states conservatively with explicit unsupported fallback.
- [ ] Prove detail ownership around exposed bone/flesh switches or fall back. The owner selected by a bone winning against damaged flesh is not the same as the nearest additive primitive. Preserve this rule and the noise sample neighborhood; do not reuse Stage 3's flesh-only certificate blindly.
- [ ] Compare production WGSL scalar+gradient against independent CPU finite differences over several epsilons, keeping unsupported and hard-boundary results visible. Use actual wounds on head and torso, repeated/overlapping impacts, fresh rim and capped floors. Include an exposed curved rib case that must fall back and a supported crater wall case that must accelerate.
- [ ] Run targeted suites, tsc and `--phase wounds`. Capture full-rate slug impact, stagger, moving light and dismemberment; record region coverage and fallback reasons before/after each event. Verify depth/hit positions and fallback output remain unchanged. Set `wounds: pass` only with real evidence; otherwise record fail/deferred and preserve the experiment for Task 5's report. Commit `feat(lab): differentiate procedural wound normals`.

### Task 5: Measure the complete candidate and deliver the verdict

**Files:**
- Extend: `scripts/zombie-normal-gradient-check.mjs` with `--phase verdict` and paired performance collection.
- Create: `docs/dev-notes/2026-09-05-zombie-analytic-normals/verdict.md`, `summary.json`, small representative images/reel index.
- Update: `gates.json`, `notes.md`, `TASKS.md` (coarse result only).
- No new geometry or shading feature work in this task.

**Interfaces:** Consumes mode API, eligibility output and previous gates. Produces verdict JSON `{commit, gates, scenes, timings, coverage, artifacts, conclusion}`. A conclusion is `candidate-for-owner-review`, `no-go`, or `incomplete`; it is never automatic shipping approval.

- [ ] Read every gate and its evidence. If a prerequisite failed or is missing, write a negative/incomplete report with exact reasons and skip dependent performance claims. A completed dispatch worker is not proof that its feature passed.
- [ ] Build one-page paired fixtures from current staging exports: intact head/torso, wounded head/torso, the actual two-body close-up with surrounding actors, walking/flashlight motion, impact/stagger/sever sequence, and an unsupported-character/control scene. Record camera, pose seed, SDF target size, actual visible/target coverage, count of bodies and active flags. Do not silently weaken a coverage target as happened in the wound-cache fixture.
- [ ] Check mode-off parity and same-state fallback parity, and compare hit depth/positions separately from beauty. Pin fire flicker and simulation inputs for numerical/image comparisons. Require visible normal detail and highlights in the captures; flat-albedo or zero-noise diagnostics alone cannot pass `visualEvidence`.
- [ ] In beauty mode, alternate legacy/candidate order across at least five paired repetitions per scene, with >=240 measured frames per leg after warmup. Record load before/after each leg; reject a pair if load1>12 or changes by >4, and retain rejected records separately. Cap replacement attempts at three, then mark timing deferred rather than averaging through contention. Compare within-pair differences as well as aggregate p50/p95/p99. Label fenced throughput measurements separately from unfenced frame intervals; use GPU timestamps only if validated for this renderer.
- [ ] Capture eligibility in separate untimed passes for the same fixtures. Report whole-body, head, torso and wound-region analytic/fallback pixel shares, plus failure categories. Never claim a fourfold saving by dividing field call counts: gradient ALU/register pressure, fallback overhead and all other frame costs remain.
- [ ] Report impacts and settled frames separately. Test the feature on unsupported scenes to quantify fallback overhead; a branch that mostly falls back and is slower is a failed optimization even if normals are correct. If scalar/gradient helper registration increases shader compile cost, record it instead of hiding it in warmup.
- [ ] Set `visualEvidence` and `timing` only from their own evidence, keep `ownerLook: pending`, and write a concise verdict: measured changes, coverage, what preserved the look, what still falls back, regression cases and recommended next action. Add the separate AO/scatter cost measurement and optional cached-field gradient bridge as future work, not completed claims.
- [ ] Run targeted driver/gate tests and tsc only if changed code warrants it; do not repeat the full test matrix without a reason. Save final memory with file associations and a user-facing Obsidian summary. Commit `docs(lab): report zombie analytic normal verdict`. Leave the feature default off for owner review.

## Plan self-review

Coverage: approved common geometry/detail, procedural wounds, fallback, numeric/visual/performance gates and shared-file coordination are represented by Tasks 1–5. Optional cache integration and AO/scatter remain separate as approved. Shared API/type names are defined above and consumed consistently; no unavailable historical capture script is a dependency. Numerical tests use an independent scalar oracle and actual GPU execution; fallback coverage cannot substitute for a scene performance result. Ownership changes, pre-wound rim derivatives, nonunit gradient magnitudes and the finite-stencil appearance difference are explicit.
