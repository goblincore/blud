# Melee close-up bench — 2026-11-17T03:48:55.088Z

Scenario: the room's own cast WALKED to the player (5/6 within 3 m after 2400 sim frames, nearest 1.24 m), room 6, then frozen; one page, frame cap off.

Staged coverage is a settled mode-4 occupancy read (two agreeing live frames). The wound plan stamps chest/head/arm/thigh per body; a slug never stamps off the chest (SLUG.severRadius 0.13 severs a limb in one hit).

## Staged scene

| bodies gathered | sim frames | nearest | distances (m) | coverage | rasterised | bodies on screen | room |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5/6 | 2400 | 1.24 m | 1.24 1.61 1.73 1.96 2.26 4.49 | 20.3% | 29.1% | 5 | 6 |

Camera search (yaw offset / pitch -> coverage), best three of 21: 0.6/-0.22 -> 20.3%, 0.6/-0.12 -> 19.1%, 0/-0.22 -> 19.1%

## clean

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `compute:tile-bin` | `compute:sdf-march` | `sdf:polys` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 7.03 | 3.70 | 3.10 | 2.60 | 2.60 | 2.50 | 1.67 | 1.20 | 1.10 | 0.70 | 4.1 ⚠ |
| flat | 4 | 5.48 | 3.80 | 3.20 | 2.80 | 2.80 | 2.70 | 0.40 | 1.45 | 1.10 | 0.70 | 4.1 ⚠ |
| fvOff | 4 | 7.04 | 3.50 | 3.00 | 2.60 | 2.60 | 2.50 | 2.43 | 1.19 | 1.10 | 0.70 | 4.1 ⚠ |
| fvBodies8 | 4 | 6.98 | 3.70 | 3.20 | 2.70 | 2.70 | 2.60 | 2.52 | 1.70 | 1.10 | 0.80 | 4.1 ⚠ |

## thaw

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `compute:sdf-march` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-inner` | `compute:tile-bin` | `sdf:polys` | `cpu:tick` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 7.17 | 3.80 | 3.30 | 3.11 | 2.90 | 2.90 | 2.90 | 1.35 | 1.11 | 0.80 | 4.0 |
| flat | 4 | 6.06 | 4.60 | 4.00 | 1.77 | 3.50 | 3.50 | 3.40 | 0.14 | 1.15 | 1.00 | 4.0 |
| refoldOff | 4 | 7.13 | 3.90 | 3.40 | 0.85 | 2.90 | 2.90 | 2.90 | 1.43 | 1.11 | 0.80 | 4.0 |
| fvOff | 4 | 7.22 | 3.90 | 3.50 | 1.18 | 3.00 | 3.00 | 3.00 | 1.18 | 1.12 | 0.80 | 3.8 |
| fvBodies8 | 4 | 7.21 | 4.00 | 3.40 | 1.34 | 3.10 | 3.00 | 2.90 | 2.52 | 1.11 | 0.80 | 4.0 |

## firecalm

| leg | n | frame p50 ms | `cpu:draw` | `cpu:phase:draw:uniforms-cull-crowd` | `cpu:phase:crowd-goo-outer` | `cpu:phase:crowd-sdf-render` | `cpu:phase:crowd-sdf-inner` | `compute:sdf-march` | `post:fire-march` | `compute:tile-bin` | `cpu:tick` | `sdf:polys` | max load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ship | 4 | 9.14 | 5.20 | 4.10 | 3.50 | 3.50 | 3.40 | 3.31 | 1.51 | 1.40 | 0.90 | 1.10 | 4.1 ⚠ |
| flat | 4 | 8.06 | 6.30 | 4.90 | 4.20 | 4.20 | 4.10 | 1.73 | 0.65 | 0.38 | 1.20 | 1.15 | 4.1 ⚠ |
| refoldOff | 4 | 9.15 | 5.90 | 4.50 | 3.90 | 3.90 | 3.90 | 3.27 | 1.66 | 1.52 | 1.00 | 1.10 | 4.1 ⚠ |
| fvOff | 4 | 7.78 | 6.10 | 4.80 | 4.20 | 4.20 | 4.10 | 3.15 | 0.03 | 0.15 | 1.10 | 1.11 | 4.1 ⚠ |
| fvBodies8 | 4 | 11.82 | 7.30 | 6.50 | 6.20 | 6.20 | 6.20 | 3.25 | 4.22 | 2.26 | 0.70 | 1.10 | 3.9 |

> ⚠ **loadSuspect**: at least one block ran with the 1-minute load average above 4. Under that load the fenced frame ms read LONG (CPU contention), so cross-leg deltas are indicative only. Re-run on a quiet machine before judging a seam.

Machine load: max 1-minute average across all timed blocks **4.09** — **loadSuspect** (above 4, cross-leg deltas are indicative only).

## Per-phase census + scene

### clean

Screenshot: quietA/clean.png

| coverage | rasterised | occupancy | steps/hit | steps/miss | miss step share | mean clip depth (hit) | bodies on screen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22.2% | 29.1% | 76.1% | 2.5 | 5.1 | 39.0% | 0.942 | 5 |
