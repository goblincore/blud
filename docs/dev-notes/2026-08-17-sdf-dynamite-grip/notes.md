# X1.27 — baked dynamite grip & underhand release (dispatch chain)

Design: [2026-08-17-sdf-dynamite-grip-release-design.md](../../superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md) ·
plan: [2026-08-17-sdf-dynamite-grip-release.md](../../superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md)

## Chain recovery note (honest provenance)

Task B's dispatch run (2026-08-17 17:35:40Z) finished in 21 s with **zero
commits** (agent no-op reported as done/exit 0), so Task C started against a
branch missing the v2 clip asset. Task C's agent detected this and executed
Task B per its plan section inline **before** any Task C work, as a separate
commit with the plan-specified message. All Task B gates were run.

## Task B — bake and validate the six-frame depth atlas

- **Union grid:** dims (131, 178, 102) per frame, voxel ≈ 1.497 / 1.494 /
  1.489 mm (≤ 1.5 mm target), 12 mm margin added once to the union AABB of all
  six posed soups; atlas (131, 178, 612), frame-major along Z, X-fastest
  inside every slab. One common GridSpec for every frame (`clip_grid`).
- **Output:** `public/assets/lab/hand-sdf-dynamite-grip-r.r16f` =
  28 541 232 bytes (**27.22 MiB**, inside the 24–30 MiB expectation, far under
  the 35 MiB stop-gate). Bake wall time ≈ 46 s including the Blender pose
  re-solve.
- **Per-frame validation:** all six slabs pass X1.26 `validate_field` (finite,
  negative core, wholly-positive boundary); inside fraction 9.4% → 9.1% as the
  hand closes. Winding probes pass per frame (bake_field).
- **Manifest:** version 2, `kind: hand-sdf-clip`, frames keyed 0.0–1.0,
  timing close 0.22 s / swing 0.24 s / releaseAt 0.15 s / release 0.12 s,
  `sha256.binary` + `sha256.source` (DavidFischer hand) recorded, `prop`
  contract hash-bound to `dynamite-bundle-grip.glb`
  (`4b900499…d836`). `--validate-only` re-derives everything from checked-in
  bytes alone (no Blender, no source downloads).
- **Midpoint diagnostics:** `clip-midpoints-sheet.png` (five alpha-0.5
  isosurfaces). The plan asks to reject ghosted double digits, lost web
  spaces, or mitten bridges; this dispatch harness cannot view images, so the
  gate ran **numerically** too (`scripts/clip_midpoint_probe.py`, kept as a
  diagnostic): depth-guarded row scan along the thumbward axis —
  **0 ghost rows, 0 mitten rows** across all five adjacent pairs (a ghost is
  one digit splitting into two deep surfaces where both parents hold the same
  digit; a mitten is a web gap open in both parents bridging over in the
  blend). Separation improves through the close: rows with ≥ 4 separate
  digit intervals grow 82 → 400 from open to firm-grip, max intervals/row 4
  → 5 once the thumb locks. The owner re-checks the sheet visually at the
  Task F gate.
- **Blender 5.2 re-entry gotcha (fixed inline):** `--python THIS_FILE -- …`
  passes the FULL argv; scripts must slice at `--` (Task A's idiom, now in
  `bake_hand_sdf_clip.py` too). First run crashed the midpoint render with
  `unrecognized arguments` before the fix.
- **Attribution:** DavidFischer derivative list extended with the clip
  binary/manifest/midpoint sheet; DJMaesen list extended with the manifest's
  embedded prop contract (ATTRIBUTIONS.md).

### Task B verification

```
uv run scripts/test_bake_hand_sdf_clip.py -v   # 25/25 OK (incl. real asset)
uv run scripts/bake_hand_sdf_clip.py           # bake + midpoint sheet
uv run scripts/bake_hand_sdf_clip.py --validate-only
   -> clip v2 frames=6 atlas=[131,178,612] 27.22 MiB: 6 slabs valid, hashes match
uv run scripts/test_bake_hand_sdf.py           # 19/19 OK (v1 helpers untouched)
git diff scripts/bake_hand_sdf.py              # empty (Task A already exported helpers)
```

