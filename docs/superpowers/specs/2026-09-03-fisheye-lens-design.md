# Fisheye lens — design

**Date:** 2026-09-03
**Status:** SHIPPED 2026-09-03. Amended in place where the work proved a claim
wrong; see [the capture notes](../../dev-notes/2026-09-03-fisheye/notes.md) for
what was actually measured.
**Scope:** the sdf-game view (`sdf-game.html` → `src/lab/sdf-zombie/webgpu/game-main.ts`).
The WebGL path (`src/main.ts` + `src/vfx/post-fx/`) is **out of scope** and keeps its
existing `BarrelEffect`, which is unrelated code.

## The ask

The owner wants "a somewhat extreme fisheye distortion on the game view as a
postprocessing pass — everything in the centre of screen very bulging towards the
viewer, and no straight lines", plus a look at the field of view ("maybe 60, idk
what it is now").

Today the camera is **75° vertical** (`lab-renderer.ts:187`), which is ~106°
horizontal at 16:9.

## The tension that shapes the design

A centre-bulge warp magnifies the middle and drags the periphery inward. Simply
dropping the render FOV to 60 and then bulging would lose the world twice over —
once to the narrower frustum, once to the warp reaching outside the buffer and
returning black corners.

So the render FOV goes **up**, not down, and the lens squeezes it back. The number
the owner cares about (what the middle of the screen feels like) is expressed
directly as a knob; the wider render is what pays for it.

## The lens

Two knobs, both vertical degrees:

| Knob | Default | Meaning |
| --- | --- | --- |
| `renderFovDeg` | **90** | what the camera actually renders (was 75) |
| `centerFovDeg` | **60** | apparent vertical FOV in the middle of the screen |

The ratio between them *is* the distortion strength. 90 → 60 magnifies the centre
1.73×; because the corners are pinned, the periphery is squeezed ~2× to make room.
That is a hard bend — no straight line survives it — while the wider render means
the edges show *more* world rather than less.

Mapping, in half-height units (`q = (ndc.x * aspect, ndc.y)`, `r = |q|`,
`rmax = sqrt(aspect² + 1)` = the corner):

```
sampleR(r) = r * (1 + k*r²) / (1 + k*rmax²)
k          = (tan(renderFov/2) / tan(centerFov/2) - 1) / rmax²
```

Properties this buys, each of which is a test:

* `sampleR(r) <= r` everywhere for `k >= 0` — every sample lands inside the source
  rect, so **no black corners, at any aspect, by construction.**
* `sampleR(0) = 0` and `sampleR(rmax) = rmax` — **corners pin to corners at every
  aspect.** Pinning at the corner is what maximises the field retained (see below).
* `sampleR'(0) = tan(centerFov/2) / tan(renderFov/2)` — the centre magnification is
  exactly the FOV ratio, which is what makes the knob honest.
* Monotonic in `r` for `k >= 0`, so the inverse is well defined.
* `centerFovDeg >= renderFovDeg` ⇒ `k = 0` ⇒ exact identity. This is the off switch.

### What you actually see

A radial magnifying warp on a rectangle cannot keep the mid-edges and the corners
both. Corners are pinned, so the mid-edges are pulled in and the outermost sliver of
the rendered frame does not reach the screen. That is inherent, not a bug, and it is
the real reason the render FOV goes up.

**Measured after the fact (2026-09-03): the game runs at a 4:3 fixed cap
(800x600), not 16:9.** The 16:9 table below is correct for that aspect but is
not what the game shows; at 4:3 the numbers are 90 rendered -> **72.2** visible
-> 60 at centre vertically, and 106.3 -> **97.0** -> 75.2 horizontally, against
the old camera's 75 / 91.3. So the real change at the aspect that ships is
+5.7 deg horizontal and -2.8 deg vertical, with the centre magnified 1.73x —
the visible extent barely moves and the bend is the whole effect. See
[the capture notes](../../dev-notes/2026-09-03-fisheye/notes.md).

At 16:9 with the defaults (`k = 0.176`, `rmax = 2.040`) the visible extents are:

| | render | on screen | at the centre |
| --- | --- | --- | --- |
| vertical | 90° | **68.3°** | 60° |
| horizontal | 121.3° | **115.9°** | 91.5° |

Against today's undistorted 75° camera (107.5° horizontal), that is a slightly
narrower vertical view and a visibly wider horizontal one, with the middle magnified
1.73×. Choosing `renderFovDeg = 90` is what makes the vertical land back near where
it is today; dropping it lower makes the frame genuinely tighter, which is the trade
the knob exists to let the owner make by eye.

`k` is recomputed on every **refit** — construction and each resize — from the
live content aspect, so the apparent centre FOV holds steady across a window
resize instead of drifting with it. (Per refit, not per frame: nothing about it
changes between resizes.)

## Where the warp lives

**Folded into the existing blit pass in `post-aa.ts`. No new pass, no new target.**

The chain is capture → FXAA → smear → blit-to-canvas. The blit already samples the
last target and already owns the canvas boundary (flipY, sharp upscale). Warping
there:

* costs **zero extra passes and zero extra render targets** — the renderer is
  already at a 30 fps target with zoomed rotation spiking to ~40 ms;
* **resamples once, at the highest resolution in the chain** — a dedicated fisheye
  stage would warp at content resolution and then the blit would resample again;
