# Interlaced field rendering — result (2026-09-09)

**Verdict: the close-up spike is gone.** Owner gameplay captures on build
`86185b01`, `fieldMode=true, fieldComb=1, halfRate=false, depthPrepass=false,
actorCull=true`.

| run | p50 | p95 | p99 | **max** | >40 ms | max consec. late | avg fps | dur |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline (no levers) | 33.3 | 42.4 | 63.0 | **125.1** | 6.3% | 12 | 28.9 | 115 s |
| half-rate + prepass | 33.3 | 43.1 | 53.0 | 90.6 | 7.4% | 6 | 29.0 | 103 s |
| half-rate only | 33.3 | 42.9 | 53.4 | 81.0 | 7.1% | 11 | 29.1 | 93 s |
| **fields (run A)** | 33.3 | 33.5 | 34.3 | **43.6** | **0.2%** | 2 | **30.0** | 114 s |
| **fields (run B)** | 33.3 | 33.6 | 34.3 | **38.1** | **0.0%** | 1 | **30.0** | 97 s |

- Worst frame **125.1 → 38.1 ms**.
- p99 **63.0 → 34.3 ms** — the 99th-percentile frame now hits the 33.3 ms target.
- Over-budget frames **6.3% → 0.0%**.
- Longest stall run **12 frames → 1**.
- `avg fps 30.0`: the frame is pinned at the cap, not averaging near it.

`p50` reads 33.3 in every row because the 30 fps cap clamps it. Everything that
changed is the tail — which is exactly what the owner reported feeling.

## Why half-rate did not do this

Half-rate moved only the extreme tail (p99, max) and left p95 and the >40 ms
count essentially untouched. It also could not be kept: it holds and reprojects
the whole marched frame, so warped flesh sat against exactly-rendered polygons
and the two diverged under camera motion — visible when strafing, and a ceiling
on hold-and-reproject rather than a bug. Fields draw every pixel at the current
camera, so that error class does not exist.

## What this confirms retrospectively

The 2026-09-09 interaction finding was right: the cost is **covered pixels in
the near-wound zone × per-pixel near-wound cost**. Halving the marched pixels
removed the spike outright, which no per-pixel wound lever could — and every
one of those had already been measured to ~0 (per-ray wound list parked,
bounded regions +9% slower, early-out nil, step multiplier already fastest,
and for soldiers the inside-flesh gate never fires at all).

## CAVEAT on these two captures

The owner intended them as two different `fieldComb` values. They are not:
per-frame state shows `fieldComb: 1` on all 3430 and all 2910 frames
respectively. Both are full comb. **No comb A/B has been run yet** — set
`__sdfGame.setFieldComb(x)` after page load and before F8, and confirm with
`__sdfGame.fieldComb`, since a reload restores the shipped default of 1.

## Two bugs found by looking, not reasoning

Both were caught against the live page during wiring:

1. **`fieldPrev` missing from the lazy-init clear list.** Uninitialised it
   reads as zeros, and alpha 0 is not the "nothing here" sentinel — the
   composite took it as a valid surface at depth 0 and painted black over the
   whole polygonal scene on every held scanline.
2. **The retain step was a fullscreen-quad blit.** `target` is written by the
   rasteriser; a quad sampling `uv()` writes with the opposite Y origin, so the
   retained field came back vertically MIRRORED — an upside-down ghost of the
   body interleaved with the right-way-up one (owner-caught). Now
   `copyTextureToTexture`. **Do not fix a future flip by mirroring the row
   index in the composite** — that hard-codes one platform's convention, which
   is how this bug class recurs.

## Open: flesh/bone row disagreement

Skeleton meshes render full-res every frame while the flesh is fielded, so on
held rows one-frame-stale flesh sits against current bone. The owner sees it
"sometimes", reads it as a rendering artifact, and does not consider it
blocking. Options are recorded in the spec; none is chosen yet.
