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

## Task F — lab integration, captures, benchmark, owner gate

### F1 — hand-field UI policy (fpv-mode.ts, pure + unit-tested)

`HandFieldMode` is now `'prims' | 'baked' | 'clip'`; `HandFieldUi` carries
NAMED load states (`staticLoad`, `clipLoad`, `clipError`). The ambiguous
single `settleHandVolume` is REPLACED by `settleStaticHandVolume` (success
keeps the field, failure forces prims) and `settleHandClip` (the COMBINED
clip+GLB settlement — the lab settles it ready only after both objects
loaded, so `clipLoad === 'ready'` reads "clip + GLB coherent"; failure
records one `clipError` and falls back to baked when static is ready, else
prims). `requestHandField` refuses `baked` before static ready and `clip`
before the clip settlement. `handFieldFrame` returns the new
`HandFieldFramePolicy` — prims: both hands + primitive props; baked: right
hand only, no props (X1.26 unchanged); clip: right hand + clip stick ONLY.
Two new pure helpers serve the F2 drive: `clipBundlePresented` (no flight,
no pending throw, hand phase `idle|light|cook` — the next-bundle policy) and
`handReleaseVelocity` (`(cur−prev)/max(dt,1/240)`, the 1/240 floor stops a
hidden-tab stall faking infinite hand speed).

### F2 — coherent loading + the clip-mode frame drive (lab-main.ts)

- **Loads:** static volume loads independently (`/assets/lab/hand-sdf-relaxed-r.json`).
  The clip path loads+validates the v2 manifest/atlas first
  (`/assets/lab/hand-sdf-dynamite-grip-r.json`), THEN its relative
  hash-matched GLB via `loadDynamiteProp` — note the GLB resolver needs an
  ABSOLUTE manifest URL (`new URL(HAND_CLIP_URL, location.href)`); a
  relative base throws. `settleHandClip(ui, true)` fires only when BOTH are
  ready; either failure stores one `clipError`, falls back to X1.26 baked
  (prims if static also failed), and the clip is never paired with the
  procedural prop (the procedural stick/cig are posed `gone` for the whole
  clip session). `pagehide` disposes static texture, clip texture, and GLB
  resources exactly once (idempotent disposables, one handler).
- **Frame (clip mode):** `stepFpvMode(..., 'deferred')` → the parked
  `pendingThrow` is the grip controller's `throwRequested` edge →
  `stepGripMotion` from frame dt → `gripFrameSample` + `setVolumeFrame` →
  X1.26 base pose → `applyGripMotion(base, motion, gripCameraQuaternion(yaw,
  pitch))` → `setVolumePose` → `bakedDynamitePose` from that EXACT animated
  pose → while `propHeld` the root goes to the GLB. Prims and static baked
  keep the default immediate release mode, unchanged.
- **Marker release:** `prevPropRoot` keeps the previous rendered GLB root;
  on `releaseNow` the velocity is `(cur−prev)/max(dt,1/240)`,
  `releasePendingThrow` spawns at the CURRENT root, and the GLB re-poses
  from the new `flight.pos` with `releaseQuaternion` = the rendered
  orientation, on the same render frame. Flight then exclusively owns it
  (visible from the god cam too). **Measured handoff error: 0.000000 mm**
  (`glbRoot` and initial `flightPos` are bit-identical — `makeFlight` copies
  the position) across every run; the gate is < 0.1 mm.
- **Presentation:** `bundlePresented` is true only at recovery (no flight,
  no pending, hand `idle|light|cook`); a presentation restarts open →
  firm-grip, and a holding phase keeps a completed close at grip 1. Verified
  live: after detonation the hand re-closes (witness caught `closing` at
  grip01 0.016 → held).

### F3 — controls, scrub, automation

Panel (`fpv` section): `hand field: prims|baked|clip` (cycles; refusals show
the pending load state), `grip: play/pause/loop`, `grip progress` (scrub),
`grip speed`, `hand warp`, `hand clay`, `contact debug` (wireframe grip-seat
sphere + bundle-axis contact capsule from the manifest contract), and inline
static/clip load errors. Scrub is pause-only and VISUAL: it changes the
frame sample and held prop pose, never `pendingThrow`/flight/fuse/explosion
(asserted live — see scrub witness). Automation adds `setHandField`,
`setGripPlayback`, `setGripProgress`, `setGripSpeed`, `playGripThrow`,
`setContactDebug`; `throwDynamite` routes through `playGripThrow` in clip
mode (an immediate forceThrow would pair the clip with a differently sized
bundle). `window.__sdfLab.fpv` exposes phase, `grip01` (+controller/scrub
split), frame0/frame1/alpha, releaseCount, propOwner, glbRoot, flightPos,
static/clip/GLB load states, errors, handoffErrorM, playback and speed.
`loop` playback auto-tosses each held bundle after a 0.45 s hold at charge
0.5 — the capture loop's driver.

### F4 evidence

**Automated verification**

```
uv run scripts/test_author_dynamite_grip.py -v        # 11/11 OK
uv run scripts/author_dynamite_grip.py --validate-only # dims/nodes/sha ok → PASS
uv run scripts/test_bake_hand_sdf.py -v               # 19/19 OK
uv run scripts/bake_hand_sdf.py --validate-only        # PASS
uv run scripts/test_bake_hand_sdf_clip.py -v          # 25/25 OK
uv run scripts/bake_hand_sdf_clip.py --validate-only   # 6 slabs valid, hashes match
npm test                                              # 1512/1512
npx tsc --noEmit                                      # clean
npm run build                                         # ok (~2.8 s)
```

