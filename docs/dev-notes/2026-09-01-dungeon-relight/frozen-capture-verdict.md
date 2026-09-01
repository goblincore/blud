# The frozen capture path is NOT broken — the canvas readback was

**Verdict (2026-09-01): `L2.followup-frozen-ab` is DISPROVED.** The deterministic
capture path re-runs the SDF march on every hand-stepped frame. The identical
readings that raised the alarm came from the *measurement*, not the renderer.
Bench numbers taken through `scripts/dungeon-look.sh` / `scripts/dungeon-bench.sh`
stand; nothing needs re-running.

## What the suspicion was

With `__sdfGame.freeze(true)` + `setLoopRunning(false)` + `setPose(...)` +
`step(n, 1/60)`, every character-affecting knob measured identical flesh
luminance and an identical flesh **pixel count** (7394 at every value of
`spot.distance`). An unchanging pixel count across a lighting change is no
effect at all, so the frozen path was suspected of compositing a held march.

## Why that could not have been the mechanism

`sdf-layer.ts` skips the pre-passes and the march only on a *hold frame*, and
`isHoldFrame(frameIndex, halfRate, needsFresh)` returns false whenever
`halfRate` is false. `halfRate` defaults to false and `game-main.ts` never
enables it — only `__sdfGame.setHalfRate(true)` does, which no capture script
calls. Confirmed live: the page reports `halfRate false` under the frozen path.

`step()` is not a partial frame either — `lab-renderer.ts` defines it as
`step(dtSec) { cb(dtSec); drawFn(); }`, the same two calls the rAF loop makes,
so the per-actor uniform writes inside `game-main.ts`'s `setDrawFn` callback
(`spotCfg`, `spotCfg2`, `spotPos`, `spotAxis`, `spotColor`) are reached on every
stepped frame.

## The discriminating test

Change something that must move character pixels and can move nothing else —
the flesh albedo (`view.uniforms.baseColor`) on all ten actors — capture frozen,
and diff the PNG. At the `beam` pose, one page load:

| capture | px changed (sum-of-channels > 30) |
| --- | --- |
| same state, captured twice (floor) | **0** |
| flesh albedo -> green | **10496** |
| albedo restored | **111** (the HUD's frame-time text) |

The green frame is unmistakable: pink figures turn green, walls, floor, gun,
shadows and fog identical. The march re-runs, the composite re-runs, and the
frozen state returns exactly. This is now `scripts/dungeon-look-canary.sh`.

## The lighting knobs move the frozen frame too

Same driver, PNG diffs, one page load per pose (floor for reference: 0–163 px):

| A/B | `room` | `beam` | `corridor` |
| --- | --- | --- | --- |
| `beamGain` 0 vs 4 | 92 | 7124 | 12917 |
| `beamKeyFloor` 0 vs 1 | 21103 | 7326 | 13406 |
| `spot.distance` 1.5 vs 60 | 113987 | 56136 | 73861 |

And the frozen path AGREES with the live one. Same knobs at the `room` pose with
the rAF loop running: `beamGain` 0 vs 4 = 11 px, `beamKeyFloor` 0 vs 1 = 21123 px
— against 92 px and 21103 px frozen. Frozen does not under-report.

## What actually explained the identical readings

**Reading the WebGPU canvas in-page with `drawImage` + `getImageData` is not a
usable oracle on this page.** Measured on the same frames that
`Page.captureScreenshot` captured correctly:

```
LIVE (rAF running):   drawImage {r:0, g:0, b:0}   CDP screenshot {r:41.51, g:35.32, b:32.80}
LIVE, dungeon OFF:    drawImage {r:0, g:0, b:0}   CDP screenshot {r:48.18, g:42.58, b:40.39}
FROZEN + stepped:     drawImage {r:0, g:0, b:0}   CDP screenshot {r:40.82, g:34.87, b:32.62}
FROZEN, keyFloor 0:   drawImage {r:43.68, ...}    CDP screenshot {r:40.72, ...}
```

Whole-frame mean, all channels, all pixels. The readback returns a **pure black
image** at moments when the real frame is plainly there, and real content at
other moments — with the loop running *or* stopped, so it is not the freeze that
breaks it. `createImageBitmap(canvas)` fails identically (it is the same
snapshot); `canvas.toDataURL()` and `Page.captureScreenshot` both work.

A metric built on that readback reports "no change" for changes that are
there — which is exactly the reported symptom. The one control that did move
(`__dungeon.setDungeon(false)`) moved because the readback happened to be
returning content at that moment, not because the toggle was special.

Two things follow, and the second one is the trap that made this look like a
renderer bug rather than a tooling bug:

1. **Never sample the game canvas from inside the page.** Diff the PNG that
   `Page.captureScreenshot` returns. `scripts/dungeon-shadowab.mjs` already
   does this and was right all along.
2. **A pixel COUNT under a threshold predicate is a bad detector even when the
   readback works.** "Red-dominant" (`r > g+18 && r > b+18`) is a hue test, and
   scaling a lit body's brightness moves every channel together, so the mask can
   survive a large luminance change intact. Prefer whole-frame diffs.

## One reading that was correct for a real reason

`beamGain` 0 vs 4 genuinely does almost nothing at the `room` pose — 92 px
frozen, 11 px live. That is the shader, not the capture:
`keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x` (`march.wgsl.ts:1908`), so
the gain can only matter where `beam > 0`. The bodies in that frame sit outside
the flashlight's cone/range, so `beam` is 0 and the gain multiplies nothing. At
the `beam` and `corridor` poses, where bodies stand in the beam, the same A/B
moves 7124 and 12917 px. **A `beamGain` A/B must be shot at a pose with a body
in the beam**, or a correct null result reads as a broken capture.

## The canary

`scripts/dungeon-look-canary.sh` runs the albedo test above through the exact
capture path and exits non-zero if a character-only change stops showing up.
Run it after touching `sdf-layer.ts`'s frame logic, `lab-renderer.ts`'s
`step`/loop, or `gallery-look.mjs`.

## Known limits of the frozen path (unchanged by this, still true)

- `Page.captureScreenshot` can return before submitted GPU work reaches the
  compositor — keep `LOOK_SETTLE_MS`.
- Three r185's WebGPU `ShadowNode` does not re-render the shadow map on
  hand-stepped frames; `gallery-look.mjs` writes `shadow.intensity = 1` to arm
  it once, after the final pose. A multi-shot A/B that moves the light or the
  bodies **between** shots must re-arm before each capture, or the later shots
  carry the first shot's shadow map.
- Do NOT toggle `spot.castShadow` at runtime (three r185 WebGPU crashes on the
  disposed shadow map). Use `shadow.intensity`, or `?spotshadow=0` at boot.
- Fire flicker rides `performance.now()`, not the step's `dt`, so frozen frames
  are deterministic in geometry and lighting but not bit-identical in the
  torch-lit corners. The measured floor is small (0–163 px at 1280x800) but it
  is not zero — always take a same-state floor before believing a diff.
