# The wound cost — root cause and a first fix (2026-09-21)

Follow-up to [NOTES.md](NOTES.md), which found that five wounds on one close-up body add
~6 ms to `sdf:march` and that the increment barely shrinks with resolution.

## Root cause: the owner re-fold in `mapBody`

`march/map-body.wgsl.ts`, the block headed "Preserve independently moving limbs under
somebody else's wound". On every field sample where `nearWound || dmg != carved`, it
re-folds **every other nearby cluster from scratch** (full prim loop from 1e9, then
`applyCarves`, then `applyWounds`), and keeps the result only if it beats the whole-body
value. `__sdfGame.setOwnerRefold(false)` (the existing attribution seam, renders a wrong
frame on purpose) prices it. One page, uncapped, alternating, 5 wounds, body at 0.7 m:

| `sdf:march` ms | scale 1.0 | **0.5 ship** | 0.25 |
| --- | ---: | ---: | ---: |
| clean body (from NOTES.md) | 31.4 | 7.6 | 2.7 |
| wounded, ship | 44.2 | **13.8** | 7.7 |
| wounded, re-fold off | 31.5 | 7.9 | 3.9 |
| **re-fold cost** | 12.7 | **5.9** | 3.8 |

**The re-fold is ~95 % of the wound cost** (5.9 of 6.2 ms at ship scale). With it off a
wounded body marches like a clean one. Why it is so wide:

- The trigger is nearly the whole torso. `nearWound` is 2x each wound's depth, and
  `dmg != carved` is true wherever a rim bump is non-zero — at the surface that reaches
  ~13 cm from each wound. Five torso wounds cover the torso. All post-hit evals (normal
  taps, scatter, AO) sit at the surface, so they all pay.
- Inside the trigger, 2-3 clusters survive the cluster sphere test (its margin is the
  4k smin support, 12-20 cm) and each costs about one whole-body fold plus an
  `applyWounds`. A wound-zone sample is ~2.5x a normal one.
- It almost always loses: the arm is not in the torso's crater.

Per-frame work was ruled out: yaw the camera 180 degrees and the wounded/clean difference
is zero at both scales (`wound-cost-probe.mjs`). It rises with wound count: +2.6, +4.3,
+5.3, +9.0, +8.2 ms for 1-5 wounds at ship scale. The cost per pixel does rise as
resolution drops (12.7 / 5.9 / 3.8 for 16:4:1 pixels); I did not explain that part.

Also measured: **the per-ray wound list (`setWoundList`) is a loss** — 13.8 -> 21.3 ms at
ship scale. It already ships OFF; leave it off.

## Tried and rejected: group-sphere pre-scan

> **CORRECTION (same day, later):** the reason given below is wrong. The zombie's `maxBlendK` is
> ~0.006, so the smin support `4k` is ~2.4 cm, not 12-20 cm. The pre-scan culled nothing because
> its reach added `gWoundAmpSum` over ALL 16 wound rows (~0.5 m). Retry it with the bump bound
> restricted to wounds the re-folded cluster OWNS (zero for most clusters): `reach = dmg + 4k +
> ownAmp`. Untested.

Skip a cluster's re-fold unless one of its group spheres is within `dmg + ampSum + 4k`.
Value-preserving, but it culled nothing (15.6 vs 15.3 ms): with a 12-20 cm support radius
every limb group near a torso qualifies. Reverted.

## Landed behind a gate (ships OFF): the raiser gate, -1.5 ms

`counts2.z == 2`, seam `__sdfGame.setOwnerRefoldGate(true)`. `applyWounds` records which
owners' carves actually **raised** the field at p (`gWoundRaisers`); a cluster is re-folded
only if a wound it does not own did. Argument for exactness: every wound step is monotone
in its input, a limb's own fold is >= the whole-body fold, and a foreign wound that did
not raise the field can only have lowered it (rim bump) — so without a foreign raiser the
whole-body value is already <= the limb's and the re-fold must lose. `counts2.z == 0`
takes the original condition unchanged.

(A different page from the table above, so compare within this table only — its `ship` row reads ~1 ms higher.)

| `sdf:march` ms (3 reps) | 1.0 | 0.5 ship | 0.25 |
| --- | ---: | ---: | ---: |
| ship | 47.2 | 14.95 | 8.22 |
| raiser gate | 39.5 | **13.41** | 6.46 |
| re-fold off (floor) | 32.1 | 8.36 | 4.63 |

