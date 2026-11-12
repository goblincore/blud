# Where the heavy mob's frame goes (2026-11-11)

After the compute march (PR 120) and with the crater grid (`?woundgrid`, PR 122). Driver:
`scripts/native-spike/frame-breakdown.mjs` (a frozen staged scene stepped a frame at a time; the page's own
timestamp queries, each pass charged the time between the pass that ended before it and its own end; march debug
mode 13 returns right after the walk, so mode 0 against mode 13 splits the march). Headless Chrome, an M3, 40
frames a leg, one run. Stepped a frame at a time with a fence, a frame is about 10 ms dearer on the wall than in
the 30-frame batches the comparisons use (55 against 45 ms): the CPU and the GPU do not overlap here.

Scenes: the 22-zombie mob (`prelude-mob.js`), and the same with six bodies shot about 70 times
(`prelude-mob-heavy.js`).

| | Clean mob, grid | Heavy mob, grid | Heavy mob, default |
| --- | --- | --- | --- |
| GPU, first pass to last | 31 ms | 51 ms | 59 ms |
| **The march** (`compute:sdf-march`) | 21.5 | 39.9 | 48.0 |
| ... the walk (mode 13) | 12.4 | 19.0 | 23.7 |
| ... after the hit (the rest) | 9.1 | 20.9 | 24.3 |
| Hull pass and level geometry (`sdf:shell-hull`, `sdf:polys`) | 6.6 | 8.0 | 7.6 |
| Upscaler (all its passes) | 1.3 | 1.3 | 1.3 |
| Tile binning, probe gather | 0.9 | 1.1 | 1.2 |
| CPU, the step call | 7.6 to 8.0 | 8.9 to 9.6 | 8.5 to 9.2 |

(`sdf:shell-hull` and `sdf:polys` trade places between legs: they overlap, and whichever ends second is charged
both. Read them together.)

What it says:

- **The march is still 70 to 80 % of the GPU frame.** Nothing after it matters: the upscaler, compositing and post
  are under 2.5 ms together.
- **Wounds cost more after the hit than in the walk.** Against the clean mob, the heavy one adds 6.6 ms of walk and
  11.8 ms of shading. The shading after the hit (normals, the AO and scatter probes, the wound colour) is now the
  larger half of a wounded mob's march: 21 of 40 ms.
- **The crater grid took 4.7 ms off the walk and 3.4 ms off the shading** (heavy, default against grid), with twice
  the exact wounds.
- **The hull pass is about 6 ms** on either mob.
- **The CPU step is 8 to 10 ms** with everything frozen. In a running game it overlaps the GPU.

For the three candidates:

1. The fast walk for the unwounded parts of a wounded body: at most the 6.6 ms the wounds add to the walk, and
   less, since the carve near wounds stays.
2. A cheaper normal on wounded pixels, and
3. cheaper AO and scatter probes: both live in the 20.9 ms after the hit, 11.8 ms of which wounds added. This is
   where the most is left. Not split further here: mode 13 stops before all of it.

## A lower march resolution through the same upscaler (owner's question)

It exists since September: `?accum=1&accumchecker=1` marches at quarter scale, rebuilds the half-scale grid from a
checker over two frames, and the neural upscaler takes that. Heavy mob, `?woundgrid` on both legs, whole frames,
two rounds, the ship pin skipped on both (`WV_NO_SHIP=1`: the pin refuses a boot that set its own scale):

| Leg | Frame | Against shipped |
| --- | --- | --- |
| shipped (half scale) | 50.04 ms | |
| shipped again (control) | 51.34 ms | +1.31 (+0.25 to +2.37) |
| quarter scale, checker | 74.87 ms | +24.84 (+24.00 to +25.67) |

- **Slower, by half.** Why is not looked into. The mode predates the compute march; it may march on the fragment
  path, or twice (its default sends bodies past 3 m through a real half-scale march).
- **The look, frozen (its best case):** softer, with stair-stepped edges and a bright fringe on silhouettes
  (`checker-quarter-res.png` against `shipped-half-res.png`, local only).
- As it stands it is not a lever. A fair test would need it on the compute march.

## The march at 0.375 of the canvas, plainly enlarged (owner's question, same day)

`prelude-mob-heavy-tryscale.js` (`?tryscale=<s>`). Any scale but 0.5 switches the neural upscaler off (it is built
for exactly 2x), and with it off the page falls back to its interlaced FIELD style, which marches half the rows a
frame: a first run read 46 to 16 ms and was measuring that. The prelude now forces fields off.

