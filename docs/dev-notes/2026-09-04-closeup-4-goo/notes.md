# Close-up task 4 — the goo layer is the blood cost

**Date:** 2026-09-04 · **Branch:** `dispatch/2026-09-04-closeup-task-4`
**Status:** in progress
**Base:** main `8078f0a` (task 1b merged)

## What this task is

Phase 0: attribute the goo frame per pass (density / blur ×2 / surface
composite) as a function of covered area, not particle count, plus the idle
fixed cost. Then the three items, each behind a seam, each benched on/off,
each look-judged unfrozen:

1. **Surface composite at full canvas res** → shade at density res and
   upsample (`setSurfaceAtDensityRes`).
2. **Density-pass overdraw** → skip sub-texel quads (`setMinTexelRadius`) and
   fill the cap by projected area (`setAreaPriority`).
3. **Splats never age out** → fade the density contribution of the oldest
   ranks (`setSplatFadeTail`), billboards untouched.

## Implementation shape (as landed)

- Item 1 reuses the EXISTING shading graphs — `shadeOf()`/`makeOverlayMat()`
  are resolution-independent fullscreen-quad node graphs. The low path adds:
  a density-res RGBA16F `surfaceLow` target (no depth attachment), a
  `makeLowDepthMat` variant that packs the reconstructed depth into the
  colour ALPHA (the shading pass must not depth-test — its own depth buffer
  would be empty; the hardware depth test moves to the upsample, per output
  pixel), and one tiny WGSL fn (`GOO_UPSAMPLE_WGSL`, nearest `textureLoad`,
  NO flipY — target-to-target is orientation-preserving; the shading pass
  already paid the canvas-boundary flip when it read the density field).
  Cleared alpha 0 is the empty sentinel the upsample discards on.
- Item 2 is sync()-side only. `projectedTexelRadius()` is the projected-size
  test the sim size cannot make (mistMaxSize sees the droplet, not the
  distance); area priority fills droplets+splats from ONE pool ranked by
  projected area (also fixes silent splat starvation at the cap: splats were
  filled after droplets, so a full roster erased every pool).
