# Melee close-up bench — 2026-11-17T03:50:34.158Z

Scenario: the room's own cast WALKED to the player (5/6 within 3 m after 2400 sim frames, nearest 1.24 m), room 6, then frozen; one page, frame cap off.

Staged coverage is a settled mode-4 occupancy read (two agreeing live frames). The wound plan stamps chest/head/arm/thigh per body; a slug never stamps off the chest (SLUG.severRadius 0.13 severs a limb in one hit).

## Staged scene

| bodies gathered | sim frames | nearest | distances (m) | coverage | rasterised | bodies on screen | room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5/6 | 2400 | 1.24 m | 1.24 1.61 1.73 1.96 2.26 4.49 | 20.3% | 29.1% | 5 | 6 |

Camera search (yaw offset / pitch -> coverage), best three of 21: 0.6/-0.22 -> 20.3%, 0.6/-0.12 -> 19.1%, 0/-0.22 -> 19.1%

## clean

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `gpu:idle` | `compute:sdf-march` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 17.49 | 14.10 | 11.90 | 10.30 | 10.30 | 9.90 | 6.89 | 4.75 | 2.70 | 4.6 ⚠ |
| flat | 4 | 12.52 | 10.10 | 8.60 | 7.60 | 7.60 | 7.30 | 3.91 | 3.02 | 1.90 | 4.6 ⚠ |
| fvOff | 4 | 16.61 | 13.40 | 11.60 | 10.20 | 10.20 | 9.80 | 6.23 | 5.06 | 2.50 | 6.8 ⚠ |

## fire

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `gpu:idle` | `compute:sdf-march` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 14.54 | 12.30 | 9.90 | 8.30 | 8.30 | 8.00 | 5.72 | 2.67 | 2.30 | 6.7 ⚠ |
| flat | 4 | 12.79 | 9.70 | 7.70 | 6.70 | 6.70 | 6.40 | 4.00 | 2.03 | 1.90 | 6.7 ⚠ |
| refoldOff | 4 | 15.12 | 11.90 | 9.10 | 7.80 | 7.90 | 7.50 | 5.85 | 2.71 | 2.20 | 6.7 ⚠ |
| fvOff | 4 | 12.12 | 9.30 | 7.30 | 6.30 | 6.30 | 6.00 | 3.51 | 3.02 | 1.70 | 6.5 ⚠ |

> ⚠ **loadSuspect**: at least one block ran with the 1-minute load average above 4. Under that load the fenced frame ms read LONG (CPU contention), so cross-leg deltas are indicative only. Re-run on a quiet machine before judging a seam.

Machine load: max 1-minute average across all timed blocks **6.76** — **loadSuspect** (above 4, cross-leg deltas are indicative only).

## Per-phase census + scene

### clean

Screenshot: quietB/clean.png

| coverage | rasterised | occupancy | steps/hit | steps/miss | miss step share | mean clip depth (hit) | bodies on screen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.2% | 29.1% | 76.1% | 2.5 | 5.1 | 39.0% | 0.942 | 5 |