| Leg | Frame | Against shipped |
| --- | --- | --- |
| shipped (0.5, upscaler) | 90.64 ms | |
| shipped again (control) | 102.80 ms | +12.16 (−1.10 to +25.42) |
| 0.375, fields off, plain enlargement | 60.54 ms | −30.10 (−36.01 to −24.19), −33 % |

- **The machine was loaded** (shipped reads 46 ms when it is quiet): take the ratio, about a third of the frame,
  not the milliseconds. By pixel count the march would lose 44 %.
- **The look** (`scale-0.375-plain.png`, local only): blocky, with a bright fringe on silhouettes. This is the
  floor: any upscaler would start from here.
- Fields on at 0.5 with the upscaler off: about 60 % off the frame (same loaded run). Owner, 2026-11-11: fields at
  the march's resolution are too distracting; interlacing only looks fine at the output's line spacing, where it
  saves nothing. Not a lever.
- Not built: an upscaler for any ratio (the fitted-filter or FSR-style kind, guided by the march's depth and
  normals), or a temporal one (the previous-pose rows exist; it would smear on gore).

## The shading after the hit, taken apart (2026-11-12)

The march pass alone (`compute:sdf-march` from `frame-breakdown.mjs`), heavy mob, `?woundgrid` on every leg, a fresh
page a leg, a baseline between legs because the machine drifts (the wall-clock comparisons of the same variants
ran on a loaded machine and are not usable).

| Variant | March | Baselines either side |
| --- | --- | --- |
| `?ngwound`: the analytic normal near owned wounds, on the exact reach | 38.4 ms | 38.1, 38.4 |
| `?ngwound=2`: no four-tap normal near wounds at all (sizing) | 41.3 | 38.4, 41.9 |
| the analytic normal off everywhere (`normalGradientCfg.x = 0`) | 41.1 | 41.9, 42.0 |
| AO and scatter probes both off (`lodCfg.x`, `surfCfg.w` = 0) | 34.8 | 42.0, 42.0 |
| `?probelean`: both probes on `mapLean` | 34.7, 34.6 | 39.7, 37.6, 37.4 |

- **WITHDRAWN: "the normal is not a lever".** That read came from one leg a variant on a drifting machine. The
  stops below show the four taps are about 9 ms and `?ngwound=2` removes them. `?ngwound` (=1) does save nothing:
  the analytic path still gives up on most wounded pixels (the taps stay at 8 to 9 ms with it on).
- **The two probes are about 7 ms** of the heavy mob's march: each is one whole field call a hit pixel.
- **`?probelean` takes about 3 ms off** (34.6 against 37.4 to 37.6; 47 against 50 ms on the wall). The probes read
  the bodies without their wounds, so inside a crater they see the flesh that was there: the floor reads fully
  occluded. Close up the cavity is darker and deeper red, the organs less glossy-bright
  (`probelean-close-{off,on}.png`); on the mob the difference is slight (`probelean-mob-{off,on}.png`). Local only.
  Owner's verdict on the two close-up stills (2026-11-12): "Looks fine". Not yet seen by the owner in play; still
  off by default.

## The same, by stops inside the shader (2026-11-12)

`?afterhit` (`march/after-hit-flag.ts`) puts nine early returns into the march, one a debug mode, so the pass timed
at two neighbouring modes gives the cost of what lies between; each return is built from what its stage worked
out. One page, `frame-breakdown.mjs` with `FB_MODES`, three rounds. Heavy mob, `?woundgrid`, a quiet machine
(`.lab-tmp/wv/afterhit2-heavy.json`; the first run without the two inner stops agrees within 0.5 ms):

| Stage | March pass up to its end | The stage |
| --- | --- | --- |
| the walk (stop 30) | 19.1 to 19.8 ms | 19.3 |
| the rest anchor (37) | 18.7 to 19.7 | about 0 |
| the analytic normal, `ngBody` (38) | 23.2 to 23.5 | 4 |
| the four-tap normal where that gave up (31) | 32.2 to 32.7 | 9 |
| wound and char masks, tissue, organs, the whole material chain (34) | 33.2 to 35.3 | 1.5 |
| flashlight, light list, the two probes, the wound and level shadows (36) | 40.3 to 43.3 | 7 (the probes; stop 35 before them read the same as 34) |
| ambient and compose (0) | 40.4 to 41.9 | under 1 |

