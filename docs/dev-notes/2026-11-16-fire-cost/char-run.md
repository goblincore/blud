# Melee close-up bench — 2026-11-17T03:57:27.635Z

Scenario: the room's own cast WALKED to the player (5/6 within 3 m after 2400 sim frames, nearest 1.24 m), room 6, then frozen; one page, frame cap off.

Staged coverage is a settled mode-4 occupancy read (two agreeing live frames). The wound plan stamps chest/head/arm/thigh per body; a slug never stamps off the chest (SLUG.severRadius 0.13 severs a limb in one hit).

## Staged scene

| bodies gathered | sim frames | nearest | distances (m) | coverage | rasterised | bodies on screen | room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5/6 | 2400 | 1.24 m | 1.24 1.61 1.73 1.96 2.26 4.49 | 20.3% | 29.1% | 5 | 6 |

Camera search (yaw offset / pitch -> coverage), best three of 21: 0.6/-0.22 -> 20.3%, 0.6/-0.12 -> 19.1%, 0/-0.22 -> 19.1%

## clean

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `sdf:polys` | `cpu:tick` | `compute:sdf-march` | `compute:tile-bin` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 7.20 | 4.40 | 3.70 | 3.20 | 3.20 | 3.10 | 1.10 | 0.90 | 0.82 | 0.39 | 4.0 |
| flat | 4 | 6.42 | 5.00 | 4.30 | 3.70 | 3.70 | 3.50 | 1.11 | 1.10 | 1.77 | 0.36 | 4.0 |
| charOff | 4 | 7.11 | 4.30 | 3.70 | 3.20 | 3.20 | 3.10 | 1.10 | 0.90 | 3.03 | 2.50 | 4.0 |
| charOn | 4 | 7.19 | 4.00 | 3.40 | 3.00 | 3.00 | 2.90 | 1.10 | 0.80 | 3.12 | 2.50 | 3.8 |
| charOff2 | 4 | 7.28 | 5.80 | 5.00 | 4.40 | 4.40 | 4.20 | 1.12 | 1.20 | 3.14 | 2.46 | 3.8 |

## firecalm

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `compute:sdf-march` | `gpu:idle` | `post:fire-march` | `compute:tile-bin` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 10.56 | 8.20 | 6.50 | 5.70 | 5.70 | 5.50 | 3.45 | 1.54 | 1.54 | 0.43 | 1.50 | 5.0 ⚠ |
| flat | 4 | 9.82 | 8.20 | 6.20 | 5.50 | 5.60 | 5.30 | 1.84 | 3.18 | 1.64 | 0.19 | 1.50 | 5.0 ⚠ |
| refoldOff | 4 | 10.42 | 7.00 | 5.50 | 4.90 | 4.90 | 4.70 | 3.40 | 0.20 | 1.63 | 1.42 | 1.30 | 5.0 ⚠ |
| charOff | 4 | 10.68 | 7.50 | 5.80 | 5.10 | 5.10 | 4.90 | 3.46 | 0.29 | 1.69 | 0.41 | 1.50 | 5.0 ⚠ |
| charOn | 4 | 10.85 | 7.70 | 6.00 | 5.20 | 5.20 | 5.00 | 3.49 | 0.20 | 1.65 | 0.42 | 1.30 | 5.0 ⚠ |
| charOff2 | 4 | 11.24 | 7.60 | 5.90 | 5.20 | 5.20 | 4.90 | 3.44 | 0.13 | 0.67 | 1.52 | 1.40 | 5.0 ⚠ |

> ⚠ **loadSuspect**: at least one block ran with the 1-minute load average above 4. Under that load the fenced frame ms read LONG (CPU contention), so cross-leg deltas are indicative only. Re-run on a quiet machine before judging a seam.

Machine load: max 1-minute average across all timed blocks **4.96** — **loadSuspect** (above 4, cross-leg deltas are indicative only).

## Per-phase census + scene

### clean

Screenshot: char/clean.png

| coverage | rasterised | occupancy | steps/hit | steps/miss | miss step share | mean clip depth (hit) | bodies on screen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.2% | 29.1% | 76.1% | 2.5 | 5.1 | 39.0% | 0.942 | 5 |
