# Close-up task 2 — the post-hit probes

**Date:** 2026-09-05 · **Branch:** `dispatch/2026-09-04-closeup-task-2`
**Status:** in progress · **Base:** task-1b (chain 1b → 4 → **2** → 3 → 5)

## Scope, and what task 1b left me

The six post-hit field evaluations on every hit pixel: `calcNormal` (4
mapBody evals), the scatter-thickness probe (1), the AO probe (1). Task 1b's
Question A answer (shading ~30% of the wounded fill-screen frame, wound walk
~41%) confirms the program is aimed at the right half — but the biggest
single column (the wound-adjacent walk) is NOT this task; this task takes the
six. Task 3 (depth prepass) is confirmed alive and un-gated (the fog
root-cause), and follows this task in the chain.

## Design: one lever, three modes (perfCfg.z)

`debugCfg` was full (vec2, both channels pinned by tests), so the lever lives
on **perfCfg.z**, with mode 2's straddle threshold on **perfCfg.w** (world
metres). perfCfg already rode every variant literal — zero new MARCH_BODY
inputs, so the melt-literal incident's failure class is structurally
excluded. Boot constants `GAME_NORMAL_MODE` / `GAME_NORMAL_THRESH`; seams
`__sdfGame.setNormalMode(mode, thresh?)` / `.normalMode` / `.normalThresh`;
chunks follow the bodies through the same seam (the setFlatAlbedo rule).

- **mode 0** — the tetrahedron stencil, byte-for-byte the pre-task-2 call.
- **mode 1** — 3-tap forward difference. The walk already evaluated
  `f(p)`: it accepted this `t` because `mapBody` returned `d < hitEps` AT p,
  so `hitField.x` is the free base and the stencil is 3 evals, not 4.
  **The noise trap:** the walk evaluates mapBody with noise 0 (the fbm lives
  on the normal), while calcNormal's taps each carry the silhouette fbm at
  `marchCfg.z * (1 - gloss/metal)` (0.016 at ship — ACTIVE). Mixing the
  smooth base with fbm taps divides the whole fbm by e (0.0015). The base is
  therefore reconstructed exactly as MAP_BODY builds it —
  `hitField.x + fbm(anchor * 3.0) * nAmp`, where `anchor` is the same
  dominant-prim rest-frame anchor the fragment already computes. One fbm
  (sixteen hash13 lookups), not one mapBody eval. The 1/e division is
  omitted (the vector is normalised immediately; a shared positive scale
  cannot change direction).
- **mode 2** — `cross(dpdx(p), dpdy(p))` of the hit position, zero field
  evals, with a `length(pdx) + length(pdy) > perfCfg.w` fallback to the
  stencil (straddling guard). The mode branch is uniform control flow
  (perfCfg is a uniform), which is what makes dpdx legal there.

No deep-negative guard was needed on mode 1: the forward difference is
`f(p + e·axis) − f(p)`, and a constant landing-offset error cancels in the
difference — the stencil is valid wherever the field is smooth, which is
everywhere the old stencil sampled. Its error class is the old one's: first
order instead of tetrahedral, same 1.5 mm scale.

## Step 1 (forward difference) — SHIP

