# Blud — SDF Lab on WebGPU — Design

**Date:** 2026-08-15
**Status:** design approved, pre-implementation
**Type:** side-quest infrastructure — continues `X1`, still **not** on the M6/M7 critical path
**Extends:** [2026-08-15-sdf-zombie-lab-design.md](2026-08-15-sdf-zombie-lab-design.md) · [2026-08-15-sdf-zombie-face-psx-design.md](2026-08-15-sdf-zombie-face-psx-design.md)

---

## 1. Context and intent

The SDF lab is fill-rate bound and it is now noticeably heating the development machine. Its cost is `pixels × march steps × field complexity`, and the face experiment demonstrated how sharply that bites: twelve extra primitives, each evaluated ~100 times per pixel, roughly doubled the head cluster's shader cost on their own.

Three structural limits are now in the way, and all three are WebGL2 limits rather than algorithmic ones:

1. **Uniform ceiling.** Primitive data lives in uniform arrays. `MAX_PRIMS = 48` already puts the fragment shader near 300 `vec4` against a GLES 3.0 guaranteed minimum of 224. Every future feature — a skeleton field, more primitives, rest-space data — competes for that space.
2. **No compute.** Every technique that would actually solve the crowd problem — polygonizing the field, GPU culling, a spatial acceleration structure — needs compute shaders. WebGL2 has none.
3. **No occlusion rejection.** The shader writes `gl_FragDepth` and calls `discard`, which defeat early-Z, so a zombie hidden behind a wall marches anyway.

### What this does NOT promise

**WebGPU will not automatically make the raymarcher faster.** Marching the same field at the same resolution costs roughly the same on either API; fill rate is fill rate. What migrating buys is *permission to use different algorithms* — storage buffers instead of a uniform ceiling, compute shaders instead of fragment-only work, real timestamp queries instead of a vsync-pegged meter.

This distinction matters because the honest state of the evidence is that **single-body cost has still never been measured**. The lab sits vsync-locked, and the instrumentation task from the face spec was deferred. Migrating in the hope of a speedup would be building on a number nobody has. Migrating to remove ceilings that are demonstrably in the way is a different and defensible reason.

### Why lab-only

The lab is firewalled from `src/sim` and `src/game` by construction, so it can carry a second renderer without the game noticing. This keeps a large, uncertain change away from the shipped product until the raymarcher is proven to port at all.

The obvious objection is a dependency bump — and it turns out not to apply. **three 0.170, already installed, ships WebGPU**: `three/webgpu` and `three/tsl` are both in its export map, `build/three.webgpu.js` is present, and `@types/three@0.170` ships `three.webgpu.d.ts`. The `feature/webgpu-levels` branch bumped to 0.185 for *maturity*, not availability. So the first attempt costs **no dependency change and has zero blast radius on the game**.

---

## 2. Non-goals

- **No game migration.** `src/main.ts` and `src/engine/renderer.ts` keep `WebGLRenderer`. Two renderer paths coexist deliberately.
- **No merging `feature/webgpu-levels`.** That branch is 54 commits behind main, has no `src/lab/`, and carries the M6 dungeon work that was abandoned for looking bad. It is a **reference**, not a base. Its renderer commits (`ff8ac2e`, `c874dc4`, `0c778ed`, and the alphaTest fixes) are worth reading before repeating their debugging.
- **No compute-shader work in this spec.** Compute is the *reason* for migrating, but polygonization, GPU culling and acceleration structures are each their own spec. This one earns the right to write them.
- **No post-fx port initially.** See §6.
- **No WebGL fallback path in the lab.** `WebGPURenderer` has its own automatic WebGL2 backend fallback; the lab does not need a second one.

---

## 3. What has to change

| Piece | Today | After |
| --- | --- | --- |
| Renderer | `WebGLRenderer` via shared `createRenderer` | `WebGPURenderer` via a lab-local factory |
| Init | synchronous | **async** — `WebGPURenderer` needs `await renderer.init()` |
| Shader | 234 lines of raw GLSL ES 3.00 in a `ShaderMaterial` | WGSL through a node material |
| Primitive data | uniform arrays, capped at 48 | **storage buffer**, effectively uncapped |
| Depth write | `gl_FragDepth` | WGSL `@builtin(frag_depth)` |
| Post-fx | pmndrs `postprocessing` `EffectComposer` | none initially (§6) |
| Timing | `EXT_disjoint_timer_query_webgl2` | WebGPU timestamp queries |

