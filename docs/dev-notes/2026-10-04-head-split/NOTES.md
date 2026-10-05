# The head split, part B: notes

## What part B is

An axe chop to a zombie's head splits it open on a hinge (spec
`docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md` §4-§5). The head is not re-modelled: the closed
head's SDF is read through a split field, the union of three rigid capped pieces (the unmoved rest, the + half
turned open, the - half turned open), defined once in `src/lab/sdf-zombie/head-split.ts` (`splitField`). The CPU
reads it there (`sdBody`, B2), the axe drives it through a per-actor leaf and the posed body carries it as
`posed.split` (B3), and the march evaluates the same pieces on the GPU (B4, below). Bounds (B5), post-hit shading
at the un-warped point (B6), the skull mesh (B7) and the gate and look (B8) follow.

## B4: the GPU record and the three-piece field in `mapBody` (2026-10-04)

### What was built

- **Record.** `REC_VEC4S` 17 -> 21. `REC_SPLIT_N` 17 = (n, thetaP), `REC_SPLIT_H` 18 = (h, d0), `REC_SPLIT_A` 19 =
  (a, thetaM), `REC_SPLIT_R` 20 = (r, 0, 0, 0). A closed head is four zero vec4s; an open one has a unit `n`, and
  that is the march's open test, made once in `loadInstance` into `gInstSplitOpen` (the flag every reader uses), so a
  closed body pays ONE extra record read (N) and an open one four.
  `write()` zeroes a split with both angles 0; `alive(slot, false)` zeroes the lanes.
- **View.** `createZombieGpuView` takes `body.split` from the body it is built from and from each `update(body)`
  (the pose is the one source), and every `syncRecord()` writes it. Chunks, the FPV arm and crowd fallbacks pass none and write zeros.
