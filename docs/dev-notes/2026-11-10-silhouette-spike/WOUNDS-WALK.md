# What the wounded mob's wounds cost, and where (2026-11-11)

Follows [LOOSEN.md](LOOSEN.md). The question was whether a lean field that also applies wounds is the next thing
to build for the wounded 22-body mob. **Answer: no.** The rest of `mapBody` is a small part of what wounds add.
The wound code costs about 26 ms of a 65 ms pass, spread over the walk, the shading and their side effects, and no
single cut of it is large. Replay only (`scripts/native-spike/wound-bound.mjs`), no renderer code.

## Numbers

One captured `sdf:march` pass (`mobw`, 400 x 300, about 8 wounds a hit body), each leg against the shipped pass by
alternation, 5 repeats. **The machine was not quiet**: the shipped pass read 59 to 80 ms across the four runs and
one control was +8 ms, so read differences under about 5 ms as nothing.

| Leg | What it removes | Against shipped (median, range) | Picture |
| --- | --- | --- | --- |
| no-wounds | `applyWounds` returns at once, everywhere | −26 (−30 to −18); −28, −24, −34 in the other runs | wrong (no wounds) |
| nw-walk | the same, in the walk's own calls only | −15 (−16 to −4) | wrong |
| nw-shade | the same, in every other call (normal taps, probes, wound shadow) | −12 (−13 to −1) | wrong |
| walk-lean | the walk on `mapLean` (the ceiling of a lean field with wounds) | −19 (−27 to −12); −22 in another run | wrong |
| no-near | the "near a wound" flag never raised | −7 (−10 to +4) | loose: 319 hit flips, 14,727 px over 0.1 |
| no-refold | the owner re-fold never runs | −5 (−17 to −3) | loose: 8,553 px over 0.1 |
| tight-15 | crater code skipped beyond 1.5 radii (shipped: 2) | −2 (−4 to +9) | 49 px over 0.1 |
| tight-10 | the same at 1 radius | −5 (−15 to +15) | 3,526 px over 0.1, 56 hit flips |
| shell-6 | `mapLean` first, `mapBody` only within 6 cm of the clean body | +7 (+5 to +20) | 728 px over 0.1, 0 hit flips |
| shell-3 | the same at 3 cm | +5 (−2 to +9) | 4,321 px over 0.1 |

Counts, over the hit pixels' walk (79,220 px, 358,770 steps):

- **12.2 million wound rows read**, 34 a step: 8 wounds, several bodies in a pixel's table, and the re-fold's second
  call. 6.9 million of them (57 %) are inside their reach and run the crater code.
- Tightening the reach to 1.5 radii takes the crater code to 2.9 million rows (−59 %) and saves nothing. The crater
  maths is not the cost.
- Wounds add 16 % to the walk's steps (308,266 without, 358,770 with); 10 points of that is the near flag's
  short steps.
- 74 % of the walk's steps are within 6 cm of the clean body, which is why the shell walk pays twice and loses.
- The exact reach (`gWoundExact`) and the reach skip (`perfCfg.y`) are already on. The per-ray wound list is not,
  and cannot be as written: it lists one body's wounds, and a crowd pixel folds several bodies.

## Reading

- A lean field with wounds would save, at most, walk-lean less nw-walk: about 4 to 7 ms. Not worth its build.
- What is left is the loop itself (a load, a length and a reach for 34 rows a step), the extra steps, the re-fold
  and the same again in the shading's field calls. Each is a few ms.
- The one change that removes all of it is to stop evaluating wounds as a list: **bake a body's wounds into a small
  volume** read once a field call, in the limb's rest frame. Its ceiling is the no-wounds leg, less one sample a
  call. Not built. Open: the rest-frame lookup on blended limbs, the crater's ragged edge at a volume's
  resolution (the analytic code could stay for the hit's shading alone), memory for a hundred bodies.
- Smaller, exact: a per-pixel wound list across the pixel's bodies, to cut the 12 million reads.

## Running it

```bash
until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
  node scripts/native-spike/wound-bound.mjs 5 .scratch/compute/mobw-ship
rm -rf /tmp/blud-gpu-timing.lock
```

`WB_ONLY` picks legs. Raw: [`results/woundbound-mobw.json`](results/woundbound-mobw.json) (the last run only; the
earlier runs' tables are in this note).
