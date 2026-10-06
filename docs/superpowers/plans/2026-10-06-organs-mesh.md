# Organs as Mesh Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [x]`) syntax.

**Status 2026-10-06:** built; every task done but the owner's look pick (last line). Results: `docs/dev-notes/2026-10-06-organs-mesh/NOTES.md`. Changes from the plan as written: the organ material has its own light compose (`meshOrganShade`: cavity occlusion, beam gain, torch glint), the looks are `match` / `wet` / `veined` / `pale`, sources always carry organ segments (the mode gates drawing and packing), and the look sheets come from the gate script (`ONLY=L`), not a separate one.

**Goal:** With the default `skeleton=mesh`, zombie organs are drawn as segment meshes and the packed body carries no
inside-flesh rows, so the march never calls `applyBones`.

**Spec:** `docs/superpowers/specs/2026-10-06-organs-mesh-design.md` — read it first.

**Architecture:** The pure skeleton contract (`skeleton-spike/contract.ts`) gains organ sources on the axial frames
`applyRig` already poses organs by; `pack.ts` gains `packOrgans`; a pure reach test decides which organ segments a
wound exposes. `mesh-renderer.ts` draws organ sources in the existing instanced batches on a third material whose
surface is hand-written WGSL (`mesh-organ.ts`), composed with the shared `boneShade`. No march WGSL changes.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest,
headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests** (no `three` import; plain data in, plain
    data out). The renderer-facing module only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string modules or exported WGSL strings). TSL
    node graphs are for thin glue (binding, blending), not for the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module — never as new `main()` bindings
    (`npm test -- game-context-coverage`).
- Work ONLY in this worktree (`.claude/worktrees/organs-mesh`). Never `git stash`, never a blanket reset.
  `node_modules` is symlinked — do not reinstall.
- **Targeted tests** (`npx vitest run <names>`) plus `npx tsc --noEmit` per task; the vitest tree once at the end.
- **Headless capture only**, never port 5273. Own servers from `scripts/lab-servers.sh` (bash, not zsh) on a private
  port pair; check `$lab_started_vite` and `$lab_started_chrome`. Take `/tmp/blud-gpu-timing.lock` round every GPU
  run (`mkdir` to take, `rm -rf` on exit).
- **Prove visual and performance claims with a number** and look at the images yourself.
- **Boot time is a gate:** this change adds a material; report cold-boot `drawOnce` against main.
- After any WGSL change: `npx vitest run march-golden` (`-u` only if the march text moved), `node
  scripts/compile-census.mjs`, `march-hash`, the vitest tree, and the three capture gates with `OUT` set.
- WebGPU: the instanced bone pipeline binds 6 of 8 vertex buffers; add no per-instance attribute buffer. Never
  toggle a light's `.visible`. A derivative or `textureSample` inside an `If()` must be hoisted with `.toVar()`.
- Kill anything you start outside a capture script in the same step.
- Memory goes to dualmem, with `--files`.

---

## Task 1 — `packOrgans` in the pack

**Files:** modify `src/lab/sdf-zombie/pack.ts`; test `src/lab/sdf-zombie/pack.test.ts`.

- [x] Failing tests: on the zombie body, `packBody(body, undefined, { packBones: false, packOrgans: false })` has
  `boneCount === 0` in each `boneCullMode` (`off`, `cluster`, `segment`); `{ packOrgans: true }` and `{}` give
  byte-identical `PackedBody` arrays; `{ packBones: true, packOrgans: false }` packs bone rows and no row with
  `primScale.w === W_ORGAN`.
- [x] Implement: `PackOpts.packOrgans?: boolean` (default true); beside every `if (!packBones && b.op === 'bone')
  return;` add `if (!packOrgans && b.op === 'organ') return;` (three sites in `packBody`).
- [x] `npx vitest run pack` and `npx tsc --noEmit`; commit.

## Task 2 — organ sources in the contract

**Files:** modify `src/lab/sdf-zombie/webgpu/skeleton-spike/contract.ts`; test `contract.test.ts`.

