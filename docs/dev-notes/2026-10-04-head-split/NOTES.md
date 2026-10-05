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

- **The mesh face layer** (`baked-chunks.ts`) is the march's by regex renames. Its contract now maps `faceCentre` /
  `faceQuat` to the mesh's `headCentre` / `headQuat` and `cutFace` to `0.0` (a settled head mesh is one rigid piece).
- **The re-fold report.** `gRefoldWin` (the normal hint) was whatever piece won a limb re-fold last. A win is now
  also filed under its piece (`gRefoldBy.x / .y / .z`), and the walk takes the HIT piece's entry for an open slot.
  Both writes sit in the win's own branch; `mapBody`'s per-sample path is untouched (see Cost). A closed slot reads
  `gRefoldWin` as before. `gWoundOwners` needed nothing: it is reset per piece and read only by that piece's own
  re-fold, nothing outside `mapBody` reads it. The hand twin (`map-body-split-twin.test.ts`) is unchanged: the
  pieces compute what they did.
- **Normals.** Inside an open head's region sphere (`splitIn`: the slot is open and `|p - h| <= r`) the analytic
  gradient is skipped and the existing finite-difference fallback runs (`ngReason` 8). Not only on turned halves:
  the unmoved piece's hinge-plane and ball caps are not in the analytic gradient either.
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
- **A closed body costs about 0.3 ms more at 0.6 m** (18.1 against 17.85; a second measure on another closed head,
  three sessions each: 19.8 / 19.8 / 19.8 against 19.3 / 19.6 / 19.5). It computes the same values; what it pays is
  the split's extra locals and branches in the post. Not chased further.
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
- **A cross-slot leak of the normal hint is as it was:** in a crowd pixel `gRefoldWin` is the last slot's that won
  a re-fold, not the union winner's, for closed bodies too. Left alone: fixing it moves what closed crowd pixels
  compute.