So the 21 ms after the hit is the normal (13: 4 analytic, 9 the taps on wounded pixels) and the probes (7). The
wound colour loops, the materials and the light list are under 2 ms together and not worth work.

On the clean mob (same stops, a noisier run): the walk 13, `ngBody` 6, the taps about 0, the probes about 8.
`ngBody` is dearer there than on the heavy mob because a wounded pixel gives up early.

**`?ngwound=2` (no taps near wounds: the pixel keeps `ngBody`'s gradient and the skin detail term).** Alternated
with the baseline, three legs each, the first sample of a page (later samples of a page drifted up on both):

| | March pass | Of it, the taps (stop 38 to 31) |
| --- | --- | --- |
| baseline | 37.7, 39.3, 38.4 ms | 8.3, 9.8, 11.7 |
| `?ngwound=2` | 30.6, 30.6, 30.4 | 2.7, 1.8, 2.0 |
| `?ngwound=2&probelean` (one leg) | 32.3 (second and third samples; the first read 42.3) | |

About 7 to 8 ms off the heavy mob's march. The one leg with `?probelean` added did not show its 3 ms on top; not
settled. The look, one zombie with 70 pellets in the chest (`ngwound2-close-{off,on}.png`, mob
`ngwound2-mob-{off,on}.png`, both shortcuts `ngwound2-probelean-close-on.png`): crater lips and the edges between
overlapping craters are a little softer, the cavity and the organs read the same. The flag's header calls it a
sizing switch because the analytic gradient does not carry a crater's exact shape; in the stills that is hard to
see. Not seen in motion. Local only.

**Owner on `?ngwound=2` in play (2026-11-12): looks fine, would like it a little less soft; not a deal breaker.**
Two in-between rules (`normalWoundTapRule`), second half of an alternated run (the first half ran while the owner
was playing):

| | March pass | The taps |
| --- | --- | --- |
| baseline | 38.0 ms | 8.7 |
| `?ngwound=3`: taps only where the analytic path gave up at a kink (a lip, a ridge between craters) | 38.0 | 7.6 |
| `?ngwound=4`: taps near a wound except at kinks | 32.7 | 2.4 |
| `?ngwound=2` | 30.3 | 0.2 |

Nearly every give-up on a wounded pixel is a kink, so "taps at the edges only" is the baseline over again. `=4`
keeps the taps for the other give-ups at 2.4 ms; in the close-up still (`ngwound4-close-on.png`) it is hard to tell
from `=2`. A sharper edge at `=2`'s cost would have to come from the analytic side (a one-sided gradient at the
kink), not from the taps. Not tried.

- **Open:** `ngBody` is 4 to 6 ms on every mob and has not been looked into. The taps left with `?ngwound=2`
  (2 ms) are the pixels where `ngBody` did not run or gave no usable gradient.

## Where this pass ended (2026-11-12)

- **Owner, MAP28's closet mob with `?woundgrid&ngwound=2&probelean`:** "significant improvement ... not a steady 30
  but it feels much smoother overall so seems worth the changes". On `?ngwound=2`: the softer lips are noticeable
  and acceptable for the trade; keep it switchable. Played on the local branch `claude/crater-grid-map28-try` (this
  branch with PR 92's MAP28 branch merged in; only the generated module index conflicted).
- **The twinhead's red marks** are its authored scars (18 thin painted bars, the `# SCAR` lines of
  `characters/twinhead.blob`, there since the character was added on 2026-10-21). They show on an unshot body with
  every flag off and with `?marchcompute=0` (`prelude-arena-shot.js`, `spawn=twinhead&shots=0`). The owner
  remembers no marks; not compared with an older commit. Owner: ignore for now.
- **Open, reported by the owner in play, not investigated:** wounds vanished once on a soldier under `?woundgrid`
  (not reproduced; a cell past its limit drops its oldest entries, nothing ties that to it); a faint body-part
  outline inside list wounds that baked wounds do not show (a guess only: the tissue ramp reads the depth under
  the unwounded skin, `hitField.w`, which creases where two parts meet).
- **How to time a part of the shader** (what this pass got wrong first): stops inside the shader switched by debug
  mode on one page, several rounds (`?afterhit`, `FB_MODES`), not one fresh page a variant. One leg a variant on a
  drifting machine read the taps as free when they are 9 ms.
