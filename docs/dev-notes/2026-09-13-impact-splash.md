# Impact splash — procedural slug crown — 2026-09-13

**Status: implementation complete; CPU tests + typecheck pass. VISUAL
ACCEPTANCE IS PENDING and this branch is NOT accepted.** No GPU work, no
browser, no shader compilation, no captures and no benchmark were performed in
this dispatch (training window / parent coordinates visual QA). Nothing below
claims the crown renders, compiles, looks like the reference, or is fast.

This branch adds a **supplementary** effect beside the accepted "Current" slug
path. It does **not** replace, retune or re-tune `IMPACT_GOUT`, `WOUND_BLEED`,
`stepBlood`, `spawnImpactGout`, the original renderer or the user-liked Smooth
reconstruction. It mutates none of those shared globals (pinned by test).

## Root cause this addresses

`IMPACT_GOUT.slug` (85 droplets at 0.2–0.5 m/s) is deliberately tuned to a
near-stationary mass; the owner rejected it as a blob that drops, and the
earlier 8 m/s variant as needles. The reference is a different SHAPE — an
outward/upward crown of torn sheets, tapering fingers and detached droplets —
not a different droplet speed. So the fix is a new procedural SHAPE, selected
independently, with the Current slug left exactly as-is.

Reference: `docs/dev-notes/2026-09-13-impact-animation-reference.md` (animated
WebP contact sheet, added by the parent). Approximate envelope: compact crown
emergence, broad irregular sheet fingers by ~0.2–0.4 s, tearing/dissolving into
fragments and fine spray by ~0.5–0.8 s, mostly detached droplets by ~1 s; mass
loses continuity before it falls. Direction follows the outward wound normal,
not always ground-up.

## A. New module — `src/lab/sdf-zombie/webgpu/impact-splash.ts`

Shared, production-capable, original and procedural. No paid asset, no baked
FLIP mesh, no world-space noise, no new fluid sim.

- **Event contract.** `ImpactSplashEvent` carries an explicit `origin`, an
  OUTWARD `direction`, a deterministic integer `seed`, a mutable `time` and a
  bounded `lifetime`. `createImpactSplashEvent` / `stepImpactSplashEvent` /
  `buildImpactSplashFrame` are pure and GPU-free. `buildImpactSplashFrame`
  returns `null` at/after the lifetime (the cleanup contract).
- **Orientation.** `impactSplashBasis(direction)` = `basisFromAxis(normalised
  outward normal)`. A floor impact (normal up) sprays up; a wall/body impact
  sprays out of the wall. NEVER hard-coded to world-up; a diagonal normal is
  tested.
- **Geometry.** Several unequal lobes (count rolled in 4–7, jittered sorted
  azimuths, per-lobe width/radius/rise) form thin **curved parametric surface
  patches** (radial × angular grid) with a domed cross-section — not flat
  cards. Radial fingers modulate the rim; the rim is tapered (narrow root,
  broad rim). Smooth normals are analytic finite differences on the same
  surface, sign-oriented to the crown axis and finite-guarded.
- **Envelope.** Ease-out cubic expansion (`expandSec` 0.22 s) then slow
  creep; the tear/drop window is 0.20–0.60 s. Curl toward the axis and a
  world-space −Y gravity sag both ease in only after `droopStartSec` (0.26 s):
  the crown rides out first, then sags — not an immediate clump fall.
- **Material-space mask / dissolve.** A per-vertex seeded mask plus fragment
  tear cells keyed on the sheet's own UV (`uvIn`) and lobe seed. Holes/ragged
  rim are attached to the material, so they cannot swim as the effect moves
  (pinned by a translation-invariance test). `dissolve` opens the holes over
  the back half of the lifetime (`dissolveStart` 0.26 → `dissolveEnd` 0.72 of
  progress). The material is a `MeshBasicNodeMaterial` with the rig's key
  light, smooth `normalWorld` (flipped on back faces via `faceDirection`),
  wet specular (`pow(·, 96)`) and a fresnel rim; `depthWrite`/`depthTest` on,
  `alphaTest` cutout so torn edges are crisp and write depth.
