# Cut excess look pass: status at pause (2026-10-04)

The owner's feedback was that cuts were too short, ended abruptly and looked too tidy. The goal of this pass: longer cuts,
ragged tapering ends, rougher edges, bigger lips, wider, more gore.

**State: the code is done and verified. It is UNCOMMITTED in the working tree. The only commit is this file.**
Base HEAD: `e3d4a897`. The photos and logs are copied, untracked, into `photos/` and `verify/` in this folder.

## What changed (uncommitted)

### `src/lab/sdf-zombie/cut-wound.ts`: the CPU mirror

**Field shape.**
- `cutTaper(tN) = (1 - tN²)²` now drives both the depth and the kerf. Before, `prof = 1 - tN²` drove the depth, the
  kerf kept 0.35–1, and the depth had a one-kerf floor.
- The result: the tips close gradually into a needle, and the depth floor is gone.
- `kerfT = kerf · max(1 + jag, 0) · taper`.

**`cutLip`.**
- It takes `depth` (a new parameter) and no longer takes `jag`.
- `offKerf` now uses the smooth kerf `kerf · taper`. On the jagged kerf, the lip picked up the jag's slope: 2.7–3.1 on
  thin limbs.
- `rimB = rimSpan · max(amp0, lipW)`, with `rimSpan` 2.
- `nearSkin` band = `min(2·lipW, dEff)`. This is the thin-limb guard that lets the kerf go above 0.015.

**`cutMask`.**
- The band narrows as `sqrt(1 - (a / (maskEnd·h))²)` out to 1.3 h, so a wet scratch runs past the tips.
- The GPU noise `jag` (≤ `maskJag`) roughens the band's edge.
- New face gate: beyond `(1 + jagAmp)·kerf`, the band needs `dot(nrm, inward)` from −0.45 to −0.15, so it does not
  wrap a thin limb.

**New helpers.**
- `cutJag`: a JS port of the GPU's fine jag plus pinch, using `validate.ts`'s `hash13` / `noise3`.
- `cutBlendK`: the smax fillet's kerf is capped at `0.5·dEff`. Without the cap, a kerf of 0.02 opened a thin arm's
  back on a silhouette slash: 1869 samples.
- `CUT_JAG_MAX` = 1.35.

**`stampCut`.** The kerf is clamped to `kerfPerHalfLen` (0.3) × halfLen. This is what makes a wider kerf
Lipschitz-safe: every along-slot slope is kerf/halfLen × a constant.

**`cutsFromSweep`.** Each run's segment is stretched by `CUT.tailGain` 1.4 about its midpoint.

**`cutExposureSpheres`.** The spheres follow `cutTaper`.

**Constants.**

| Constant | Before | After |
| --- | --- | --- |
| `CUT.maxLen` | 0.35 | 0.45 |
| `jagFreq` | 90 / m | replaced by `jagCycles` 1.2 per kerf |
| `jagAmp` | 0.35 | 0.5 |
| `pinchCycles` / `pinchAmp` / `pinchTip` | — | 3.5 / 0.25 / 0.6 (new) |
| `lipOffset` / `lipWidth` / `lipHeight` | 1.5 / 1.2 / 0.9 | 1.7 / 1.5 / 1.3 |
| `rimSpan` | — | 2 (new) |
| `maskWidth` | 2.2 | 3 |
| `maskEnd` | — | 1.3 (new) |
| `maskCycles` | — | 0.6 (new) |
| `maskJag` | — | 0.6 (new) |
| `blendDepthFrac` | — | 0.5 (new) |
| `maskFace` | — | [−0.45, −0.15] (new) |
| `ROD_CALIBRE.kerf` | 0.015 | 0.02 |

### Other files

**`webgpu/march/fields/wounds.wgsl.ts`: the same changes in WGSL, term for term.**
- In `applyWounds`: the taper, the fine jag at `jagCycles/kerf`, and the pinch as 1-D `hash13` value noise along the
  slot.
- In the lip, the smooth-kerf `offKerf`, `rimSpan`, and the `nearSkin` dEff cap.
- The fillet `min(kerf, 0.5·dEff)`.
- `near` uses `max(depthT, kerf)`.
- In `woundMask`: the tapered, noisy band and the face gate.
- The pins in `wounds.wgsl.test.ts` are updated.