## Task C — strict v2 loading + adjacent-slab WGSL sampling

- **C1 loader** (`hand-volume-clip.ts`, + tests): `validateHandClipManifest`
  mirrors the baker's rejections one-for-one (labels/order/keys/atlas/byte/
  prop-hash/unit-quaternion with the model+Y→axisLocal integrity check/path
  safety); `gripFrameSample` pins the plan samples — `sample(0)={0,0,0}`,
  `sample(0.3)={1,2,0.5}`, `sample(1)={5,5,0}` — and never invents a frame 6
  or mixes non-adjacent frames. `loadHandClip` resolves the atlas relative to
  the manifest URL, validates JSON before allocation and bytes/hash before
  the texture, binds at ATLAS dims `[131,178,612]`. `hand-volume.ts` now
  exports the shared `sha256Hex` + `createR16fTexture`; `loadHandVolume`
  routes through them (v1 tests unchanged, 27/27).
- **C2 WGSL** (`march.wgsl.ts`, `specialise.ts`): `sampleHandVolumeFrame`
  does slab-local trilinear with exactly eight `textureLoad`s, `zBase =
  frame * depth`, `i1 = min(i0+1, dimsI-1)` so z ends at `zBase + depth - 1`,
  frames clamped to `atlasDims.z / depth - 1`. `sampleHandVolume` computes
  world→local/warp/uv/outside ONCE, samples frame0 and frame1, and returns
  `mix(d0, d1, clamp(volumeClip.z,0,1)) + outside`. `depth = max(1,
  i32(volumeClip.w))` — no 0-depth sentinel exists. `volumeClip` threads
  beside `volumeWarp` through mapBody/calcNormal/coneMarch/marchBody and the
  specialised mapBody (11 call sites).
- **C3 bindings** (`zombie-gpu.ts`, `fpv-view.ts`):
  `defaultUniforms().volumeClip = Vector4(0,0,0,1)` (fallback), forwarded in
  both march call sites. `HandsGpuView.setField('prims'|'volume', v1 | v2)`;
  static v1 binds `[0,0,0,nz]` (bit-identical X1.26 sample), v2 binds
  `frameDepth`; `setVolumeFrame` clamps indices to `[0,frameCount-1]`, alpha
  to `[0,1]`, forces static v1 back to `[0,0,0,nz]`, and no-ops in prims
  mode.
- **Live WebGPU smoke (mandatory, Step 4):** Vite on **port 5277** (fresh,
  lsof-verified; served bundle confirmed to contain `sampleHandVolumeFrame`/
  `volumeClip` before trusting it), **Chrome 151 headed via CDP :9223**
  (`scripts/verify-clip-smoke.mjs`, evidence `task-c-smoke.png`):
  `backend webgpu-ok`, FPV + `setHandField('baked')` → `handField 'baked'`,
  `handVolume 'ready'`, **0** console events matching
  GPUValidationError/shader/compile/error, canvas luma σ **44.5** (rendered,
  not blank). **PASS.**
- **Timing evidence (benchGpu, not wall clock):** FPV + static baked hand,
  1 body, SDF scale 0.7, 240 samples: **median 2.76 ms / p05 2.56 / p95
  10.44, hiddenSteps 0** — inside the X1.26 gate band (baked 2.52 ms there;
  the sampler now reads 8 texels per frame even at alpha 0, which is the
  cost the adjacent-slab design accepts). Formal static-vs-clip comparison
  is Task F's gate.

### Task C verification

```
npx vitest run <6 focused webgpu suites>   # 185/185 (46 clip + 30 volume + 70 wgsl + 18 specialise + 8 zombie + 13 fpv)
npm test                                   # 1447/1447
npx tsc --noEmit                           # clean
npm run build                              # ok (~4.8s)
live smoke on :5277 / Chrome 151           # PASS, no GPU errors
benchGpu (fpv+baked, n=240)                # median 2.76 ms, hiddenSteps 0
```
