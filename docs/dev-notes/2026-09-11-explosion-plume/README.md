# The explosion: from a round fireball toward a mushroom plume

**Date:** 2026-09-11 · **Branch:** `claude/dynamite-weapon-slot` (worktree)
**Owner brief:** *"the current one is kinda like a big round fireball but in the
original its more like a little mushroom cloud"*, with `?explosionfx=atlas` —
the extracted Blood SEQ — named as the reference to match.

**Nothing here has been LOOKED AT by the agent that wrote it.** Every number
below is a measurement. Whether it now reads as the owner's mushroom is his
call, and the PNG pairs are written for it.

---

## 1. What the old shape actually was — and the size bug hiding under it

Measured, not guessed. The burst is four meshes in one group (`explosion-vfx.ts`):

| layer | quads at default | what it is |
| --- | --- | --- |
| fire | 14 | camera-facing billboards (up locked to world +Y for a ground burst) |
| smoke | 8 | same basis, drawn first so dark smoke never eats the hot core |
| embers | 12 | velocity-aligned streaks, CPU-stepped and pooled |
| shockwave | 48 | one annulus, flat on the floor for a ground burst |

**`?fxsize` WAS APPLIED TWICE ON THE PROCEDURAL PATH.** `game-main.ts` set the
module's own `fireScale` to `fxSize` *and* `scaleBurstVisual` multiplied the
resolver's `heightM` by it, so the procedural burst took it twice
(0.42 × 0.42) while the atlas took it once. At the shipped knobs that is a
0.69 m procedural burst against a 1.65 m atlas quad — **2.38× linear, 5.7× by
area** — so no comparison between them meant anything. The stand-in had a THIRD
convention (it was handed the unscaled height). One multiplier now, all three
arms, and `sdf-explosion-fx-shot.mjs` can be run in each.

**WHY IT WAS A BALL — four terms, none of them size:**

1. **One isotropic spread factor.** The emit site computed a single `spread`
   from the envelope's `radius` and used it for x, z **and** y. Every billboard
   was displaced self-similarly, so the cloud could only ever be a sphere about
   its own centre at any size or count.
2. **`stretchY >= 1` in both envelopes** — fire 1 → 1.95, smoke hardcoded
   `1 + 0.5·t`. Everything in the effect was TALLER than it was wide. A mushroom
   cap is the opposite, so no amount of tuning could reach the shape.
3. **A uniform-in-the-unit-ball direction.** A ball's volume is ∝ r³, so most
   billboards land near the middle whatever the envelopes do. The cap stayed
   centre-weighted.
4. **No role.** All 14 fire billboards ran the same envelope, so there was no
   column and no cap — just fourteen identical discs at different ages.

Two more scale bugs in the same vein: the shockwave's speed is absolute (9 m/s),
so its front reached **4.2 m — 12× the fireball's own half-height**; and the
embers' speeds are absolute (3.5–14.5 m/s), so sparks crossed ~4 m, ~11× the
plume they were thrown out of. Only the fire, the smoke and the ring's START
radius scaled with the burst.

## 2. What changed

- **Height knobs are the silhouette.** `plumeNeckH` (1.35) and `plumeCapH`
  (2.0) are the height each layer's rise ENDS at, in half-heights, so the
  silhouette is stated in the tuning rather than deduced from a curve plus a
  clamp. The gap between them is the stem.
- **Horizontal and vertical are separate terms.** Each layer's envelope now
  returns `flare` (horizontal) beside its rise. The fire's NECK converges
  (1.15 → 0.3, a column out of the crater); the smoke CAP rolls outward
  (0.3 → 1).
- **`flatten`.** The smoke and the fire's cap flatten toward `capFlatten` /
  `capFireFlatten` at the end of life — the one place this effect is allowed to
  be WIDER than tall, and the term that makes the top a cap.
