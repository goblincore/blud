# Where the mob's march goes, by pixel (2026-11-10)

Asked after the [silhouette spike](NOTES.md) found its edge rays dear: is the shipped pass's time in the rays that
graze a body and miss? Measurement only; no renderer code.

**Answer: no. The pixels that hit a body are the whole cost.** On a 22-body close mob the pass with ONLY its hit
pixels running takes as long as the whole pass (34.3 ms against 34.9). The misses beside the silhouettes are dear one
at a time (three times a hit pixel) but ending them sooner would save about half a millisecond. Of the hit pixels'
time, the walk is a little over half and the shading after the hit a little under.

## Method

`scripts/native-spike/march-census.mjs`: a captured `sdf:march` pass (the fragment march, 400 x 300, the
[compute spike](../2026-11-10-compute-march-spike/NOTES.md)'s frozen mob captures) replayed with one shader edit:
a pixel outside a given class returns at its first line. The classes are read from the game's own readback of the
frame: **hit**; **near**, a miss within 8 px of a hit; **far**, every other miss. A class's own cost is its leg minus
a leg where no pixel runs (0.14 ms). Five repeats in rotation, 10 copies a submit, load 3.6 to 6.7.

## Result

| Clean mob, shipped pass (34.9 ms) | Pixels | Alone | A pixel |
| --- | --- | --- | --- |
| Hit | 81,277 (67.7 %) | 34.2 ms (34.0 to 43.5) | 421 ns |
| Near miss | 4,148 | 5.5 ms (5.3 to 6.4) | 1,328 ns |
| Far miss | 34,575 | 1.1 ms | 31 ns |

| Clean mob, walk only (flat albedo, 19.9 ms) | Pixels | Alone | A pixel |
| --- | --- | --- | --- |
| Hit | 81,277 | 18.3 ms (17.3 to 20.7) | 225 ns |
| Near miss | 4,148 | 5.6 ms | 1,340 ns |
| Far miss | 34,575 | 1.1 ms | 31 ns |

| Wounded mob, shipped pass (80.7 ms; the machine got busier through this run, 65 to 85) | Pixels | Alone | A pixel |
| --- | --- | --- | --- |
| Hit | 79,220 (66.0 %) | 79.9 ms (65.9 to 84.9) | 1,009 ns |
| Near miss | 3,960 | 11.3 ms (9.4 to 13.1) | 2,859 ns |
| Far miss | 36,820 | 2.7 ms | 74 ns |

- **The classes do not add.** Hit + near + far is 41.0 ms on the clean mob against the pass's 34.9, and the hit leg
  alone is within noise of the whole pass. Adding the misses back to the hits costs about 0.6 ms, not the 6.6 ms they
  cost alone. The same on the walk-only frame (24.8 against 19.9) and the wounded one (94.3 against 80.7).
- A reading, not established: the GPU runs fragments in groups, and a group is as slow as its slowest pixel. A near
  miss sits beside hit pixels, so in the whole pass its group is already paying for a hit. This is the same reading
  the compute spike gave for why the stage and the workgroup size mattered.
- **The far misses are nothing** (3 % alone): the quad's empty tiles and the hull bounds already end them.
- **The shading after the hit is 43 % of the clean mob's pass**: 421 ns a hit pixel shipped against 225 walk-only,
  15 ms of 35.
- **Wounds cost on every hit pixel**: 1,009 ns against 421. Not split into walk and shading here.
- The mob is three draws (three crowd types) that overlap, and a class is the FINAL picture's: a hit pixel runs in
  all three, and misses in up to two of them. That miss work is inside the hit class.

## What it says to do

- Ending missed rays sooner is not a lever on this frame. The [cost ladder](../2026-11-09-sdf-perf-research/LADDER.md)'s
  "15 % of the pixels, 60 % of the steps" was a single body with the exit bound off; this is the shipped page.
- The time is in hit pixels: about 20 ms of walk and 15 ms of shading on the clean mob. The shading chain has not
  been taken apart since the lean walk, the reference list and the compute march landed.
- One hit pixel runs in every overlapping draw. How much of the hit class is that repeat is not measured.

Not verified: the compute march (this is the fragment pass; the split may differ), a level, motion, a body other
than the zombie. Raw: `results/census-*.json` and `.txt`.

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 \
  scripts/native-spike/servers.sh node scripts/native-spike/march-census.mjs 5 .scratch/compute/mob-ship
rm -rf /tmp/blud-gpu-timing.lock
```
