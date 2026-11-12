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