- **A fire role.** `fireCapShare` (0.5) of the fire billboards take
  `capFireEnvelope`: they spawn out on the rim, climb to `plumeCapH`, roll
  outward and flatten. Without a bright layer up top the plume was bottom-heavy
  however the smoke was tuned — the smoke is deliberately dim (`?fxsmoke` 0.38,
  the owner's own call to keep the gibs visible), so it cannot carry the shape.
- **The smoke spawns on a rim.** Azimuth on the unit circle, small vertical
  component: the cap is a hoop that rolls, not a centre-weighted cloud.
- **The ring and the sparks are bounded.** `ringReachH` (1.4 half-heights)
  clamps the front's reach; `emberSpeedPerH` (4.5) replaces the absolute m/s
  ember speed. Measured on the differential capture, the 2.4-half-height ring
  put **75k of the burst's 93k changed pixels** in a flat band across the bottom
  of the frame: the ring WAS the explosion as far as the frame was concerned.
- **`?fxplume=0` is the A/B**, and it is FOUR settings, not one. `plumeMix`
  alone blends the envelope terms and was measured NOT to move the silhouette
  (cap/stem 20.6 against 21.8); the switch therefore also drops the fire's cap
  role and un-flattens both caps.

## 3. What was measured, and what could not be

`scripts/sdf-explosion-fx-shot.mjs` now reports a **silhouette profile** beside
its footprint: the mean changed-pixel count per row in the top quarter of the
changed region (the CAP) against the bottom quarter (the STEM), and the
centroid's height. The intent is the one thing the existing metrics cannot
separate — a ball and a plume of equal volume have the same footprint, and
differ only in WHERE THE MASS IS.

**⚠ It is not stable across boots, and that is a trap.** The same arm at the
same knobs reported cap/stem **21.8** on one run and **0** on the next. The
cause: `step(6)` advances the game's fixed step, but the render loop keeps
running in real time, so the wall-clock gap between `spawnExplosionFx` and the
readback decides how far into its ~1 s life the burst is when it is
photographed — and a plume at 0.1 s and one at 0.5 s have completely different
silhouettes. The numbers are a DESCRIPTION of one frame, never an arm
comparison. Pinning the burst to an age is what a shape gate would need, and
this rig does not do it.

What the numbers did establish, arm by arm at 3.4 m and one fixed age:

| arm | changed | box | mean luma |
| --- | --- | --- | --- |
| procedural (plume) | 5.4% of frame | 685×283 | 27.9 → 138.5 |
| procedural (`?fxplume=0`) | 5.3% | 664×283 | 27.6 → 139.1 |
| atlas (the reference) | 12.6% | 735×426 | 44.4 → 176.3 |

and the height the mass sits at, which is the one number that survives as a
stable measurement (it repeats to under a pixel across boots: 456.8 twice for
the procedural arm, 331.9 twice for the atlas).

**THE OBVIOUS CONCLUSION FROM IT WAS WRONG, AND THE RIG NOW CARRIES THE
CORRECTION.** Whole-burst, the procedural centroid is 457 against the atlas's
332, which reads as "the reference's explosion happens in the air and ours
happens at the crater". It does not: the ground SHOCKWAVE RING is a large
low-lying annulus and it dominates the changed area, so a whole-burst centroid
mostly measures the ring. Drop it (`FX_TUNING='{"ringOpacity":0}'`) and the same
arm reads:

| arm | mass centroid at 3.4 m |
| --- | --- |
| plume alone (ring off) | **362** of 600 |
| atlas (the reference) | **332** |

30 px of 600. The plume's vertical mass distribution is already where the
reference's is, and there is no measured case for raising it — which is worth
saying plainly, because a plausible-looking number nearly caused a change that
would have lifted the flame base off the floor.

A CAP-BAND vs STEM-BAND split was removed from the rig for the same reason, in
the other direction: it looked like a shape measurement and was not one. Its
band boundaries come from the bounding box, so a single stray changed pixel at
the edge re-cuts them — the same arm at the same knobs read 7.45 on one boot and
0.26 on the next.

## 3b. The shape, in metres — a second rig, because the first cannot see it

Two rounds of trying to read the plume's SHAPE off a screenshot produced two
confident, wrong numbers (the ring's centroid, and a band split re-cut by the
bounding box). So the module now reports its own geometry instead, and
`scripts/sdf-plume-shape.mjs` prints it:

> `explosionFx().layerExtents` — per layer (fire / smoke / ember / ring), the
> world box its billboards **drew** this frame and the mean height of their
> bottom and top **quartiles**, plus `burstHalfHeightM`, the unit the whole
> burst is laid out in.

Deterministic, in metres, no GPU readback, nothing to reorder between runs.
A ground burst locks its billboard's up axis to world +Y, so the vertical extent
is exact; the box is the **billboard** extent, which is the layout and not the
visible size (see the caveat below).

At the shipped knobs (`?fxsize=0.42`, half-height 0.84 m; the atlas reference is
a camera-facing quad **1.68 m tall x 1.29-2.01 m wide**):

| age | layer | n | width x height x depth | mass mean / low / high quartile |
| --- | --- | --- | --- | --- |
| 0.10 s | ring | 1 | 2.35 x 0 x 2.35 | 0.02 |
| 0.10 s | ember | 12 | 1.10 x 0.43 x 0.71 | 0.63 / 0.49 / 0.78 |
| 0.20 s | fire | 1 | 0.53 x 0.55 x 0.53 | 0.77 |
| 0.40 s | fire | 14 | 1.47 x 1.52 x 1.36 | 1.02 / 0.85 / 1.18 |
| 0.70 s | fire | 14 | 2.51 x 2.33 x 2.14 | 1.47 / 1.06 / 1.79 |
| 1.10 s | fire | 13 | **2.72 x 2.18** x 2.54 | **1.92** / 1.44 / 2.26 |
| 0.70 s | smoke | 8 | 3.66 x 3.20 x 3.85 | 1.14 / 0.76 / 1.53 |
| 1.10 s | smoke | 6 | **3.75 x 3.10** x 3.81 | 1.76 / 1.34 / 2.17 |

Four properties are gated, and they are what "a plume, not a ball" means as
arithmetic: the fire's **mass rises** through its life (0.77 m -> 1.92 m), the
layer has real vertical **spread**, the smoke is a **late bloomer** (its first
quad lands after the fire's), and the cap ends **wider than tall** (3.75 x 3.10).

**THE CONTROL ARM IS THE POINT.** Run with `FX_QS='&fxplume=0'` and the same rig
reports a fire 1.21 x **2.71** m — a narrow column — and a cap 2.72 x **3.75** m,
TALLER than wide, i.e. no flatten at all. The switch is therefore real in
geometry, not just in the tuning read-out.

**THE CAVEAT THAT KEEPS THIS HONEST.** These are billboard extents. The fire
material's round falloff (`edge = 1 - smoothstep(0.22, 1.0, r)`) means the
VISIBLE fire is well inside them, so this rig measures the LAYOUT and cannot
answer "is it bigger than the reference on screen" — the reference is also one
opaque sprite inside its quad, not a soft additive cloud. Sizing remains the
owner's call on the PNGs, with `?fxsize` as the lever.

## 3c. The AIR burst, measured the same way — and it is a fireball, correctly

The reference has TWO sequences: the ground SEQ is the mushroom the owner asked
for, and the air SEQ is a fireball. Both were measured through the same rig
(`PLUME_KIND=air`), at the same half-height:

| at the end of life | fire silhouette | smoke silhouette | fire mass |
| --- | --- | --- | --- |
| ground (`orient: 'plume'`) | 2.72 x 2.18 m (wider than tall) | 3.75 x 3.10 m (flattened) | rises 0.77 -> 1.92 m |
| air (`orient: 'ball'`) | **1.47 x 1.52 m (a ball)** | 1.88 x 1.85 m (cubic) | rises to 0.58 m above the detonation |

So the shape terms differentiate the two references the way the reference art
does: a ground burst becomes a plume with a flattened cap, an in-hand detonation
stays a fireball. Worth stating because it is the opposite of what a
"make it a mushroom" change could easily have broken — the plume terms apply to
both orientations, and for the air case the billboard basis is the CAMERA's, so a
flatten squashes along the camera's up rather than the world's and leaves the
burst round.

## 4. Open

- **The owner's look call**, on `/tmp/explosion-fx*/b-3.4m-burst.png` against
  the atlas pair. That is the whole verdict — shape and colour, not height,
  which is measured and matches.
- The atlas path renders the Blood SEQ as a single camera-facing quad whose
  bottom is pinned to `at.y`; the procedural path is a 3D plume. They can be
  matched in silhouette statistics, never in structure.
