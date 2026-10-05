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
read the pose's split through one gate and three rules in `head-split.ts`:

- `splitHolds(frame, centre, radius)`: THE gate. Which turning halves a sphere of the closed body can hold flesh of:
  it must reach above the hinge plane, into the hold ball, and onto the side of the old plane of a half that turns.
  `splitFrame(w)` makes the split ready for it once (`u = n x a`, `rho`).
- `splitHoldBall(w)`: the ball about the hinge `h` of radius `rho = r - REGION_MARGIN`.
- `splitBound(frame, centre, radius, reach)`: the rule for a bound that is ONE sphere. A sphere that holds flesh of
  a turning half (the gate, with `reach`: the march's own blend reach for it, 4 x blendK x its distortion factor)
  grows to the smallest sphere holding itself and the hold ball; any other stays.
- `splitSphereImages(frame, centre, radius)`: the rule for a bound made of MANY spheres: the centres of the
  sphere's copies turned with each half it holds flesh of.

| Bound | What it does under a split | Where |
| --- | --- | --- |
| Proxy box (`fit`), and through it the record's box, the ray window, the cone and depth pre-pass twins, the crowd's instanced box and screen rect | the AABB also holds the hold ball | `webgpu/zombie-gpu.ts` `fit` |
| `ROW_CLUSTER_BOUNDS` (the depth pre-pass's miss cull) | each live cluster's sphere through `splitBound` | `zombie-gpu.ts` `upload` |
| Screen tiles (binning, and the per-ray sphere test of the quad dispatch) | each group's sphere through `splitBound`, in the list the binner takes (`getTileGroups`) | `zombie-gpu.ts` `upload` |
| `mapBody`'s per-step culls, at a piece's UN-WARPED point | tiled path (the crowd): `foldGroup` culls with the tile entry's sphere, the GROWN one. Cluster walk (per-body, the cone and depth pre-pass): the cluster cull reads the GROWN `ROW_CLUSTER_BOUNDS`, the group cull the CLOSED `ROW_GROUP_BOUNDS`. Sound either way (a grown sphere holds the closed one); a grown one culls less | `march/map-body.wgsl.ts`, `march/fields/groups.wgsl.ts` |
| `ROW_GROUP_BOUNDS`, the wound threat masks, the wound bound | unchanged: closed spheres | - |
| Outer hull (the `shellOut <= 0` discard, `shellIn`, the hull exit bound) | a turned copy of each of the body's chain spheres that holds flesh of a half (`splitSphereImages`) | `webgpu/shell-hull-outer.ts` |
| Occluder (inner) hull | an inner sphere is kept only if it holds no flesh of a turning half (the gate): the jaw and neck spheres below the hinge plane stay | `webgpu/occluder-hull.ts` |
| Per-ray wound list | never taken for an open slot (`gInstSplitOpen`), in `applyWounds` itself | `march/fields/wounds.wgsl.ts` |

**The radius is `rho`, not `r`, at every bound.** Each of these bounds where a SURFACE can be. An opened half is
capped at `dh <= rho` and outside the ball the body is where its prims are, so `rho` holds every surface the split
adds; between `rho` and `r` there is only the shell bound `C`, which is not a surface (below).

**The outer hull does not use the ball.** One sphere round the hold ball made every ray through its screen disc
march (40% of the frame at 0.6 m) and cost 1.5 ms more than the turned copies (below). The copies are sound for the
cut faces too: an opened half is the closed head's solid turned rigidly, and the chains hold the closed solid, not
only its skin (tested on sampled solid, not surface).

**The hull's wound spheres stay where they are** (`woundWorldPos` on the closed prims, `game-main.ts` and
`game-seams-render.ts`): the inner hull keeps no sphere that holds turning flesh, and what it keeps is flesh that
has not moved, which reads its wounds at their closed positions. The shadow hull is the closed head's (its shadow is the
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
  DRAW stage hands the leaf the render camera's eye (`game-main.ts` -> `drawEye` -> each split actor's
  `view.setSplitEye`), so it is this frame's eye after a teleport and while the sim is paused; a dropped actor's
  eye is taken back, and a view nobody feeds draws the split at any distance.
- **Hysteresis** (`SPLIT_REOPEN_FRAC` 0.9): closed for range, the split opens again only inside 0.9 x the distance
  (11.4 m). Measured on the shipped path: open at 12.58 m, closed at 13.01 m, still closed back at 11.71 m, open at
  11.31 m. The range is forgotten when the split or the eye goes, so a head split afresh at 12 m is drawn.
- **`view.splitDrawn`** is the split the record carries (null for a closed pose or one closed for range). Whatever
  else draws the head (B7's skull mesh) must follow it, not the pose, or it stands open past the cut-off over a
  closed march.
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
- **Up close** the reach peaks at 4 x 9.1 mm = 0.61 x `REGION_MARGIN` (0.76 x at `?res=640`): `splitNearReach`,
  the near accept law (`aaKt`) times the secant factor. The draw distance cannot help there (the boost is strongest
  at 1.8 m, melee range), so nothing closes the split for it. It passes `REGION_MARGIN`, and the region sphere can
  then be drawn as a ball round an open head, in two ways: `aaCfg.x` over 0.00152 (an SDF pass under 0.61 of the
  800 x 600 rung; adaptive resolution is off by default), or a last-step factor of 7 or more (`?laststep=7`,
  `setLastStep`; it ships at 4). The shipped numbers live in `webgpu/game-march-accept.ts` and a test holds them
  under the margin; a view that draws a split under a live configuration over it warns once in a dev build.

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
pixels march it. Where that goes (0.6 m, open, one session each unless said):

| Variant | Open, ms |
| --- | --- |
| B4 (the closed head's bounds; tips clipped) | 21.1-21.6 |
| B5 with no hull addition at all (tips clipped by the hull) | 21.9-22.2 |
| B5 with one sphere round the hold ball as the hull, without the tiles' growth | 23.6-24.4 |
| B5 with one sphere round the hold ball as the hull | 24.9-26.1 |
| **B5 as built** (turned copies in the hull, tiles grown to the hold ball; 6 sessions) | 22.9-24.3 |
| B5 with the tiles and cluster spheres grown only to their turned copies (4 sessions) | 22.8-24.0 |

**The turned-copy rule for the tiles was tried and not kept.** `splitBound` as the smallest sphere holding a sphere
and its turned copies, in place of the sphere and the whole hold ball: the head's three group radii at the full
`middle` angle go 0.121 / 0.137 / 0.150 m closed -> 0.164 / 0.168 / 0.174 m, against 0.263 / 0.263 / 0.281 m for
the hold ball. The shipped-against-bounds-off table came out the same to the texel. Open head at 0.6 m, four
sessions of each in alternation (load average 2.3-3.1): 23.41 ms against 23.59 ms mean (open minus closed 5.4 /
6.0 / 5.9 / 6.1 against 6.1 / 6.4 / 5.8 / 5.7), a 0.2 ms gain inside a 0.2-1.2 ms spread, under the 0.3 ms it had to
show. The hold ball stays the one-sphere rule.

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
- **A split that closes at 12.7 m pops** (and opens again at 11.4 m). At that distance it changes 14 texels of the
  march target.
- The per-ray wound list (off by default) is built from the base slot's wounds only and read by every slot of a
  crowd pixel; the split's gate does not change that.

## B6: shading after the hit follows the opened halves (2026-10-05)

### What was built

The march hit an opened half in the right place (B4) but shaded it at the WORLD point: the face sheet, the eye glow,
the wound masks and the rest anchor were read where the closed head had been, and the cut faces were lit skin. The
body's wounds, rest rows, bones and face live on the closed head, so everything anchored to the body now reads the
hit piece's un-warped point or frame. Lighting, the normal's taps and the probes stay at the world point.

- **The hit's own copy.** The walk copies `gHitPiece` / `gHitSplitF` into `hitPiece` / `hitSplitF` at every sample,
  next to `hitRefold` (`body/trace.wgsl.ts`; the refine entry's `REFINE_LOOP` too). Nothing after the walk reads the
  globals: `calcNormal` and the probes have overwritten them by then.
- **The un-warped pair** (`body/blocks/post/split-hit.wgsl.ts`, spliced right after `let p = camPos + rd * t;`):
  `splitTheta` (the hit piece's angle; 0 off a turned half), `pS` (`splitMoveBack(p, …, splitTheta)`), `splitQ` (the
  piece's turn as a quaternion), `faceCentre` / `faceQuat` (the record's head frame turned with the piece),
  `splitIn` (the hit is inside an open head's region sphere) and `cutFace`. Directions cross between the frames
  with the existing `qRot` and `qMulQ`: no new helper (the include list is still 50).
  A hit that is not on a turned half takes `p`, the record's frame and the identity themselves (`var pS = p;`, the
  rotation only behind `if (splitTheta != 0.0)`): `h + R(a, 0)(p - h)` is not bit-equal to `p`.
- **Who reads what** (every post-hit use of the world point or the normal):

  | Block | Reads | Now |
  | --- | --- | --- |
  | shading normal: the rest anchor (`restPoint`, `noiseLocal`) | the point | `pS`. Everything on `anchor` follows: micro-detail, mottle, viscera lumps, body grain, gore, meat detail, burn noise, melt patches, the output-res detail pass |
  | shading normal: `ngBody` / `ngDetail` | the world point, the closed body | skipped inside an open region (below) |
  | shading normal: `calcNormal` | the world point | world (it differentiates `mapBody`, which is the split field) |
  | wound masks: `woundMask`, `charMask` | the point, the smooth normal | `pS`, and `nSmoothS` = the normal turned into the piece's frame |
  | tissue ramp | `hitField.w` (pre-wound field, uncapped) | the same; on a cut face `hitSplitF` |
  | face layer | `p - gInstHeadCentre`, `gInstHeadQuat` (projection, `facing`, the bump to world) | the turned frame `faceCentre` / `faceQuat`, so the layer's own maths is unchanged; gated off on cut faces |
  | body grain, micro-detail | a noise vector added to `n` | world, as on any limb that turns (their comments say so); the cells come from `anchor` |
  | burn: bone probe and its four taps | the point | `pS`; the bone normal turned out to the world (`qRot(splitQ, boneN)`) |
  | wet (surface prep) | `wm`, `tissueDepth` | a cut face is wet at every depth |
  | motion vector (`prevPosed(anchor) - p`) | the point | `- pS`: the closed body's motion (with the anchor at `pS`, `- p` would have reported the half's whole offset) |
  | flashlight, light list, AO / scatter probes, wound and level shadow, ambient, the deferred AO probe | the point, the normal | world |

- **The mesh face layer** (`baked-chunks.ts`) is the march's by regex renames. What the split-hit block hands the
  layer is DECLARED ahead of it there (`let faceCentre = headCentre; let faceQuat = headQuat; let cutFace = 0.0;`: a
  settled head mesh is one rigid piece), not renamed inside it, so a later write to one of them in the march cannot
  come out as an assignment to a literal.
- **The re-fold report.** `gRefoldWin` (the normal hint) was whatever piece won a limb re-fold last. A win is now
  also filed under its piece (`gRefoldBy.x / .y / .z`), and the walk takes the HIT piece's entry for an open slot.
  Both writes sit in the win's own branch; `mapBody`'s per-sample path is untouched (see Cost). A closed slot reads
  `gRefoldWin` as before. `gWoundOwners` needed nothing: it is reset per piece and read only by that piece's own
  re-fold, nothing outside `mapBody` reads it. The hand twin (`map-body-split-twin.test.ts`) is unchanged: the
  pieces compute what they did.
- **Normals.** Inside an open head's region sphere (`splitIn`: the slot is open and `|p - h| <= r`) the analytic
  gradient is skipped and the existing finite-difference fallback runs. Not only on turned halves: the unmoved
  piece's hinge-plane and ball caps are not in the analytic gradient either. The pixel reports reason 8
  (`normal-gradient-reference.ts NG_REASON_SPLIT`) only where the gradient was asked for (analytic mode on); with
  the mode off it reports 7 as it always did. The wound-coverage probe (`game-seams-debug-probe.ts
  normalWoundCoverage`) has nine reason buckets and counts those pixels in a `split` region of their own, before
  it asks the closed body's `sdBody` anything: that is the wrong oracle for a turned or capped piece.
- **Cut faces** (`head-split.ts SPLIT_SHADE = { cutLo: 0.0015, cutHi: 0.004 }`). The gate is
  `cutFace = smoothstep(cutLo, cutHi, hitField.x - hitSplitF)`: how far a piece cap holds the split field above the
  piece's own field. That gap is exactly 0 on skin and on every closed body and equals the depth inside the closed
  body on a cap, so it does not fire on skin the walk accepted a few millimetres deep (a wound lip) or dented, as
  `-hitSplitF` alone would. On a cut face: the one wound mask is raised to `cutFace` (`wm`, `wmRim`), the tissue ramp
  takes the depth `-hitSplitF` (so the face is a cross-section: skin at the rim, the pale fat band, red, clot), it is
  wet at every depth, and there are no skin pores, no body grain (already masked by `wm`), no face sheet, glow or
  relief, and none of what the closed body's wounds and burns throw THROUGH the solid at `pS` (cavity, tear, cloth
  marks, char). No new material: the existing wound interior.
- **The eye glow** is the face sheet's emissive term, inside the face layer, so it follows from the turned frame.
  The pink eyeballs in the gap are the skull mesh's seated eyes (B7).
- **The walk's shell noise** (`woundCfg2.z`; 0 in the game) is read at the sample's own piece's un-warped point and
  fades out over the same gate; a sample over a cut face is no shell sample at all (the walk stays relaxed there).
  The noise still displaces the first 1.5-4 mm of a cut face from its rim, where the gate is fading: a hard cut-off
  would step the field at the skin / cap edge.
- **A leftover of B5, fixed here:** `normal-gradient-probe.wgsl.ts` copies the globals `applyWounds` reads, and B5's
  wound-list gate added `gInstSplitOpen`; the probe's test had been failing since (the dev probe page would not
  compile). One name added, its own commit.

