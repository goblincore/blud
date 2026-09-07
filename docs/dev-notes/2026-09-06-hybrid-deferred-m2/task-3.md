# M2 Task 3 — Route game materials and build a stable shared light list

Branch: `codex/dispatch/2026-09-06-hybrid-deferred-m2-task-3-continue-1`
Commits: `fd8e1eed` (router + light list + receiver metadata) → `e71e34ad` (pre-timeout save) → `52711bf6` (fixture fixes per coordinator review) → `4eca668e` (GPU gate green + evidence).

## Status

**Complete.** All acceptance criteria implemented; focused tests 124/124 green; `tsc --noEmit` clean; real-WebGPU gate 9/9 assertions pass. The original task-3 run timed out (exit 124) on GPU-fixture debugging; this continuation diagnosed the fixture (not the renderer) as the blocker, per the coordinator's read-only review.

## Shipped interfaces

### `game-deferred-scene.ts` (new, 425 lines)

```ts
export type GameDrawRoute = 'mesh' | 'sdf' | 'forward' | 'exclude';
createGameDeferredScene(scene: THREE.Scene) => {
  register(object, route, receiver?: ShadowReceiver): void;
  unregister(object): void;
  sync(): void;                    // discovers late/async descendants, prunes disposed
  draw('mesh'|'sdf'|'forward', renderer, camera): void;
  diagnostics(): { counts: Record<GameDrawRoute, number>; unsupported: string[] };
  routeOf(object): GameDrawRoute | null;
  dispose(): void;
}
```

