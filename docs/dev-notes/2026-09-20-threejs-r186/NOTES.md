# three.js r186 — what it means for us (2026-09-20)

The bump (`b067bc9d`, main) is the dependency plus one source fix
(`a368f684`, post-aa: stop re-wrapping the vec4 fire resolve/composite results).

## Verified here

- **Pixel-identical.** With the r186 install, the gate gives the canonical line
  in BOTH rooms: room1 `8f2b74e7…` (repeat identical, wounded `1381a866…`),
  room2 `35b6d561…`. So the march pins and the phase-2 baselines carry over —
  no re-pinning, and phase-2 tasks 3–6 can compare against task 1's row.
- `npx tsc --noEmit` clean against `@types/three` 0.186.

## Boot timing: NOT attributable, and worth remembering why

Warm census on r186 (6 runs): `warmMs` 2526–3031, `drawOnce` 1705–1876.
Task 1's r185 baseline, same script, same machine, ~9 h earlier: `warmMs`
1762–1779, `drawOnce` 1226–1250. That looks like a ~40% regression — but a
control run of the tree WITHOUT the phase-2 `MarchIn` change, on the same r186
install, was SLOWER STILL (`warmMs` 3110–3600, `drawOnce` 1899–2309).

So the spread tracks WHEN the numbers were taken, not WHAT was in the tree.
Boot timings on this machine are not comparable across sessions (same lesson
the march-hash bistability taught: the capture path is sensitive to machine
state). **A real r185-vs-r186 answer needs the two installs measured
INTERLEAVED in one session**, which means a second `node_modules` — not the
shared symlink every worktree uses. Filed rather than guessed.

## r186 features against our goals (checked in the installed source, not the notes)

| Feature | Verdict |
| --- | --- |
| `DirectRenderPipeline` | **Not usable on the game path.** Its own doc: it avoids the intermediate framebuffer and output pass, "is not compatible with materials that sample the framebuffer". Our post-AA / upscale / VHS chain does exactly that. Possibly interesting for a bare lab page. |
| `compileComputeAsync()` (`Renderer.js:1115`) | **Worth trying.** We have one compute node on the boot path (`probe-gather-compute.ts` → `renderer.compute`). Async compile keeps it off the blocking path, in the same spirit as the 2026-09-19 gib/crowd deferral. |
| Bind-group cache key hardening, shared-UBO refresh, stale storage-buffer fix | Relevant to the crowd path (many near-identical material instances that the driver dedupes). No action, but if crowd draws start mis-binding, this is the first place to look. |
| TSL "build CodeNode includes as references" (#34132) | **Corrected 2026-09-20 (second pass): NOT a size lever.** Read the PR: includes are now built with the `property` output so a `TextureNode` used as a native WGSL include declares its binding without emitting a default sample (the bug was a spurious `uv` requirement). At most one dead sample line per texture include disappears; the 243 KB program text and its compile time are untouched. Do not spend the A/B on it. |
| `packed_4x8_integer_dot_product`, atomics in non-compute stages, 4x8 pack/unpack | Nothing we need today. |

## Second pass (2026-09-20) — the full changelog, read against the cold-compile work

Read from the [release notes](https://github.com/mrdoob/three.js/releases/tag/r186)
plus the PRs themselves; `RaymarchingBox` (#34257) is not used anywhere in `src/`.

| Feature | Verdict |
| --- | --- |
| `renderer.debug.onNodeBuilderCreated(builder, target)` (#34068) | **Best new tool for us.** Fires for every shader build (sync, async, deferred) BEFORE the build, with the `RenderObject` / compute node. Gives build attribution and generated-code size without `pipeline-log.ts`'s device wraps + module hashing. It does not replace the pipeline-CREATION timing (the 50–150 s cost is only visible at `device.createRenderPipeline*`), but it is the clean way to watch `MARCH_BODY` emitted size through march phase 2. |
| `compileAsync(scene, camera, target, onProgress)` | **Cheap UX win.** Per-object `ProgressEvent` (`Renderer.js` compileAsync loop). The cold loader sits silent for 50–160 s — the silence is what made the cold-cache flesh bug read as a hang. Thread it from `sdfLayer.precompilePasses` into `setLoader`. Seen in source, not yet tried. |
| "Do not render shadow maps when precompile" (#33924) | **Behaviour change on our boot path — verify once.** `compileAsync` no longer renders shadow maps as a side effect, so the flashlight / level shadow-map pipelines are warmed ONLY by `drawOnce`. Expected to be true already (that is why `drawOnce` exists); confirm with a pipeline-log census that nothing shadow-related is created on the first live frame. |
| MRT per-attachment clear colours (#34250) | Small cleanup. The march MRT's documented trap (a cleared attachment carries the clear colour's alpha, so hits gate on depth alpha) can become a proper sentinel per attachment. |
| Inherited fixes: `compileAsync()` crash when a tracked material is disposed mid-flight (#34378); `NodeMaterialObserver` stale render-object cache (#34076); stale storage-buffer attributes (#34388) | No action. #34378 is directly on the background gib compile's path (throwaway chunk view added, compiled, disposed). |
| `PCFSoftShadowMap` removed (silently falls back to `PCFShadowMap` with a warning) | No action: the game already sets `THREE.PCFShadowMap` (`game-main.ts:788`). |
| `SunLight`/CSM, `vxgi`, light-probe grids, splat loaders, `softParticles()`, `batchIndirectIndex`, `CountingSort` | Not for us (baked room probes cover GI and are what ports to wgpu; GPU sort only if tile binning ever moves fully GPU-side). |

**Net:** nothing in r186 touches the real startup cost — three or four
near-duplicate ~240 KB march programs at 50–150 s each cold (measured
2026-09-20: body 103 s + 55 s behind the loader, gib 264 s in the background).
That lever is ours: merge crowd+body, shrink `marchBody`.
