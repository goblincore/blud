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

## Field styles

`__sdfGame.setFieldStyle(style)` — **ships `'bodies'` at `setFieldComb(0.6)`**.

| style | interlaced | crisp |
| --- | --- | --- |
| `off` | — | everything |
| `sdf` | marched flesh only | bones, kit, level, viewmodel — the style that HAS the flesh/bone disagreement |
| **`bodies`** | flesh **+ skeleton** | level, viewmodel |
| `frame` | the whole picture | — |

`'bodies'` did NOT need the skeleton meshes to encode depth into alpha, which
was the earlier estimate. The mesh interleave republishes each woven pixel's
depth with `depthTest` on, so the real depth buffer resolves the skeleton
against level and flesh; the half-height mesh pass only resolves bone against
bone. That turned a material rewrite into a layer split (`FIELD_MESH_LAYER`).

**Trap:** three does NOT inherit layers to children. The eyes are children of
each segment mesh, so without setting their layer too the skulls render
eyeless — in `'bodies'` only.

## Held rows must carry their OWN frame's depth

The first `'bodies'` cut still showed the skeleton through the body **while
moving** (owner-caught). Cause: the flesh weave writes last frame's depth on a
held row (it rides the retained field's alpha), but the mesh weave was writing
THIS frame's depth — I had taken depth from the current frame deliberately,
reasoning a scanline of error was invisible. It desynced colour from depth, so
moving bone beat stale flesh and won the depth test. Standing still the two
agreed, which is why it only appeared in motion.

Both weaves now retain depth alongside colour, so a held row is a snapshot of
one instant. `comb` blends the two depths to match how it blends colour.

## Bugs found during this work — all of them rendered convincingly

A pattern worth carrying: every one of these looked correct on screen.

1. `fieldPrev` missing from the lazy-init clear — alpha 0 is not the "nothing
   here" sentinel, so held rows painted black over the whole scene.
2. The retain was a quad blit — the rasteriser and a `uv()` quad disagree on
   the Y origin, so the retained field came back MIRRORED (upside-down ghost).
   Now `copyTextureToTexture`. **Never** fix a flip by mirroring the row index;
   that hard-codes one platform's convention.
3. Depth stopped being republished when the frame moved to a half-height
   buffer, so the goo layer drew blood over everything including the viewmodel.
4. `RGBA32Float` vs `RGBA16Float` — `copyTextureToTexture` demands identical
   formats, so the `'sdf'` retain failed EVERY frame while the picture still
   looked plausible.
5. Two temporal-dead-zone faults: the cull's state, then `CULL_DWELL_MS` and
   `actors`, declared below the draw callback that closes over them. The cull
   threw on every frame and the HUD sat at `bodies 0/15`. Fixing one binding at
   a time is what let it recur; it is now verified exhaustively by parsing the
   function body.

Screenshots caught none of these. A genuinely fresh console (not one carrying
HMR history) and mechanical checks caught all of them.

## Open: flesh/bone row disagreement

RESOLVED. `'sdf'` still has it by construction — that style fields only the
flesh. `'bodies'` and `'frame'` both remove it by putting bone and flesh on one
cadence, and `'bodies'` ships.

**Still unverified by anyone:** `'bodies'` with wounds actually exposing bone,
which is the case the style exists for. And the timings above predate
whole-frame fielding AND were taken while the cull was silently throwing every
frame, so they should be re-established from the shipped build rather than
carried forward.
