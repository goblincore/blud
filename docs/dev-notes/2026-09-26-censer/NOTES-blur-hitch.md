# Blur-layer engage hitch — root cause and measurements (2026-09-26)

## Symptom

Every censer swing hitched when the flying-gib shutter layer engaged, going from
nothing selected to something selected. It hitched again when the swing released.

## Root cause

three r186 rebuilt the render objects of every mesh that moved between the base
pass and the gib layer pass. It did this on every engage and every release.

- `RenderObjects.get()` looks up a render object in a per-**pass-id** chain map.
  The key is `(object, material, renderContext, sceneLightsNode)`.
- `RenderContexts.get()` keys a context **only** by the target's attachment
  signature (`count:format:type:samples:depth:stencil`), not by camera or target
  identity. The layer target (half-float, depth) and the base pass's capture
  target have the same signature, so they share **one** context. As a result,
  each censer mesh had **one** render object for both passes.
- The render object's dynamic cache key includes the scene lights node's key.
  The base pass sees every scene light. The layer pass sees none, because
  `camera.layers = GIB_BLUR_LAYER` culls them. The censer's own
  `material.lightsNode` list does not enter this key.
- When the key changes, `needsUpdate` is set, and three calls `dispose()` and
  then recreates the render object. `dispose()` drops the node-builder state's
  `usedTimes` to 0, which evicts it from `nodeBuilderCache`. So each flip paid
  for a full TSL node build, new shader modules and a **synchronous**
  `createRenderPipeline`.

The per-frame counters show this directly. In the censer leg, every engage
disposed and rebuilt 7 render objects on the +0 frame (4 node builds, 2
programs, 1 synchronous pipeline) and 32 more on the +1 frame, when the hand
and haft joined. The release did the same in reverse. At dispose time the
render objects' scene-light count was 0. Their initial key had been built with
the base pass's lights.

## Hypotheses tested

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| (a) targets reallocated or disposed | no | `tex+` is 1 only on the session's first engage. `ensureTargets` keeps the targets alive across empty selections. |
| (b)/(g) render objects or pipelines rebuilt per engage | **yes** | `ro-`/`ro+` 7 then 32, with node builds and a sync pipeline on every engage and release (see Root cause). |
| (c) synchronous readback | no | No `mapAsync` on engage frames. The occasional one is timestamp or telemetry traffic, which also appears on idle frames. |
| (d) seed re-uploaded | steady cost, not a spike | 1.92 MB `writeTexture` on **every** blurred frame, not only the first. |
| (e) shadow or env re-render | no | No extra passes or targets on engage frames. |
| (f) the censer's own light list | not the trigger | `material.lightsNode` is an object-valued material prop, so it adds only `{}` to the material key. The flip comes from the **scene** lights key. The relist's `setLights` fired once, about 1 s in, with no stall. |

Controls, with the world render-locked and `select([subject])` or `select([])`
called directly:

- **A trivial `MeshBasicNodeMaterial` / `MeshStandardNodeMaterial` cube on
  layer 0** reproduces the same churn on every engage: `ro-` 1, node build 1,
  sync pipeline 1. A trivial material rebuilds in a few ms, so the frame barely
  moves. The cost scales with material complexity times mesh count. The censer
  has 39 `MeshStandard` meshes with envMaps.
- **A lone spinning gib** does **not** churn. Its base draw is the sdf-layer's
  march pass, a different context. It costs about 10 ms of steady GPU per blurred
  frame, and no edge spike.

## Fix

`gib-shutter-layer.ts` `capture()` draws the layer pass through
`renderer.setRenderObjectFunction(drawInLayerPass)`. This is the default
`renderObject` with `passId = GIB_SHUTTER_PASS_ID` (`'gib-shutter'`), and the
previous function is restored in `finally`. The layer draw gets its own chain
map, so each mesh has a base render object and a layer render object. Each keeps
a stable key, and both are built once.

Pure tests are in `gib-shutter-layer.test.ts`:

- The real three `RenderObjects` cache is driven with the light-key flip. In the
  shared default pass, 5 engage/release cycles produce 11 render objects. Under
  the pass id they produce 2.
- `capture()` draws the layer through the pass id and restores the previous
  function.

## Measurements

Headless Chrome, night-train, 1280x800, hand-stepped `step(1, 1/60)` with a
`queue.onSubmittedWorkDone()` fence. Probe: `.lab-tmp/hitch.mjs` (untracked).

