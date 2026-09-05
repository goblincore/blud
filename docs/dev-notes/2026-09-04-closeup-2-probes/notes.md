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

## Wounds bench (2026-09-05 08:59, `scripts/closeup-wounds-bench.mjs`, load 5–14 on kept reps)

Legs on the wounded fill-screen staging (dist 0.6, 5 wounds, cov 16%): `ship`;
`stepFull` = near-wound stepping at full omega instead of 0.6× (diagnostic: sign of
`woundShadowCfg.y`, `__sdfGame.setWoundStepDiag`); `unwounded` = same staging, no
wounds. The wound SHADOW is already off in the game (`woundShadowCfg.x` ships 0), so
it is not a lever. Kept 4/4/4, loadRejected 6, makeupReps 3.

| rep (load) | ship | stepFull | unwounded |
| --- | --- | --- | --- |
| 1 | 41.6 | 29.0 (−30%) | 17.3 (−58%) |
| 4 (5–10) | 54.0 | 47.6 (−12%) | 41.5 (−23%) |
| 5 (6–7) | 53.6 | 50.6 (−6%) | — |
| medians | 53.6 | 47.6 (−11%) | 31.8 (−41%) |

**Read:** the wounds cost 25–55% of the close-up frame. The 0.6× conservative stepping
near craters is a third to a half of that (−6…−30% of the frame); the remainder is the
carve loop every `mapBody` evaluation runs over the wound list (`applyCarves`, up to
64 rows × textureLoads per eval, paid on EVERY step of EVERY ray on a wounded body).
Two levers, both untried: (1) a less conservative near-wound factor (0.6 was chosen
against wound halos at ω 1.4; the game ships ω 1.0 — re-gate the halo look at 0.8);
(2) cull the carve loop per cluster/group bounds so an eval far from every crater
pays nothing — the same shape as the group-sphere cull the prim fold already has.

## Retired at the main merge (2026-09-05)

Main's 2026-09-04 retune gave the wound zone its own step multiplier (`WOUND_STEP_MUL`,
live seam `__sdfGame.setWoundStep` on **perfCfg.z**) — the same slot task 2's normal
mode used. The normal mode measured ~1 ms (3-tap) and the derivative mode was no-ship,
so on merging main the normal-mode shader block, `setNormalMode`, `GAME_NORMAL_*`, the
mode tests and `closeup-probes-{bench,capture}.mjs` were removed rather than remapped;
the sign-trick stepping diagnostic (`setWoundStepDiag`) is superseded by `setWoundStep`.
The wounds bench (`closeup-wounds-bench.mjs`) survives and is the tool for the cull.

## The shot spike: hit batching (2026-09-05)

Owner: "when I'm close and I shoot a zombie it goes up to ~50 ms spikes". Root cause
(`scripts/hit-profile.mjs`, landing-frame profile): `applyProjectileHit` ran the whole
post-impact tail PER PELLET — sever checks, `applyRig`, `view.update` (= `packBody`
repack + upload of the whole prim texture), `refreshWounds` (rewrite of every wound
row). A point-blank double barrel lands ~16 pellets in one frame → 16 repacks.

Fix: `ZombieActor.beginHits()/endHits()`; the pellet loop in game-main batches per
actor per frame and flushes the tail once. Test: 16 pellets → 1 `update` + 1
`setWounds` (unbatched reference: one per pellet).

| landing frame CPU | before | after |
| --- | --- | --- |
| 4 pellets landed | 12–18 ms | — |
| 16 pellets landed | (not measured; ~4× the above) | **6.7 ms** (5/5 frames, load ~38) |

What is left in the landing frame is the per-pellet CPU field probe
(`woundFromPellet` → `probeFlesh` → `sdBody`/`sdPrimitive`, ~6 ms per 16 pellets) —
the next lever if the shot still registers, plus the one-time 131 ms first-shot
pipeline compile (prewarm).

## Wound union-reach cull (2026-09-05, dispatch/2026-09-05-closeup-wound-cull)

