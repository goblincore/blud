# Sector levels 2 — glowing pools and sector light (notes)

[Plan](../../superpowers/plans/2026-10-24-sector-levels-2-pools-and-light.md) ·
[spec](../../superpowers/specs/2026-10-24-doom-sector-levels-design.md) §7–§8 ·
[plan 1 notes](../2026-10-24-sector-levels-1/NOTES.md) · 2026-10-24

## What was built

- **Sector light** (`sector-light.ts`, pure, tested): a sector's Doom light (0..1) → a self-lit
  ambient fraction of its albedo, `max × light^gamma`; flicker / pulse / strobe multipliers on the
  sim clock (strobe becomes a slow pulse under reduced flashes); one Float32Array of current levels.
- **Runtime** (`game-sector-light.ts`): the per-sector `uniformArray` refreshed each tick, the glow
  clock, the ceiling whisper (plan 1's 10 % only with sector light off), and the tuning seam
  `__sdfGame.sectorLight({ max, gamma, on, glowGain })`. `?doomlight=0` brings plan 1's look back.
- **Mesh** (`game-sector-mesh.ts`): a `sectorIndex` vertex attribute and per-mesh
  `MeshStandardNodeMaterial`s whose `emissiveNode = albedo × levels[sectorIndex]`; glow floors leave
  the stone batches for the hand-written WGSL surface `SECTOR_GLOW` (`sector-glow.wgsl.ts`) on meshes
  outside the level group, × a **`glowGain` uniform** (default 1.0; `?glowgain=<n>`; seam-settable,
  finite ≥ 0) added for the owner's tuning.
- **Hazard floors** (`hazard-floor.ts`, pure, tested): whole-point damage on a 1 s accumulator for
  `special: 'hurt'` sectors; `sectorInteriorPoint` (`sector-geometry.ts`) for gates.
- **Converter** (`doom_map.py`): one `mood: 'fire'` (cheap list tier) light per pool — E1M1 now has
  12 lights (9 fill + 3 pool).
- **Gate** (`scripts/sdf-game-doom-gate.mjs`, section 4): hazard damage at `?god=0`, glow reads green,
  sector light A/B; `SHOTS=1` adds `e1m1-pool.png`, `e1m1-pool-down.png`, `e1m1-bright-on/off.png`
  and `sector-light-sheet.png`; `TUNING=1` writes the owner's `tuning-sheet.png`. The look work runs
  on a second boot with `?god=1` so the hurt flash never tints a pool frame.

## Measured (gate, 2026-10-24, load average 5–30)

`LAB_VITE_PORT=5487 LAB_CDP_PORT=9487 LAB_TMP=.lab-tmp SHOTS=1 TUNING=1 bash scripts/sdf-game-doom-gate.sh`
— everything passes:

```
ok   hazard: sector 0 (nukage, 5/s) took health 100 -> 85 in 3.2 s
ok   hazard: off the pool health holds (85 -> 85)
glow: centre-30% mean R 69.8 G 185.5 B 89.6, G/R 2.66
ok   glow: the pool reads green
sector light A/B, bright sector 25 (light 1), default curve max 0.07 γ2.2: on 19.14 / off 15.98 = 1.198
sector light A/B, darkest sector 6 (light 0.502), default curve: on 14.70 / off 13.51 = 1.088 (report only)
ok   sector light A/B: on 19.14 / off 15.98 = 1.198 at default max 0.07 γ2.2
```

- **Hazard:** 15 points in 3.2 s at 5/s (the 1 s accumulator: 3 ticks), none off the pool.
- **Glow G/R:** 2.64–2.66 looking down (pitch −1.2); G 185 of 255 at glowGain 1.
- **Sector light A/B** (mean frame luminance, flashlight OFF via `setFlashlight(false)`, facing a wall
  2.5 m off): bright sector 25 on/off **1.20** at the current default. The gate asserts on the
  shipped default curve (on/off > 1.05, else FAIL); max 0.35 γ1.6 is measured at the same pose and
  printed as report-only. Darkest sector 6 (light 0.502) **1.07–1.09**. The earlier "+0.3–1.6 grey,
  invisible" reading was taken with the flashlight on; with it off the default adds +2.4–3.3 grey
  in bright sectors — measurable, still very subtle by eye (see the sheet).
- **Budget** (start pose, median of three `timeDraws(21)`): 9.9–11.2 ms, 103–226 draw calls across
  three runs (readings 10.3/11.2/11.3, 9.2/9.9/10.7, 6.5/10.0/30.1). Plan 1 measured 5.5 ms on a
  quieter machine; the draw-call reading is as noisy as plan 1 noted (102/224/346 there).
- **Cold-boot `drawOnce`** (`scripts/boot-time.mjs … level=doom-e1m1`, fresh profile, base = plan 1
  code at 336ec236 in a temporary worktree, pairs run back to back, load 15–30):

  | pair | base ms | branch ms |
  | --- | --- | --- |
  | 1 | 1575.6 | 2243.6 |
  | 2 | 1081.2 | 1055.7 |
  | 3 | 404.5 | 790.5 |
  | 4 | 714.1 | 1033.7 |

  Unpaired earlier: branch 2266.7, 2619.9; base 830.0, 1284.4; branch `&doomlight=0` 1062.3.
  The branch is slower in 3 of 4 pairs by **+320..+670 ms** (one pair equal). Likely cause: one
  node material per sector mesh (more pipelines to compile) plus the glow WGSL. Noisy under load;
  re-measure on a quiet machine before acting. Not blocking (report only, per the rules).

## Tuning sheet (`.lab-tmp/doom/tuning-sheet.png`, never committed)

Rows: bright A (sector 25, zone 7, Doom light 1, at (13.97, −35.16) yaw −2.75), bright B (sector 45,
zone 8, light 1, at (−43.28, −12.16) floor 4.25, yaw 0.39), darkest walkable (sector 6, zone 5, light
0.502, at (34.47, 11.53) floor −4.25, yaw −π/2) — each facing a wall 2.5 m off, flashlight OFF —
and the pool (sector 0, the hazard point, yaw 0.6, pitch −0.5). Mean grey (R+G+B)/3 of the whole
frame per cell (HUD and debug panels included, identical in every cell):

| row | off | max 0.07 γ2.2 (current) | max 0.35 γ1.6 | max 0.6 γ1.2 | max 1.0 γ1.0 |
| --- | --- | --- | --- | --- | --- |
| bright A (25) | 15.2 | 18.4 | 28.9 | 36.1 | 44.3 |
| bright B (45) | 18.2 | 20.6 | 29.1 | 34.6 | 41.1 |
| darkest (6, light 0.5) | 12.6 | 13.7 | 20.9 | 28.3 | 36.5 |

| pool (sector 0) | glowGain 1.0 | 0.6 | 0.35 | 0.2 |
| --- | --- | --- | --- | --- |
| mean grey | 105.6 | 81.3 | 70.1 | 53.8 |
| mean R / G / B | 73 / 158 / 85 | 56 / 123 / 65 | 49 / 105 / 56 | 38 / 81 / 43 |

What the columns look like:
- **off** — plan 1: walls only where a fill light reaches; the bright rooms read near-black away
  from the fills.
- **max 0.07 γ2.2 (current)** — brick courses just perceptible in bright sectors, the darkest
  sector indistinguishable from off. Bright and dark sectors look alike: no Doom rhythm yet.
- **max 0.35 γ1.6** — the brick wall reads clearly in bright rooms, still dark and moody; the
  darkest sector is a dim but legible wall. The bright/dark gap shows (29 vs 21 grey).
- **max 0.6 γ1.2** — bright rooms are evenly lit grey brick, the darkness is mostly gone; the dark
  sector is close to the bright ones (28 vs 35).
- **max 1.0 γ1.0** — flat, fully lit brick everywhere; loses the darkness the owner liked, and the
  bright/dark contrast compresses again (36 vs 44).
- **Pool glowGain 1.0** — a saturated flat light green slab, flow pattern washed out, glaring
  against the black room. **0.6** — still bright, the flow blobs start to read. **0.35** — a deep
  toxic green with clear light/dark flow, sits better in the dark map. **0.2** — dark bottle green,
  flow still visible, starts to look like paint rather than light.
- In every pool cell the surrounding walls stay black: the pool light barely colours the room
  (hand-off item 2b, the next task).

`.lab-tmp/doom/sector-light-sheet.png` (plan step 2): on/off pairs for bright A, bright B and the
darkest sector at the default (each also at max 0.35 γ1.6, report-only), and the pool at pitch
−0.5 and −1.2.

## Owner decision: light curve (column) and pool glowGain — decided 2026-10-24

The owner picked from the tuning sheet (in chat, 2026-10-24):

1. **Sector light curve: max 0.35 γ1.6** (`DEFAULT_SECTOR_LIGHT` in `sector-light.ts`; was 0.07 γ2.2,
   barely visible). Doom 255 → 35 % of albedo, Doom 160 → ~16.6 %.
2. **Pool glowGain: 0.35** (`DEFAULT_GLOW_GAIN` in `game-sector-light.ts`; was 1.0, glaring).

The gate asserts the A/B on the new default; the old 0.07 γ2.2 is measured beside it, report-only.
At the new defaults (gate run 2026-10-24 18:48, load ~14–40, all pass):

```
glow: centre-30% mean R 40.5 G 115.5 B 53.1, G/R 2.85
sector light A/B, bright sector 25 (light 1), default curve max 0.35 γ1.6: on 29.76 / off 15.95 = 1.866
sector light A/B, bright sector 25, max 0.07 γ2.2: on 19.13 / off 15.95 = 1.200 (report only)
sector light A/B, darkest sector 6 (light 0.502), default curve: on 21.71 / off 13.51 = 1.606 (report only)
budget: 123 draw calls, 10.90 ms a frame at the start (readings 10.4, 10.9, 11.3)
```

(One earlier run of the review-fix commit failed only the frame budget, 51.9 ms / 369 draws, under
a load spike; the run above, after both commits, passed at 10.9 ms.)

Still open for the owner: whether ceilings keep a whisper of self-light with sector light on (now 0);
pool colour; the bounce strength (below).

## Decisions from the plan, with numbers

- Sector light is a self-lit ambient term (`emissive = albedo × level`); the plan's curve max 0.07,
  γ 2.2 → A/B 1.20 bright, 1.07–1.09 darkest; the owner's default is now max 0.35 γ1.6 (above).
- Ceilings lose plan 1's 10 % whisper while sector light is on.
- Strobe follows Doom's rhythm (0.14 s bright of 1 s); reduced flashes → a 3 s pulse.
- Pool lights are `mood: 'fire'` (cheap list tier, a gentle flicker).
- The wall halo is the pool light only — and the sheet shows it is too weak to read (2b).
- Bodies are not darkened per sector (no enemies until plan 3a).
- `?renderer=deferred` drops custom nodes: no sector light or glow there.

## Known gaps

- Deferred renderer: sector light and glow show in the forward path only.
- Bodies are not darkened per sector.
- Strobe sectors under the reduced-flashes setting become a slow pulse.
- Pool bounce (below): no occlusion by bodies or props, a per-vertex bake (big floor triangles far from
  pools interpolate it linearly), the pool's own cheap light is still masked to the pool's zone.
- Cold boot likely +0.3–0.7 s vs plan 1 (above), unconfirmed under load.
- Shots include the debug HUD panels and the weapon; they are the same in every cell, so the means
  compare.

## Glow bounce (hand-off item 2b) — 2026-10-24

**Diagnosis.** All three pool lights reached a light list. Sector 0's (the big pool, 164 m²) was correctly
in zone 0, but every surface round the pool belongs to sector 1, which is zone 1. Sector levels have no
tunnels, so `accentRoomsFor` / the cheap-tier room mask let a zone's meshes shade only their own zone's
accents. The pool light therefore lit only the pit's own 0.75 m risers and the ceiling above it. The
suspected box bug was real for a different pool: sector 53's light was in zone 9 (first overlapping box),
not zone 10. Fixed in `sector-json.ts` `rehomeAccents` (the sector under a light decides its zone, as for
keyAt and spawnList; room levels untouched).

**Bounce.** `sector-bounce.ts` (pure, tested) bakes a per-vertex RGB `glowBounce` at mesh build:
Σ over glow sectors of `GLOW_BASE_RGB[kind] × 0.7 × min(1, area/16 m²) × 1/(1+(d/3)²) × fade(9..12 m)
× facing × seen`. d is 3D (nearest pool point, plus the height above or below the pool floor).
facing = (n·L + 0.5)/1.5. seen = the share of two rays (to the nearest pool point and to its interior
point, aimed 0.1 m over the rim) that cross no one-sided wall and no lip or closed door at the ray's
height. The pool's own rim never blocks, because the pit glows up to it. This stops green bleeding
through solid walls, and it is simpler than a sector-adjacency rule. The emissive gains
`albedo × glowBounce × bounceGain × glowGain`: scaling by glowGain keeps the room in step with the
pool's brightness when the owner retunes it. Seams: `?bouncegain=` (empty = default; finite ≥ 0) and
`__sdfGame.sectorLight({ bounceGain })`.

**Mesh density.** Lines within 12 m of a pool box are split into pieces of at most 2 m
(`refineNearGlow`; both sides share the points). Walls are cut in height on a 2 m world grid at
each edge end near a pool (`wallRows`, zipped by `wallStrip`), so walls meeting at a corner cut it the
same way: no new T-junctions. Wall u is now world-continuous along a line. E1M1 triangles go
**1906 → 4687** (floors and ceilings 900 → 1747, walls 1006 → 2940). The bake is about 40 ms
(5.5k unique vertices, 1.6k lit; vitest timing).

**Default bounceGain 36: owner pick (2026-10-24 playtest: 12 was too weak, 36 "ok").** The first default, 12, was chosen by measurement. The gate pose faces the west wall (x = 10) of the
pool room, 4.5 m off the pool's edge, 3.5 m away, with the flashlight off. Wall crop (centre 30 %) G/R at
bounceGain × 0 / ½ / 1 / 2 is **1.19 / 1.51 / 1.73 / 1.98**. At 6 it was 1.52, which failed the gate's
≥ off × 1.3 bar and read as only a hint of green by eye. At 12, the wide view from in the pool reads as
a green-lit room. The risers and floor round the pit are clearly green, and the far wall has a green
cast without looking like paint. The tuning sheet's bounce row (the pool room wide, 0 / 6 / 12 / 24)
measures G/R 1.36 / 1.53 / 1.63 / 1.76.

Gate (`LAB_VITE_PORT=5491 LAB_CDP_PORT=9491 LAB_TMP=.lab-tmp SHOTS=1 TUNING=1`, load ~13–60, all pass):

```
budget: 103 draw calls, 12.80 ms a frame at the start (readings 11.1, 12.8, 13.0)
glow: centre-30% mean R 40.6 G 115.6 B 53.2, G/R 2.85
sector light A/B, bright sector 25 (light 1), default curve max 0.35 γ1.6: on 29.74 / off 15.98 = 1.861
bounce: wall crop G/R at bounceGain × 0 / ½ / 1 / 2: 1.19 / 1.51 / 1.73 / 1.98
ok   bounce: wall G/R 1.73 on vs 1.19 off at bounceGain 12
```

Shots: `e1m1-bounce-wall-on/off.png` (the gate pose), `e1m1-pool-room-on/off.png` (wide, bounceGain
12 vs 0), and `tuning-sheet.png`, which now has the bounce row; 0.35 γ1.6 and glowGain 0.35 are
labelled "(default)".

Occlusion detail (review fix): the pool's own two-sided lines still occlude. Only their floor bound is
dropped, and only while the neighbour's floor is within 1 m of the pool's. So a pool ceiling lower than
the room's (a soffit) keeps the room's ceiling dark beyond it, and a riser taller than 1 m shades the
room above. Tests cover the lip, the closed door, the soffit and the tall riser.

Caveats:
- The bounce is emissive, so it also shows with `?doomlight=0`. That skews the sector-light A/B "off"
  frames a little near pools; the A/B poses are away from them.
- The deferred path (`?renderer=deferred`) drops the custom emissive node, so there is no bounce there.
- Cost scales with glow sectors × occluders × near vertices. A map with many thin nukage strips (each
  its own sector) could make the bake slow. The follow-up would be merging adjacent glow sectors of the
  same kind into one source, and/or a uniform grid for the occluders.

Skipped: a full-tier (shadowed or non-cheap) light for the biggest pool. It would sit in the same
zone-mask trap and need neighbouring-zone masks (a light `rooms` list through `LampInput` and
`accentRoomsFor`). That is the right follow-up if bodies standing in a pool room should catch green
from a direction. Bodies get no bounce today.
