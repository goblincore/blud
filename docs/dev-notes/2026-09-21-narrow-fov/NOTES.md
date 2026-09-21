# Narrowing the FOV to 58/46 — 2026-09-21

**Owner decision:** narrow the game's field of view for a claustrophobic feel
and to show off the SDF wound system. Target ~58 vertical render, ~46 at
screen centre — starting values to tune by eye, not constants.

`FISHEYE_DEFAULTS` is now `{ renderFovDeg: 58, centerFovDeg: 46 }`
([`fisheye.ts`](../../../src/lab/sdf-zombie/webgpu/fisheye.ts)), down from
72/60.

| | 72/60 | 58/46 |
| --- | --- | --- |
| lens `k` (16:9) | 0.0621 | 0.0735 |
| visible vertical FOV (16:9) | 63.0° | 49.0° |
| centre magnification | 1.258x | 1.306x |

The bend is almost unchanged — the *ratio* between the two FOVs barely moved —
so this is a narrowing, not a stronger fisheye.

## The weapon problem, and what was done about it

At 46° the first-person weapons were mostly off the bottom of the frame
(`new-raw-shotgun.png`: the barrels fill the lower third and the breech, both
hands and the bracer are gone). Two ways out:

**(a) Retune each weapon's offsets.** Three slots today — shotgun (gun + two
goblin arms + flash + smoke + four shells), dynamite bundle, flare — each with
hand-authored rest positions, a reload keyframe table posed against the old
frame, and a hold pose. Every one would have to be re-eyeballed, and re-done
from scratch the next time the owner moves the FOV, which they have explicitly
reserved the right to do.

**(b) Give the view model its own FOV.** The usual FPS answer, and the one
taken. **Recommended and implemented**, because it costs one transform, no
per-weapon work at all, and survives arbitrary future FOV tuning.

### How, without a second render pass

The view model is *not* drawn separately: the gun, both arms and the shells are
registered into the deferred G-buffer mesh pass (`router.register(...,'mesh',
'level-only')`) so the shared light stage shades them and a wall occludes a
thrown case. Giving them their own projection would mean their own pass, their
own G-buffer and their own depth reconcile against the SDF composite.

None of that is needed, because the whole rig is **parented to the camera**,
and for camera-space geometry a FOV change is *exactly* a scale:

> A camera-space point `(x, y, z)` projects to `ndc.x = (x / -z) / tan(fov/2)`.
> Scale `x` and `y` by `r = tan(new/2) / tan(old/2)` and leave `z` alone, and
> the new projection gives `(r·x / -z) / tan(new/2) = (x / -z) / tan(old/2)` —
> the **old** ndc, for every point, at every aspect.

So a new `view-model-fov-rig` between the camera and `viewModelAnchor` carries
`scale = (r, r, 1)`, and the weapons' silhouettes, internal parallax and
occlusion order are the framing the owner already approved. `z` stays at 1,
which is what leaves every depth — and therefore every occlusion against the
composited world — untouched. All three weapon slots hang off it, so it is one
transform for all of them and for whatever slot 4 becomes.

`r` is measured against the **centre** FOV, not the render FOV: the lens
magnifies the middle of the frame by `tan(render/2)/tan(centre/2)`, so near
screen centre — where the gun is — the effective FOV *is* the centre FOV. That
also makes the framing independent of the render FOV, which is the
sharpness/cost knob and the one most likely to move again. At the shipped
numbers `r = tan(23°)/tan(30°) = 0.7352`.

**The one cost is lighting.** `(r, r, 1)` is non-uniform, so it stretches the
rig in z relative to x/y by `1/r` and three's inverse-transpose normal matrix
tilts the normals with it: highlights on the barrels slide a little. A uniform
scale would not, but a uniform scale about the eye is an exact no-op in a
perspective projection, so it is not an option. The captures below are the
evidence that this reads fine; if the owner ever dislikes it, the fallback is
(a).

