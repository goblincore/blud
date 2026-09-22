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