**Step 1 built and shipped ON.** One bounding sphere per body covering every
wound's REACH, computed by `woundReachBound` (zombie-gpu.ts) inside `setWounds`
from the LIVE uniforms (blendK, rimOffset, rimWidth — the same channels the
shader's per-wound reach formula reads; not a hardcoded copy), carried as a new
`woundBound` uniform (vec4: xyz centre = wound centroid, w radius = max_i
(|w_i − C| + reach_i); containment is the triangle inequality, so the cull is a
value no-op by construction). `applyWounds` tests it BEFORE the loop and returns
`(dIn, 0)` — outside the bound every iteration would `continue` past the
per-wound reach early-out anyway. Threaded: applyWounds ← mapBody ←
calcNormal / MARCH_BODY (walk, both normal modes, thin/AO probes) / CONE_MARCH /
woundShadow; MARCH_BODY takes it positionally LAST (parser pin re-based 75 → 76
inputs). `w = 1e9` is the no-cull identity: chunk torn ends and the hands view
never compute a bound and keep it. Seam `__sdfGame.setWoundCull(on)` flips the
radius only (computed value kept, no re-upload); `__sdfGame.woundBound()`
reports every actor's bound for liveness checks. **CPU mirror:** no change —
validate.ts `sdBody` never included wounds (the raycast field is wound-free),
and the cull returns identical values, so there is nothing to mirror.

**Parity — the gate.** `scripts/closeup-woundcull-capture.mjs`, wounded
fill-screen staging, cull ON vs OFF same boot, same staged frame: **0 changed
pixels** (d > 0, HUD strip excluded, weapon masked) — also ON1/ON2 and both
unwounded pairs, 0 each. Bound proven live in-page: r = 0.933 m around the
5-wound cluster, so the parity is not vacuous. INSTRUMENT FINDING: the frozen
scene still ticks the **fire flicker off `performance.now()`** (game-main.ts —
not gated on frozen), which wobbles the level's point-light intensities ±14%
and jitters ~19% of all pixels at d > 0 between same-state captures 2.5 s
apart (measured: ON1 vs ON2 of the first run, maxD 84). The script pins
`performance.now = () => 100000` for the capture; unpinned, a literal-zero
pixel gate is impossible on this page.

**Bench** (`BENCH_REPEATS=4`, cullOff leg added, 2026-09-05 ~10:00, load 5.6–10.5,
kept 4/4/4/4, loadRejected 0, makeupReps 0 — a genuinely quiet window):

| rep | ship (cull ON) | cullOff | Δ cull saves | stepFull | unwounded |
| --- | --- | --- | --- | --- | --- |
| 0 | 56.4 | 59.4 | 3.0 | 47.4 | 25.1 |
| 1 | 54.9 | 52.8 | −2.1 (inverted) | 46.8 | 31.1 |
| 2 | 55.3 | 57.8 | 2.5 | 48.6 | 30.6 |
| 3 | 56.9 | 57.4 | 0.5 | 49.6 | 32.8 |
| med | 56.4 | 57.8 | **1.4 (2.5%)** | 48.7 (−13.8%) | 31.1 (−44.9%) |

**Read.** The cull removes ~1.4 ms of the ~25.3 ms (ship − unwounded) wound gap
— ~5%. Three of four within-rep pairs agree in direction (rep 1 inverted 2.1 ms,
inside the rep-to-rep noise this scene shows). The small size is geometric, not
a miss: the staging stamps all 5 wounds camera-facing on the torso (bound r
0.93 m), and a fill-screen body at 0.6 m concentrates its march steps on the
camera-facing surface — inside the bound. What the cull deletes is the
16-row wound loop on FAR samples (limb edges, off-cluster probes, miss-side
steps); on this scene that was ~1.4 ms. The gap's remaining columns are the
0.6× conservative stepping (stepFull leg: 7.8 ms, 31% of the wound cost —
lever 1, explicitly untouched here) and the in-reach carve/rim maths plus the
near-flag bone/organ fold (~17.5 ms), which no cull can remove — it IS the
wound being rendered.

**Step 2 (per-cluster wound lists) — spec'd, NOT built, with the numbers for
why.** Design condition was met literally (ship is +81% over unwounded, ≫ 10%),
but the decomposition above shows step 2 cannot approach that bar: it would bin
wound indices by the cluster their reach touches (new texture row: per-cluster
`[start, count)` into a wound-index list, packed at upload beside
clusterGroups; applyWounds walks the current cluster's list instead of 0..n),
which only saves the ROW LOADS of off-cluster wounds for samples inside the
union bound. On this staging all 5 wounds sit in one bound and the per-wound
reach early-out already skips their maths after one load each — the step-2
cullable set is ~3–4 textureLoads per in-bound eval, worth well under the
~1.4 ms step 1 already removed, against a 25.3 ms gap that is 69% stepping +
in-reach field work. The >10%-of-unwounded bar is unreachable by any wound-loop
cull while craters are on screen: even lever 1 AND a free loop together leave
~+52%. Next real lever is lever 1 (re-gate the 0.6 near-wound factor at ω 1.0,
look-gated) — a separate change, deliberately not in this task.

**Trap for the next editor:** the bound is computed AT UPLOAD from live
uniforms. A wound-panel edit of blendK / rimOffset / rimWidth without a
re-upload leaves the bound stale (too tight if the knob grew → cull eats a
carve). Game values are boot constants so this never bites in play; in the lab,
re-stamp after dragging those three.
