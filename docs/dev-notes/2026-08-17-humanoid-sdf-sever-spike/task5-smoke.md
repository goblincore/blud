# Task 5 smoke — clustered humanoid marcher (2026-08-19)

Headless-proof-of-life for the Task 5 WGSL (humanoid.wgsl.ts + humanoid-view.ts)
before commit. WGSL type errors live in template strings and are invisible to
vitest + tsc, so a live WebGPU compile is the only honest gate (the
X1.26 march.wgsl lesson).

## Method

Temporary bootstrap `humanoid-smoke.html` + `src/lab/sdf-zombie/webgpu/
humanoid-smoke-main.ts` (deleted before commit; Task 7 ships the real page):
load the checked-in `zombie-humanoid.json` + atlases through
`loadHumanoidVolume`, build the view through `createHumanoidView`, render via
`createLabRenderer`. Driven by `scripts/humanoid-task5-smoke.mjs` (Node 22
native-WebSocket CDP) against a headed Chrome 151 with
`--enable-unsafe-webgpu`.

## Result — PASS

- Backend: `webgpu` (adapter present, `renderer.backend.isWebGPUBackend`).
- Shader/GPU console errors: **0** (no `compil`, no `GPUValidationError`, no
  `Uncaught`).
- resourceCounts: `{materials:7, geometries:7, textures:1, attachedClusters:6,
  detachedClusters:1, compileCalls:0}` — one material+geometry per cluster
  proxy plus the hidden detached right-arm proxy, one shared descriptor texture.
- Non-blank: every capture shows a coherent humanoid silhouette (head →
  shoulders → waist → legs), ~51k non-background pixels, luma std ~10.6.
- Elbow flexion is localised: elbow 0→100° changes ~3.7k pixels confined to the
  right-arm region (bbox ~130×90 px), and the flesh-pixel count moves
  monotonically (32648 → 32377 → 31777) — the forearm rotates, nothing else
  swims.
- At rest (two elbow-0 captures) the frame is bit-stable — no warp/pump at
  softness 0 (surfaceWarp is gated to zero by its own amplitude).

## Captures

- `live-bind.png` — bind pose (elbow 0°).
- `live-elbow-50.png`, `live-elbow-100.png` — 50° and 100° flexion.

Visual gates that need a human eye (mirrored texture, elbow impalement, proxy
clipping) are deferred to Task 7's owner review; this smoke rules out the
compile/blank/warp/pump failure modes that are machine-checkable.
