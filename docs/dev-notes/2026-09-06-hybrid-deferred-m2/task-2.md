# Task 2 — Export bones and both chunk paths without duplicating shading

**Status: COMPLETE** — all acceptance criteria verified on real WebGPU; M1
gate retained; focused suites and typecheck green.

- Branch: `codex/dispatch/2026-09-06-hybrid-deferred-m2-task-2`
- Commits: `b2e0f554` (factory interfaces + tests), `db6ee770` (real-device
  producer gate + evidence)

## Changed interfaces (all additive; every existing call stays lit)

`SurfaceOutputOptions { output?, shadowReceiver? }` (already declared in
`deferred-surface.ts` by task 1) is now implemented by all four factories:

- **`createSharedChunkGpuMaterial(prev?, options?)`** — surface mode builds
  the SAME shared march graph with the four-attachment MRT output. The
  per-draw data rebinding (onObjectUpdate over `userData.__sdfChunkMaterialState`)
  is unchanged and now observable: the returned handle exposes
  `dataNode` / `volumeNode` / `uniformNodes` — the exact bound nodes whose
  `node.update({ object })` the renderer invokes per draw.
- **`createChunkGpuView(chunk, prims, template, tornAt?, volumeTex?,
  sharedMaterial?, bones?, options?)`** — trailing options; with a shared
  material the material's mode wins (one graph per output mode — no per-chunk
  graph, no march fork). Non-shared views build their private material in the
  requested mode.
- **`createBoneInstancer(max?, options?)`** — material/light split (below);
  surface mode MRTs from material terms. Exposes `surfaceKind` (undefined in
  lit mode).
- **`createBakedChunkMaterial(options?)`** — surface mode from the baked
  vertex terms; lit path byte-identical. Exposes `surfaceKind`.
- **`GpuViewOpts.shadowReceiver`** — flows through `character-view.ts`'s
  existing `opts.gpu` passthrough (no character-view change needed).