Parity, render-locked march target, max abs channel difference: gate vs ship 0.0032,
**ship vs ship 0.0061** (the frame's own flicker), re-fold-off vs ship 0.85. So the gate is
inside the noise floor, but this harness cannot show bit-identity — `march-hash` /
`march-parity` with the gate forced on is the real check before flipping the default.
NOT yet done: that gate run, an owner look at a raised arm over a torso crater (the case
the re-fold exists for), and crowd/chunk views (the seam writes actor uniforms; it reached
the crowd-drawn body here the same way `setOwnerRefold` does).

The shader text changed, so the first boot after pulling this pays one cold march compile,
and `march-golden` was re-recorded (APPLY_WOUNDS, MAP_BODY, HELPERS_joined).

## What is left (~5 ms) and how to get it

The gate removes the rim/near-zone re-folds; what remains fires inside foreign craters,
where it still nearly always loses. Options, cheapest first:

1. **Win pre-test with a tighter bound.** A limb can win only if its surface is inside the
   foreign carve at p. The cluster test uses the 4k support as margin; a per-cluster bound
   on the limb value itself (sphere distance minus a depression bound of ~k, not 4k) would
   cull most torso samples. Needs an argument for the depression bound and a parity run.
2. **Accumulate limb folds during the base fold** (`gLimb[8]`, one extra `smin` per prim)
   instead of re-folding. Removes the prim loops entirely, leaving only the per-cluster
   `applyCarves` + `applyWounds`. Not bit-identical (different fold order, different cull
   set), so it is an owner-judged look change, and the tile-list path needs a cluster id
   per entry.
3. **CPU-side owner mask.** Most wounds cannot threaten most clusters for the whole life of
   the wound (a torso wound and a shin). Upload, per wound, the set of clusters whose
   posed bound overlaps its carve sphere; the shader re-folds only those. Cheap per frame,
   exact, and it attacks the common case directly.

Reproduce: `PROBE_SCRIPT=wound-bisect.mjs PROBE_SEAMS=ship,gate,refoldOff ./run-probe.sh`
(`wound-bisect.json` = the full seam matrix, `wound-gate.json` = the gate A/B,
`wound-cost.json` = wound count x facing/away).

## Update — the CPU threat mask (option 3), built, gated OFF

`counts2.z == 3`, seam `__sdfGame.setOwnerRefoldMask(true)`; diagnostic
`__sdfGame.woundThreats()`. Pure logic in `webgpu/wound-threat.ts` (7 tests): per wound, the
clusters that have a prim GROUP sphere inside the wound's carve sphere (and, for undistorted
groups, its depth slab) plus a margin. The body view recomputes it on every `upload()` and
`setWounds()` and writes it into the FRACTION of `ROW_WOUND_FLAGS.x` as mask/1024 (the cavity
readers test `x > 0.5`; the fraction stays under 0.5), so there is no new binding. In the
shader a raising wound ORs its mask into `gWoundThreat` and a cluster no raiser names is
skipped. It includes the raiser gate.

margin = 4·kw (wound smax support) + kw·min(rows, 3) (smax overshoot — **a judgement, not a
proof**: a stamped blast uploads as 4 rows and I allow 3 to coincide) + 2·maxBlendK (the limb's
own smin bulge) + the threatened cluster's own rim-bump ceiling. 0.117 m on the zombie.

**Finding: in the staged scene it cannot beat the raiser gate, because the limbs it names are
real neighbours.** The harness aims at y = 1.0 from eye height, so the five stamps land on the
LEFT HIP (owner `legL`), and they upload as **16 rows** (each blast carries satellites). Masks:
`76` = torso + armL + legR for the pellets, `92`/`94` adding armR and head for the 0.16 m
blasts (the head only through a distorted group). Everything near a hip really is near a hip.
The mask pays where wounds sit away from other limbs (head vs legs, shin vs everything) and on
bodies wounded in several places — not measured yet.

**No timing for it.** Both A/B runs happened under heavy machine load (Docker, load average
10-17; the ship leg read 23-29 ms against 13.8 quiet), so the numbers are not comparable even
leg-to-leg. Parity under load: mask vs ship 0.0046 / 0.0075, inside ship-vs-ship 0.0063 /
0.0112. Re-run on a quiet machine:
`PROBE_NAME=wound-mask PROBE_SEAMS=ship,gate,mask,refoldOff PROBE_SCRIPT=wound-bisect.mjs ./run-probe.sh`

Also learned: **5 stamped wounds = 16 wound rows**, and `applyWounds` walks all of them on every
sample, once for the body and once more per re-folded limb. The row count, not the stamp count,
is what the wound cost scales with.


