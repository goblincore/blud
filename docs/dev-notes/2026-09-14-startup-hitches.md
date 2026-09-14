# Startup / room-entry hitches — attribution and fixes (2026-09-14)

Owner report (live play, crowd default, branch `merge/crowd-default-flip`):
**5–8 s freezes at startup and when entering rooms**, feeling like shader
compilation. Console at that moment showed the `[warm] pipelines compiled`
line, a `requestAnimationFrame handler took 2360ms` violation, a
"Draw with an index count of 0" note, and the
`THREE.WebGPUTimestampQueryPool [compute]: Maximum number of queries
exceeded` warning.

The 2026-09-13 warm-up work (commits `2539d90c`, `3c1480f1`) had verified
clean **headless, staged, loop paused** — exactly the configuration that
cannot see these hitches. This task instrumented pipeline creation, ran the
**real loop** (new probe, `scripts/startup-hitch-probe.mjs`), attributed,
then fixed what was named. Instrument: `src/lab/sdf-zombie/webgpu/pipeline-log.ts`
(wraps the backend device's four `create*Pipeline` methods — the choke point
every creation path ends in — names each from three's descriptor label,
records the frame it started in, keeps a session-wide slowest-16, counts
`renderer.compute()` calls per frame); the lab-renderer loop reports each
presented frame's wall ms so any frame ≥ 100 ms keeps the creations that ran
inside it. Opt-in: `?pipelinelog=1` / `__sdfGame.setPipelineLog(true)`, read
via `__sdfGame.pipelineLog()`.

## Attribution (before any fix)

Quiet machine, headless, ship defaults, 600 live frames with teleports
2→3→1 every 150 frames. **Both paths** paid one long frame at the first
presented frame after the warm:

| leg | warm ms | long frames (600 fr) | worst frame | creations in it | what they are |
| --- | ---: | ---: | ---: | ---: | --- |
| crowd (default) | 780–3832 | 1 | **780–1636 ms** (frame 4) | 68 | 24× `computePipeline` (crowd tile-bin kernels), gun (`Steel`, `plate`, ~20 `MeshBasicNodeMaterial`), 2× `ShadowMaterial` (level-shadow pass), `post:vhs-input` (VHS chain), level materials |
| `?crowd=0` | 823–954 | 1 | **794–1081 ms** (frame 4) | 57 | same minus the 24 compute pipelines |

Causes, in the order the fixes land:

1. **WRONG CONTEXT (the big one, crowd-independent).** The 2026-09-13 warm
   compiled via `compileAsync(scene, camera)` against the **canvas**, but the
   live draw renders the main scene into post-aa's **HalfFloat `sceneTarget`**
   (`game-main.ts:1311` → `post-aa.ts:507`). Attachment formats are part of
   three's pipeline cache key, so *every* main-pass pipeline re-created at the
   first present — the gun/level/shadow/VHS set above. The warm's products
   were, for the main pass, unused.
2. **COMPUTE never warmed.** The warm only compiles render pipelines. The
   first crowd sync created all **24 tile-bin compute pipelines** (6 types ×
   4 kernels) mid-frame.
3. **Timestamp pool (the console warning).** `lab-renderer`'s loop drained
   only the render pool. three keeps a **separate compute pool** (2048
   queries); at 24 compute passes/frame it overflows in ~43 frames and
   `warnOnce` fires — the owner's console line. (Our probe runs already had
   the fix below, so this was never observed live here; the arithmetic and
   the owner's console agree.)
4. **Idle crowd compute.** Every type binned its tiles every frame — 6–7
   `renderer.compute()` calls/frame with most types off-screen.

**Room entries: teleports never produced a compile hitch** in any run (frames
~150/300/450, both paths, pre- and post-fix): rooms share materials, the
per-room probe bakes land at boot (worker), and all six crowd types'
materials are compiled at warm. The owner's room-entry freezes were **not
reproduced** headless; see Residuals.

Answer to the parallel question ("does `?crowd=0` show the same hitches"):
**yes** — the dominant startup frame is crowd-independent (57 vs 68
creations); the crowd adds the 24 compute pipelines plus per-frame idle
dispatches, not the freeze class itself.

