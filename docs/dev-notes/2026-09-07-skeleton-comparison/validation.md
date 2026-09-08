# Skeleton comparison capture harness

Status: harness implemented; GPU execution and visual judgment are coordinator-owned and have not run here.

`scripts/skeleton-compare.mjs` boots the real game page once per requested representation and render scale, verifies WebGPU plus a representation-specific active-path diagnostic, freezes simulation and the practical-light clock, render-locks the frame, and fences the GPU before capture. It saves two intact captures and checks their PNG hashes before adding one controlled torso wound and saving the wounded frame. A repeatability mismatch marks that run failed and unsuitable for parity, but does not skip its wound smoke or later modes. Runtime exceptions, `console.error`, CDP error log entries, and HTTP responses with status 400 or above fail the affected run. Log and HTTP evidence retain the resource URL and network request identifier so missing assets can be diagnosed precisely. The one exception is an exact 404 for `http://localhost:<vitePort>/favicon.ico`, the browser tab icon: both its Network and Log records remain in evidence as non-rendering warnings. No other 404 or resource is ignored. Warnings are retained in evidence for review.

The script uses one CDP tab created by the script, closes only that tab, and bounds every CDP request, boot poll, WebSocket connection, and the overall run. `validation.json` is rewritten after each material step, including failed boots, so a timeout or shader error leaves reviewable partial evidence.

Run it only after the coordinator has started owned Vite and Chrome instances on private ports:

```bash
node scripts/skeleton-compare.mjs 5396 9396 /tmp/skeleton-compare
```

Useful bounded subsets:

```bash
SKELETON_MODES=procedural,mesh SKELETON_SCALES=1 \
  SKELETON_OVERALL_MS=120000 node scripts/skeleton-compare.mjs 5396 9396 /tmp/skeleton-compare-smoke
```

Set `SKELETON_LIFECYCLE=1` to add a volume-only lifecycle smoke before capture. It advances 20 manual simulation steps and requires all volume residency and bake diagnostics to remain unchanged. It then changes `boneRatio` by a tiny amount, requires exactly one atlas rebuild with unchanged live actor/atlas/grid counts, and restores the original ratio before capture with the same assertions. Both intentional rebuilds are recorded; ordinary animation must not rebuild the atlas.

Output names encode mode, render scale, and fixture. The JSON records branch/commit, URL, viewport, SDF scale, actor/camera pose, lighting freeze, diagnostics, errors, capture byte counts, and SHA-256 hashes.

This is functional and visual evidence only. It does not collect wall-clock frames, GPU timestamps, bake latency, upload cost, memory, median/p95, or any other performance data. Do not infer a speedup or production FPS from it. It currently covers an intact actor and one controlled torso wound at scales 1 and 0.5. Head, pelvis, rib, bent-joint, sever, soldier transfer, darkness/wet-light variants, and visual inspection remain Task 4 coordinator work.

When available, `__sdfGame.skeletonDiagnostics().activeMode` must equal the requested representation. Mesh mode additionally requires `__sdfGame.skeletonMesh()` to report `mode: "mesh"` and a positive segment count. Volume mode requires a volume-specific or combined diagnostic with a positive grid/sampled/active segment count. When present, `__sdfGame.skeletonVolumeEvals()` is also recorded so fallback rate can be reviewed. If the volume integration has not supplied the active-path seam, the run fails explicitly instead of capturing procedural fallback and labelling it volume. For older snapshots without the combined diagnostic, procedural mode is accepted only when both candidate diagnostics are absent and the separate polygonal bone-tube debug path is off.

Exact mesh-to-procedural pixels are not an acceptance criterion. Fewer ribs, improved skull geometry, and other intentional anatomy changes may be acceptable. Review captured images for clipping, skeleton leaking through intact flesh, broken wound reveals, and distracting shading differences.