## Update — measured in the melee scene, and what the owner wants next

The melee harness (branch `dispatch/2026-09-21-melee-closeup-harness`, commit `78def24b`,
`docs/dev-notes/2026-09-21-melee-harness/NOTES.md` there) gives the scene these fixes must be
judged in. Quiet machine, six zombies in melee:

| phase | frame p50 | `sdf:march` | walk only | re-fold off |
| --- | ---: | ---: | ---: | ---: |
| clean | 17.0 | 13.2 | 11.8 | — |
| wounded, 3-4 rows per body | 22.8 | 19.3 | 13.7 | 14.8 |
| wounded + fire | 36.7 | 27.7 | 22.3 | 25.2 |

The re-fold is ~4.5 of the 6.1 ms wounds add, at only 3-4 rows per body.

**Owner direction (2026-09-21):** likes options 3 and 4 below; wait for the harness (done) and
a quiet machine, then do them, with the owner approving the look by eye.

3. **Fewer rows.** Five stamps upload as 16 rows because a blast carries three satellite
   craters for its ragged edge. One crater with a noise-ragged radius would cut rows ~4x, and
   every row is walked on every sample, again per re-folded limb. Look change.
4. **Delete the re-fold.** Accumulate each wound-owning limb's own fold during the base fold
   (`gLimb[c]`, one extra `smin` per prim), apply that limb's wounds to it once, union. Trap:
   the base fold culls prims with `sd > d + 4k` — prims that are LESS inside than the union —
   and the limb value needs exactly those inside a crater, so the cull must be relaxed by the
   max carve depth inside the wound bound. The tile-list (crowd) path needs a cluster id per
   entry. Not bit-identical at joints. Look change.

Cheap and exact, do alongside: the pre-scan retry (above), and `applyWounds`' per-wound reach —
replace the constant `+ 0.25` with `max(0, -dIn)` (the fillet is only active when
`r < depth - d + 4kw`), which drops most rows for surface and outside samples.

## 2026-09-22 — what shipped, what lost, and why

Melee bench, one page, legs alternating, `?limbs` compiled in, 21/36 stamps landed (narrow FOV;
`MELEE_MIN_LANDED=0.5`), load peaked 6.1 so cross-leg deltas are indicative. `sdf:march` ms:

| phase | ship (full re-fold) | **raiser gate** | mode 4 limbs | re-fold off (floor) |
| --- | ---: | ---: | ---: | ---: |
| clean | 16.2 | 14.5 | 15.4 | — |
| wounded | 27.9 | **25.3** | 26.9 | 21.6 |
| wounded + fire | 29.1 | **25.5** | 28.7 | 23.7 |

- **The raiser gate SHIPS** (`counts2.z = SHIP_REFOLD_MODE = 2`). march-hash `room1` and `room1-wounded`
  are bit-identical to the full re-fold (`0ecaabcf…` both). `setOwnerRefoldFull(true)` selects the old path.
- **The threat mask (3) adds nothing over the gate** in the melee scene (earlier run: 12.77 vs 12.69).
- **Exact fixes** (`setWoundExact`, counts2.z + 8: d-aware reach `max(0, -d)`, own-amp pre-scan): ~0 gain; ship OFF.
  The re-folds the gate leaves fire inside foreign craters, where neither bound bites.
- **Option 3, ragged soldier craters: SHIPS ON (owner approved by eye).** Only SOLDIER wounds had the lobes
  (`soldierVisualWounds`: wound + 3 lobe rows); zombies were always one row, so this saves nothing in the
  zombie melee scene. One row per wound, radius grows by up to `RAGGED_AMOUNT` 0.3 by body-frame direction
  (noise3 at 1.8), encoded in the fraction of the wound TYPE texel; `woundMask` follows the same edge.
- **Option 4, per-limb accumulators: PARKED behind `?limbs`** (limbs-flag.ts). The owner liked the look, but it
  loses to the gate: correctness needs a 0.2 m cull slack inside the wound bound, which at close range covers
  most of each body, plus one extra blend per prim — that eats the deleted re-fold loops. Also costs cold compile.
  To revive it: a per-wound slack (deepest carve that can reach p, not a global 0.2 m).

### Compile-cost lessons (census = `scripts/compile-census.mjs`, fresh Chrome profile)

- **Runtime-indexed private arrays written in foldGroup's prim loop stopped the march compiling at all**
  (cold > 180 s, browser frozen). Named slots + a scalar accumulator fixed that.
