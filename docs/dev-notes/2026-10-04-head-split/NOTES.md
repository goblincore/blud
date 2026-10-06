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

## Look pass, group 1 (the flesh cut faces): tried, not kept (2026-10-05)

Three look steps for the cut faces were built and then reverted in one commit, at the owner's call. He had played
the build at `d5b6f9f3` and, shown the before/after sheets, said the change was "pretty subtle" and "I'm happy with
the before". The cut faces therefore stay as B6 built them (the wound-interior ramp by depth, wet all over), and
the face cuts keep their B3 values (`HEAD_SPLIT.faceCut` / `faceCalibre`: kerf 0.012, depth 0.12, inset 0.006).

| Step | Commit (reverted) | What it did |
| --- | --- | --- |
| The face cuts' reach | `f2a1c7f8` | Shrank the face cuts to a notch at the crown (inset 1 mm, depth 1.5 cm, kerf 5 mm, lip 0.3) so a one-sided split stops carving the half that did not move. It also removed the ragged, carved texture the wide wedge leaves on the cut faces, which is part of the look the owner liked. |
| A bone ring | `eb2f131b` | A pale bone band on the cut face by depth into the closed head (`SPLIT_SHADE.bone`), kept clear of mottle and gore through `cutKeep`. |
| Layers and a cavity | `e1e4acf2` | Readable skin / fat / muscle bands outside the ring and a dark wet cavity inside it (`SPLIT_SHADE.layers`, `.cavity`). |

A fourth step (wetness under the flashlight) was in progress and was dropped uncommitted. The sheets
(`look/01-face-cut-reach.jpg`, `02-bone-ring.jpg`, `03-layers-cavity.jpg`) are in those commits' trees. To bring a
step back, `git revert` the revert, or cherry-pick the step's commit.