- **Droplets.** Sparse detached droplets (12–26, cap 48) are born in the tear
  window at the rim **frozen at the birth time** and integrate ballistically
  under 9.8 m/s² — a test pins the pure-gravity second difference. They are
  small lit icosahedra sharing the wet shading family.
- **Budget.** `IMPACT_SPLASH_MAX_EVENTS` (8) × the worst-case grid
  (7 lobes × 10 × 8 = 560 verts) and 48 droplets/event. The layer preallocates
  the worst case and only reduces the drawn range.

## B. Comparison page — Current slug vs Impact splash

`/sdf-blood-compare.html` → `blood-compare-main.ts`. Two ORTHOGONAL axes:

- **shape** = `Current slug (sim + reconstruction)` | `Impact splash
  (procedural crown)`. Default `current`, so an unparameterised open is
  unchanged.
- **filter** = the existing `Original` / `Original + connections` / `Smooth` /
  `Smooth + connections` variants, labelled separately and applying to shape
  `current` only. Shape is a shape, not a filter — the two are not conflated.

Both shapes share ONE camera, ONE `seed` and the same time controls, so
flipping shape never moves the framing:

- Splash origin is the SAME wound the current burst uses, `[0, 1.35, 0.55]`,
  with outward direction `[0, 0, 1]` (toward the default camera), i.e. off the
  front of the body proxy.
- Close framing: the default orbit was tightened to
  `yaw 0, pitch 0.14, distance 1.35, target [0, 1.30, 0.42]`.
- The preview opens **FROZEN at the representative crown moment**
  (`SPLASH_CROWN_SEC` 0.30 s). `freeze at crown` toggles it; `Play` unfreezes
  and **loops** the bounded lifetime at the same seed; `Reset splash` (and
  `Replay`) re-freezes at the crown. A `splash t` scrubber sets the elapsed
  time directly.
- Entering splash clears the droplet sim, so no stale slug beads/mist/splats
  can be mistaken for the crown.
- **Status legend / time indicator:** a fixed `#status` line shows
  `IMPACT SPLASH t x.xx/1.15s FROZEN (crown)` (or `looping`), and the
  diagnostics panel names the phase (`EXPAND` / `TEAR/DROP` / `DISSOLVE`) with
  its time window, the origin/direction, the crown verts/droplets and a note
  that reconstruction is independent of shape.
- **Global API:** `__bloodCompare.setShape`, `setSplashTime`,
  `setSplashFrozen`, `resetSplash`, `splashState` (and `state()` includes
  `shape` + `splash`).

Controls added: `shape`, `filter` (renamed from `variant`), `splash` (freeze),
`splash t` (scrub), `Reset splash`.

## C. Opt-in game wiring (behind a new explicit flag, no default promotion)

`game-main.ts` only; the shipped path is untouched unless explicitly enabled.

- Boot flag **`?impactsplash=1`** (read AFTER the shipping defaults) or
  **`__sdfGame.setImpactSplash({ enabled })`** / `__sdfGame.impactSplash`.
  Default OFF.
- `ensureImpactSplashLayer()` lazily creates the layer on first enable, sharing
  the flesh/goo light uniform NODES, and adds it to the main scene
  (the same layer contract as the baked chunks / blood view).
- `registerBleed` emits one crown per stamped wound with the OUTWARD wound
  normal, seeded from the wound's stable stream id — **no `bleedRng` draw**, so
  the shipped gout/bleed stream stays bit-identical.
- The tick steps live events (even with bleed off, so an in-flight event
  finishes) and syncs the layer after the camera is final.
- The existing `spawnImpactGout` still fires, so the crown is **supplementary**
  on top of the Current slug.

