# Cost-weighted march census — where the close-up work actually is (2026-09-22)

**Why:** the step census over-ranked miss rays (the miss cull removed 36-41 % of steps for ~0.5 ms).
This one counts inner-loop WORK: prim evaluations (foldGroup, incl. owner re-folds) and wound rows
walked past `applyWounds`' reach test.

**Instrument:** march debug modes **13** (walk, returned before the discard so misses report) and
**14** (same counters after the whole post-hit chain; hits only). Channels: r = prims, g = wound rows,
b = steps + 1000·hit + 2000·(hit near a wound), a = clip depth. `costCensus` in
`scripts/lib/sdf-melee-stage.mjs` (tests in `scripts/sdf-melee-stage.test.mjs`); the melee bench runs it
per phase (settled reads) and saves `<phase>-cost-{walk,total}-400x300.f32`. A never-rasterised texel
holds the scene clear colour (b ~ 0.01), not zero.

**Calibration (rough):** clean walk-only (`flat`) 10.2 ms ~ 1.59 M walk prims -> ~6.4 ns/prim; wounded walk
12.7 ms ~ 1.80 M prims + 1.26 M wound rows -> a wound row costs ~1/7 of a prim. Prims are the currency.

## Where the work is (melee scene, ship: raiser gate on)

Share of ALL prim evaluations in the frame (walk + post-hit):

| where | clean | wounded |
| --- | ---: | ---: |
| wound-zone hits | — | **68 %** (walk 32 %, post-hit 35 %); 76 % of wound rows |
| interior hits | **54 %** (walk 37 %, post-hit 17 %) | 8 % |
| grazing misses 1-4 px from a hit | **21 %** | **12 %** |
| far misses 5+ px | 21 % | 11 % |
| silhouette hits | 5 % | 1 % |

Per pixel: wound hit 66 walk + 72 post prims (post-hit costs MORE than finding the hit); interior hit
43 + 20 (clean); grazing miss 1-2 px ~180-200 walk prims (the most expensive pixels in the frame); miss
17+ px from a body ~9 (nearly free — what the miss cull removed).

## Ranked levers

1. **Post-hit work in wound zones (35 % of wounded-frame prims).** Normals, AO and scatter each re-run the
   full wounded field incl. the re-fold. Candidate: AO/scatter probes on a cheaper field (no re-fold, fewer
   wound rows) — soft terms; normals stay exact. Look change, owner judges.
2. **Wound-zone walk (32 %).** ~15 prims/step vs ~9 elsewhere (wounds sit where limbs meet).
3. **Grazing misses (12-21 %).** Rays skimming a silhouette; an exit test once a ray is provably moving
   away from the surface needs a correctness argument.

Open: debug readbacks (modes 4/13/14) read blank in the burn-panic state, so this census cannot see the
fire phase yet.

## Levers tried (2026-09-22)

- **Cheap AO/scatter probes** (`setCheapProbes`, OFF): no measurable change. With the raiser gate the
  re-fold rarely fires 6 cm off the surface, so there was nothing to skip. AO + scatter are only 2 of ~6
  post-hit field calls (~12 % of wounded prims); normals are ~4.
- **Where the gated re-fold still costs** (census leg `setOwnerRefold(false)`): 23.5 % of wounded prims +
  1.2 M wound rows (54 % of rows), almost all on wound pixels: walk 10.9 %, post-hit (normal taps) 10.4 %.
- **NORMAL HINT — SHIPS** (`SHIP_COUNTS2_Z = gate + 32`; `setNormalHint(false)` = old). The re-fold is
  decided once per pixel at the hit; calcNormal's four taps re-fold only the limb that won there (or none).
  Wounded melee `sdf:march` 16.4 -> 15.4 ms (-6.5 % prims, -356 k wound rows), clean unchanged. Look: 52 of
  120 k march-target px differ by > 0.02, on one crater edge; **owner A/B in play: no visible difference.**
- **Owner rule:** per-pixel accuracy is usually not required — an FPS, not a simulation. A shortcut passes
  if it is invisible in play (A/B by eye); bit-identity is not the bar.