`createRenderer` stays untouched. The lab gets `createLabRenderer` in `src/lab/sdf-zombie/`, mirroring the existing handle shape (`setRenderCallback` / `setDrawFn`) so `lab-main.ts` changes as little as possible. Its async init means the lab's module top-level work moves inside an `async` bootstrap.

---

## 4. Porting the shader

The decisive question, because `march.glsl.ts` is the whole experiment.

**Use raw WGSL via `wgslFn`, not a hand-built TSL node graph.** `wgslFn` is present in the installed three (`src/nodes/code/FunctionNode.js`). The reasons:

- **The port stays mechanical.** GLSL and WGSL are close enough that `smin`, `sdPrim`, `mapBody`, `applyCarves`, `applyWounds` and the march loop translate largely line-for-line. A TSL rewrite would restructure the code into a node graph, which is a redesign wearing a port's clothing.
- **The CPU/GPU mirror survives.** `validate.ts` mirrors `sdPrimitive` and `smin` exactly, and that mirror backs click-to-shoot raycasting — drift means shots land where the body isn't. Keeping the GPU side as readable imperative code keeps the two diffable side by side. A node graph would make that comparison eye-impossible, and nothing in this repo can check it automatically.
- **The existing text-level tests keep working.** Tests assert `FRAG` contains `applyCarves` and the right `MAX_PRIMS`. Those survive a WGSL string; they do not survive a node graph.

TSL remains the right choice for anything *new* and compute-shaped later. It is the wrong tool for translating a working sphere-tracer.

### Known translation traps

- **`gl_FragDepth`** becomes a `@builtin(frag_depth)` output on the fragment struct. Depth range is `[0,1]` in both, but WebGPU's NDC z is `[0,1]` where OpenGL's is `[-1,1]` — the existing `(clip.z / clip.w) * 0.5 + 0.5` conversion **must drop the remap** or everything will composite wrongly at the wrong depth.
- **No implicit `discard`.** WGSL uses `discard;` as a statement, which is fine, but combining it with a manual depth write has the same early-Z consequences as today. Migration does not fix the occlusion problem.
- **Matrix/uniform names.** Three's WGSL node materials do not hand you `projectionMatrix`/`viewMatrix`/`cameraPosition` under those names. The GLSL version already had to redeclare `projectionMatrix` by hand — expect a different set of surprises here, and expect them to present as a blank page rather than an error.
- **Texture sampling** becomes `textureSample(tex, samp, uv)` with an explicitly bound sampler; `flipY` handling differs, and the face projection just got bitten by `flipY` once already.

### `EXT_conservative_depth` does not port

The highest-leverage WebGL optimisation identified in the face spec — `layout(depth_greater)` restoring early-Z so occluded bodies cost nothing — **has no WebGPU equivalent.** WGSL has no conservative-depth attribute. This is a genuine regression and should be stated plainly: migrating trades a cheap, available occlusion win for compute capability. If occlusion turns out to matter more than compute, that trade was wrong.

---

## 5. Storage buffers remove the ceiling

The single most concrete win. Primitive data moves from `uniform vec4 uPrimA[48]` to a read-only storage buffer, which is bounded by device limits in the hundreds of megabytes rather than by 224 `vec4`.

Consequences worth naming:

- `MAX_PRIMS` stops being an authoring constraint. `validateBody`'s count check becomes a sanity bound rather than a hard ceiling.
- The rest-space endpoint data that Phase 2 of the face spec needs — which nearly doubled the uniform budget — becomes free.
- A skeleton as a second SDF field stops competing for the same space.
- Multiple bodies could share one buffer, which is the precondition for a single fused march pass instead of one proxy box per zombie.

`pack.ts` already produces flat `Float32Array`s at fixed stride. That is exactly the right shape for a storage buffer, so the CPU side barely changes.

---

## 6. Post-FX is dropped, deliberately

The pmndrs `postprocessing` library is WebGL-only. `feature/webgpu-levels` hit this and left `void createPostFxComposer` with a comment deferring a TSL replacement to a "Phase B" that was never written.

The lab can afford to drop it, because **post-fx is currently defaulted off anyway** — the flesh presets were tuned against a missing gamma encode and read far too bright through the correct chain, so the lab runs with the composer bypassed until they are retuned.

Rebuilding Bayer dither and the BLOOD.PAL snap as a TSL `PostProcessing` pipeline is its own follow-up, and one whose result would be directly reusable if the game ever migrates. It should not gate this work.

---

## 7. What compute unlocks (the actual reason)

Named here so the migration is judged against them later, not built for its own sake:

