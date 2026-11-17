# Melee close-up bench — 2026-11-17T04:18:11.165Z

Scenario: the room's own cast WALKED to the player (5/6 within 3 m after 2400 sim frames, nearest 1.24 m), room 6, then frozen; one page, frame cap off.

Staged coverage is a settled mode-4 occupancy read (two agreeing live frames). The wound plan stamps chest/head/arm/thigh per body; a slug never stamps off the chest (SLUG.severRadius 0.13 severs a limb in one hit).

## Staged scene

| bodies gathered | sim frames | nearest | distances (m) | coverage | rasterised | bodies on screen | room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5/6 | 2400 | 1.24 m | 1.24 1.61 1.73 1.96 2.26 4.49 | 20.3% | 29.1% | 5 | 6 |

Camera search (yaw offset / pitch -> coverage), best three of 21: 0.6/-0.22 -> 20.3%, 0.6/-0.12 -> 19.1%, 0/-0.22 -> 19.1%

## clean

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `compute:sdf-march` | `gpu:idle` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 9.84 | 7.70 | 6.70 | 6.00 | 6.00 | 5.80 | 3.29 | 2.94 | 1.70 | 5.4 ⚠ |
| flat | 4 | 9.43 | 7.40 | 6.40 | 5.70 | 5.70 | 5.50 | 1.79 | 3.16 | 1.50 | 5.6 ⚠ |
| lag0 | 4 | 10.94 | 8.70 | 7.50 | 6.60 | 6.60 | 6.30 | 3.37 | 3.71 | 1.80 | 5.6 ⚠ |
| b8 | 4 | 9.02 | 6.90 | 6.00 | 5.30 | 5.30 | 5.20 | 3.31 | 2.62 | 1.50 | 5.6 ⚠ |
| b8lag0 | 4 | 9.74 | 7.50 | 6.40 | 5.60 | 5.60 | 5.50 | 3.30 | 2.64 | 1.50 | 5.6 ⚠ |

## firecalm

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `compute:sdf-march` | `gpu:idle` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 10.84 | 8.70 | 6.70 | 5.80 | 5.80 | 5.70 | 3.43 | 2.12 | 1.60 | 5.5 ⚠ |
| flat | 4 | 9.64 | 7.70 | 5.90 | 5.20 | 5.20 | 5.00 | 1.82 | 2.96 | 1.50 | 5.4 ⚠ |
| refoldOff | 4 | 11.24 | 9.00 | 7.00 | 6.10 | 6.20 | 5.90 | 3.48 | 2.26 | 1.70 | 5.5 ⚠ |
| lag0 | 4 | 11.20 | 9.00 | 6.90 | 6.10 | 6.10 | 5.90 | 3.46 | 2.41 | 1.80 | 5.5 ⚠ |
| b8 | 4 | 11.65 | 8.80 | 7.00 | 6.00 | 6.00 | 5.90 | 3.45 | 2.33 | 1.70 | 5.5 ⚠ |
| b8lag0 | 4 | 11.60 | 9.40 | 7.20 | 6.20 | 6.20 | 6.10 | 3.50 | 2.99 | 1.80 | 5.5 ⚠ |

> ⚠ **loadSuspect**: at least one block ran with the 1-minute load average above 4. Under that load the fenced frame ms read LONG (CPU contention), so cross-leg deltas are indicative only. Re-run on a quiet machine before judging a seam.

Machine load: max 1-minute average across all timed blocks **5.56** — **loadSuspect** (above 4, cross-leg deltas are indicative only).

## Per-phase census + scene

### clean

Screenshot: after/clean.png

| coverage | rasterised | occupancy | steps/hit | steps/miss | miss step share | mean clip depth (hit) | bodies on screen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.2% | 29.1% | 76.1% | 2.5 | 5.1 | 39.0% | 0.942 | 5 |