**`webgpu/axe-strike.ts`.** `AXE_CALIBRE.kerf` 0.015 → 0.025, and `AXE_CUT.halfLen` 0.09 → 0.15. In the test, the
kerf limit is now `kerfPerHalfLen·halfLen` and ≤ 0.03.

**`webgpu/wound-threat.ts`.** The box's side allowance is `(1 + CUT_JAG_MAX)·kerf`. The test's boxR pin is
< 0.14 (measured 0.1354; before, 0.127 < 0.13). The no-miss test now also runs kerf 0.025 and jag = `CUT_JAG_MAX`.

**Gore** (`webgpu/game-world-leaves3.ts`, `game-main.ts`).
- New `registerCutBleed`: `registerBleed`, plus two extra impact gouts at ±0.55 h along the slot.
- The rod now bleeds as `'slug'`; it was `'pellet'`. The axe was already `'slug'`.

**`scripts/cut-wound-gate.mjs`.** Two gate H restatements, both because the lip's reach grew:
- The band is now `(1.7 + 2·1.5)·kerf`, which is 8.2 cm at H's clamped kerf of 0.0175.
- The measured disc grows past the head, so the far set is non-empty. Before this change it was NaN: the band plus the
  near ring covered the whole head.

**`cut-wound.test.ts`.** The cut-wound tests are extended. Every Lipschitz sweep now includes the GPU noise, through
`cutJag`.

## Measured (all on the final working tree)

### Tests

| Run | Result |
| --- | --- |
| `cut-wound.test.ts` | 49/49 (5 min 26 s). Log: `verify/cut-wound-test-run.txt` |
| wound-threat, axe-strike, game-axe, game-rod, cut-refresh, bone-exposure-yaw, march-step-soundness, march-wound-list, normal-gradient-probe, wounds.wgsl, game-context-coverage | all pass |
| `tsc` | only the `node:crypto` error |

### Lipschitz maxima, bound 2.2

| Sweep | Before | After |
| --- | --- | --- |
| Carve only | 2.075 | 1.774 |
| Whole field with noise, lip scale 0.8 | 2.075, no noise | 1.822 |
| Whole field with noise, lip scale 1.1 | 1.995 | 1.999 |
| Rod calibre, lip scale 0.8 / 1.1 | — | 1.725 / 1.822 |
| Axe calibre, lip scale 0.88 / 1.1 | 1.863 / 1.941 at kerf 0.015 | 1.725 / 1.814 at kerf 0.025 |
| Thin limbs (along, silhouette, chop across) | not tested | 1.955 |

### Invariants

**Far skin.** Lip 0 mm, mask 0 on the torso along, the torso around and the arm along.

**Thin-limb back (dot ≥ 0.6).** The mask is 0 at every radius and every kerf. The sides are pinned:

| Arm radius | kerf 0.01 | kerf 0.015 | kerf 0.02 | kerf 0.025 |
| --- | --- | --- | --- | --- |
| 0.02 | 0.311 | 1 | 1 | 1 |
| 0.03 | 0 | 0.311 | 1 | 1 |
| 0.04 | 0 | 0 | 0.311 | 0.98 |

**Silhouette.** No opening in the middle 70% for any row:

| Row | Opened samples | Nearest the middle |
| --- | --- | --- |
| kerf 0.01 | 18 | ≥ 0.968 r |
| kerf 0.015, rod, axe (all clamped to 0.015) | 286 | ≥ 0.918 r |
| Stretched chord, h 0.07 | 856 | ≥ 0.724 r; deepest 33.8 mm against a 34.5 mm bound |

**Lid zero set.**
- Convex fixtures: 0 flips.
- Armpit: 79 of 50843 at kerf 0.006; 0 at 0.015 and 0.025.
- Foreign ball: 0 carved.

**Lip.** The lip raise is 8.0–9.3 mm; before, it was 2.9 mm.

### Gates

| Run | cut-wound-gate | axe-gate |
| --- | --- | --- |
| Full, final state | 30/30 | 24/24 |
| `ONLY=K,R,H` and `ONLY=A,D,K`: before (HEAD) | 1 fail: H far 1.15 / 5.2%, a pre-existing ONLY-mode H failure | pass |
| Step 1 | pass | pass |
| Step 2 | 1 fail: H 1.05 / 3.1% | pass |
| Step 3 (final) | pass | pass |