- **Nonce the shader text with a RUNTIME condition** (`if (gDebugMode > N.5) {...}`) for a real cold number.
  `0.0 * N` is constant-folded before Metal and hits the system Metal cache, which survives fresh profiles.
- With main's call-site merge (2a8d8b4b/8277ec5d): ship cold 36 s; `?limbs` 52 s -> **45 s** after routing mode 4
  through the SAME `applyCarves`/`applyWounds` tail as the re-fold (a second inlined copy cost ~7 s). Dead ends:
  dropping the limb argmin, the tile-path switch, vector slots (each within noise).
- Whole-browser freezes on reload after a march shader edit = Chrome's GPU process compiling. The "bone-only
  gibs in flight" seen the same day were the TASKS.md cold-cache flesh effect plus missing dev assets in the
  worktree (`scripts/link-dev-assets.sh`), not a code bug.

### Bench tooling added

`MELEE_QS` (page flags, e.g. `&limbs`), `MELEE_MIN_LANDED` (stamp-landing floor), `CENSUS_QUERY` (census page
flags). Headless `sdf-gib-assets-head.mjs` renders blank frames on current main — it does not wait for render
readiness; don't trust its images.

## 2026-09-22 — why fire raised the body march: it is the PANIC, not the fire

Melee bench, `MELEE_PHASES=clean,<phase>`, each phase against the clean baseline of its OWN page
(the behaviour edge cannot be undone in-page). `sdf:march` ms, ship leg:

| phase | clean | after | Δ |
| --- | ---: | ---: | ---: |
| `thaw` — 45 frames calm, no fire | 12.3 | 12.0 | ≈ 0 |
| `firecalm` — burning, `setBurnBehaviour(false)` (same motion as thaw) | 12.4 | 12.3 | ≈ 0 |
| `fire` — burning + panic behaviour | 13.4 | 25.6-30.6 | +13 to +17 (load ~7) |

- **Fire rendering adds nothing to `sdf:march`.** It costs ~3.5 ms of FRAME (`post:fire-march`, the flames).
- **The march cost is the burn BEHAVIOUR**: burning zombies chase 1.25x faster with jitter, stumbles
  and arm flail, so with the player pinned they are on top of the camera within the thaw — the
  close-up melee case itself. Zeroing burn ramps in place (`noburn`) also changed nothing.
- Tools: `__sdfGame.setBurnBehaviour(false)` (burn-behaviour.ts, ship true); bench phases
  `thaw`, `firecalm`, `fire`, `noburn`, `out` (`out` is a no-op: `extinguishAll` needs the sim ticking).
- Still broken: the mode-4 census reads 0 hits / 1 step in the panic state (and after it), so
  steps cannot be counted there; the render state (scale, adaptive, steps) is identical.

## 2026-09-22 — miss-ray culling: built, PROVEN SAFE, and a LOSS. Miss steps are cheap.

`__sdfGame.setMissCull(true)` (ships OFF): the quarter-res depth prepass certifies 4x4 blocks empty
(cone vs every folded instance's cluster spheres, then a cone walk to the far sphere bound; a miss is
written at the far depth so any touch/unknown covering the block wins; prepass proxies dilated ~1.5
blocks) and the march discards those pixels.

- **Correct:** melee parity (same page, same frozen frame) — 0 hits lost / 0 gained, clean and wounded;
  walk steps -36 % / -41 %. Getting there found a LATENT BUG in the existing prepass: the block cone
  was `coneKFor(2√2)`, a √2-px radius — `coneKFor(px)` is px/2 pixels — so the proof's 2√2-px cone
  was half as wide (edge-column hits lost under the cull; the start bound's backoff had hidden it).
  Fixed to `coneKFor(2 * DEPTH_PREPASS_BLOCK_PX)` (be3ec43c).
- **A loss (quiet machine, load <= 3.6, one page, alternating):** `sdf:march` 11.9 -> 11.3 clean,
  16.6 -> 16.1 wounded, but `sdf:depth-pre` costs 7.2 / 7.8 ms: frame 14.8 -> 21.2 and 19.8 -> 27.1 ms.
- **THE LESSON: miss steps are nearly free.** Removing 36-41 % of all steps saved ~0.5 ms, because a
  step far from any body culls every cluster before a single prim is evaluated. The step census
  (`missStepShare`, `missAnatomy`) counts steps, not cost — do not rank levers by it. Cost lives in
  steps NEAR surfaces (hit tails, grazing silhouettes, wound zones), which is where the raiser gate paid.
