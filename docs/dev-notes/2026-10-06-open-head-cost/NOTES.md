# The open split head's frame cost: where it goes, and what was cut (2026-10-06)

The owner, on the head split's cost (2026-10-05): "we can figure out how to optimize later". This is that pass.

- **Branch:** `claude/open-head-cost`, off `claude/head-cleaving-effect-ef9515` at `37943f97` (PR goblincore/blud#31 was
  still open).
- **The feature:** [the head split's handoff](../2026-10-04-head-split/HANDOFF.md), spec
  [§10](../../superpowers/specs/2026-10-04-axe-and-head-split-design.md).
- **Short version.** An open head costs what it does because it evaluates 2 to 2.5 times the closed head's
  primitives, and three quarters of that excess came from its BOUNDS, not from the three-piece field. Two exact
  changes to the bounds are kept (the frame is the same to the bit, or the same solid inside a smaller hull). None
  of the five optimisations the brief listed was built as written: each was measured first, and the measurements
  pointed at the bounds instead. §4 has each one's numbers and reason.

| | Before | After |
| --- | --- | --- |
| Open minus closed, `middle` both sides, 0.6 m, on the shipped shader (medians of 6 interleaved rounds) | +6.15 ms | **+4.65 ms** |
| The same in the ablation build's session (8 rounds) | +6.6 ms | **+5.2 ms** |
| The same, `middle` one side (8 rounds) | +5.6 ms | **+3.6 ms** |
| Primitive evaluations of the ray walk, `middle` both, 0.6 m (the closed head: 1.475M) | 3.693M | **2.359M** (−36%) |
| The same, `middle` one side (1.492M) / `face` (1.712M) | 3.124M / 3.385M | **2.206M** (−29%) / **2.683M** (−21%) |
| The same at 2 m, both / one / face | 396k / 378k / 485k | **291k** (−27%) / **309k** (−18%) / **435k** (−10%) |
| Marched texels over the closed head's, `middle` both, 0.6 m | 12 124 | **948** |

Closed bodies are untouched (the six `march-hash` pins did not move). The gates and the check set: §6.

## 1. The instrument

**The switches** (`src/lab/sdf-zombie/webgpu/split-ablate.ts`), all off by default:

| Switch | How | What it does |
| --- | --- | --- |
| `?splitablate` | compile time, as `?limbs` | the march carries run-time switches, read from the split record's spare lane (`REC_SPLIT_R.y`). Without the flag every string is empty and the shipped march is the same to the byte (`march-golden` did not move; `split-ablate.test.ts` pins it). |
| `__sdfGame.splitAblate({ mask })` | run time, on a `?splitablate` page | `SPLIT_ABL` bits: one field evaluation per sample (1), analytic normals in the region (2), the film's block skipped (4), the slot folded as a closed one (8), the post-hit split state off (16), no wound folded into the field (32; closed slots too). |
| `__sdfGame.splitAblate({ boundsOff })` | run time, any page | `SPLIT_BOUND` bits: a bound stays the closed head's: the proxy box (1), the tile groups and the cluster row (2), the outer hull (4), the occluder hull (8). And the two changes of this pass switched back: the grown tile sphere as the per-step cull (16), the outer hull's loose copies (32), the tight copies without the lip pad (64). |
| `?splitfilm=0` | compile time | the wet film's block is not written (`SPLIT_SHADE.glisten.gain` 0). |

Every leg but "closed" and "open" draws a wrong frame on purpose: cost only.

**The driver** (`scripts/open-head-cost.mjs`). The head-split gate's boot (the bare ring page, frozen zombies, its
pins), a fresh zombie per scenario, the head centred at 0.6 m and 2 m, and the legs INTERLEAVED: every round
measures every leg once, in a rotated order. Two measures per leg:

- **`timeDraws(N)`**: the median ms of N still frames, each drawn then fenced (CPU + GPU; N 120 unless said). The
  1-minute load average is read before and after; a measure waits for the load to fall to 6 and is taken again if it
  ends above 8.