- [x] Failing tests (zombie at rest, then posed with a stepped rig and a body yaw):
  - without `organs`, the source list is unchanged and every source has `kind === 'bone'`;
  - with `organs: true`, there is at least one source with `kind === 'organ'`, every such key matches
    `/^organ:axial:\d+-\d+$/`, their `primCount`s sum to the body's live organ prim count (8), and no bone source
    counts an organ;
  - at rest, for sample points round each organ prim, `composedBoneDistance(organSources, p)` equals the hard min of
    `sdPrimitive(p, organPrim)` over the body's organ prims (1e-6);
  - posed, `poseEndpointError()` of each organ source is below 1e-6 (they are rigid on their frame);
  - `isLive()` goes false when the torso cluster dies.
- [x] Implement: `BoneFieldSource.kind: 'bone' | 'organ'`; `SkeletonSourceOpts.organs?: boolean`; in the
  `bonePrims.forEach`, an organ prim with `organs` on and a `boneFrames` entry joins `organ:axial:<head>-<tail>`
  (same `poseOf` and locals as the axial branch); an organ with no frame is skipped (and counted in a returned
  diagnostic only if one ever exists: assert none on the zombie). `revision` already hashes the key. Rewrite the
  header's "ORGANS ARE EXCLUDED" paragraph.
- [x] `npx vitest run skeleton-spike`; `tsc`; commit.

## Task 3 — the organ reach cull (pure)

**Files:** create `src/lab/sdf-zombie/webgpu/skeleton-spike/organ-reach.ts` and its test.