- **DISTANCE-BASED HIT ACCEPT — SHIPS** (`GAME_AA_NEAR = 6`, `GAME_AA_FADE_M = 3`; `setAaDistance(near, fadeM)`,
  0 = off). Uniform strength 4 (`setAa(4)`) saved 11-22 % of prims but the owner saw fatter/brighter edges
  on FAR bodies and nothing up close — the fattening is ~constant in pixels, so it only reads on small
  outlines. Near 6, fading to 1 over 1.5-3 m: wounded-melee prim work -14.8 %, clean -28.6 %; `sdf:march`
  wounded ~16.7 -> ~14.4 ms (load up to 6, indicative). Owner A/B: invisible. Also judged 12 "okay":
  -19.3 % / -36.9 % prims — a one-number follow-up (rays stop up to ~17 mm short at 1 m there).

## Before/after (PR #14) — melee bench, one page, alternating, 4 reps, load 3.2-4.5

`before` = both new defaults off (main's ship frame). `sdf:march`: clean 11.9 -> 11.3 ms (-5 %), wounded
17.5 -> 14.9 ms (-15 %), wounded+fire 24.2 -> 21.2 ms (-12 %). Frame p50: 14.8 -> 14.2, 20.4 -> 17.6,
33.3 -> 30.5 ms.

## Round 2 (after PR #14 merged) — census on the new defaults

Total prim work: clean 1.93 M -> 0.84 M, wounded 2.97 M -> 1.63 M (separate runs; stamps differ slightly).
Steps per interior hit 4.7 -> 2.7. Shares of the new total, wounded: wound-zone hits walk 34 % / shading
35 %; misses 17 %; interior 13 %. Re-fold still 24 % (walk 14 %, shading 7 %). Clean: interior walk 38 % /
shading 28 %, misses 31 %.

- **Analytic normals near owned wounds** (`setAnalyticOwned`, counts2.z + 64, OFF). Where no limb won the
  re-fold at the hit, the field is the plain wounded union, so the analytic gradient path need not bail on
  owned wounds. Wounded `sdf:march` 13.40 -> 13.15 ms (-2 %, near noise; load 6.6); a few crater-edge px shift
  up to 0.68. **Not shipped.** CENSUS BLIND SPOT: the analytic path (`ngBody`) folds prims itself and does not
  count them, so the census showed a bogus -44 % — use timing for any lever that moves work into ngBody.

## Walk skip (parked) and the whole-frame breakdown (2026-09-22)

- **Walk re-fold study** (debug mode 15, `MELEE_REFOLD_STUDY=1`): 119,866 walk re-folds attempted over 13.6 k
  pixels, 8.6 % won; 4,754 pixels see a limb win (all hits). ~3 limbs re-folded per step.
- **Walk skip** (`setWalkSkip`, counts2.z + 128, OFF): skip the re-fold while the last losing gap (limb - body)
  cannot have closed (budget 4 x stepLen per step). Saved 0.2 % of prims — the losing gaps are millimetres
  (limbs genuinely sit against the crater), so there is nothing to skip. The whole re-fold now costs ~1.5 ms
  (wounded 13.9 vs 12.5 re-fold off).

Whole frame, melee, ship, 4 reps (load <= 6.3). GPU-bound in every phase (frame ~ GPU span):

| ms p50 | clean | wounded | wounded + fire |
| --- | ---: | ---: | ---: |
| frame | 13.7 | 17.9 | 31.0 |
| `sdf:march` | 10.5 | 14.9 | 21.7 |
| `post:fire-march` | — | — | 5.0 |
| `sdf:polys` | 1.2 | 1.2 | 1.3 |
| upscaler | 0.5 | 0.5 | 0.5 |
| CPU `cpu:draw` (crowd SDF uniforms) | 5.3 | 4.2 | 3.3 |

Next: the flame march (`post:fire-march`, 5 ms, never tuned), then bodies-at-the-lens (the panic case).
CPU crowd uniform upload (~4-5 ms) is not the long pole today but would be with more bodies.

## Flames (2026-09-22)

- Sweep (fire phase, LOADED run, ratios valid): `post:fire-march` 48/0.4 (ship) 8.3 ms; 32 steps 8.1; 24 steps 6.0;
  16 steps 4.3; 0.3 res 5.6; **24 + 0.3 = 3.4 ms (-58 %)**. Default now 24 / 0.3 (owner: worse but acceptable).
- Compensation tried, both OFF: `streakPx` (vertical smear in the fire composite) — owner: looks bad, should be the
  SELECTIVE SHUTTER blur (note: the shutter resolve blurs the separately shaded blood LAYER, not the scene, so fire
  needs its own layer/seed route); `heatPx` (warp in the final blit) — owner: too high frequency, wrong shape; wants a
  very large wavelength, subtle distortion. Next session: see HANDOFF.md.