- **Parity (the gate):** mode 0 on this tree vs the STASHED BASE tree, same
  staged frame, weapon-masked HUD-excluded diff: **0.1645% ≤ 0.1912%**
  (this tree's own same-boot noise floor, two fresh mode-0 boots). Off is
  pixel-identical. Pinned in-suite by the byte-for-byte mode-0 call test.
- **Look:** mode 1 vs mode 0 — indistinguishable at fill-screen full frame
  AND in 3× crops of the shoulder gleam and chest sheen. Diff map 0.41%
  (2× floor): sparse speckle confined to high-curvature contours — clavicle
  line, finger gaps, crater lip, silhouette edges — exactly where the
  first-order stencil's truncation error differs from the tetrahedral one.
  No bands, no structures, no new artifact class. Both stencil error profiles
  sample the same field at the same 1.5 mm.
- **Bench:** pending — see the load note below.
- Ship default flips to 1 once the bench confirms; the visual gate passed.

## Step 2 (derivative normals) — NO-SHIP, and the threshold is not the problem

Three thresholds on the SAME wounded fill-screen scene: 0.02, 0.08, 0.15.

- mode 2 vs mode 0 diff: **4.29%** (22× the noise floor), meanD 5.64.
- What I see at every threshold: the body reads as matte **vinyl** — the
  fbm muscle mottling gone from the chest; the specular highlight on the
  clavicle/shoulder not merely stepped but **dissipated** to a grey smudge;
  2px terracing at the neck/chest shading boundary; dark 2px-spaced speckle
  across the lit bands and limb silhouettes.
- Raising the threshold 7.5× (0.02 → 0.15) did NOT clear it — it only moves
  where the wrong normals land. The mechanism: a ~128-power Blinn highlight
  needs the per-pixel normal; dpdx is constant per 2×2 quad (at 0.6 m a quad
  is ~5.5 mm, ~5° of normal on 6 cm-curvature flesh), which both smears the
  highlight below visibility AND quantises the inputs of everything that
  consumes n downstream — the AO probe (`p + n*0.06`) flips between its clamp
  rails per quad, the wound mask's normal terms step — the speckle. The
  threshold only selects which pixels suffer; the interior pixels, which are
  the whole point of the mode, suffer worst because they pass under any
  threshold.
- The brief's exit clause applies: faceting is visible, no threshold kills it
  without falling back on most pixels (at which point the mode is mode 1 with
  extra steps). **Mode 2 stays in the source, toggleable, pinned, inert at
  mode 0** — the owner can flip it live (`setNormalMode(2, t)`) if he wants
  to see it, but it does not ship.

## Step 3 (AO + thickness at reduced rate) — DEFERRED to task 3

Task 3 (quarter-res depth prepass) is alive and immediately next in the
chain, and the spec's own preference is the fused design — "One pass paying
for both beats two mechanisms." A checkerboard/quarter-rate AO mechanism
built in THIS pass is a mechanism task 3 deletes; the win would be paid for
twice. Deferred, not dropped: task 3 must produce AO + thickness alongside
depth and bilaterally upsample, and must judge the look on a MOVING body.

## Instrument notes (this task's additions to the shared traps)

- The forward-difference reconstruction is only exact because `anchor` (the
  fragment's restPoint call) and MAP_BODY's internal detail line use the same
  dominant-prim rule and the same frequency 3 — the anchor hoist is pinned by
  a test (ordering), the reconstruction by another (exact text).
- The base-tree parity capture needs `PROBES_NO_SEAM=1` (the stash has no
  seam): `git stash push -- <3 files>` → `PROBES_NO_SEAM=1
  PROBES_SHOTS=/tmp/probes-base node scripts/closeup-probes-capture.mjs 5399
  9399 parity0` → `git stash pop` → diff m0-off1 vs m0-base.
- Wounded-staging same-boot noise floor is ~0.19% (the exit-bound census's
  0.005–0.013% was CLEAN scenes; craters jitter more) — gate comparisons on
  the scene's own floor, never on the census's.

## Load, honestly

First bench attempt launched at loadavg 83 (iCloud `fileproviderd`/`bird`
sync storm) — my error; the hygiene rule says check `uptime` first. The
 poisoned run was killed, its tabs closed, and the bench re-run is gated on
load1 < ~12. [bench results to be appended]

## Bench, run by hand after the timeout (2026-09-05 08:12, load 1-min 6–30, 15-min ~53)

`BENCH_REPEATS=4 node scripts/closeup-probes-bench.mjs 5399 9399` from the preserved
worktree. Kept 4/4/4, loadRejected 6, makeupReps 3. Rows (p50 ms, load start→end):

| rep | stencil | forward | deriv |
| --- | --- | --- | --- |
| 0 | 66.3 (14→10) | — | 73.7 (21→16) |
| 2 | 93.6 (30→12) | 43.9 (12→12) | — |
| 3 | **50.1 (12→8)** | **49.0 (8→6)** | **46.6 (6→6)** |
| 4 | 50.7 (6→5) | — | 45.7 (15→17) |
| 5 | — | 42.4 (17→11) | 40.4 (11→10) |
| 6 | — | 47.2 (10→11) | — |

The aggregate medians (stencil 66.3, forward 47.2, −29%) are load artefacts: the
stencil rows at 66 and 94 ran at load 14–30, the forward rows at 8–17. **Judge on
the one fully quiet rep (rep 3, load 6–12, all three legs): stencil 50.1 → forward
49.0 (−2%) → deriv 46.6 (−7%).** Reps 4/5 agree in direction (stencil ~50 vs
deriv ~41–46).

**Verdict:** the 3-tap forward-difference normal (the shippable one — look gate
passed) is worth ~1 ms of a ~50 ms wounded fill-screen frame. The derivative normal
would be worth ~3.5 ms and is no-ship on look. The post-hit probes were ~1 of the
~20 evals per pixel the plan counted, and the frame says so. Note what the frame IS:
~50 ms wounded at dist 0.6 vs ~24 ms unwounded at 2.5 m — **the wounds double the
close-up cost** (conservative 0.6× stepping near craters, the up-to-14-eval wound
shadow). That, not the flesh probes, is the next thing to measure on this scene.
