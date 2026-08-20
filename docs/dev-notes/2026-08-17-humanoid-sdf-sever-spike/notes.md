# Task 7 — dedicated spike page, automation, and sever gate (2026-08-19)

Ships `/humanoid-sdf-spike.html` — the isolated textured-humanoid sever spike —
plus the pinned `window.__humanoidSdfSpike` automation API, the deterministic
CDP verifier, ten live captures and an annotated contact sheet. This is the
second owner review gate in the dispatch chain (after Task 6); Tasks 8–10
(wound keying + panels 11–17) are released only after this gate.

## Source + assets (unchanged from Tasks 1–2, re-verified)

- Source: `assets-source/humanoid-sdf/zombie-rigged.glb` —
  `Meshy_AI_zombie_biped_Character_output.glb`, **10,234,820 bytes**,
  SHA-256 `2b23530a64466ca650ead74e49feaf54b6463c254ecccc9b3d56ba993a33cd28`.
- Atlas: **128 × 128 × 512**, one page each — distance `zombie-distance-000.r16f`
  **16,777,216 B** (r16f-le), color `zombie-color-000.rgba8` **33,554,432 B**
  (rgba8). Coarse CPU pack `zombie-coarse.f32` **161,216 B** (22 bricks).
- Bake time: **210.16 s** (`bake-report.json` `durationS`), route `direct-vdb`
  on Blender 5.2.0 LTS.
- `uv run scripts/bake_humanoid_sdf.py --validate-only` → OK (22 bones, atlas
  [128,128,512], coarse 161216 B).

## The page

`humanoid-sdf-spike.html` + `src/lab/sdf-zombie/webgpu/humanoid-spike-main.ts`.
Compact panel only (status, elbow 0–100, softness 0–1, sever/reset, pause
checkbox) — deliberately NOT the full lab panel. Bootstrap order is the plan's
fixed six: renderer → WebGPU-only reject → real asset load/validate →
attached+detached views + floor → `view.prewarm` → expose controls + API →
loop. Every rejection writes a visible `FAILED: …` and exposes a failed-stub
API (`status().phase === 'failed'`) so the verifier can read it. Orbit controls
match the small existing spike (drag/wheel), never the lab's.

The controller is DOM/WebGPU-free and fully Vitest-tested; the view enters via
the structural `SpikeViewLike` (satisfied exactly by `HumanoidView`).
The release impulse is fixed (`DEFAULT_RELEASE_VELOCITY`); the angular part
`[1.4, -3.5, -0.8]` was chosen by simulating the chunk tumble so the distal
cap sweeps through a camera-facing orientation at ~0.47 s — the flight capture
shows the cut surface face-on (measured dot 0.49, 789 px of cap).

## Verification — live WebGPU run

Commands (lsof-verified ports before launch, task-owned processes only):