### WGSL checks

- **Golden:** `npx vitest run march-golden -u` updated 1 snapshot.
- **Census:** `compile-census.mjs 2` gave `phase=ready` twice, uncaptured 0, no device loss. The march module is
  308115 B. Log: `verify/census.txt`.
- **march-hash:** no pin moved.
  - Default `d7392d52` / `76bd51aa`, on 2 of 2 boots.
  - Crowd `0c71e712` / `bf6836cd`.
  - Per-body `470ff0b3` / `f618070e`.

**Cold boots** (`drawOnce`, unique hash13 nonces, base = git archive of HEAD). Log: `verify/boot*.txt`.

| Run order | base | new | delta |
| --- | --- | --- | --- |
| base, new, base, new | 1812 / 2553 | 2748 / 2978 | |
| new, base, new, base | 1749 / 1816 | 1885 / 2040 | |
| all four pairs | | | +136 to +936 ms, mean about +430 ms |

New was slower in all four pairs. Load was 4–6. **This is a concern:** the code is larger (an extra `noise3` in
`woundMask`, plus the pinch's `hash13` calls).

> **2026-10-06:** not reproduced on a quiet machine (this commit against its base: `drawOnce` 1673 / 1665 ms against
> 1810 / 1661 ms); neither term moves `drawOnce`
> ([cut-cost notes](../2026-10-06-cut-cost/NOTES.md), "Cold boot").

### Frame cost (ungated, full axe gate C)

- The draw time went from 25.8 / 28.6 ms before to 49.1 / 48.6 ms after 3 chops: about +22 ms.
- In the axe NOTES it was +4.3 ms.
- **This is a concern.** The likely causes: the longer, wider slots (halfLen 0.15, kerf 0.025), the bigger lip
  reach, and the extra noise. Not investigated.

> **2026-10-06: these two reads are not the cuts' cost.** The gate's "before" frame draws no body flesh, so the
> figure is the torso plus the cuts; three chops cost about 4 to 5 ms
> ([cut-cost notes](../2026-10-06-cut-cost/NOTES.md), "The measurement trap").

## Photos

In `photos/<stage>/{cut,axe}/` (untracked), copied from the scratchpad.

| Stage | What it is |
| --- | --- |
| `before` | HEAD |
| `step1` | Length and ends only, with the old lips, jag and kerf |
| `step2` | Adds roughness and lips; kerf still 0.015 |
| `step3` | Adds width: the final state |
| `fullgate` | Full gate runs, with logs |

Read so far:
- **R:** the step 3 belly slash is long, gaping and ragged, with a blotchy wet band. In step 1 it was a long thin tidy
  line. Before, it was a short blunt slot.
- **A / D:** long gashes with swollen lips, a red band, and tapered, blotchy ends.
- **The axe's K-2:** large head gashes, with skull bone visible.
- **H:** on the dark face it reads about as before.

## Unfinished

1. **Side-by-side comparisons.** The PNGs (before on the left, step 3 on the right, one per scenario: K, R, H, A, D,
   and the axe K) are not made yet. They go in `compare/`, along with `NOTES.md`, which records the numbers above and
   honest photo descriptions.
2. **Commits** (code is uncommitted). Suggested split:
   - (a) the field: `cut-wound.ts`, `wounds.wgsl.ts`, the tests, `wound-threat`, `axe-strike` and the golden, noting
     `march-golden -u`, the census, march-hash and the boots;
   - (b) gore: `game-world-leaves3.ts` and `game-main.ts`;
   - (c) the gate H restatement;
   - (d) the docs: `compare/`, `NOTES.md`, and a decision on whether to commit `photos/` (38 MB; probably commit only
     the compare PNGs).
3. **The +22 ms three-chop frame cost and the boot delta.** Decide before shipping whether to accept them. Options:
   - drop the `woundMask` noise;
   - tighten the reach;
   - lower `AXE_CUT.halfLen` or the kerf.
4. **Not done.** Spec, TASKS.md and HANDOFF updates; dualmem memories (warnings: the lip `offKerf` must use the smooth
   kerf; the fillet cap; the face gate).
5. **Scratch to remove.** `.scratch/` (gitignored) holds the sweep harness `lip-sweep.ts`, `cut-noise.ts`, `sil.ts`
   and `cmp.ts`.