### Censer swing: first 5 frames after the layer engages (ms, wall)

| engage | before +0 | +1 | +2 | +3 | +4 | worst in swing | after +0 | +1 | +2 | +3 | +4 | worst in swing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (first of session) | 104.9 | 74.0 | 37.7 | 37.2 | 35.4 | 127.5 | 99.6 | 65.8 | 26.3 | 27.3 | 29.4 | 99.6 |
| 1 | 73.4 | 50.4 | 34.9 | 33.2 | 30.6 | 120.1 | 29.9 | 30.1 | 31.8 | 29.7 | 30.0 | 33.3 |
| 2 | 70.3 | 50.2 | 34.1 | 36.2 | 34.7 | 120.4 | 30.6 | 28.9 | 28.9 | 28.5 | 29.7 | 31.3 |
| 3 | 69.3 | 49.8 | 33.7 | 34.6 | 34.3 | 118.2 | 30.8 | 30.8 | 31.1 | 30.5 | 30.4 | 38.6 |
| 4 | 70.1 | 49.4 | 31.1 | 31.2 | 30.5 | 112.6 | 23.2 | 21.9 | 22.4 | 21.2 | 20.4 | 37.0 |
| 5 | 70.5 | 51.2 | 23.5 | 24.5 | 27.2 | 116.7 | 31.6 | 21.5 | 20.4 | 20.6 | 20.8 | 34.8 |

- Pre-engage median: 31.1 ms before, 28.7 ms after.
- Worst frame per swing with **blur off**: 37–43 ms.
- CPU on the +0/+1 frames of engages 1–5 fell from about 67/49 ms to about
  13/13 ms.
- The layer's `capture()` span fell from about 55/36 ms to about 1/1 ms.
- "Worst in swing" before the fix is the **release** frame, where the base
  pass's render objects are rebuilt. After the fix it is at blur-off level.

### Lone spinning gib: first 5 frames after engage (ms, wall)

| engage | before +0 | +1 | +2 | +3 | +4 | after +0 | +1 | +2 | +3 | +4 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 37.7 | 39.1 | 36.2 | 34.9 | 34.6 | 46.9 | 42.6 | 38.5 | 33.4 | 31.2 |
| 1 | 35.2 | 33.1 | 36.4 | 30.7 | 34.2 | 30.3 | 30.1 | 33.3 | 30.9 | 31.3 |
| 2 | 33.1 | 32.4 | 31.2 | 31.1 | 31.7 | 29.1 | 29.0 | 33.2 | 32.5 | 33.2 |
| 3 | 33.0 | 32.8 | 35.9 | 31.5 | 31.8 | 46.2 | 45.3 | 43.7 | 42.7 | 34.4 |
| 4 | 31.4 | 33.4 | 31.0 | 30.7 | 31.0 | 50.0 | 45.4 | 41.3 | 33.3 | 44.0 |
| 5 | 31.2 | 32.2 | 30.8 | 31.3 | 31.1 | 59.1 | 55.2 | 40.1 | 29.9 | 29.6 |

- Pre-engage median: 20.2 ms before, 26 ms after.
- No render-object churn in either run.
- CPU was flat at 8–10 ms in both runs. The after-run variance is GPU-side
  wall-time noise; the CPU and counters are unchanged.

## Left over

- **First swing of a session still costs about 100 + 66 ms.** The censer's
  layer-pass render objects are built cold: 8 node builds and 4 synchronous
  pipelines. This is the reviewer's I2. The fix is a background precompile.
  - It **must use clones** of the censer meshes, not the live ones.
    `compileAsync` always uses the default pass id, so compiling the live
    meshes against the layer target makes a default-map render object that the
    base pass immediately flips and disposes. Disposing it evicts the warmed
    node-builder state.
  - Clones that are never drawn keep the lights-free node-builder state and
    pipeline cached. The live layer-pass render objects then hit that cache.
  - The instanced chain keys on `object.uuid`, so the chain still builds once.
- **1.92 MB seed `writeTexture` per blurred frame** (hypothesis d) is a steady
  cost, not a hitch.
- **Censer `relist()`** fired `setLights` once about 1 s in, with no stall. It
  checks only `l.visible`; the muzzle flash hides via its parent group.
  - The material key does not see a light-list change, because object-valued
    props hash as `{}`.
  - Whether a changed list is picked up by the censer shader at all is
    unverified.