- Vite: `npx vite --port 5277 --strictPort` (PID 46891, :5277).
- Chrome: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  --remote-debugging-port=9223 --enable-unsafe-webgpu --user-data-dir=/tmp/chrome-humanoid-sdf`
  (PID 46911, :9223; Chrome 151.0.7922.138 headed).
- Verifier: `node scripts/verify-humanoid-sdf-spike.mjs 5277
  docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike 9223`.

Result: **VERIFY PASS — 17/17 gates**. Both processes closed after the run.

- Live backend: **webgpu** (adapter present, `renderer.backend.isWebGPUBackend`).
- Prewarm: **461.8 ms** — `{materialCountBefore:7, after:7, compileCallsBefore:0,
  after:2, renderedAttached:true, renderedDetached:true}`. Only prewarm calls
  compileAsync; sever/reset/render never do.
- Resource counts: `{materials:7, geometries:7, textures:1, attachedClusters:6,
  detachedClusters:1, compileCalls:2}` — **identical across the first sever and
  all ten sever/reset cycles** (no pipeline/material creation on sever).
- Frame timing: median **16.6 ms**, p95 **18.6 ms**, max **19 ms** (120
  samples). First sever frame interval **18.4 ms** (< 50 ms gate); later
  sever frames 13.3–16.9 ms — no first-use pause, no cost drift.
- GPU/shader console errors: **0** (filtered for GPUValidationError/compil/
  shader/pipeline/Uncaught).

## Captures (panels 1–10) + numeric gates

All ten captures + `live-contact-sheet.png` (annotated flesh contours, cap
overlay, landmarks) in this directory. Numeric checks (they supplement owner
review; they do not approve organic appearance):

- `non-blank-luma` — luma std 12.3–13.2 across all captures (> 8).
- `textured-flesh-variance` — flesh-region luma std 42.8 (baked texture detail).
- `flesh-continuity-across-elbow` — the elbow/forearm motion region's flesh
  span is 74 rows with **max gap 0** (no joint-crease separation at elbow 0).
- `elbow-motion-visible` — 0°→100° moves **4,976 px** confined to the arm.
- `landmark-colour-stable` — head+torso landmark patches identical
  (max delta 0) across 0/50/100° — no texture swimming on the static body.
- `bind-vs-elbow0-deterministic` — bind and elbow-0 frames mean-diff 0.000
  (softness-0 render is bit-stable; warp gated off).
- `no-phantom-cut-before-sever` — 0 cap pixels in any pre-sever capture.
- `sever-changes-render` — the sever frame differs from pre-sever at the arm
  (16 px: the cut line; the caps are edge-on from the front camera at release,
  by geometry — see below).
- `cap-visible-on-flight` / `cap-visible-on-impact` — **789 px** / **2,087 px**
  of meat-toned cap pixels, single compact component (no hollow-ring
  signature) — the complementary cut surfaces render.
- `detached-piece-separated` — settled capture: detached flesh component
  centroid **254.9 px** from the body, ≥ 300 px — the piece does not follow
  the skeleton.

## Visual-gate notes (honest)

Machine-checkable failure modes are cleared (above). The organic items that
need the owner's eye on the captures: elbow impalement at 100°, joint crease
readability, cut-profile matching (the two caps), "sever pop", and whether the
dim front lighting (the marcher's key light sits behind the camera-facing
side; pants/creases read dark) is the intended look. Two geometry facts to
know when reviewing:

1. The cut plane normal ≈ the measured elbow axis, so from ANY front camera
   the caps are edge-on **at the release frame** (the piece is coincident with
   the stump, physics paused) — the sever-frame capture is expected to show
   only a thin cut line; the cap surfaces become visible the moment the piece
   separates (flight/impact captures show them face-on, 789/2,087 px).
2. The legs read dark because the zombie's texture has dark pants — not a
   flesh-mask failure; the flesh mask deliberately excludes them.

## Test counts

- `uv run scripts/test_bake_humanoid_sdf.py -v` — **48/48** (baker + atlas +
  manifest contracts).
- Focused suites (6 files): **163/163** — pose 76 + sever 11 + volume 20 +
  wgsl 37 + view 11 + spike-main 17.
- `npm test` — **1679/1679** (112 files).
- `npx tsc --noEmit` — clean. `npm run build` — clean (humanoidSdfSpike input
  added to Vite). `git diff --check` — clean.

## Remaining blocker / next

None blocking. `TASKS.md` leaves `X1.humanoid-sever-spike` in progress with
next action "Task 8 (wound keying)". The spike is the sever gate: panels
11–17, click-to-shoot wounds, and the final owner verdict belong to Task 10.

---

# Task 10 — click-to-shoot targeting, wound contact sheet, final owner gate (2026-08-20)

Ships the wound slice's targeting half: `traceHumanoidRay` sphere-traces the
coarse CPU brick (never the bounding box), `shoot`/`shootWorld` on the
automation API, the wound panels 11–17, and the wound-scan/click-to-shoot
performance numbers.

## Targeting (`src/lab/sdf-zombie/humanoid-target.ts`)

- **Broad phase** = ray-vs-posed-occupied-OBB (the ray transformed into each
  bone's bind-local so the box stays axis-aligned and exact) → candidate set +
  entry/exit `t`. **Narrow phase** = sphere-trace each candidate's coarse brick
  in bind-local from the entry point, bisect the zero crossing (16 halvings →
  sub-millimetre), take the nearest surface crossing. The owner IS the bone
  whose field was minimal at the hit — no nearest-endpoint / occupied-box
  heuristic.
- The coarse brick is sampled on the baker's endpoint-inclusive lattice plus
  the outside-box metric distance — the exact convention `sampleDistanceBrick`
  + `mapHumanoidField` use, so CPU targeting and the GPU field never disagree.
- **POSED, not bind**: the ray is tested against `HumanoidPoseState.bones[i]`,
  and after a sever against `chunkRootPose ∘ frozenDistalBones` for the distal
  subtree. A flexed-elbow ray that hit the bind forearm misses the flexed one.
- The detached chunk is a target: its hits are flagged `detached` and route to
  the detached wound list (the severed forearm does not ignore gunfire).
- **No GPU readback** anywhere — the coarse pack stays CPU-side f32.

Pinned in 9 targeting tests + 5 controller-shoot tests (sphere/cylinder
analytic fixtures for the 5 mm surface / not-on-OBB-face / refinement
contracts; the real manifest + `zombie-coarse.f32` for owner selection, the
30 mm elbow band, the posed-ray rule and the detached-piece rule).

## Verification — live WebGPU run (29/29 gates)

Commands (lsof-verified ports, task-owned processes only):

- Vite: `npx vite --port 5277 --strictPort`.
- Chrome 151.0.7922.138 headed: `--remote-debugging-port=9223
  --enable-unsafe-webgpu --user-data-dir=/tmp/chrome-humanoid-sdf`.
- Verifier: `node scripts/verify-humanoid-sdf-spike.mjs 5277
  docs/dev-notes/2026-08-17-humanoid-sdf-sever-spike 9223`.

Result: **VERIFY PASS — 29/29 gates** (17 existing sever gates + 12 wound
gates). The ten sever/reset cycles still report identical resource counts and
no first-use frame above 16.4 ms.

Wound gates (panels 11–17, crater = meat/deep ramp pixels via the shared
capMask):

- `wound-craters-visible` — 808 / 394 / 640 / 640 / 2294 / 667 / 3218 px
  across forearm-0, forearm-100, cut-plane, sever-frame, detached-flight,
  shoulder-seam, beside-cap.
- `wound-rides-flexion` — 0°→100° moves 4,812 px with the craters intact.
- `straddling-wound-bites` — the on-plane wound's bite shows at the sever frame.
- `detached-keeps-wound` — the flight capture keeps 2,294 px of crater+cap on
  the tumbling piece.
- `shoulder-seam-no-slice` — the shoulder crater is one contiguous 667-px
  component (no cluster-seam slice).
- `no-slot-drops` — **0** slot drops across every panel; the 24-slot budget
  held at ≤12 logical wounds.

## Performance (Step 4)

- **Wound-scan cost**: steady-state frame median **16.70 / 16.70 / 16.70 ms**
  at 0 / 6 / 12 logical wounds — a zero delta (vsync-pinned wall clock; the
  clustered wound scan is ≤24 slots and is not the frame bottleneck at these
  counts).
- **Click-to-shoot trace cost**: **0.072 ms/hit** (a 200-shot burst of
  aim-and-fire through the same landmark, divided).
- **Slot-drop counter**: 0 during the whole gate — the budget did not need
  raising.

## Visual-gate notes (honest)

Machine-checkable failure modes are cleared above; the organic items that need
the owner's eye are the seven `live-wound-*.png` captures + the extended
contact sheet: skin tone must not show inside a crater, no wetness white-out
where a crater meets the cap, no crater sliced at the shoulder cluster seam,
no crater drifting off its landmark under flexion, and the straddling wound
must bite both severed halves. Panel 17 (`live-wound-beside-cap.png`) re-frames
the settled detached piece cap-face-on so the fresh crater and the settled cap
are side-by-side — the shared interior ramp is compared there.

## Test counts

- `npx vitest run` — **1738/1738** (114 files; +9 targeting + 7 controller
  shoot/API/setCameraTarget over the Task 8/9 baseline).
- `npx tsc --noEmit` — clean. `git diff --check` — clean.
