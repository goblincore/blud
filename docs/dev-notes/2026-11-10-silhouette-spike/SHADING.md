# The shading after the hit, taken apart on the mob (2026-11-10)

Follows [CENSUS.md](CENSUS.md): the pixels that hit a body are the whole march pass, and a large part of a hit
pixel is what runs after the hit. This note says which part. Measurement only; no renderer code changed.

**Answer.** On the 22-body mob the shading after the hit is 19 ms of a 32 ms pass, and three things are 17 of the
19: the AO and scatter probes (5.6 ms), the finite-difference normal (5.0 ms) and the stage that holds the analytic
normal (4.5 ms). Materials, masks, lights, ambient and the compose are under 1 ms each. Wounding the mob adds 20 ms,
and 15.5 of that is in the WALK, not the shading: a pixel with a wounded body anywhere in its list loses the lean
walk.

## Method

`scripts/native-spike/shade-ladder.mjs`. The captured fragment `sdf:march` pass (400 x 300, the compute spike's
`mob-ship` and `mobw-ship` captures) is replayed with the post-hit chain CUT at one point after another. At a cut a
pixel returns a sum of what it has computed so far, so none of it is dead code, and nothing below runs. A stage's
cost is the difference between neighbouring cuts in the same repeat. Two removals from the whole pass cross-check
the cuts. 5 repeats in rotation, 10 copies a submit, 15 rounds, machine load 1 to 3.

## Clean mob (pass 32.3 ms; the same again +0.3, −0.3 to +0.9)

| Stage | ms | Range | Of the pass |
| --- | --- | --- | --- |
| The walk (flat-albedo seam) | 13.1 | | 41 % |
| Piece and material rows, rest anchor, analytic normal (`ngBody`) | 4.5 | 4.1 to 5.0 | 14 % |
| Finite-difference normal (`calcNormal`, 4 field calls), skin detail, cloth folds | 5.0 | 4.8 to 5.8 | 16 % |
| Wound and char masks | 0.3 | 0.1 to 1.0 | 1 % |
| Albedo chain (tissue, face sheet, grain, body normal map, gore, burn, wet) | 0.7 | 0.6 to 1.0 | 2 % |
| Key light and the light list | −0.3 | −0.5 to 0.0 | |
| AO and scatter probes (2 field calls) | 5.6 | 5.5 to 6.1 | 17 % |
| Wound soft shadow / self shadow | 2.6 | 2.0 to 3.2 | 8 % |
| Level shadow and ambient | 0.1 | −0.3 to 1.5 | |
| Compose | 0.1 | −0.8 to 1.1 | |

Removed from the whole pass: the probes −6.0 ms (−6.6 to −5.9); the finite-difference normal −4.8 (−5.8 to −4.5).
Both agree with the cuts.

## Wounded mob (pass 52.5 ms; the same again −1.9, −5.6 to +0.5: a noisier run)

| Stage | ms | Range |
| --- | --- | --- |
| The walk | 28.6 | |
| Rows, anchor, analytic normal | 6.0 | 5.0 to 12.4 |
| Finite-difference normal, skin detail, cloth folds | 4.6 | −0.7 to 5.1 |
| Masks | −0.6 | −4.9 to 0.9 |
| Albedo chain | 1.1 | 0.7 to 1.4 |
| Lights | 0.4 | −0.8 to 0.8 |
| AO and scatter probes | 8.7 | 7.4 to 9.2 |
| Wound soft shadow | 3.3 | 2.3 to 5.4 |
| Ambient, compose | 0.6 | |

Removed from the whole pass: the probes −8.4 (−11.6 to −5.1); the finite-difference normal −5.0 (−13.2 to −1.4).

## What it says

- **Every dear stage is a field call.** The probes are two `mapBody` calls, the finite-difference normal four, the
  wound shadow a short march. All the arithmetic of the look (materials, lights, ambient, compose) is about 1 ms.
- **The finite-difference normal runs on a CLEAN mob.** On a clean close-up it was 0.4 ms
  ([WOUNDS.md](../2026-11-09-sdf-perf-research/WOUNDS.md)); here it is 5 ms. So the analytic normal is giving up
  on a large share of a clean mob's pixels. Which reason code is not measured (debug mode 12 reads it).
- **The probes call `mapBody`, not `mapLean`,** on bodies the walk already proved lean. The walk's call through
  `mapLean` cost a third of the same call through `mapBody` ([LADDER.md](../2026-11-09-sdf-perf-research/LADDER.md)).
- **The wound shadow stage costs 2.6 ms on a mob with no wounds.** Not explained. Its gate is a hit near a wound, so
  it should not run; one more inlined copy of the field in the program may slow the rest (not tested).
- **Wounds on a mob cost in the walk.** Walk 13.1 to 28.6 ms; shading 19.1 to 23.9. The lean walk is decided per
  pixel: any wounded slot in the pixel's table sends every sample of that pixel through `mapBody`. In a mob the
  tables overlap, so one wounded body takes its neighbours' pixels off the fast path too. (On a single close-up body
  the earlier note found the opposite, wounds costing only in the shading; that was before the lean walk.)
- A stage is charged for what its cut names. The split between the two normal stages, and the small stages, carry
  that slack; the two removals do not.

## Leads, in order of size

1. **The lean walk per sample, not per pixel**, for wounded bodies: `mapLean` outside the wounds' bound,
   `mapBody` inside. The ladder prototyped it (`lean-sample`, `air-near-*`). Up to 15 ms on the wounded mob.
2. **The probes on `mapLean`** where the pixel is lean, or AO from something that is not a field call. Up to 5.6 ms
   clean, 8.7 wounded.
3. **Why the analytic normal gives up on a clean mob.** Up to 5 ms.
4. **The wound shadow stage on a clean frame.** 2.6 ms, unexplained.

Not shown: the compute march (this is the fragment pass), MAP28's butchers and flayers (the ring's zombies), motion.

Raw: [`results/shade-mob-ship.json`](results/shade-mob-ship.json), [`results/shade-mobw-ship.json`](results/shade-mobw-ship.json), run output beside them.