- `draw` renders the ORIGINAL objects into the layer's producer targets using scoped visibility swaps; `onBeforeRender` callbacks and material references are restored in `finally` (throw-safe). No reparenting.
- Standard materials get **cached** MRT adapters (cache keyed per material instance); mapped alpha-cutout (`alphaTest`) survives the adapter; transparent blending keeps the forward route.
- Only registered `mesh`-route node materials with surface support enter the MRT pass; unknown custom materials are kept out and named in `diagnostics().unsupported` (e.g. `unsupported-mesh ← MeshBasicNodeMaterial`).
- Registration of a parent propagates its receiver policy to descendants discovered by later `sync()` calls; an explicit child `register` overrides the inherited policy.
- GROUPs route through their children (the failed run's fix — groups are no longer reported unsupported as a whole; preserved and covered by the GPU kit-group case).

### `game-deferred-lights.ts` (new, 199 lines)

```ts
export interface GameLightCandidate { id: string; role: 'flashlight'|'muzzle'|'practical'; light: THREE.Light; }
buildGameDeferredLights(candidates, cameraWorld) => {
  lights: DeferredLight[]; ids: string[]; dropped: string[]; flashlightIndex: number; // 0 when present, else -1
}
```

- Flashlight takes slot 0; an **active** muzzle takes slot 1 (an intensity-0 muzzle is omitted and reported in `dropped`); practicals fill the rest, deterministic at the 16-slot cap with distance→id tiebreaks. Data-only conversion of point/spot lights with explicit range/falloff constants (`DEFERRED_LIGHT_DEFAULT_RANGE = 12`, `DEFERRED_INTENSITY_SCALE = 1`); authored colors and world transforms (parented muzzle) preserved; no material rebuilds on light value changes.

### `deferred-mesh.ts` (modified)

Adapter factories take trailing `options?: SurfaceOutputOptions`; `shadowReceiver` packs level-only bit 4 into the class uniform (class 17 for mesh tissue, class 1 full), matching task-2's producer-side encoding. Mapped/cutout materials preserved.

## Unit tests (all passing, `--maxWorkers=2 --minWorkers=1`)

- `game-deferred-scene.test.ts` (18): async descendants, array materials, hidden parent, removed/rebuilt actor, unsupported opaque node material, per-draw callback preservation, restoration after a throwing render, parent-receiver propagation + explicit child override.
- `game-deferred-lights.test.ts` (16): flashlight/muzzle priority, parented muzzle world position, deterministic 16-cap selection, inactive entries, repeatability, distance/ID ties, muzzle-move flashlight invariance.
- `deferred-mesh.test.ts` (6): receiver metadata + material preservation.
- `deferred-surface.test.ts` (22, +1 this continuation): **pins the literal attachment order** `albedoRoughness, normalMetalness, emissionClass, surfaceDepth` and the rgba16f/r32f formats — the contract the GPU readback helper depends on.

Total focused run this continuation: **7 files, 124 tests, all green**; `npx tsc --noEmit` clean.

## GPU gate (real device, private ports 5328/9328)

`LAB_VITE_PORT=5328 LAB_CDP_PORT=9328 scripts/deferred-scene-check.sh` — **9/9 PASS**:

| check | evidence |
| --- | --- |
| boot-clean | page boots with zero recorded errors |
| router-diagnostics | mesh counts `{mesh:7, sdf:0, forward:1}`; sdf router `{sdf:1}`; unsupported names `unsupported-mesh ← MeshBasicNodeMaterial` |
| producer-coverage-classes | resolved target: class 0 = 295,419 px, class 1 = 182,850 px (router-adapted room), class 18 = 1,731 px (SDF flesh level-only); class-0 count conserves `W*H − covered` exactly |
| alpha-cutout-survives-adapter | solid cell depth 0.9857449 vs projected clipDepth 0.9857416 (Δ ≈ 3.3e-6, tolerance 0.01); hole = class 0, depth 1 |
| scoped-exclusion | forwardSphere / unsupportedMesh / helperSphere anchors read exact-pixel class 0, depth 1 |
| light-list-selection | `ids[0]='flashlight'`, count 16, inactive muzzle in `dropped`, 15 practical slots, farthest `fire-00` dropped, frame-to-frame repeatable |
| light-list-muzzle-priority-invariance | active muzzle slot 1; `muzzleInvariance=true` (moving only the muzzle never changes the flashlight entry) |
| late-kit-child-discovery-receiver | kit child discovered by `sync()`, class **17** at the exact anchor pixel, depth 0.98736 vs anchor clipDepth 0.98778; before add: class 0/depth 1 |
| capture-written | `task3-scene.png` (room + zombie + kit box + lit cutout half visible; forward/unsupported/helper correctly absent) |

Evidence: `task3-scene.json`, `task3-scene-late-kit.json`, `task3-scene-check.json`, `task3-scene.png` (this directory). Servers were started and stopped by the check script's own trap on both the failing and passing runs; no sockets left open.

## Coordinator-review fixture bugs — root causes and fixes

The timed-out run was blocked entirely inside the GPU fixture; no production router/light defects were found by it or by this continuation's review passes.

1. **Wrong attachment destructure** (`deferred-scene-main.ts` `readTarget`/`readSurfaces`): `SURFACE_ATTACHMENT_NAMES.map(...)` followed by `[emission, depth] = ...` bound `albedoRoughness`→emission and `normalMetalness`→depth, so "class" was albedo roughness and "depth" was normal.x — explaining the false empty/class-0 reads. Fixed by reading `emissionClass` and `surfaceDepth` **by name**, with `readAttachment` typed to `SurfaceAttachmentName` so renames fail at compile time; the lying tuple casts are gone. New surface test pins the literal order.
2. **`solid.hit.clipDepth` always undefined** (`deferred-scene-check.mjs`): `findClass` returns `{pixel,depth,cls}`; the assertion now compares against the anchor's own projected `solid.clipDepth` with a justified 0.01 tolerance (flat camera-facing plane; measured Δ ≈ 3.3e-6).
3. **Spawn-root probe ambiguity**: `LAYOUT.body = [0,0,0]` is the translate/spawn root; probing it hits floor/feet. The flesh probe is now `bodyChest = [0, 1.25, 0.12]` (task-2 `PROBE.body` convention); the root is excluded from anchor probing.
4. **Exclusion anchors were never against empty background**: at ±2.8, y=0.8 the anchor rays continued into the side walls (x=±3.6) — the wall's class-1 coverage sat behind the probes; at ±2.0, y=2.0 they clipped the cutout plane's opaque half (y up to 2.1 at z=0.5). Final placement ±1.6, y=2.2, z=−1.0 clears the cutout top edge by 0.17 world units and exits past wall/floor extents. Additionally, want-0 probes now judge the **exact anchor pixel** (`classAt`) instead of a spiral search that could walk off a leaked object onto true background and hide the leak.
5. **`fire(true)` → `lights()` staleness**: `lastLights` updates only inside the draw function, which runs on `step()`; the driver now steps once between firing and reading (and after `fire(false)`).

## Remaining limitations (honest)

- The `booting…` status label stays on-screen in the capture — cosmetic, fixture-only (same known issue as the task-2 page).
- The GPU gate remains a smoke-grade assertion set (anchor probes + class conservation), not a full-screen per-pixel equality proof — consistent with the coordinator's guidance for task-2 evidence.
- Flashlight shadow maps are **not** exercised here: `setFlashlightShadow(null)` stays the default; shadow binding/receiver sampling is task 4.
- `routeOf` is an extra convenience beyond the planned interface (used by the kit-child seam); the planned members are all present with the planned signatures.
- Practical-light WGSL paths were validated through the shared layer's `setLights` on device (they light the room); per-light visual parity tuning is explicitly out of scope until task 5+.