**Residual.** The compensation is exact *before* the lens, and the lens itself
changed (centre magnification 1.258 → 1.306), so the weapon ends up ~3.8%
larger on screen than at 72/60. Visible in the captures as a hair more barrel;
not worth a nonlinear correction.

### Seams

    __sdfGame.fisheye            // now also reports viewmodelFovDeg + viewmodelScale
    __sdfGame.setFisheye(deg)    // world centre FOV; re-applies the compensation
    __sdfGame.setRenderFov(deg)  // what the camera draws; does NOT move the weapon
    __sdfGame.setViewmodelFov(deg)  // the weapon's own FOV; 60 = as authored

Pass `setViewmodelFov(__sdfGame.fisheye.centerFovDeg)` to put the weapons back
under the world FOV (the `new-raw` captures).

### A reporting bug found on the way

`__sdfGame.fisheye` was a **boot-time snapshot**, not the live report its own
doc promises. `window.__sdfGame` is assembled by spreading seam factories, and
**a spread flattens a getter** — `...createRenderQualitySeams(ctx)` called
`get fisheye()` once and copied the result, so the console reported 72/60 for
the rest of the session however many times you called `setFisheye`. The setters
were never affected (plain functions, returning a fresh report), so this was a
reporting bug, not a tuning one. Re-declared with `Object.defineProperty` after
the literal. It cost this session one capture run of three identical "legs";
the capture script now reads the FOV back and fails rather than logging it.

## Aim

Nothing to do. The shot ray (`aimFrustum`) and the drawn crosshair
(`reticleNdc`) are both derived from `camera.fov` and the same lens, so both
followed the new FOV by construction. The capture script gates that they still
agree. **F-aim.1** (free aim misplacing under the lens) is unchanged by this
work — it reproduces at every FOV and remains the owner's, deferred.

## Cost

Arithmetic first: a body at a fixed distance covers **1.72x** the pixels it did
at 72 vertical measured on the render FOV, **1.81x** measured on the visible
one.

**Measured, and it is confirmed — as coverage.** Across six alternating legs in
one page, median `coverageFrac` went **0.155 → 0.27, a factor of 1.75**, right
in the predicted band. That is the real result here.

**The GPU-ms A/B is inconclusive and should not be quoted.** `scripts/
sdf-game-fov-gpu-ab.sh` ran it the prescribed way — one page,
`setFrameCap(0)`, alternating legs — and came back **vsync-bound**: frame p50
pinned at 16.6 ms with ~3.7 ms of GPU idle on *both* arms, so `busyMs`
(13.0 vs 13.1 ms, "1.01x") is comparing two GPUs that each finished early and
waited for the compositor. This is the elastic-clock trap from
[telemetry-v3](../2026-09-20-telemetry-v3/NOTES.md) arriving through the
presenter rather than through the frame cap.

Raising the device pixel ratio to 2 (2560x1600) did **not** help, and that is
itself worth recording: the march renders into a **capped** target whose size
does not follow the DPR, so narrowing the FOV adds no marched pixels at all.
The extra cost is entirely **per-covered-pixel march depth** — more of the same
pixels now land on flesh rather than on a wall.

To close this out, the run needs vsync off, which means a Chrome flag in the
shared `scripts/lab-servers.sh`. Not taken unilaterally.

## Captures

`scripts/sdf-game-fov-capture.sh` — one page, nine shots, three legs x three
weapon slots. Each leg's FOV is read back and gated, so the legs cannot
silently be the same leg.

| leg | render / centre | view model | what it shows |
| --- | --- | --- | --- |
| `old-*` | 72 / 60 | 60 (scale 1) | the look before the narrowing |
| `new-*` | 58 / 46 | 60 (scale 0.735) | **what ships** |
| `new-raw-*` | 58 / 46 | 46 (scale 1) | the weapon uncompensated — the "mostly cut off" |

The pair to look at first is `old-dynamite.png` against `new-dynamite.png`: the
bundle is at the same screen position and the same size in both, through a
14-degree narrower frame.
