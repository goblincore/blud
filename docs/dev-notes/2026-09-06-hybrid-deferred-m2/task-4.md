# M2 Task 4 — Explicit flashlight shadow maps and receiver-aware sampling

Branch: `codex/dispatch/2026-09-06-hybrid-deferred-m2-task-4-continue-2`
Commit chain: `36494add`/`6ef63068` (original task: maps + receiver-aware PCF) → `1674c770` (continuation 1: analytic fixture geometry, owned shadow-pass render state, per-source-side depth materials, single-map PCF branch) → `21c16c73` (continuation 1 pre-timeout save: validated geometry + 7 GPU checks, mask/driver bugs saved as evidence) → `4dc1c516` (continuation 2: evidence-bug fixes + transition-only disable clear) → this commit (report + final evidence).

## Status

**Complete.** All acceptance criteria pass on real Chrome WebGPU: 10/10 gate assertions, three labelled screenshots, sampled masks with coordinates, `pass: true` in `task4-shadow-check.json`. Focused tests 231/231 green across the deferred family; `tsc --noEmit` clean.

The two earlier runs exited 124 (dispatch timeouts) — **not** rate limits. Continuation 1 had in fact made the geometry valid and reached 7 passing GPU checks; continuation 2's work was confined to the coordinator's read-only diagnosis: five evidence bugs in the check driver (plus one more found on the way), not in the renderer.

## Shipped interfaces

### `deferred-shadows.ts` (new)

```ts
createDeferredFlashlightShadows(renderer, { size: 1024 }) => {
  update(scene, light: THREE.SpotLight,
         { enabled, fullCasterLayers, levelCasterLayers }): void;
  binding(lightIndex, samplingEnabled?): DeferredFlashlightShadowBinding;
  diagnostics(): { renderedMaps; fullCasters; levelCasters; size; enabled; unsupported[] };
  targets: { full, level };   // owned R32F readback seam
  dispose(): void;
}
```

- **Two 1024×1024 maps, one light.** Both maps share one perspective light camera (pose/cone from the spot, WebGPU projection synced to the renderer coordinate system); they differ only in which casters rasterise: `full` = level + inflated character proxies (`SHADOW_HULL_LAYER`), `level-only` = level only. Receiver-bit decoding in the layer picks the map per surface, so a character's own hull cannot swallow its illumination while still casting onto the room.
- **Depth as colour.** Projected clip depth (`z/w`, computed per fragment from `positionWorld`) in R32F colour attachments next to real hardware depth; nearest filtering, `NoColorSpace`, far cleared to 1 (R32F is unfilterable in core WebGPU — which the manual 3×3 PCF kernel requires anyway; kernel radius and bias are named constants `FLASHLIGHT_SHADOW_KERNEL_RADIUS = 1`, `FLASHLIGHT_SHADOW_BIAS = 0.0025`).
- **Explicit raster passes, owned renderer state.** No reliance on three's shadow traversal; `update()` runs before the layer render each frame (current-frame light motion). Each pass forces `autoClear/autoClearColor/autoClearDepth`, clears MRT to null, sets far clear colour, and restores everything in `finally` (throw-safe, unit-tested including the disable-path clear).
- **Source-referencing clones.** Casters are never reparented; per-map clone meshes share the source geometry (and the very `instanceMatrix` attribute for instanced meshes), with matrix copied from the source's current `matrixWorld` each update. Alpha cutouts reproduce the source's own map + alphaTest via a cached depth material. Skinned/Batched meshes are skipped and NAMED in `unsupported` (never silently boxed).
- **Eligibility is the existing one:** visible chain + `castShadow` + layer-mask intersection. The shrunken occlusion hull (`castShadow false`) never casts — verified on device by the no-self-shadow check.
- **Disable semantics:** `enabled: false` skips both renders (zero submissions) and clears both maps to far exactly once per enable→disable transition. Continuation-2 fix: the gate is now `lastEnabled` (a transition), not `mapsValid` — the old gate re-armed `mapsValid` and re-cleared both targets on *every* disabled frame, contradicting the zero-submissions contract. New unit test pins enabled→disabled→disabled clears/renders; the existing boot-disabled test covers first-boot clearing via `binding()`'s `!mapsValid` guard.

### `deferred-layer.ts` changes (task scope, unchanged in continuation 2)

`setFlashlightShadow(binding | null)`; null stays the M1 default. Receiver-aware sampling in the light stage: one selected map per receiver (no invalid-texture handles, no double loads), bounded 3×3 PCF, outside-frustum samples unoccluded, visibility applied **only** to the designated flashlight contribution — ambient/emission/other lights stay outside the multiplication. `diagnostics()` reports `flashlightShadowBound` / `flashlightShadowEnabled`.

## GPU evidence (real Chrome WebGPU, headless, ports 5336/9336)

`task4-shadow-check.json` — `pass: true`, 10 checks, `errors: []`:

