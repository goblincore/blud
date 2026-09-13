# Neural upscale — run 4: full-resolution relief (radiance demodulation for skin detail)

**Status:** in progress (started 2026-09-12 evening). **Pieces 1–3 DONE the same night** (see log at the end). **Owner goal:** more detail *inside* the silhouette —
the skin relief that makes a body read as modeled and weighty (claymation / soft-CG mix). Silhouettes are
done and not a target. Pores are below this resolution; relief at the scale of the existing skin noise and
the wound meat detail is not.

**Why the net cannot do it today.** The bump is procedural noise on the normal, evaluated once per 400×300
march texel; the 16-sample target averages it; L1 predicts the mean. Three averaging steps. Run 3 showed the
s32 cost class is saturated on this input: no net shape recovers detail the input never carried.

**The trick.** The bump is a function of a rest-space surface coordinate (`anchor`) and a seed — free to
evaluate at 800×600. Give the net that at output resolution and let it light it.

## Pieces

1. **March writes `anchor` + the detail gate** to a third attachment (`marchAnchor`, rgba32f: rest-space
   anchor.xyz, w = detailAmp for that pixel), via the MARCH_NORMAL_OUT private-global pattern (same node,
   one declaration). Renderer MRT entry alongside `marchNormal`. Allocated only for normals boots.
2. **Detail pass** (`upscale/detail-pass.ts`, output-res fullscreen): per output pixel, the nearest march
   texel's anchor, extrapolated sub-texel by SCREEN-SPACE anchor gradients from same-body neighbours (a
   linear map holds across a texel; no plane geometry needed), then the march's own noise —
   `vec3(fbm(a*22), fbm(a*22+5), fbm(a*22+11))` — into an rgba16f `detail` target (xyz, w = gate). This is
   the world-space normal perturbation the march adds under `detailAmp`, at 4× the sampling density.
   Debug: `__sdfGameDebug.readDetailTarget()` (+ a PNG dump) to SEE it before anything is trained on it.
3. **Capture v3.1:** per pair `detail.npy` (2h, 2w, 4) from the same frozen frame; contracts §1 row.
4. **Net:** a full-res branch after the pixel shuffle — one 3×3 layer, 8 wide: input = shuffled residual
   (rgb + coverage) ⊕ detail (3) ⊕ nearest-upsampled input rgb (3) → rgb residual added to the shuffled
   result. Python (`model.py`, `reconstruct.py`), TS twin, WGSL (a `detail` texture on the shuffle pass or a
   new pass), export/JSON field `fullRes`. Cost ≈ the current stage again (<1 ms).
5. **Loss:** raise the INTERIOR region weight (edge band is solved); keep everything else.
6. Train on dataset v3.1, compare against s32-rgbn on the interior/face regions and by eye.

Later, the same channel can carry the wound meat noise (same anchor) and albedo (face sheet) for the full
demodulation. Order: 1 → 2 (GPU look) → 3 → 4/5 → 6.

## Log

- **2026-09-12 late:** pieces 1 and 2 built and seen. `marchAnchor` is the march's third attachment
  (written next to `detailAmp` in the trace; `MARCH_ANCHOR_READ` shares `MARCH_NORMAL_OUT`'s private
  declaration). Three rgba32f attachments = 48 B/sample > WebGPU's default 32: `lab-renderer.ts` now asks
  the device for the adapter's cap (128 on Apple silicon) when it offers more than the default. The detail
  pass (`DETAIL_FIELD`, `sdf:detail`, `sdfLayer.detailTarget`, `__sdfGameDebug.readDetailTarget()`) renders
  a coherent skin-noise field over the body at 800×600 with no texel blocking — the screen-space anchor
  gradient extrapolation holds. Gated on the march hit as well as `detailAmp` (the cleared background of
  the anchor attachment carries the clear alpha). Look: `.lab-tmp/detail-shot.mjs` → `.lab-tmp/detail-field.png`.
  Next: piece 3 (capture `detail.npy`), then the full-res branch in the net.
- **2026-09-12 late, piece 3:** capture boots with `upscale=0&upscalenormals=1`, reads the detail field after
  the normals read and writes `detail.npy` (2h, 2w, 4) cropped like the target; loader → `Pair.detail`
  (optional); contracts §1 row. v4-smoke (4 pairs): gated pixels ≈ target flesh (99.6 % overlap), noise
  mean |.| 0.20, max 0.83. Next: piece 4, the full-res branch in the net (python + TS twin + WGSL), then a
  v3.1 capture (the v3 dataset has no detail.npy — a 1,000-pair recapture at ~5 s/pair ≈ 1.5 h).
