
# wounds bench — 2026-09-02T03:59:12.858Z

Room 4 (4 bodies), throughput mode (chunk 10, warmup 120), 3 repeats per leg, legs alternating. Same firefight script on every leg — the only difference between legs is what is enabled. Only within-run deltas are reported: absolute numbers drift ~45% across runs on machine state alone.

| leg | overall p50 | p95 | walk | fire | gib | vs wounds-no-bone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| wounds-off | 9.07 | 11.56 | 9.23 | 9.33 | 8.48 | -2.2% |
| wounds-no-bone | 9.27 | 11.62 | 9.37 | 9.48 | 9 | — |
| wounds-bone | 9.27 | 12.25 | 9.44 | 9.67 | 9.1 | +0.0% |

## Repeatability — a delta smaller than a leg's spread is UNRESOLVED

| leg | p50 across reps | spread % |
| --- | --- | ---: |
| wounds-off | 9.07 / 9.07 / 9.05 | 0% |
| wounds-no-bone | 9.27 / 9.01 / 9.35 | 4% |
| wounds-bone | 9.27 / 9.21 / 9.36 | 2% |

## Measurement: wounds-bone over wounds-no-bone — a number, not a gate (spec §4 gate 7, owner call 2026-09-01)

**Measured: +0.0% — UNRESOLVED (under the baseline leg's 4% within-run spread; recorded as such, not as a measurement)**

Census (first leg run): [{"seg":"walk","bodies":"5→8","wounds":"0→0"},{"seg":"fire","bodies":"8→9","wounds":"0→15"},{"seg":"gib","bodies":"9→9","wounds":"15→16"}]

## Workload census per run — the wound pin is the SHOTS (4: three buckshot + the slug, fixed by the script); realised wounds and on-screen bodies vary with the wander, and a leg whose census splits from the others is measuring a different room

| rep | leg | max bodies | fire wounds | gib wounds |
| --- | --- | ---: | --- | --- |
| 0 | wounds-off | 9 | 0→15 | 15→16 |
| 0 | wounds-no-bone | 9 | 0→15 | 15→16 |
| 0 | wounds-bone | 9 | 0→16 | 16→16 |
| 1 | wounds-off | 9 | 0→16 | 16→17 |
| 1 | wounds-no-bone | 9 | 0→16 | 16→17 |
| 1 | wounds-bone | 9 | 0→16 | 16→16 |
| 2 | wounds-off | 9 | 0→16 | 16→17 |
| 2 | wounds-no-bone | 9 | 0→15 | 15→16 |
| 2 | wounds-bone | 9 | 0→16 | 16→16 |