- **Marching-cubes / surface-nets polygonization in a compute pass.** Turns the field into a mesh with adaptive topology, which is the technique that most likely produced the smooth results in the blend-shell reference, and which scales to crowds because meshes get early-Z, instancing and normal LOD. Per-frame polygonization is viable on compute in a way it never was on WebGL2.
- **GPU culling and acceleration structures**, so many bodies do not each pay a full march.
- **Timestamp queries** for honest cost measurement.
- **Hybrid LOD**: raymarched hero, meshed crowd — the shape the port to the real game is most likely to take.

---

## 8. Testing

Unchanged in philosophy: pure modules stay unit-tested, and **nothing in this repo compiles a shader** — which is now doubly true, since WGSL is even further outside the toolchain's reach than GLSL was.

- `pack.ts`, `validate.ts`, `face.ts`, `clusters.ts` and friends are untouched and their tests must stay green throughout. If a pure-module test breaks during this migration, something is wrong with the migration.
- Text-level assertions move from `FRAG` to the WGSL source string.
- The CPU/GPU mirror gets a new test: sample `sdBody` at a set of fixed points and assert the values are stable across the port, so a translation slip in `sdPrim` or `smin` surfaces as a failing number rather than as shots landing in empty air.

### The human gate, hardened

Every lesson about shader verification applies more strongly here. The parent spec lost eight consecutive green tasks to a fragment shader that never linked. A WGSL port is a *full rewrite* of that shader, so: after every task, load the page and confirm the body renders, the console is free of pipeline-creation errors, depth composites correctly against the reference cube and floor, shooting still lands craters where clicked, and severing still works.

---

## 9. Risks

**The raymarcher may not port cleanly, and failure will look like a blank page.** This is the whole risk. Mitigation is ordering: port a hardcoded-sphere spike first and get *that* compositing correctly against the floor before touching the real field — exactly the shape of task 2 in the original lab plan, which existed for this reason and whose verification was skipped, letting three render bugs survive.

**WebGPU availability.** Requires a recent Chrome/Edge, or Safari 18+. `WebGPURenderer` falls back to a WebGL2 backend automatically, but in that mode WGSL node materials are transpiled and behaviour may differ — so "it works" on the fallback is not evidence it works on WebGPU, or vice versa. Check `navigator.gpu` and surface which backend is live in the lab UI.

**Losing conservative depth** (§4) is a real, quantified regression against a lever that was available and untried.

**three 0.170's WebGPU is less mature than 0.185.** The reference branch bumped for a reason and its commit log names transparency/alphaTest bugs it fixed by upgrading. If the lab hits similar issues, the escape hatch is bumping to 0.185 — but that is a repo-wide dependency change and the game must then be re-verified, which is exactly the blast radius this spec is structured to avoid. Try 0.170 first; treat a bump as a scope change, not a detail.

**Two renderer paths** is real maintenance cost and a real source of "works in the lab, broken in the game" confusion. Accepted deliberately, and the reason the lab keeps its own factory rather than adding a mode flag to the shared `createRenderer`.

---

## 10. Phasing

**Phase 0 — spike.** `createLabRenderer` with `WebGPURenderer` and async init; a proxy box marching a single hardcoded sphere in WGSL, writing depth, compositing correctly against the floor and the reference cube. Nothing else. This is the go/no-go, and it is the step whose verification was skipped last time.

**Phase 1 — port the field.** `sdPrim`, `smin`/`smax`, the cluster fold, `applyCarves`, `applyWounds`, normals, lighting. Primitive data into a storage buffer. Verified by the value-stability test plus the human gate.

**Phase 2 — restore the lab.** Gibs, severing, the face texture projection, the tuning panel. Reach parity with the WebGL lab.

**Phase 3 — instrument.** Timestamp queries and the N-body spawner deferred from the face spec. This is where the migration finally gets judged, and the first honest cost numbers this project has ever had.

Compute work begins only after Phase 3 produces a number.

---

## 11. Open questions

- Does `three/webgpu`'s type resolution work under this repo's `tsconfig` without a `paths` entry? `@types/three@0.170` ships `three.webgpu.d.ts`, but whether `import { WebGPURenderer } from 'three/webgpu'` type-resolves cleanly is a Phase 0 verification, not an assumption.
- Does the lab keep its own `sdf-lab.html` entry, or gain a `?webgpu=1` switch so both paths can be compared side by side? The comparison is valuable while porting and dead weight afterwards.
- Should `MAX_PRIMS` remain as a soft authoring guide once storage buffers remove the hard ceiling? An unbounded primitive count is also an unbounded per-step loop.