| check | result |
| --- | --- |
| boot-clean | no page/WebGPU errors |
| caster-counters | 2 maps, 7 full / 6 level casters (exactly the inflated hull is full-only), `unsupported: []` |
| null-binding-m1-default | bound+sampling-off hash `7cbb9112` == null-binding hash |
| map-content | both maps hold real depth (min 0.897, max 0.989, **0** far texels of 1 048 576) |
| sampling-changes-output | on `90102336` ≠ off `7cbb9112` |
| flesh-level-occlusion | 1487 px of slab-occluded flesh darken to ratio **0.073** (level-only map contains the slab) |
| no-hull-self-shadow | 2405 px of clear flesh stay lit, ratio **0.991** (shrunken hull never casts, inflated hull doesn't self-shadow) |
| proxy-shadow-on-stone | 539 darkened proxy-explained px (recall 0.851, precision 0.933), largest 4-connected component **337 px**, centroid + 24 sample coords retained |
| same-frame-light-motion | one step after the camera/light flip: binding matrix changes, world-space proxy shadow flips **−2.04 → +1.93** in the SAME frame, screen centroid moves 69 px |
| map-render-ablation | disabled → `renderedMaps 0`, off output equals the same-pose sampling-off baseline (`e6d53eaf`); re-enable → 2 maps, sampling darkens again (no lockout) |

Screenshots: `task4-shadow-on.png` (slab band across the body, proxy streak on the floor, cutout patch on the wall), `task4-shadow-on-moved.png` (light flipped to −x; shadow follows same-frame), `task4-shadow-off.png` (sampling off, generation still on — unbroken flashlight pool). Visual inspection confirms each capture matches its label.

## Continuation-2 fixes (coordinator-diagnosed evidence bugs)

All five confirmed real and fixed; plus a sixth found the same class:

1. **Floor mask gated on the shading normal** — `computeMasks` required `normal.y > .9`, but floorCobble carries a normalMap, so valid floor pixels were dropped before the coherence flood fill (saved run: 539→330 proxy px fragmented into 56-px components). Floor is now the **geometric** y≈0 plane (tol 5 mm) bounded by the room extent on the mesh class; the normal attachment is no longer read. Assertions unchanged (and now passing: 539 px, 337-px component, recall 0.851).
2. **Stale counters** — `setMaps(false)` then `diagnostics()` without a stepped frame read the previous frame. Every counter read now follows a stepped frame (`litHash()` steps; explicit `step()` before others).
3. **Cross-pose ablation baseline** — the moved-camera off-hash was compared to the boot-pose null hash. A sampling-off baseline is now captured at the current pose before generation-off comparison (both `e6d53eaf`).
4. **Unlabelled capture state** — `capturePair()` left sampling OFF, so `task4-shadow-on*.png` were actually off. `capturePair()` now restores sampling on; every labelled screenshot is preceded by `assertCaptureState(label, …)` asserting layer/shadow diagnostics.
5. **`pass` serialized before it was set** — success runs recorded `pass: false`. Now set before the write; the failure record keeps first AND moved pair evidence, and `bootDiag` no longer risks a TDZ ReferenceError.
6. **(new, same class)** `screenshot()` read `shot.data` instead of `shot.result.data`, so `Buffer.from(undefined)` killed the run right after the passing checks — this is why both earlier runs saved zero PNGs. Fixed with an assertion on the payload; this also explains the earlier "timeout" evidence pattern better than any time-budget theory.

Also fixed in the driver page: `worldOf` reconstructed from pixel **centers** (+0.5 texel), removing a ~5 mm classifier bias.

## Honest limitations

- The GPU gate is a fixed fixture (stone room + slab + zombie + hull + cutout), not gameplay. In-game shadow feel (weapon rigs, viewmodels, multiple actors) is task-5+ territory; the factory takes arbitrary scenes but has only been exercised on this fixture and unit fixtures.
- SkinnedMesh/BatchedMesh casters are skipped and named, not rendered — no skinned casters exist in the deferred path yet, so the limitation is latent.
- Cutout depth assumes identity texture transform (documented in code); the game's cutout casters currently satisfy this.
- The flashlight contribution multiplies existing ambient/emission/practical lighting without a dedicated flashlight-isolation frame in this run — accepted because the mask no longer fragments (the coordinator's isolation instruction was conditional on continued fragmentation) and the clear-flesh ratio 0.991 plus the unchanged practical glow in on/off captures shows other terms are not shadowed.
- PCF radius 1 (3×3) is intentionally hard-edged; no penumbra tuning was done.
- Shadow maps update every frame while enabled (two 1024² passes); no update-rate scaling or caching — fine for the fixture, unmeasured in game scenes.

## Verification commands

```
NODE_OPTIONS=--no-experimental-webstorage npx vitest run \
  src/lab/sdf-zombie/webgpu/{deferred-layer,deferred-lighting,deferred-mesh,deferred-surface,\
deferred-sdf,deferred-shadows,game-deferred-scene,game-deferred-lights,lab-renderer,\
occluder-hull,zombie-gpu}.test.ts --maxWorkers=2 --minWorkers=1   # 231/231
npx tsc --noEmit                                                   # clean
LAB_VITE_PORT=5336 LAB_CDP_PORT=9336 scripts/deferred-shadow-check.sh   # 10/10, servers stopped
```