- **`mapBody`.** After the slot's alive test: the caps of up to three pieces (a `vec3 (cap, theta, id)` each), a
  three-scalar compare-swap into ascending cap order, then a piece loop round the whole slot body with the slot's
  point `p` replaced by the piece's un-warped point. Early skip: `cap >= min(dUnion, shell)` ends the loop (exact).
  The caps go on the finished field (after wounds, bones and the normal's noise); the shell bound `C` caps the
  slot's value after its pieces. A side that does not move merges into the rest (`min(cap0, capSide)`), so a
  one-sided split is at most two evaluations. A closed slot is one uncapped piece at the incoming point.
- **Cull.** The upper-bound cull's fold is valid for the piece it was measured on only, so the winning piece rides
  with the slot (`gLastFoldPiece` -> `cullPiece` -> `gCullPiece`). The walk skip is off for an open slot.
- **For B6.** `gHitPiece` (0 / 1 / 2) and `gHitSplitF` (the winning piece's field before its caps) are written
  next to `gHitSlot` by every `mapBody` call: copy them in the march loop next to `hitBest`, later calls
  (the normal's taps, the probes) overwrite them.

### The check set

| Check | Result |
| --- | --- |
| `march-golden -u` | `FOLD_GROUP`, `INSTANCE_STATE`, `MAP_BODY`, `MARCH_TRACE_LOOP` (+ the two that embed it), new `SPLIT_MOVE_BACK`, helper count 49 -> 50 |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss. March module 308115 B -> 315198 B (+7083 B, 83 fns); 315815 B after the review fixes (`gInstSplitOpen`, comments), census and `march-hash` re-run, no pin moved |
| `march-hash` | no pin moved: default `d7392d52…` / wounded `76bd51aa…`, crowd quad `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…` |
| cold boot pair | new 49480 / 49537 ms, base 45524 / 44535 ms warm-up (`drawOnce` 1738 / 1726 vs 1728 / 1728); the machine's load average (`uptime`, 1 min) was 3.5-4.5 during the pair, from the owner's desktop apps |

**The cold compile is about 4.5 s (10%) slower.** The census's own numbers do not show it: the base census ran
in 2.9 s because the base shader was already in the OS Metal cache, and the new text compiled cold (50.1 s, then
44.9 s on a second boot: the capture scripts' Chromes do not leave it cached). The nonce'd pair above is the
like-for-like. Attribution boots (same script): the loader's reads alone, with `mapBody`'s split dead: 44.3 s (no
cost). All of the split dead but the loop: 46.5 s. Live, but without the loop: 49.0 s; without the `splitMoveBack`
calls: 49.5 s; with the point never moved: 48.4 s. **Each is a single cold boot**, and the base pair itself is 1 s
apart, so these variants cannot be told from each other: they say only that the split dead costs nothing and the
split live costs about 4 s, whichever construct is taken out. It is the live split code in a function the compiler
inlines about ten times.

**Accepted (controller, 2026-10-04):** the cold compile cost stands; the shader is not restructured for it. Two
restructurings from the review were NOT tried, should it matter later: a fixed piece order with a per-piece
`continue` in place of the compare-swap sort (fewer live vec3s across the slot body; the skip stays exact, but
without the ascending order a piece is skipped against a worse running best, so more pieces are evaluated), and
flattening the pieces into the slot loop (one loop level instead of two).

### The field on the GPU is the CPU's field

Nothing in the repo evaluates WGSL on the CPU, so two checks:

1. A hand twin of the slot's piece logic (caps, merge, compare-swap, early skip, shell) in TypeScript, run against
   `splitField(sdBodyClosed)` on the posed zombie: `webgpu/march/map-body-split-twin.test.ts`, about 11 000 seeded
   points per case (inside and outside the region, on every seam, and with another slot's value in the running
   union), five cases: max difference 3.5e-16. Mean field evaluations per in-region sample 1.64 / 1.67 (both sides,
   full / 0.3), 1.33 / 1.32 (+ / - side), 1.34 (face); 1.02-1.10 within 1 cm of the surface. The winning piece is
   the CPU's near the surface. The twin is a copy: it is edited together with the WGSL.
2. **GPU against CPU, per pixel** (`geom-*.png`): the 400 x 300 march target's hit mask and depth against a CPU
   sphere trace of `splitField` through each pixel's ray, from the front and from above, per-body (`?crowd=0`),
   every march bound off and the proxy box grown (so B5's clipping is out of the measure), no face wounds.
   With the CPU accepting at the march's half-pixel footprint:

   | View | CPU hit, GPU miss | GPU hit, CPU miss | Smooth px: mean depth error | over 5 mm |
   | --- | --- | --- | --- | --- |
   | closed, front / top (the instrument's floor) | 0 / 0 | 204 / 366 | 0.87 / 0.94 mm | 50 / 288 |
   | middle both, front / top | 0 / 8 | 258 / 398 | 0.92 / 1.07 mm | 39 / 277 |
   | middle one side, front / top | 0 / 0 | 374 / 406 | 0.89 / 1.22 mm | 93 / 186 |
   | face, front / top | 0 / 0 | 518 / 452 | 1.19 / 1.00 mm | 124 / 277 |

   The GPU-only pixels are 75-95% mask-edge pixels (its silhouette is up to a pixel fatter, on the closed head
   too). The few 17-21 cm outliers in the one-sided and face views are edge pixels of an opened piece in front of a
   farther surface; they go (max 25.6 mm) when the CPU accepts at a full pixel.

### Photos (`b4/`)

Forced splits (`__sdfGame.forceSplit`, angleFrac 1) on fresh frozen zombies of the bare ring page, 1280 x 800,
VHS off. Columns: closed, open on the shipped path, the same with finite-difference normals
(`setNormalGradient(0)`), and FD with every march bound off.

- `front-0.6m.jpg`, `front-2m.jpg`: from the front at 0.6 m and 2 m.
- `top.jpg`: from above and behind at 0.75 m.
- `diff-mid-one-0.6.png`: screen pixels changed by more than 8 / 255, closed vs one-sided split (red).
- `geom-mid-one-top.png`, `geom-face-front.png`: the per-pixel GPU / CPU classes (grey agree, brown / red GPU
  only, blue CPU only, yellow / cyan depth over 5 mm).

What they show: the head opens (a V between two solid halves for `middle`, one flap hinged at the jaw for the
off-centre one, the face folded forward and down for `face`); the cut faces are flat and closed; the body below
is where it was.

Numbers (march target rows through the head centre, 3 cm and 7 cm above it; march pixels of 400):

- **The gap.** Middle both at 0.6 m: widest run of misses between hits 4 / 26 / 56 px (0 on the closed head); at
  2 m 2 / 8 / 16 px. Middle one side at 0.6 m: 12 / 33 / 0 px.
- **Solid.** Inside the region's screen disc at 0.6 m: 0-2 isolated hit pixels and 1-2 one-pixel holes of 23 000 -
  32 000 hit pixels; none at 2 m.
- **The body outside the region disc.** Screenshots cannot say: two settled shots of the SAME closed head differ in
  150 000 - 290 000 pixels (8 000 - 22 000 by more than 8). The float march target is steadier but not bit-stable
  either (every body texel differs in the last bits between two reads). Closed vs open, body texels outside the disc
  that moved by more than 0.01: 8 of 1992 (middle both, 0.6 m; max 0.04), 0 of 1996 (one side), 0 of 610 (face); at
  2 m 4 of 5980, 3 of 7012, 0 of 6737.
- **A one-sided split's other half.** March texels of the unmoved half (2.5 cm or more from the plane, within
  12 cm of the head centre) that moved by more than 0.01: 535 of 6138 at 0.6 m, 136 of 579 at 2 m. The diff image
  puts them on the crown along the cut (the face cut's carve and mask reach across the plane), between the eyes and
  on the silhouette rim; the geometry check above has that half in place.

What is wrong in them, by owner:

- **B5 (bounds).** On the shipped path the off-centre flap's tip is cut off ragged, and the folded face is cut by a
  bright band: the proxy box, tiles and hulls are still the closed head's. With the bounds off both are whole.
- **B6 (post-hit).** The face sheet, eye glow and wound masks stay where the closed head was: the halves wear a
  smeared face or none, and the cut faces are shaded as skin at the world point. Analytic and FD normals look alike
  at these angles.
- **B7.** The skull mesh does not follow: the closed skull stands in the gap.
- **Look (B8).** The back half's cut face in the `face` preset is speckled by the face cut's jag; a red cut mask
  shows on the forehead of the one-sided split at 2 m; the flap's tip has a few loose pixels where it reaches `rho`.

### Cost

`__sdfGame.timeDraws(120)` (median ms of 120 draws), headless, 400 x 300 march target, one zombie's head centred.

- **Open vs closed, interleaved four times on one head** (the face cuts are in both states): at 0.6 m open
  25.5 / 26.6 / 23.7 / 24.1, closed 21.5 / 22.5 / 20.0 / 21.4: **+4.0 ms** (spread 2.5-2.9). At 2 m open
  17.6 / 17.8 / 17.2 / 17.8, closed 16.6 / 17.2 / 16.6 / 16.6: **+1.2 ms** (spread 0.6).
- **No split anywhere, new vs base** (the bigger record, one more read and the piece loop on every body): at 2 m
  new 11.5 / 11.9 / 11.7, base 11.3 / 11.6 / 11.4 (about +0.3 ms, inside the spread). At 0.6 m new 19.9 / 20.5,
  base 18.4 / 20.5: **UNRESOLVED** (0 to +1.5 ms); later runs were under a load average of 6-15 and are not
  counted. To re-measure on a quiet machine before B8 quotes a closed-path cost. Cold boot `drawOnce` is unchanged
  (above).

### Decisions

- **The open test is the plane normal, not the angles.** One record read on a closed body instead of two.
- **`gCullRef = best` per piece was not taken.** A fold culled against the best value so far is exact only while
  nothing after the fold lowers the field; a wound's lip does.
- **The whole slot turns with a half.** A hand raised within `rho` of the hinge and above the hinge plane would
  split with the head (accepted for now; B8 looks for it in attack poses. The fix, if needed: turn the head
  cluster only).
- **The per-ray wound list (B5's).** `WOUND_LIST_BLOCK` (`body/blocks/setup/wound-list.wgsl.ts`, the `counts2.w`
  gate, off by default, `__sdfGame.setWoundList`) keeps the wounds whose reach sphere the WORLD ray enters. Wounds are
  stored on the closed head, so with the list on, the face cuts (and any wound) on a moved half can drop out of a ray
  that meets the half where the closed head is not. Untouched in B4; B5 must bypass the list for an open slot
  (`gInstSplitOpen`) or test the un-warped ray.
- **The region shell at range.** `C` is at least 6 cm, far over the hit epsilon up close, but the epsilon grows
  with distance (about half a pixel's footprint): past roughly 30-40 m it reaches 6 cm and the region sphere could
  read as a surface. Not seen at game distances; B5 should bound it when it sizes the split's bounds.

## B5: the bounds, tiles, hulls and the wound list follow the open head (2026-10-04)

### What was built

Every bound that tests a WORLD ray or a screen position against the body described the closed head's prims. They now
read the pose's split through three pure functions in `head-split.ts`:

- `splitHoldBall(w)`: the ball about the hinge `h` of radius `rho = r - REGION_MARGIN`.
- `splitBound(w, centre, radius, reach)`: THE rule for a bound that is ONE sphere. A sphere that reaches the hold
  ball (within `reach`, the march's own blend reach for it: 4 x blendK x its distortion factor) and is not wholly
  below the hinge plane grows to the smallest sphere holding itself and the ball; any other stays.
- `splitSphereImages(w, centre, radius)`: the same rule for a bound made of MANY spheres: the centres of the
  sphere's copies turned with each half it holds flesh of.

| Bound | What it does under a split | Where |
| --- | --- | --- |
| Proxy box (`fit`), and through it the record's box, the ray window, the cone and depth pre-pass twins, the crowd's instanced box and screen rect | the AABB also holds the hold ball | `webgpu/zombie-gpu.ts` `fit` |
| `ROW_CLUSTER_BOUNDS` (the depth pre-pass's miss cull; `mapBody`'s cluster cull reads it too, looser) | each live cluster's sphere through `splitBound` | `zombie-gpu.ts` `upload` |
| Screen tiles (binning, and the per-ray sphere test of the quad dispatch) | each group's sphere through `splitBound`, in the list the binner takes (`getTileGroups`) | `zombie-gpu.ts` `upload` |
| `ROW_GROUP_BOUNDS`, the wound threat masks, the wound bound | unchanged: `mapBody` reads them at a piece's un-warped point, where the closed sphere is exact | - |
| Outer hull (the `shellOut <= 0` discard, `shellIn`, the hull exit bound) | a turned copy of each of the body's chain spheres that holds flesh of a half (`splitSphereImages`) | `webgpu/shell-hull-outer.ts` |
| Occluder (inner) hull | every inner sphere that reaches the hold ball is dropped | `webgpu/occluder-hull.ts` |
| Per-ray wound list | never taken for an open slot (`gInstSplitOpen`), in `applyWounds` itself | `march/fields/wounds.wgsl.ts` |

**The radius is `rho`, not `r`, at every bound.** Each of these bounds where a SURFACE can be. An opened half is
capped at `dh <= rho` and outside the ball the body is where its prims are, so `rho` holds every surface the split
adds; between `rho` and `r` there is only the shell bound `C`, which is not a surface (below).

**The outer hull does not use the ball.** One sphere round the hold ball made every ray through its screen disc
march (40% of the frame at 0.6 m) and cost 1.5 ms more than the turned copies (below). The copies are sound for the
cut faces too: an opened half is the closed head's solid turned rigidly, and the chains hold the closed solid, not
only its skin (tested on sampled solid, not surface).

**The hull's wound spheres stay where they are** (`woundWorldPos` on the closed prims, `game-main.ts` and
`game-seams-render.ts`): the inner hull keeps no sphere near the hold ball, and what it keeps is the unmoved rest
(P0), which reads its wounds at their closed positions. The shadow hull is the closed head's (its shadow is the
closed head's).

**The frozen cast.** The hulls are built once per frozen stretch. The split leaf now asks for that build again
whenever a frozen actor's split changes (`ctx.render.frozenHullBuilt`); before, every frozen capture drew an open
head through the closed head's hull.

### Shipped path against the bounds-off path

Hit texels of the 400 x 300 march target that differ between the shipped path and the per-body path with every
march bound off and the proxy box grown (two sessions, the same cameras to the last bit), inside the region's
screen disc: "clipped" (bounds off hits, shipped does not) / "ship only". The closed head's own count is the
instrument's floor.

| Preset, view | Closed head (floor) | Open, B4 | Open, B5 |
| --- | --- | --- | --- |
| middle both, 0.6 m | 0 / 0 | 1 / 4 | 0 / 4 |
| middle both, 2 m | 8 / 2 | 4 / 2 | 6 / 10 |
| middle both, above-behind | 8 / 2 | 11 / 6 | 5 / 7 |
| middle one side, 0.6 m | 0 / 0 | **215 / 117** | 13 / 10 |
| middle one side, 2 m | 15 / 2 | **44 / 6** | 12 / 4 |
| middle one side, above-behind | 0 / 0 | **205 / 73** | 16 / 2 |
| face, 0.6 m | 17 / 1 | 16 / 5 | 20 / 8 |
| face, 2 m | 23 / 2 | 23 / 4 | 21 / 2 |
| face, above-behind | 0 / 0 | 2 / 2 | 4 / 2 |

The folded face's band was not a mask error but a depth one. Texels both paths hit whose depth differs by over
0.2%: face at 0.6 m **5517** of 33 706 on B4, 204 on B5 (closed head 122); face at 2 m 21 -> 8 (closed 0); the other
seven views 0-128 before and 0-125 after, against 0-127 closed.

**What remains is not a bound.** The two paths start their rays at different distances, so the samples of a ray that
grazes a surface fall differently and one accepts where the other does not: rim texels (the closed head has them
too), and one-texel lines along the flat cut faces seen edge-on (the one-sided split from the front: 16 texels in a
column on the cut's edge). With one bound off at a time on the shipped path (shell, depth pre-pass, temporal start,
hull exit bound) the counts move by 11 at most and never to zero. The secant decides most of them: with it off on
the shipped path alone, the face at 2 m goes from 14 ship-only texels to 0.

### The region shell at range

The march accepts a sample when the field is under `hitEps = max(1.2 mm, t x aaCfg.x x strength / distort)` (the
pixel footprint; `step-config.wgsl.ts`, `trace.wgsl.ts`), or when the last-step secant's root is under `perfCfg.w`
epsilons. The game's values, read from a live view: `aaCfg` = (0.000924, 1, 6, 3), `perfCfg.w` = 4. So beyond 3 m
the epsilon is 0.92 mm per metre (one pixel of the 600-row grid at 58 degrees), and up close the strength is 6,
fading to 1 between 1.5 and 3 m (the product peaks at 1.8 m: 9.1 mm).

- The epsilon alone reaches `REGION_MARGIN / 2` at **32.5 m** and `REGION_MARGIN` at 65 m.
- The secant makes the reach four epsilons. On a field that never goes under `REGION_MARGIN` its root is over
  `REGION_MARGIN` too (`C2 x C1 / (C1 - C2)` with `C1 > C2 >= margin`), so the shell is safe exactly while
  `4 x hitEps <= REGION_MARGIN`: to **16.2 m**. Past that a ray that comes at the shell from far off can take it.
- **The rule** (`splitDrawDistance`, `SHELL_ACCEPT_FRAC` 0.8): the view writes the split into its record only
  while `(d + r) x aaCfg.x x aaCfg.y x max(1, perfCfg.w) <= 0.8 x REGION_MARGIN`, `d` from the eye to the hinge:
  **12.7 m** at the game's defaults, 51.6 m with the secant off. It scales with the live uniforms (a coarser SDF
  pass closes it nearer). The pose keeps the split (every strike and trace); the bounds keep following it. The
  leaf's tick hands each split actor's view the camera's eye (`setSplitEye`); a view nobody feeds draws the split at
  any distance. No hysteresis.
- Measured on the shipped path, all three shapes: the record is open at 12.5-12.6 m and closed at 12.8-12.9 m, and
  from there the march target is the closed head's (0-4 differing texels in the region disc, which is what two reads
  of one closed head differ by; 7-18 just inside the distance). Secant off (`middle` both): open at 51.1 m, closed at
  52.1 m.
- **No false shell hit was seen at any distance.** The measure: hits the open head has outside the hold ball's
  screen disc (by 1.5 texels or more) that the closed head has not, in the annulus out to `r` (14 306 texels at
  1.1 m, 152 at 16 m). On the shipped path: 0-8 from 1.0 to 1.9 m on the two `middle` shapes, 0 from 2.2 m to
  12.6 m but for one texel, and 0-2 beyond, where the record is closed (so 2 is the measure's floor). With every
  bound off (the two `middle` shapes, 1 to 32 m): 0-6 from 1.0 to 1.9 m, then 0 out to 32 m but for one texel at
  10 m; with the secant off as well, 0-1. The texels up close are the secant's fatter rim on the halves' tips
  (they go with the secant, and the reach there is 0.61 x `REGION_MARGIN`, under what the shell needs). The epsilon
  is divided by the dominant prim's distortion factor (1.5 and 3.8 on the head), which is why even 32 m shows none.
  The cut-off is from the law, not from a sighting.
- **Up close** the reach peaks at 4 x 9.1 mm = 0.61 x `REGION_MARGIN` (0.76 x at `?res=640`). The near strength is
  not in the rule. It would pass `REGION_MARGIN` if `aaCfg.x` went over 0.00152: an SDF pass under 0.61 of the
  800 x 600 rung (adaptive resolution is off by default).

### The check set

| Check | Result |
| --- | --- |
| `march-golden -u` | `APPLY_WOUNDS` (the wound list's gate) and the joined helpers; `MAP_BODY` for the comment in the re-review commit |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 315815 B -> 316216 B (83 fns). `warmMs` 2596: the text was already in the OS Metal cache from the captures, so this boot was warm |
| `march-hash` | no pin moved: default `d7392d52…` / wounded `76bd51aa…`, crowd quad `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…` |
| cold boot pair (base `de671db2`) | new 44752 / 44419 ms, base 44503 / 44565 ms warm-up (`drawOnce` 1672 / 1677 vs 1668 / 1670); load average 2.2-2.6 |

### Cost

`__sdfGame.timeDraws(120)`, headless, one zombie's head centred, `middle` both, open and closed interleaved four
times a session; the B4 tree (`cf49fccc`) and this one in alternate sessions, load average 1.8-3.8.

| | Closed | Open | Open - closed |
| --- | --- | --- | --- |
| 0.6 m, B4 (2 sessions) | 17.6-18.1 | 21.1-21.6 | **+3.5** |
| 0.6 m, B5 (2 sessions) | 17.5-17.9 | 23.4-24.2 | **+5.9 / +6.4** |
| 2 m, B4 | 11.5-12.6 | 12.1-12.5 | +0.4 / +0.6 |
| 2 m, B5 | 11.5-11.7 (one session: outliers to 14.2) | 12.4-12.8 | +1.1 (the other session unreadable) |

The closed head costs what it did (17.5-18.5 over six B5 sessions against 17.6-18.1; the wound list's gate alone,
A/B in alternate sessions: no difference). The open head costs 2.4 ms more than on B4 at 0.6 m, because more
pixels march it. Where that goes (0.6 m, open, one session each): with no hull addition at all (tips clipped)
21.9-22.2; with one sphere round the hold ball as the hull 24.9-26.1, and that without the tiles' growth
23.6-24.4. Not tried: the tile groups and cluster spheres could take the turned copies' rule too (the bounding
sphere of a sphere and its copies in place of the sphere and the whole ball).

### Photos (`b5/`)

B4's cameras and scenes, so the sheets lie next to `b4/`.

- `front-0.6m.jpg`, `front-2m.jpg`: closed, open on B4's shipped path, open on B5's, and B5 with the march bounds
  off. The one-sided slab's tip is whole and the folded face has no band; columns 3 and 4 are the same picture.
- `top.jpg`: from above and behind, the same three open columns.
- `mask-mid-one-0.6.png`, `mask-mid-one-top.png`, `mask-face-0.6.png`: the march target, shipped against bounds
  off, B4 left and B5 right (grey both hit, red bounds off only, blue shipped only, yellow depth over 0.2% apart).

Still wrong in them, and whose: the halves wear a smeared face or none and the cut faces shade as skin (B6); the
closed skull stands in the gap (B7); the slab's tip has loose pixels where it reaches `rho`, with the bounds off
too, and the `face` preset's crown is speckled by the face cut (B8).

### For the tasks after

- **The split's motion is not in the motion vectors** (the previous-frame prim rows are the closed head's): while
  the spring moves, a half's object motion reads zero. Temporal accumulation is off by default.
- **The actor visibility cull** (frustum, clear sight) was not looked at: it still judges the closed body.
- **A split that closes at 12.7 m pops.** At that distance it changes 14 texels of the march target.
- The per-ray wound list (off by default) is built from the base slot's wounds only and read by every slot of a
  crowd pixel; the split's gate does not change that.

