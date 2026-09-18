# Explosion curl motion + soft fade (2026-09-18)

The wildfire teardown's two portable techniques are now shared helpers, and the
explosion burst uses both. The game's default look is **unchanged**; the new
look is opt-in on the spike page and the owner decides whether to lift the
default.

## What changed

### 1. Shared helpers (used by flame cards AND explosions)

**`src/lab/sdf-zombie/webgpu/curl-volume-node.ts`** — the TSL side of the
64³ curl volume. One module-singleton `Data3DTexture`, built lazily on first
use, so every effect samples the SAME divergence-free field (do not build it per
effect). Final API:

```ts
const CURL_NODE_SEED = 0x51c0ff;
const CURL_NODE_RISE = 0.45;                 // volume units / second, upward

getCurlVolumeData(): Uint8Array;             // shared CPU volume (read-only)
getCurlTexture(): THREE.Data3DTexture;       // lazy singleton, RGBA8, Linear/Repeat
curlVector(
  worldPos: Tsl, time: Tsl,
  scale: Tsl | number = CURL_SCALE,          // metres per volume repeat
  rise:  Tsl | number = CURL_NODE_RISE,      // upward scroll
): Tsl;                                       // decoded rgb * 2 - 1, a vec3 node
disposeCurlVolume(): void;                    // teardown/tests only
```

Flame cards no longer build or dispose a curl texture; they take
`getCurlVolumeData()` for the CPU anchor displacement and `curlVector(...)` for
the fragment warp. The shared seed is the cards' old `0x51c0ff`, so the field is
bit-identical.

**`src/lab/sdf-zombie/webgpu/soft-fade.ts`** — the TSL soft-particle depth fade.
The scene depth comes from ONE place, `viewportLinearDepth`
(`linearDepth(viewportDepthTexture())` in the installed three 0.185.1); the
caller only ever passes the CURRENT fragment's depth, so the wildfire teardown's
`(d - d) / fade = 0` transparent-black trap is unreachable through the API.
Final API:

```ts
softFade01(fragM: number, sceneM: number, fadeM: number): number;  // pure twin
softParticleFade(fragLinearDepth01: Tsl, fadeMetres: Tsl): Tsl;    // 0..1 node
```

`soft-fade.test.ts` has a source guard that fails if a bare `linearDepth()` /
`depth()` call is ever introduced into the helper.

### 2. Explosions

`src/lab/sdf-zombie/webgpu/explosion-vfx.ts` gained three tuning fields (with
bounds) and a live uniform sync:

| field | default | bounds | meaning |
| --- | --- | --- | --- |
| `curlStrength` | **0** | [0, 2] | how hard the shared curl volume domain-warps the fire/smoke noise; 0 is the pre-curl scroll |
| `curlScale` | 6 | [0.25, 64] | world metres per volume repeat (only used when strength > 0) |
| `softFade` | **0** | [0, 2] | soft-particle fade distance in metres; 0 is inert |

The fire and smoke noise lookup is offset by `curlVector(positionWorld, time,
curlScale) * curlStrength`; the ring and ember layers deliberately do not sample
the volume (not a gas plume). Fire and smoke coverage is multiplied by
`softParticleFade(linearDepth(), softFade)`.

**Both new switches ship at 0**, which contributes exactly zero numerically, so
`game-main.ts`'s explosions are unchanged. Flipping the game default is the
one-line change of `curlStrength`/`softFade` in `EXPLOSION_VFX_TUNING`;
`explosion-vfx.test.ts` pins the zeros. The spike page turns them on with
`?curl=1` at `SPIKE_CURL_LOOK = { curlStrength: 1.1, curlScale: 2.2,
softFade: 0.4 }` (also applied through `setTuning`, which the capture uses).

## Captures

Reproduce the explosion captures with:

```
npm run explosion:capture                 # -> docs/dev-notes/2026-09-18-explosion-curl/
node scripts/explosion-capture.mjs --clip docs/dev-notes/2026-09-18-explosion-curl/clip
node scripts/explosion-capture.mjs --clip --strength 0 \
  docs/dev-notes/2026-09-18-explosion-curl/clip-fade-only
```

(The explosion spike needs no assets. The flame-cards confirmation below needs
the gitignored dev placeholder atlas: `npm run flame:atlas`.)

`scripts/explosion-capture.mjs` is the flame-capture shape: it starts/reuses
vite + headless Chrome on `LAB_VITE_PORT`/`LAB_CDP_PORT`, drives the page
through `window.__explosionSpike`, fails on any `THREE.WebGPURenderer`
pipeline/shader error or page exception, and gates each frame on luma std.

