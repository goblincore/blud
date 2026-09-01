
# Dungeon relighting cost gate — 2026-09-01T19:11:16.077Z

Room 4 (4 bodies), throughput mode (chunk 10, warmup 120), 3 repeats per leg, legs alternating. Same firefight script on every leg — deltas are lighting only.

| leg | overall p50 | p95 | walk | fire | gib | vs no-shadow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dungeon-off | 18.84 | 45.95 | 20.42 | 18.84 | 15.32 | +-12.2% |
| dungeon-no-shadow | 21.46 | 42.75 | 23.31 | 21.53 | 19.24 | — |
| dungeon-shadow | 21.36 | 42.2 | 22.62 | 21.36 | 20.57 | +-0.5% |

## Repeatability — a delta smaller than a leg's spread is UNRESOLVED

| leg | p50 across reps | spread % |
| --- | --- | ---: |
| dungeon-off | 18.84 / 21.07 / 18.52 | 14% |
| dungeon-no-shadow | 21.46 / 22.57 / 19.53 | 16% |
| dungeon-shadow | 23.27 / 21.36 / 20.01 | 16% |

## Gate: dungeon-shadow over dungeon-no-shadow <= +40%

**Measured: +-0.5% — PASS**

(dungeon-off reads -12.2% vs the shadowless dungeon — that is the flashlight-and-rig rest of the relighting.)

Census (first leg run): [{"seg":"walk","bodies":"9→9"},{"seg":"fire","bodies":"9→8"},{"seg":"gib","bodies":"8→4"}]