- **The census**: the march's own counters (debug modes 13 and 14, read off the float march target and summed over
  the frame): texels marched, texels hit, steps, primitive evaluations, wound rows, for the ray walk and for the
  post-hit chain (the normal's four taps, the probes). **The counters do not depend on the machine's load**, and
  they are the measure this note leans on.

**The machine was not quiet, and the timings show it.** Two other agent sessions were measuring on it at the same
time (a first run of this driver landed inside a load average of 35 to 70 and is not used). The three sessions then
shared a lock (`/tmp/blud-gpu-timing.lock`: `mkdir` to take, `rm -rf` on exit), one heavy job at a time. Even so,
with the load between 3 and 7 the single measures of one leg spread by 3 to 25 ms: desktop apps (a window server at
40 to 50% of a core, two Electron apps, a container VM) put bursts into the 3 to 7 s a measure takes. So for
timings this note gives the MINIMUM of the rounds (the least disturbed measure) beside the median and the spread,
and at 2 m, where the whole effect is about a millisecond, it gives no timing verdict at all. No frame timing taken
above a load of 8 is in any table.

**What "closed" is.** As in the gate's scenario C: the head closed again (`forceSplit` at 0), which keeps the
split's two face cuts. Open minus closed is the split alone.

## 2. Attribution

Taken on the tree as it stood before this pass (`37943f97`'s behaviour: the timings on the harness commit
`43086ae5`, whose shipped march is byte-identical; the census with the pass's two bounds changes switched back,
`BASE_BOUNDS=48`). One zombie of the bare ring page, its head centred, a 400 × 300 march target, `middle` at its full
angle: both sides (0.55 rad each), and one side (0.9 rad, offset 0.04 m).

### 2.1 The census at 0.6 m (does not depend on load)

"Prims" are primitive evaluations (`foldGroup`'s, the owner re-folds included), "rows" are wound rows past
`applyWounds`' reach test. "Walk" is the ray walk over every marched texel; "post-hit" is what the normal's four taps
and the probes add on hit texels.

**`middle`, both sides, 0.6 m**

| Leg | marched texels | hit | steps | walk prims | walk wound rows | post-hit prims | post-hit rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (a) closed again | 45702 | 30916 | 262.1k | 1.475M | 534.0k | 1.157M | 366.6k |
| (b) open | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.515M | 408.4k |
| (c) one field evaluation per sample | 57826 | 30544 | 392.4k | 2.838M | 897.6k | 1.334M | 354.4k |
| (c') the slot folded closed (bounds still open) | 57826 | 30916 | 334.8k | 2.403M | 709.1k | 1.354M | 359.9k |
| (d) every bound the closed head's | 45702 | 30587 | 305.4k | 2.033M | 755.6k | 1.307M | 413.1k |
| (d) tile groups and cluster row closed | 57826 | 30588 | 399.8k | 2.935M | 1.070M | 1.289M | 406.9k |
| (d) both hulls closed | 45702 | 30587 | 305.4k | 2.603M | 844.3k | 1.533M | 414.5k |
| (d) outer hull closed | 45702 | 30587 | 305.4k | 2.603M | 844.3k | 1.533M | 414.5k |
| (d) occluder hull closed | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.515M | 408.4k |
| (d) proxy box closed | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.515M | 408.4k |
| (e) analytic normals in the region | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.515M | 408.4k |
| (f) the film skipped (run time) | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.515M | 408.4k |
| (g) skull follow 0 | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.515M | 408.4k |
| post-hit split state off | 57826 | 30588 | 399.8k | 3.693M | 1.159M | 1.516M | 408.6k |
| the field alone: (d) + (e) + (f) + (g) + post-hit off | 45702 | 30587 | 305.4k | 2.033M | 755.6k | 1.308M | 413.3k |
| closed, no wound in the field | 45702 | 31008 | 256.8k | 1.453M | 0.0k | 1.160M | 0.0k |
| open, no wound in the field | 57826 | 30805 | 391.3k | 3.555M | 0.0k | 1.525M | 0.0k |

**`middle`, one side, 0.6 m**

| Leg | marched texels | hit | steps | walk prims | walk wound rows | post-hit prims | post-hit rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (a) closed again | 49682 | 30986 | 263.8k | 1.492M | 264.7k | 1.353M | 213.4k |
| (b) open | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.869M | 240.8k |
| (c) one field evaluation per sample | 61170 | 31691 | 376.2k | 2.740M | 407.6k | 1.700M | 217.4k |
| (c') the slot folded closed (bounds still open) | 61170 | 30987 | 339.7k | 2.474M | 349.4k | 1.676M | 212.5k |
| (d) every bound the closed head's | 49682 | 31605 | 273.1k | 1.754M | 311.1k | 1.529M | 240.1k |
| (d) tile groups and cluster row closed | 61170 | 31700 | 378.5k | 2.474M | 435.7k | 1.544M | 239.9k |
| (d) both hulls closed | 49682 | 31605 | 273.8k | 2.191M | 331.7k | 1.848M | 241.1k |
| (d) outer hull closed | 49682 | 31605 | 273.8k | 2.191M | 331.7k | 1.848M | 241.1k |
| (d) occluder hull closed | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.869M | 240.8k |
| (d) proxy box closed | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.869M | 240.8k |
| (e) analytic normals in the region | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.869M | 240.8k |
| (f) the film skipped (run time) | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.869M | 240.8k |
| (g) skull follow 0 | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.869M | 240.8k |
| post-hit split state off | 61170 | 31700 | 379.7k | 3.124M | 463.0k | 1.870M | 240.8k |
| the field alone: (d) + (e) + (f) + (g) + post-hit off | 49682 | 31605 | 273.1k | 1.754M | 311.1k | 1.529M | 240.1k |
| closed, no wound in the field | 49682 | 31008 | 260.8k | 1.480M | 0.0k | 1.353M | 0.0k |
| open, no wound in the field | 61170 | 31845 | 375.2k | 3.046M | 0.0k | 1.873M | 0.0k |

Legs (e), (f), (g) and the post-hit switch do not move the walk, as they should not. That (e) does not move the
post-hit counters either is the finding of §4.2: the finite-difference taps still run.

### 2.2 The same at 2 m

**`middle`, both sides, 2 m**

| Leg | marched texels | hit | steps | walk prims | walk wound rows | post-hit prims | post-hit rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (a) closed again | 12660 | 9702 | 42.4k | 207.5k | 57.4k | 279.0k | 74.3k |
| (b) open | 13748 | 9679 | 53.3k | 396.3k | 105.7k | 357.8k | 79.5k |
| (c) one field evaluation per sample | 13748 | 9675 | 52.7k | 324.9k | 83.7k | 337.1k | 73.3k |
| (c') the slot folded closed (bounds still open) | 13748 | 9710 | 48.6k | 293.8k | 71.1k | 338.9k | 73.9k |
| (d) every bound the closed head's | 12660 | 9671 | 45.5k | 252.3k | 74.5k | 296.2k | 80.0k |
| (d) tile groups and cluster row closed | 13748 | 9679 | 53.3k | 323.5k | 100.7k | 294.3k | 79.5k |
| (d) outer hull closed | 12660 | 9671 | 45.5k | 304.8k | 79.6k | 359.4k | 80.0k |
| closed, no wound in the field | 12660 | 9700 | 42.2k | 206.7k | 0.0k | 278.9k | 0.0k |
| open, no wound in the field | 13748 | 9688 | 52.8k | 388.7k | 0.0k | 358.2k | 0.0k |

**`middle`, one side, 2 m**

| Leg | marched texels | hit | steps | walk prims | walk wound rows | post-hit prims | post-hit rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (a) closed again | 14887 | 9701 | 44.6k | 219.0k | 29.2k | 355.3k | 53.8k |
| (b) open | 16114 | 9752 | 54.4k | 377.6k | 45.7k | 473.7k | 56.7k |
| (c) one field evaluation per sample | 16114 | 9740 | 54.2k | 345.6k | 41.0k | 454.4k | 54.0k |
| (c') the slot folded closed (bounds still open) | 16114 | 9703 | 50.6k | 319.2k | 35.9k | 453.4k | 53.7k |
| (d) every bound the closed head's | 14887 | 9722 | 46.0k | 242.2k | 33.6k | 371.7k | 56.6k |
| (d) tile groups and cluster row closed | 16114 | 9752 | 54.4k | 294.6k | 43.9k | 371.8k | 56.7k |
| (d) outer hull closed | 14887 | 9722 | 46.0k | 307.0k | 35.0k | 473.2k | 56.6k |
| closed, no wound in the field | 14887 | 9700 | 44.5k | 218.4k | 0.0k | 355.1k | 0.0k |
| open, no wound in the field | 16114 | 9759 | 54.1k | 372.2k | 0.0k | 473.7k | 0.0k |

### 2.3 The timings at 0.6 m

Four rounds, every leg once a round in a rotated order, `timeDraws(120)`. Read the minimum; §1 says why.

**`middle`, both sides, 0.6 m**

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 22.3 | 24.6 | 11.0 | -5.6 | 4 |
| (b) open | 27.9 | 30.5 | 4.9 |  | 4 |
| (c) one field evaluation per sample | 25.4 | 29.3 | 16.0 | -2.5 | 4 |
| (c') the slot folded closed (bounds still open) | 23.0 | 24.9 | 16.4 | -4.9 | 4 |
| (d) every bound the closed head's | 24.7 | 26.0 | 15.5 | -3.2 | 4 |
| (d) tile groups and cluster row closed | 26.2 | 26.5 | 2.7 | -1.7 | 4 |
| (d) both hulls closed | 26.0 | 26.3 | 3.4 | -1.9 | 4 |
| (e) analytic normals in the region | 28.3 | 29.0 | 3.3 | +0.4 | 4 |
| (f) the film skipped (run time) | 27.8 | 28.9 | 5.3 | -0.1 | 4 |
| (g) skull follow 0 | 27.4 | 28.6 | 5.1 | -0.5 | 4 |
| post-hit split state off | 27.9 | 28.7 | 4.0 | +0.0 | 4 |
| the field alone: (d) + (e) + (f) + (g) + post-hit off | 24.3 | 24.6 | 5.8 | -3.6 | 4 |
| closed, no wound in the field | 19.8 | 20.4 | 2.8 | -8.1 | 4 |
| open, no wound in the field | 24.9 | 28.5 | 9.6 | -3.0 | 4 |

Load average over the measures: 3.3 to 6.9. An untouched head (no face cuts), one measure: 25.0 ms.

**`middle`, one side, 0.6 m**

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 20.5 | 25.1 | 12.6 | -5.8 | 4 |
| (b) open | 26.3 | 30.8 | 9.1 |  | 4 |
| (c) one field evaluation per sample | 24.7 | 26.3 | 12.1 | -1.6 | 4 |
| (c') the slot folded closed (bounds still open) | 23.1 | 25.9 | 10.7 | -3.2 | 4 |
| (d) every bound the closed head's | 22.7 | 24.1 | 5.5 | -3.6 | 4 |
| (d) tile groups and cluster row closed | 24.9 | 25.5 | 16.3 | -1.4 | 4 |
| (d) both hulls closed | 23.8 | 26.8 | 25.0 | -2.5 | 4 |
| (e) analytic normals in the region | 26.6 | 30.1 | 23.0 | +0.3 | 4 |
| (f) the film skipped (run time) | 25.8 | 32.5 | 27.1 | -0.5 | 4 |
| (g) skull follow 0 | 25.1 | 31.6 | 24.9 | -1.2 | 4 |
| post-hit split state off | 25.7 | 32.5 | 22.5 | -0.6 | 4 |
| the field alone: (d) + (e) + (f) + (g) + post-hit off | 22.5 | 25.1 | 8.3 | -3.8 | 4 |
| closed, no wound in the field | 19.8 | 21.6 | 7.2 | -6.5 | 4 |
| open, no wound in the field | 24.3 | 26.5 | 13.3 | -2.0 | 4 |

Load average over the measures: 3.2 to 6.5. An untouched head (no face cuts), one measure: 19.6 ms.

**At 2 m the timings decide nothing.** Open against closed read, as minima, 15.1 against 12.9 ms (both sides) and
16.1 against 13.8 ms (one side), about +2.2 ms, with single measures of one leg spread over 5 to 8 ms and several
legs that only remove work reading slower than open. The census above is the measure at 2 m: an open head walks
1.9 times (both) and 1.7 times (one) the closed head's prims there, and takes 26% and 22% more steps.

### 2.4 What the table says

1. **The cost is primitive evaluations.** An open head walks 2.5 times the closed head's prims with both sides open
   and 2.1 times with one (3.693M against 1.475M; 3.124M against 1.492M), takes 53% and 44% more steps, and walks 2.2
   and 1.7 times the wound rows. Its post-hit chain costs 31% and 38% more prims. Fitting the legs that only change
   counters (closed against no-wounds, tiles off, hulls off) gives about 1.5 ns a prim and 2.4 ns a wound row on
   this GPU, and the open head's extra 2.58M prims and 0.67M rows then come to about 5.5 ms: the +5.6 ms measured.
2. **Three quarters of the excess is the bounds, not the field.** With every bound the closed head's and the field
   open (leg d), the walk is 2.033M prims: +0.56M over closed, a quarter of the +2.22M. The brief put the field at
   +3.5 to +4 ms and the bounds at +2.4 ms; those were B4's and B5's deltas in the order the tasks landed, and the
   second included the first's work re-done on every new ray. Taken apart:
   - **The outer hull's turned copies: 12 124 more marched texels than the closed hull for ONE more hit texel**
     (both sides; 11 488 for 95 with one side), 94k more steps and 1.09M prims. The hull covers the skull with one
     sphere of its largest semi-axis (0.158 m, for a head 0.090 m wide), so from the front the closed hull already
     holds the opened halves, and the two turned copies are a ring of rays that march the three-piece field and
     miss.
   - **The grown tile groups: 0.76M walk prims and 0.23M post-hit prims, with no change in steps or hits.** A group
     that holds turning flesh grows to hold the whole hold ball (the head's three groups go from 0.12 to 0.15 m to
     0.26 to 0.28 m; one neck group grows too), and `mapBody`'s per-step cull read that grown sphere at a piece's
     un-warped point, where it never culls.
   - **The proxy box and the occluder hull: nothing** in these views (the counters are the open leg's to the unit).
3. **The field itself:** one evaluation a sample (leg c) saves 0.86M walk prims and 0.26M rows, about 2.5 ms. Along
   a frame's rays the piece loop evaluates 1.41 pieces a step with both sides open and 1.29 with one (§4.1), against
   the 1.64 and 1.33 the twin test counts at points drawn uniformly in the region.
4. **Wounds.** With no wound folded into the field the closed head drops 2.5 ms (both sides' zombie) and 0.7 ms
   (one side's), the open head 3.0 and 2.0 ms: the two face cuts cost every head they are on, and an open head pays
   them on about twice the rows. That is the cut
   excess pass's cost, which another session is cutting at its root (an exact early exit for a cut row; see §5).
5. **Normals, the film, the skull, the post-hit state:** none is resolved. As minima against open, both sides /
   one side: analytic normals +0.4 / +0.3 ms (never faster), the film −0.1 / −0.5, the skull −0.5 / −1.2, the
   post-hit state 0.0 / −0.6, under spreads of 3 to 27 ms.

## 3. What was built

Two changes, each its own commit, each switchable back in one page for the measure (`SPLIT_BOUND.tileCull`,
`SPLIT_BOUND.hullOld`). Neither touches the split field or `mapBody`'s per-sample path, and a closed body takes
neither.

### 3.1 A grown tile group keeps its own sphere for the per-step cull (`01bd807d`)

- **What was wrong.** B5 grew every tile group that holds turning flesh to the smallest sphere holding it and the
  hold ball, because the binner and the per-ray test read those spheres against the WORLD ray. The tiled path's
  per-step cull (`foldGroup`, at a piece's un-warped point) read the same sphere, where the group's closed sphere is
  the exact one. Inside the hold ball a grown sphere never culls, so the head's three groups and one of the neck's
  were folded at every sample of every piece. (The per-body path was already right: its group cull reads
  `ROW_GROUP_BOUNDS`, which stays closed.)
- **The change.** A tile entry's third texel had three spare lanes. They now carry the cull sphere's OFFSET from
  the entry's own centre (`tile-cull.ts` `cullOffset`, `withCullSphere`; both binners copy it), and the preload
  rebuilds the cull sphere once per pixel as `(centre + offset, radius − |offset|)`: the largest sphere about that
  centre inside the entry's (`tile-preload.wgsl.ts`). Where the grown sphere is not the hold ball itself the two
  touch from inside and that IS the closed sphere (to a 2 µm pad for float32); where it is the hold ball, it is a
  looser sphere that still holds the closed one. Zero offset, which is every body without a split, gives the
  entry's sphere to the bit.
- **Why this shape.** No new private array, no texel read and no branch on `mapBody`'s per-sample path (the
  handoff's warning: a line there cost 0.5 ms on every closed body). The work is one `length` and two adds per tile
  entry per pixel, in the preload.
- **Exact.** The frame is the same to the bit: 0 texels of the float march target differ between the new path and
  the old one in four views (both scenarios, 0.6 m and 2 m). Steps, wound rows and hit texels do not move.
- **Census** (walk prims; post-hit prims):

  | View | Before | After | |
  | --- | --- | --- | --- |
  | `middle` both, 0.6 m | 3.693M; 1.515M | 3.348M; 1.464M | −9.4% of the walk |
  | `middle` one, 0.6 m | 3.124M; 1.869M | 2.869M; 1.820M | −8.2% |
  | `middle` both, 2 m | 396k; 358k | 375k; 353k | −5.4% |
  | `middle` one, 2 m | 378k; 474k | 358k; 469k | −5.2% |

  It recovers less than the "tiles closed" leg's 0.76M (which also un-grows what the binner and the per-ray cull
  list: an open head's pixels still list the head's groups over the whole hold ball's disc, as they must).

### 3.2 The outer hull turns a tight cover with each half (`445044e7`, `140193de`)

- **What was wrong.** §2.4: each of the body's hull spheres that holds flesh of a half got a whole turned copy, and
  the skull's one sphere is 0.158 m for a head 0.090 m wide.
- **The change** (`shell-hull-outer.ts` `ellipsoidChain`). For a prim whose solid is exactly an ellipsoid (a point
  prim with no taper, bend, box, strand or shell; on the zombie's head: the skull, the jaw, the brow and the nose),
  what turns with a half is its TIGHT cover: a sphere chain along its longest axis, of the middle semi-axis's
  radius. An ellipsoid with semi-axes a ≤ b ≤ c lies in the capsule of radius b about the segment of half-length
  c − b on its long axis (the proof is three lines, in the function's header). Every other prim turns the spheres
  it has. The spheres where the body stands are not touched: a closed body's hull is what it was.
- **The lip pad** (`SPLIT_HULL_LIP`, 15.6 mm today, from `HEAD_SPLIT.faceCalibre` and `CUT_SHADE`). The outer hull
  ignores wounds because subtraction only moves a surface inward; a cut's lip is the one thing a wound adds. The
  loose sphere had room for it (18 mm at the crown), a tight cover has none, and the face cuts sit on the very rims
  it hugs. So the tight cover is padded by the face cut's lip amplitude.
- **Spaced at a quarter of its radius, not at the radius** (the second commit). The hull's own chains are spaced
  at their radius and need 13% of inflation for it. With the lip in the pad that made the skull's cover 0.140 m
  spheres reaching 0.172 m along the long axis, PAST the loose sphere it replaces, and where a half swings far the
  copies were no smaller on screen (one side: 2.736M walk prims against 2.869M; unpadded it read 2.199M). A chain
  covers its capsule when rho² ≥ R² + (d / 2)²; at a quarter of the radius that is 0.8%, so the padded cover is
  0.125 m across and 0.157 m along. The pad is paid for by four more spheres, not by reach. The cover is taken only
  where it is slimmer than the prim's own sphere (the skull, the brow and the nose; the jaw is a sphere already).
- **Sound, not bit-equal.** A hull moves where a ray STARTS, so its samples fall differently and most hit texels
  differ in their last bits, as two builds with different bounds always have (the head-split notes, B5). What
  holds it:
  - `head-split-bounds.test.ts`: every sampled point of the opened solid is inside the hull (both presets, both
    hinges, five angles and the wobble's unequal angles; 30 000 more samples at the three full angles, the
    shallowest 6 to 7 mm inside); the chain holds its padded ellipsoid for 60 random shapes and turns, reaching no
    more than 1% past its tips.
  - The head-split gate's B scenario (the shipped path against the per-body path with every bound off): §6.
  - The frames, new hull against the first rule (`SPLIT_BOUND.hullOld`), 0.6 m: the hit mask differs by 0 / 1
    texels only in the new / only in the old frame (`middle` both, of 30 588), 2 / 3 (`middle` one, of 34 686) and
    2 / 2 (`face`, of 34 206); of the texels both hit, 100, 42 and 137 move over 0.2% in clip depth. That is the
    level two ray starts differ by on any head (the gate's B floor is 0 to 23 texels of mask and 0 to 127 of
    depth on a CLOSED head). At 2 m: 4 / 12, 1 / 4 and 10 / 4 texels of about 10 000.
  - **One thing does change, and it is the closed head's rule arriving:** the march accepts a sample within the
    pixel's footprint of a surface, so a silhouette is drawn up to a footprint fat, and only where the hull lets
    the ray march. The loose copies let an opened half's rim be fat everywhere; the tight cover trims it where its
    clearance is under the footprint, as the hull does on every closed limb. That is the 8 texels of 9 679 at 2 m.
- **Census** (the hull's first rule against this one, with §3.1 in both):

  | View | Marched texels (closed head's) | Steps | Walk prims | Wound rows | Hit texels |
  | --- | --- | --- | --- | --- | --- |
  | `middle` both, 0.6 m | 57 826 → 46 650 (45 702) | 399.8k → 310.9k | 3.348M → 2.359M (−30%) | 1.159M → 0.862M | 30 588 → 30 587 |
  | `middle` one, 0.6 m | 61 170 → 53 428 (49 682) | 379.7k → 306.8k | 2.869M → 2.206M (−23%) | 463k → 377k | 31 700 → 31 699 |
  | `face`, 0.6 m | 51 386 → 48 290 (48 172) | 336.9k → 301.4k | 3.099M → 2.683M (−13%) | 476k → 409k | 31 749 → 31 748 |
  | `middle` both, 2 m | 13 748 → 12 750 (12 660) | 53.3k → 46.0k | 375k → 291k (−22%) | 106k → 81k | 9 679 → 9 671 |

  Without the lip in the pad (`SPLIT_BOUND.hullNoLip`) the three 0.6 m views walk 2.316M, 2.126M and 2.368M prims:
  the pad costs 2%, 4% and 13%, and is kept. The copies' ring is all but gone with both sides open (948 marched
  texels over the closed hull, from 12 124); what one side and the face preset still march over the closed hull
  (3 746 and 118 texels) is the half itself.

### 3.3 Both together

**The census, before this pass against after** (one zombie's head centred, 400 × 300; the closed head in brackets):

| View | Marched texels | Steps | Walk prims | Wound rows (walk) | Post-hit prims |
| --- | --- | --- | --- | --- | --- |
| `middle` both, 0.6 m | 57 826 → 46 650 (45 702) | 399.8k → 310.9k (262.1k) | 3.693M → 2.359M, −36% (1.475M) | 1.159M → 0.862M (0.534M) | 1.515M → 1.481M (1.157M) |
| `middle` one, 0.6 m | 61 170 → 53 428 (49 682) | 379.7k → 306.8k (263.8k) | 3.124M → 2.206M, −29% (1.492M) | 463k → 377k (265k) | 1.869M → 1.801M (1.353M) |
| `face`, 0.6 m | 51 386 → 48 290 (48 172) | 336.9k → 301.4k (262.5k) | 3.385M → 2.683M, −21% (1.712M) | 476k → 409k (264k) | 1.910M → 1.855M (1.484M) |
| `middle` both, 2 m | 13 748 → 12 750 (12 660) | 53.3k → 46.0k (42.4k) | 396k → 291k, −27% (208k) | 106k → 81k (57k) | 358k → 354k (279k) |
| `middle` one, 2 m | 16 114 → 15 222 (14 887) | 54.4k → 48.5k (44.6k) | 378k → 309k, −18% (219k) | 46k → 38k (29k) | 474k → 470k (355k) |
| `face`, 2 m | 15 226 → 15 156 (15 074) | 52.3k → 50.2k (48.0k) | 485k → 435k, −10% (325k) | 42k → 38k (29k) | 586k → 582k (465k) |

Of the walk's excess over the closed head, the pass removes 60% with both sides open (2.218M → 0.885M), 56% with
one side and 42% for `face`.

**The timings** at 0.6 m: eight rounds, the five legs interleaved (closed; open; open with both changes switched
back; with each one switched back alone), `timeDraws(60)`, the load between 3.2 and 6.3.

*`middle`, both sides*

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 18.6 | 19.4 | 3.9 | -5.1 | 8 |
| (b) open | 23.7 | 24.6 | 5.3 |  | 8 |
| open, before this pass | 25.5 | 26.0 | 7.2 | +1.8 | 8 |
| open, the hull change only | 24.0 | 24.4 | 4.4 | +0.3 | 8 |
| open, the tile cull change only | 25.0 | 25.6 | 5.3 | +1.3 | 8 |

Load average over the measures: 5.3 to 6.3.

*`middle`, one side*

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 22.2 | 23.2 | 4.0 | -3.8 | 8 |
| (b) open | 26.0 | 26.8 | 9.4 |  | 8 |
| open, before this pass | 28.6 | 28.8 | 5.1 | +2.6 | 8 |
| open, the hull change only | 25.5 | 26.5 | 1.8 | -0.5 | 8 |
| open, the tile cull change only | 28.2 | 28.9 | 1.9 | +2.2 | 8 |

Load average over the measures: 3.5 to 6.

*`face`*

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 24.3 | 25.9 | 9.5 | -2.6 | 8 |
| (b) open | 26.9 | 30.1 | 14.4 |  | 8 |
| open, before this pass | 28.5 | 29.3 | 5.3 | +1.6 | 8 |
| open, the hull change only | 28.0 | 31.7 | 10.1 | +1.1 | 8 |
| open, the tile cull change only | 29.4 | 31.9 | 8.8 | +2.5 | 8 |

Load average over the measures: 3.2 to 5.9.

| Open minus closed, medians | Before | After |
| --- | --- | --- |
| `middle` both, 0.6 m | +6.6 ms | **+5.2 ms** |
| `middle` one, 0.6 m | +5.6 ms | **+3.6 ms** |
| `face`, 0.6 m | not resolved | not resolved (the rounds spread by 5 to 14 ms; as minima, 26.9 after against 28.5 before) |

- **It is the hull that the timings see.** With only the hull change in, the open head reads what it reads with
  both (24.4 against 24.6 ms; 26.5 against 26.8); with only the tile cull in, it reads what it read before (25.6
  against 26.0; 28.9 against 28.8). The tile cull's 8 to 9% of the walk's prims is about half a millisecond by the
  census's rates, under what eight rounds resolved on this machine today. It is kept because it is exact (the frame
  is the same to the bit) and costs nothing on any path.
- **The closed head is not touched by construction** (no offset, no split: §3.1, §3.2), and `march-hash` holds it
  (§6).
- **Time is not falling as fast as the prims.** −36% of the walk's prims bought −21% of the open head's delta. The
  rest of the delta is not in the counters: §5, item 3.

**On the shipped shader** (no `?splitablate`: the march's text is the release's; the bounds switches need no shader
text), six rounds of closed, open and open-as-before, `timeDraws(60)`, the load 5.4 to 6.2. This was the quietest
session of the day (spreads 0.7 to 1.9 ms) and is the best single reading of the pass:

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 18.5 | 18.6 | 0.7 | -4.1 | 6 |
| (b) open | 22.6 | 23.2 | 0.8 |  | 6 |
| open, before this pass | 24.2 | 24.7 | 1.9 | +1.6 | 6 |

Load average over the measures: 5.4 to 6.2. An untouched head (no face cuts), one measure: 17.0 ms.

Open minus closed **+4.65 ms, from +6.15 ms** (medians 18.55, 23.20 and 24.70). The ablation build's session read +5.2 from +6.6 on levels about
1 ms higher: the same step, so the switches' own text does not distort the comparison. An untouched head (never
split, no face cuts) read 17.0 ms in this session against 18.55 closed: the two face cuts cost a closed head 1.5 ms.

**(f) The film, as a build** (`?splitfilm=0`, the block not written; its own boot, the load 3.8 to 4.1):

| Leg | min ms | median | spread | min, against open | n |
| --- | --- | --- | --- | --- | --- |
| (a) closed again | 18.4 | 18.6 | 2.5 | -4.7 | 6 |
| (b) open | 23.1 | 23.6 | 3.7 |  | 6 |
| open, before this pass | 24.6 | 25.0 | 2.1 | +1.5 | 6 |

Load average over the measures: 3.8 to 4.1. An untouched head (no face cuts), one measure: 17.3 ms.

Open minus closed is +4.95 ms without the film against +4.65 ms with it, in two boots: the film's cost is not
resolved by a build either. Under 0.3 ms, if anything.

## 4. The brief's five, one by one

### 4.1 A bounding sphere per piece in the skip test: not built. It is not a lower bound, and it would save little

The brief: each turning half lies inside a rotated head-sized sphere, so `max(cap, |q − c| − R)` is a lower bound of
the piece and can join the skip. Checked before any WGSL, with the hand twin's logic walked along a frame's rays
(`scripts/open-head-ray-evals.mts`: a 400 × 300 target from the front, every other texel, the rays through the hold
ball sphere-traced on the CPU body):

| Along the rays, 0.6 m | `middle` both | `middle` one |
| --- | --- | --- |
| Steps (the closed head's on the same rays) | 92 955 (76 056) | 115 366 (99 770) |
| Pieces evaluated a step, as shipped | 1.41 | 1.29 |
| Pieces that lowered the running minimum (the floor for any exact skip in this order) | 1.12 | 1.09 |
| Evaluations the sphere skip would leave out (`c` the head centre, `R` 1.25 × the largest semi-axis) | 8 122 of 131 039 (6%) | 27 710 of 148 528 (19%) |
| ... of which WRONG: the piece left out was under the running best | 1 079 | 9 265 |

- **It is not a lower bound.** A piece's value is `max(f(q), cap)` with `f` the WHOLE body's field at the un-warped
  point: the neck and shoulders sit just outside the cap's planes, and `f` under-reports distance by design (a
  prim's distortion factor is up to 3.8 on the head; `smin` only subtracts). A sphere round the head's solid bounds
  the true distance to that solid, not `f`. One skip in eight (both sides) and one in three (one side) would have
  dropped the winning piece: the field would stop being the same function, overstating distance, which is the
  direction that steps through surfaces.
- **And the room is small.** Even an oracle that skipped every piece that does not win would take the loop from 1.41
  to 1.12 evaluations a step.
- **The exact form of the idea is a wound early-out, and it belongs to the cut-cost pass.** What a losing piece
  could skip exactly is everything after its fold: every lowering in `applyWounds` is gated on the field it is
  handed (the crater's rim bump by `rimLocal`, a cut's lip by `cutRim`), so a piece whose own fold is at least
  `max(running best, 0.7 × the widest rim span)` cannot win. The simulation puts 19% (both) and 17% (one) of
  evaluations there at the face cuts' gate (0.025 m). But the same two conditions, applied per wound row, make ANY far
  sample's cut row free, on closed bodies too, bit for bit. That change is in the cut branch of
  `wounds.wgsl.ts`, which the cut-cost session (branch `claude/cut-cost`) owns and is building; the lead was passed
  to it, and the two branches do not touch the same lines.

### 4.2 Finite-difference normals only where needed: not built. The analytic path cannot run on a split head

Leg (e) forces the analytic gradient inside the region. As minima it reads +0.4 ms (both sides) and +0.3 ms (one
side) against open, never under it, and the census's post-hit counters do not move by one prim: the four
finite-difference taps still run. `ngBody` gives up (reason 1) on any pixel within reach of a cut wound
(`normal-gradient.wgsl.ts`: "the cut test ... returns to calcNormal's finite-difference taps"), a cut's reach is
twice its half-length plus the blend, and a split head always carries its two face cuts, whose reach covers the
whole head. So with the region test removed the pixel pays `ngBody` AND the taps.

What would still work is the brief's third clause alone: a hit on a flat cap (the cut-face gap over its threshold)
has the cap plane's normal exactly, with no taps. Not built: it needs the neighbouring pieces' caps to tell a seam
from a face, the flat share of an open head's texels is not measured, and the post-hit chain is 1.5M of the open
head's 5.2M prims with the probes in it. It is the next thing to count if the post-hit chain matters after §5.

### 4.3 Bounds for the wobble's envelope: not built. There is nothing to save

The brief: a walking split head never rests (its wobble moves the angles every tick), so the bounds, the hulls and
the record are rebuilt every tick; bound each half over its wobble limits once per stage instead, and measure the
tick.

A walking body's pose changes every tick whether or not its head is split, so its view re-uploads its rows, bounds
and record every tick and the hulls are rebuilt for every actor every tick anyway. What the split ADDS to that is a
handful of arithmetic per group and per hull sphere, and it was measured as such (`TICK=1`: one frozen zombie, the
mean of 400 calls of its view's `update` with its posed body, open against closed, interleaved):

| | Open | Closed |
| --- | --- | --- |
| `view.update`, ms a call, round 1 | 0.079 | 0.070 |
| round 2 | 0.039 | 0.037 |

The split costs 2 to 9 microseconds a re-pose, under the difference between two rounds. An envelope bound could
save at most that, and it would cost GPU time: the envelope is the wobble's full swing (±14° about the spring's
angle at `middle`'s full opening), so every bound would be that much looser on every frame, in exactly the place
(§2.4) where loose bounds turned out to be the cost. The hull build itself was not isolated: the step that carries
it also draws a frame (15 ms), and its two rounds disagree by more than the build.

Only a body that stands still while its halves wobble would gain from a cached bound, and a still body's halves do
not wobble: the wobble is driven by the body's own acceleration and rests at exactly zero offset.

### 4.4 A simpler piece loop: not built. A fixed order costs evaluations, and evaluations are the cost

`scripts/open-head-ray-evals.mts` also walks the loop with the pieces in id order and a per-piece skip in place of
the sort: **1.84 evaluations a step against 1.41** with both sides open (+30%), 1.43 against 1.29 with one (+11%),
because a piece is then skipped against a worse running best. At about 6 prims and 2 wound rows an evaluation that
is far more than three compare-swaps of a `vec3` save. Flattening the pieces into the slot loop changes the
shader's shape and not what it evaluates; its case is the cold compile, which did not move in this pass (§6), and it
was not tried.

### 4.5 Turning only the head's primitives: not built. The exact part of it is §3.1

The halves fold the whole slot body at their un-warped points, and the hope was to fold only the head's prims
there. The fold's own per-step cull already drops a group that is too far to matter, exactly, once it is given the
group's own sphere (§3.1): that was a fifth to a quarter of the walk's prims. What is left for this idea is the
neck and shoulder groups NEAR the hinge, which are the ones the head's smooth blend reaches, so dropping them is
the part that changes the field. With every bound the closed head's the open field walks 6.7 prims a step against
the closed head's 5.6, and 1.41 pieces a step explain all of that. Not worth the blend's risk on these numbers.

## 5. What is left, in order of size

With both changes in, `middle` both sides at 0.6 m walks 2.359M prims against the closed head's 1.475M (it was
3.693M), takes 310.9k steps against 262.1k (399.8k) and walks 0.862M wound rows against 0.534M (1.159M). What the
remaining excess is made of, largest first:

1. **The cut rows** (another session's, in progress). An open head still walks 0.33M more wound rows than a closed
   one and 0.05M more after the hit, and every one of its extra prims' samples pays them. The exact per-row exit of
   §4.1 makes a far sample's cut row free on every body. Re-run this note's driver on top of it when it lands: the
   no-wound legs put 2 to 3 ms of the open head's cost there before this pass.
   The same session reports a second thing this note's census does not count: the inside-flesh fold (`applyBones`:
   the organs) runs wherever a sample is near a wound, a cut's near zone is the whole column over it, and an open
   head's cut faces are two such columns that every piece evaluates. It measured that fold at about 2 ms of three
   torso chops' 4.8 ms, has a soft near zone for cuts in its candidate build, and the owner decided on 2026-10-06
   that organs become mesh, which takes the fold out of the default march. That may be most of what the counters
   here leave unexplained (§3.3).
2. **The pieces that do not win** (0.29 of 1.41 evaluations a step with both sides open). No exact skip is known
   that is cheaper than the fold it would skip; after 1 the fold is most of what a losing piece costs.
3. **The piece set-up, a lead and not a finding.** Every sample in the region runs `splitMoveBack` twice for the
   caps (a `sin` and a `cos` each) and once more per turned piece it evaluates. The one-evaluation leg against the
   folded-closed leg (same bounds, one evaluation each) reads +2.4 ms as minima for +57k steps, +0.43M prims and
   +0.19M rows, which the per-prim and per-row rates explain about half of. If the rest is the set-up, two things
   would cut it: the piece loop taking the `qP` / `qM` the caps already computed (the same values, so exact), and
   the record carrying each angle's sine so the shader takes one `sqrt` a sample in place of the trigonometry (the
   same function, but not the same float32 bits as today). Neither was built: the first is at the edge of what
   this machine could resolve today, and the handoff's warning about live values across the inlined `mapBody`
   applies to it.
4. **The post-hit chain** (+0.32M prims over the closed head's): the normal's four taps and the probes each run
   the piece loop. §4.2's cap normal is the only idea on the table.
5. **Steps.** With every bound the closed head's, the open field still takes 16% more steps on the same rays
   (305k against 262k): rays that run down the V between two cut faces, and the caps' own planes. Inherent to the
   shape.
6. **The tile lists.** An open head's pixels still list the head's groups over the whole hold ball's disc (the
   binner and the per-ray cull read the grown sphere, as they must for a sphere that is ONE sphere). The "tiles
   closed" leg is 0.41M walk prims under §3.1's result with both sides open. B5 tried the smallest sphere holding a
   group and its turned copies in place of the hold ball and measured 0.2 ms; with the census it could be judged
   properly.

Not looked at: the cone and depth pre-pass twins (they walk clusters, with the GROWN cluster row as their per-step
cull: the same loss §3.1 fixed for the tiled path, on a path this census does not count), a crowd of split heads,
and the refine twin.

## 6. The check set

On the branch's last source commit (`140193de`), 2026-10-06. The only WGSL change of the pass is §3.1's rebuild in
the tile preload; §3.2 is CPU only.

| Check | Result |
| --- | --- |
| `march-golden -u` | moved once, for the preload's four lines (`01bd807d`). The harness commit did not move it: with no flag its strings are empty |
| `compile-census` | phase ready, `uncapturedCount` 0, no device loss; the march module 332 049 B (331 523 B before: +526 B). One cold boot, `warmMs` 50 671 inside this pass's own job chain |
| `march-hash` | **no pin moved**, all three modes: default `d7392d52…` / wounded `76bd51aa…`, crowd quad `0c71e712…` / `bf6836cd…`, per-body `470ff0b3…` / `f618070e…` |
| Cold boot pairs (`boot-time.mjs`, base `37943f97` against `01bd807d` from clean snapshots, alternated, a `hash13` nonce per boot) | base 44 322 / 44 133 ms, new 44 163 / 43 543 ms warm-up; `drawOnce` 1686 / 1690 against 1690 / 1663. No difference. (Taken straight after the test tree: the 1-minute load average was still falling, 62 to 9, across the four boots.) |
| The test tree (`npx vitest run src/lab/sdf-zombie scripts/lib --exclude '**/cut-wound.test.ts'`) | 526 files, 7571 tests passed, 1 skipped |
| `npx tsc --noEmit` | only the `node:crypto` error |
| `scripts/head-split-gate.mjs` | **80 checks, 0 failed** |
| `scripts/axe-gate.mjs` (`OUT=` scratch) | **27 checks, 0 failed** |
| `scripts/cut-wound-gate.mjs` (`OUT=` scratch) | **30 checks, 0 failed** |

**The head-split gate's B scenario** is the one that judges a bound: the shipped path against the per-body path
with every march bound off, texels the unbounded field hits and the shipped path does not, over the closed head's
own count. Front and above-behind, for `middle` both, `middle` one and `face`:

| | both, front | both, top | one, front | one, top | face, front | face, top |
| --- | --- | --- | --- | --- | --- | --- |
| Before this pass (the gate's recorded values) | 0 | −1 | 13 | 0 | 3 | 17 |
| After | 1 | 1 | 13 | 6 | 3 | 17 |

Allowed: 30. The six more texels from above on the one-sided head (of 14 613) are the footprint-fat rim of §3.2.
Texels at another depth, over the closed head's count: −24, −25, −9, −12, +57, −16 (allowed +150).

**New tests:** `split-ablate.test.ts` (the switches are compiled out and default off), `tile-cull.test.ts` and
`tile-bin-compute.test.ts` (the offset rides both binners; none for a group without one),
`tile-preload.wgsl.test.ts` (the rebuild comes after both ray tests), `zombie-gpu.test.ts` (the rebuilt cull sphere,
in float32 as the march computes it, holds every group's closed sphere), `head-split-bounds.test.ts` (§3.2).

**Not run:** `cut-wound.test.ts` (the cut field was not touched). The deferred surface entry (broken on the base:
the handoff's follow-up 8).

## 7. How to re-run

```bash
# the lock all sessions on this machine share for GPU timings and heavy jobs
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done; echo "<who> $(date)" > /tmp/blud-gpu-timing.lock/owner
bash -c 'export LAB_TMP=.lab-tmp LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap "lab_servers_down; rm -rf /tmp/blud-gpu-timing.lock" EXIT; lab_servers_up
  # the attribution, as the cost stood before this pass (BASE_BOUNDS=48), timings and census
  BASE_BOUNDS=48 FLAGS="&splitablate" node scripts/open-head-cost.mjs 5241 9241
  # before against after, both changes and each alone; the frames compared; the CPU side
  LEGS=closed,open,before,tileCullOld,hullOld PARITY=open:tileCullOld,open:hullOld TICK=1 FLAGS="&splitablate" node scripts/open-head-cost.mjs 5241 9241'
```

The driver's header lists every option. Never edit `src/` while it runs: the dev server reloads its page.