**Determinism.** The spike boots with `?paused=1&spawn=0`, so its rAF loop is
off and only `frame(dt)` advances the 1/60 s clock from 0. The baseline luma
std was identical across three separate runs (37.65 / 41.11 / 42.21 for
flash / fireball / smoke), i.e. two page loads reach the same frame. Each run
also gates: a curl run whose fireball and smoke frames did not change fails the
capture.

### Ground scene (`baseline-*` vs `curl-*`, plus `sheet.png`)

A ground burst at the origin, 0.12 s / 0.55 s / 1.15 s.

| time | pixel change | mean abs luma |
| --- | --- | --- |
| flash | 1.57 % | 0.11 |
| fireball | 2.74 % | 0.17 |
| smoke | 10.67 % | 0.74 |

The fireball's silhouette becomes lumpy and asymmetric (a lobe rolls up the
right side) instead of the smooth ball the baseline draws; the smoke cap gains
a great deal of internal turbulence. The flash is nearly unchanged, as it
should be — it is a small, short-lived ball.

### Staged clip scene (`clip/`, plus `sheet.png`)

An airburst at `[2.7, 1.3, -1.0]` deliberately intersects the occluder box, the
case the fade exists for. Curl+fade changes 2.71 % (fireball) / 10.81 % (smoke).
The fire wraps the box the same way, but its edge on the box is softer and the
smoke's floor contact fades rather than ending on a line.

### Fade isolated (`clip-fade-only/`, plus `sheet.png`)

Same staged scene with `--strength 0 --fade 0.4`, so the ONLY difference is the
soft fade. It changes 1.35 % of the fireball and 2.45 % of the smoke — the fade
is active where a quad crosses the box (for comparison, a fade-only probe on
the ground scene changes only 0.07 % of the fireball and 2.60 % of the smoke,
because that fire grows upward from the floor and barely intersects anything).

## What is not right

- The curl is a **domain-warp of the existing fractal-noise lookup**, not a new
  advection solve. It reads as billowing and swirling filaments, but within one
  billboard it is a smooth displacement, so at the mid fireball the change is
  only ~2.7 % of pixels even at the spike values. The smoke (a weaker, larger
  pattern) changes ~10.7 %. If more is wanted, the next step is the teardown's
  capsule field + low-res march, not a bigger `curlStrength`.
- The soft fade's contribution is **geometry-dependent and subtle on fire**.
  The fire's own alpha already tapers at the quad edge, so fading it further at
  a floor/box cut changes few pixels; a higher-coverage, harder-edged layer
  (blood mist is the obvious one) will show the gradient much more strongly.
  The smoke/floor contact is where it reads in these frames.
- `curlScale` is only meaningful when `curlStrength > 0`; the ground-burst
  default of 6 m is the flame cards' body scale, the spike uses 2.2 m.
- The ember and ring layers get neither effect (deliberate).
- The capture is a manual rig, not wired into CI or `npm test`.

## Flame-cards confirmation

