# Silhouettes from the field: can the march's resolution drop if the edges are exact? (2026-11-10)

Proposal B of the [perf research note](../2026-11-09-sdf-perf-research/NOTES.md), spiked in the replay harness.
No renderer code changed.

**Answer: no, not as a speed lever, at the shipped walk's cost.** Edge rays at output resolution fix the
silhouettes (edge error 0.40 to 0.06 on a close-up), but they cost more than the lower march resolution saves.
Every combination measured is slower than the shipped 400 x 300 pass: by 21 to 54 % on a close-up and by 84 to
121 % on a 22-body mob. The inside of surfaces also gets softer with every step down, and edge rays do nothing
for that.

## What was built

One frozen frame, its `sdf:march` pass captured from one boot at 800 x 600, 400 x 300 (shipped), 300 x 225 and
200 x 150, the light and probe clocks pinned (`scripts/native-spike/silhouette-capture.sh`). A second 800 x 600
capture at the end of the boot matches the first to 0.0000 (close-up) and 0.0001 (mob), so the frames are one frame.

`scripts/native-spike/silhouette.mjs` then does two separate things:

- **Quality, on the CPU, from the game's own readbacks.** Each low frame is rebuilt at 800 x 600 as plain bicubic,
  and as bicubic with exact edges: on an EDGE texel the pixel's own visibility decides (a miss is the background; a
  hit takes its colour from the low texels on its own surface, by depth). That visibility is read from the 800 x 600
  capture, which is what a ray through the pixel returns. An edge texel is an output pixel whose low-res
  neighbourhood (4 x 4) mixes hit and miss, or spans a 3 % depth step.
- **Cost, as a replayed pass.** The edge rays are the 800 x 600 capture with the flat-albedo seam on (the walk
  without the post-hit chain) and one shader edit: a pixel that is not an edge texel returns at once. Timed by
  alternation, 5 repeats, 10 copies a submit, on a quiet machine (load 2 to 5).

The error is the mean absolute difference of the display-encoded colour against the 800 x 600 march: over the
whole frame, in the **band** (within 2 px of where that march changes surface) and **inside** (hit pixels outside
the band).

## Quality

| Close-up, one body at 0.6 m | Band, bicubic | Band, exact edges | Inside, bicubic | Inside, exact edges | Edge texels |
| --- | --- | --- | --- | --- | --- |
| 400 x 300 (shipped) | 0.400 | **0.063** | 0.0123 | 0.0115 | 33,692 (7.0 % of the frame) |
| 300 x 225 | 0.402 | 0.059 | 0.0176 | 0.0160 | 57,362 (12.0 %) |
| 200 x 150 | 0.411 | 0.066 | 0.0294 | 0.0251 | 116,704 (24.3 %) |

| Mob, 22 bodies | Band, bicubic | Band, exact edges | Inside, bicubic | Inside, exact edges | Edge texels |
| --- | --- | --- | --- | --- | --- |
| 400 x 300 (shipped) | 0.239 | **0.106** | 0.0225 | 0.0178 | 48,732 (10.2 %) |
| 300 x 225 | 0.264 | 0.158 | 0.0353 | 0.0263 | 66,991 (14.0 %) |
| 200 x 150 | 0.285 | 0.219 | 0.0526 | 0.0399 | 109,680 (22.9 %) |

- **On a close-up the edges hold at every scale.** The band error is the same 0.06 from 400 x 300 down to 200 x 150.
- **On the mob they do not.** Thin limbs and overlapping bodies leave edge pixels with no low texel on their own
  surface: 7,813 at 400 x 300, 14,917 at 300 x 225, 24,938 at 200 x 150. Those take a neighbour's colour.
- **The inside is the limit.** It is 30 to 50 % worse at 300 x 225 than at 400 x 300 and about twice as bad at
  200 x 150. This is shading detail the low frame never had.
- **The low march draws its bodies about one of ITS pixels fat.** The march accepts a hit within a pixel's footprint
  of the surface, so cover is 35.8 % at 800 x 600, 37.1 % at 400 x 300 and 39.7 % at 200 x 150 on the close-up. With
  the edge test on the 2 x 2 footprint alone the outer part of that ring kept the body's colour, and the band error
  stayed at 0.27. Looking one low texel further (`SIL_REACH=1`, used above) fixes it and is why the edge set is 7 to
  24 % of the frame, not 1.5 to 5 %. Two texels further changes nothing more.