**Still true, and accepted:** in a one-sided split the face cut marks the crown on both sides of the plane (775 of
4520 still-half texels, up to 8.2 mm; B8 part A's finding). The owner saw this build and is happy with it.

## Look pass, group 2: the owner's two playtest requests (2026-10-05)

The owner played `d5b6f9f3` with real clicks: happy with it for the most part. Two requests, and nothing else was
touched (the cut faces, the skull's look and the blood are as he played them).

### Step 1: the axe skips the thin crack (`69124ac5`)

"The skull stages are fine, though I think we can skip to stage 2 or 3 with the axe."

| Chop | Before | After |
| --- | --- | --- |
| 1 | flesh 0.55 of the full angle (17.3 degrees a half), bone 1.7: a thin crack | flesh 0.8 (25.2), bone 7.6: the wide crack. Alive |
| 2 | flesh 0.8 (25.2), bone 7.6 | flesh 1.0 (31.5), bone 26.8: split wide. Alive |
| 3 | kills; flesh to 1.0, bone 26.8 | kills; the split is already full, so the chop KICKS it |

- `AXE_HEAD.openAngles` `[0.55, 0.8]` -> `[0.8, 1]`. `chopsToKill` stays 3. The follow table and the presets did not
  change: the thin crack is still the table's first stage (a lighter weapon's; `forceSplit(..., 0.55)`).
- **The kill's kick** (`AXE_HEAD.killKick` 0.3, `axe-head.ts chopKick`, `head-split.ts punchSplit`): a rate toward
  open that alone carries the halves 0.3 of the preset's full angle past where they stand. It is sized by the
  spring's own reach (how far 1 rad/s carries it before it turns back, by its own sub-steps), so it means the same
  under a retuned spring. Middle, both: 31.51 -> 39.50, 40.74, 37.55, 33.15, 29.92, 28.73 ... degrees a half on
  frames 1 to 6; within half a degree of rest from frame 12, exactly at rest on frame 27. One side: 51.6 -> 66.7.
  A chop on the corpse's open head kicks it again.
- **The skull's stage only advances** (`SplitState.stage`; `SplitWarp.stage` replaces `.target`). B7's rule read the
  table at min(flesh, target): on the swing back under the target the bone followed the table DOWN, 7% on the old
  kill against its flesh's 2%. Under the kick that was a flap: the flesh swings back to 28.7 degrees, which read the
  table at 0.91 and took the bone from 26.8 toward 17. The stage is now the high-water mark of min(angle, target),
  kept in the state, and the bone is the stage's share of each half's own flesh angle, whatever that angle does:
  through the kick 26.79 -> 34.63 -> 24.42, the flesh's own 31.51 -> 40.74 -> 28.73 times 0.85 on every tick (unit
  test; the gate's K reads the drawn copies' matrices 3 frames into the kick). Rest angles are the same to the bit.
  B7's first residual (the dip) is gone. The second stays: a chop that lands while the flesh is past the old target
  steps the share at the next tick (seam only: play's strikes are 0.6 s apart).
- **To turn this off:** `openAngles: [0.55, 0.8]` and `killKick: 0`.
- Sheets: `look/04-axe-table.jpg` (the three chops, front 0.6 m, above-behind and front 2 m, before | after, a boot
  each so the zombie, cameras and light are the same) and `look/05-kill-kick.jpg` (frames 1 to 8 after the kill
  chop). Read: chop 1 now shows the skull's face between two clearly parted halves where it was a slit; chop 2 is the
  full V. The kick shows on frames 1 and 2 as the halves thrown to the edge of the crop and back by frame 4. At 2 m
  chop 1 reads as an opened head at a glance, which the thin crack did not.
- **Gate expectations.** Followed the table by themselves: S (target, the spring's frames), W, O, T, K's count and
  target. Restated, with why:
  - K gained two checks: the kick (rate 12.77 rad/s at the chop; 6.03 degrees past the full angle 3 frames on, 0.64
    of `killKick` x the full angle) and the bone drawn at the stage's share during it.
  - M's forced landmark takes the follow table's three stages, not the axe's angles (which are now two of them).
  - M's landmark on the really chopped head is chop 1's only (0.48 px off, the eye moves 17.8 px). Chop 2 now splits
    the bone wide on a head the first flinch has bowed, and each half's shell hides its own seated eye: 40.0 px off
    from the wedge eye, 32.9 px from the front. That stage keeps its matrices check, and the forced, upright head
    reads the same bone angle to 3.4 px.
  - L and H's flail head pin their own openings (0.8 and 0.55) instead of borrowing the axe's.
  - **`GAP_REST_OVER` 2 -> 3 mm** (it is now `GAP_OVER`). Chop 2 rests at the full angle, where the gap measure can
    read long: a sample inside a half counts as seen until its surface is 5 mm in front along a sight line that
    grazes the cut face, 1.0 mm a side at the full angle (0.5 mm at 0.3 rad). Measured at the full angle on two
    zombies of the ring: -0.6 and +2.4 mm (W), -0.6 and +1.4 mm (K). The full gate passed inside the old 2 mm; the
    +2.4 came up in an `ONLY=` subset, which chops a different zombie. A halved GPU angle still reads -12 mm.

### Step 2: the opened halves wobble with the body

"Maybe it could be a little less stiff after the split? Like it kind of wobbles or shakes with the movement of the
body."

**The model** (`head-split.ts`, pure; `HEAD_SPLIT.wobble`). Each turning half carries an offset on top of the
spring's angle, `SplitState.wobP` / `wobM` (rad, positive = further open) with rates `wobVP` / `wobVM`: a damped
spring about zero, stepped with the angle spring in `stepSplit(st, dt, drive)` on the same 1/240 s sub-steps. The
warp's two angles are `thetaP = angle + wobP` and `thetaM = -(angle + wobM)`. Nothing else carries it: the CPU field,
the GPU record, the bounds, the hulls and the skull already read those two angles from the pose.

- **The drive** is the acceleration of the split's MASS POINT, `arm` (10 cm) up from the hinge into the head
  (`splitMassPoint`), in two components (`wobbleDrive`): ACROSS the split, along n (the halves lag the head, so one
  closes and the other opens: +half gets `-gainSide x a.n`, -half `+gainSide x a.n`), and UP out of the hinge, along
  u (both open, or both close: `+gainBob x a.u`). Along the hinge axis: none. A half less far open than its preset's
  full angle is driven in proportion. No gravity term: at rest the offset is exactly 0 whichever way up the head
  lies.
- **Why the mass point and not the bare hinge** (the brief said the hinge): the hinge is low at the back of the
  skull, and a head that rolls or shakes about it moves its crown, not its hinge. The point 10 cm up carries the
  hinge's translation plus the head's own turning about the hinge axis.
- **Where the acceleration comes from** (`game-head-split.ts`, `pointAccel`): finite differences of the point on the
  actor's POSE. The leaf ticks before the actors step, so the pose it reads is the last step's: tick N differences
  the point at steps N-1, N-2 and N-3 (each over its own step's dt), an acceleration centred on step N-2, two frames
  (33 ms) behind the pose that draws this tick's angles. The first two samples give no acceleration (a position,
  then one velocity), so a head that splits on a walking body is not kicked by the walk's speed. A pose with no
  split (the head gone, the body tearing) forgets the motion. A tick of no time (a gate's camera sync) takes no
  sample and loses none.
- **The limits** (`wobbleLimits`, held on every sub-step; at a limit the offset stops and keeps no rate into it):
  within `max` x the half's own spring angle either way; never nearer shut than `minOpen` once the spring is past it;
  never further open than the full angle x (1 + `over`), but for where the spring alone takes it (the kick). Each
  drive component is clamped to `accelClamp`; a value that is not finite is no drive.

| Constant | Value | |
| --- | --- | --- |
| `hz`, `zeta` | 3, 0.3 | the offset's spring (the chop's is 7, 0.35): a flop, one swing back, rest |
| `gainSide` | 6 rad/s^2 per m/s^2 | across the split |
| `gainBob` | 8 | up out of the hinge |
| `arm` | 0.10 m | the mass point above the hinge |
| `accelClamp` | 40 m/s^2 | each component |
| `max` | 0.45 | of the half's spring angle: +-14.2 degrees at the full 31.5 |
| `minOpen` | 0.03 rad | 1.7 degrees |
| `over` | 0.45 | 45.7 degrees at most for `middle` both |

**To turn this off:** `gainSide: 0` and `gainBob: 0`. Then no offset is ever stepped and the angles are the spring's
to the bit: `stepSplit` equal to the undriven one field for field over a driven run with a kick (unit test); a
stepping actor's pose carrying `angle` exactly for 200 frames (leaf test); the 840-frame live run below with the
gains at 0: no offset on any frame, `thetaP === angle` and `thetaM === -angle` on every frame, the spring's angle
equal to the gains-on run's on every frame; and the gate's S / W / K / M with the gains at 0 against step 1's run on
the same zombies (below).

**Frozen actors rest at exactly zero offset.** A frozen actor's point does not move, so the drive is exactly 0 and
the wobble is not stepped at all. After a thaw the cast stops dead and the offsets settle; the gate then steps until
they are exactly 0 (`restWobble`: 72 to 74 frozen frames after a 3-frame thaw, bound 104 from the constants) before
it measures a rest angle.

**The traces** (`look/06-wobble-traces.png`; a split forced to the full angle, the cast thawed, the player parked at
the spawn; degrees a half off the spring's 31.5):

| | + half, peak | - half, peak | apart, peak | Settle |
| --- | --- | --- | --- | --- |
| A walk, 420 frames (it lurches three times) | 14.2 (the limit) | 14.2 | 28.4 | - |
| ... its steady stretch (140 frames) | -3.4 to +5.7 | -6.7 to +2.6 | | |
| The cast frozen mid-walk (the body stops dead) | 5.9 | 8.0 | 4.0 | under 1 degree after 27 frames (0.45 s), exactly 0 after 72 |
| A chop on the walking zombie, the 40 frames after | 10.8 | 7.4 | 7.8 | it keeps walking |
| A second chop | 14.1 | 9.2 | 19.1 | |
| The kill and the fall, 300 frames | 14.9 (0.45 of the kicked 33.2) | 14.1 | 19.9 | the hinge is still from frame 109; under 1 degree 9 frames on, exactly 0 after 53 |

The openings over the fall run from 16.8 to 45.7 degrees. Of 3120 half-frames in these runs 13 sit at a limit and
none is outside. What the walking zombie's mass point does, measured: it bobs +-2 m/s^2 at 2.1 Hz, is thrown 1.9
m/s^2 across the split while the body turns, and lurches at 20 to 39 m/s^2 for about ten frames every hundred or two.
The fall's landing reads 200 to 470 m/s^2 for single frames (the pose snaps): that is what `accelClamp` is for.

**Unequal angles, verified where they are read.**
- The field on the GPU: the hand twin (`map-body-split-twin.test.ts`) gained two two-sided cases, 0.74 / -0.31 rad
  and 0.03 / -0.62 (one half at `minOpen`): max |twin - splitField| 3.2e-16 and 3.1e-16 over 11 600 points each.
- The bounds and the hulls (`head-split-bounds.test.ts`): three unequal warps (1.45 / 0.55 of the full angle, the
  other way round, and 0.06 / 1.1) run through every soundness test: the sphere images, the grown cluster and group
  spheres, the outer hull holding the open body's solid, the inner hull's spheres staying solid.
- The skull: each half's bone is the stage's share of that half's own angle and the stage does not move (unit test
  over a driven run). In the game: the gate's K reads the drawn copies 3 frames into the kill, 26.11 / 31.09 degrees
  against 26.11 / 31.09, and J on a swing, 24.65 / 33.82 against 24.65 / 33.82 (3.9e-16 rad off).
- The GPU record: J reads its two angle lanes on a swing, equal to the pose's as floats.

**The strips** (a walking split zombie, the camera riding the head; wobble off | on are two boots of the same
script, and the body is the same on every frame up to the first chop, within 0.22 mm after it: a chop lands on a
half that stands elsewhere). The photos do not touch the sim: the run with photos equals the run without on every
frame and field.
- `look/07-wobble-walk.jpg`: 8 consecutive frames of a lurch (frames 44 to 51), front and above-behind.
- `look/08-wobble-fall.jpg`: the 8 frames after the kill chop.
- `look/09-wobble-more.jpg`: the steady walk (every 4th frame), a flinch, the corpse landing.

**Read.** Off, the eight frames of a strip are one picture: the head carries two fixed plates. On, the halves lag the
head: in the lurch one half comes up over the skull while the other swings out, over five or six frames, and they
come back together. It is a slow swing (3 Hz), not a shake from frame to frame, and it reads as soft tissue hanging
off a hinge. In the steady walk it is small (3 to 6 degrees): visible in motion, hard to see in stills. What is
still wrong, or not shown by stills: (1) the lurches take a half to its stop and it stands there for one to three
frames, which may read as a hard end; `max` and `gainSide` are the dials. (2) A half that swings shut to 17 degrees
covers the skull's face in the gap for a moment. (3) The halves do not meet the floor or the shoulders: on the
landing the corpse's halves flap through where the floor is, as the rigid ones already lay in it. (4) Each half is
still a rigid plate about one hinge; there is no bend in it. No clip was recorded: `scripts/` has no gif or webm
capture.

**Gate scenario J** (8 checks, in T's boot after it; the player at the spawn, since in the ring's sight the soldiers'
fire takes the zombie apart inside 300 thawed frames).

| Check | Measured | Fails under |
| --- | --- | --- |
| frozen: the halves stand at the spring's angle | 0.55 / -0.55 rad, offsets 0, 20 frames | - |
| thawed, wandering, one chop: each half swings | 9.5 and 13.4 degrees, 22.6 apart (>= 2, 2, 1) | the gains at 0: 0.00 |
| inside the shipped limits every frame | openings 19.7 to 45.0 degrees, 0 outside | - |
| the stop holds: `max` cut live to 0.03 for the first 90 frames | no half past 0.95 degrees, at the stop on 74 frames | the clamp removed: 88 frames past it, to 30.05 degrees; the gains at 0: never reaches it |
| the pose's split is the state's two angles | 0 of 90 frames differ | - |
| frozen on a swing, the GPU record carries them | 29.0 / 39.8 degrees, equal as floats | the gains at 0: no swing |
| the skull's copies at the stage's share of each | 24.65 / 33.82 against 24.65 / 33.82 | the gains at 0: equal halves |
| at rest again, exactly, within the settle bound | 74 frames (bound 104), then 20 more | the gains at 0: 0 frames |

With the gains at 0 five of the eight fail; with the clamp line removed, one. K waits for the fall's wobble to rest
before it reads the corpse (73 frozen frames).

### The check set (both steps, 2026-10-05)

No WGSL changed, so there is no golden update, census or boot pair.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree (`--exclude '**/cut-wound.test.ts'`) | 510 files, 7444 tests passed, 1 skipped |
| `scripts/head-split-gate.mjs`, twice | **77 checks, 0 failed** each; every check line and every measure line but the draw times the same in both |
| `scripts/axe-gate.mjs` | **25 checks, 0 failed** (with the new table: K's three chops, the kill, the split on the corpse) |
| `scripts/cut-wound-gate.mjs` | **30 checks, 0 failed** |
| `scripts/march-hash.mjs` | unmoved: `d7392d52…` (and its repeat) / wounded `76bd51aa…` |

- **Baseline, before either step** (`d0d407d2`): the gate at 67 checks, 0 failed.
- **Frozen actors rest at exactly zero, by the gate's numbers.** The final run, wobble on, against step 1's run (the
  same zombies): every check line is the same to the character but the four whose wording changed (S's and W's thaw
  lines and K's corpse line now say how long the wobble took to rest: 62, 74 and 74 frozen frames; K's kick line
  reads the bone per half, 28.89 / 28.31 degrees, the wobble of its three thawed frames).
- **Off is step 1, by the gate's numbers.** `ONLY=S,W,K,M` with both gains at 0 against step 1's run of the same
  subset: 30 checks, the numbers on every line the same (the 60 per-frame gaps of chop 1, the gaps at rest 55.0 /
  76.0 / 75.0 mm, the kick 6.03 degrees with the bone at 31.92 / 31.92, the landmarks 0.41 and 0.52 px), and every
  wait for rest 0 frames.
- **Cost.** At the start, on a quiet machine: `timeDraws` at 0.6 m closed 26.2 ms, open 33.6 (+7.4); at 2 m +0.6.
  At the end the machine was loaded on every attempt (load average 9 to 104 through the two gate runs, 24.6 on a
  third try): open minus closed read +5.4 to +14 ms with spreads of 6 to 11 ms. Not quotable. Neither step adds
  draw work: a head at rest hands the renderers the same two angles as before, and the wobble is a few dozen
  floating-point operations a tick for each split head.

## Look: wet under the flashlight (2026-10-05)

The owner's one request from the cut-face comparison: "the wetness under flashlight is probably more visually
striking". One step, one commit. The ragged look is untouched: no albedo, no geometry, no face cut number moved.

### What was built

A wet film over the RAW SURFACES of an OPEN split: the pit the face cuts carve and the flat caps around it. It adds
highlights and nothing else. One block, `webgpu/march/body/blocks/light/split-glisten.wgsl.ts`, spliced into the light
tail's compose right after the light list's add and before the highlight shoulder; its numbers are
`head-split.ts SPLIT_SHADE.glisten`.

- **The gate** (`glisRaw`): `splitIn` (the hit is inside an open head's region sphere: false on every closed body)
  x the one wound mask past its faint reach (`smoothstep(rawLo, rawHi, wm)`; the mask is already raised on a cut face,
  so the pit and the cap are one surface to it) x not under the face sheet x not `cutKeep`, not char, bone at a
  quarter x the film's distance fade x a fade over the last 3 cm of the region sphere (no seam at its boundary; the
  turned halves lie 6 cm inside it and carry the whole film).
- **The film's normal**: the shading normal tilted by two octaves of noise cut in the REST anchor (which is taken at
  the hit piece's un-warped point `pS`, B6), turned out to the world with a turned half. It rides its half; nothing
  swims. The coarse octave is pushed off zero (`v / (|v| + lumpFlat)`): plain value noise sits near zero, which made
  the film a mirror with a little noise on it (nothing until it faces the light, then all of it).
  The diffuse light, the AO probe and the surface's own highlight keep the surface's normal.
- **The torch** glints from its own place (the analytic flashlight's uniforms), with its switch, range and level
  shadow, and a cone wider than the beam's by `spill`.
- **The lamp** glints only with the torch off: the light list then hands the key to its dominant pick, and the key's
  highlight off the film's normal is that lamp's.
- Added before the shoulder, so it is compressed with everything else.

### Three things found on the way

- **At arm's length the torch's beam misses a head in the middle of the screen.** The torch rides 0.25 m right and
  0.15 m under the eye, its axis parallel to the view (`dungeon-lighting.ts FLASHLIGHT_OFFSET`), and its cone is
  21.6 degrees. At 0.6 m the head's centre stands 26 degrees off the beam's axis: on the raw surfaces the march's
  per-pixel beam is 0 (measured: `keyI` 0 over the whole top of the head, front and three-quarter; 1 at 2 m). A glint
  tied to the beam showed nothing at 0.6 m at any strength. Hence `spill`: the film mirrors the lamp itself, which it
  sees from outside the cone. The body's own torch light at arm's length is as it was.
- **With the torch lit the lamps are not the key** (`game-light-list-leaves.ts torchLane`: lit, the torch keeps the
  key by its per-pixel beam and the lamps are only in the list's sums; off, the list's dominant pick is the key). So a
  lamp can glint off the film only with the torch off. Lit, the lamps add nothing to the film.
- **A depth fault** (unexplained when this was written; bisected since: ["The depth fault, bisected"](#the-depth-fault-bisected-2026-10-05), at the end of this file. It is not a rule about how often `bodyLights` is called). The first build of
  the block walked the light list again off the film's normal (`bodyLights(p, glisN, V, gInstLights, lightList,
  false, true)` behind the raw gate). On the float march target, 72 to 197 texels of each 0.6 m capture then kept
  their lit colour to the bit but took ONE exact clip depth per camera: the projection of the world origin (view
  distance -9.74 m from the front, 13.15 m from three-quarter). In the composite they are rectangular notches in the
  head's silhouette. With only that call removed: 0 such texels. With the call in the text but unreachable
  (`if (false)`): 0. Closed bodies never showed it.
  - **The cells.** The bad texels are whole 4 x 4 texel cells of the 400 x 300 march target (in three saved captures
    14 of 16, 11 of 11 and 10 of 10 touched cells have every body texel bad; on a 16-texel grid none has). I first
    wrote "16 px tiles", from `tile-cull.ts TILE_SIZE_PX`: the data does not support that. A 4-texel cell is about
    13 px of the 1280 px screen.
  - **What the reviewer ruled out.** `bodyLights` is pure (no private write, no callee). The entry already has two
    call sites, in exclusive branches (`light-list.wgsl.ts`). The bad texels are skin at the jaw's silhouette whose
    colour is bit-equal to `gain` 0, so the added call never ran on them. The fault also shows on an open head 4.2 m
    away. That depth needs `cameraPosition + rayDir x t` (`zombie-gpu.ts createMarchMaterial`) to be exactly zero: a
    zeroed temporary, from codegen or from the node graph's ordering. (Bisected since: the node graph is not it, and
    what is zeroed is the entry point's ray and hit distance. See the last section.)
  - **What holds it now.** The gate's depth guard (review fixes, below) catches it whatever the cause. The block does
    not walk the list. Its test first pinned the entry's count of `bodyLights(` at 2 as a tripwire; after the
    bisect it pins the real rule (where the call may sit).

### The constants (`SPLIT_SHADE.glisten`)

| | | |
| --- | --- | --- |
| `gain` | 4 | the highlights' strength x the light's colour. **To turn the step off: `gain` 0.** The block is then not written into the shader at all: the three march exports hash to this commit's parent's golden values (checked), so off is the look before, to the byte |
| `pow` | 24 | the torch's highlight exponent |
| `spill` | 0.3 | how far past the beam's outer cone the torch's glint reaches, in the cosine to the beam's axis (to about 51 degrees) |
| `lamps`, `lampPow` | 0.45, 20 | torch off: the keying lamp's share of `gain`, and its exponent |
| `rawLo`, `rawHi` | 0.3, 0.8 | the film comes in over this range of the wound mask |
| `lump`, `lumpTilt`, `lumpFlat` | 0.014 m, 1.4 (**3.2** after the review fixes: the tilt is projected now), 0.1 | the coarse octave: cell, tilt per unit of noise on one axis, and the push off zero |
| `fine`, `fineTilt` | 0.006 m, 0.3 | the fine octave |
| `fadeLo`, `fadeHi` | 0.75, 1.5 | an octave fades as its cell shrinks from 1.5 to 0.75 MARCH TEXELS. In metres that is the march resolution's: at the gate's (a 400 x 300 target) the fine one is whole to about 1 m and gone by 2 m, the coarse one (and with it the film) whole to 2.4 m and gone by 5 m. At another resolution the distances scale with the texel |
| `edge` | 0.03 m at the region sphere (**0.01 m** past the opened head's bounds after the review fixes) | the film's soft boundary |
| `horizon` | **0.15** (review fixes) | a light's glint comes in over this much of n . L on the surface's own normal |

### The numbers

**The instrument.** The float march target, display-encoded (the target holds the lit colour after the legacy display
decode; luma is taken after the sRGB encode, which is what the screen shows before the post FX). **Raw surface**: the
texels where the film's own gate is over 0.5, painted by a scratch build of the block (`glisRaw > 0.5` writes a flat
colour; not committed). The gate's tissue-green paint was tried first and is the wrong instrument here: it also
marks the wound mask's faint reach over the skin and the footprint under the face sheet, and misses part of the pit.
Before = this build with `gain` 0, same session, same boot pins, same cameras (two zombies of the ring: `middle` both
and `middle` one side, forced to the full angle; a third with a pellet crater in a closed head; a fourth with a torso
chop). The torch cannot be switched back on under the frozen light clock, so each boot shoots everything torch on,
then everything torch off.

Share of raw-surface texels over 0.6 and over 0.95 luma, before -> after:

| | raw texels | torch ON, over 0.6 | over 0.95 | torch OFF, over 0.6 | over 0.95 |
| --- | --- | --- | --- | --- | --- |
| **0.6 m, pooled** (front, three-quarter, above-behind; both scenes) | 11 467 | **1.98 -> 4.63%** | 0.02 -> 0.76% | 1.20 -> 1.80% | 0 -> 0 |
| **2 m, pooled** (front; both scenes) | 179 | **6.15 -> 9.50%** | 0 -> 0.56% | 0.56 -> 1.12% | 0 -> 0 |
| both, front 0.6 m | 861 | 5.46 -> 7.55% | 0 -> 0.35% | 0.81 -> 2.32% | 0 -> 0 |
| both, three-quarter 0.6 m | 1586 | 0.19 -> 5.17% | 0 -> 1.77% | 0 -> 2.40% | 0 -> 0 |
| both, above-behind | 2743 | 4.99 -> 7.51% | 0.07 -> 1.02% | 2.59 -> 3.03% | 0 -> 0 |
| both, front 2 m | 80 | 11.25 -> 15.00% | 0 -> 1.25% | 1.25 -> 2.50% | 0 -> 0 |
| one side, front 0.6 m | 1251 | 1.04 -> 1.84% | 0 -> 0 | 0 -> 0.08% | 0 -> 0 |
| one side, three-quarter 0.6 m | 3037 | 0.79 -> 3.49% | 0 -> 0.59% | 0 -> 0 (mean luma 0.072 -> 0.093) | 0 -> 0 |
| one side, above-behind | 1989 | 0.15 -> 2.46% | 0 -> 0.50% | 3.02 -> 3.22% | 0 -> 0 |
| one side, front 2 m | 99 | 2.02 -> 5.05% | 0 -> 0 | 0 -> 0 | 0 -> 0 |
| one side, from the head's right side 0.6 m (the most highlight of any view shot) | 3324 | 3.13 -> 9.78% | 0.75 -> **2.89%** | 0.09 -> 0.39% | 0 -> 0 |

No view passes 3% over 0.95. The first tuning (plain value noise, `gain` 3.5) read 17.9% / 8.2% in that side view;
pushing the coarse octave off zero is what brought it down, at no cost to the oblique views.

**The highlights over the 5-frame orbit** (the eye and its torch orbit the head at 0.6 m, 8.6 degrees a frame; a
highlight texel is a raw texel over 0.6, placed in the world by its depth, so one that stays on its spot of flesh
reads as staying):

| | highlight texels per frame, before | after | after: share of a frame's highlights with none within 4 mm in the next | across the whole sweep (first -> last, last -> first) |
| --- | --- | --- | --- | --- |
| both | 11, 12, 11, 8, 3 | 53, 40, 31, 43, 48 | 55%, 78%, 68%, 40% | 100%, 100% |
| one side | 8, 14, 16, 19, 24 | 25, 40, 57, 73, 106 | 40%, 17%, 11%, 12% | 36%, 54% |

In the pit (both) the set is replaced almost every step: the highlights jump from ridge to ridge. On the one-sided
head's big cap they are denser and turn over more slowly; a highlight that persists stays within 1.2 to 2.6 mm
(the median distance to the nearest highlight of the next frame), and the count quadruples as the cap turns to the
torch. Honestly: on the cap they read as glints switching on and off as you move, more than as one highlight
sliding.

**Nothing outside an open split changed.**

- `march-hash`: the six pins unmoved (`d7392d52…` / `76bd51aa…`, `0c71e712…` / `bf6836cd…`, `470ff0b3…` /
  `f618070e…`).
- A closed head with a pellet crater, front 0.6 m, torch on and off: **0 of 120 000 texels differ**, colour and
  depth. A torso chop, 0.9 m: **0 of 120 000**.
- Over all 34 captures, every body texel outside both open heads' region spheres (placed in the world by its depth;
  339 742 texels): **0 differ**. Inside a sphere 24 216 differ. No capture differs in depth anywhere. The floor of
  every capture (its two reads) is 0.
- Inside the region but more than 3 texels from any raw texel, up to 72 texels a capture differ: most under 1e-5 (the
  compiler rounding the open head's light another way with the block in the text, as B8 saw), a few up to 0.05 where
  the mask's fade runs wide on the crown.

**The gate** (`head-split-gate.mjs`, 77 checks, 0 failed) against group 2's last run: every check line the same to
the character but three, all on open heads: O's light on the still half, 131 -> 151 of 4520 texels over 0.01
(0.029 -> 0.033 against 0.1: the open head now has glints the same head closed does not); L's pellet, centroids
0.51 -> 0.50 texels, 1229 -> 1230 mask texels (its rod cut 1.20 / 0.62 as before); M's eye landmark 3.37 -> 3.36 px.
No threshold was touched.

### The sheets (`look/`)

`10-wet-flashlight.jpg` (before | after: both at the kill and one side, torch on and off, the four cameras),
`11-wet-flashlight-sweep.jpg` (the orbit), `12-wet-flashlight-side.jpg` (from the head's right side).

What I see in them. On the one-sided head the big cut face now reads as wet meat under the torch from three-quarter
and from above: white glints on the dark red, and more of them as the face turns to the light. That is the view where
the step is striking. On the head split both ways at the kill the change is real but small: the pit picks up a few
white glints from three-quarter and from above, and from the front the raw surfaces are thin slivers seen edge on and
the before and after are hard to tell apart. At 2 m it is one or two texels: the number moves, the picture hardly
does. With the torch off the cap takes a sparse warm speckle from the lamp; it reads as wet, not grey or plastic, and
on the large cap of the one-sided head slightly spotted. The cap and the pit match: the same pattern at the same
scale, the pit's glints gathered on its ridges, the cap's spread evenly. The glints are streaks more than dots (the
push off zero makes the film's facets long and narrow); I read them as wet fibre.

**Still wrong, or not known.**

- All of this is stills. Glints the size of one march texel exist at 0.6 m; they will twinkle as the eye moves, and
  whether that reads as sparkle or as noise needs the owner's eye in play. The dials: `fineTilt` 0 (no fine octave),
  a larger `lump`, a lower `gain`.
- The step is modest on the two-sided split, where little raw surface faces the player. More would mean changing what
  is seen there (not this step).
- With the torch lit the lamps add no glint (above).
- The deferred surface entry does not carry the film (it has no highlight of its own; the game runs the legacy tail).
- The wobble was not shot: the pattern is cut in the rest anchor and turned with the half, so it should ride a
  swinging half, but no capture shows it.

### The check set

| Check | Result |
| --- | --- |
| `march-golden -u` | `MARCH_BODY`, `MARCH_BODY_LIGHT`, `REFINE_BODY` |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 326068 B -> 330409 B (83 fns) |
| `march-hash` | no pin moved |
| cold boot pair (base `9dcd133f`) | new 44821 / 44714 ms, base 44569 / 44275 ms warm-up (`drawOnce` 1662 / 1677 against 1682 / 1667); load 3.5-4.3. Taken before two comments in the block were reworded; the shader's code is the same |
| `head-split-gate.mjs` | 77 checks, 0 failed (twice: before and after the comment rewording, every check line the same) |
| `axe-gate.mjs` | 25 checks, 0 failed |
| `cut-wound-gate.mjs` | 30 checks, 0 failed |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree (`--exclude '**/cut-wound.test.ts'`) | 511 files, 7458 tests passed, 1 skipped |

**Cost** (`timeDraws`, three interleaved pairs each, load 4 to 5). Open minus closed at 0.6 m: at the start (HEAD)
+8.7 ms (closed 26.4 / 26.8 / 33.0, open 35.3 / 35.5 / 36.4); at the end +8.0 ms with the film (37.3 / 38.0 / 38.7
against 43.7 / 46.0 / 49.0) and +7.2 ms with `gain` 0 in the same session (32.1 / 32.7 / 32.8 against 39.2 / 39.9 /
41.8); an earlier pair of the session read +8.1 and +7.1. The level itself moved by 6 to 13 ms from boot to boot, so
the film's cost is not resolved: under 1 ms if anything. At 2 m the spread (16 ms in one triple) hides everything.
The work added is per raw texel only: six noise taps and two powers.

### Group 2, review fixes (2026-10-05)

**The owner played `9dcd133f`** and said the wobble "looked fine to me". The tuning stays exactly as built: no value
of `HEAD_SPLIT.wobble`, `AXE_HEAD.openAngles` or `killKick` changed here. The monotone stage, the mass point, the
drive in proportion to the opening and `GAP_REST_OVER` 3 mm were accepted in review.

**Guards.**
- **The step does not trust its drive** (`stepSplit`). A NaN handed straight to it left `wobP` NaN for good. Now a
  drive component that is not finite is none, one past `accelClamp` is held to it, and offsets or rates that are not
  finite (in the state, or after the step) are at rest. The leaf's `wobbleDrive` still clamps; the guarantee no
  longer rests on it.
- **A jump is not a motion** (`pointAccel`, `HEAD_SPLIT.wobble.jumpSpeed` 25 m/s). A teleport read as a +-40 m/s^2
  doublet: bounded, but a 2.9 degree blip (7.4 at worst). A sample that moved faster than `jumpSpeed` from the last
  is dropped and the history starts again from it. The fastest a body's mass point was measured at is 5.3 m/s in a
  lurch; the corpse's hinge whipped down at 11 m/s in one fall. (A crowd-separation nudge of 2 m is slid over five
  steps by the actor, at 21 to 38 m/s: the fast ones are dropped.)
- **Each difference over its own step's time** (`PointMotion.dt`): the two velocities are each over their own dt, and
  the acceleration is their difference over the time between those steps' middles. With equal steps the numbers are
  the same to the bit (the gate's did not move).

**Parameters are passed in** (`WobbleParams`): `stepSplit`, `wobbleDrive`, `splitMassPoint`, `pointAccel` and
`wobbleLimits` take them as a last argument (the shipped `HEAD_SPLIT.wobble` by default), and the leaf takes
`deps.wobble`. The tests pass their own sets; nothing writes to the constant any more, the gate included.

**The hot path.** `n x a` is computed once a tick in the leaf and handed down; `pointAccel` builds its two vectors
directly; `stepSplit` steps both halves in one loop on scalars and spreads the state once (it made two tuples, a
limits pair and two state copies before).

**The gate: 78 checks.**
- **J is scripted.** It needed the ring's wander to swing the halves, twice, in fixed windows: flake-prone. Now a
  FROZEN zombie's split is driven through a new seam, `__sdfGame.headSplitDrive(id, accs)` (`game-head-split.ts
  script`): world accelerations of the mass point, taken one a tick in place of the pose's. The list is 164 ticks in
  the split's own frame: a walk (the measured bob of +-2 m/s^2 at 2.1 Hz and 1.9 across), four hard throws at the
  clamp (across the split each way, up and down), and a swing to end on. A really wandering zombie is still watched
  at the end, printed and not checked (8.3 and 12.5 degrees in 150 frames).

| J's check | Measured | The mutation that fails it |
| --- | --- | --- |
| frozen and undriven, at the spring's angle | 0.55 / -0.55 rad, 20 frames | a gravity term in the leaf's drive: sags 7.4 degrees |
| the leaf steps the list exactly as the pure step | 0 of 164 frames differ | the leaf halving what it is fed (101 differ); the gravity term (95) |
| under the walk each half swings | 5.7 and 5.7 degrees, 5.0 apart | the gains at 0: 0.00 |
| inside the limits every frame, into all four stops | 17.3 to 45.7 degrees; 34 to 38 frames at each stop | the clamp removed: -56.9 to 96.8 degrees; the gains at 0 (no stop reached) |
| the frozen actor's pose carries the state's two angles | 0 of 164 differ; the pose moved on 99 | the leaf not re-posing for a wobble (164 differ); the warp giving both halves one offset (126) |
| held on a swing, the GPU record carries them | 30.8 / 42.8 degrees, equal as floats | the gains at 0; no re-pose; one offset for both |
| the skull's copies at the stage's share of each | 26.19 / 36.38 against the same | the same three |
| the drive over, at rest exactly within the bound | 69 frames (bound 104), 20 more | the gravity term (never); the gains at 0 (0 frames) |

  The live cut of `max` is gone: the hard throws reach the shipped stops by themselves.
- **K's bone check could not fail.** It read frame 3 of the kick, where the flesh is past its target and the rule
  before the stage gives the same bone. The kick is now followed for 12 frames on the still-frozen body (no wobble on
  top, so the flesh's angle is the spring's), before the thaw that kills: the old check at frame 3 (37.55 degrees,
  bone 31.92) and a new one at the bottom of the swing back (frame 6: 28.73, bone 24.42 / 24.42). With the old rule
  restored the new one fails: the bone is drawn at 17.44.
- W's and T's rest checks also hold the wobble at rest (offsets and rates exactly 0), and T the pose's two angles.

**The residual, restated.** With the axe's own table a chop landing above the old target is a large step: chop 2
landing 3, 4 or 5 frames after chop 1 moves the bone 20.6, 18.3 and 14.4 degrees in one tick with 5.2, 0.3 and -1.7
of flesh (2 frames after, 23.4 with 11.3 of flesh: steep, inside the per-tick bound). Seam only: strikes are at
least 0.6 s apart in play. The unit test documented 4.2 degrees, the old table's. The per-tick bound's test now runs
the shipped table and the kill's kick.

**For a later optimisation pass:** a walking split head never rests (its halves' angles change every tick: 99 of
164 frames in the script, every frame of a walk), so its bounds, hulls and record are re-made every tick. Only a
corpse, or a body that stands still, comes to an exact rest and could cache them.

Checks for the review fixes (no WGSL touched): `tsc --noEmit` the `node:crypto` error only; the whole tree 511 files,
7464 tests passed, 1 skipped; `head-split-gate` **78 checks, 0 failed** twice, every check line and every measure
line but the draw times the same in both; `axe-gate` 25 of 25; `cut-wound-gate` 30 of 30. Against the run at
`9dcd133f` the lines that were already there read the same, but for three that moved by a hair (O's lit texels 131
-> 151, L's centroid 0.51 -> 0.50 texels, M's worst 3.37 -> 3.36 px): shading measures, with the flashlight wetness
commits in between (not bisected).

## Look: wet under the flashlight, review fixes (2026-10-05)

The step was reviewed: approved with fixes. The look is kept (the owner has the build and has not asked for a change
to `gain`): `gain`, `pow`, `spill`, `lamps` and `lampPow` are untouched. One code commit on top of the wobble fix
(`d0fa3777`).

### 1. The film stays on the head

The block's gate was `splitIn` x the wound mask, and the region sphere (r 0.32 m about a hinge at y 1.56) takes in
the neck, the shoulders and the chest down to about y 1.24. So a wound on the CHEST of a zombie whose head is open
took the film, and the 3 cm fade at the sphere would have crossed a chest chop.

Now `glisRaw` carries the piece loop's own measure of where the split's flesh is (`map-body.wgsl.ts cap0`), read at
the hit piece's un-warped point `pS`: `min(up, rho - dh)`, above the hinge plane and inside the hold ball, whole on
and inside those bounds (the floor of the V lies on the hinge plane) and gone 1 cm past them (`edge`, was 3 cm at the
region sphere). The film covers the turned halves' raw surfaces and the floor of the V, and nothing under the hinge.

**Proof** (`scratchpad/b8b3/leak.py`). A zombie with its head forced wide open takes a torso chop (its centre 0.315 m
under the hinge, 0.333 m from it) and a pellet in the shoulder (0.17 m under, 0.244 m from it: inside the region
sphere). Shot at the chest from 0.9 m and at the shoulder from 0.6 m, torch on and off, this build against `gain` 0,
every body texel placed in the world by its depth:

| | body texels under the hinge plane (inside the region sphere) | differ, before the fix (`d0fa3777`) | differ, after |
| --- | --- | --- | --- |
| chest view, torch on | 36 156 (12 436) | 1247 (up to 0.999) | **0** |
| chest view, torch off | 36 156 (12 436) | 1340 | **0** |
| shoulder view, torch on | 35 518 (12 458) | 946 | **0** |
| shoulder view, torch off | 35 518 (12 458) | 871 | **0** |

In the chop's own window (1.5 x its half-length: 13 187 / 12 266 texels) and the pellet's (2325 / 3187): 0 differ.
The measure can fail: it read 871 to 1340 on the build before.

And the proof of the first round again, on this build: a closed head with a pellet crater and a torso chop on a
closed-headed zombie, 0 of 120 000 texels each, torch on and off; over all 62 captures, every body texel outside the
region sphere of every open head (four of them; 587 723 texels): 0 differ, colour and depth.

### 2. The film leans, and keeps to the lit side

`normalize(n + tilt)` had no tangent projection: with `lumpTilt` 1.4 the film's normal could turn INTO the surface,
and neither light term had a horizon, so a lamp could glint on flesh facing away from it; and "the tangent of the
tilt" in the constants' doc was untrue. Now the tilt is projected onto the tangent plane, as the body grain's is
(`tilt - n dot(tilt, n)`), so the film's normal leans and n . glisN stays positive; and each light's glint carries a
soft horizon on the surface's own normal (`smoothstep(0, horizon, n . L)`, `horizon` 0.15: the torch's direction for
the torch, the keying lamp's for the lamp).

**The retune.** Before the fix about half the facets were dead by accident (their normal pointed into the flesh);
projected, all of them can catch the light, and the same `lumpTilt` gave more and larger highlights (pooled at 0.6 m,
torch on: 6.48% over 0.6 and 1.98% over 0.95 against 4.63% / 0.76%; 7.63% over 0.95 from three-quarter on the
two-sided head). `lumpTilt` alone was swept (0.7, 1.0, 1.4, 1.9, 2.5, 3.2) for the nearest match to the previous
sheets, view by view: **3.2**. `fineTilt` stays 0.3. Nothing else moved.

Share of raw-surface texels over 0.6 / over 0.95 luma (the same raw texels as before: the first round's gate masks),
the first round's build -> this one:

| | raw texels | torch ON | torch OFF |
| --- | --- | --- | --- |
| **0.6 m, pooled** (front, three-quarter, above-behind; both scenes) | 11 467 | **4.63 / 0.76% -> 5.05 / 1.08%** | 1.80 / 0 -> 1.53 / 0% |
| **2 m, pooled** (front; both scenes) | 179 | **9.50 / 0.56% -> 8.94 / 0.56%** | 1.12 / 0 -> 1.68 / 0% |
| both, front 0.6 m | 861 | 7.55 / 0.35 -> 8.94 / 0.46% | 2.32 -> 2.90% |
| both, three-quarter 0.6 m | 1586 | 5.17 / 1.77 -> 5.23 / 1.70% | 2.40 -> 0.50% |
| both, above-behind | 2743 | 7.51 / 1.02 -> 9.22 / 1.86% | 3.03 -> 3.03% |
| one side, front 0.6 m | 1251 | 1.84 / 0 -> 1.60 / 0.08% | 0.08 -> 0% |
| one side, three-quarter 0.6 m | 3037 | 3.49 / 0.59 -> 2.96 / 0.72% | 0 -> 0 (mean luma 0.093 -> 0.072) |
| one side, above-behind | 1989 | 2.46 / 0.50 -> 2.82 / 0.96% | 3.22 -> 3.02% |
| from the head's right side, both | 308 | 5.84 / 0.65 -> 9.42 / **2.27%** | 0.32 -> 1.62% |
| from the head's right side, one side | 3324 | 9.78 / 2.89 -> 4.45 / 1.29% | 0.39 -> 0.09% |

(Before the film at all: 1.98 / 0.02% at 0.6 m and 6.15 / 0% at 2 m, torch on; 1.20% and 0.56% torch off.) No view
passes 2.3% over 0.95 now. Highlight texels over the 5-frame orbit: both 53, 40, 31, 43, 48 -> 37, 28, 47, 96, 132;
one side 25, 40, 57, 73, 106 -> 33, 79, 112, 110, 90.

What changed in the picture (`look/10` to `12`, shot again): under the torch the sheets are very close to the first
round's. With the torch OFF the big cut face of the one-sided head lost its warm speckle from three-quarter (mean
luma back to the value before the film, 0.072): that face looks away from the lamp that keys the body, and the
speckle was the fault the horizon removes. Faces that do look at the lamp keep theirs.

### 3. The depth fault: a guard, not a rule

- **The guard** (`scripts/head-split-gate.mjs depthGuard`, run on every capture the gate reads: 227 a run, 7.5 million body texels).
  The target's alpha is the hit's clip depth, so each body texel is a point in the world: the eye + (its distance
  along the view axis) x (the texel's ray). A texel is bad when that distance is not positive and finite (behind the
  camera, or nowhere), or when the point lies outside EVERY actor's proxy box (the view's position +- its
  `bodyHalf`: the box the march rasterises and can alone hit inside), grown by 5 cm + 3% of the distance (a texel's
  footprint and the march's accept reach). Of the bad texels, those at the world origin's clip depth (within 1e-6)
  are counted apart: the fault's signature. One check, in C: 0 bad texels over the run.
- **It fails on the faulty build.** With the second call put back in the block (a scratch edit, reverted by name),
  `ONLY=S,O`: "49 lie behind the camera ... 49 of those at the world origin's depth; the first {texel [208, 69],
  clipDepth 1.0107716, distance -9.741, originDepth 1.0107717}". (O failed too on that build: 9 texels of the still
  half moved in depth.) On this build, the same subset and the whole gate: 0.
- The test, this file and HANDOFF no longer call it a `bodyLights` rule (the first round's section above is
  reworded, with what the reviewer ruled out and the 4 x 4 cells). The test pinned `bodyLights(` at 2 in `MARCH_BODY`
  and `REFINE_BODY`, as a tripwire, until the bisect replaced it (last section).

### 4. The wobble: does it sparkle?

A 12-tick strip of an open head driven by the gate's scripted walk (`__sdfGame.headSplitDrive`, scenario J's bob
and sway; each half swings 0.1 to 0.9 degrees a tick about 30), torch on, from three-quarter at 0.6 m and at 2 m
(`look/13-wet-flashlight-wobble.jpg`). A film highlight is a body texel over 0.6 luma that is not over 0.6 on the
same scripted frame with `gain` 0; each is carried back to the CLOSED head by its frame's own split, so a glint that
rides its half reads as staying. Single-frame: no highlight within 1.75 texel footprints of that spot of flesh on the
tick before nor on the tick after.

| | highlight texels a tick | single-frame | new against the tick before |
| --- | --- | --- | --- |
| 0.6 m (within 4.5 mm) | 118 to 155 | **2.5%** (32 of 1270) | 5.8% |
| 2 m (within 13.1 mm) | 15 to 22 | 4.0% (7 of 176) | 14.2% |

Far under a third at 0.6 m, so `lumpFlat`, `fadeLo` and `fadeHi` are unchanged. (At `lumpTilt` 1.4 and 2.5 it read
1.8% and 2.0%.) The pixel-footprint fade is still keyed to the noise's cell, not to the facets' edges; this strip is
what says that is enough for a walk's wobble. A hard throw, or the eye moving fast, is not measured.

### On record

- **The deferred surface entry does not carry the film.** It has no light tail. The game's default entries (the
  march and its refine twin) do.
- **With the torch lit the level's lamps add no glint to the film** (the torch keeps the key; the lamps are only in
  the list's sums).
- **Cost per raw texel:** six `noise3` taps and two `pow`, and the same again in the refine twin where it re-shades
  that texel. Nothing off the opened head's raw surfaces.
- **The fade's distances** (2.4 m / 5 m) are the gate's march resolution's: the fade is in march texels.
- **Also pinned now:** with `gain` 0 the three march exports are, to the character, the build without the block
  (the modules built again with that one number changed: `split-glisten.wgsl.test.ts`).

### The check set

| Check | Result |
| --- | --- |
| `march-golden -u` | `MARCH_BODY`, `MARCH_BODY_LIGHT`, `REFINE_BODY` |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 330409 B -> 331149 B (83 fns); cold `warmMs` 21412 (23514 in the first round) |
| `march-hash` | no pin moved (`d7392d52…` / `76bd51aa…`, `0c71e712…` / `bf6836cd…`, `470ff0b3…` / `f618070e…`) |
| `head-split-gate.mjs`, twice | **79 checks, 0 failed** each (the wobble fix's 78 and the depth guard: 0 of 7 545 127 body texels over 227 captures behind the camera or outside every proxy box); every check and measure line the same in both runs but the draw times |
| `axe-gate.mjs` | 25 checks, 0 failed |
| `cut-wound-gate.mjs` | 30 checks, 0 failed |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree (`--exclude '**/cut-wound.test.ts'`) | 511 files, 7467 tests passed, 1 skipped (one pin restated: `split-hit.wgsl.test.ts` counted the light tail's readers of `pS` at 2, the motion vectors; the film's head-side gate is the third) |
| cold boot pair | not run: the census cold compile did not move by a second |


## Look: wet under the flashlight, round 3: the film glints square on (2026-10-05)

The review fixes were re-reviewed and approved, with one finding that changes the look. This round answers it, and
gives the owner a sheet of variants to pick from (the constants are compile-time).

### The grazing bias

With the tilt projected onto the tangent plane, n . glisN = 1 / sqrt(1 + |tilt|^2), and the retune of the last round
(`lumpTilt` 3.2, to match the first sheets' luma shares) put nearly every facet close to grazing. The film's lean (the
angle between its normal and the surface's), by the block's twin in `split-glisten.wgsl.test.ts` over 76 800 anchors
on three planes:

| | 5% | median | 95% | facets under 10 degrees |
| --- | --- | --- | --- | --- |
| the build before (`lumpTilt` 3.2, `lumpFlat` 0.1, `fineTilt` 0.3) | 60.9 | **72.2** | 76.4 | 0.02% |
| now (`lumpTilt` 2.4, `lumpFlat` 1, `fineTilt` 0.6) | 14.5 | **39.3** | 54.8 | 2.4% |

So the film only caught a light raking across it, and a cut face seen square on under the player's torch, the
commonest view of an opened head, was nearly dry: 1.86% of its raw texels over 0.6 luma against 1.19% with no film.
The retune had matched the aggregate shares and moved where the glints live.

`lumpFlat` moved too (the brief named `lumpTilt` and `fineTilt`). At 0.1 the coarse octave is two-valued, so lowering
`lumpTilt` alone gives a narrow lean with no tail (at 0.6: 16.5 / 30.7 / 40.8, 1.3% under 10 degrees); at 1 it is
close to the plain noise and the lean spreads from near the normal out to about 55 degrees. The projection and the
horizon are kept.

### The variants (`look/14-wet-variants.jpg`)

Columns OFF | A | B | C; rows: both at the kill square on from the front, the same from above looking down into the
V, one side square on to the big cut face (69 degrees round from the front and raised: square on from the side the
folded half is in the way), one side three-quarter, both at 2 m, and one side three-quarter with the torch off.
To switch, paste a line into `SPLIT_SHADE.glisten` (the other numbers stay: `spill` 0.3, `lamps` 0.45, `lampPow` 20,
`rawLo` 0.3, `rawHi` 0.8, `lump` 0.014, `fine` 0.006, `fadeLo` 0.75, `fadeHi` 1.5, `edge` 0.01, `horizon` 0.15):

| | paste |
| --- | --- |
| OFF | `gain: 0` |
| A (the build before) | `gain: 4, pow: 24, lumpTilt: 3.2, lumpFlat: 0.1, fineTilt: 0.3` |
| **B (shipped)** | `gain: 2.6, pow: 40, lumpTilt: 2.4, lumpFlat: 1, fineTilt: 0.6` |
| C (bolder) | `gain: 4.5, pow: 28, lumpTilt: 2.4, lumpFlat: 1, fineTilt: 0.6` |

Share of raw-surface texels over 0.6 / over 0.95 luma, torch on unless said (float march target; raw = the film's own
gate, painted by a scratch build, as before):

| | raw texels | OFF | A | B | C |
| --- | --- | --- | --- | --- | --- |
| both, square on from the front | 861 | 5.46 / 0 | 8.94 / 0.46 | 5.57 / 0 | 6.62 / 0 |
| both, down into the V | 4399 | 1.68 / 0.09 | **12.46 / 3.59** | 3.48 / 0.34 | 6.12 / 1.64 |
| one side, square on to the big cut face | 4355 | 1.19 / 0.09 | 1.86 / 0.28 | **5.63 / 0.92** | 11.50 / 4.32 |
| one side, three-quarter | 3037 | 0.79 / 0 | 2.96 / 0.72 | 3.92 / 0.72 | 7.94 / 3.06 |
| both, three-quarter | 1586 | 0.19 / 0 | 5.23 / 1.70 | 3.47 / 0.88 | 6.43 / 3.03 |
| both, 69 degrees round and raised | 1521 | 3.29 / 0.53 | 5.00 / 1.05 | 6.51 / 1.64 | 10.19 / 3.42 |
| one side, from the head's right side (the pit at the crown) | 3324 | 3.13 / 0.75 | 4.45 / 1.29 | 8.48 / **2.50** | 13.66 / 6.41 |
| both, front 2 m | 80 | 11.25 / 0 | 13.75 / 0 | 12.50 / 0 | 13.75 / 0 |
| one side, three-quarter, torch OFF | 3037 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| both, three-quarter, torch OFF | 1586 | 0 / 0 | 0.50 / 0 | 0.44 / 0 | 4.10 / 0 |
| **pooled, the first rounds' cameras at 0.6 m** (front, three-quarter, above-behind; both scenes) | 11 467 | 1.98 / 0.02 | 5.05 / 1.08 | **3.83 / 0.45** | 6.30 / 1.68 |
| the same, torch OFF | 11 467 | 1.20 / 0 | 1.53 / 0 | **1.49 / 0** | 2.40 / 0 |
| **pooled, 2 m** (front; both scenes) | 179 | 6.15 / 0 | 8.94 / 0.56 | **6.70 / 0** | 7.82 / 0 |
| the same, torch OFF | 179 | 0.56 / 0 | 1.68 / 0 | **0.56 / 0** | 1.12 / 0 |
| pooled, the four views from the side (69 degrees round and raised; from the head's right; both scenes) | 9508 | 2.30 / 0.39 | 3.51 / 0.82 | 6.79 / 1.56 | 11.97 / 4.83 |
| pooled, down into the V (both scenes) | 7325 | 1.27 / 0.05 | 10.83 / 2.94 | 3.39 / 0.44 | 6.05 / 1.76 |

What I see in the sheet, two sentences each:

- **OFF.** The opened head as the owner played it: dark wet colour, no highlight on the raw surfaces but where the
  surface's own broad highlight happens to land. Nothing moves when you do.
- **A.** Looking down into the V it is the wettest of the four, white streaks all over both faces. Square on to the
  big cut face it cannot be told from OFF: the face is dry.
- **B.** The big cut face seen square on now carries a fine web of thin white glints, and three-quarter is about as
  wet as A. Down into the V it keeps a few glints where A had many, the glints everywhere are thin lines and specks
  more than blobs, and at 2 m it adds almost nothing (10 highlight texels of 80 against 9 with no film on the
  two-sided head, 2 of 99 against 2 on the one-sided).
- **C.** The same film brighter and broader: the square-on face is plainly wet at a glance, the V from above reads
  wet again, and three-quarter has large white flecks. It is past the blow-out bound in the square-on views (3.4% to
  6.4% over 0.95 where the bound is 3%), and with the torch off the lamp's speckle becomes visible on the two-sided
  head (4.1% over 0.6 from three-quarter).

**B against A, plainly.** Square on, B is clearly better: 5.63% against 1.86% on the big cut face, 6.79% against
3.51% over the four views from the side, and the picture shows it. Everywhere else B is the quieter of the two: at a
rake (3.39% against 10.83%), over the first rounds' cameras (3.83% against 5.05%) and at 2 m (6.70% against 8.94%,
with no film 6.15%). The 3% bound on the worst view (2.50%, the pit at the crown from the side) is what holds B's
`gain` at 2.6. If "striking" is the brief, C is the one that reads at a glance; B is the one that stays inside the
blow-out bound. B ships.

**Also measured on B.**

- The wobble strip (round 2's measure): 2.8% of film highlight texels last a single tick at 0.6 m (24 of 859; 8.5%
  new each tick), 2.4% at 2 m (4 of 166; 12.7% new). `fineTilt` 0.6 did not make it sparkle.
- Nothing outside an open split: a closed head with a pellet crater and a torso chop, 0 of 120 000 texels each,
  torch on and off; a chest chop and a shoulder pellet under an open head, 0 of 36 156 / 35 518 texels under the
  hinge plane; every body texel outside the region sphere of every open head over 70 captures (855 479): 0 differ.
- `look/10` to `13` are shot again on B (their "after"); the numbers in the two sections above are those builds'.

### The depth guard, tightened

- **The gap.** The origin's depth was counted only among texels the other two arms had already judged bad, and the
  box's slack is 0.44 m at 13 m: a faulty texel whose origin-depth point fell inside some body's grown box passed.
  Now, of ALL body texels whose clip depth is the world origin's (within 1e-6), the guard takes the largest set that
  share one depth to the bit, per capture: a surface that really crosses that depth does so at many depths, a hit
  written at (0, 0, 0) at one. A run over 2 fails.
- **Its arms can each fail** (a positive control on made-up texels through the same pure function: nothing is
  rendered): one texel behind the camera, one 13 m off in no bound, and three at the origin's depth that land INSIDE
  a body's box read 1, 1 and a run of 3; a clean target reads 0, 0, 0. (Written inline in the gate as `depthJudge` /
  `depthGuardControl`; since the merge with the bisect it lives in `scripts/lib/march-depth-guard.mjs` as
  `depthGuardTexels` / `depthGuardControl`, and both gates run it: last section.)
- **What else is in the target it reads.** Everything on the SDF layer: the actors' bodies and the marched GIB
  CHUNKS (`createChunkGpuView`). So a live chunk's sphere (`chunkStats().livePieces`: its centre, 1.75 x its radius)
  is a bound too, beside the actors' proxy boxes; without it a gibbed body's pieces would read as "outside". None is
  live in the gate's captures today (the check prints the most it saw: 0). The first-person weapon is a mesh and is
  not in the target; the marched first-person hands (`fpv-view.ts createHandsGpuView`) exist in the character lab
  only. (Measured in the merge, below: the axe gate's three real-swing frames, guard on: 95 739 body texels, 0 bad.)

### The check set

| Check | Result |
| --- | --- |
| `march-golden -u` | `MARCH_BODY`, `MARCH_BODY_LIGHT`, `REFINE_BODY` (constants only: the block's text is the last round's but for five numbers) |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; march module 331149 B (83 fns: the same size, five numbers changed); cold `warmMs` 43181 (a cold boot with no warm cache: B4's 45.0 to 49.5 s is the level, the 21 to 24 s of the two rounds before were warmed) |
| `march-hash` | no pin moved (`d7392d52…` / `76bd51aa…`, `0c71e712…` / `bf6836cd…`, `470ff0b3…` / `f618070e…`) |
| `head-split-gate.mjs`, twice | **80 checks, 0 failed** each (79 and the guard's positive control); every check and measure line the same in both runs but the draw times. The guard: 0 of 7 545 127 body texels over 227 captures behind the camera or outside every bound, 0 chunks live, the largest bit-equal run at the origin's depth 0 |
| `axe-gate.mjs` | 25 checks, 0 failed |
| `cut-wound-gate.mjs` | 30 checks, 0 failed |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree (`--exclude '**/cut-wound.test.ts'`) | 511 files, 7468 tests passed, 1 skipped |

## The depth fault, bisected (2026-10-05)

The follow-up on the fault above. It is no longer unexplained as far as the repository can see: the trigger and the
rule are known, and what is left is inside Apple's Metal compiler or GPU. Machine: Apple M3, macOS 26.3.1, headless
Chrome 154.0.8037.93 (Dawn and Tint to Metal).

### What it is

**`bodyLights` called under a per-fragment condition.** When only some fragments of one 4 x 4 block of the march
target take the call, the other fragments of that block come back with zeroed values in the entry point: the ray
direction and the march's distance, so the hit position is exactly (0, 0, 0) and the depth written is the world
origin's. Their colour, which the same call returned, is right.

**The fragments that took the call were ones the march missed.** A WGSL `discard` does not end the invocation (Tint
writes Metal's `discard_fragment()`, which does not either), and `MARCH_TRACE_POST`'s miss branch has no `return`
after it. A missed fragment therefore runs the whole post-hit chain and the light tail on a garbage hit, its output
thrown away at the end. Garbage passes the film's gate (`splitIn`, `glisRaw > 0`), so at the head's silhouette some
missed fragments of a block ran the added call while the hit fragments beside them did not. No visible texel ever ran
it.

**The 4 x 4 cells are not a structure of ours.** The quarter-resolution depth prepass has that block size, but it is
off by default and its target is never drawn in these boots. The bad texels sit inside cells of the target's 4-texel
grid (not always the whole cell: the fragments of the cell that are bodies, or a 4 x 2 or 3 x 4 part of them), which
reads as the unit the GPU shades fragments in. That is an inference: nothing documents it.

**It is below the shader source.** `bodyLights` is pure, the generated WGSL and the Metal source Tint writes from it
are both right (below), and one fragment's branch changing another fragment's values is not something a shader can
say. The cause is in the Metal compile of that source or in how the GPU runs a call that only part of a block takes.
I could not look further than that from outside the driver.

### The rule

Call `bodyLights` only under conditions every fragment of a draw shares (`lightListCfg`), as `light-list.wgsl.ts`
does. A block that wants the list per fragment calls it for every fragment and gates the USE of the result: that
form was built (three call sites, the third at the top of the block under `lightListCfg.x > 0`, off the surface's
normal for the test) and showed 0 bad texels. The count of call sites was never the rule.

- `split-glisten.wgsl.test.ts` pins it: every `bodyLights(` in `MARCH_BODY` and `REFINE_BODY` sits directly inside
  one block whose condition reads only `lightListCfg`. The faulty build's call, spliced back, is refused; the hoisted
  form is accepted. This replaces the count-of-2 tripwire.
- The comments at `split-glisten.wgsl.ts` and `body-lights.wgsl.ts` say why.
- The gates' depth guard is what catches the fault whatever its cause (below).

### The reproduction

A scratch switch on the URL chose the block's variant, so one server gave every build. The bare ring page with the
head-split gate's boot and pins; the first zombie of the pool, `forceSplit(id, "middle", 0, 0, 1)`; the float march
target read twice, the second kept. Three cameras: the front at 0.6 m, three-quarter (0.8 rad round to the head's
right) at 0.6 m, the front at 4.2 m. A bad texel is a body texel within 1e-6 of the world origin's clip depth.

Build A is the shipped block with the first build's call put back after the film's normal:
`let glisBl = bodyLights(p, glisN, V, gInstLights, lightList, false, true); glis = glis + glisBl.spec;`

| Build | front | three-quarter | 4.2 m |
| --- | --- | --- | --- |
| shipped | 0 | 0 | 0 |
| A | **6** | **121** | 0 |
| A, the head still closed (same boot) | 0 | 0 | |
| A, `?crowd=0` (the per-body path) | 6 | 121 (the same texels) | |
| A, with `toVar` on the march's result in lit mode | 6 | 121 | |
| A, with a `return` after the miss `discard` | **0** | **28** | |
| H: the call hoisted out of the per-fragment gate (still three call sites) | **0** | **0** | |
| D1: a copy of `bodyLights` with its storage reads replaced by constants, at the gated site | 0 | 0 | |
| D4: that copy at three sites (two under `lightListCfg`, one gated) | 0 | 0 | |
| D2: no call, a four-turn loop with a `continue` | 0 | 0 | |
| D3: no call, one more `noise3` tap | 0 | 0 | |

In every build the hit mask is the shipped one, and the colour is the shipped one on every texel of the frame (0
texels differ between shipped and A): only the depth of the bad texels moves.

- **The front's 6 texels** are all six body texels of one cell at the head's top-left silhouette (the cell's other
  10 are misses). **The three-quarter's 121** are nine cells down the right silhouette and three cells
  inside the head on one row band (y 132 to 135).
- **The `return` after the miss `discard`** clears every silhouette cell and leaves the three inside cells. So the
  silhouette's actors are missed fragments running the tail. What takes the call in the inside cells is not
  identified: no visible texel does (a marker added where the call runs changed no texel of the frame, compared
  exactly), and missed fragments no longer reach it in that build.
- **Distance.** 0 at 4.2 m here; the reviewer saw it on an open head 4.2 m away in the first captures. It depends on
  which fragments share a cell, not on distance as such.

### What the entry point holds on a bad texel

Probes written into the target's rgb in place of the colour, the alpha left alone (each is its own compile; one of
the four made the fault vanish, the others kept the same 121 texels):

| Probe (rgb) | On a bad texel | On its good neighbour |
| --- | --- | --- |
| the hit position | (0, 0, 0) exactly | (32.13, 1.71, -10.51) |
| the march's `w`, the ray's z, clip `w` | 0, 0, 14.71 (the world origin's view distance) | 0.656, -0.851, 0.629 |
| the march's `w`, the ray's x and y | the fault did not show in this build | |

So the ray direction (computed in the entry before the march is called) and the distance the march returned read as
zero after the call, and so does their sum with the camera position (the camera position was not probed on its
own), while the colour the same call returned is right and the view and projection matrices are intact.

### Ruled out

- **The node graph's ordering (TSL).** The generated WGSL was captured by wrapping `createShaderModule`. The entry
  assigns the ray to `nodeVar1`, calls `marchBody` ONCE into `nodeVar2`, and both the depth output and the alpha
  compute `cameraPosition + nodeVar1 * nodeVar2.w`. Nothing is read before it is written. The march materials'
  entries (per-body and crowd) have the same shape.
- **`toVar` on the march's result.** No change (the result is already in a variable).
- **Tint.** Chrome was run with `--enable-dawn-features=dump_shaders` and the Metal source read from the console
  (CDP `Log.entryAdded`). It is a faithful translation: `bodyLights` is a function with three call sites that takes
  the light list as a `const device` pointer and its length; the entry is the WGSL's, line for line; `discard` is
  `discard_fragment(); return float4(0.0f);` at the setup's sites and a bare `discard_fragment();` at the miss.
  The module is compiled with `#pragma METAL fp math_mode(relaxed)`.
- **The tiled path.** `?crowd=0` gives the same texels.
- **The depth prepass, its miss cull, the temporal start, the occluder, the cone prepass, the depth gate.** Toggled
  at run time on the faulty build (no recompile). The prepass and the miss cull are off by default, and switching
  them changes nothing (121). The temporal start off moves 7 texels of the hit mask and the count goes to 139; with
  it off, the occluder, the cone prepass and the depth gate off each leave it at 139.
- **The call's own work.** `bodyLights` is pure (the reviewer's reading), and no visible texel ran the added call.
- **Code size and the count of call sites.** D1 and D4 are the same size as A and clean; H has A's three sites and
  is clean.
- **A closed head.** 0 on the same boot. The split's region is what puts the film's gate in reach.

Not separated: whether the fault needs the storage pointer itself or only a function the Metal compiler keeps as a
real call. The storage-free copy was clean at one site and at three, which points at the pointer, but what the
compiler inlines cannot be seen from here. The front end's IR (`xcrun metal -c`, then `metal-opt -S`) keeps the
module's 87 functions apart and marks the `marchBody` call and the matrix products `fast`; the pipeline's own optimiser and
the GPU back end are not visible.

### The guard

- **`scripts/lib/march-depth-guard.mjs`** now holds the rule the head-split gate had inline (the same arithmetic),
  with unit tests on synthetic frames (`march-depth-guard.test.mjs`: a texel at the origin's depth, one behind the
  camera, one off every box each fail). (That was the guard as round 2 left it, counting the origin's depth only
  among texels already judged bad. The merge put round 3's guard into the module: "The merge", below.)
- **`head-split-gate.mjs` fails on build A**, run again for this (`ONLY=S,O`): "49 lie behind the camera and 0
  outside every actor's proxy box; 49 of those at the world origin's depth; the first {capture 2, texel [208, 69],
  clipDepth 1.0107716, distance -9.741, originDepth 1.0107717}". O fails with it (9 texels of the still half moved).
- **`axe-gate.mjs` has the guard too** (26 checks), at every screenshot but S's: the first-person axe and hands are
  marched into the same target and have no actor's box. (Corrected in the merge: they are meshes and are not in the
  target, S's frames pass the guard and are guarded now; below.) **It does NOT fail on build A**: none of its ten guarded
  frames puts a faulty cell in view (430 557 body texels, 0 bad). It is there for what else can put a texel where no
  body is, not as a second detector of this fault.

### Left open

- **A `return` after the miss `discard`** (`trace.wgsl.ts`, `MARCH_TRACE_POST`). Not landed: it changes the shader
  of every body and wants its own check set. For it: it takes the missed fragments out of the tail, which removed
  every silhouette cell of the fault, and on the shipped block the three captures are the shipped ones to the bit
  (hit mask, colour and depth, 0 texels differ). Every missed fragment of every proxy box runs the full post-hit
  chain today; what that costs was not measured. The refine twin's three `discard`s have no `return` either.
- **What takes the call in the three inside cells** of the three-quarter frame.
- **Other helpers under per-fragment conditions.** The shipped shader shows no bad texel in any gate capture; nothing
  says another function could not behave as `bodyLights` did. The guard is what watches for it.
- **Reporting it upstream** needs a reduction that stands alone in Metal; none was made.

### The check set

No WGSL text changed in what landed (comments outside the shader strings, a test, the gates' scripts), so
`march-golden` passes without `-u` and the census, `march-hash` and the boot pair were not run. Every faulty and
probing build above was a scratch edit, reverted by name.

| Check | Result |
| --- | --- |
| `march-golden` (no `-u`) | passes: the three march exports are unchanged |
| `head-split-gate.mjs` | **79 checks, 0 failed**; the guard through the shared module reads what it read inline: 0 of 7 545 127 body texels over 227 captures |
| `axe-gate.mjs` | **26 checks, 0 failed** (the 25 and the guard: 0 of 430 557 body texels over 10 screenshots) |
| `cut-wound-gate.mjs` | 30 checks, 0 failed |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree (`--exclude '**/cut-wound.test.ts'`, with `scripts/lib/march-depth-guard.test.mjs`) | 512 files, 7474 tests passed, 1 skipped |

### The merge: one guard for both gates (2026-10-05)

The bisect forked before the wet film's round 3, so the two lines each held a depth guard: the bisect's in the shared
module (round 2's rule, moved), round 3's inline in the head-split gate (the tightened one). Merged, the module is
the home and round 3's rule is the rule.

- **`scripts/lib/march-depth-guard.mjs`** holds: the pure judge `depthGuardTexels(target, probe)` -> `{ texels,
  behind, outside, originRun, worst }` (the origin arm over EVERY body texel as the largest bit-equal run; a live gib
  chunk's sphere a bound beside the actors' boxes); the constants `DEPTH_SLACK`, `DEPTH_SLACK_FAR`, `DEPTH_ORIGIN`,
  `DEPTH_ORIGIN_RUN`, `DEPTH_CHUNK`; the page probe `DEPTH_GUARD_PROBE` (with the chunks; `[]` on a page that has no
  `chunkStats`); a run's totals `depthGuardTotals()` / `depthGuardAdd(totals, result, probe, name)`, its verdict
  `depthGuardOk` and line `depthGuardLine`; and the positive control `depthGuardControl()` with `depthGuardControlOk`
  and `depthGuardControlLine`. Its tests (`npx vitest run scripts/lib/march-depth-guard`: 14 tests) hold each arm,
  the run inside a body's box that the first rule let through, a surface really crossing the origin's depth (no
  run), the chunk bound, the totals and the control.
- **`head-split-gate.mjs`** keeps a two-line wrapper and its two checks (the control, the run). No guard logic is
  left in it. It is 80 checks, as round 3 left it, and every check line is the same to the character as before the
  merge.
- **`axe-gate.mjs`** uses the same calls and gains the control: 27 checks (the 25, the control, the guard). Its guard now covers S's three
  real-swing screenshots too. The bisect left them out as "the first-person axe and hands are marched into the same
  target"; they are meshes on the default layer (`game-axe.ts`, `game-arms.ts`) and are not in it, and with the guard
  on those three frames alone it read 95 739 body texels, 0 bad, 0 chunks live.
- **The two `bodyLights` pins.** The bisect's structural pin (every `bodyLights(` of the march and its refine twin
  sits directly inside one block whose condition reads only `lightListCfg`) replaced the count-of-2 tripwire; the
  merge kept it alone. Round 3's tests (the film's lean, `gain` 0 against the build without the block) merged beside
  it untouched.
- **What the merge made stale, and was brought up to date:** the spec's 10.7 and 10.8, HANDOFF and the two task pages
  still described the film of the build before round 3 (`lumpTilt` 3.2, 5.05% / 1.08%, "keep, raise the gain or turn
  off") and the gates at 79 and 26 checks. They now give the shipped film (B), the owner's pending pick from
  `look/14-wet-variants.jpg`, and 80 and 27.

| Check, on the merge | Result |
| --- | --- |
| `march-golden` (no `-u`) | passes: the snapshot is round 3's; the bisect changed no WGSL text |
| `march-hash` | no pin moved (`d7392d52…` / `76bd51aa…`, `0c71e712…` / `bf6836cd…`, `470ff0b3…` / `f618070e…`) |
| `head-split-gate.mjs`, twice | **80 checks, 0 failed** each, identical; the guard: 0 of 7 545 127 body texels over 227 captures, no chunk live, the largest bit-equal run at the origin's depth 0 |
| `axe-gate.mjs` | **27 checks, 0 failed**; the guard over all 13 screenshots, S's three among them: 0 of 572 265 body texels |
| `cut-wound-gate.mjs` | 30 checks, 0 failed |
| `tsc --noEmit` | the `node:crypto` error only |
| the whole tree (`--exclude '**/cut-wound.test.ts'`) and the module's tests | 511 files, 7468 tests passed, 1 skipped; the module's file, 14 tests passed (512 files in all) |