The cards moved onto both helpers with no other change. The cards test suite
passes; the frozen atlas capture (`--technique cards --poses stand,close
--frozen`) renders flames that still flow as one body with soft edges, at luma
std 44.31 (stand-fresh) / 76.14 (close-fresh) against the 2026-09-17 reference's
43.43 / 73.86 (the reference was not clock-frozen, so this is a visual/structural
match, not a pixel diff). The CPU seed is provably the same field
(`CURL_NODE_SEED = 0x51c0ff` = the cards' previous default).

---

# 2026-09-18 (later) — the curl cross: isolated, root-caused, fixed

The first pass shipped a curl look whose captures had an unreported bright cross
(a horizontal streak and a vertical seam) through the fireball. This section is
the follow-up: what produced it, the fix, and the look to ship.

## 1. Isolation — it is the curl, and only the curl

Same ground burst, same pinned seed, smoke frame (t = 1.15 s), 1380×820, each
run against the unchanged baseline (curlStrength 0, softFade 0):

| run | curlStrength | softFade | smoke changed | fireball changed | cross? |
| --- | --- | --- | --- | --- | --- |
| fade only | 0 | 0.4 | 1.98 % | 0.06 % | **no** |
| curl only | 1.1 | 0 | 9.21 % | 2.68 % | **yes** |
| both | 1.1 | 0.4 | 10.67 % | 2.74 % | **yes** |

`--strength 0` (fade only) leaves the frame essentially at baseline — its 1.98 %
of changed smoke is the floor/box contact the fade exists for — and shows no
cross; `--fade 0` (curl only) still shows it at full strength. **The cross is
100 % the curl domain warp; the soft fade is not involved.**

Three more probes narrowed it:

- **One fire billboard reproduces it.** With `--fire-count 1` and the smoke,
  ember and ring layers off, the single quad draws the same bright horizontal
  streak and vertical seam (`isolation-prefix/one-fire/curl-smoke.png`). So it
  is not two quads meeting and not a quad seen edge-on: every fire billboard of
  a plume burst shares one orientation (the world-up cylindrical basis), so they
  are all parallel, and the radial `edge` falloff already multiplies the
  **UN-warped** UV (`p = aUv·2 − 1`), so coverage is exactly 0 at the quad
  border with or without the warp.
- **It is the fire layer.** A smoke-only run (`--fire-count 0`) is clean; a
  fire-only run carries the cross.
- **It scales with the warp's gradient, not with coverage.** At the smoke time,
  curl only: absent at (strength 0.4, scale 2.2), faint at 0.7, severe at 1.1
  and 2.0; **absent at (1.1, scale 6)**. That is the signature of the warp's
  spatial slope (`strength / scale`), not of an edge.

The pre-fix frames are kept under `isolation-prefix/` (taken at the old spike
scale of 2.2 m); the re-shot, fixed versions are under `isolation-fixed/`.

## 2. Root cause

The curl domain warp **folds the fractal-noise lookup** inside a single fire
billboard. The noise coordinate travels `scale` (3.4) across the billboard's UV,
while the warp moves the lookup by up to `curlStrength` noise units; at
`curlScale = 2.2 m` the warp changes by about a whole Perlin feature across one
billboard, so the lookup map stops being injective. The compressed and inverted
pattern reads as a bright horizontal streak and a vertical seam. On the shared
64³ field the finite-difference Jacobian reaches ≈ 0.9 per texel (≈ 57 per
volume repeat), so at 2.2 m its steepest cells are metres-scale features sitting
inside the fireball.

The brief's leading hypothesis — coverage being pushed onto a quad edge — is
therefore **not** the cause: the falloff is already on the un-warped UV, and the
artifact survives on a single, parallel, camera-facing billboard.

## 3. Fix

`curlWarpGain(curlStrength, curlScale)` (`explosion-vfx.ts`) with
`CURL_WARP_SAFE_RATIO = 0.2`, mirrored in the TSL graph: the applied warp
amplitude is `min(curlStrength, 0.2 · curlScale)`. The fold is governed by the
warp's gradient (amplitude / scale), so capping it at the measured-safe gradient
lets the shared 6 m scale apply the full shipped strength, while a tighter swirl
gets a proportionally smaller amplitude instead of folding. `curlStrength = 0`
is still exactly zero, so the game default frame is untouched.

`SPIKE_CURL_LOOK.curlScale` moves 2.2 → **6** (the shared, flame-cards body
scale): that is the value that carries the full `curlStrength` through the cap.
`curlStrength` 1.1 and `softFade` 0.4 are unchanged.

## 4. What the frames show now

Post-fix `npm run explosion:capture` and `--clip` (curlScale 6, curlStrength
1.1, softFade 0.4):

| scene / time | smoke changed | fireball changed |
| --- | --- | --- |
| ground, both | 10.47 % (mean \|Δ\| 0.75) | 3.38 % |
| clip, both | 11.70 % (0.97) | 2.42 % |
| ground, curl only | 9.14 % (0.67) | 3.31 % |

The ground smoke change is within noise of the pre-fix 10.67 %, and the
**fireball changes 3.38 % against 2.74 % pre-fix** — the billow is kept and then
some. At full size there is no cross or seam in any frame (`curl-*.png`,
`clip/curl-*.png`, and the smoke frames in `isolation-fixed/`).

The stress settings that still crossed with only a proportional budget are now
clean: `--strength 2.0 --scale 2.2` (capped to 0.44) and `--strength 2.0
--scale 6` (capped to 1.2) both photograph without a cross, and a single fire
quad at scale 6 is clean.

## 5. Recommended game values

In `EXPLOSION_VFX_TUNING`:

```
curlStrength: 1.1,   // was 0
curlScale: 6,        // already the default (the fold-safe shared scale)
softFade: 0.4,       // was 0
```

That is exactly `SPIKE_CURL_LOOK`; lifting the game default is setting
`curlStrength` and `softFade`. `curlWarpGain` keeps any future tightening from
reintroducing the cross.

## Tests

`explosion-vfx.test.ts` gains a `curlWarpGain` test (cap, monotonicity,
off/degenerate inputs). `npx tsc --noEmit` is clean and the targeted suite
(`explosion-vfx soft-fade curl-volume flame-cards`, 60 tests) passes.