## Fixes (one commit each)

1. **`perf(startup): warm the pipelines the first live frame actually builds`**
   (`game-main.ts`): the warm pauses the loop, awaits the gun (its materials
   and lights enter the scene with it), runs one **empty-group tile-bin per
   crowd type** (compiles the 24 compute kernels), then draws **one real
   frame** via `handle.drawOnce()` — the full live path (scene into
   `sceneTarget`, sdf layer, goo, post chain incl. VHS) — so everything
   compiles in the render context it will actually run in, behind the loader.
   `ORDERING MEASURED`: `drawOnce` must run **before**
   `sdfLayer.precompilePasses`. The march pass's `compileAsync` *queues* the
   crowd material's pipeline for async creation; a queued pipeline reads
   not-ready, so a later real frame **skips the crowd march**, and under load
   the queued creation settled **51 s late** (probe slowest-creation record) —
   a boot window with no crowd at all. Drawn first, the crowd pipeline is
   created synchronously inside the march submit and the passes become
   cache-hit confirmations (passes: 10 → 11, no timeout).
2. **`perf(crowd): idle types skip the tile-bin compute`** (`crowd-type.ts`):
   `sync()` skips `tiles.bin()` (and the attribute pack) when the type has no
   drawn instance this frame; stale tile lists are unread (boxes draw
   instanceCount 0; quad rect null hides the meshes) and the next drawing
   frame re-bins before drawing. Counted in `info().idleSkips`, surfaced
   through `__sdfGame.crowdInfo()`. Census: 6–7 → **2–3** compute calls/frame.
3. **`perf(gpu): resolve the COMPUTE timestamp pool every frame`**
   (`lab-renderer.ts`): drain both pools per loop tick (each with its own
   in-flight guard; an idle pool returns immediately).

## After (same probe, same machine)

| leg | warm ms | long frames (600 fr) | worst frame | compute max/frame | pool warnings |
| --- | ---: | ---: | ---: | ---: | ---: |
| crowd (default) | 4367 | **0** | — | 9 (first frame), 2–3 steady | 0 |
| `?crowd=0` | 1482 | **0** | — | 1 | 0 |

The warm itself now costs ~4.4 s on the crowd path (was ~1.1 s of compile +
~0.8 s first frame + the async tail): the first-live-frame cost moved behind
the loader, where it always should have been. Still bounded by the 15 s race
(`?warm=0` skips).

Gates: `npx tsc --noEmit -p .` clean; `node scripts/march-hash.mjs` crowd
canonical `a350361d…` ×2 and `MARCH_HASH_PERBODY=1` = `a8ab4efa…` unchanged;
`MARCH_PARITY_TILES=1 node scripts/march-parity.mjs` PASS (quad, tiles on,
mask/flat-RGB exact); `BENCH_FRAME_CAP_MS=250 BENCH_PASSES=1
BENCH_REPEATS=1 BENCH_ROOMS=2 BENCH_LEGS=baseline node
scripts/sdf-game-bench.mjs` runs clean, census and frame hash identical.

## Residuals / not fixed here

- **One benign Dawn warning per boot**: `Draw with an index count of 0 is
  unusual`. Present before and after, once per session, now lands inside the
  warm. Suspect: the impact-splash sheet/membrane geometries, which ship
  `setDrawRange(0, 0)` and empty index buffers. While tracing this I noticed
  the splash **sheet and membrane meshes are created `visible = false` and
  never re-visible** (`impact-splash.ts:1115-1116`) — the splash visuals ride
  the droplets/mist/sprites; if sheets are meant to render, that is a separate
  pre-existing bug worth its own ticket.
- **Room-entry freezes not reproduced**: no compile hitches on teleport in
  any run; probe bakes land at boot. The owner's 5–8 s room-entry figures
  remain unexplained by pipeline creation on this headless setup — remaining
  suspects are environmental (thermal/contended GPU, headed compositor) or
  the tile-density GPU-wedge class (the perf-7d hazard, capped by
  `budgetFit`), not first-use compilation. If they persist after this fix,
  the probe reproduces the room-entry drive; the next instrument is the GPU
  timestamp table over a room transition, not pipeline logging.