- Plain bicubic is not what ships: the t16 net is somewhat better than it, mostly inside surfaces
  ([next-steps note](../2026-09-12-upscaler-next-steps.md), section 14). It was not run here.

Pictures: [`look/`](look/) holds the 800 x 600 march, bicubic from 400 x 300, and exact edges from 400 x 300 and
300 x 225, for both scenes.

## Cost

Milliseconds a pass; the difference is against the shipped 400 x 300 pass in the same repeat (median, range).

| | Close-up | | Mob, 22 bodies | |
| --- | --- | --- | --- | --- |
| 400 x 300, shipped | 4.83 | | 34.87 | |
| The same again (control) | 4.57 | −0.26 (−0.34 to +0.05) | 34.47 | +0.29 (−1.75 to +1.29) |
| 300 x 225 alone | 3.25 | −1.52 (−2.12 to −1.44), −31 % | 29.58 | −4.53 (−6.31 to −3.14), −13 % |
| 200 x 150 alone | 1.89 | −2.92 (−3.36 to −2.87), −60 % | 17.36 | −17.16 (−18.53 to −16.46), −49 % |
| Edge rays for 400 x 300 | 2.59 | | 42.06 | |
| Edge rays for 300 x 225 | 2.96 | | 41.75 | |
| Edge rays for 200 x 150 | 3.96 | | 46.48 | |
| **400 x 300 + its edge rays** | 7.39 | +2.59 (+2.50 to +2.64), +54 % | 76.24 | +42.06 (+39.93 to +48.30), +121 % |
| **300 x 225 + its edge rays** | 6.34 | +1.50 (+0.77 to +1.68), +31 % | 71.16 | +36.04 (+30.84 to +45.57), +103 % |
| **200 x 150 + its edge rays** | 5.85 | +1.01 (+0.60 to +1.37), +21 % | 63.84 | +29.28 (+27.21 to +33.87), +84 % |

- **The edge rays are the dear ones.** The whole 800 x 600 walk, every pixel, is about 5.2 ms on the close-up and
  about 63 ms on the mob. The 7 % of its pixels that are edge texels cost half of that on the close-up (2.6 ms), and
  the 10 % on the mob cost two thirds (42 ms). That agrees with the [cost ladder](../2026-11-09-sdf-perf-research/LADDER.md):
  rays that walk and miss were 15 % of the pixels and 60 % of the steps, and an edge texel is where those rays are.
- **A lower march resolution saves less than its pixel count on a mob.** 300 x 225 has 44 % fewer pixels and is
  13 % faster; 200 x 150 has 75 % fewer and is 49 % faster. Why is not established (a 16 px tile covers more of the
  screen at a lower resolution, so each pixel's list is longer; not measured).
- The sums add two passes timed apart, and leave out the pass that would put the picture together (one full-screen
  read of two targets).

## What this does not show

- **Edge rays in another form.** These are fragment-stage rays through a per-pixel mask, scattered over full-screen
  quads, at the production walk's cost with three.js's shader around it. The [compute spike](../2026-11-10-compute-march-spike/NOTES.md)
  found the stage and the grouping worth a third of the pass. A compute pass over a packed list of edge pixels, or
  the research note's lean kernel (its proposal A, stage 1), was not built. The edge rays would have to cost about a
  fifth of what they do here before 300 x 225 breaks even on the mob.
- A wounded frame, a body other than the zombie, a level (the scenes are the ring testbed), motion.
- The shipped upscaler net on any of these frames, or an eye's verdict: the numbers are an error against the
  800 x 600 march, not a judgement of the look.
- Three r186 (the installed version).

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
scripts/native-spike/silhouette-capture.sh .scratch/sil "closeup mob"
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 SIL_PNG=.scratch/sil/png-mob \
  scripts/native-spike/servers.sh node scripts/native-spike/silhouette.mjs 5 .scratch/sil/mob
rm -rf /tmp/blud-gpu-timing.lock
```

`silhouette.mjs 0 <base>` prints the quality table alone and needs no GPU. `SIL_REACH` (default 1) is how far
the edge test looks beyond the 2 x 2 footprint; the third argument is the depth step (default 0.03).

Two traps met on the way, both in the scripts' comments: any scale but the shipped one turns the interlaced fields
on and sizes the hit tolerance from half the rows; and a `discard` with no `return` after it does not end a
fragment's work.

Raw results: [`results/closeup.json`](results/closeup.json), [`results/mob.json`](results/mob.json), and the
runs' output as `.txt` beside them.