### The check set

| Check | Result |
| --- | --- |
| `march-golden -u` | `MAP_BODY`, `APPLY_WOUNDS` (the `gRefoldBy` private), `MARCH_TRACE_LOOP`, `MARCH_TRACE_POST`, `REFINE_LOOP`, `FACE_LAYER_WGSL`, `MARCH_BODY_SURFACE_PREP`, `MARCH_BODY_LIGHT` and what embeds them; helper count 50, unchanged |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 316216 B -> 324134 B (83 fns, as before). Cold `warmMs` 44453 at load 2.5-2.9 (two earlier texts of this task: 47557 and 49836 at load 4-5.5) |
| `march-hash` | no pin moved: default `d7392d52…` / wounded `76bd51aa…`, crowd quad `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…` (run three times over the task, on each text) |
| cold boot pair (base `6bdded42`) | new 44382 / 44291 ms, base 44283 / 44089 ms warm-up (`drawOnce` 1659 / 1655 vs 1665 / 1682); load average 2.6-3.2. An earlier text under load 4.3-6.2: new 45177 / 46491, base 45205 / 45222 |

After the review fixes (`wmBoth` edited before it is taken apart, reason 8 in analytic mode only, the mesh layer's
declared names): `march-golden -u` (`MARCH_TRACE_POST`, `MARCH_TRACE_LOOP` for a comment, and what embeds them);
`compile-census` ready, `uncapturedCount` 0, no device loss, march module 324498 B (83 fns), cold `warmMs` 52174 with
`drawOnce` 1875 on a machine running about 10% slow at the time (load 3.4-3.9; the timing sessions beside it read
21.7 where they had read 19.5); a cold boot pair then had the BASE tree as slow: new 48400 / 53787 ms, base 47973 /
52126 ms (load 3.3-4.0, swinging 4-5 s between rounds in both trees, so no cost can be read off it); `march-hash`:
the same six pins.

**The whole tree** (`npx vitest run src/lab/sdf-zombie --exclude '**/cut-wound.test.ts'`): 508 files, 7360 tests
passed, 1 skipped. At `1277bebe` it had ONE red test, which the targeted set did not run:
`entrails-gates.test.ts` gate 1a counts every mention of `wmCav` in the march (its single-sink rule: `visceraAmp` 0
shades as before entrails), and the cut-face block wrote to it. Green at `6bdded42`, red at `1277bebe`, green again
with the masks edited as one vector before the destructure; the gate itself was not touched. Run the whole tree
before a march commit.

### The numbers

The march target is the camera's own projection; the lens comes after it. `__sdfGame.screenPosOf` places a world
point on it, `flail.toScreen` (lens-mapped, right for screenshots) does not: with the latter a point cast from a
texel came back 10 texels off at 0.6 m. B4's and B5's march-target discs were placed with `flail.toScreen` (they
carry a margin of a few texels; not re-measured).

**(a) The face rides the half.** Each painted eye's glow in the march target (r over 2: the glow is HDR, lit skin
tops out near 1), closed and open. The closed eye's surface point (a CPU ray through the glow's centroid) goes
through `warpPoint` and is projected: that is where the CPU says the eye is on the open head.

| Preset, distance | The CPU moves the eye | Open glow centroid, off the prediction | Its surface point, un-warped, off the closed eye's | B5 |
| --- | --- | --- | --- | --- |
| middle both, 0.6 m | 25.6 / 23.1 texels (51 / 46 mm) | 0.2 / 0.2 texel (0.5 screen px) | 0.7 / 0.5 mm | one eye: 2 glow texels left, 59 texels off; the other: 18 of its 36 texels still at the closed spot |
| middle both, 2 m | 7.1 / 6.5 texels | 0.37 / 0.35 texel | 3.3 / 3.0 mm (the texel is 3.7 mm there) | no glow texel at all |
| face, 0.6 m | 50 / 47 texels (113 / 104 mm) | 0.34 texel on the eye in view (23 texels); the other shows 2 texels, 1.85 off | 1.1 mm | no glow texel |
| face, 2 m | 13 / 12 texels | 0.94 texel (2 texels in view; the other eye hidden) | - | no glow texel |
| middle one side, 0.6 m | the plane (offset 4 cm) cuts THROUGH the moved side's eye | the flap carries 8 of its texels, 3.4 texels from the whole eye's predicted centre; 10 stay on the still side's cut edge | - | the flap has none |
| middle one side, the still side's eye | 0 | 0 (36 of 36 texels in place) | 0 | the same |

**(b) A wound's mask sits on its crater.** One pellet crater on one half's brow and one rod cut down the other
half's temple, stamped on the closed head through the seams, then the split (`middle`, both). With the tissue
colours painted green the mask is the rise in green chromaticity against the same open head without wounds; the
crater is where the surface went in by over 3 mm (`b6/mask-vs-crater.png`).

| Wound, view | Moved with its half | Mask centroid to crater centroid, B5 -> B6 | Crater texels masked, B5 -> B6 |
| --- | --- | --- | --- |
| pellet crater (radius 5.5 cm), front 0.6 m | 27.0 texels | 14.2 -> **0.54** texel | 43% -> 73% |
| rod cut (half-length 3.5 cm, kerf 1 cm), front 0.6 m | 22.7 texels | 8.66 -> **0.39** texel | 4% -> 73% |
| rod cut, three-quarter view | 20.2 texels | 7.35 -> 2.56 texels | 35% -> 57% |

A pellet crater on a head is 5.5 cm in radius, most of a half's face, so one was stamped, not a few.