**Not verified:** the game path has not been rendered, compiled or playtested.
The wiring compiles (`tsc --noEmit`) and follows the existing scene/layer
contract, but there is no in-game visual evidence. Remaining wiring if the
crown is ever promoted: it currently depends on `actors[0]?.view` existing
(the same precondition as the goo layer) and renders through the main scene's
node material path; if deferred MRT routing is later enforced for main-scene
meshes, the splash material would need a surface-mode variant like
`baked-chunks.ts`.

## D. Tests (CPU only, no GPU)

New `src/lab/sdf-zombie/webgpu/impact-splash.test.ts` (18 tests) — behavioural,
not source-text:

- stable seeds (identical geometry for a seed; different for another) and a
  pure hash; lobe count varies within [4,7];
- direction transform: rigid translation, up/sideways/diagonal outward
  orientation, non-unit normalisation, degenerate → up; bounded wound scale;
  fast-then-slow expansion;
- finite positions and unit normals at many times; real 3D spread (not a flat
  card); droplets on a pure gravity arc (second difference = −g on Y, ~0 on
  X/Z);
- lifetime: exact death at the bound, huge-dt no-overshoot, non-positive
  lifetime/negative time rejected;
- budget caps and the material-space mask invariance under translation;
- layer `emit`/cap/`step`/`clear`/`sync` cleanup;
- **independent baseline:** `IMPACT_GOUT` and `WOUND_BLEED` deep-equal before
  and after exercising the module (no global tuning mutation).

`blood-compare-main.test.ts` grew to 24 tests, adding the two-shape API,
shared origin/seed, freeze/loop/reset, the splash render branch and the status
indicator.

### Commands run and results

```
npx tsc --noEmit
# clean (no output)

npx vitest run \
  src/lab/sdf-zombie/webgpu/impact-splash.test.ts \
  src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts \
  src/lab/sdf-zombie/blood-sim.test.ts \
  src/lab/sdf-zombie/webgpu/goo-layer.test.ts \
  src/lab/sdf-zombie/webgpu/goo-presets.test.ts \
  src/lab/sdf-zombie/webgpu/blood-connections.test.ts \
  --maxWorkers=1 --minWorkers=1
# 6 files, 222 tests passed

npx vitest run \
  src/lab/sdf-zombie/webgpu/fisheye.test.ts \
  src/lab/sdf-zombie/webgpu/occluder-hull.test.ts \
  src/lab/sdf-zombie/webgpu/free-aim.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor.test.ts \
  src/lab/sdf-zombie/webgpu/game-deferred-lights.test.ts \
  src/lab/sdf-zombie/webgpu/post-aa.test.ts \
  src/lab/sdf-zombie/entrails-gates.test.ts \
  --maxWorkers=1 --minWorkers=1
# 8 files, 410 tests passed
```

## NOT RUN / NOT CLAIMED

- WGSL compilation of `SPLASH_SHADE_WGSL`; the crown has never been rendered.
- Visual read vs the reference (crown silhouette, sheet fingers, tear/holes,
  wet highlights, droplet sparsity, scale at close framing).
- Game smoke / gameplay / performance; no benchmark.
- Baseline parity of the Current slug: source-unchanged and the shared tables
  are test-pinned as unmutated, but pixel parity is NOT proven.

## Deferred acceptance checklist (owner / reviewer)

- [ ] Open `/sdf-blood-compare.html`, select `Impact splash`, confirm the crown
      at the frozen 0.30 s moment reads as a violent wound burst at close
      framing (origin visible in front of the proxy).
- [ ] Play the loop and scrub 0.2 → 1.1 s: broad ragged sheets early, fingers
      and holes through the tear window, mostly detached droplets late; mass
      loses continuity before falling.
- [ ] Compare shape Current vs Impact at the same seed/frame/time and confirm
      the camera did not move.
- [ ] Check wet highlights and depth (the crown occludes / is occluded by the
      proxy and obstacle).
- [ ] Only then attempt `?impactsplash=1` in the game and decide whether the
      supplementary crown earns a default. No automatic promotion.

Not accepted until the rendered crown is visible and parent/user compare it in
lab, then game.
