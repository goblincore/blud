# SDF cloth on a crowd enemy: what it costs, and how to make it cheaper (2026-10-26)

The question (owner, after the zombie's trousers moved from polygon kit to paint in goblincore/blud#82): could the
zombie wear **real SDF cloth** (trousers, or a robe like the cultist's) instead of paint, and what would it cost?
The owner's bar for the cultist was **about 1.5x a zombie**.

**Short answer.**

- **Trousers and anything else that hugs a limb:** do it as an **offset of the flesh**: paint, plus the covered
  prims' radius grown by the cloth's stand-off. It costs **1.00-1.01x**. SDF shell tubes cost **1.48x** in close-up
  and buy an air gap nobody sees at game range.
- **A robe, skirt or hood that leaves the body:** a shell is the only option, and it costs **2.07x** a zombie in
  close-up and **1.30x** in the arena. That is over the 1.5x bar where it matters (close-up). The cost is **steps**,
  not prims, and most of it is rays near the robe's silhouette.
- **Prototype landed:** a taper-aware outer-hull chain (−7% on the robe close-up, engine-wide, conservative, tested).
  The other levers measured small or are already in place by construction.

## How it was measured

- **Garments**: `webgpu/bench-cloth.ts` rewrites `zombie.blob` into five variants, so only the cloth changes:

  | Variant | What it is |
  | --- | --- |
  | `paint` | #82's labourer trousers: `color=` on the thigh and shin bars and the pelvis mass |
  | `offset` | paint, plus those bars' `r` grown by 12 mm (lever b) |
  | `trousers` | paint, plus five shells: a seat, a tube per thigh, a tube per shin open at the ankle |
  | `robe` | the cultist's skirt (on a `hem` pendulum) and capelet, legs painted |
  | `robe-flat` | the same robe with no `warp=` folds |

  `?cloth=<variant>` selects one on both `sdf-bench.html` and `sdf-game.html` (dev only).
- **Counters, not clocks.** The machine sat at a load of 8-170 for the whole session. So every result below comes
  from the march's own debug counters, read off the float march target: debug mode 13 is the ray walk (misses
  included), mode 14 the whole pixel. They are **deterministic**: repeat boots gave identical counts on both pages.
  - **walk** = prim evaluations while marching.
  - **shade** = prim evaluations after the hit (normal taps, AO).
  - **total** = both. This is the work the GPU does.
- **Bench**: `scripts/cloth-cost.mjs`, scenes `Z1` (one zombie at 1.3 m, new) and `CZ` (three at 2.2 m). The bench
  page has **no outer hull**, so every background ray walks the whole proxy box. That inflates miss costs.
- **Game**: `scripts/cloth-cost-game.mjs`, seeded and frozen, the page as it ships (crowd march, hulls, kit
  occluder). Two stages: `close` (room 4's nearest zombie, eye 1.3 m from its chest) and `arena` (room 6, as
  `teleport` leaves it: 8 bodies in view, incl. non-zombies).
- `DUMP=1` on either script writes the raw mode-13 texels, for a per-texel diff between variants.

![bench close robe](bench-close-robe.png) ![bench crowd trousers](bench-crowd-trousers.png)

## Numbers

### Game: the result that counts (prim evaluations per frame, M = million)

| Variant | close: steps | close: walk | close: shade | close: **total** | x zombie | arena: **total** | x zombie |
| --- | --- | --- | --- | --- | --- | --- | --- |
| none (zombie) | 0.13 | 1.41 | 1.66 | **3.07** | 1.00 | **0.51** | 1.00 |
| paint | 0.13 | 1.41 | 1.66 | **3.07** | 1.00 | **0.51** | 1.00 |
| trousers (shells) | 0.13 | 2.00 | 2.54 | **4.54** | 1.48 | **0.59** | 1.16 |
| robe | 0.41 | 4.54 | 2.24 | **6.78** | 2.21 | **0.68** | 1.33 |
| robe-flat | 0.32 | 3.97 | 2.34 | **6.31** | 2.06 | **0.65** | 1.27 |
| *taper-aware hull (prototype):* | | | | | | | |
| none | 0.13 | 1.41 | 1.66 | **3.06** | 1.00 | **0.50** | 1.00 |
| trousers | 0.13 | 2.00 | 2.54 | **4.54** | 1.48 | **0.59** | 1.18 |
| robe | 0.36 | 4.08 | 2.24 | **6.33** | 2.07 | **0.65** | 1.30 |
| robe-flat | 0.28 | 3.49 | 2.35 | **5.84** | 1.91 | **0.61** | 1.22 |

The arena ratios are for the **whole room's** march: 8 bodies, only some of them zombies. They dilute the
per-zombie cost and show what a mixed crowd would pay. `offset` was not run on the game page. On the bench it is
+1% (below), and it adds no prim.

### Bench (no outer hull; totals in M prim evaluations)

| Variant | Z1 steps/px | Z1 total | x | CZ total | x |
| --- | --- | --- | --- | --- | --- |
| none | 13.41 | 14.98 | 1.00 | 8.39 | 1.00 |
| paint | 13.41 | 14.98 | 1.00 | 8.39 | 1.00 |
| offset | 13.44 | 15.14 | 1.01 | 8.53 | 1.02 |
| trousers | 12.80 | 17.29 | 1.15 | 10.41 | 1.24 |
| robe | 19.66 | 18.89 | 1.26 | 9.37 | 1.12 |
| robe-flat | 17.27 | 18.27 | 1.22 | 8.99 | 1.07 |
| robe, warp far bound (reverted) | 18.49 | 18.70 | 1.25 | 9.26 | 1.10 |

### Where the robe's cost lands (game close-up, per-texel diff against the bare zombie, taper-aware hull)

| Texels (zombie → robe) | Count | Steps/px | Prims/px | Extra walk prims |
| --- | --- | --- | --- | --- |
| not marched → marched and **missed** | 17,044 | 0 → 7.4 | 0 → 73 | **1.24M (46%)** |
| hit → hit (the robe in front of the legs) | 26,318 | 2.7 → 4.6 | 29 → 58 | 0.76M (28%) |
| not marched → hit (the robe's new silhouette) | 5,987 | 0 → 6.8 | 0 → 61 | 0.37M (14%) |
| missed → missed / hit → missed | 3,463 | ~5 → ~13 | ~50 → ~156 | 0.37M (14%) |

Before the taper-aware hull, the first row was 22,360 texels and 1.53M. The diff image is below. Red is extra
steps: a wide ring of marched-and-missed texels round the robe, and slow rays along its silhouette.

![step diff, game close-up robe vs zombie](game-close-robe-step-diff.png) ![game close-up robe](game-close-robe.png)

### Timing (not trustworthy this session)

`__sdfGame.timeDraws(40)` ran at a load of 10-20. The same leg (close, bare zombie) read 28.4, 45.3 and 48.9 ms on
three boots. The robe close-up read 44.5, 66.2 and 85.1 ms against those. That agrees in direction with the
counters, but no ratio can be quoted from it. Re-time on a quiet machine with
`ROUNDS=4 node scripts/cloth-cost-game.mjs`, and treat the counter ratios above as the expectation.

## The levers, one by one

### (a) Fold a shell only where a ray is near it: already true, and the hull was the loose part

- `pack.ts boundGroups` already gives **every shell its own one-prim bound group**, culled per step by its sphere.
- That sphere is loose for a long cone (the skirt's is r = 0.77 m). But it costs at most one prim per step, and
  **prims per step barely move** with cloth. In the game close-up: zombie 10.8, robe 11.3. The cost is in steps.
- The loose bound that **did** matter is the **outer hull**. `shell-hull-outer.ts` chained spheres of the prim's
  **max** radius along its whole axis. For the skirt (0.15 → 0.32 m) and the capelet (0.08 → 0.285 m) that is a fat
  tube round the thin end: it marches texels where nothing can be hit.
- **Prototype (landed in this PR): `taperedChain`.** A round cone is the convex hull of its two end balls, which is
  exactly the union of the balls with linearly interpolated centre and radius. So each segment of the chain only
  needs the larger of its two end radii, and the header's capsule proof applies segment by segment.
  - **Conservative:** new tests ray-trace a 0.05 → 0.30 m cone and the robe and trousers zombies for containment.
  - **Effect:** the cone's hull is 54% of the old volume. The robe close-up: marched texels 63.9k → 58.6k, walk
    4.54 → 4.08M, total −7%. Arena −4%.
  - It helps every tapered straight prim, and the bare zombie moved by 0.01M.
- **Not done, and the next lever if a robe must ship:** a hull that fits a cone better than spheres do.
  - The ring of marched-and-missed texels is still 46% of the robe's extra walk. It is the chain's 13% inflation plus
    its scallops, over a 0.6 m wide silhouette.
  - A cone or frustum hull piece per shell (two caps and a side, rasterised like the spheres) would bound it to
    millimetres.
  - The upper bound on what it returns is that 1.24M of 6.33M, about **20% of the robe close-up**. That would put
    the robe zombie at about 1.7x.

### (b) Cloth as an offset of the flesh: free, for cloth that follows a limb

- `offset` is paint plus the covered bars' radius grown by the stand-off. It adds no prim and costs **+1-2%**, all
  of it from the slightly fatter silhouette.
- The five-shell `trousers` cost **1.48x in close-up** for an 8 mm sheet over an air gap the camera never sees.
  - Their **shading** cost rises the most (+53%, 1.66 → 2.54M). `calcNormal`'s taps and the AO probes call
    `mapBody` with **no upper bound** (PERF.md, cultist pass: "Next 2"), so every tap folds the shells' big spheres
    as well as the flesh.
- What the offset cannot do:
  - a **hem lip** (cloth edge standing off the skin);
  - **folds** (`warp=` is shell-only: `blob-compile.ts` throws on a non-shell);
  - **swing**.
- **Cheap engine extensions,** if the look needs them (not built):
  - **a per-prim CUFF:** `d = d_flesh - stand-off x step(clip plane)`, the step smoothed over its own width and the
    result divided by `1 + stand-off / width`. That is a hem lip from the same fold, with no prim added.
  - **`warp=` on painted flesh:** folds on the leg surface, paid only by the prims that carry it.

### (c) Flesh under opaque cloth never marched: true for SDF cloth by construction

- The march stops at the **first** surface: a ray that hits the robe never marches the legs behind it. The legs'
  groups are culled while the ray approaches, by the upper-bound cull (`gCullRef`), because the cloth is nearer.
- That is why prims per step **fall** on the bench robe: 7.68 → 6.51 on Z1.
- The kit occluder (#83) solved a problem SDF cloth does not have: polygon cloth is invisible to the march, so the
  march used to walk to the flesh behind it.
- The one place the idea would still pay is **shading**. A hit on cloth still runs flesh-path shading taps without a
  bound. That is the general "bound the shading taps" item, and it would cut the trousers' +53% shading for every
  character.

### (d) Fewer, larger shells, and a cheaper hem

- **Fewer, larger shells: no.** Each shell is already one group, and merging them would make the bounds looser. The
  robe is two shells and still costs 2x, so count is not the problem.
- **The hem pendulum is free on the GPU.** It is a Verlet rig point on the CPU, and the skirt rides it rigidly.
- **The rim** is one `length()` per shell fold. Nothing to win.
- **`warp=` folds** are the only real hem cost: robe vs robe-flat is **+8% total, +29% steps** in the game close-up
  (+3% total on the bench).
  - **Tried and reverted: a far-field bound.** `|dBase| - |A| - thick` is 1-Lipschitz, so it can replace the
    `/lip` divide away from the sheet and skip the three sines. It recovered about half the warp's extra steps
    (bench Z1 steps 19.66 → 18.49), but only −1% total.
  - It broke `shell-warp.test.ts`'s over-relaxed tracer gate: relax 1.4 times a tight bound steps clean over an 8 mm
    sheet.
  - The game ships `GAME_RELAX = 1.0`, so it could be revived behind a "not relaxed" flag. It is not worth it for 1%.
  - If folds are kept, keep `warpA x |warpFreq|` small: `lip` divides every step near the cloth.

## Recommendation

1. **Zombie trousers: keep paint (#82), or move to the offset form if the legs should read thicker.** The offset form
   is paint plus a radius grow and costs nothing. SDF shell trousers are 1.48x for no visible gain at game range.
   - If a hem or cuff edge is wanted later, build the per-prim cuff above rather than shells.
2. **A robed crowd enemy: not as a floor-length SDF robe at today's cost (2.07x close-up).**
   - With a cone-fitted hull piece (est. −20%) and no `warp=` (−8%), the counters put it at about **1.5-1.6x**,
     right at the owner's bar. That is the order to try them in, and the hull piece is the bigger one.
   - A **shorter** loose garment (a kilt, apron or tabard) covers less screen and fewer silhouette pixels. It should
     land well under the robe, but it is unmeasured.
3. **The general win** that would help cloth and every character alike is **bounding the shading taps** (trousers
   shade +53%, cultist ~40% of its cost is shading per PERF.md). It is out of scope here.
4. **Re-time** the game close-up on a quiet machine before quoting milliseconds.

## Files

- `src/lab/sdf-zombie/webgpu/bench-cloth.ts` (+ test): the garment variants; `applyClothQuery` for the game page.
- `src/lab/sdf-zombie/webgpu/bench-main.ts`:
  - `?cloth=`;
  - scene `Z1`;
  - `__sdfBench.census()` and `__sdfBench.counters(mode)`.
- `src/lab/sdf-zombie/webgpu/game-main.ts`: `?cloth=` on the zombie registry entry.
- `src/lab/sdf-zombie/webgpu/shell-hull-outer.ts` (+ tests): `taperedChain`, the prototype.
- `scripts/cloth-cost.mjs` (bench) and `scripts/cloth-cost-game.mjs` (game): the drivers. Both have `DUMP=1`, and
  `TIMING=1` on the bench driver.