**(c) Closed bodies.** The six `march-hash` pins above. By construction every rotation is behind
`splitTheta != 0.0` or `gInstSplitOpen`, and the rest are selects that pick the old value (pinned by text in
`split-hit.wgsl.test.ts`, with a hand twin of the formulas against `unwarpPoint` / `unwarpDir` / `warpDir` /
`headLocalPoint`: worst difference under 1e-12 over 4 x 4000 points, and the very same values off a turned half).

**The shell noise** (switched on for the test, 0.016; above-behind): depth moved by the noise on the 1035 cut-face
texels: B5 median 10.8 mm, none still; B6 median 0.00 mm, 61% exactly still (what moves is the rim band and the
face cuts' own walls, which are wound surface, not cap). Skin: 9.4-10.2 mm mean in both.

**The burn block's bone taps** (`?skeleton=procedural`, fully charred; `b6/shell-and-char.jpg`): on B5 the cut
faces were painted ivory, the bone probe reading the closed head at the world point; on B6 they are charred like
the rest. No bone shows through the head's own skin at these settings in either.

### Cost

`__sdfGame.timeDraws(120)`, headless, one zombie's head centred; base (`6bdded42`) and new in alternate sessions,
three each, load average 2.0-2.8.

| | Closed, base | Closed, B6 | Open, base | Open, B6 | Open - closed, base / B6 |
| --- | --- | --- | --- | --- | --- |
| 0.6 m | 17.75 / 17.95 / 17.85 | 18.15 / 18.15 / 18.1 | 23.75 / 23.95 / 23.95 | 24.1 / 24.25 / 23.95 | +6.0 / +6.0 / +6.1 against +6.0 / +6.1 / +5.9 |
| 2 m | 11.4-12.2 | 12.1-12.8 | 12.6-13.6 | 12.6-13.9 | unreadable: single draws spread 1-4 ms in both trees |

- **Finite-difference normals in the region cost nothing that shows:** open minus closed is +6.0 ms before and
  after.
- **A closed body costs 0.1-0.3 ms more at 0.6 m, unattributed.** As committed first (`1277bebe`): 18.1 against
  17.85, and on another closed head, three sessions each, 19.8 / 19.8 / 19.8 against 19.3 / 19.6 / 19.5. With the
  review fixes: 19.7 / 19.8 / 19.7 against 19.6 / 19.5. It computes the same values (the pins), and no part of the
  change was shown to carry the cost.
- **Hoisting the hit copies out of the walk was tried and reverted.** The walk copies `gHitPiece` / `gHitSplitF`
  and picks the open slot's hint at every sample. Taking them once after the walk is sound (the eps, graze and
  secant accepts all break in the iteration of the `mapBody` call that accepted; a retraction goes round again, so
  its accepting call is the later one; the refine entry's last call is its accepting one; nothing between there
  and the split-hit block calls `mapBody`: the debug counters, `loadInstance`, the debug returns). But it was
  SLOWER on a closed head at 0.6 m, sessions interleaved: 20.3 / 20.2 hoisted against 19.7 / 19.8 in the walk, base
  19.6 / 19.5 (single draws within 0.2-0.4 of each session's median). A third round ran under a load spike and is
  not counted. Like the re-fold report below, it is probably which privates stay live across the inlined `mapBody`,
  not the count of statements (not shown: no variant isolated it).
- **The first form of the re-fold report cost 0.5 ms more than that** and was replaced. It kept the win in a
  per-piece local and wrote `gRefoldWin` on the per-sample path (one guarded write per piece, one at the union
  min). On a closed head at 0.6 m, sessions interleaved: base 19.6, the new post with the base's `mapBody` 19.7,
  that form 20.2, a lighter one (the closed slot's write back in the win branch) 19.9; two earlier rounds had that
  form at 21.0 / 20.9 against 20.1 / 20.1, and 20.4 / 20.4 with the base's `mapBody`. `mapBody` is inlined about
  ten times, and a line on its per-sample path is paid at every step of every ray: keep bookkeeping in the rare
  branches.

### Photos (`b6/`)

B5's cameras and scenes; B5 left, B6 right.

- `front-0.6m.jpg`, `front-2m.jpg`: closed, open on B5, open on B6, for `middle` both, `middle` one side and `face`.
  Each half wears its own half of the face with its eye; the folded face of the `face` preset shows its brow, nose
  and both eyes from above; the cut faces are red flesh with a pale rim, not skin.
- `top.jpg`: from above and behind. The cut faces are wound interior (dark red where the light does not reach,
  bright wet red under the flashlight).
- `wounds.jpg`: the pellet crater and the rod cut of (b), front, three-quarter and above-behind.
- `mask-vs-crater.png`: the march target of (b), mask against crater, B5 and B6.
- `shell-and-char.jpg`: the shell noise switched on, and the charred head with the procedural skeleton.

Still wrong in them, and whose:

- The closed skull stands in the gap, with its seated eyeballs (B7).
- The cut faces are one flat wet red, garish where the flashlight hits them square at 0.6 m, with no bone ring and
  no brain; the tissue ramp reaches its clot stop 3.5 cm in, so most of a face is the darkest stop (B8).
- A one-sided split 4 cm off centre cuts through an eye: a sliver of glow stays on the still side's cut edge and
  the rest rides the flap. Correct for the plane, odd to look at (B8: the offset, or the eye disc).
- Pale streaks along the halves' inner edges and the speckle on the `face` preset's crown are the face cuts' own
  lips and jag; the red cut mask on the forehead of the one-sided split at 2 m is the face cut's band (B8).
- The normal's silhouette noise is under the caps (`max(f + noise, cap)`), so within the noise's reach of a cut
  face's rim (up to about a centimetre where the noise pushes the skin out) the normal can be the skin's, not the
  cap's. Not picked out in the photos; noted for B8.

### For the tasks after

- **B7:** the face sheet now rides the halves, so the skull mesh in the gap is the one thing left at the closed
  position. `faceCentre` / `faceQuat` (`split-hit.wgsl.ts`) are the turned head frame, if the skull's shading wants
  the same.
- **B8:** `SPLIT_SHADE` holds the cut-face gate; the look itself is the wound interior's (`surfCfg3`, `deepColor`,
  `fatColor`, the wet boost). The gate also drives the face layer's fade and the shell noise's.
- **A detached or baked head** takes the mesh face layer with no split (`cutFace` 0, the mesh's own frame). A split
  head that is then baked would need its own answer.
- **Motion vectors** carry the closed body's motion only (unchanged in kind: the previous-frame rows are the closed
  head's).
- **A cross-slot leak of the normal hint, a known and separate follow-up.** In a crowd pixel `gRefoldWin` is the
  last slot's that won a re-fold, not the union winner's, for closed bodies too (as it was before the split), and
  `gRefoldBy` is filed by piece, not by slot, so an open head's hit can read another slot's win under the same
  piece number. It takes two slots winning limb re-folds at one sample, and it steers only the normal hint
  (`gNormalHint`) and `gNgOwnedOk`, never the field. Fixing it moves what closed crowd pixels compute, so it is its
  own task, with its own `march-hash` re-pin.

## B7: the skull mesh cracks and splits with the head (2026-10-05)

### What was built

The skull is a forward-rendered mesh of the CLOSED head's bone (`webgpu/skeleton-spike/mesh-renderer.ts`); after B6 it
was the one thing still standing whole in the gap. The owner (2026-10-05, on the B6 photos): "looking pretty good,
though the skull/mesh would need some states where it's cracked/split". So the bone does not simply ride its flesh
half: it opens LESS, in stages, and breaks along a ragged edge.

- **The rule** (`head-split.ts`, pure): `skullSplitOf(warp, follow?, seed)` makes the skull's split from the split
  the view DRAWS. Each half's bone angle is its flesh angle x `follow(frac)`, `frac` = the flesh angle over the
  preset's full angle, `follow` a piecewise-linear table (`HEAD_SPLIT.skull.follow`). `frac` needs the preset's full
  angle, which the warp did not carry: `SplitWarp.full` is new (written by `splitWarpOf`; the GPU record does not
  take it), so nothing reads the leaf's state. `frac` is held at 1 and `follow` in 0..1, so a spring overshoot never
  turns the bone past its flesh. A bone that does not turn at all (`follow` 0) is no split: the closed draw.
  The stage is the spring's TARGET (`SplitWarp.target`, review fix below): `frac` = min(flesh angle, target) / full.
  `skullPieceAt(s, q, jag)` is the ownership of a closed-skull point (the flesh's rule, `warpPoint`: above the hinge
  plane, within `rho`, by the side of the plane; but a side whose bone does not turn belongs to the rest, and the
  plane is the fracture, `s(q) + jag >= 0`). `skullWarpPoint` is the forward map; `skullPieces(s, centre, radius)`
  says which pieces can own part of a sphere.
- **Driven from `view.splitDrawn`** (`game-main.ts`): the mesh update's new `split` hook answers the view's drawn
  split for the `'head'` segment. `drawEye` (which settles `splitDrawn` for the frame) moved up, ahead of the mesh
  update: it was after it, and the skull would have opened or closed a frame after the flesh at the range cut-off.
- **Per-piece copies** (`mesh-renderer.ts drawPieces`): a segment (or eye) the hook answers for is drawn once per
  piece that owns part of its bounding sphere: the rest at its closed matrix, a half at
  `T(h) R(a, bone angle) T(-h)` x that matrix. A sphere the rest owns alone stays ONE instance in the closed batch.
- **Their own batches and materials.** The copies draw from a second `BufferGeometry` that shares the segment's
  vertex attributes and index (the same objects, so the same GPU buffers) and has its own instance data, on two
  new materials (bone and eye). A closed head touches none of it: same batch, same material object, same instance
  count and matrices (tested), and the pixels below.
- **The clip** (`mesh-split.ts MESH_SPLIT_CLIP_WGSL`, hand-written, through the material's `wgslFn` chain and
  `maskNode`): the fragment is taken back by the copy's angle about the hinge to the UN-TURNED point `q`, and kept
  if the copy's piece owns `q`. The surface function reads `q` where the closed material reads `positionWorld`, so
  craters and bone exposure (stored on the closed head) sit right on a turned copy. Lighting stays at the turned
  place. `meshSplitKeep` is the clip's hand twin, tested against `skullPieceAt` on 3000 points x 4 cases.
- **The fracture** (`MESH_SPLIT_JAG_WGSL` / `meshSplitJag`): the offset `jag(q)` is read in the split's own frame
  (along the hinge axis, up from the hinge), so it rides the head and is the same number for both halves at the
  same point: the two edges are complementary. A zig-zag (a triangle wave along each of the two directions, phase
  pushed about by a slow noise) plus square chips (a constant per cell). The hinge plane and the ball stay clean.
  A per-head seed (the order heads first split) shifts the pattern.
- **The inside of the bone.** The closed material is front-faced, so a clipped shell would be see-through. The split
  materials are two-sided; a back face is the inner wall: one dark colour, wet, no grazing sheen
  (`MESH_SPLIT_INSIDE_WGSL`). Within 4 mm of the break the wall takes the colour of cut bone (`rim`): the mesh has no
  thickness, and seen across the gap that band reads as the bone's.
- **The per-instance record:** four vec4s (`iSplitN` = n, d0; `iSplitH` = h, the copy's bone angle; `iSplitA` = a,
  rho; `iSplitK` = piece, + turns, - turns, seed) in ONE interleaved instance buffer. With four separate buffers
  the pipeline had 9 vertex buffers and WebGPU allows 8 (the first capture said so: "Vertex buffer count (9)
  exceeds the maximum number of vertex buffers (8)").
- **Seams:** `__sdfGame.skullSplit({ follow, zigAmp, zigLen, chipAmp, chipLen, inside, rim, rimWidth })` (the look,
  live; `follow: null` puts the table back) and `__sdfGame.meshSkeletonShow({ bones, eyes })` (diagnostics: a shown /
  hidden pair of one frame tells bone pixels from flesh).

### Measured on the zombie (rest pose)

| | middle, both | middle, one side (4 cm) | face |
| --- | --- | --- | --- |
| Skull vertices (of 2220) above the hinge plane | 1720 | 2018 | 2080 |
| ... their largest distance from the hinge, against `rho` | 0.205 / 0.263 m | 0.213 / 0.270 m | 0.219 / 0.273 m |
| Seated eyes (radius 19 mm): centre off the plane | 36 mm each side | 4 mm and 76 mm | 34 mm, both on the face side |
| Top neck vertebra (`axial:2-3`, 272 vertices) above the hinge plane | 4 (to 4 mm) | 56 (to 34 mm) | 72 (to 44 mm) |
| ... of them on a side that turns | 4 | 0 | 10 |

- Every skull and eye vertex is inside `rho` with 5 cm to spare. The clip keeps the ball term all the same (one
  `length`): `rho` rides the record's spare lane, and the rule is then the flesh's with no measured assumption.
- There is no jaw segment: skull and jaw are ONE `'head'` mesh, and it has vertices below the hinge plane in every
  preset (500 / 202 / 140), so the unmoved rest is always drawn.
- **Only the `'head'` segment splits, on purpose.** The top vertebra pokes up to 44 mm above the hinge plane, where
  its flesh turns with a half. It stays whole with the neck: a sliver of spine carried off by an infinite plane is
  an artefact, a spine tip left standing in the cut reads as spine. In `face`, 10 of its vertices stand up to 44 mm
  proud of the still half's cut face; in `middle` both, 4 vertices by 4 mm; in the one-sided split none are on the
  side that turns.

**Instances per head** (skull copies + eye instances): closed 1 + 2, as before. Middle both: 3 + 2 (each eye wholly
in its own half: one copy). Middle one side: 2 + 3 (the plane passes through one socket: that eye is drawn for both
pieces; the other eye stays a closed instance). Face: 2 + 2.

### The constants (all in `HEAD_SPLIT.skull`, live through the seam)

| Constant | Value | |
| --- | --- | --- |
| `follow` | (0.55, 0.1), (0.8, 0.3), (1, 0.85) | the bone's share of the flesh angle at chop 1 / chop 2 / the kill |
| `jag.zigAmp`, `jag.zigLen` | 4 mm, 22 mm | the zig-zag's amplitude and period |
| `jag.chipAmp`, `jag.chipLen` | 1.5 mm, 6 mm | the chips' depth and cell |
| `inside` | (0.1, 0.018, 0.015) | the inner wall; gloss `MESH_GLOSS_WET`, exposure 0, no fresnel |
| `rim.color`, `rim.width` | (0.72, 0.5, 0.4), 4 mm | the broken edge on the inner wall: full to 2 mm, gone at 4 |

Also in `HEAD_SPLIT.skull.jag` and the seam since the review: `wobble` 0.43 (noise cells per `zigLen`),
`wobbleAlong` 1.7 and `wobbleUp` 1.3 (how many periods it pushes each wave's phase), `upFreq` 0.73 (the second
wave's frequency against the first's). The seed's steps are `mesh-split.ts JAG_SEED` (0.618 / 0.414 / 0.31 / 7.31 /
3), ONE table the TypeScript twin reads and the WGSL is built from.

**`follow` is NOT the plan's first table** (0.25 / 0.5 / 0.85). Both were shot (`b7/stages-*.jpg`, third column).
With 0.25 the skull is already 3 cm apart at the crown on chop 1 and its face is gone from the gap; chop 1 and
chop 2 look alike. With 0.1 / 0.3 the stages are three different things: chop 1 a cracked skull that still shows
its sockets and teeth between the peeled flesh (1.7 degrees a half, about 1 cm at the crown), chop 2 a split one
(7.6 degrees), the kill thrown wide (26.8 degrees, just behind the flesh's 31.5). The bone angles for the other
presets at full: 43.8 degrees (middle, one side), 39 degrees (face).

### The check set

| Check | Result |
| --- | --- |
| `march-golden` | not run with `-u`: no march text changed |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 324498 B (83 fns), as B6 left it; `warmMs` 2618 (the march text is in the OS Metal cache from B6: a warm boot, as it should be with the text untouched) |
| `march-hash` | no pin moved: default `d7392d52…` / wounded `76bd51aa…`, crowd quad `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…` |
| cold boot pair | not run: the census boot did not move, and the split materials are not built at boot |
| the split pipelines | built when a split copy is first drawn. Every capture session below forced splits and read `__sdfGame.gpuDiagnostics()`: `uncapturedCount` 0, no device loss, no console error |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree | 509 files, 7392 tests passed, 1 skipped |

**The first split of a session** (the frame that builds the two pipelines): `forceSplit` 1.6 ms, the step 10 ms, the
draw 60-66 ms against 32-37 ms for the draws after. A SECOND head's first split frame costs the same (62-64 ms), so
that frame is the split's own re-pose and hull work (B3-B5), not a pipeline hitch that could be told apart from it.

### The numbers

Screenshots, 1280 x 800, the bare ring page, frozen zombies. `flail.toScreen` places world points (lens-mapped).

**(a) The skull's opening on screen is the rule's.** Each seated eye's pixels (eyes shown / hidden, the same
frame), their centroid against the eye seat's centre taken through `skullWarpPoint` and projected. The flesh is
thrown open to 1.8 x its full angle so no flesh half covers an eye (at real stages it does: a first attempt at the
full angle had the eye half covered and its centroid moving half as far as predicted), and `follow` is set by hand
to the three stages' own bone angles.

| Bone angle (stage) | 0.6 m: the eye moves | off the prediction | 2 m: moves | off the prediction |
| --- | --- | --- | --- | --- |
| 0 (closed) | - | 1.1 / 1.6 px (the centroid's own bias) | - | 0.2 / 0.1 px |
| 0.030 rad (chop 1) | 4.0 px (predicted 4.0) | 1.0 / 1.7 px | 1.4 px (1.2) | 0.1 / 0.4 px |
| 0.132 rad (chop 2) | 17.9 / 17.7 px (17.4) | 1.4 / 1.9 px | 5.5 / 5.7 px (5.2) | 0.3 / 0.5 px |
| 0.4675 rad (the kill) | 58.3 px (60.7) | 3.8 px | 16.9 px (18.3) | 1.8 / 1.7 px |

The eye is 44 px across at 0.6 m. At the kill angle a quarter of it is behind its own socket rim from the front
(1145 of 1540 px in view), which is the 3.8 px.

**(b) A closed head is unchanged.** A closed head with its skull laid bare by a pellet crater (12 952 skull pixels in
view, by the shown / hidden pair), the same zombie and camera, B6's tree (`2ad65481`) against B7's, and B7 against a
second B7 session:

| | Head disc (285 174 px): differ / by over 8 / max | The skull's own pixels: differ / max |
| --- | --- | --- |
| B7 against B6 | 2 / 0 / 1 | 2 / 1 |
| B7 against B7, another session | 2 / 0 / 1 | 2 / 1 |
| B7, the same session ten steps on | 81 185 / 2153 / 148 | 1018 / 40 |

B7 differs from B6 by exactly what two B7 sessions differ by. The census's module sizes agree too (the 123 kinds of
module outside the march are the same sizes in both).

**(c) Skull pixels the flesh does not hide** (bone and eyes shown / hidden, in the region's screen disc), sorted by
the march's hit mask under them (taken to the screen through the lens): over flesh, in the GAP (no flesh under
them, flesh to both sides on the row), or OUTSIDE the flesh's outline. `follow` 0 is the whole closed skull, B6's
draw, in the same session and frame. `b7/skull-pixels.png` paints them.

| Middle both, front 0.6 m | B6 (follow 0): gap / outside | B7 staged: gap / outside | follow 1: gap / outside |
| --- | --- | --- | --- |
| chop 1 | 17 874 / 0 | 17 387 / 4 | 1519 / 0 |
| chop 2 | 24 449 / 294 | 19 260 / 72 | 1693 / 0 |
| the kill | 27 715 / 1954 | 5968 / 0 | 1772 / 0 |

From above and behind: 4684 / 0, 6429 / 139, 7118 / 877 on B6 against 4603 / 0, 4796 / 26, 981 / 0. On B6 the skull's
dome stood above the tips of the opened halves from the second chop on (the red cap in the picture); staged, 72 px
of it still do on chop 2, none on the kill. Middle one side, front (the gap is open to the side, so both columns
together): 8941 on B6, 4055 staged, 596 riding the flesh. Face: nothing against the background in any of the three
(0 / 7, 0 / 22, 0 / 0).

### Cost

`__sdfGame.timeDraws(120)`, headless, one zombie's head centred, `middle` both, open and closed interleaved four
times a session; B6's tree and this one in alternate sessions. The machine was busy (load average 3-7, in bursts):
of thirteen sessions only these read cleanly (a closed spread under 1 ms).

| | Closed | Open | Open - closed |
| --- | --- | --- | --- |
| 0.6 m, B6 (2 sessions) | 19.2-19.4, 19.1-19.3 | 25.0-26.6, 25.0-25.3 | **+6.3 / +5.9** |
| 0.6 m, B7 (1 session, and half of another) | 19.1-19.8, 19.4-19.5 | 25.2-26.4, 25.5-25.6 | **+6.7 / +6.1** |
| 2 m, B6 (1 session) | 12.0-12.2 | 13.3-13.6 | +1.4 |
| 2 m, B7 (1 session, under rising load) | 12.2-13.5 | 13.8-14.9 | +1.6 |

- **A closed head: no cost that shows** (19.1-19.8 against 19.1-19.4), and none by construction: the closed batch
  and material are the ones it had.
- **The split skull itself, in ONE session** (the open head at 0.6 m, eight rounds of: the staged copies, the whole
  closed skull as B6 drew it, no bone meshes at all; median of 60 draws each): 25.7 against 25.3 against 24.8 ms.
  The staged copies cost **+0.5 ms over the whole skull** (per round -0.1 to +1.6), which itself costs +0.4. A
  noisier session read +1.8 (-2.9 to +3.8). At 2 m: +0.3 in the one clean round, medians +1.3 / +1.4 inside a
  spread of several ms.
- Where it goes, not chased (the owner: optimise the open head later): a clipped copy is shaded in full. The mask is
  a `discard`, so there is no early depth test; all three copies and both faces run the whole surface function
  (the back face's result is thrown away by a select) over every pixel the unclipped skull covers.

### Photos (`b7/`)

B6's cameras; the B6 column is B6's tree (`2ad65481`), the same zombies and cameras.

- `stages-front.jpg`, `stages-top.jpg`: the three chops of `middle` both, B6 | B7 | B7 with the plan's first, looser
  table. From the front at 0.6 m and from above and behind.
- `one-side-and-face.jpg`: `middle` one side and `face` at full angle, B6 | B7.
- `options-follow.jpg`: chop 2 with `follow` 0 (the whole skull, B6's) | the staged default | 1 (rides the flesh).
- `options-fracture.jpg`: chop 2 with the clean plane | the default | an 8 mm zig-zag | small zig-zag, 4 mm chips.
- `rim.jpg`: the broken edge with and without the rim, enlarged.
- `fracture-closeup.jpg`: the break from close above, the three chops.
- `front-2m.jpg`: the kill chop from 2 m.
- `skull-pixels.png`: (c)'s classes painted: over flesh yellow, in the gap green, outside red.

Still wrong in them, and whose:

- **The inner wall is hollow and empty**: no brain, and the bone is a shell with no thickness but for the rim band.
  From the front the gap shows the room behind the head (B8: something in the skull).
- **The break is a saw from close up**: the teeth are even enough to read as a pattern at chop 2. `zigLen`, the
  wobble and the chips are the dials (`options-fracture.jpg`).
- **The skull is see-through** where it stands in the gap (the field buffer's composite; so it was on B6).
- **On the `face` preset and the one-sided split the bone's ragged edge pokes through the STILL side's flesh cut
  face** (a tan band along the cut). It reads as the skull's section there, by luck: the flesh cut is a clean plane
  and the bone's edge is up to 5.5 mm off it. The same on the halves' cut faces with `follow` near 1.
- **A one-sided split 4 cm off centre cuts an eyeball in two** (it is drawn clipped, for both pieces).
- An eye shot out of a split head (`impact`) leaves from its closed seat, not the turned one.
- The cut faces of the FLESH have no bone ring (B8, the march's cut-face shading).

### For the tasks after

- **B8:** the look lives in `HEAD_SPLIT.skull` and the seam. The march knows nothing of the bone's angle: if the
  flesh's cut faces get a bone ring, the skull's edge and that ring are two different surfaces (the bone lags).
- **The split copies' fragment cost** (above) has two cheap cuts if it matters: branch instead of select on the back
  face, and draw the rest (piece 0) of a both-sided split front-faced when its top is hidden.
- **Still closed-head:** the shadow hull, `bodyInSight`, motion vectors; and now the bone's own motion while the
  spring moves.
- The bone's `follow` reads the instantaneous flesh angle, so while the spring overshoots a chop's target the bone
  swings wider and comes back with it (never past the flesh).

### Review fixes (2026-10-05)

- **The bone flapped on the spring's overshoot.** `follow` was read at the INSTANTANEOUS flesh angle, and the table
  is steep past chop 1, so the flesh's overshoot swung the bone by the table's slope on top of its own. The warp now
  carries the spring's target (`SplitWarp.target`; not in the GPU record) and the table is read at
  min(flesh, target) / full: on the way up the bone opens along the table with its flesh, past the target its share
  stays the target's. The real spring through the three chops (`head-split.test.ts`; degrees, rest -> peak):

  | | Flesh | Bone, before | Bone, after |
  | --- | --- | --- | --- |
  | chop 1 | 17.33 -> 22.56 (x1.30) | 1.73 -> 5.26 (x3.0) | 1.73 -> 2.26 (x1.30) |
  | chop 2 | 25.21 -> 27.59 (x1.09) | 7.56 -> 14.0 (x1.85) | 7.56 -> 8.28 (x1.09) |
  | the kill | 31.51 -> 33.42 (x1.06) | 26.79 -> 28.40 (x1.06) | the same |

  The bone's overshoot is now the flesh's, as a share of its rest angle, at every chop; it never passes the flesh.
  No jump at a chop: the target steps while the flesh is at the old rest, where min(flesh, target) is still the old
  stage. The fastest tick is on the kill, where the bone goes from 7.6 to 26.8 degrees while its flesh rises 6.3:
  9.4 degrees in a 1/60 s tick against the flesh's 8.3 (the test holds it under 1.2 x the flesh's fastest tick).
  **The rest angles did not move** (the test holds each stage's settled bone angle to 1e-12; chop 2 shot again with
  the clean plane, front / above / close: 18 / 250 / 13 px differ from the photographed run, none by more than
  1/255, the closed head's own floor between the two sessions being 0 / 264 / 8).
  **Two things it does not cure**, both smaller: (1) the swing BACK under the target reads the table below the
  stage, so the bone dips by the table's slope: 1.73 -> 1.59 (the flesh's own 8%), 7.56 -> 6.94 (8% against the
  flesh's 3%), 26.79 -> 24.88 (7% against 2%), for two or three ticks; (2) a chop that lands while the flesh is
  still ABOVE the old target steps the stage at once (from the overshoot's first peak of chop 1 that would be 2.3
  -> 5.3 degrees in a tick; a full cycle later, 0.15 s on, a quarter of a degree). Both go with a stage that only
  ever advances, carried in the spring's own state (a high-water mark from the kick); that is state in `SplitState`
  and was not asked for.
- **Split twin geometries were never disposed** (three keeps a rendered geometry until it is). A split batch's twin
  is now disposed with its batch, at the idle drop and in `clear()`. Disposing the twin also frees the GPU buffers of
  the vertex attributes it SHARES with the segment's own geometry; three makes them again at that geometry's next
  draw. Checked on the GPU in one session, skull pixels by the shown / hidden pair at each step: a closed head with a
  crater 12 581; split 21 574; closed again and 150 steps on, the split batch dropped (gone from the scene) 13 684
  (the split's face cuts lay more bone bare); split again 21 566; then a cast rebuild with the split open
  (`resetCast`: `clear()` and the cache's dispose), the new cast closed 1, a new head split 11 034.
  `gpuDiagnostics` clean at every step (`uncapturedCount` 0, no device loss), no console error. The twin shares the
  buffers still; it needed no copies of its own.
- **The fracture seed is the actor id** (it was a counter in first-split order, so a capture depended on what split
  before). The photos' break pattern is therefore not this build's to the tooth; the angles are.
- **The clipped fragments' colour is behind a real branch** on the clip's own test (a `discard` does not end the
  shader). The split skull's cost on the open head at 0.6 m, sessions alternated without / with the branch, eight
  interleaved rounds each (staged copies, median of 60 draws): 24.9 / 24.9 ms without, 24.8 / 24.8 with (rounds
  spread 23.7-25.5); the staged copies over the whole closed skull +0.1 / +0.3 ms without, +0.4 / +0.3 with (per
  round -1.0 to +1.6). No gain that shows, no cost: kept. On this quieter machine the split copies cost
  +0.1 to +0.4 ms over the whole skull (the +0.5 above).
- Also: the seams refuse non-finite input and the follow TABLE is settable (`skullSplit({ follow: [[0.55, 0.1], …] })`);
  `stats.verts` / `stats.tris` count every copy drawn; an eye's bound is scaled with its segment's matrix.
- Checks after the fixes: census ready, `uncapturedCount` 0, no device loss, march module 324498 B, `warmMs` 2570;
  the six `march-hash` pins unmoved.

## B8 part A: the capture gate, the cut-face look block, leftovers (2026-10-05)

Part A is the feature's own gate and the groundwork the look pass needs. No look constant was tuned.

### The gate: `scripts/head-split-gate.mjs`

**67 checks**, five boots (one side, later hits, face, skull, cost and the three chops; range, the body chop and head
damage; bounds on the shipped path; bounds with the field alone; the turned zombie), about 4 min 30 s. Three runs in
a row across fresh boots: **67 checks, 0 failed** each, every check line and every measured number the same to the
character (but the ungated draw times). As first built it had 57 checks; scenario A came with the chest-chop fix, and
the review round below reworked the measures. A scenario that throws is a failed check of its own and the run goes on
to its summary. A routine run writes its sheets to `.lab-tmp/head-split-gate`; `SHEETS=1` rewrites the tracked ones.

**What it measures on.** The float march target (`__sdfGameDebug.readMarchTarget`), not screenshots, but for the
skull's eyes (a mesh: a shown / hidden pair of one frame). What was measured about that target:

- **A capture is two reads** (`readF`): `readMarchTarget` draws a frame of its own, and back-to-back reads cycle with
  period 2 (`scripts/march-hash.mjs`). The two reads of one SETTLED frame differ by 0 in colour and in depth on all
  47 settled captures of a run (the gate checks every one: `FLOOR_COLOUR_MAX` 1e-4, `FLOOR_DEPTH_MAX` 1e-6). A frame is
  settled 24 frames after a camera move: at 10 frames 30 000 texels still differ by up to 0.014 (the shadow maps and
  temporal passes trail the move), and a frame read while the spring moves differs between its two reads by up to
  0.015 (those reads are not counted as floor). Part A's first notes said "read twice, equal to the bit" of a check
  that printed a colour step of 0.0048 every run: that was the unpinned boot, below.
- **Across boots the lit target was NOT the same**, and part A's first notes misnamed the cause. Measured then: one
  scene's target in a few discrete states from boot to boot, texels up to 0.027 apart. Part A had "pinned" the flicker
  with a phase argument on `setLightClockFrozen`; that clock is only the burning bodies' (`game-burning.ts`) and
  nothing here burns. The causes are the three `scripts/march-hash.mjs` documents: the dynamic-light clock (every sim
  step advances it, so it stood wherever boot and the wall-clock waits left it; the lamps, the room fill and the body
  key read it), the room probes' afterglow (a temporal filter whose state is the number of frames drawn) and the field
  interlace's parity. The boot now pins them as `march-hash` does, AFTER everything whose length the wall clock sets:
  `?frozen=1`, `setLightClockFrozen(true)`, `setLightTime(0)`, `setDemoHold(true)`, `setProbeBlend(1)`,
  `setProbeFall(1)`, `setFieldStyle("off")`; and the warm waits draw their frames as steps of no sim time
  (`step(1, 0)`). **After: the same scene (three presets, closed and open, 120 000 texels each) across 4 fresh boots:
  0 texels differ, largest difference 0.** The phase argument is gone from the seam.
- `scripts/axe-gate.mjs` boots with the same pins: still 25 of 25. Two of its printed luma measures moved by
  tenths (A's darkest interior 22 -> 22.2, shoulders 50.8 / 216.7 -> 51 / 217, the skin before 61.4 -> 61.8, the
  full mean 83 -> 83.1); the dip (28.8) and every other line are unchanged.

**The gap** (S, W, K, T). `gapRead` walks a line across the old plane at the head centre's height (below the face
cuts' slab, which reaches from the scalp to 1.7 cm above the centre) and counts the stretch the camera SEES: texel a
miss, or no surface more than 5 mm in front of the point. The eye stands in the wedge (`wedgeEye`: on the old plane,
0.6 m out to the face's side and up the plane), where every sight line stays between the cut faces, so the count is
the wedge's width: `lever x (tan thetaP + tan |thetaM|)`, lever 6 cm on the zombie. The line and the eye come from
the pose's split, so the measure holds on a flinching body and on the corpse. Two limits of the instrument: each face
is drawn fat by the march's accept footprint (3.3 mm at 0.6 m), and the run is whole texels (2.2 mm). At rest the
gap reads within -1.5 mm of the prediction; while the spring moves, up to 6.3 mm short. An eye straight above the head
or under standing height is not possible (the player is pushed out of the body and held on the floor).

**Derived, so the look pass can retune.** The gate reads `HEAD_SPLIT`, `AXE_HEAD` and the follow table live. S holds
the measured gap against the angles the CPU's spring took on the same frames: its peak frame, its overshoot ratio
and its settle frame move with a retuned spring (with `zeta` 1.2 the spring no longer overshoots and S still
passes: 13 of 13). The spring's own shape and the table's "a crack on chop 1, a split on the kill" are unit tests
now (`head-split.test.ts`: both fail under `zeta` 1.2 and under a 0.25 / 0.5 table).

| Check | Measured | Threshold (constant) | Fails under |
| --- | --- | --- | --- |
| S the instrument: the closed nose | a surface within 12 mm, none 50 mm in front | `DEPTH_TOL`, `NOSE_CLEAR` | positive control |
| S a closed head has no gap | 0.0 mm | = 0 | positive control |
| S chop 1 opens `middle`, both sides | target 0.3025 rad, offset 0 | exact, from `AXE_HEAD.openAngles` | - |
| S the split lies on the head's frame | 0 m apart | < 1e-9 | its twin on T: the plane not turned with the head |
| S the gap grows to its peak | 9.0 mm on frame 1, peak 45.0 mm on frame 4; the CPU's peak on frame 4 | `S_PEAK_FRAMES` +-1 (while the CPU overshoots by `S_OVERSHOOT_MIN`) | - |
| S it overshoots as the CPU's spring | 1.216 x rest against 1.331 x predicted | `S_OVERSHOOT_TOL` +-0.18 (the reviewer's 0.05 is under the measure's step: one texel a side is 0.12 of the 37 mm rest gap) | - |
| S it settles | within 6.5 mm from frame 6 (predicted 6); angle = target, rate 0 | `GAP_SETTLED`, `S_SETTLE_FRAMES` +3 | - |
| S the gap every frame of the spring | -6.3 to -0.4 mm off | `GAP_UNDER` 11, `GAP_OVER` 3 mm | GPU record's angle halved: -15.9 |
| S at rest | 37.0 against 37.4 mm (-0.4) | `GAP_REST_UNDER` 4, `GAP_REST_OVER` 2 mm | the same: 25.0 (-12.4) |
| S the zombie lives | standing after a 3-frame thaw | | (the kill is K's) |
| W chop 2 springs on | count 2, target 0.44 rad, settled | exact | `widenSplit` a no-op |
| W the gap is wider | +18.0 of +19.0 mm predicted | `W_WIDER_SHARE` 0.75 | the same: +0.0 |
| W at rest | 55.0 against 56.5 mm (-1.5) | `GAP_REST_*` | the same |
| W alive | standing | | |
| K chop 3 kills | count 3, falling | | `chopsToKill` 4 |
| K thrown to the full angle | target 0.55 rad | exact | the same |
| K still open 45 frames on (`K_LATER`) | state, the pose's split, drawn, record | all | the hook answering null for a dead actor |
| K the gap on the corpse | 73.0 against 73.6 mm (-0.6) | `GAP_REST_*` | the same: 0.0 mm |
| K the two cut faces kept | `split+`, `split-` | 2 | - |
| M closed head, closed skull | 3 bone draws, 0 copies | 0 | positive control |
| M the bone DRAWN at each chop | the copies' matrices: 1.73 / 7.56 / 26.79 degrees a half, 3.5e-15 rad off the table's | `M_ANGLE_TOL` 1e-6 | the mesh copy's angle halved: 0.87 / 3.78 / 13.39 |
| M three copies and an eye a half | 3 + 2 at each stage | exact | - |
| M the eyes on the REALLY chopped head (flesh out of the frame) | 0.15 px off at chop 1 (moves 4.1 px), 2.32 px at chop 2 (51.2 px) | `M_SHIFT_PX` 5 | the same: 10.35 px at chop 2 |
| M (forced) eyes found, whole skull at follow 0 | 0 copies, then 3, 3, 3 | | |
| M (forced) each eye against `skullWarpPoint` | worst 3.37 px; largest shift 58.2 px | `M_SHIFT_PX` 5, `M_FAR_PX` 40 | the same: 29.78 px |
| O one side, the struck one | hit 33.7 mm off centre; sides 1, offset 33.7 of 35.9 mm | exact | - |
| O the pose turns that half only | 0.495 / 0 | exact | both sides turned on the CPU |
| O the floor of its captures | 0 colour, 0 depth | `FLOOR_*` | positive control |
| O the other half does not move | 0 hit, 0 over 1 mm (`O_DEPTH`), of 4520 | `O_STILL_MOVED` 0 | the GPU record turning both: 2350 / 2695 |
| O its light | 188 of 4520 over 0.01 (0.042) | `O_COLOUR` 0.01 (1% of full scale; the floor is 0), `O_STILL_LIGHT` 0.1 | - |
| O the struck half did move | 0.98 | `O_MOVED_MIN` 0.5 | positive control |
| L each wound lands | split forced, a hit, a new wound | | positive control |
| L stamped at `unwarpPoint` | 0.000 / 0.000 mm | `L_POS_TOL` 1 mm | `unwarpHit` not un-warping: 65 mm |
| L mask on crater, rod cut | centroids 1.20 texels apart; 0.62 of the crater masked | `L_CENTROID_TX` 1.5, `L_CRATER_MASKED` 0.5 | masks read at the world point (WGSL): 3.08 |
| L the same, pellet | 0.51 texels; 0.96 | | the same: 9.70 |
| F `forceSplit(face)` holds | 0.8 rad | exact | - |
| F the CPU folds the face | the nose 110.6 mm | `F_MOVED_MIN` 50 mm | - |
| F the march draws it there | a surface at the cut face's point, none at the closed nose | `DEPTH_TOL` | GPU record's angle halved |
| R the draw distance | 12.67 m, reopening inside 11.40 m | finite | - |
| R inside (12.37 m) open | 18 of 109 region texels off the closed head (0.165) | `R_OPEN_SHARE` 0.1 | - |
| R beyond (12.97 m) closed | 0 of 94 (0) | `R_CLOSED_SHARE` 0.05 | never closing: 0.170 |
| R band (12.03 m) still closed | 3 of 113 (0.027) | | no hysteresis: 0.186 |
| R reopened (11.10 m) | 21 of 120 (0.175) | | - |
| R the pose keeps the split | 0.55 rad | | |
| A the torso chop lands in the flail's head region | 190.0 mm from the neck root, 376.2 mm from the skull centre | < `neckDist`; `A_OFF_HEAD` 300 | positive control |
| A a body chop: head closed, not counted | no split, 0 head chops | | the axe asking `isHeadRegion` |
| A its own cut where it landed | 1 torso cut, 0 mm from the hit, vertical | `A_LAND_MAX` 50 mm, `A_VERTICAL` 0.8 | the same: 2 face cuts 512 mm away |
| A the body's meter | +0.120 | exact | the same: 0 |
| H slug into a split head | 1 head wound, no head damage state | | `burst` not declining |
| H flail hit on a split head | one crater of radius 0.06, no state | | `hit` not declining |
| H the meter | +0.0195 | exact | full credit: 0.065 |
| H a held head refuses | null on all three chops | | `canSplit` ignoring head damage |
| H it still dies on chop 3 | standing, standing, falling | | - |
| B six views | clipped 0 / 1 / 13 / 2 / 18 / 19 against the closed head's 0 / 2 / 0 / 2 / 15 / 2; another depth 71 / 22 / 125 / 23 / 204 / 12 against 108 / 50 / 126 / 36 / 122 / 33 | `B_MARGIN` 30, `B_DEPTH` 0.2%, `B_DEPTH_MARGIN` 150 | no turned copies in the outer hull: 215 and 218 clipped, 5517 at another depth |
| T the body is turned | yaw -81.2 degrees | `T_SIN_MIN` 0.97 | positive control |
| T a centred split on its own plane | sides 0, normals 1 | exact | the plane not turned with the head |
| T the gap | 37.0 against 37.4 mm | `GAP_REST_*` | the same: 0.0 mm |
| C the floor over the run | 0 / 0 on 47 settled captures | `FLOOR_*` | positive control |
| C zero console errors | 0 | = 0 | a `console.error` in `open()` |
| C `gpuDiagnostics` clean, five boots | no device loss, `uncapturedCount` 0 | | - |

"Positive control" marks a check that shows the scenario or the instrument is what the next checks assume; "-" a
check no breaking change was run against. Every SCENARIO has at least one check shown to fail.

**L, as B6 measured it, with two differences.** Ported from B6's `wounds.py`: the rise in green share over 0.06, the
eye glow excluded, a window of 1.2 (cut) / 1.6 (crater) wound radii about the wound's place on the open head, the
crater where the surface went in by over 3 mm. (1) Each wound is read from an eye square on to it, 0.75 m out along
the skin's outward direction on the open head: from the front, a wound on a turned half is cut short by the half's
outline and its floor is in shadow (3.1 and 2.9 texels there). The pellet moved to the upper side of the - half: its
5.5 cm crater holds no eye seat and stays off the face cut's band along the plane, where the mask is already full and
cannot rise. (2) The check holds the mask's PLAIN centroid to the crater's, not B6's rise-weighted one: the weighted
one moves with the wet highlight on the crater, 0.27 texels on one zombie of the ring and 2.69 on its neighbour with
0.98 and 0.96 of the crater masked; the plain one reads 1.14 / 1.03 and 1.20 / 0.51 (rod cut / pellet) on the two.
The weighted value is printed. So `L_CENTROID_TX` is 1.5, and "masks read at the world point" reads 3.08 and 9.70.

**What it does not guard.** B fails when the outer hull loses its turned copies, which is B4's defect to the texel
(215 / 117 and 5517). It did NOT fail when the proxy box stopped growing to the hold ball (`fit`), nor when
`splitBound` stopped growing the cluster and tile spheres, nor with both: no texel changes from the front at 0.6 m,
from the front at 2 m or from above and behind. A fourth camera, from the side at 0.8 m, was tried for the review
round: its own floor is 127 to 289 clipped texels on the CLOSED head (shipped against the field alone), and the two
removals change nothing there either. So those two bounds are held by their unit tests only
(`head-split-bounds.test.ts`, `zombie-gpu.test.ts`); B is left with its two cameras. The cost (C) is reported, not
gated: open minus closed again +7.6 to +8.0 ms at 0.6 m (25.2 -> 33.2 ms), +0.6 to +0.7 ms at 2 m in the two quiet
runs of the first build; "closed again" is a head that still carries the split's cut faces (the seam re-stamps them),
and the gate now also times the untouched head first. The review round's runs were under load (5 to 7) and their
times are not quoted.

**Found by it.**

- **The face cut marks the whole crown, both sides of the plane.** The still half of a one-sided split differs from
  the untouched head in 775 of 4520 texels by up to 8.2 mm of depth, as far as 10 cm from the plane. None of it is
  the split: against the same head closed again with its cut face, 0 texels move. It is the face cut wound itself
  (half-length 0.151 m, kerf 12 mm, lip 1): its lips and ragged walls. O therefore compares the open head with the
  same head closed. For the look pass: `HEAD_SPLIT.faceCalibre.lip` and the cut's reach.
- **A chop on the upper chest opened the head.** See the axe gate below; fixed.

Photos (`gate/`, contact sheets, half size): `S-open.png` (closed, frames 4, 8, 30, 60 of chop 1), `WK-widen-kill.png`
(chop 2 from the wedge eye; the corpse 45 frames after the kill), `O-one-side.png`, `L-later-hits.png` (before and
after the rod cut and the pellet) and `L-mask-vs-crater.png` (the measure: green mask, red crater, yellow both; white
the wound's place on the open head, blue its closed one), `F-face.png` (closed, folded from the front, the folded cut
face from above), `M-skull.png` (the forced head: the bone at 0 and three angles), `M-skull-chopped.png` (the really
chopped head with its flesh out of the frame, chop 1 and chop 2), `R-range.png` (the four stances, enlarged; "beyond"
is past the torch and dark), `H-head-damage.png` (the slug's head, the flail's, the held head after its third chop),
`T-turned.png`, `B-bounds.png` and `B-bounds-masks.png` (shipped against the field alone: grey both, red clipped,
blue extra, yellow another depth).

### The axe gate's K, and the two older gates on this tree

K held "the corpse keeps at least 3 unique head-tagged cuts"; a centred three-chop kill through the gap leaves the
two faces. Restated to what part B guarantees: chops 1 and 2 are counted and the zombie stands; chop 3 kills; the
head is split open on the corpse at the kill's angle (`headSplit(id)`); its cut faces are in the ring, one per opened
half, head-kept (`actorWounds` now reports `headSlot`); and 45 frames on both still hold. The spring is left 40
frames between chops. K: 10 of 10.

- `scripts/cut-wound-gate.mjs`: **30 checks, 0 failed.**
- `scripts/axe-gate.mjs`: **25 checks, 7 failed** (A x 4, D x 1, T x 2) as part A left it, all one cause, and not
  this task's: the same failures on `2ad65481`. A, D and T chop the TORSO from 0.9 m at standing height; the chop
  lands on the upper chest at y 1.245, 0.190 m from the neck root, inside `FLAIL_HEAD.neckDist` (0.2), so the flail's
  `isHeadRegion` called it a head-region chop. In part A that stamped its own cut where it landed, and the checks
  passed. Since B3 (`game-axe.ts hitActor`) a head-region chop on a closed head opened the split and stamped the
  FACES instead: 2 cuts on the crown, none at the hit (T: 45 cm from it). **Fixed below: 25 of 25, the gate's chops
  unmoved.**

### Only a chop on the head is a head chop (the fix, 2026-10-05)

Decision (controller): a chest chop must not open the head. The axe no longer asks the flail's `isHeadRegion`
(the head limb, or within 0.25 m of the head cluster's centre, or within 0.2 m of the neck root: right for a blunt
weapon's head ladder). It asks `axe-head.ts chopOnHead`: **the prim nearest the un-warped hit is a head-limb prim.**
The strike's head magnet has no clause of its own: its point is on the head's own field and is tested like any
other.

Measured on the posed zombie (skull centre y 1.619, largest semi-axis 0.137; head cluster centre y 1.583; neck root
y 1.405):

| Chop | Lands | Before | After |
| --- | --- | --- | --- |
| The axe gate's A / D / T: torso from 0.7 m / 0.9 m | y 1.287 / 1.245, 0.159 / 0.190 m from the neck root, torso prim | HEAD | body |
| The same from 1.1 m / 1.3 m | y 1.224 / 1.213, 0.207 / 0.216 m from the neck root | body | body |
| Level from 0.9 m in front, at y 1.25 / 1.30 / 1.35 / 1.40 (chest, collar) | 0.186 / 0.150 / 0.119 / 0.094 m from the neck root, torso prim | HEAD | body |
| ... at y 1.44 (the neck's base) | y 1.439, 0.081 m from the root, 0.181 m from the skull centre, torso prim | HEAD | body |
| ... at y 1.50 / 1.55 (the jaw line) | 0.158 / 0.138 m from the skull centre, head prim | HEAD | HEAD |
| ... at y 1.60 / 1.65 / 1.70 (face, brow) | 0.124 / 0.111 / 0.116 m, head prim | HEAD | HEAD |
| From the side / behind at y 1.36 and 1.40 (shoulder top, nape's base) | torso prim, 0.230-0.274 m from the skull centre | HEAD | body |
| From behind at y 1.44 (magnet) | y 1.456, torso prim, 0.188 m | HEAD | body |
| From the side at y 1.44 (magnet), 1.48, 1.52; from behind at 1.48, 1.52 | head prim, 0.119-0.157 m | HEAD | HEAD |
| The head-split gate's S / K (front 0.6 m) and O (0.5 rad round) | head prim, 0.124 / 0.109 m | HEAD | HEAD |
| The 84 chops on OPEN heads (4 splits x 3 stages x 7 eyes; cut faces, the gap, outer skin) | all 84 un-warp onto a head prim, at most 0.132 m | HEAD | HEAD |

A dense sweep (twelve bearings, three eye heights, aims up the neck and head axis and 6 cm either side; about 2700
hits) puts the line where the flesh changes: all 1714 hits on a head prim lie 0.090-0.168 m from the skull centre,
the lowest at y 1.452 (4.7 cm above the neck root: the upper neck is head flesh); the 800 on a torso prim start at
0.156 m. Of the magnet's hits, 163 were on a torso prim (the neck's base in the shoulders, 0.163-0.251 m): body
chops now. The split's own hold radius (1.25 x 0.137 = 0.171 m) was the other candidate; it holds every head-prim hit
but also 48 torso-prim hits at the nape, so the prim decides.

**A chop the flail's test calls head-region and this does not is a body chop:** its own cut where it landed, the
body's collapse credit (`AXE_HIT`: 0.12 overhead, 0.09 diagonal), reaction `blast`, and no step of the head chop
counter.

**Behaviour change, for every character.** Since part A, three chops anywhere in the flail's head region killed:
that included the upper chest, the collar and the neck's base. Those are body chops now and kill through the
collapse meter like any other (about 7 overheads or 9 diagonals), on the zombie, on a head the head damage leaf holds
(it refuses the split and keeps part A for chops on its head flesh) and on characters with no split presets. Three
chops on head flesh still kill all of them.

Tests: `axe-head.test.ts` (the predicate), `game-head-split.test.ts` on the real zombie (the gate's chop: body, its
cut at the hit, 0.12 credit, no count, and three of them do not kill; the level chops up the front; the 84 open-head
chops still count). Gate scenario A (4 checks) fails 3 of them on the code before: split `middle`, 2 face cuts 51 cm
from the hit, meter 0.

All three gates at that commit: `head-split-gate` **61 checks, 0 failed**, twice, the check lines identical (and
identical to the runs before the fix but for the new scenario and one actor id); `axe-gate` **25 checks, 0 failed**;
`cut-wound-gate` **30 checks, 0 failed**. No WGSL changed.

### One cut-face look block

- `split-hit.wgsl.ts` exports `cutDepth = max(0, -hitSplitF)` beside `cutFace`. The tissue block reads it on a cut
  face (`select(max(0, -hitField.w), cutDepth, cutFace > 0)`: the same value as before, one definition).
- `blocks/post/cut-face.wgsl.ts` (`CUT_FACE_BLOCK`), spliced right after the tissue ramp: the drops of what the
  closed body throws through the solid (char, tear, wet-only, hole, cloth mark and stain; moved from the wound mask
  block, nothing between reads them) and the face's wetness `cutWet = cutFace x SPLIT_SHADE.wet`, which the wet block
  now reads in place of the gate.
- `SPLIT_SHADE` gained `shellLo` / `shellHi` (the walk's shell fade), `poreCut` and `wet`, each today's value, so the
  gate's range can move without moving a surface or the pores.
- Stays, with a pointer comment: the `wmBoth` edit (single-assignment masks, the entrails gate's one `wmCav` sink),
  the tissue block, the face layer's kill (also the mesh head's by renames).

**Proof it is a pure move.**

- Closed bodies: the six `march-hash` pins did not move (default `d7392d52…` / `76bd51aa…`, crowd quad
  `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…`).
- Open heads: `middle` both, `middle` one side and `face` at full angle from the front at 0.6 m, closed and open, the
  whole 400 x 300 target, the tree before (`dd6af4e2`) against the tree after. In every pair of sessions that landed
  in the same lighting state: **0 of 120 000 texels differ, in all six captures** (before / after; before / before /
  after in the other state; and three earlier sessions before the phase was pinned). The same-frame floor: 0.
- That measure can fail: `cutDepth x 0.5` in the tissue block moves the open `middle` head by up to 0.38. It does
  NOT see the wetness: `SPLIT_SHADE.wet` 0.5 left all six captures equal to the bit (no specular on the cut faces at
  this camera and light), so `cutWet` rests on its text pin and on `x * 1.0` being `x`.

| Check | Result |
| --- | --- |
| `march-golden -u` | `MARCH_TRACE_POST`, `MARCH_TRACE_LOOP` (a comment), `MARCH_BODY_SURFACE_PREP`, `FACE_LAYER_WGSL` (a comment) and what embeds them |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 324498 B -> 325561 B (83 fns); cold `warmMs` 45814 at load 9.7 |
| `march-hash` | no pin moved |
| cold boot pair (base `dd6af4e2`) | new 45464 / 45452 ms, base 45465 / 45868 ms warm-up (`drawOnce` 1679 / 1688 against 1671 / 1685); load 3.2-3.8 |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree | 510 files, 7406 tests passed, 1 skipped |

**`cutKeep` (review round).** What runs after the block on the albedo it leaves: the organ block, the mottle
(ungated), the face layer (off a cut face), the body grain, the gore, the soldier's meat, the paint and char mix, the
burn's soot, the melt, then the wetness. A bone ring written to `albedo` there would be mottled, gored and wet as
flesh. The block now also declares `cutKeep` (0: nothing writes it yet), and the mottle, the gore strength and the
wound wetness multiply by `(1 - cutKeep)`. Proof it changes nothing: `march-golden -u` (`MARCH_TRACE_POST`,
`MARCH_BODY_SURFACE_PREP`); census ready, `uncapturedCount` 0, no device loss, march module 326068 B (83 fns), cold
`warmMs` 51097 at load 10.3; the six `march-hash` pins unmoved; the open heads of three presets against the tree
before, with the boot pinned: 0 of 120 000 texels differ in all six captures; cold boot pair (base `d55dd8c9`) new
45479 / 45232 ms, base 45310 / 45096 ms.

### Leftovers

- **A flail hit on a split head is a head hit.** The head damage leaf declines a split head and the flail stamps its
  plain face crater itself; it did so with the swing's full collapse credit and body flesh. `flailWound` now carries
  the hit's meter share and flesh kind (`FLAIL_HEAD.meterScale` 0.3, which `HEAD_LEAF.meterScale` reads), so that
  crater credits 0.0195, not 0.065, and throws head flesh. The gate's H holds it.
- **The bone's per-tick bound** (`head-split.test.ts`): for chops that land settled, every tick holds
  `|d bone| <= L |d flesh|`, `L` = 3.6 from the follow table's steepest slope (measured 3.5975). Chops four ticks
  apart through the seam break it by 0.69 degrees in one tick; that case is pinned as known.
- **New seams:** `__sdfGame.skullDrawn(id)` (an actor's split skull copies among the bone draws, each with the
  matrix it is drawn with), `actorWounds(...).headSlot`.
- A flail crater's flesh is `flesh-bits.ts craterFleshBits(kind, ...)`, tested by what it throws.

### Known and accepted for now

- The bone's two spring residuals: a 7-8% dip under its rest angle on the swing back, and a chop that lands above
  the old target steps the stage at once (seam only). A stage that only advances, in `SplitState`, removes both.
- The top vertebra is not split. The shadow hull, `bodyInSight` and the motion vectors use the closed head.
- A pellet or slug crater on a cut face sits on the old plane and shows on both faces.

### For part B (the look pass)

| What | Tuned through |
| --- | --- |
| Bone ring and meat on the flesh's cut faces | `CUT_FACE_BLOCK`: `albedo` is in scope there with `cutFace`, `cutDepth` and `pS` (`applyBones` at `pS` for the ring); numbers into `SPLIT_SHADE`; the ramp's own stops are the material's (`surfCfg3`, `fatColor`, `deepColor`) |
| Wetness of the faces | `SPLIT_SHADE.wet` (check it under the flashlight: this gate's cameras do not show it) |
| A term on the cut face that is not flesh | set `cutKeep` in `CUT_FACE_BLOCK` to its share: the mottle, the gore and the wound wetness then leave it alone (the soot, the char and the melt still take it) |
| The gate between skin and cut face | `SPLIT_SHADE.cutLo` / `cutHi`; the shell fade and the pores no longer follow it |
| Something in the gap (a brain) | a mesh riding piece 0, drawn from `view.splitDrawn` like the skull (`mesh-renderer.ts`) |
| More violent angles and spring | `HEAD_SPLIT.presets.*.maxBoth` / `maxOne`, `axe-head.ts AXE_HEAD.openAngles`, `HEAD_SPLIT.hz` / `zeta` / `kick`. The gate reads all of them live and derives S, W, K, T and M from them. What a retune can still trip: the gap line needs the cut faces to reach the head centre's height; `F_MOVED_MIN`; `O_BEARING` must still land a one-sided hit; and the two unit tests that hold the spring's overshoot and the table's crack / split |
| Blood on open | `game-axe.ts` (`deps.bleed` per face) and the split leaf's `open()` |
| Fracture teeth | `__sdfGame.skullSplit({ zigAmp, zigLen, chipAmp, chipLen, wobble… })`, `HEAD_SPLIT.skull.jag` |
| The face cuts | `HEAD_SPLIT.faceCut` / `faceCalibre` (the lip marks the whole crown: above) |