**Live WebGPU sequence** (Vite :5291 — fresh, lsof-verified, served bundle
confirmed to contain the task-F keys; Chrome 151 headed via CDP :9224;
`scripts/verify-grip-release.mjs`, evidence `task-f-smoke.png`):

- backend `webgpu-ok`; clip field engages with `staticLoad/clipLoad ready`,
  `glbLoad glb-ready`, no `clipError`;
- open→close reaches `held` with `grip01 === 1`;
- `playGripThrow(0.5)` parks the deferred throw (`cookPhase cooldown`,
  phase `held`, owner `hand`);
- **marker handoff: exactly once (`releaseCount 1`), handoff error
  0.000000 mm, `glbRoot` bit-identical to the initial `flightPos`, owner
  flips to `flight`, grip01 at the marker 0.624** (= the authored
  `1 − smoothstep((0.15−0.10)/0.12)` value);
- flight → detonation → recovery → NEXT close all witnessed
  (`detonated/recovered/nextClose` true, re-close caught mid-`closing`);
- scrub witness: `setGripProgress(0.5)` → `grip01 0.5`, frames `2/3 α 0.5`,
  `flightPos null`, `releaseCount` unchanged, cook idle — visual only;
- **0 console events** matching GPUValidationError/shader/pipeline/compile/
  GLB/unhandled/error patterns. **SEQUENCE PASS.**

**Eight fixed views + two loops** (`scripts/capture-grip-release.mjs`;
pinned: eye [0,0,4], yaw 0, pitch −0.03, boot material/light defaults, SDF
scale 1, no wounds stamped, jiggle/hand-warp off for stills; states logged
at capture): `open` (grip01 0.000), `first-contact` (0.400), `wrap` (0.600),
`thumb-lock` (0.800), `firm-grip` (1.000) via exact authored-frame scrubs;
`release-marker` (throwing, grip01 0.623, owner flight, handoff error 0),
`bundle-clear` (throwing@0.200 s, grip01 0.073), `follow-through`
(grip01 0, owner flight) via real throws paused frame-accurately at the
state. All eight are rendered frames (luma σ ≈ 37–40, blank check) and
pairwise distinct (mean |ΔRGB| 0.9–3.6 between consecutive states — the
closure visibly progresses). `grip-release-loop.webm` (jiggle off, 961
frames / 16 s ≈ 60 fps) and `grip-release-loop-jiggle.webm` (warp on, 962
frames / 16 s) record the full close→hold→toss→detonate→re-close cycle at
normal speed via loop playback. Captured AFTER the first throw's
detonation, the scene includes the blast result — that is the real loop
state, not a restaged one.

**Benchmark vs X1.26 static baked** (`scripts/bench-grip-release.mjs`;
visible page, identical settings: FPV, 1 body, hands on, SDF scale 0.7,
warp off, 240 benchGpu samples per leg, alternate static 1 → clip 1 →
clip 2 → static 2):

| leg | median ms | p05 | p95 | hiddenSteps |
|---|---|---|---|---|
| static 1 | 2.41 | 1.96 | 10.55 | 0 |
| clip 1 | 2.39 | 2.02 | 2.54 | 0 |
| clip 2 | 2.47 | 2.12 | 2.63 | 0 |
| static 2 | 2.59 | 2.11 | 9.28 | 0 |

Clip − static median delta **−0.07 ms** (investigate gate +0.75 ms; the
static legs' p95 spikes are the same background-compositor noise task C
saw, while both clip legs hold p95 < 3 ms). Assets: GLB **923 236 B**
(0.88 MiB), clip binary **28 541 232 B** (27.22 MiB on disk), atlas
**131×178×612** → estimated GPU R16F (2 B/texel, RedFormat+HalfFloatType)
**28 541 232 B ≈ 27.22 MiB**, under the 35 MiB stop-gate; static volume GPU
footprint 131×178×86×2 ≈ 3.82 MiB. No gate tripped; nothing to investigate;
the visual gate is NOT waived for performance.

### Owner verdict: PENDING

Ten-point checklist for the owner (watch `grip-release-loop.webm` first,
then `grip-release-loop-jiggle.webm`, then the eight stills):

```text
[ ] closure is visible and continuous at normal speed
[ ] five fingers and web spaces survive every midpoint
[ ] thumb lock visibly secures the bundle
[ ] prop scale/silhouette reads as a dynamite bundle
[ ] no distracting hand/prop penetration or floating contact
[ ] wrist arc reads as an underhand toss
[ ] fingers open late rather than before the swing
[ ] bundle visibly continues out of the palm
[ ] held→flight position/orientation has no visible jump
[ ] follow-through and replacement close read cleanly
```

Owner decision after dispatch (per the plan): PASS → mark X1.27 complete;
FAIL — prop/pose → revise Task A's GLB/contact solve and rebake (no runtime
scaling); FAIL — midpoint artifact → add/reposition an authored frame; FAIL —
release discontinuity → fix the shared rendered-root handoff.

### Provenance

- Evidence scripts (dev tooling, not in the Task F commit per the plan's
  `git add` list, kept in the worktree): `scripts/verify-grip-release.mjs`,
  `scripts/capture-grip-release.mjs`, `scripts/bench-grip-release.mjs`.
- Derived assets unchanged from Tasks A–B: `dynamite-bundle-grip.glb`
  (DJMaesen/bumstrum CC-BY-4.0 derivative, hash-bound in the manifest),
  `hand-sdf-dynamite-grip-r.{json,r16f}` (DavidFischer CC-BY-4.0 hand
  derivative). ATTRIBUTIONS.md already covers both chains.