- **`createMarchMaterial(..., output, shadowReceiver?)`** — one trailing
  positional (the file's documented POSITIONALLY-LAST doctrine). Surface
  materials now carry `surfaceClass` (unlit uniform node, runtime-flippable)
  and `surfaceKind` (frozen at construction, for route diagnostics).

## SDF receiver metadata

The emission readback (`deferred-sdf.ts`) substitutes the CLASS channel:
`vec4(gSdfEmissionClass.xyz, classVal)` where `classVal` is the packed
`encodeSurfaceClass` value fed from an unlit uniform seeded at construction.
The march tail still writes the plain flesh class into the private global
(pinned unchanged) — the default encoding is exactly M1's: class 2, no
receiver bit. `sdfSurfaceMrtNodes(traced, clipDepth, classValue?)` defaults
to the plain class constant, so the M1 fixture path is value-identical.
Readbacks keep the `dep` data-dependency ordering; the emission readback now
parses `['dep', 'classVal']` (test-pinned with the real WGSLNodeFunction).

## Material/light split (no shading duplication)

- **Bones.** `boneSurface(p, boneColor, deepColor, look, woundTex,
  woundCount) -> vec4(albedo, expo)` is the wound-exposure/mottle/stain/
  albedo block moved VERBATIM out of `boneShade`; `boneShade` now takes
  `surfaceIn` and composes only light terms (beam, diffuse, wet specular,
  fresnel — all verbatim). One fn per wgslFn string; the chain is
  hash → noise → surface → shade. Lit mode composes `shade(surface(...))` —
  same arithmetic, same values. Surface mode evaluates ONLY the surface fn
  (light uniforms are not even referenced — light-invariance is structural):
  albedoRoughness = vec4(albedo, clamp(mix(0.85, 0.31, expo), 0.04, 1)),
  normalMetalness = vec4(normalNode, 0), emissionClass = vec4(0,0,0, kind),
  surfaceDepth = projected clip depth (march's own formula). Roughness
  mapping documented in the source: dry bone matte 0.85; blood-exposed bone
  tightens to the lit model's fixed 48-exponent through the shared light
  pass's `shin = exp2((1-rough)*8)+2` (48 → 0.31), the same inversion
  deferred-sdf.ts records for specPow. `positionNode`/`normalNode` retained
  in BOTH modes (the world-space bone normal feeds normalMetalness directly).
- **Baked chunks.** `chunkSurface(albedo) -> vec4(rgb, rough)` maps the baked
  wound-mask wetness (.a) to roughness (`mix(0.9, 0.31, wm)`); the G-buffer
  albedo IS the baked `bakeColor` attribute — the old lit color is never
  encoded. `chunkShade` (light compose) untouched. Same depth/class/metal
  rules as bones.
- **Marched chunks** share the body's surface path via the shared material —
  alive masks, wounds (torn ends), volume data, posed transforms and the
  per-draw rebind all exercised in the GPU gate (the two chunks carry
  different limb prims at different positions under one material).

Classes used: flesh (body + marched chunks) = 2 + receiver bit; bones = 1
(mesh) + receiver bit; baked chunks = 1, full receiver by default. Bone
capacity/packing untouched (`INSTANCE_FLOATS` 18, pack path shared).

## Test evidence

Focused Vitest (`--maxWorkers=2 --minWorkers=1`), all green:

- `zombie-gpu.test.ts` — 27, including the plan's failing-first test: two
  chunks with distinct data under ONE surface material, performing each
  draw's rebinding via `node.update({ object })` and asserting the bound
  texture/uniform per draw (dataNode → view's dataTexture, counts uniform →
  view's uniforms, volumeNode → shared volume); receiver pins (default 2,
  level-only 18); default-lit pins for every factory.
- `deferred-sdf.test.ts` — 22: readback input pins, classVal substitution
  pin, MRT name stability with the override, tail encoding pins.
- `bone-instancer.test.ts` — 12: parse contract incl. BONE_SURFACE_WGSL;
  surface fn has NO light input; boneShade consumes surfaceIn and no longer
  re-derives (no boneNoise/textureLoad in shade); position/normal nodes in
  both modes; surfaceKind 1/17; update/setWounds unchanged in surface mode.
- `baked-chunks.test.ts` — 5 (new file): lit pins (colorNode, live uniforms,
  chunkShade compose verbatim), surface MRT names, NoBlending, surfaceKind
  1/17, chunkSurface light-invariance.
- Core suites re-run: deferred-layer/surface/lighting, character-view,
  chunk-bake — **132 focused green** in the final run; `npx tsc --noEmit`
  clean at every commit.

## Real-GPU evidence (Chrome WebGPU via CDP, private 5324/9324)

`scripts/deferred-producer-check.sh` — **6/6 checks PASS**
(`docs/dev-notes/2026-09-06-hybrid-deferred-m2/task2-producer-check.json`,
`task2-producers.json`, `task2-surface-shader.wgsl`, image
`task2-producers.png` — inspected: body with chest wound, bone-tube
skeleton, two detached chunks, baked lump, all composed in one frame):

| check | result |
| --- | --- |
| boot-clean-and-surface-kinds | body 18, bones 17, chunks 18 (shared, both views), baked 1 — no page errors |
| producer-coverage-classes | 480000 px: 2556 × class 18 (body+chunks), 1025 × class 17 (bones), 451 × class 1 (baked), all others exactly class 0 |
| per-producer-depth-normal-class | each probe: G-buffer depth within 0.0002–0.0007 of the projected clip depth, unit normals (|n| within 0.0005 of 1), class exact per producer |
| light-invariant-surface-buffers | moving/recoloring/recounting lights (2→3) leaves ALL four attachment hashes identical (FNV-1a over full buffers) |
| one-trace-per-fragment-shader | generated MRT WGSL: `marchSurface` = fn def + ONE call, all three readbacks after the cached trace |
| capture-written | `task2-producers.png` |

M1 regression: `DEFERRED_SKIP_TIMING=1 LAB_VITE_PORT=5325 LAB_CDP_PORT=9325
scripts/deferred-check.sh` — **24/24 PASS** on this branch (all original
coverage/resolve/occlusion/wound/parity checks plus the task-1 composition
gate), so the factory changes did not disturb the M1 fixture.

Owned servers/browser verified stopped after every gate run (lsof empty on
5324/9324/5325/9325 at every exit).

## Unresolved issues

None blocking task 2's scope. Notes for downstream tasks:

- `surfaceClass` on SDF surface materials is a live uniform — task 3/5 can
  flip a body's receiver without rebuilding; bones/baked chunks bake the
  receiver at construction (constant in the graph) and would need a rebuild
  to flip. The game constructs per mode, so this matches its lifecycle.
- The `surfaceKind`/`surfaceClass` handles are the intended registry
  diagnostics for task 3's route table.
- Chunk views sharing a surface material MUST be created with matching
  options (documented on the factory); the gate's `chunkA` identity assert
  pins the shared-material requirement.
