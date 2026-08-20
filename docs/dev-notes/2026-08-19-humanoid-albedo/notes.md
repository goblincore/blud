# Humanoid baked albedo was double-counted

**Date:** 2026-08-19 · found at the Task 7 (sever) owner gate

## Symptom

The live spike rendered the zombie **maroon with near-black trousers**. The
Blender bind-pose preview, reconstructed from the *same* atlas, shows pale skin
and blue-grey trousers. So the bake was right and the shader was wrong.

## Cause

`humanoid.wgsl.ts`:

```wgsl
let litBaked = baseColor * srgbToLinear(baked) * diffuseLight * keyColor + specLight;
```

`baseColor` is `0xc46a72` — pink latex flesh. The full-colour authored source
texture was being multiplied **into** it, stacking two albedos:

| surface | source (sRGB) | x latex | result |
| --- | --- | --- | --- |
| skin | ~(0.78, 0.72, 0.67) | (0.55, 0.15, 0.17) linear | dark red |
| trousers | ~(0.30, 0.32, 0.36) | same | near black |

The pink dominates the red channel and crushes green/blue, which is exactly the
maroon-with-black-trousers signature seen in the captures.

**This was a plan defect implemented faithfully, not an agent error.** The
"texture is an albedo multiplier" rule comes from `X1.1`, where the FACE texture
is a flat **greyscale** map whose entire job is to modulate one latex tone.
A full-colour body texture already carries the art; multiplying it into a
coloured base double-counts.

## Fix

A dedicated `bakedTint` uniform (white by default) tints the baked path;
`baseColor` stays with the cut cap, which has no baked colour of its own and
whose ramp is deliberately fed the un-baked `litSkin`.

```wgsl
let litSkin  = baseColor * diffuseLight * keyColor + specLight;   // cap only
let litBaked = bakedTint * srgbToLinear(baked) * diffuseLight * keyColor + specLight;
```

Three regression tests pin it: the baked path must contain
`bakedTint * srgbToLinear(baked)` and must NOT contain `baseColor * srgbToLinear`;
`tornCapMaterial` must still be fed `litSkin`.

## Why it had to land before the wound slice

Task 10's visual gate rejects on "skin tone visible inside a crater" and calls
for "a fresh crater beside the settled cut cap, for side-by-side material
comparison of the shared layered ramp". Neither is judgeable when the
surrounding flesh is already crushed to the same red as the wound material —
you would be gating wound colour against a broken reference.

The re-capture makes the point: the cut cap's skin-edge -> wet-red ramp was
present in the shader all along (`tornCapMaterial`, two smoothsteps) but read as
a flat red disc against maroon flesh. Against corrected flesh it reads as a pale
rim around a deep red interior.

## Evidence

- `npx vitest run` 1682/1682 (112 files), `npx tsc --noEmit` clean.
- Live re-verify on the real page: **VERIFY PASS 17/17**, unchanged gate values
  (cap 796 px flight / 2131 px impact, settled separation 255.1 px, ten
  sever/reset cycles with identical resource counts, first-use frame 16.0 ms).
- Capture luma std rose 12.3-13.2 -> 15.4-16.4 across all ten panels: the
  flesh is no longer crushed.

## Also noted at this gate, not fixed

- `verify-humanoid-sdf-spike.mjs` `settledPieceSeparated` carries a dead clause:
  `dist >= 80 && dist >= 60`.
- Task 7's `notes.md` describes that gate as "centroid 254.9 px from the body,
  >= 300 px", conflating the centroid DISTANCE (threshold 80) with the second
  component's SIZE (threshold 300). The gate is real and passes; the sentence
  reads like a failure.
