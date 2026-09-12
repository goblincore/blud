# Neural upscale — runtime normals for the `rgbn` / `rgbdn` input sets

**Status:** plan, not started (2026-09-12). Blocks shipping any model trained with normals in-game.
Training-side is done: dataset v3 pairs carry `normal.npy` (contracts §1), `nupscale` trains `rgbn`/`rgbdn`.

**Spec context:** `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md` §2 (inputs).
Scoping report 2026-09-12 (file:line refs below are from it; re-check before editing).

## Why an MRT and not a second march

The capture gets normals by re-rendering the frozen frame in march debug mode 9 (`march.wgsl.ts`,
top of `MARCH_BODY_LIGHT`: `return vec4(normalize(n), t)`). At runtime a second 0.5-scale march would
cost ~8 ms; a second colour attachment on the same pass costs bandwidth only. The normal the net was
trained on is exactly the lit path's shading `n` after the face bump, so the MRT must write that same
value — in **view space** (`mat3(cameraViewMatrix) * n`), unit, zero where no hit.

## Tasks

1. **Private-global normal in the lit march.** Copy the `deferred-sdf.ts` pattern (`SDF_SURFACE_STATE`
   :70-80, `MARCH_SURFACE_PROLOGUE` :98, read fns): add `var<private> gMarchNormal: vec4<f32>` with a
   reset fn, write `gMarchNormal = vec4(normalize(n), 1.0)` at the top of `MARCH_BODY_LIGHT` (after the
   mode-9 return), and a `readMarchNormal(dep: vec4<f32>) -> vec4<f32>` that returns it. No comments in
   any WGSL parameter list. Test: `deferred-sdf.test.ts`-style source invariants.
2. **`createMarchMaterial` option `normalsOut`** (`zombie-gpu.ts:973`, lit branch ~1298). When set:
   `material.mrtNode = mrt({ output: vec4(marched.xyz, depth), marchNormal: readMarchNormal({dep: cached}) })`
   with the trace `.toVar()`-cached exactly as the surface branch does (~1246-1268), rotated to view
   space with `cameraViewMatrix`. Default off: every other caller (fpv hands, hull-refine, chunks) is
   untouched. Confirm with a fake-renderer test that `mrtNode` is absent by default.
3. **Layer target with two attachments** (`sdf-layer.ts:1089`): allocate `target` with `count: 2` and
   name the textures `output` / `marchNormal` (MRTNode matches BY NAME); expose `marchNormalTexture`.
   Every material rendered into `target` must carry the mrtNode (body views and chunk views) — audit
   the `setRenderTarget(target)` sites (:1539, :1839-1874). Gate the whole thing behind a layer option
   so the shipped path (no upscale) keeps the single-attachment target and its exact frame hash.
4. **Stage input** (`upscale-stage.ts:81-119`, `upscale-wgsl.ts:133-146, :183-191`): second texture ref
   `'normal'`; first-layer taps read `n_k = textureLoad(normal, q_k, 0).xyz * h_k` into the extra
   channels (`a1_k.yzw` for rgbdn, a new vec4 for rgbn). `upscale-model.ts:18/30/35`: `'rgbn': 7`,
   `'rgbdn': 8`. `upscale-reference.ts:44-60` `assembleInput` gains `raw[5..7]` (rgbn) / `raw[5..7]`
   after depth (rgbdn) — match `nupscale/model.py::assemble` channel order exactly: rgb·hit, hit,
   [depth], normal·hit.
5. **Parity.** `scripts/upscale-trained-parity.ts` reads the fixture's optional `normal-k.npy`
   (already written by `nupscale.export.export_parity_fixture`). G3 on an rgbn export must pass at the
   existing tolerance. Then `scripts/upscale-trained-smoke.mjs` with `UPSCALE_SMOKE_MODEL=<rgbn export>`.
6. **Cost.** Bench `upscale-s64-rgbn` vs `upscale-s64` on a quiet machine (g1-cost.md).

## Order

1 → 2 → 3 (GPU smoke: `scripts/upscale-smoke.mjs` after each) → 4 (vitest twin tests first) → 5 → 6.
Kill and restart vite after every shader edit.
