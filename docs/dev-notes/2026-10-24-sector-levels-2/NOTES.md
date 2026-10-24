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

## Owner decision needed: light curve (column) and pool glowGain

1. **Sector light curve** — pick a column from the tuning sheet. My read: **max 0.35 γ1.6** keeps
   the dark and gives Doom's bright-room / dark-corridor rhythm; the current default is close to
   invisible; 0.6+ flattens the darkness. Then set `DEFAULT_SECTOR_LIGHT` in `sector-light.ts`.
2. **Pool glowGain** — my read: **0.35** (deep green, the flow reads, no glare). Then set
   `DEFAULT_GLOW_GAIN` in `game-sector-light.ts`. Try live first: `?glowgain=0.35` or
   `__sdfGame.sectorLight({ max: 0.35, gamma: 1.6, glowGain: 0.35 })`.
3. Whether ceilings should keep a whisper of self-light with sector light on (now 0).
4. Pool colour.

Defaults are **unchanged** (max 0.07, γ 2.2, glowGain 1.0) pending the owner's pick.

## Decisions from the plan, with numbers

- Sector light is a self-lit ambient term (`emissive = albedo × level`); default curve max 0.07,
  γ 2.2 → A/B 1.20 bright, 1.07–1.09 darkest (owner to retune, above).
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
- Pool light does not colour the room (walls next to the pool stay black at every glowGain); the
  likely cause and the bounce plan are in the [hand-off](../2026-10-24-sector-levels-handoff.md) item 2b.
- Cold boot likely +0.3–0.7 s vs plan 1 (above), unconfirmed under load.
- Shots include the debug HUD panels and the weapon; they are the same in every cell, so the means
  compare.