* leaves the file's orientation invariant alone (its odd/even flip trap depends on
  the number of intermediate passes, which does not change).

The warp **math** still gets its own module, `src/lab/sdf-zombie/webgpu/fisheye.ts`,
exporting the WGSL snippet, the JS forward map and the JS inverse. The reticle needs
the same curve as the shader and the two must not be able to disagree — one
definition, one set of tests.

Wiring: `POST_AA_BLIT_WGSL` grows a `lens: vec3<f32>` parameter (`x = k`,
`y = rmax`, `z = aspect`). `k = 0` takes an early-out branch that is the byte-for-byte current
path. `rmax` is passed rather than derived from `textureDimensions`, because under a
'fixed' cap the content target is letterboxed and its dimensions are not the display
aspect.

### Rejected alternatives

* **A dedicated fisheye pass between smear and blit.** Cleaner file boundary, but an
  extra full-screen target and a second resample for no visual gain.
* **Bending the primary rays in the SDF march.** A true lens — perfectly sharp, no
  resampling, no corner problem by construction. Rejected because only the SDF layer
  marches: the weapon, gibs, dungeon meshes and goo go through a normal projection
  matrix and would not bend with it. The frame would tear in half.

## Sampling quality

Pinning the corners means the periphery is **minified ~2×**, and the blit currently
point-fetches (`postAaFetch` → `textureLoad`). Point-sampling a 2× minification
shimmers, and this renderer's low internal resolution makes that worse, not better.

Mitigation, in the warped path only: a **4-tap rotated-grid sample**, each tap
warped independently so that where the lens minifies, the map itself spreads the
taps further apart in the source. That gets the Jacobian-proportional spread for
free, with no Jacobian arithmetic. The existing 0.25 smear
absorbs what is left. If it still crawls, that is a tuning conversation (more taps,
or a mip chain on the source), not a redesign — and the knob switches the fisheye off
in the meantime.

**Sharp upscale and fisheye do not stack.** Sharp mode's fractional re-ramp assumes
an axis-aligned uniform magnification, which the warp breaks. With `k > 0` the blit
takes the 4-tap path regardless of the sharp flag — the 4-tap already does the
border softening sharp mode was there for. `k = 0` restores sharp mode exactly.

## What else has to move

### The reticle (correctness, not polish)

`game-main.ts:2387` places a **DOM** crosshair linearly from the free-aim point.
The world now moves under it, so at any off-centre aim the crosshair would sit on
something other than what the shot hits.

The fix: draw it at `warp⁻¹(aim)`. The blit samples source radius `g(r)` for screen
radius `r`, so content living at source radius `s` appears at screen radius
`g⁻¹(s)` — **pushed outward**, since the centre is magnified. Writing
`C = s · f(rmax) / rmax`, the inverse is the monotonic cubic `k·r³ + r − C = 0`,
solved by Newton from `r = C`; a handful of iterations for one point per frame.

Firing is untouched: `free-aim.ts`'s `weaponAngles` and the fire ray keep working in
the true frustum. Only the drawn position of the crosshair changes.

### The all-off parity gate

`post-aa.ts`'s `render()` drops the capture redirect entirely when FXAA is off,
smear is 0 and sharp upscale is off, handing the canvas straight back to the chain.
Fisheye must join that `active` condition — with `k > 0` the redirect is required.

The existing parity gate grows a case: **fisheye off ⇒ still bit-identical to the
pre-fisheye draw path.**

### Seams

Matching the `setFxaa` / `setSmear` pattern on `__sdfGame` — console seams, not a new
DOM panel (the game has none; panels are lab-side):

* `__sdfGame.setFisheye(centerFovDeg)`
* `__sdfGame.setRenderFov(deg)`
* `__sdfGame.fisheye` → `{ renderFovDeg, centerFovDeg, visibleFovDeg, k }` readback
  (both setters return the same report, so the console prints what actually
  landed after clamping)

### What needs nothing

`sdfLayer.setConeGeometry`, tile culling, LOD footprints and the free-aim weapon
angles all read `camera.fov` already and follow the wider render for free.

> **Amended 2026-09-03 — this section was half wrong.** Following the wider
> render "for free" is exactly what produced **F-aim.1**: free aim's clamp lives
> in the true frustum, so widening it let aim address points outside the visible
> frame and the crosshair slides off-screen. The weapon angles and the fire ray
> are fine; the *clamp* was not. See the
> [capture notes](../../dev-notes/2026-09-03-fisheye/notes.md) and `TASKS.md`.

## Testing

* **`fisheye.test.ts`** (pure): corner pinned at several aspects; `sampleR(0) = 0`;
  monotonic; `k = 0` is an exact identity; centre magnification equals the FOV ratio;
  `centerFov >= renderFov` clamps to identity; inverse round-trips within 1e-6 across
  the radius range.
* **Shader/JS agreement**: the WGSL polynomial and the JS forward map are asserted to
  be the same expression — one exported constant, referenced by both.
* **post-aa parity**: fisheye off leaves the fast path taken and the blit output
  unchanged.
* **Stills**: before/after through `scripts/dungeon-look.sh`, so the look is judged by
  looking at it.

## Known risk

90° vertical puts appreciably more world on screen, which means more bodies marched.
If it eats the frame budget, the remedy is to pull `renderFovDeg` back toward ~85 and
accept a slightly gentler bend — a one-line retune, which is exactly why the render
FOV is a knob rather than a constant.
