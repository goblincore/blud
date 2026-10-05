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
`continue` in place of the compare-swap sort (fewer live vec3s across the slot body, at the price of the exact
ascending-cap skip), and flattening the pieces into the slot loop (one loop level instead of two).

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