- [x] Tests then code for
  `organReached(spheres: ReadonlyArray<{ pos: Point3; radius: number }>, centre: Point3, radius: number): boolean`
  (true when any sphere's distance to `centre` is below `radius + sphere.radius`), and
  `segmentBoundSphere(bounds, pose): { centre: Point3; radius: number }` (the local AABB's centre mapped by the
  pose, half-diagonal radius). Cases: empty list false; touching true; a head-height sphere against the gut bound
  false on the real zombie; the bound follows a yawed pose.
- [x] Commit.

## Task 4 — the organ surface WGSL and its CPU mirror

**Files:** create `src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-organ.ts` and `mesh-organ.test.ts`.

- [x] `MESH_ORGAN_SURFACE_WGSL`: `fn meshOrganSurface(pWorld, pLocal, organColor: vec3<f32>, deepColor: vec3<f32>,
  cfg: vec4<f32>, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32>` returning `vec4(albedo, expo)`. The
  exposure loop is the one in `meshBoneSurface`. `cfg = (organAmp, veins, stain, variant)`: albedo is
  `mix(tissueBase, organColor, organAmp)`; `veins` weights a segment-local darker mottle; `stain` weights the pull
  toward `deepColor` at a crater's rim (low `expo`). `MESH_ORGAN_WET_WGSL`: wet all over, a small noise term.
  One `fn` per string (the `wgslFn` rule in `bone-instancer.ts`).
- [x] `ORGAN_LOOKS`: the named candidates for the sheet (`match`: flat `organColor`, even gloss; `veined`;
  `bloody`), each a `cfg` plus spec and fresnel scales. `ORGAN_LOOK_DEFAULT = 'match'` until the owner picks.
- [x] Tests: the CPU mirror of the albedo at `organAmp` 0 and 1; each look's numbers are finite; the WGSL strings
  hold exactly one `fn` each and no `:` inside a comment.
- [x] Commit.

## Task 5 — the renderer draws organ sources

**Files:** modify `skeleton-spike/mesh.ts` (per-source cell), `skeleton-spike/mesh-renderer.ts`; tests
`mesh.test.ts`, `mesh-renderer.test.ts`.

- [x] `mesh.ts`: `ORGAN_MESH_CELL = 0.005`; `SegmentMeshCache.get` and `keyOf` use it for `kind === 'organ'`. Test:
  an organ source's key ends `@0.005`, a bone's `@0.01`; the organ mesh has vertices, no overflow, not clamped, and
  every vertex lies within 1 mm of the organ field's zero set.
- [x] `mesh-renderer.ts`: `Batch.kind: 'bone' | 'eye' | 'organ'` (replacing `eye: boolean` where it selects the
  material); an organ material = `lit(organSurface, organLook)` with `depthTest`, `depthWrite`, `FrontSide`;
  `prepareGeometry` skips `meshFeature` for organs (the organ material does not read it); `show.organs`;
  `organLook` uniforms (`color`, `cfg`, spec and fresnel scales) with a `setOrganLook(name | values)`; `update`
  takes the owner's exposure spheres (`reach?: (owner) => spheres`) and draws an organ source only when
  `segmentNeeded` passes without the eye clause AND `organReached` is true; `stats.organs`; organs are never split
  and never carry eyes; `dispose` covers the new material.
- [x] Tests (the existing harness in `mesh-renderer.test.ts`): an exposed owner with a torso sphere draws its organ
  instance(s) on the organ material; a head-only sphere draws none; an unexposed owner draws none; `show.organs =
  false` hides the batch; a severed (dead-torso) body draws none.
- [x] `npx vitest run skeleton-spike`; `tsc`; commit.

## Task 6 — the selector and the game wiring

**Files:** modify `skeleton-spike/selector.ts` (+ test), `webgpu/zombie-gpu.ts` (`setPackOrgans` on the body view,
beside `setPackBones`; re-pack as it does), `webgpu/game-state-render.ts` (`ctx.render.organMode: 'mesh' | 'sdf'`),
`webgpu/game-render-leaves.ts` (`applyOrganMode(ctx, mode)`), `webgpu/game-main.ts`, `webgpu/game-seams-skeleton.ts`.

- [x] `resolveOrganMode(search, skeletonMode): 'mesh' | 'sdf'`: `mesh` only when the skeleton is `mesh` and
  `organs` is not `sdf`. Tests for each skeleton mode and both query values.
- [x] `game-main.ts`: `buildSkeletonSources` passes `organs: ctx.render.organMode === 'mesh'`; wherever a mesh actor
  gets `setPackBones(false)` it also gets `setPackOrgans(ctx.render.organMode !== 'mesh')`; the per-frame update
  passes the reach spheres per owner (`boneExposureOf(a)`, computed once per visual actor and reused for
  `setWounds`) and copies `organColor` / `organAmp` from a zombie view's uniforms beside the `boneColor` copy.
- [x] `applyOrganMode`: sets `ctx.render.organMode`, flips `setPackOrgans` on every actor view, clears
  `ctx.render.skeletonSources` so they rebuild with or without organ sources. Seams: `__sdfGame.setOrgans(mode)`,
  `organs()` (mode, drawn organ instances, each actor's `counts2.x`), `setOrganLook`, `showOrgans(on)`.
- [x] Warm path: find how the bone and eye materials reach the boot precompile and put the organ material on the
  same path; measure the first-exposure frame.
- [x] `npx vitest run selector game-context-coverage skeleton-spike pack`; `tsc`; commit.

## Task 7 — the capture gate

**Files:** create `scripts/organs-mesh-gate.mjs`; notes `docs/dev-notes/2026-10-06-organs-mesh/NOTES.md`.

- [x] The checks of spec section 5.3, booted like `axe-gate.mjs` (the ring page, pinned like `march-hash`), with
  `organs=sdf` and the default in one session. Each check is first shown to fail under a breaking change (listed
  in NOTES).
- [x] Run under the GPU lock; record the numbers; commit.

## Task 8 — cost, boot, parity, the three gates

- [x] `march-golden` (expect no snapshot change), `compile-census`, `march-hash` (pins unmoved), the vitest tree.
- [x] `scripts/cut-cost.mjs` (copied from the `claude/cut-cost` worktree, not committed here): `VARIANTS=';organs=sdf'`
  and an in-page selector run on `setOrgans`. Record before / after / delta and the census.
- [x] Cold-boot `drawOnce` against main.
- [x] `head-split-gate`, `axe-gate`, `cut-wound-gate` with `OUT` set.
- [x] Record everything in NOTES; commit.

## Task 9 — the owner's look sheet and the docs

- [x] `scripts/organs-mesh-look.mjs`: the same frames (a slug crater, three chops, a blast; torch on and off) for
  `organs=sdf` and each `ORGAN_LOOKS` candidate; contact sheets into
  `docs/dev-notes/2026-10-06-organs-mesh/look/`. Look at every image.
- [x] Update `AGENTS.md` (the accepted-skeleton paragraph), `TASKS.md`, the combat-and-gore task page, the contract
  header; dualmem decision, architecture and warnings with `--files`.
- [ ] Sheets shown 2026-10-06. After the owner's pick: set `ORGAN_LOOK_DEFAULT`, rerun Task 7 and the look capture, commit.