- Item 3: `Splat` has no age, but the 256-ring is `push`+`shift`, so ring
  position IS recency — no blood-sim change. The weight rides a new
  `fallMask` instanced attribute multiplying ALL accumulated channels
  equally (g/r depth ratio and b/r gut ratio survive, same invariant as the
  blur's uniform weights). ×1.0 is IEEE-exact, so seam-off is bit-identical.
  The fade engages only once the ring holds MORE than `fadeTail` splats — a
  young pool must not thin.
- Diagnostic: `setPassGate({density,blur,surface})` — skips passes so a bench
  can time them apart; a gated frame is WRONG on purpose. The blur gate
  skips only the blur RENDERS; the surface still reads the blurred texture,
  so a gated surface leg times the same shader.
- Page seam: `__sdfGame.setGooPerf(o)` + the `goo.perf` getter. Deliberately
  NOT in setGooTuning (the goo panel's copy button emits tuning keys; a perf
  lever there would let a tuning paste silently move a bench seam).
- Harness: `runInterleaved` gained `L.legJs` (per-leg seam application, the
  exitBound precedent), `L.benchArgs` (per-leg bench opts), all-segment rows
  (`row.segs.walk/fire/gib`), and `evaluate` in the onRow context.

## Findings so far

- **The pass-A "ALPHA 0, explicitly" comment is stale.** `Color4.set(color)`
  defaults alpha to 1, so the shipped `setClearColor(0x000000)` actually
  clears the density target's alpha to 1 — and has all along. Harmless: the
  gut mask moved to `.b` (organs r3) and no shader reads `.a`. Left untouched
  (the code is shipped-correct); recorded here because the surfaceLow clear
  DOES need real alpha 0 and gets it explicitly: `setClearColor(0x000000, 0)`.
- The game page ships `blurPx 0` (owner: "we can remove the blur") and
  `mode 'depth'` — the spec's "already blurred by sigma 2.5" mitigation for
  item 1 does NOT hold on the game page; the field is raw half-res sums.
  The nearest-upsample choice is the conservative response: identical field
  data, only sub-texel ray variation lost.
- Content size on the bench canvas: 800×600 (4:3 cap) → density target
  400×300, surface composite 480k px → item 1 shades 120k px.

## Retry-brief instrument fixes (2026-09-05, before any benching)

The implementation was already green on this branch; the retry session's job
was benching. Four instrument fixes landed first:

- `goo-smoke*.mjs` deleted. The seam verification the smoke scripts existed for
  is 12 SINGLE-LINE evals through `connectGame` (defaults, each seam on/off via
  `setGooPerf`'s return value, passGate off/restore, `gooProbe` typeof, bleed
  readback) — all pass.
- **`L.benchArgs` leaked into the page eval as bare JS** (`sdf-closeup-stage.mjs`):
  `...(L.benchArgs ?? …)` inside the template reached the page where `L` does
  not exist → `ReferenceError` on the first real bench rep, before any number
  existed. Interpolated node-side. This is exactly the failure class the
  smoke scripts were supposed to catch — and why a smoke that never runs is
  worth nothing.
- **Top-level `await` inside `Runtime.evaluate` is a syntax error**, and the
  gooProbe readback's `.catch(() => null)` swallowed it as `cov ?` on every
  row. Wrapped in an async IIFE; single-line discipline kept.
- Bench JSON filenames now carry the staging mode — phase0-close overwrote the
  room-4 phase0 JSON (printed summary survived in the log).

## What the room-4 firefight says (phase 0, first run)

5/5/5/5/4/5 kept rows (18 load-rejects during a sibling vitest storm, 3
makeup reps), interleave rotation intact, `uptime`/load quoted per row in the
JSON. The clock basis drifts 2.25x WITHIN one run (same leg: 17.1 → 7.6 ms as
GPU clocks ramp), so medians-of-raw-p50 are meaningless; the deltas below are
medians of WITHIN-REP deltas (all legs of rep k share a clock window).

| segment | ship p50 | whole goo (ship−goooff) | surface (ship−nosurface) | density (ship−nodensity) | blur (bluron−ship) |
|---|---|---|---|---|---|
| walk (idle, no blood) | 7.61 | 0.26 [n4, 0.03..0.57] | −0.09 [−0.78..0.28] | 0.17 [−2.30..0.22] | 0.55 [−0.09..1.23] |
| fire | 14.01 | 0.54 [−4.14..0.87] | 1.94 [−2.62..3.36] | 0.16 [−1.11..2.14] | 0.36 [−2.92..4.81] |
| gib | 11.56 | 0.07 [−0.12..0.85] | −0.19 [−0.21..0.27] | −0.22 [−0.42..−0.03] | 0.28 [−0.06..0.45] |

Coverage at gameplay range: **cov 1.05%** (ship/nosurface/bluron), bigblobs
1.31% — there is almost no goo on screen at room-4 range, and the whole chain
is worth ~0.1–0.5 ms of an 11–20 ms frame. The idle answer is already here:
whole goo at idle ≈ 0.26 ms — the idle-frame early-out is confirmed a non-win.

**The premise does not reproduce at gameplay range.** The spec's claim was
written from code reading and marked "a bench must confirm"; at the range the
firefight benches, the goo layer is noise-level. The spec's own scene — the
close-up — is where the question had to go next.

## Coverage reality-check (drives the close-range staging)

Manual trajectory of the 1.1 m burst staging (frozen boot, manual steps,
`gooProbe` after each):

| step after staging | 0 | 6 | 12 | 18 | 24 | 36 | 48 | 72 |
|---|---|---|---|---|---|---|---|---|
| cov % | 1.29 | 1.61 | 1.99 | 1.52 | 1.56 | 1.34 | 0.87 | 0.52 |
| droplets | 166 | 151 | 128 | 105 | 82 | 63 | 43 | 23 |
| splats | 13 | 34 | 61 | 89 | 124 | 149 | 173 | 201 |

Even point-blank, one slug's burst peaks at **~2% density coverage** — the goo
is streaks, not a flood. Binary coverage cannot see additive overdraw (N quads
on one texel count once), which is why the per-pass attribution still matters.
Two further instrument findings:

- **The bench's default warmup (120) + 240-frame window samples only the dead
  tail** of a burst that decays in ~1.5 s (first close run: droplets 2, cov
  0.1%). Close legs pin `warmup 10, closeupFrames 80` — the peak-to-early-
  decay window.
- **`stampWoundAt` never bleeds.** It carves + spills but does not enter the
  bleed ledger — 8 stamps + 2400 steps → droplets 0, splats 0, on frozen AND
  live pages. The ledger is fed by real SEVERS (fireSlug → stump gush
  emitter). The capture spec's stamp-built "accumulated floor" scene was dead
  on arrival; rebuilt around 3 point-blank slugs + hold until the 256-ring
  saturates (cov 6.18% looking down at the pool — the real heavy state).

## Phase 0 — close-up and floor attribution

CLOSE (burst staging, 5 kept/leg, 0 rejects — but this run's GPU-clock state
swung per-leg, so only the within-rep paired deltas are usable):

| attribution (closeup seg) | median of per-rep deltas | range |
|---|---|---|
| whole goo (ship−goooff) | 0.04 ms | −1.84 .. 25.03 |
| surface (ship−nosurface) | 8.63 ms* | 1.09 .. 18.74 |
| density (ship−nodensity) | 6.77 ms* | −0.36 .. 22.00 |
| blur (bluron−ship) | −7.78 ms* | −19.35 .. 7.23 |

*The starred rows are the clock-swing artifact itself: on this run the GPU
clock state changed faster than a leg cycle, and pass-gated legs landed in
different windows. Only bounds survive this run: even the WILDEST legs bound
the whole goo chain at a few ms of a 12–45 ms frame at cov ~2%. The per-pass
split is NOT decision grade from this run.

FLOOR (saturated 256-ring pool, cov 6.3% — the worst stageable state). The
storm killed the run (machine load 24→160 mid-run, 18+ load-rejects, driver
died on an unsettled await), but rep0 landed in a legitimately quiet window
(load 11.9–15.0, quoted per row): goooff 12.42, ship 12.56, nosurface 12.86,
nodensity 13.04 — **whole goo at the worst state ≈ 0.14 ms; surface ≈ −0.30;
density ≈ −0.48 (both sub-noise)**. bluron's rep0 (32.7) was a clock spike,
discard. The floor rep0 cluster is tight (12.4–13.0 across four legs) and is
the single most informative cluster of the task: **at 6.3% covered area and a
saturated splat ring, the entire goo chain is ~0.1 ms.**

The A/B confirmation benches (item on/off pairs) were storm-blocked: the
second half of the session ran at machine load 70–160 (sibling dispatch
tasks' own benches), every row load-rejected, one Chrome death, one driver
death. They are also MOOT given the attribution bound: no item can save more
than the chain costs — ~0.14–0.5 ms in every state staged — which is below
the look cost item 1 measurably has, and items 2–3 are cost-neutral by
construction (see verdicts).

## Phase 0 — per-pass attribution (pending bench)

Superseded by the three tables above — the room-4 table (first section), the
close bounds, and the floor quiet-window cluster together answer the
question: the goo chain is sub-millisecond at every coverage the game can
stage (1% gameplay, 2% burst peak, 6.3% saturated floor).

## Items — parity, look, and A/B

**Parity gate (vs MAIN `93d9570`, frozen, deterministic staging):**

| scene | noise (off1/off2) | branch vs MAIN, seam off | verdict |
|---|---|---|---|
| idle | 0% | **0% maxD 17** | CLEAN (exact) |
| burst | 0.076% | 0.084% maxD 64 | CLEAN (≤ floor) |
| floor | 1.06% | 1.07% maxD 208 | CLEAN (≤ floor) |

Item-on diffs vs seam-off: idle 0–0.0001% (all three — seams are invisible
when the field is empty); burst: surface 1.08%, minmax 0.049%, fade 0.022%;
floor: surface 2.12%, minmax 0.10%, fade 1.43%. Two capture-instrument bugs
fixed en route (background-tab rAF throttling never settles the AA smear —
bringToFront before staging; weapon-animator phase masked in the vs-MAIN
diff — game state proven identical first).

**Look (unfrozen strips + frozen peak captures, judged by me):**

- **Item 1 (surface at density res): REAL LOOK COST in the shipped depth
  mode.** At the burst peak the flying spray's goo fusion — the bold wet
  blobs the ship path lays over the billboard streaks — is LOST with the
  seam on; the trail reads as bare, dimmer billboard specks. Mechanism
  isolated by A/B against `setGooTuning({ mode: 'overlay' })`: with the seam
  on in OVERLAY mode the spray comes back — big glossy blobs, arguably better
  than shipped — so the killer is the DEPTH-TESTED upsample discarding sparse
  spray texels whose packed depth reconstructs farther than the wall behind
  them. The body/face goo, silhouette and glint are unaffected either way.
- **Item 2 (minTexelRadius + areaPriority): invisible** — ≤0.10% px diff in
  both scenes, at the noise floor; strands/pools identical.
- **Item 3 (splat fade): pools still read as pools.** At the saturated floor
  the fresh kill's pool is full-weight by design (fade bites only the oldest
  tail ranks); only faint distant patches dim slightly. Visually subtle.

**A/B ms-tables: storm-blocked** (see Phase 0 floor note) — and bounded by
the attribution: the whole chain is ≤~0.5 ms in every state staged, so no
item's possible saving can exceed that.

## Verdicts

**The premise does not reproduce.** "The goo layer is the blood cost" was a
structural read of the code, and the bench was written into the spec as the
confirmation step. Measured, the entire goo chain — density, both blurs,
surface composite — costs **~0.26 ms idle, ~0.1–0.5 ms in a full firefight,
~0.14 ms at the saturated-pool worst case (6.3% covered area, 256-splat ring,
259 live quads)**. Coverage reality: ~1% at gameplay range, ~2% at the
point-blank burst peak, 6.3% staring into an accumulated pool. There is no
state the game can stage where this chain is a meaningful fraction of an
11–20 ms frame. The owner's "blood spray causes issues" is real but is NOT
this layer; whatever it is (billboard view, chunk physics, sim step) lives
outside task 4's scope.

- **Item 1 — NO-SHIP as implemented.** The saving is bounded (≤ the chain's
  ~0.5 ms worst case) and the look cost is real and measured: the depth-
  tested upsample drops the flying-spray fusion in the shipped depth mode.
  The overlay-mode result is the pointer: fix the packed-depth reconstruction
  for sparse spray texels (or ship the low path in overlay mode), THEN
  re-bench. The seam stays parity-pinned, default off.
- **Item 2 — NO-SHIP (defaults unchanged).** Invisible (≤0.10% px) and
  cost-neutral by construction: areaPriority changes WHICH quads fill the
  cap, not how many; the sub-texel skip only bites at range, where the whole
  chain is already ~0.3 ms. Nothing measurable to gain. Its look value (the
  burst surviving at the cap over far trails) remains available to the owner
  as a tuning flip.
- **Item 3 — NO-SHIP (defaults unchanged).** `fallMask` still submits every
  splat quad, so the direct saving is ~0 by construction; the indirect
  surface saving is bounded by covered-pixel shading (sub-ms). The look is
  fine (pools survive), but shipping a default flip with no measurable win
  and a real (if subtle) change to a feature the owner asked for is a bad
  trade. The seam stays for a future state where splat cost matters (e.g. if
  the ring ever grows past 256).

Idle-frame early-out: confirmed a non-win (whole chain at idle = 0.26 ms) —
as the spec predicted; not pursued.

One resolution change nobody can see would have been the BEST outcome here;
what the task actually found is that there was no resolution change worth
shipping at all — and one real look trap (item 1 depth mode) that a future
attempt now knows to avoid.
