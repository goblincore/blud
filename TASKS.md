# Blud — Task Tracker

> **Session start: read this file first.** It's the cross-cutting status board.
> Per-milestone step-by-step tasks live in `docs/superpowers/plans/`.
> This file is **coarse-grained state only** — keep rows to ≤2 lines and link out for detail.

## Legend

| Mark | Meaning | | Prefix | Scope |
|------|---------|---|--------|-------|
| `[ ]` | todo | | `M<n>` | milestone |
| `[~]` | in progress | | `A<n>` | asset pipeline |
| `[x]` | done | | `R<n>` | research / reference |
| `[-]` | deferred | | `F<n>` | feel / physics tuning |
| `[!]` | blocked | | `P<n>` | process / tooling |

Subtasks use `.N`: `A5.1`, `F1.gibs`.

---

## Current focus

**GORE R3 REFINEMENTS — QUEUED (2026-09-02), from the review of
`claude/continue-previous-work-91055b` (wound r2, unmerged).** Ordered list in
[docs/dev-notes/2026-09-02-gore-r3-refinements.md](docs/dev-notes/2026-09-02-gore-r3-refinements.md):
(1) BUG — `applyBones` hard-codes taper/profile/bend to none, so the
authored curved ribs render as STRAIGHT capsules (verify: zero one rib's
`bend=`, diff); (2) cull the bone fold (no spatial test today — ~17 bones ×
3 loads per field eval in the wound zone, ×4 for normals); (3) count bone
evals instead of timing them; (4) torso cavity + organs as `W_ORGAN` in the
same array; (5) gate the per-hit bone-material read on `wm > 0`; (6) bone in
gib chunks; (7) collision. Merge picture: gore × perf chain conflicts only in
`march.wgsl.ts` signatures + one `game-main.ts` block — merge ONCE after the
chain finishes (~1 h); gore × elbow branch is clean.

**SDF RENDER PERF ROUND 2 — PLANNED (2026-09-01), not started.** A read-only
review of the march, the pass chain and the perf record after the shell
march produced an 8-task plan: fresh baseline → hull exit bounds `tMax` on
the un-relaxed path (exact; the halo lives on the `omega > 1` path only) →
plain sphere tracing at omega 1.0 (the page runs no shell displacement) →
wound-loop early-out → drop the disabled occluder rebuild + delete the
bit-rotted `specialise.ts` (emits 3-arg `sdPrim` vs the 7-arg signature;
OWNER CALL) → **front-to-back per-body passes gated on accumulated depth**
(the largest untouched cost: a body behind a body marches its whole pixel
set) → distortion-corrected footprint AA epsilon → level shadows RECEIVED
by bodies via a level-only twin light → measure the per-body upload.
Each task has a bench gate and a frozen-capture parity gate. **QUEUED on
dispatch-ui** as `2026-09-01-sdf-render-perf-r2-task-{0..9}` (glm-5.3-flash/pi,
base branch `claude/sdf-character-rendering-optimization-d0570b`): trigger
task-1, tasks 2-8 chain; task-0 (baseline) and task-9 (bench sweep) are
unchained — trigger them only on a quiet machine. Bench steps inside 1-8 are
recorded DEFERRED while the wound-r2 chain runs; parity gates are not.
**Progress 2026-09-02:** tasks 0, 1, 1b, 2, 1c done. **Task 1b's parity gate
FAILED task 1 in room 3 (0.20%): the hull-exit `tMax` bound DELETES a
background body seen past a foreground body's hull** while `hits` stay
bit-identical — a hull-texture effect, most likely the shell EXIT target
holding the NEAREST back face instead of the farthest. Task 1c (new,
queued before task 3) flips the default OFF, proves it by readback, fixes
the exit pass or leaves it off. Task 2 (omega 1.0) PASSED: hits unchanged
or up, steps −33..−45%. Task 3 timed out on wound staging; re-queued with
its first attempt's commit and lessons.
**2026-09-02 later:** Task 1c REFUTED the nearest-face hypothesis and found
the real cause — the hull's WRITTEN DISTANCE decays with range (true 9 m
stores 2.8 m; near field exact), the SAME unexplained three-r185 TSL
phenomenon that killed the occluder pre-pass. Max semantics of the exit
pass are correct. `GAME_HULL_EXIT_BOUND` STAYS 0 until someone root-causes
the decay; the step win (missStepShare 0.54→0.41 r3) is untakeable until
then. Also: occupancy `hits` "identical on/off" is NOT evidence of an
unchanged hit set where proxy boxes overlap (near-box misses clobber far
hits before readback). Task 3 (wound early-out) PASSED parity on one load
(craters identical, HUD clock the only diff) + lab render-check; its second
run timed out inside bench legs; controller wrote the notes, restored the
seam default ON, marked done. Chain continues at task 4.
**2026-09-02 later:** task 4 done (occluder rebuild gated, specialiser
deleted). Task 5 landed the per-body passes + `prevT` and found the planned
gate DEAD (`shellIn` is the SHARED hull entry, never > prevT); replaced it
with a per-body proxy-box `bodyEntry` but shipped `min(shellIn, bodyEntry)`,
still inert, then timed out on flicker noise. Marked done (code green);
**task 5b** (new, before 6) switches to `max(...)`, proves parity with a
gate that bites, decides the default.
[plan](docs/superpowers/plans/2026-09-01-sdf-render-perf-round2.md) ·
review: Obsidian `Claude Notes/Blud/2026-09-01-sdf-render-and-blobforge-review.md`

**BLOBFORGE RING-FIT BRANCH MERGED (2026-09-01, main `eea6620`).**
`claude/sdf-character-workflow-837c40` (blob:rings, ref-skin/ref-align,
bonewalker, schoolgirl-alt, dragon) had sat 115 commits behind main; merged
with TASKS.md as the only conflict (both blocks kept). tsc 0; suite green
except `scripts/blob-measure.test.ts` (7 tests, fail identically on
`b771ab8` — environmental, pre-existing). Next for the toolchain, in order:
LBS-pose the skinned reference into the `.blob` rest pose (kills POSE
MISMATCH), a start-from-mesh scaffold (one `bar` per rig bone, radius from
the ring median, `# fit:` comment per number), a front/side depth-image
diff (silhouette cannot see interior creases), `emitBlob` generalised →
`blob:rings --apply` that refuses to move a pinned test property.

**BLEEDING WOUNDS + C2 TEMPORAL — BOTH OWNER-PASSED (2026-08-31).** Bleeding
(per-calibre emitters: pellet ooze / slug spurt-to-drip / stump gush, chunk
trails, floor splat decals, wounds-anchored so blood rides the animated body)
"definitely makes it feel better" — SHIPS ON at 0.5 droplet view scale (first
look read "really big" at FPV range); `__sdfGame.setBleed(false)` kill switch;
depth fix verified in-capture; bench fire-segment delta UNRESOLVED under
spread (≈ +0.1-0.25 ms). C2 half-rate verdict: ghosting "isn't that
bothersome" and should "work nicely combined with additional post-process
effects" — **stays a toggle (`setHalfRate`/`setHalfRateMode`), default OFF**,
revisit as part of the post-fx look package (waits on the X1.3 color-chain
retune). Artifacts catalogued honestly in its note (edge streaks, 1/30 s late
wound pops, gait stop-motion).
[bleed note](docs/dev-notes/2026-08-31-bleeding-wounds/notes.md) ·
[c2 note](docs/dev-notes/2026-08-31-temporal-c2-spike/notes.md)

- `X1.blood-viscosity` [~] **Impact gouts + goo that actually renders** — branch
  `claude/blood-effects-viscosity-8adcc3`, **NOT merged**. The goo layer now
  draws on `sdf-game.html` for the first time, ships **ON** by default with
  `mode:'depth'`, `blurPx 0`, world-oriented surface normals reconstructed from
  the field's own view depth, a per-impact `spawnImpactGout()` fired from
  `registerBleed`, a deep-red shadow floor so blood never reads black, and a
  live tuning panel (`goo-panel.ts`: 12 sliders, presets, a COPY button that
  emits the exact console calls).
  **BOTH round-2 blockers below were misdiagnoses.** The real bug:
  `postAa.addSink()` never handed a LATE-registered sink its output target, so
  the goo composited onto the canvas and the post-AA blit erased it every
  frame — it had never drawn a pixel here, which is why no threshold ever
  worked. "Depth rejects near-body blood" was an artefact of that (toggling
  fxaa/smear re-runs the redirect, so it intermittently worked). Overlay mode
  was built to route around a blocker that did not exist, cost the occlusion
  cue, and is reverted to `depth` by default.
  **Owner's tuned defaults** (found in one panel pass): sizeScale 0.14,
  threshold 0.65, blurPx 0, stretch 4, edge 2.75, absorb 1.6, spec 2.85,
  gloss 220, rim 0, shadowRed 0.12; slug gout count 85 @ speed 0.5/0.2.
  **Outstanding — read before merging:** Task 7's off-state parity gate and
  the fire-segment cost bench NEVER RAN, and goo now ships ON, so the extra
  passes are paid every frame unmeasured. Task 3's code-quality review never
  ran. And the tuned values were found in overlay mode with the OLD gradient
  normals — both have changed since, so absorb/spec/gloss want a revisit.
  [spec](docs/superpowers/specs/2026-08-31-blood-viscosity-design.md) ·
  [plan](docs/superpowers/plans/2026-08-31-blood-viscosity.md)

- `X1.bleed-look` [x] ~~**Visceral fluid look — PARKED for its own session**~~
  **SUPERSEDED by `X1.blood-viscosity`; the two blockers recorded below were
  both wrong.** Kept for the record —
  (owner call 2026-08-31). Round 1 RIBBONS rejected ("too thin and
  uninteresting" — lines cannot be volumes). Round 2 **`goo-layer.ts` PORTED**
  to the game page on `claude/bleed-look-spike` (**unmerged**): density/blur/
  surface nested in the draw chain like lab-main, postAa sink, light-rig nodes
  shared with a body view, `setSize` inside `sizeSdfLayer` (adaptive moves the
  target at runtime). Seams `__sdfGame.setGoo` / `setGooTuning(threshold, edge,
  blurPx, sizeScale, depthTest)`. It composites, is lit and glossy — and still
  does NOT reach the reference. **Two blockers, neither is tuning:**
  (1) **DEPTH** — the surface writes a depth reconstructed from the density
  field and goo appears ONLY against distant background, never against a body;
  `depthTest:false` reveals rejected blobs, i.e. near-wound blood is discarded.
  (2) **EMISSION MODEL** — metaball fusion needs overlap; 80-300 droplets
  spread through a volume never provide it. The lab's goo reads well because a
  GIB BURST is hundreds of droplets in a tight volume at one instant; a
  sustained bleed stream is the opposite. Next step is dense tight short-lived
  JETS + the depth reconstruction — **not more threshold sweeps** (five run,
  both failure modes proven: too low = every droplet its own oval, too high =
  nothing renders). Also unbenched (3 extra passes on a ~10 ms page).
  Reference frames (owner-supplied, Gears-style): connected glossy masses with
  torn sheets, tapering tendrils, fine satellite specks.

**GUN-FEEL-R2 REJECTED at owner playtest (2026-08-31)** — starts with the
model itself (unhappy with the grapeshot pick) and no visible barrel-end
flash; needs a rethink from the model up. Do not merge or re-propose
`dispatch/gun-feel-r2` as-is.
**SHELL MARCH — SHIPPED ON (owner-passed 2026-08-31).** Per-limb posed hulls
(`shell-hull-outer.ts`) bound the march: **−54% / −40% frame time** (room 3
23.3→10.8 ms, room 4 15.9→9.5, spread 2-9%) at real-render parity below the
same-state noise floor. Three bugs found en route, all by gates: (1) folding
`shellOut` into `tMax` put X1.15's clamped final sample on the hull — halos
(regression-guarded); (2) relax 1.4 fails its own visual gate on this page —
box-shaped washes, artifact suppressed but not fixed by the shell, stays 1.0
(`X1.game-relax` re-scoped: only viable after rework of the clamped-sample
path); (3) the OWNER caught the stale-hull mask — one material flipped
side/depthFunc+needsUpdate twice per frame forces WebGPU pipeline rebuilds
mid-frame and the rendered hull stops tracking walking bodies; every automated
gate had frozen the wanderers, so the live walk was the one untested path.
Fixed as two fixed-material meshes on two layers; live-walk gate scripted.
Also: TWO measurement instruments proven liars — occupancy mode in crowds
(misses don't discard → depth pollution hides real hits) and capture pairs
across a freeze (post-AA smear settles for ~7.9% of pixels). The occluder
measures ZERO (pixels and ms) on the game page — removal candidate.
`__sdfGame.setShell(false)` is the kill switch.
[note](docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)

**`X1.game-relax` [ ] THE GAME PAGE MARCHES UN-RELAXED — owner call needed.**
`woundCfg2.y` defaults to 1.0 and the march tests `> 1.0`, so `sdf-game.html`
runs at omega 0.6 (under-relaxed). Only `lab-main` has a `setRelax`; the game
page never got X1.10's measured 1.4 (~5%, 14.89 → 9.31 ms at ten bodies). It
costs **quality too**: room 4 resolves **27171 hit pixels at 0.6 vs 46224 at
1.4** — ~40% of the flesh the same field can resolve, unresolved at distance.
Strictly better on both axes by measurement, but it changes what renders, so it
wants its own visual gate rather than a silent flip.

**SHELL MARCH — GO (2026-08-31).** `__sdfGame.occupancy()` (march debug mode 4:
raw counters returned BEFORE the miss-discard, float target summed) measures the
shell march's market instead of asserting it: **82-92% of every pixel the march
rasterises hits nothing**, and those pixels carry **63-84% of all march steps**.
Proxy boxes cover 75-100% of the SDF target; flesh occupies 7.5-18%. A COUNTER,
not a timer — immune to the machine noise that made every timing A/B here
unresolvable, and two runs agree. Also explains the step-budget null: nothing
comes near the 96 cap (hits ~18.5 steps, misses 6-14), so the sweep measured the
cap rather than the step count. **This reversed an earlier wrong call** that read
that null as "miss pixels are already cheap" — misses are individually cheaper
but there are 5-11x more of them. Next: per-limb posed hulls that follow the
skeleton by rigid per-cluster moves (the spike's single rest-pose mesh took
~0.5 s and cannot be rebuilt per frame), then a crowd A/B — hull passes have
their own cost and occupancy bounds removable work, it does not predict speed-up.
[note](docs/dev-notes/2026-08-31-game-perf-baseline/notes.md) ·
[spike](docs/dev-notes/2026-08-25-shell-march-spike.md)

**GAME CROWD PERF (Phase 0) — BASELINE TAKEN (2026-08-31).** Owner shifted to
SDF rendering perf; target is his own: "stable 30 with multiple bodies and
other effects" = p95 <= 33 ms over a *firefight*. A scripted-firefight bench
now exists (`__sdfGame.bench`, `scripts/sdf-game-bench.sh`, 17 tests) with a
per-segment **scene census** that caught four bugs, each of which had produced
a plausible-looking table — the worst being that **damage persisted across
runs** (the page was never reloaded, so room 3 opened at `wounds 20` carried
from room 2 and every run tracked cumulative damage). Reloading per run took
repeat spread from **583% to 1-13%**. **Headline: resolution scale is the only
lever that moves this frame — scale 0.7 is −39%/−25% and 0.5 is −58%/−54%,
while the occluder pre-pass, the cone and FXAA are all inside spread. The
occluder is currently worth ~nothing.** That confirms fill-bound cost and
STRENGTHENS the shell-march case (it shrinks the traced pixel set; the
occluder only bounds ray length). Spike pass vs target: room 4 p95 30.3
(inside), room 3 37.7 (outside). **Also: rooms are NOT a crowd ladder — room 4
shows NINE bodies on screen**, the tunnels give sightlines across the ring.
Unresolved: cone-on/occluder-off on room 3 (spread > delta); rooms 1-2
placement faces a wall; gib segment reaches only `chunks 0->1`.
[spec](docs/superpowers/specs/2026-08-31-sdf-crowd-perf-investigation-design.md) ·
[plan](docs/superpowers/plans/2026-08-31-game-perf-baseline.md) ·
[note](docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)

**DRAGON CHARACTER — FIRST NON-HUMANOID .BLOB AUTHORED (worktree `2026-08-28-dragon-character`,
branch `dispatch/dragon-character`, 2026-08-31).** `dragon.blob` (59 prims, 2.04 m = 1.2x the
1.70 m mesh) authored against `docs/dev-notes/refs/dragon-mesh/dragon.glb` from measured bones
(20/20 joints land within 0.5 mm; scale 1.20000, rings spread 13.7%, ZERO BONE-LENGTH blocks).
13 measured pins in `dragon-blob.test.ts` (wingspan:body 0.75, hock height, metatarsus:tibia 2.4x,
tail reach+curl, head verticals, palette); tsc 0; suite 1801 green; render-check 0 holes after
raising the membrane lobes' anisotropy out of the renderer's hole family (deep 0.18 -> 0.28).
`stance digitigrade` validates only because the knee was pulled back mid-chord — the rig's
knee-forward bird fold classifies as 'humanoid' in `checkStance` (full story in the .blob header;
recommended fix: classify by metatarsus, not knee-vs-chord). Format findings: the rig has NO tail
joints (all tail surface rides Bone_001, authored on two unmapped bones + a measured bend), head+
horns are 24% of the mesh and unmapped (rings coverage ceiling 25%), `blob:measure` band
attribution breaks down when a spread membrane dominates every width band, and bar+`deep` squash
membranes top out as "wing nubs" — a real spar+sheet (shell) construction is the missing feature.
Vision-graded 4/5 dragon; owner eyeball still pending.

SCHOOLGIRL-ALT — INSTRUMENT TRIAL COMPLETE (worktree `2026-08-28-schoolgirl-alt-character`,
2026-08-28).** The controlled experiment: `schoolgirl-alt.blob` authored from scratch against the
same mesh as the hand-authored `schoolgirl.blob` (untouched control), using `blob:rings` +
`blob:measure` + measured test pins. Starting bones from the reference rig (the brief's biggest
lever) plus an UNMAPPED "bridge" bone carrying the rig's own Hips float produced: **rings spread
18.2% vs control 285.4%, ZERO `BONE LENGTH IS OFF` blocks (control: several, rank-1 −62.1%), and
`blob:measure --range 0.6:1` IoU 0.898 vs control 0.765.** 13 measured pins; tsc 0; suite 1769
green; render-check clean. Cloth findings worth reusing: the mesh's knees are APART (segmented
slices, centres ±0.078 — the control's knees-touching read pair-width-right/split-wrong); the
control's sock/calf prims run ~2x the mesh's per-leg radius (rings actually flagged this on the
control — `wide 1.000 -> 0.67` ranks 2/3/4 — and was right); the shell skirt needs tall >=~0.3
(a 16x-anisotropic tall=0.06 shell GPU-holes, render-check catches it). Full report in the
dispatch transcript; every number's source is in the .blob header.

**HIT-STAGGER FEEL — DONE on branch `dispatch/hit-stagger-feel`, awaiting
owner playtest (2026-08-28).** Owner's "the zombie needs to read as really
staggered and hit by something of substantial force" was three stacked
defects: (1) the game shoved with ONE constant (0.05) for every wound kind
while the lab scales by kind (blast 0.16); (2) the motion signal hardcoded
`type:'pellet'` so the slug — a blast-calibre wound — could only ever trigger
the weakest stagger kind (flinch); (3) no reaction ever interrupted
locomotion, which is why even a correct shove would have read weightless.
All three fixed, actor-owned so the lab stays bit-identical: per-kind
IMPULSE {pellet 0.07, blast 0.18, burn 0.04}; slug sends `shot.gain 1.3`
(lurch + recoil at 1.3x lab amplitudes); blast hits HALT the wander 0.55 s
(the lurch plays on a stopped walker) and knock the ROOT back ~0.17 m
(1.2 m/s, exp decay 7/s, bounds-clamped), then the zombie resumes its
target. Pellets deliberately unchanged (flinch-and-keep-walking = lab
reference). Buckshot of 16 still collapses via the meter (0.88 > 0.8).
Cost: steady-state actor step 15.5 vs 15.8 µs/step (noise); room-4 frame
EMA unchanged — the march still dominates. Gates + the lab comparison reel:
docs/dev-notes/2026-08-28-hit-stagger-feel/ (before/after/lab sequences).
Capture drivers: scripts/sdf-game-stagger-seq.mjs,
scripts/sdf-lab-stagger-seq.mjs. GOTCHA worth remembering: test/capture
aims must raycast a SURFACE point — a torso cluster centre sits inside the
field, anchors the crater pathologically, and the slug's severRadius cuts
both hip necks → instant collapse (never player-visible; the page's
predictor always aims at surfaces).

**BODIES FULL OF HOLES AT RANGE — FIXED (2026-09-01).** Owner: "the
zombie/character occlusion is so aggressive that from most distances it
doesn't render the full body — they look full of holes until you get fairly
close." Root cause is the OCCLUDER PRE-PASS's `tMax` clamp, and it is a
DISTANCE-ENCODING bug, not a hull-geometry one. The inner hull is correct:
sampling `sdBody` at all 300 spheres of the live POSED bodies puts every one
at least its own radius deep (`__sdfGame.hullInsideness` → 0 outside). What
is wrong is the number `occluder-hull.ts` rasterises for them. Measured with
ONE synthetic sphere of known centre and radius drawn alone
(`__sdfGame.syntheticSphereCheck`), the stored distance tracks truth only in
the near field and then collapses — and the error depends on DISTANCE alone,
not on the sphere's radius or its screen footprint:

    true 2.4 → 2.405 (exact)   true 4.9 → 4.252   true 5.9 → 4.447
    true 7.9 → 3.782           true 9.9 → 2.079   true 11.9 → 0.367

An UNDER-reported `occT` is the one error `tMax = min(box, occT + amp)`
cannot survive: the bound lands in front of the skin, the ray gives up, the
fragment discards. Holes because it bites per pixel wherever the hull covers;
distance-keyed because the encoding is accurate exactly where the player is
close. On one isolated zombie at 4.9 m: **1369 of 1375 lost pixels had tMax
IN FRONT of the flesh**, worst 0.68 m short; the hull's own CPU ray-sphere
entry (4.814 m) sat correctly BEHIND the surface (4.757 m) while the pre-pass
wrote 4.225 m for that pixel.

RULED OUT WITH EVIDENCE (all zero-noise-floor A/Bs, same page load): march
step budget — 96 → 192/384/1024 recovers 2 hit pixels and `meanStepsHit` is
13.8 against a 96 budget, and at 1024 the body is still just as holed; the
OUTER shell hull — off gains 2 hits while cutting rasterised px 120672 →
23762; tile culling — never enabled on this page (`tileCfg.x` stays 0); stale
hull — `refreshHull()` changes nothing; fetch misregistration — the shader's
`occT` matches the target texel 1391/1391; cross-body — a body's own hull does
the damage, the other nine contribute 0 changed pixels.

FIX: `march.wgsl.ts` no longer folds `occT` into `tMax`, and the pre-pass
ships disabled in game/lab/bench. It cost nothing to remove — interleaved
GPU-fenced timing (room 3, 8 bodies, 6 × 30 frames) was 14.23 ms occluder-on
vs 14.32 off against a 13.4–14.9 spread WITHIN either leg, matching the note
the shell work already left ("the occluder measured as worth nothing
anyway"); post-fix median 13.34 ms. Post-fix `setOccluder(true/false)` changes
**0 pixels**. Everything stays built and plumbed — `occluder-hull.ts`,
`occFetch`, debug mode 3, the `setOccluder` seam — so whoever works out why an
instanced `MeshBasicNodeMaterial` writing
`length(positionWorld - cameraPosition)` decays with distance can revive the
bound. **Do not revive it before that**: `shell-hull-outer.ts` writes distance
the same way and is unharmed only because `shellIn` is a ray START and
`shellOut` a `> 0` test, where under-reporting is conservative.

SEPARATE LANDMINE FOUND, NOT FIXED: march debug mode 4 documents `a = t`, but
`createMarchMaterial`'s `outputNode` overwrites alpha with CLIP DEPTH, so that
channel always reads back in [0,1]. Mode 4 also returns BEFORE the miss
discard, so a missed ray writes depth where it gave up and can WIN the depth
test over a farther body's real hit — which biases `occupancy()` and
`shellDiag()` low wherever proxy boxes overlap. Comments corrected; the
numbers those seams have produced were not re-taken.

**WOUND HULL HOLES — FIXED (worktree `2026-08-27-wound-hull-holes`, 2026-08-27).**
The owner's "parts of the zombie become invisible / transparent holes when one
walks in front of another" was NOT the hull exclusions (`dcd61ca`): the
empty-exclusion experiment renders the identical vanishing body, and
exclusions visibly fix the pale-disc artifact they were added for — path
stays. Real cause: `b33af36`'s depth slab used `max(-(r−depth), dot−capEff)`;
the dot term is positive BEYOND the cap, so every wound carved the entire
half-space behind its cap plane out to infinity. One wound looks perfect from
the front (placement gate passed); mixed-direction wounds hollowed whole
torsos and the march hit nothing. Lab never showed it — the lab uploads no
caps. Fixed as `min(-(r−depth), capEff − dot)` (bounded convex intersection);
uncapped path bit-identical (lab parity 0.002–0.003% vs 0.02% floor).
tsc 0, vitest 1662 (2 new behavioural slab tests that fail on the broken
form), slug placement gate 2.69 cm, multi-angle + overlap + red-bowl gates in
docs/dev-notes/2026-08-27-wound-hull-holes/. Occluder perf A/B re-taken: this
machine cannot resolve it (within-config noise > every delta) — re-gate on a
quiet machine before any removal call. New game seams:
`__sdfGame.setOccluder/setHullExclusions/refreshHull/hullDebug`,
`stampWoundAt(..., bodyId)`; march debug mode 3 = occT heat.

**WOUND RED-INTERIOR — FIXED (worktree `2026-08-27-wound-red-interior`, branch
`dispatch/wound-red-interior`, 2026-08-27).** Owner's "wounds read pale, not
red like the lab" was TWO stacked defects: (1) `traceProjectile` bisected to
its 1 cm `hitEps` shell — hits sat outside the skin, `probeFlesh` measured
zero flesh on EVERY projectile wound, and the thickness cap shifted the carve
sphere by the FULL radius → tangent, invisible craters with `rimScale 0` (the
blast path's `traceSurface` at eps 0.002 was always on-skin and unaffected);
(2) the cap worked by shifting the sphere CENTRE, which caps depth only by
guaranteeing the visible dish grazes the sphere's outer shell. Fixed by
bisecting to the true surface and capping DEPTH instead: carve sphere centred
ON the anchor (the lab's deep bowl) clipped by an inward slab at 45% of local
flesh (`Wound.carveN/carveDepth`, shader `max()` of the two SDF bounds,
`ROW_WOUND_CAP` = data row 18). Uncapped (lab, old wounds) takes a −1e5 slab
term that loses the max bit-exactly — lab pixel-verified at the same-code
noise floor (holdStill + fixed stamp + fixed cam, main-repo vite as pre-fix).
Game gates: slug torso reads RED like the lab; forearm slug severs to a
capped stump (no hole); staged pellet pocks red; occluder hull exclusion
added (real craters exposed hull spheres as pale discs). Evidence + staging
recipes: docs/dev-notes/2026-08-27-wound-red-interior/.

**SDF GAME PAGE FIXES — worktree `2026-08-25-game-page-fixes`, branch
`dispatch/game-page-fixes` (2026-08-25, three commits on the level work).**
Owner-reported breakage, root-caused: (1) dollhouse walls — wallPlanes wrote
the span into the wrong component for axis-2 planes, all 16 N/S room walls
were zero-width lines (orientation was never wrong); (2) displaced/decapitated
zombies — translateBody moved prims but not bones, so translated+rigged bodies
bound an origin-space rig to room-space flesh and rendered at ~2x spawn with
heads (rigid-head path) elsewhere; the old wander gate measured clamped intent,
not rendered bodies. Fixes + world-space gates in game-level.test.ts /
game-actor.test.ts; ceiling got hemisphere fill + emissive (was unlit, not
missing). No per-zombie scale variety exists — the "3x zombie" was the
exploded proxy box. crowd-alive must spawn actors from a bones-carrying
translateBody.

**SDF GAME LEVEL — worktree `2026-08-25-sdf-game-level`, branch `dispatch/sdf-game-level`,
gates green (2026-08-25, `35c3719`).** New sibling entry `sdf-game.html` +
`webgpu/game-main.ts` (bench-main pattern, NOT lab-main — lab untouched):
four-room ring (quadrants, 1.6m tunnels through the dividing bands, stepped
arch mouths, solid centre block = no diagonal), 1/2/3/4 wandering SDF zombies
(per-actor wrapper `game-actor.ts` drives stepMotion->stepRig->applyRig->view.update
with empty damage signals), FPS player with capsule-vs-AABB (`game-player.ts`,
pure, hand-worked tests), per-room environment bounce (probeWeight default
0.75 — analytic ambientAt means it is FREE; the brief's probe-cost warning
was stale), HUD (frame ms / bodies on screen / probeWeight / enclosure), and
the `__sdfGame` hook the grapeshot dispatch builds on (setPose/teleport/step/
freeze/zombie(id)->{view,posed,boundRig}/viewModelAnchor). Indicative frame ms
at scale 0.7: room1 16.7 -> room4 33.6 (4 zombies at the 30fps line already).

**NotBlood-core port landed + playtested (2026-06-15, `fde5200`)** — explosion-outcomes (launched-alive / flung-corpse / re-gib / head-pop) AND the tables-codegen + death/gib pipeline are merged to main and parity-confirmed. `scripts/gen_notblood_tables.py` generates raw Build-unit tables; `tuning.ts` is a curated overlay; pure `resolveDeathOutcome()` ports `actKillDude`. Codegen already caught a real off-by-one (burning-cultist HP). See `R7`.

**COMPUTE TILE BINNING — MERGED (2026-08-25, `90e1ca9`).** Tile binning moved
from the CPU into a WebGPU compute pass writing storage buffers allocated once
at the worst case, with the ACTIVE grid travelling in a uniform. This kills the
scale-lock defect: tiles used to be correct ONLY at the SDF scale their
`DataTexture`s were allocated at (1.0 measured **-37%** of flesh pixels with 99
console errors; only 0.7 was clean), which is why tile fold had to default off
while adaptive resolution moves the rung at runtime. Verified independently, not
taken on the agent's word: CPU/GPU tile lists **bit-exact** at scale
1.0/0.85/0.7/0.5 and distance 3.0/1.0/0.6/0.3, and **zero missing entries over
26 poses with adaptive ON** and the rung moving across 0.55/0.70/0.85. tsc 0,
1585 lab tests, all four characters render clean. Owner verified the look with
adaptive + tile fold both on.

- **Perf delta is nil** — p50 45 ms (on) vs 44 ms (off), scene A, inside the
  drift. Honest result, and an informative one: the per-step group-sphere cull
  already handles the single-body case, so we are bound by *pixels x steps*,
  not primitives. Tile fold therefore still ships **OFF**; flipping it needs a
  scene where prim counts actually bite.
- **The dispatch's own A/B gate was broken and its diagnosis was wrong.** It
  reported up to 18k phantom mismatches and concluded "the compute uniform
  upload lags". It does not — `uniform()` defaults to `objectGroup`
  (`updateType: OBJECT`, so `updateGroup()` always returns true) and
  `finishCompute` submits immediately. The gate was measuring itself: it re-bins
  the same storage buffers the frame loop re-bins every frame, and it built the
  CPU reference *after* the readback await, by which time the adaptive
  controller had resized the layer. Fixed in `a04caf0` — **preserve both
  invariants if you touch `tileAB()`**.

**QUEUED (2026-08-25, ox-alpha, serial):** `2026-08-25-crowd-alive` then
`2026-08-25-tile-all-bodies`. Crowd bodies are static fill *by design*
(`lab-main.ts:21`), so the per-body cost that scales to 15 characters — rig
solve, wound repack, data-texture upload — is currently **not measured at all**.
crowd-alive gives every body its own actor record, animation and wounds, while
keeping `freezeCosmetics()`/`setMotionEnabled(false)` freezing *every* body and
the crowd clock deterministic (the frozen noise floor 0.814 -> 0.0278 is the
only reason the relax question ever closed). tile-all-bodies then profiles 15
live bodies and **stops if the frame is CPU-bound**, extending tile lists across
bodies only if fragment work dominates. NOTE: each body already draws a *tight
proxy box* (`zombie-gpu.ts:964`), not a full-screen quad — "15 bodies = 15
full-screen marches" is false; the real costs are misses inside the box,
overlap, and per-body CPU work.

**SHELL PRIM + SCHOOLGIRL COLLAR (merged 2026-08-25, `07addaa`):** added a `shell` prim to the `.blob` language (thin sheet off a closed field, `abs(d)-thickness`, clipped against a plane with a rounded rim — iq's cloth construction). Rebuilt the sailor collar from shells (was 7 blob masses, now a 3-prim cloth cape+V+knot; owner's "epaulette plates"/"blob mass" read addressed — the collar now drapes over the shoulders with a V), made the skirt a thin shell cone with a rounded hem (was a solid cone), and deleted the shoe sole. Schoolgirl 62→57 prims. tsc 0, 1559 lab tests, render-check schoolgirl/zombie/cyclops/mouse all green. Collar reworked to a V/sailor read after owner review. (The dispatch could not commit — sandbox denied writes to the main repo's `.git` — so the work was auto-committed on the branch and merged from there.)

**Merged 2026-08-25:** perf task-1/2 (`8f4fdcd`) — `sdf-bench.html`, scenes A/B,
scripted orbit, headless driver (`npm run bench:sdf`), WGSL steps/prims heatmaps
(`debugCfg.x` 1/2), quiet-host baselines in
`docs/dev-notes/2026-08-24-sdf-bench/baselines.json` (A 42.8/111.7, B 18.4/47.0).
And the shell-march spike (`b1bd70d`) — standalone `/sdf-shell-spike.html`, 7
added files, **zero modifications to any existing character or shader**; imports
the field helpers from `march.wgsl.ts` so it cannot drift. Verdict: look survives
at the geometry level, ~14x fewer `mapBody` evals, ~1.8x frame single-body;
hands go mitten-y and the face dies at +3 cm hull inflation. Merged main:
tsc clean, 78 files / 1517 tests green.

**RELAX QUESTION CLOSED (2026-08-25, `e196e66`).** `relax` (`woundCfg2.y`)
**stays 1.0**, now with evidence rather than an owner impression. The blocker
all along was that the lab could not be MEASURED: blood, goo and gib chunks
keep animating between two A/B captures inside one page load, so the noise
floor exceeded the signal and three attempts (1b, ox-alpha r3, my own sweep)
each mistook noise for a result. Fixed by `__sdfLab.freezeCosmetics()` — stops
chunk physics, the blood sim, the goo layer and the shader clock. Gate floor
went 0.814 -> 0.0278 max lost-tile (poses>0.30: 10/36 -> 0/72), and the signal
then read unambiguously: **1.0 vs 1.4 = max 0.5503, 12/72 poses >0.10, 5 >0.30,
against a floor with ZERO >0.10.** So relax 1.4 skips thin geometry even with
task 1b's retract-to-tSafe fix. Instrument: `scripts/relax-sweep.mjs` (metric =
body-mask LOST PIXELS per tile, immune to goo; always run the floor with
RELAX_A==RELAX_B alongside). **`freezeCosmetics()` applies to ANY shader A/B in
the lab, not just relax.** Branches `dispatch/perf-task-1b` and
`dispatch/relax-thin-r2` stay UNMERGED — 1b's retract fix is sound but dead
code at relax 1.0, and neither ships 1.4. Perf tasks 2-5 remain `queued`.

**PERF IDEA QUEUED — footprint-proportional hit epsilon (2026-08-25).** Best
effort-to-value item on the board and not yet started. The fine march ends on
`hitEps = max(0.0012, woundCfg2.w)` — 1.2 mm in WORLD space, constant with
depth — so distant bodies resolve geometry far finer than a pixel and alias,
while `coneMarch` already computes the right quantity one function away
(`coneK` = "footprint radius per unit distance: tilePixels * tan(fovY/2)",
`r = t * coneK`) and the fine march throws it away. Ending within the ray's
projected PIXEL footprint prefilters geometry below Nyquist: real antialiasing
instead of FXAA guessing after the fact (may let `post-aa`'s FXAA go), AND
fewer steps to converge, with the saving growing with distance — i.e. largest
where crowds are. Corner-rounding cost is sub-pixel by construction, so
invisible. THREE HAZARDS: (1) `sdPrimitive` under-reports Euclid by the group
distortion factor (up to 22x, schoolgirl sole plate), so `d < eps` fires when
true distance is 22x eps -> blobby detached surface in high-distortion regions;
the epsilon needs the same distortion correction the fold cull already applies.
(2) craters fill in at range as eps approaches wound depth — wants a deliberate
floor. (3) it does NOTHING for shading aliasing, and `henenlotter-latex`
(spec 0.95 / roughness 0.12 + surfaceNoiseAmp) is the worst case — needs
roughness widening with footprint (Toksvig/LEAN) separately. Bonus: it tracks
the adaptive-resolution ladder automatically, so AA stays consistent at every
rung. Full analysis + the other three signal-reconstruction options (sparse
conservative grid, temporal reprojection, checkerboard) in Obsidian
`Claude Notes/Blud/2026-08-24-sdf-render-optimization-options.md`.

**Next session — pick up (prioritized):**
0. **`L2` — dungeon relighting: DONE + MERGED (2026-09-01, main `11942ca`).**
   `sdf-game.html` is a dark wet-gray stone dungeon lit by a weapon-mounted
   OFFSET flashlight and warm fire braziers, with per-pixel bumped specular on
   procedurally generated stone. 9 dispatch tasks on `zai/glm-5.3-flash` plus
   owner tuning passes.
   **Owner-tuned defaults, live on the goo panel:** beam gain 4 / shoulder
   0.35 / **keyFloor 0**; goo shadowRed 0.19 (raised from 0.12 — its job is
   that blood never reads black and it was calibrated against white gallery
   walls). keyFloor 0 means a body out of the beam runs on `ambientAt`'s fill
   term alone, so the carried lamp is the reason anything is visible; an
   earlier note claiming 0 would make bodies vanish was wrong (the fill term
   survives). Owner: "higher makes the zombies a bit too bright against ambient
   when not lit".
   **Bench** (`scripts/dungeon-bench.sh`, room-4 firefight, 3 alternating reps):
   dungeon-off 18.84 ms, no-shadow 21.46, shadow 21.36 — shadow overhead
   **-0.5%**, far inside the +40% gate; relight overall ~+12% over off-state.
   Numbers predate the occluder-pre-pass disable, so they are conservative.
   **Two bugs found that no test could see:** (1) three's `ShadowNode` copies
   the MAIN camera's layer mask onto the shadow camera when that mask has no
   bit above bit 0, and `sdfLayer` pins `camera.layers` mid-frame — the shadow
   map rendered with no level geometry in it; fixed by setting
   `spot.shadow.camera.layers` explicitly, which also enrols the character
   hull. (2) the occluder pre-pass's rasterised distance is exact below ~3 m
   then collapses (true 7.9 m reads 3.78), so `tMax` landed in front of the
   skin and rays gave up — the owner's "bodies full of holes at range". The
   pre-pass now ships DISABLED; it measured as free anyway.
   [spec](docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md) ·
   [plan](docs/superpowers/plans/2026-09-01-dungeon-relighting.md)

- `L2.followup-shadows` [x] **Character cast shadows read as one figure —
  fixed by SPANNING the primitives, not by inflating harder.** The suggested
  1.6 -> 1.8 sweep cannot work and the prim table says so without a capture:
  a primitive's two end spheres touch only when `inflate >= L / (rA + rB)`,
  and on the zombie that ratio is **2.95** for the shins (L 0.365, r 0.062),
  2.66 / 2.54 for the arms, 2.20 for the thighs. All nine spanning prims are
  still gapped at 1.6, eight of nine at 1.8, and the set only fuses at 3.0 —
  a 0.186 m sphere on a 0.062 m limb, a shadow three times the width of the
  leg casting it. So there is no inflation that closes the gaps AND keeps the
  silhouette. `buildHullInstances(..., span)` now steps spheres along each
  primitive's own axis at `SHADOW_SPAN_STEP` (0.75 of the two radii, so they
  overlap rather than merely touch), which is not an approximation of
  anything — it IS the capsule the primitive already is. Zombie: 10 disjoint
  components -> **1**, 30 -> 51 spheres; whole cast down to <=3 (cyclops
  excepted, see below). `SHADOW_HULL_INFLATE` dropped 1.35 -> **1.15**, since
  it is no longer doing the connecting. Shadow mesh budget doubled
  (`SHADOW_INSTANCE_FACTOR`) because `fillInstances` truncates SILENTLY and
  spanning halved the headroom. Verified: `scripts/shadow-ab.sh` — shadow area
  5398 px, before/after delta 2050 px against a 197 px in-load floor; the
  gained pixels are exactly the shoulder and shin gaps, the lost ones the rim
  that 1.35 had over-fattened.
  KNOWN LIMIT: the cyclops still spans into 11 pieces. Its clusters never
  touch as PRIMITIVES and are joined only by the smin blend, which a raw-prim
  hull cannot see. Nothing the game ships depends on it; pinned in the test as
  an explicit exclusion rather than left to be rediscovered.

- `L2.followup-frozen-ab` [x] **DISPROVED (2026-09-01) — the frozen capture path
  re-marches; the canvas readback was the liar.** The suspicion was that
  `freeze(true)` + `setLoopRunning(false)` + `step()` composites a held march, so
  character-only changes would be invisible to `scripts/dungeon-look.sh` and the
  bench built on it. It does not: `halfRate` (the only thing that skips the
  march) defaults false and no capture script enables it, and `step()` is
  `cb(dt); drawFn()` — the same two calls the rAF loop makes, so the per-actor
  uniform writes are reached. Proved with a discriminating capture: flesh albedo
  -> green at the `beam` pose moves **10496 px** against a same-state floor of
  **0**, and restoring it comes back to **111** (the HUD clock). The lighting
  knobs move it too — `beamKeyFloor` 0 vs 1 = 21103 px frozen against 21123 px
  live, i.e. frozen does not under-report. **The bench numbers taken through this
  path stand; nothing needs re-running.** What actually explained the identical
  readings: sampling the WebGPU canvas in-page with `drawImage` + `getImageData`
  returns an ALL-BLACK image (whole-frame mean rgb 0,0,0) at moments when
  `Page.captureScreenshot` returns the correct frame — with the loop running or
  stopped. Diff the PNG, never the in-page canvas. Second trap: a pixel COUNT
  under a hue predicate (`r > g+18`) survives a large uniform luminance change,
  so it is a poor detector even when the readback works. Third: `beamGain`
  legitimately does nothing at the `room` pose (92 px frozen / 11 px live) —
  `keyI = lightCfg.x*keyFloor + beam*gain`, so gain only bites where `beam > 0`;
  shoot that A/B at `beam` or `corridor` (7124 / 12917 px). Full write-up:
  [frozen-capture-verdict.md](docs/dev-notes/2026-09-01-dungeon-relight/frozen-capture-verdict.md).
  Guarded going forward by `scripts/dungeon-look-canary.sh`, which runs the
  albedo test through the real capture path and exits non-zero if a
  character-only change stops showing up — run it after touching `sdf-layer.ts`
  frame logic, `lab-renderer.ts` `step`/loop, or `gallery-look.mjs`.
  ALSO, from the shadow follow-up: what is NOT trustworthy is comparing two
  BUILDS across two loads. The actors wander, so a same-state pair already
  moves ~6.6k px of a 1.0 Mpx frame and the residual sits ON the figure —
  exactly where a character change would be — and reloading re-rolls which
  zombie stands in the beam (one attempt framed an empty wall). Toggle the
  feature INSIDE one frozen load instead (e.g. `__sdfGame.setShadowSpan`),
  which takes the floor from 6600 px to ~150.

- `L2.followup-wounds` [ ] **Wound pass round 2 (owner ask, not yet designed):**
  bone showing through deep wounds, plus additional wound coloring/texture. The
  highlight shoulder helps rather than competes — it is what gives a wound room
  to read DARKER than lit skin under the beam.


0. **`L1` P1 — DONE + MERGED (2026-08-25, `4e4939c`).** Analytic six-wall
   chromatic bounce; `ambientAt(p, n)` is the seam every later implementation
   swaps into (P3 volumes, the SDF-cone endgame). Zero extra `mapBody` evals,
   enforced by a source test. **Ships ON in the lab** with `practical-hard-key`
   at `ambientGain 4` (owner-tuned by eye). **The spec's "colour not brightness"
   rule was overruled by the owner's eye and that is the headline finding:** at
   gain 1 the preset's 0.06 fill makes bounce ~2% of the picture and it is
   invisible (4.21% of pixels, mean 2.05/255); the blowout the rule protected is
   carried by the KEY, so lifting the shadow side alone does not spend it. Room
   hue strength only sets INTENSITY — a lone saturated wall is vivid, a Cornell
   box (4/6 white) is subtle but visible at `game-ambient`. Parity verified, not
   assumed: at `probeWeight 0` the branch differed from main by 0.369% of pixels
   vs a 0.372% main-vs-main noise floor. Bounce is **gated on a room existing**
   (presets keep `probeWeight 0`; only the lab turns it on, with its enclosure)
   so nothing is lit by a phantom Cornell box. Findings +
   captures: `docs/dev-notes/2026-08-25-bounce-spike-findings.md`,
   `docs/dev-notes/2026-08-25-bounce-spike/`; paste-ins:
   `docs/dev-notes/2026-08-25-bounce-lab-pasteins.md`.
   **Open:** `game-ambient` still at gain 1, untuned; chroma gain (push the
   renormalised tint off neutral — more hue at the SAME level) never tried and is
   the cheap way to make neutral rooms carry colour; frame cost vs `sdf-bench`
   and the `clay`-still-reads-as-clay check never measured. **P5 (translucent
   material) depends only on P1, needs no world, and is the least-blocked next
   thing.**
0. ~~**`L1` — environment lighting: bounce-light spike (spec written
   2026-08-24, not yet planned).** Brainstormed with the owner; spec at
   `docs/superpowers/specs/2026-08-24-environment-lighting-design.md`.
   Direction: 1995-radiosity world with ReBoot specular, characters unchanged
   (they are latex, not clay), translucent character as a later one-off.
   Bounce **carries colour, not brightness** — the shadow side stays as dark as
   `practical-hard-key` makes it but takes nearby surface colour, so the tuned
   hard-key blowout survives. P1 is a LAB feature, not a level feature: a
   toggleable Cornell-box enclosure, ~4 analytic bounce lights derived from wall
   colours, `ambientAt(p, n)` as the seam, two new `LightPreset` knobs
   (`probeWeight`, `ambientGain`). **Hard constraint: zero extra `mapBody`
   evals** — analytic only, same precedent as the Selfie Girl `mapD` pattern.
   **PLANNED 2026-08-25 (`c127beb`)** — plan at
   `docs/superpowers/plans/2026-08-25-environment-lighting-p1-bounce-spike.md`,
   8 TDD tasks. Perf task-1 is merged so the before/after baseline now exists.
   Design rests on one invariant: **at `probeWeight 0`, `ambientAt` returns
   exactly `fillIntensity * keyColor`**, making the substitution algebraically
   identical to the pre-bounce expression — every preset ships at 0, so nothing
   moves until a slider does, and task 6 step 8 gates it as pixel-identical.
   "Colour not brightness" = renormalise the bounce to unit luminance; hue
   changes, level does not. `ambientGain > 1` breaks that rule on purpose and is
   the control for "does this want real radiosity lift". Zero-`mapBody` enforced
   by a source test on the `AMBIENT_AT` string, not by discipline. One deliberate
   spec departure, stated in the plan: **six walls, one per box face**, not ~4
   lights — same cost, no TSL uniform arrays (unused mechanism, bad risk inside a
   spike), and it turns open question 2 (ceiling?) into a runtime toggle.
   Dispatch queued at `~/.claude/dispatch/plans/2026-08-25-lighting-p1-bounce-spike.md`
   on **dsh / deepseek-v4-flash-vision-exp** (owner pick), status `queued`
   (INERT) — flip to `pending` to fire. Rebase note: perf task-2 rewrites the
   same shading block; whichever lands second rebases, and this is the small one.
   Decomposition: P1 spike -> P2 room/map editor -> P3 baked volumes -> P4
   dynamic flash+injection; **P5 (translucent material) depends only on P1** and
   is the least-blocked follow-up since it needs no world.~~ (P1 done — see above)
0. **`X1.hand-followups` — FPV full distal-arm rerun. PAUSED mid-chain on a
   rate limit (2026-08-20).** Tasks 0-4 were dispatched as
   `2026-08-20-fpv-distal-arm-task-{0..4}`; **tasks 0 and 1 are real and
   committed**, tasks 2-4 are NOT done despite the board saying so.
   - `dispatch/fpv-distal-arm-task-0` — `077a919`, choreography corridor pinned.
   - `dispatch/fpv-distal-arm-task-1` — `4468817`, the bake. All gates passed:
     6/6 frames 1 component + 0 boundary edges, contact error 0.48-0.65 mm
     (<=0.75), atlas 60.5 MiB (<=128), 1.5 mm pitch, `direct-vdb` route,
     byte-identical across four bakes.
   - **Tasks 2-4 silently no-opped** — kimi k3 hit 100% rate limit the instant
     task-1 finished, and dispatch recorded three 3-second runs as `done`
     exit 0. Their empty branches were deleted. To resume: reset those three
     task files to pending (they will fire immediately, so only do that AFTER
     the limit resets), and consider rebasing onto the current branch tip first
     so they pick up the `MAX_PRIMS` change.
   - Still ahead: Task 4 is **Gate B**, owner visual inspection. Tasks 5-6 were
     never dispatched and remain blocked on that approval.
   - **Owner review of the bake previews (2026-08-20): hand GOOD, wrist NOT.**
     The hand is well stylised and smooth — what the rerun existed to protect.
     But the hand-to-forearm transition does not merge naturally: the 35 mm
     bridge is a straight loft between two loops, continuous but not anatomical
     (no taper, no tendon structure, no ulnar head). **The topological gates
     cannot see this** — 0 boundary edges says closed, not convincing. A resume
     must address bridge SHAPE, not closure. Note also the previews tint the
     bridge blue (`BridgeClay` accent), which reads as a wristband and already
     caused one false seam alarm; the shipped asset is single-channel distance
     and carries no colour. Ship an untinted preview too.
   Scope already settled so it is not re-litigated: rebuild the RIGHT distal arm
   only — the left hand is choreography scope and the reference draws it as hand
   + wrist with no forearm (tiles 3211/3212).
   **The baked-SDF zombie line is closed** — see `X1.humanoid-sever-spike` for
   the verdict; the primitive zombie stays for enemies.
1. **Pipeline + a full weapon/feel polish pass — DONE + playtested (2026-06-17):** `gibSpawns` drive ChunkSystem (`a1e6b1d`); then a sweep of NotBlood-sourced fixes all merged + playtest-confirmed (`72f27d2`, `c38b34e`): flare flight/stick (segment-sweep; flesh-only stick; extinguish on death), flare strafe-origin, cultist burn-death sprite, player eye scale (1.75 from feet), and dynamite throw RANGE (costable 2^30 fix → ~2× velocity). All F2 rows below marked `[x]`. Next: port a new behavior on the pipeline+tables (`F2.cultist.dodge` / `F2.cultist.search`, or a new bestiary enemy).
2. **120-tic deterministic core** (ALL PLANS LANDED + playtest-confirmed 2026-06-23) — strangler vertical slice: deterministic sim spine (fixed 120-tic loop, integer Build units, plain-data SimState, seeded RNG, determinism harness) proven on `{player, dynamite, shotgun cultist}`; cosmetic VFX (Rapier gibs/particles) stays per-client. Targets P2P deterministic lockstep (rollback-extensible); transport is a later spec. **The shotgun-cultist AI port (`F2.cultist.*`: dodge/search/goto/real-LOS) folds INTO this milestone**, built natively deterministic.
   - Spec → [docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md](docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md)
   - **Plan series (4 + 3.5):** [1. foundation+harness](docs/superpowers/plans/2026-06-18-blud-deterministic-core-foundation.md) ✅ **DONE** · [2. player on sim](docs/superpowers/plans/2026-06-18-blud-deterministic-core-player.md) ✅ **DONE** (playtest-confirmed) · [3. dynamite on sim](docs/superpowers/plans/2026-06-18-blud-deterministic-core-dynamite.md) ✅ **DONE** (generic `kThing` mover [MoveThing port: gravity/floor+wall bounce], dynamite throw/fuse/impact-detonation as a sim kThing, explosion `SimEvent` → legacy AOE/VFX, retired Rapier projectile; 505 tests; **playtest-confirmed** after 4 fixes: mirrored-X throw direction, in-hand cook fuse 1.5→2.0s, right-hand throw origin) · 3.5 kickable head ✅ **DONE** (playtest-confirmed) — severed head is a deterministic sim kThing on SimState (gravity/floor+wall bounce, age-despawn 30 s), player punts it by walking into it (kick along facing + anti-pin cooldown), cosmetic billboard from sim.headRenders(); both head sources (normal popHead + explosion-launch) rerouted via chunks.spawnHeadHook. Playtest fixes (NotBlood MoveThing/actKickObject): floor friction (no infinite glide), soccer-ball kick launch, billboard floor-clip offset, Blood elastic 40960 · 4. shotgun cultist on sim ✅ **DONE** (playtest-confirmed) — full `aicult.cpp` ground AI on `SimState.dudes` (Idle/Chase/Dodge/Goto/Search/SThrow/SFire/Recoil), deterministic segment-vs-AABB LOS, sim-authoritative player damage; folds `F2.cultist.dodge/search/los`. Playtest changes: 8-pellet shotgun reworked from hitscan → **travelling sim pellets** (NotBlood nHitscanProjectiles; deterministic `PelletState`, dodgeable, 35 m/s) + debug **god mode** (G key). Open visual polish: `F2.cultist.pellet-visual`.
   - ~~Deferred: pellet-vs-player damage + deterministic `applyExplosionToPlayer`/`player.hp`~~ — **landed in plan 4** (sim-authoritative hp + legacy AOE player-exclusion). Open: `F2.cultist.sfx`/`F2.cultist.gibs`.
   - Context: dualmem `port-vs-recreate` + Obsidian `Claude Notes/Blud/2026-06-10-port-vs-recreate-thinking.md` + `2026-06-18-deterministic-120tic-core-design.md`.
3. **M5 bestiary + Phase 1 gate** — 30-min arena = fun playtest before any level code.

Key reference docs (open these before touching their area):
- Design spec — [docs/superpowers/specs/2026-04-20-blud-design.md](docs/superpowers/specs/2026-04-20-blud-design.md)
- NotBlood source map — [docs/dev-notes/2026-04-22-notblood-source-reference.md](docs/dev-notes/2026-04-22-notblood-source-reference.md)
- Animation system — [docs/dev-notes/2026-04-21-animation-system.md](docs/dev-notes/2026-04-21-animation-system.md)

---

## Milestones

- `M1`  [x]  Engine & Movement — `d05a306`
- `M2`  [x]  First kill + F1 dynamite port — `d721ed7`, playtest 2026-04-21
- `M3`  [x]  One-kill feel pass — `6c59491`; bone-weight + acceptance pending playtest
- `M4`  [~]  Full arsenal — flare gun + wave runner landed (`eb4a3ee..6000486`), more weapons next
- [x] M4-FPV: Flare gun FPV asset port + hotkeys (1/2/Q switch, Shift+F quick-equip)
- `M5-B` [x]  Single-fire-button weapon switching (1/2/Q slot swap; left-click fires current) — `1a142ad..3b3786d`
- `M5`  [~]  Full bestiary + Phase 1 gate (30min arena = fun) — first enemy M5-A landed; M5-C landed
- [x] M5-A: Shotgun cultist with pellet projectile + minimal AI
- [x] M5-C: NotBlood-faithful flare burn behavior + projectile graphic + cultist anim gap fix
- [x] M5-D: NotBlood fidelity pass — flare burn-death + dynamite + gib taxonomy (see [findings](docs/dev-notes/2026-04-26-notblood-fidelity-research.md))
- `M6`  [~]  Procedural levels (PIVOTED from Blender chunks → fully procedural deterministic data) — slice 1 (generated arena) landed `3ade23c`: seeded room-and-corridor `Floorplan` → `bakeSimGeometry` (sim) + `bakeLevelCosmetic` (meshes+Rapier colliders), single source of truth; kills `buildArenaGeometry`/`arena.ts` hand-sync dup. Spec [2026-06-23-blud-procedural-levels-design.md](docs/superpowers/specs/2026-06-23-blud-procedural-levels-design.md). **Browser playtest pending** (dev :5174).
- `M7`  [!]  The Algorithm boss fight — blocked on M6
- `M8`  [!]  Polish (music, balance, HUD) — blocked on M7
- `M9`  [!]  Ship to itch.io — blocked on M8

## Side quests (off the critical path)

- `X1` [x]  **SDF zombie lab** — raymarched SDF-volume character in a standalone
  sandbox, firewalled from `src/sim` and `src/game`. Smooth-min flesh with
  seamless joints, verlet jiggle, wounds as field subtraction with everted
  T-1000 rims, self-closing stumps, and raymarched gibs that reflect damage
  already dealt. **Verdict: worth building on** — see findings.
  Run: `npm run dev` → `/sdf-lab.html`
  - [spec](docs/superpowers/specs/2026-08-15-sdf-zombie-lab-design.md) ·
    [plan](docs/superpowers/plans/2026-08-15-sdf-zombie-lab.md) ·
    [findings](docs/dev-notes/2026-08-15-sdf-zombie-lab-findings.md)
  - Open follow-ups: align gibbing with Blud's own physics/gib logic + flesh
    trails; skeleton as a second SDF field; rest-space triplanar (specced but
    never implemented).
- `X1.1` [x] **Face + PSX surface** — carving, face, post-fx.
  [spec](docs/superpowers/specs/2026-08-15-sdf-zombie-face-psx-design.md) ·
  [plan](docs/superpowers/plans/2026-08-15-sdf-zombie-face-psx.md)
  - **Geometry carries SILHOUETTE, texture carries FEATURES.** Four primitives
    (cranium, jaw, brow, small nose) plus a flat greyscale face texture
    projected on the front. That texture does three jobs at once: albedo
    multiplier, height map driving relief, and emissive mask for red flickering
    eyes. Original art, so it can ship.
  - **Read `face.ts`'s header before touching the face.** It records four
    complete rebuilds and why each failed — smooth carves smear (smin's k*4
    blend is wider than an eye socket); hard carves (`blendK: 0`) fix that and
    are associative, so they're the right tool for wounds/stumps/skeleton but
    not a face; crisp geometry still doesn't read because all prims share one
    albedo, and faces are mostly colour not shape; and a protruding nose breaks
    a planar projection outright.
  - Also fixed: post-fx was never wired, which exposed that the flesh presets
    are tuned against a **missing sRGB encode** (post-fx defaults OFF until they
    are retuned — one job, not two); `validateBody`'s connectivity probe used a
    *bounding* centre a face drags outside the flesh; **the head was on
    backwards**; and the face projection normalised by a sphere radius on an
    ellipsoid head, so whichever axis was largest vanished.
  - Open: bloom for the eye glow (emissive already exceeds 1.0 to key it, but
    bloom needs the composer → gated on the preset retune); spherical
    projection mode built but never compared side-by-side; perf HUD + N-body
    spawner deferred, still the only route to an honest cost number.

- `X1.2` [x] **SDF lab on WebGPU** — parity reached; this is the path to build on.
  [spec](docs/superpowers/specs/2026-08-15-sdf-lab-webgpu-design.md) ·
  [findings](docs/dev-notes/2026-08-16-sdf-lab-webgpu-parity.md) ·
  run: `/sdf-lab-webgpu.html` (bench twin `/sdf-lab-webgpu-bench.html`)
  - Wounds, severing, gibs, face and panel all ported; primitive AND wound data
    ride one float texture, so `MAX_PRIMS` is no longer an authoring ceiling.
  - **WebGPU applies the sRGB output encode WebGL's raw `ShaderMaterial` skipped**
    (measured: 0.5 albedo → 188 vs 128). WebGPU is correct; the flesh presets are
    what look wrong — see `X1.3`.
  - **LOD baseline: 15 bodies = 36.8 ms / 44.7 p95** (M3, 960x540, 96 steps).
    Target ~16 ms. `[` / `]` spawn crowd bodies.

- `X1.3` [~] **Flesh look on WebGPU** — legacy-gamma toggle landed (`12a4e40`,
  lodCfg.y default ON): shader-side sRGB decode cancels the output encode, so
  presets read exactly as tuned. Remaining (owner call): keep the toggle as the
  look, or retune `material.ts` presets through the honest chain (needed before
  post-fx/bloom rebuild, which wants a defined color chain).

- `X1.4` [~] **LOD pass** — built, measured, and it does NOT reach the target.
  **Every number in this row predates `X1.8` and needs re-measuring — see `X1.10`.**
  [findings](docs/dev-notes/2026-08-16-sdf-lab-lod-pass.md)
  - Shipped: GPU timestamp queries (wall clock was vsync-pinned and hiding
    everything), screen-height-driven `lod.ts`, coarse `simplify.ts` stand-in,
    shader guards, tight AABB proxy, change-detected uniform writes.
  - **Worth ~10% on a distributed crowd, nothing on a close pack** (correctly —
    every body deserves full quality there). Ceiling of ALL quality reduction
    is −24%, so the 2.3x target is unreachable this way.
  - **Cost is fill-bound**: 18.6 ms + 0.237 ms/1k px, and linear in body count
    even when bodies occlude, because frag_depth + discard defeat early-Z.
- `X1.5` [x] **SDF layer at its own resolution** — flesh renders to its own
  target and composites over full-res geometry. **~2x**; default scale 0.7
  (0.5 read as too coarse). Slider in the panel.
- `X1.6` [x] **Raymarch optimisation** — relaxed sphere tracing (the old
  `stepMul` 0.6 was UNDER-relaxation), partial evaluation of the field
  (`specialise.ts`, **−20%**), and a cone-march pre-pass at 1/8 tiles giving
  every ray a proven-empty start distance (**−22%**, and the tightest
  measurement of the lot). Levers now stack to roughly **3x** overall.
- `X1.7` [-] **Compute polygonisation — PREMISE MOVED, re-derive before building.**
  Scoped against a raymarcher that could not reach 16 ms; `X1.9` puts 10 bodies
  at 13.5 ms. Re-read the spec's cost argument before writing a compute pass.
  [spec](docs/superpowers/specs/2026-08-16-sdf-polygonisation-design.md) ·
  [phase 0 plan](docs/superpowers/plans/2026-08-16-sdf-polygonisation-phase0.md)
- `X1.8` [x] **A benchmark that does not lie** — the old readout had three
  faults (rAF stops on a hidden page; the fire-and-forget resolve sampled a
  random one of the 3 passes per frame; hidden pages resolve to ~0.065 ms of
  nothing). Press **B**. Every absolute before this is unsourced.
  [findings](docs/dev-notes/2026-08-16-sdf-lab-lod-pass.md)
- `X1.9` [x] **Normal warping** (Hubert-Brierre et al.) — silhouette fbm out of
  the marched field, onto the normal via `calcNormal`; field is conservative
  again so over-relaxation applies to every body. **22.40 → 13.48 ms at 10
  bodies (1.66x)**, shading visually unchanged.
- `X1.10` [x] **Re-measure + relax sweep — QUALITY LOD IS DEAD.** On the honest
  bench (10 bodies spread, occluder on, cooled, interleaved control 9.81/9.74):
  LOD on = 9.79 vs off 9.81 — **0.2%, within noise**, at LOD's own benchmark
  scene. Relax sweep: 1.0 → 14.89 / **1.4 → 9.31** / 1.6 → 9.81 / 1.8 → 10.17;
  optimum is **1.4** (default flipped, ~5% free). LOD now defaults OFF;
  machinery kept for measurement. 2.0 unswept — curve already rising past 1.6.
  Sustained-thermal soak still open (punted; not ready to run).
- `X1.16` [x] Gib blob shapes fixed — torn-end wound radius now derives from limb
  girth (`tornEndRadius`, `extent.ts`), not extent×0.55; both renderer paths + tests.
- `X1.17` [x] Wound white-out + shimmer fixed — fresnel now fades with the wound
  mask instead of riding the 1.6× wet boost (both shaders); occluder ruled out by A/B.
- `X1.wound-shadow` [x] **Wound soft shadow** — the crater-concavity cue the
  halo fix chain identified as missing ("cast shadow vs darker floor"; the
  shadow won). iq-style sphere-traced penumbra (`WOUND_SHADOW` in
  `march.wgsl.ts`): 14 steps, k=12, t0=0.02, tMax 0.4 m, fired ONLY when the
  accepted hit sample sits in mapBody's nearWound zone (cost scales with
  crater screen area). Applied to key diffuse+specular only — fill/scatter
  untouched or craters go pitch black. New `woundShadowCfg` vec2 uniform (x
  strength, y softness; NO spare channel existed — woundCfg2.w is the hitEps
  override). Panel toggle + strength slider; `__sdfLab.setWoundShadow` for
  A/B shots; `scripts/bench-wound-shadow.mjs` is the interleaved bench
  (far −0.26 ms = noise; wounded close-up +0.88 ms, under the ~1 ms gate).
  A/B verified with gamma-lifted 12-frame orbits: lit-side craters read
  concave, dark side unchanged. WebGPU only; GLSL twin stays frozen.
- `X1.18` [ ] **Wound fluid: gushing/gooey particle gore** (feature, planned
  with user). Wounds should emit fluid — `blood-sim.ts` (X1.19) was built to
  host wound-anchored emitters; seed from `woundWorldPos`.
- `X1.19` [x] Gore-feel pass — per-prim gib pieces, 3D quat tumble + topple, gooey
  blood trails/splats on the game's tuning constants, wound-driven amputation
  (connectivity), rim locality. [spec](docs/superpowers/specs/2026-08-16-sdf-lab-gore-feel-design.md); playtest knobs: sever eagerness, droplet size.
- `X1.19.1` [x] Gore fix-pass — per-type wound profiles ("calibres"), tighter rim
  locality (no armpit welding), mid-limb severing (per-prim dead flag; floating-piece
  fix + hanging-arm chain anatomy), game-hot launch, trail-sized droplets.
- `X1.19.2` [x] Chain-cut union test — cross-sections now test disc samples against
  the UNION of carve spheres (overlapping wounds + fat joints sever); dispatched
  glm-5.3, merged with 6 regression tests.
- `X1.21.1` [x] Goo fluidity — separable 9-tap Gaussian on the density buffer before surface
  extraction (blurPx 2.5 default, `goo blur px` slider, 0 = bypass); frozen-pile A/B verified beads→ropes, +~0.15 ms.
- `X1.21.2` [x] Shell-silhouette glitches — BOTH pre-passes under-bounded the displaced
  field; occluder+cone bounds relaxed by shellAmp (dropout 320→26 px @ 4x amp, 12 tests;
  [dev-note](docs/dev-notes/2026-08-16-shell-glitch/)). Bench re-gate still pending.
- `X1.20` [ ] **Skeleton reveal** — procedural mesh bones under the flesh, two-state
  shatter, bloody ivory. [spec](docs/superpowers/specs/2026-08-16-sdf-lab-skeleton-reveal-design.md); plan after X1.21 (bones ride the large gobs).
- `X1.22` [x] **Rig motion pass (Spec B)** — 4-task dispatch chain merged (deepseek
  built gait/wander/ik, glm stagger/collapse+wiring): hero shambles, staggers,
  clutches, collapses; 1086 tests. Verified walking + crumple in browser.
- `X1.22.1` [x] Collapse "stall" — the 2s frames were the browser-pane background
  throttle (measurement artifact); the REAL bug was the per-frame dt clamp turning
  throttle into slow-motion sim. Fixed: sub-stepped rig integration (`planSubSteps`)
  + opaque canvas present; collapse 2.5s @ 60fps. [dev-note](docs/dev-notes/2026-08-16-collapse-stall/notes.md)
- `X1.23` [x] **FPV + dynamite (Spec C)** — 4-task chain merged (deepseek: fpv+flight;
  glm: hands, explosion-aoe, wiring). Verified: Tab FPV, SDF flesh hands, cook-throw-
  detonate gibs a body point-blank through the existing stack; 1201 tests. Burst
  billboards use the procedural-flipbook fallback (SEQ atlases are gitignored).
  [spec](docs/superpowers/specs/2026-08-16-sdf-lab-fpv-dynamite-design.md)
- `X1.22.2` [x] **Motion/look polish arc** (owner playtest rounds, 6 dispatch tasks +
  Opus hands): rigid head + face projection/ellipsoids riding rotation, socketed
  reach arms, gaze follows travel (tunable), wounds ride the turn, facing-chain
  quadrant fix + forward-knee pole rule, rest-space noise (texture glued to limbs,
  rows 8-9), measured FPV hands from CC-BY mesh (ATTRIBUTIONS.md). 1319 tests.
- `X1.26` [x] **Baked 3D-SDF hand prototype — OWNER VISUAL GATE PASS** — one relaxed right hand baked to an anisotropic R16F winding-number-signed volume, marched by the shared hands shader behind a `hand field` A/B (+ warp, clay) in the FPV panel; owner confirmed it reads immediately as a proper hand. Four captures + bench also pass (baked 2.52 vs prims 2.70 ms mean median). [design](docs/superpowers/specs/2026-08-17-sdf-hand-bake-design.md) · [plan](docs/superpowers/plans/2026-08-17-sdf-hand-bake-prototype.md) · [captures+bench](docs/dev-notes/2026-08-17-sdf-hand-bake/notes.md). SDF-prim hand rounds remain paused; animation and integration polish are the next hand pass.
- `X1.27` [x] **Baked-SDF dynamite grip + underhand release — OWNER VISUAL GATE PASS** — six-frame grip, authored underhand release, and exact held→flight handoff landed at `42ab78d`; owner approved the live preview on 2026-08-17. 1512 tests + production build pass; handoff error 0.000 mm and clip-vs-static bench delta −0.07 ms. [design](docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md) · [plan](docs/superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md) · [notes+evidence](docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md)
- `X1.gib-freeze` [x] **Shared/prewarmed WebGPU gib material + bounded view slots** — first and repeated full gibs measure 16.8–18.0 ms worst frame in a visible WebGPU run; eight cycles churned the 40-slot cap with no errors or stale visuals. 1515 tests + build pass. [evidence](docs/dev-notes/2026-08-17-sdf-gib-freeze/notes.md)
- `X1.texture-seams` [ ] **Shading-only rest-anchor seam blend** — X1.27 dependency is clear. Approved direction: sparse smooth-joint adjacency + CPU pose-to-rest transforms, evaluated once after the final hit; do not restore hot-path second-nearest tracking or bake the whole animated body. Implementation plan/execution handed to the other agent.
- `X1.sdf-authoring` [x] **Blender-native SDF grid qualification — COMPLETE** —
  Blender 5.2.0 LTS headless grid backend plus deterministic array-mesh
  union/intersection adapters are qualified. `direct-vdb` is the selected
  route. Booleans fold explicit OpenVDB `min`/`max` because Blender 5.2's
  `GeometryNodeSDFGridBoolean` returns its Grid 2 input for every operation
  (measured); Join Geometry is not a substitute either (internal faces).
  Analytic fixtures, the firm-grip hand union (99x135x78 @ 2 mm) and the
  humanoid RightForeArm intersection (44x40x38 @ 6 mm, one negative component)
  all repeat byte-identically across separate Blender processes.
  **Precondition, measured:** Mesh to SDF Grid needs GEOMETRICALLY closed
  operands. Given a real hole it emits an unsigned shell, not a solid — the
  hand soup keeps 66 boundary edges after welding and contributed only 302 of
  the union's 38,702 negative voxels (the closed wrist box supplied the rest).
  Judge closedness with `SDF.welded_mesh_info()`, never raw indexed boundary
  edges. Also fixed a real defect in humanoid Task 1: `_edge_adjacency` used
  `np.repeat` on block-stacked edges, so only 2 of every 4,000 reported face
  pairs actually shared an edge and the weak-face flood fill voted on noise
  (chest partition mosaic; 168 stray `RightForeArm` faces). `np.tile` + a
  regression test; partition bind bounds and the humanoid f32 hash are
  unchanged. Chisel 4.0.1 was evaluated and stays OPTIONAL development-only
  authoring/diagnostic tooling, never a production dependency. 48 grid + 17
  qualifier + 20 humanoid Python tests, 1516 Vitest and the production build
  pass.
  [design](docs/superpowers/specs/2026-08-18-blender-sdf-grid-authoring-design.md)
  · [plan](docs/superpowers/plans/2026-08-18-blender-sdf-grid-authoring.md)
  · [adapters plan](docs/superpowers/plans/2026-08-19-blender-sdf-grid-adapters-continuation.md)
  · [evidence](docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-qualification.json)
  · [notes + previews](docs/dev-notes/2026-08-18-blender-sdf-grid/adapter-notes.md)
  · [chisel findings](docs/dev-notes/2026-08-19-chisel-sdf-qualification/notes.md)
- `X1.hand-soup-closure` [x] **Nail beds, not the wrist cap** — the 66 welded
  boundary edges on every authored grip pose were five nail-bed rings (4x14
  finger + 1x10 thumb) left open because `X1.26` deliberately excludes the nail
  plate meshes while the skin keeps a matching cutout per digit. The cap chain
  was sound all along. `wrist_cut_cap(..., close_nail_beds=True)` fills them
  (+56 faces, vertex sets identical, max delta 0.0000 mm); the X1.26 static bake
  keeps the default so the SHIPPED hand volume is untouched. Qualifier hand gate
  passes. Unblocks `X1.hand-followups`.
  Gate result: **86,659 of 490,201 exclusive interior voxels (17.68 %, was
  302 / 0.06 %)**, one negative component, byte-identical across two Blender
  processes.
  [notes](docs/dev-notes/2026-08-20-hand-soup-closure/notes.md)
- `X1.humanoid-sever-spike` [x] **ANSWERED: baked SDF buys detail, costs
  deformability — keep the primitive zombie** (owner verdict 2026-08-20, after
  10 spike tasks + a 4-task dynamics pass, all green: 1751 tests, 29/29 browser
  gates, byte-deterministic bake).
  What it delivered: a textured 22-bone SDF humanoid marched from baked
  distance+colour bricks, forearm severing with complementary cut caps,
  bone-keyed wounds that ride articulation, and coarse-brick click-to-shoot.
  Face, hands and clothing read genuinely well.
  **Why the primitive still wins for enemies:** bricks are rigid, so (a) flexing
  the elbow opens a real gap at the back — two solids rotating apart leave a
  void and there is no flesh to fill it, and (b) craters cannot bulge, tear or
  splay, because the brick field is fixed data. The procedural body gets both
  for free: its limbs are overlapping blobs whose smin re-forms around any
  configuration. Detail and deformability pulled opposite the whole way.
  **The technique is worth keeping for things that do not deform much** — heads,
  hands, props. If anyone resumes it, the open leads are the joint-gap filler
  and scaling the joint smin by FIELD DIFFERENCE rather than band position (see
  the seam diagnosis; standard smin carves most exactly when the two fields
  already agree).
  [spike plan](docs/superpowers/plans/2026-08-17-humanoid-sdf-sever-spike.md)
  · [dynamics plan](docs/superpowers/plans/2026-08-20-humanoid-dynamics-pass.md)
  · [seam diagnosis](docs/dev-notes/2026-08-20-humanoid-dynamics/seam-diagnosis.md)
  · [closedness](docs/dev-notes/2026-08-19-humanoid-source-closedness/notes.md)
  · [albedo](docs/dev-notes/2026-08-19-humanoid-albedo/notes.md)
  · Obsidian writeup: `Claude Notes/Blud/2026-08-20-baked-sdf-humanoid-findings.md`
  · Seam fix shipped at `k = 0.002` — owner assessment 2026-08-20: "mostly not
  that bothersome now though still visible if you take a closer look", accepted.
  - **Measured, from the chain's own gates:** spike 29/29 (17 sever + 12 wound),
    first sever 18.4 ms, wound-scan delta 0 ms at 0/6/12 wounds, click-to-shoot
    0.072 ms/hit, 0 slot drops. Dynamics 32/32 (elbow-folds 0.156,
    hit-moves-body 1506 px, no-seam-line 80.5 <= 198.8).
  - **KNOWN GAP recorded by Task 4 and NOT closed by the owner gate:** the
    spike controller never advances `wounds[].ageSec`, so the wound-driven
    flesh wobble never decays — it reads as a static bulge instead of an
    impact that settles. The owner's "cratering is nonexistent" verdict was
    therefore rendered against a partially-broken wobble. One-line fix
    (`ageSec += dt` in the controller); worth doing before anyone re-judges.
  · merged to main 2026-08-20; branches `dispatch/humanoid-sdf-spike-r2-task-{2..10}` +
  `dispatch/humanoid-dynamics-task-{1..4}` (tip `10cc5f4`).
- `X1.humanoid-shader-gen-cost` [ ] **The 33 s first load is TSL codegen, not
  asset loading** — profiled 2026-08-20 on real Metal-3: 32.5 s to `ready`, of
  which **ScriptDuration 25.1 s**, and the entire profile top is `build` /
  `generate` in the prebundled `three/webgpu` chunk (TSL's node-graph → WGSL
  emitters), a dozen-plus calls at 300–550 ms each. Ruled out with numbers:
  fetch 120 ms for 48 MiB on loopback, SHA-256 60 ms, DOM complete 69–108 ms,
  30 resources, `LayoutDuration` 0, adapter real Metal-3 (not SwiftShader).
  Cause: the page builds **7 separate cluster materials** (6 attached + 1
  detached), each a full clustered marcher, and prewarm compiles all of them up
  front — which is what buys the no-first-use-pause guarantee, so the cost is
  deliberate, just entirely front-loaded.
  Lever already proven here: `X1.gib-freeze` shipped a **shared, prewarmed**
  WebGPU gib material for this exact shape of problem. Seven near-identical
  materials differing only in uniforms should collapse to one with per-cluster
  uniforms. Do NOT fold this into the dynamics chain.
  Aside, cheap: `humanoid-volume.ts` SHA-256s each transport part and then the
  combined buffer again — with `parts.length === 1` those are the same bytes,
  so ~48 MiB is hashed twice. Worth ~60 ms; tidiness, not the load cost.
- `X1.humanoid-spike-cleanup` [ ] **Three small things found while reviewing the
  chain**, none blocking, all cheap. (1) `HUMAN_WOUND_RIM_OFFSET` / `_WIDTH` in
  `humanoid-damage.ts` are hand-copied from `zombie-gpu.ts`'s inline `woundCfg`
  defaults and pinned to literals, so retuning `woundCfg.w` silently desyncs the
  cluster-duplication guard from the geometry it protects — export the constants
  and consume them in both places. (2) Every bone's negative region carries 1–11
  slivers of 1–5 voxels at support-plane grazing angles (`RightLeg` worst at 12
  components, largest 99.95 %); cull them in the baker. (3)
  `verify-humanoid-sdf-spike.mjs`'s `settledPieceSeparated` has a dead clause
  (`dist >= 80 && dist >= 60`), and the notes describe that gate in a way that
  reads as a failure by conflating the centroid distance with the component size.
- `X1.humanoid-walk` [ ] **Walk cycle on the baked humanoid** — owner ask
  (2026-08-19), explicitly NOT a blocker for the sever/wound live test, which
  only needs click-to-shoot (Task 10). The spike plan forbids walking on
  purpose, so this lands after it. Cheaper than it looks: `X1.22` already built
  `gait.ts` / `wander.ts` / `ik.ts` / `motion.ts` / `stagger.ts` / `collapse.ts`
  and they are pure. The work is a retarget, not a new rig — those drive the
  PROCEDURAL body's own skeleton, while the baked humanoid has 22 glTF-named
  bones addressed by `manifest.bones[]` array position, so the join is a bone-name
  map feeding `HumanoidPoseState.bones` (position + unit quaternion per bone,
  which is exactly what `poseMatrices` consumes).
  Two things already proven that this inherits: wounds are bone-local, so they
  ride any pose for free (the elbow scrub is the existing proof); and `X1.22.1`
  found the collapse "stall" was a per-frame dt clamp turning browser throttle
  into slow motion — reuse `planSubSteps`, do not re-derive it.
- `X1.hand-followups` [ ] **>>> NEXT SESSION: FPV full distal-arm rerun** — hybrid wrist and the
  later one-piece synthetic-forearm reference were both owner-rejected. The
  next run uses Blender-native SDF union for one hand+wrist+native-forearm field,
  retains an articulated upper arm, and pins the original Blud two-hand
  performance first: low bundle hold, short lighter-to-fuse reach, withdrawal,
  cook, then casual underhand toss. Modest 3D adjustment is allowed inside that
  keyframe corridor; football/overhand posing is not. The Blender-native union
  leg is **UNBLOCKED as of 2026-08-20** (`X1.hand-soup-closure` closed the nail
  beds; all six poses weld-closed and the qualifier hand gate passes); the
  articulated upper arm and the
  performance work are not. Intentionally paused until usage resets.
  [design](docs/superpowers/specs/2026-08-18-sdf-fpv-full-distal-arm-rebuild-design.md)
  · [plan](docs/superpowers/plans/2026-08-18-sdf-fpv-full-distal-arm-rebuild.md)
  **How much LEFT arm is visible: measured, not guessed.** Tiles 3211 (108x102)
  and 3212 (109x104) of `dynamite-lighter-ignite` are the only anatomy frames
  and both draw hand + a sliver of wrist, cropped at the frame edge — no
  forearm, no elbow. The other referenced tiles (3216/3217/3218/3221) are 5x8
  to 17x15 flame and spark bits. So the left side needs NO arm build; wanting
  more is a deviation from the reference needing an explicit owner call.
  A ready-to-run dispatch brief already exists for the closure prerequisite at
  `~/.claude/dispatch/plans/2026-08-20-hand-soup-closure.md` (done); the rerun
  itself still needs its tasks generated from the plan.
- `X1.25` [x] **PSX-AA post pass** — FXAA at internal res + temporal smear + optional
  sharp-bilinear upscale, `post` panel sliders, all-off = pixel parity. The first
  run's 'color shift' was a Y-flip (kimi-oai, 2 runs). Owner slider session open.
- `X1.28` [~] **Wound soft shadow** — iq sphere-traced penumbra fired only in
  the wound zone (ox-alpha dispatch; scripts/bench-wound-shadow.mjs; far view
  in noise, close +0.88 ms in ITS bench). Merged **DEFAULT OFF**: at full
  strength it draws black rings (its ray marches the WOUNDED field, whose lip
  is not a clean distance bound -> corrupted k*h/t penumbra) and cost ~50 ms
  close-up in practice. Panel toggle + strength slider. Rework before
  defaulting on: march the smooth pre-wound field, feather by the wound mask
  instead of the binary nearWound gate.
- `X1.24` [~] **Grapeshot shotgun (Spec D)** — MODEL DONE, glm-5.3's chosen (owner pick):
  `grapeshot-gun-glm.glb` (1 372 tris, 68 KB; [notes](docs/dev-notes/2026-08-16-grapeshot-model-glm/notes.md));
  kimi/k3's `grapeshot-gun.glb` kept as bake-off reference. Remaining: Blood sawed-off
  fire model after X1.23. [spec](docs/superpowers/specs/2026-08-16-sdf-lab-grapeshot-design.md)
- `X1.21` [x] **Gobs & goo (Spec A)** — amorphous gobs + scraps (`gobs.ts`), gore-mask
  chunk shading, screen-space metaball blood (`goo-layer.ts`), shell silhouettes
  bench-gated (default OFF: 12.36 ms @ 10 bodies > 12 ms gate; toggle in lod panel).
  [spec](docs/superpowers/specs/2026-08-16-sdf-lab-gobs-and-goo-design.md) ·
  [plan](docs/superpowers/plans/2026-08-16-sdf-lab-gobs-and-goo.md). Verified: gobs
  land mottled + torn in merged goo pools, 60 fps. WebGPU only. Playtest pending.- `X1.11` [-] ~~Port normal warping to `march.glsl.ts`~~ — dead: the WebGL lab is
  **FROZEN** at gore fix-pass parity (owner decision 2026-08-16). All lab work is
  WebGPU-only from here; the GLSL twin stays as reference until deleted at merge.
- `X1.13` [x] **Adaptive SDF resolution** — pure tested controller drives the
  layer scale from measured frame time. Signal is asymmetric: DOWN is computed
  (`scale * sqrt(budget/measured)`), UP must probe + back off, because wall
  clock is vsync-pinned. **27.2 ms/37 fps → 16.7 ms/60 fps** inside the crowd.
- `X1.14` [x] **Merged single-pass march — DEAD END, autopsy recorded.** One
  draw for the whole crowd; built, renders correctly, and loses. 1 body 2.04 →
  3.75 ms (1.84x), 10 spread 9.88 → 33.83 ms (3.4x), cone pre-pass worth 0.4%.
  The one-body case is decisive: no overdraw to save and no empty space to
  accelerate, so the cost is `mapScene` itself — an extra loop level, two more
  fetches per step and a second live accumulator, which costs occupancy on a
  fragment-bound shader. Kept behind `setMerged()` (off) until `X1.15` lands.
- `X1.15` [x] **Occluder inner-hull pre-pass — LANDED, and it SUPERSEDES the
  cone.** Matrix (10 bodies, cooled, interleaved): stacked 21.30 bare / 18.32
  cone / **16.29 occluder-only**; spread 11.24 cone / **10.86 occluder-only**.
  Occluder now defaults ON, cone OFF (toggle kept for measurement). Two bugs
  root-caused en route: the relaxed tracer broke on `t > tMax` before its
  overshoot retraction could fire (fixed with a clamped final sample;
  `march-tracer.test.ts` keeps the pre-fix loop asserting the miss), and
  wounds exposed hull spheres inside craters (fixed by wound exclusion in
  `buildHullInstances`). Residual: stacked-vs-solo still ~4.8x — hidden bodies
  march to the clamp through interpenetrating fields; fold into `X1.10`.
- `X1.12` [ ] **Research pass on iquilezles.org** — <https://iquilezles.org/articles/raymarchingdf/>
  and the surrounding articles/code. Deferred, not urgent.

## Asset pipeline

- `A1-A6`, `A9`, `A10`, `A11`  [x]  RFF/PAL/ART decoding, sprite extraction (axe-zombie, gibs, dynamite), animation system port, arena reskin — see git log + dev-notes
- `A6.5`  [x]  ~~Manual sprite sheets~~ — superseded by `A10` (QAV + SEQ manifests)
- `A7`    [-]  Voxelization pipeline (.vox per enemy) — deferred past M2
- `A8`    [-]  Clay shader / post-process — rolled into M3 feel pass

## Research / reference (reading list)

- `R1`   [x]  NotBlood tuning values → [docs/tuning-sources.md](docs/tuning-sources.md)
- `R2`   [x]  Gib picnum map → [docs/tuning-sources-gibs.md](docs/tuning-sources-gibs.md)
- `R3`   [x]  Sprite extraction toolchain → [docs/dev-notes/2026-04-20-blood-sprite-extraction.md](docs/dev-notes/2026-04-20-blood-sprite-extraction.md)
- `R4`   [x]  Blood palette decoding → [docs/dev-notes/2026-04-21-blood-palette-decoding.md](docs/dev-notes/2026-04-21-blood-palette-decoding.md)
- `R5`   [x]  Blood .MAP format + texture/asset co-occurrence → [docs/dev-notes/2026-04-21-blood-map-research.md](docs/dev-notes/2026-04-21-blood-map-research.md) (`4c0a0cf`)
- `R5.1` [x]  Vision-pass family labels + archetype clustering (addendum in R5's dev-note)
- `R6`   [x]  NotBlood source-code map + investigation recipe → [docs/dev-notes/2026-04-22-notblood-source-reference.md](docs/dev-notes/2026-04-22-notblood-source-reference.md)
- `R7`   [x]  NotBlood tables codegen + death/gib pipeline ported — `scripts/gen_notblood_tables.py` regen (raw Build-unit values → `src/game/notblood/notblood-tables.gen.ts`); `tuning.ts` is now a curated overlay deriving from the gen tables; pure `resolveDeathOutcome()` ports `actKillDude` (consumed by AxeZombie + ShotgunCultist + GibSystem) → [docs/superpowers/plans/2026-06-10-blud-notblood-core.md](docs/superpowers/plans/2026-06-10-blud-notblood-core.md)

## Feel / physics tuning

- `F1`       [x]  Dynamite throw arc + bundle sprite + sRGB fix — `18fca04` + follow-ups
- `F1.gibs`  [x]  Source-faithful `gibSpawns` drive ChunkSystem body chunks (adapter descales by `/4096` for the MoveThing `xvel>>12` integration; axis-remapped Build→Three). `GIB_CHUNK_VELOCITY_SCALE=1.0` kept — playtested good (`a1e6b1d`). Knob in `src/game/gibs/tuning.ts` if ever re-tuned.
- `F1.explosion-outcomes` [x] NotBlood three-tier explosion outcomes (launched-alive, flung corpse, corpse re-gib, head-pop) — spec [docs/superpowers/specs/2026-06-10-explosion-outcomes-design.md](docs/superpowers/specs/2026-06-10-explosion-outcomes-design.md)
- `F2`       [ ]  Broad feel sweep — audio table, palookup hit flash, AI timing, screenshake, decal growth. Revisit after M3 playtest; split into subtasks once prioritized.
- `F2.bone-visibility` [ ] Bones are 20% per spec but visually indistinct through palette dither + scanlines; needs bigger scale, brighter tone, or different treatment.
- `F2.dynamite-throw-distance` [x] Throw RANGE matched to NotBlood — `c38b34e`, playtest-confirmed. Corrected a unit bug: Blood's `Cos()` reads `costable[]` (2^30), not `sintable` (2^14), so `xvel≈nSpeed` (not `nSpeed>>16`). Simulated the kThing integer trajectory → full-charge ≈68 m (was ~17 m); doubled launch velocity (`max 14→28`, `min 3→6 m/s`; range ∝ v²). Fuse 1.5s (M5-D).
- `F2.dynamite-airburst` [x] Air-vs-ground explosion SEQ now selected per detonation (ports NotBlood `actExplodeSprite` florhit branch). Extracted full SEQ 4 (air fireball, tiles 984–996) + SEQ 3 (ground dome→mushroom, 2378–2390) via `scripts/extract_explosion_atlases.py` → `explosion-air/ground-placeholder/`. KEY FINDING: the old single atlas used only the LATE ground-SEQ tiles (2384–2388, the mushroom *peak*) — dropping the early dome — so every blast looked stemmed/floating mid-air. `GibSystem.spawnExplosion` raycasts down (static-only, `EXCLUDE_KINEMATIC|DYNAMIC`) → `isAirBurst(floorDist, GROUND_BURST_THRESHOLD_M=0.6)` picks atlas + anchor (air=center, ground=bottom). tsc clean; 421 tests; build+pytest green. **MANUAL PLAYTEST PENDING.**
- `F2.blood-trails-density` [x] Was sparser than ref — NOT the emit rate (20 Hz already matches FX_27's 6-tic reschedule) but droplet LIFETIME: source FX_27 is 4.0 s (480 tics) yet `chunks.ts` hardcoded an inline 2.5 s (fewer droplets alive at once). Restored to source 4.0 s; consolidated all trail params into `BLOOD_TRAIL` (had drifted into 2 inline copies); gravity 6→5, size 0.18→0.22. `f9be79e`.
- `F2.zombie-burn-drop` [ ] Powerup drop on burn-melt — deferred per M5-D Phase 1 findings (NotBlood doesn't do this).
- `F2.cascade-gibs` [x] Ported NotBlood `fxBloodBits` (callback.cpp:435) blood-splat cascade: every settling blood particle (FX_13 burst chunk + FX_27 trail droplet) stamps a floor splat at a random offset + `Chance(0x5000)` second pool. Blud: `leavesSplat` flag on burst+trail particles → pool `bloodSettleHandler` (fires on lifetime expiry OR surface hit) → `bloodSplatPositions` (pure, seeded) → DecalPool. Replaced the old hacky per-trail `onSurfaceHit` decal path. `BLOOD_SPLAT` tuning (spread 0.35, secondChance raised 0x5000→0xB000 for denser ground gore — playtest-confirmed). Splat SFX deferred. `f9be79e`+next.
- `F2.flare.charred-death` [-] Charred-corpse death sprite for burn-killed enemies — burn-death sprites now play; charred-corpse corpse-persistence art deferred.
- `F2.flare.stuck` [x] Flare flight + impact source-faithful — `c38b34e`, playtest-confirmed. Per-frame segment-sweep collision (no more midair freeze) + lifetime net; and flares now STICK ONLY TO FLESH (NotBlood `actor.cpp:3884`): wall/floor/miss spark and vanish (no floating landed flare, no "teleport to wall"). Enemy-stuck flare persists until host death (source-accurate).
- `F2.flare.strafe-origin` [x] Flare muzzle origin tracks the FPV gun when strafing (handPos from camera basis + view-bob) — `72f27d2`. Playtest-confirmed.
- `F2.cultist.burn-death-sprite` [x] Cultist burn-death plays the real cultist death sprite (repointed off the substitute PRIS art) — `72f27d2`. Playtest-confirmed.
- `F2.world-scale-anchor` [x] Player eye dropped to feet+`EYE_HEIGHT` (was double-counting the capsule half-extent → eye at 2.55 m); tuned to 1.75 m, playtest-confirmed human scale — `c38b34e`. Floating-landed-flare half resolved by flares no longer sticking to geometry (`F2.flare.stuck`).
- `F2.flare.stuck-on-death` [x] Stuck flares now extinguish the instant the host enters Dead (any cause), porting NotBlood `actor.cpp:6887` (flare removed on host death) — `c38b34e`. No more flare floating above the collapsed corpse.
- `F2.flare.sfx` [ ] Replace `FLARE_BURN_LOOP` placeholder with a real looping crackle sample.
- `F2.flare.cap` [ ] Cap max concurrent flares per enemy if stacking-too-many proves cheesy in playtest.
- `F2.head.kick-power` [ ] Kickable-head kick still reads slightly weak vs NotBlood (playtest 2026-06-23 "okay for now"). Tune `KICK_SPEED`/`KICK_UP` up in `src/sim/head.ts`, and/or give the head its own lower gravity for more hang time (more authentic floaty Blood arc than raw speed).
- `F2.cultist.gibs` [ ] Cultist-specific gib palette (blood color, flesh picnums) — currently reuses ZOMBIE_GIB_PROFILE.
- `F2.cultist.dodge` [x] Dodge/strafe behavior (NotBlood `cultistDodge` / `aiMoveDodge`) — folded into plan 4 (Dodge state on `SimState.dudes`).
- `F2.cultist.search` [x] Search-after-LOS state for cultist (scans area when player breaks LOS) — folded into plan 4 (Search state on `SimState.dudes`).
- `F2.cultist.los` [x] Real LOS raycast for cultist — folded into plan 4 (deterministic segment-vs-AABB LOS against arena geometry).
- `F2.cultist.sfx` [ ] Replace placeholder cultist SFX (reuses zombie aggro/death sounds).
- `F2.cultist.pellet-visual` [x] Cultist shotgun pellet tracer now uses NotBlood's `kMissileShell` bullet sprite (tile 9295, 15×16 glow) — extracted from `notblood.pk3/TILES099.ART` (BUILDART magic-prefixed format, not handled by `extract_blood_sprites.py`; extracted manually with the Blood palette) → `public/assets/weapons/shotgun-shell-placeholder/9295-placeholder.png` (gitignored placeholder; `syncPelletTracers` loads it null-safe, falls back to a flat glow). **Awaiting visual playtest.** Nice-to-have: add BUILDART support to the extraction script.

## Process / tooling

- `P1`  [x]  Dispatch-UI setup (M1 tasks completed + merged)
- `P2`  [x]  Write M2 plan via `superpowers:writing-plans`
- `P3`  [-]  CI / GitHub Actions — defer until meaningful test coverage exists
- `P4`  [ ]  Dependency audit — `npm audit` flags 6 vulns (1 critical); likely transitive, safe for a web build
- `P5`  [-]  Prune old `dispatch/blud-m1-task-*` branches
- `P6`  [x]  Theme-preview schema merge — `scripts/build_theme_patterns.py` joins `patterns.raw.json` + `labels.json` → theme-shaped `patterns.json` (`{texture_families[weighted floors/walls/ceilings], map_archetypes, geometry}`); validates clean; 30 families/39 maps; doorFreq 0.0413 cross-checks R5's 4.1%. Feeds procgen levels §5.1 + deferred theming.
- `P7`  [x]  BUNFUSE extraction + cooking visual — `dynamite-fuse-burn.json`, `7081c14`
- `P8`  [~]  **Blobforge** — the `.blob` SDF character pipeline: text → `BodyDef`,
  rendered by the lab, byte-exact round trip, `fused`/`clear`/`daylight`/`stance`
  checks, generated face textures, per-character palettes + albedo mottle,
  polygon kits authored in WAM, turntable, agent skill. 1295 sdf-zombie tests,
  tsc + build clean. `zombie.blob` reproduces `makeZombie()` to **3.77e-9 m**.
  **SHARP FEATURES LANDED** — the vocabulary was the bottleneck, not the loop:
  `r2=` (tapered capsule; `r2=0` is a true point), `tip=` (displaces the far end
  alone, so a prim points off-bone), `chamfer` (flat-bevel fold, keeps a crease),
  `groove` (4th part kind, cuts a channel along where its surface crosses the
  body). The goblin's nose and ears were multi-blob fakes whose own comments
  described the limit; both are single prims now.
  **Two rules that cost rounds:** *reach is the whole game* — a point that stops
  inside the mass it grows from reads as a bump (cranium semi-depth 0.118, the
  first tapered nose tipped at 0.122 and was still a bump); and *two features at
  the same height fuse* — separation must beat the SUM of the two blends.
  **Primitives since:** arc capsule (`bend=`), groove and `shell` SHIPPED;
  still unbuilt from the roadmap — rounded box (the first flat face), blend
  exponent (cheapest, most general), torus, prism; plus a spar+sheet
  construction the dragon's wings showed is missing (2026-09-01 review).
  **Also open:** lab cold boot is 19-30 s and it is three's TSL node builder, not
  the GPU or the network — ~85% of a CPU profile; deferring the warm-up made it
  WORSE (36.8 s vs 18.8 s) because nothing paints until `main()` returns, so the
  fix has to get a first frame up before the builds. Eye shape/angle/spacing
  sliders (params exist in the `sheet` block, only read at load). `carve` is
  limb-locked to head; `emitBlob` unwired from the panel.
  **ox-alpha modelling tests:** clown on `dispatch/ox-alpha-clown-character` —
  NOT merged, fails 3 of its own tests (asserted a material list, then rebuilt
  the glTF without re-running; ruff 88 mm inside the body) despite exit 0 and a
  "gates green" report. Mouse dispatched 2026-08-21.
  **Mouse snout run (2026-08-22, `dispatch/mouse-snout`):** the mouse now HAS
  a muzzle — one bent tapered prim (`r2=`+`tip=`+`bend=`), field-measured head
  depth 0.364 m = 33% of standing height, matching the side-profile reference
  (two prior runs built flat faces off the front view alone). The kit was
  written but never built/registered — now compiled, in `KITS`, and its brows
  were 92% buried in the skull (offset z 0.010 → 0.066). LOOK entries for the
  mouse cloth materials: without an env map the royal-blue shorts rendered
  black from every unlit angle.
  **Mouse rebuilt against the MESH + painted outfit (2026-08-22, branch
  `silhouette-match`, see docs/dev-notes/2026-08-22-painted-sdf-outfit.md):**
  `.blob` prims can carry `color=rrggbb gloss=0..1` and a `core` mark; the
  mouse's shades, shoes, tee, shorts and sleeves are painted SDF and its kit
  is DELETED. Head and body re-proportioned to the mesh surface (frame-aligned;
  shoulder 0.53, collar 0.60), ears dished, lenses wrap the cheek with temple
  arms. Silhouette vs plate 0.660 -> 0.774 (re-measured 2026-08-22 with
  blob-measure: 0.804). Engine fixes on the way: occluder hull per-end
  radius (the "orb nose hole"), coneBend untapered branch, expandMirror
  x-reflection, clusterCore `core`, setStepsOverride(0), focusBody height.
  OPEN: hands enlarged but unreviewed; merge to main.
  **Agent toolbox baselines (2026-08-22, branch `agent-toolbox`, plan
  docs/superpowers/plans/2026-08-22-sdf-agent-toolbox.md):**
  | character | ref | IoU | mean width err | pose mismatch | worst band (line) | render-check |
  |---|---|---|---|---|---|---|
  | mouse | mesh (full) | 0.669 | 0.094 | yes | band 8, line 433, upperarm.r (armR), delta -0.356 | exit 0, OK |
  | mouse | plate (full) | 0.804 | 0.053 | yes | band 11, line 450, f_index.r (armR), delta +0.346 | exit 0, OK |
  | mouse | mesh, range 0.75:1 | 0.682 | 0.013 | no | band 8, line 497, foot.r (legR), delta +0.045 | exit 0, OK |
  | mouse | plate, range 0.75:1 | 0.800 | 0.015 | no | band 7, line 498, foot.r (legR), delta -0.054 | exit 0, OK |
  | goblin | none | no ref | no ref | no ref | no ref | exit 0, OK |
  | zombie | none | no ref | no ref | no ref | no ref | exit 0, OK |
  | clown | plate (clown-1-ref.png) | 0.561 | 0.155 | yes | band 1, line —, kit (kit), delta +0.348 | exit 0, OK |
  | clown-alt | plate (clown-1-ref.png) | 0.605 | 0.152 | yes | band 13, line 197, shin.r (legR), delta -0.295 | exit 0, OK |
  Whole-figure IoU is a before/after gradient per character, never a target
  (reference poses differ from the rest pose). The Task 11 trial is judged
  against these numbers.
  **IoU definition changed 2026-08-23** (after the schoolgirl run): the window IoU is now computed in HEIGHT units on a shared centreline, so rows outside a `--range` cannot distort it (a T-posed mesh made the schoolgirl's legs read 0.22 while agreeing to 0.008). The table above is the OLD definition; re-measured: mouse mesh 0.757 (was 0.669), mouse plate 0.805, cyclops 0.847, schoolgirl legs window 0.830 / head 0.906 / side 0.798. `row jerk` is also reported — it catches stacking that reaches the OUTLINE only; interior ring grooves (the schoolgirl's torso) are invisible to every silhouette number and need the pictures.
  **Task 11 trial queued (2026-08-22):** `~/.claude/dispatch/plans/2026-08-22-trial-mouse-shoes.md` — `zai/glm-5.1`, base `main`, ONE JOB: the mouse's shoe bands (0.88/0.90, line 497) within ±0.015 of the mesh in `--range 0.75:1`, IoU 0.682 -> >=0.70. Judge on three things: did it measure first, did the numbers move, did it look at frames. The hands were NOT chosen because whole-figure silhouette cannot see them (pose mismatch); they need a local measure like head-profile — open follow-up.
  **Trial result (2026-08-22, `zai/glm-5.3:xhigh`, 40 min, merged):** PASS on all three: measured first (start/end numbers in its report), numbers moved (legs+shoes window IoU 0.682 -> 0.703, mean width error 0.013 -> 0.008, shoe bands 8/9 out of the worst list; worst now thigh +0.014), and it looked (vision-ask on frames, reverted an edit that broke the gates, updated the test pin with a reason). Owner-eye check of the frames: two separate soft shoes, ball wider than heel. Verdict: the measured loop works on a weaker, text-only model. Next challenges: cyclops (`refs/cyclopsbuffmonster.glb` — legless, headless, tail; tests 'add primitives freely'), then the schoolgirl (`refs/schoolgirl-aura/`, rigged T-pose, Ichiro Tanida style).
  **Wound fixes (2026-08-22, main):** (1) craters flickered/snapped on walking limbs — damage.ts rebuilt the prim-local basis each frame with basisFromAxis, whose seed choice flips on near-vertical limbs; wounds now store their stamp axis and transport the basis by shortest arc (live probe: 18.6 cm jumps -> 0). (2) hits bound to the nearest ENDPOINT, putting the lower torso and flanks on forearm/thigh prims; now arg-min sdPrimitive, the shader's hitBest rule. (3) rim banding: the lip's surface-locality gate ramped over 0.35..0.7 amp (~4x Lipschitz); now -0.3..0.7 amp. (4, 2026-08-23) cyclops craters: grey speckle 'showing through' = the character's surfaceNoiseAmp 0.12 on a glossy hide (palette, now 0.04; bisected live — paint, face projection, mottle, roughness all cleared); ring/ball on the claw = rim shell added OUTSIDE the flesh (36% of rim cells at 0.7*amp reach) — reach now 0.35*amp (12%) in all three shaders, plus Wound.rimScale from the flesh thickness behind the hit (worldHitToWound takes the field). (5, 2026-08-23, `6605782`) crater 'ball from the side, streaks on the floor': the ball was the LIP (rimWidth 0.42 torus painted wet-red to 1.6x radius) -> rimWidth 0.25, wet mask 1.25x; overlapping craters' sharp ridge -> carves unioned with smin then one smax; no occlusion inside craters -> ao darkened by woundMask; streaks = relaxed tracer banding inside the cavity -> applyWounds returns nearWound (mapBody.z), march steps 0.6*d there (plain 1.0 still banded). (6, `d43ab42`) white band on the zombie lip = fresnel fade lost when the wound mask shrank -> woundMask returns (1.25x colouring, 1.6x fresnel); pellet lip 0.8 -> 0.35 splay; stripes across the cyclops fangs at zoom = the stub skull's face sheet projecting planar along z -> `sheet` block `enabled 0` (new key, lab honours it). OPEN: (a) a crater viewed into still reads as a ball from some angles — geometry is concave (CPU height map), the cue missing is a cast shadow/stronger floor darkening; owner to decide between darker matte floor vs a shadow ray near wounds. (b) FPS drop when zoomed close: FIXED — fill-bound cost (benchGpu 8.7 ms far -> 16.5 close; only SDF scale moved it). Adaptive resolution is now ON by default and drops a rung on p95 spikes (missed vsyncs) that the median cannot see; close 0.45 scale p95 17.2, far climbs to 1.0. Then (2026-08-23 pm): spikes while ORBITING zoomed = failed upward probes (by design, every ~2.5 s); probes now abort after 8 frames on missed-vsync spikes, base interval 3 s, backoff ceiling 20 s, ladder floor 0.2 for retina buffers; 15 s orbit p99 31.8 -> 22 ms, bursts 8 -> 3 frames. REMAINING, by design: one 3-frame burst per failed probe every 6-20 s while the scene sits at budget. **Schoolgirl v2 (2026-08-23, `kimi-oai/kimi-k3:xhigh`, merged):** look gate PASSED by its own vision-ask (ONE SMOOTH/SKIRT/BOB both views) and by owner-eye proxy: one smooth tapered torso, flared one-cone skirt, bob; legs 0.823 / head 0.907 / torso-side mean 0.014. Still wrong: the sailor collar reads as two white epaulette plates on the shoulders (needs a flat V-collar on the chest/back, scarf knot), and the face is a navy visor band (eyes need to be two small prims, not a band). v3 = face + collar only. **Face DECAL (2026-08-23, main):** owner: agents cannot paint a face; the mesh's own face pasted flat (PSX) is fine. The GLB's atlas is fragmented photogrammetry patches (no face island), so `npm run blob:face-bake -- <name>` renders the head orthographically from the front with its texture -> `public/assets/lab/faces/<name>-face.png`; `.blob` `sheet` gained `image <file>`, `decal 1`, `projScaleX/Y`, `projCentreX/Y`; shader: `faceCfg.x == 2` pastes tex.rgb as albedo (no glow, no relief) and the head-confinement reach is 1.5x (hs is normalised by the fattest head prim = the HAIR crown, which clipped the mouth at every projection setting — the 'nothing changes' trap). Eye/mouth prims removed from schoolgirl. `blob-turntable` gained `BLOB_TARGET_Y` (head close-ups) and `BLOB_PROBE` (poke/print a uniform before shooting — A/B without editing). Skill + reference + template updated: the face is not the agent's to paint. OWNER ALSO FLAGGED (v3 scope): forearm/hand clips the skirt hem (arm bones tilt=-2 inward, skirt flares to the hand); the 'white oval under the feet' is the sole plate at line ~261 (0.15x0.26 light grey bdb9bc at floor, 4x the shoe's depth) — shrink to the shoe footprint and darken. **Perf + wound shading (2026-08-23 pm, main `dfac7b2`/`eda786c`):** two-level fold cull (pack.ts boundGroups, ROW_CLUSTER_GROUPS/GROUP_*, DATA_ROWS 16) — schoolgirl ~35% faster, verified fold-exact via 200k-point CPU sweeps; the soundness lesson: sdPrimitive under-reports Euclid distance by maxScale/minScale (sole plate 22x), so every sphere-vs-d cull multiplies its threshold by a packed distortion factor — factor-free tore black crack seams inside wound cavities. Wound white slabs: three causes fixed (mask sphere painting the far side of the torso -> facing gate on colouring; spec firing on the shadow side -> light-facing gate; fresnel escaping at the cavity wall -> fade full to 1.3x). OPEN (next session): faint white grazing patch on limbs adjacent to wounds from some angles — smaller than the slabs, isolations say fresnel/wet interplay, NOT field error; owner still finds wound shading distracting in motion. **Schoolgirl head rework (owner-authored):** open forehead, decal paints hairline/peak, taller cranium, ears out; decal aim 0.38/0.45/0.89. v3 dispatch (collar/hands/sole) re-queued after being cancelled mid-baseline. **Perf plan QUEUED (2026-08-24):** spec DECIDED (0.7 scale floor, 30 fps everywhere incl. 12-body crowds, smooth LOD fades only, dedicated bench page; approach 1-extended locked) — docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md. Implementation plan: docs/superpowers/plans/2026-08-24-raymarcher-perf.md (6 tasks: bench page+stats, heatmaps, cheaper hit shading, specialise measurement, per-tile lists + merged march, smooth LOD + coverage headroom). Dispatch chain at ~/.claude/dispatch/plans/2026-08-24-raymarcher-perf-task-{1..4}.md — task-1 is status `queued` (INERT) so nothing runs until the owner flips it to `pending` (or hits run in dispatch-ui at localhost:8090); tasks 2-4 are pending behind depends_on and auto-flow. Task 3 (tiles+merged march) is on kimi-k3, 180m. **Schoolgirl v3 MERGED (2026-08-24):** the dispatch hit its 120m cap during final verification (status 'failed', exit 124) but all three fixes landed with gates — sole = shoe footprint (NO PLATE), hands clear of the skirt via arm-chain repitch (CLEAR, clearOf +0.0069 pinned), real sailor-collar construction (best-SAILOR); merged with the ecd3ba pale skin kept over the branch's dab18a. Owner-authored head v3 also on main (open forehead, side locks, flat-lit decal, aim 0.38/0.42/0.78). REMAINING on schoolgirl: owner's close-up verdict on the collar. OLD POINTER (perf brainstorm) IS DONE. NEXT SESSION STARTS HERE: judge whatever perf dispatch tasks have run (reports in ~/.claude/dispatch/reports/), merge by their gates; if none have run, nothing is blocked — the chain waits for the owner. Then: cyclops v2 dispatch, mouse hands (needs a hand-profile measure first), residual wound grazing patch. Previously:  docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md (brainstorm paused at the approach choice; owner decided target C = A must hit 30 fps at full window, B degrades to LOD; adaptive budget now 30 fps). Resume: answer the 4 open questions, pick an approach, then writing-plans. The real fix is a headroom signal: either reliable GPU timestamps (multi-pass resolve is broken, see adaptive-scale.ts header) or a coverage predictor (projected cluster-sphere area x scale^2) so the controller only probes when the prediction has room. Also: the host had fileproviderd at 115% CPU and four stale dispatch vite servers during measurement. Parked: the rim still 'breathes' slightly with the jiggle because the gate is relative to the pre-wound skin; blood particles from wounds is a feature in its own right, not a cover. Cyclops dispatch (`~/.claude/dispatch/plans/2026-08-22-cyclops-character.md`) was RUNNING at wrap-up — judge it next session on the same three things as the trial; schoolgirl after that (owner: later, not today).
  **WOUND HALO SOLVED (2026-08-24 night, main `224fbbd`; post-mortem: Obsidian `Claude Notes/Blud/2026-08-24-wound-halo-postmortem.md`):** the sweeping halos / white slabs / 'distorted-lens' clipping around craters was RELAXED SPHERE TRACING (relax 1.4) x carved wound fields — the omega>1-only paths (overshoot retraction + the new deep-crossing retract guard) step rays BACKWARD at grazing wound angles and fail to reconverge; whole screen-space circles render the body from an offset view, flipping with tiny camera moves. `relax` (woundCfg2.y) now defaults **1.0** — DO NOT raise it while wounds exist until the retract guard reconverges (bound the back-step, finish conservative); the X1.10 '1.4 optimum, visually unchanged' sweep PREDATES wounds. Adaptive resolution defaults OFF again (its close-up rung drops read as blur-halos and confounded the hunt). The wound pipeline is restored to 2026-08-22 (`c7f8afb`) byte-parity: entries (4)-(6) above — the whole 2026-08-23 crater-shading pass (split masks, facing gate, cavity-AO darkening, lip locality flip, rimWidth 0.25, pellet splay 0.35, smin overlap union) — are REVERTED wholesale; every owner verdict against/for them was rendered through the relax lens, so re-evaluate each ONE at a time at relax 1.0 if wanted (all preserved in branch history with reasoning). KEPT: the tracer retract guard (real bug — perpendicular crossings with radius+prevRadius == stepLen exactly evaded the strict-< overshoot test and landed rays ~10 cm INSIDE the body = the rear white slab; dead code at relax 1.0), nearWound plain stepping, the fold cull (exonerated twice), and the thin-limb carve-shift machinery in damage.ts (dormant, unwired). NEW **X1.28 wound soft shadow** merged DEFAULT OFF (see its row). Live-pokeable diagnostic views (masks/components/hit-depth) recorded as a paste-in at docs/dev-notes/2026-08-24-wound-debug-views.md; the owner's console kill-switches in the failing view were what cracked it. Unrelated: recurring 535 ms frame stalls during diagnosis were the Claude desktop browser pane's GPU process, not the app (headless bisect: every branch commit p95 < 19 ms) — restart the app to clear. FOLLOW-UPS: retract-guard reconvergence (wins back relax 1.4's ~1.6x crowd speedup — fold into the perf plan), soft-shadow rework, one-at-a-time re-eval of the reverted refinements. **PERF CHAIN RE-BASELINED + RUNNING (2026-08-24, main `19d1860`):** the perf spec/plan/shader were written at relax 1.4 + adaptive-on and asserted a world that no longer exists. Corrected: the spec filed relaxed tracing as a non-lever ("< 0.5 ms") on a CLOSE-camera reading — on crowds it is **1.60x** (X1.10: 10 bodies, 1.0 -> 14.89 ms vs 1.4 -> 9.31 ms), the largest single item on the board, and the renderer pays it in full today. `march.wgsl.ts` still claimed "over-relaxation is always safe"; that predates wounds (applyWounds returns no distance bound) and now states the real constraint. Both retraction faults are documented in place: the overshoot path undoes d*(w-1) where the excess is d*(w-1)/w (**40% over-retraction** at 1.4), and the deep-crossing guard steps back by a SCALED-space d that under-reports Euclid by the group distortion factor (22x, schoolgirl sole plate) so it need not leave the solid, unbounded. NEW **plan Task 2.5 / dispatch task-1b**: retract-guard reconvergence — retract to the last known-outside sample `tSafe`, never by a computed distance; CPU mirror of the tracer under property tests (nothing here compiles WGSL, so vitest cannot see shader bugs); 3-character wounded visual gate; relax sweep re-run WITH wounds. Runs BEFORE tasks 3/5 since both rewrite the march loop. Task 6's coverage predictor is now conditional (adaptive defaults off — it would improve a disabled controller). Chain: **task-1 (bench) -> task-1b -> task-2 -> 3 -> 4**, with 1b and 2 left `queued` (INERT) so the owner gates the baselines and then the relax verdict before anything builds on 1.4. Also fixed: the lab's adaptive button hardcoded the label 'on' while the flag defaults false.
  **SDF perf brainstorm additions (2026-08-24 night):** measured why schoolgirl/cyclops tank vs zombie/goblin — primitive counts: zombie 12, goblin 25, schoolgirl 37 (+22x sole-plate distortion forcing tiny steps), cyclops 38, mouse 40; cost = pixels x steps x prims and every step folds the whole character. Spec gained levers **7 (temporal depth reprojection)** and **8 (low-res conservative prepass)** — both attack the step-count factor by starting rays near the surface; queued as **dispatch task-5** (depends_on task-4, pending). Invariant for both: a seeded start may only ever be NEARER than the true surface, and the margin must cover the wound lip's outward eversion; prepass is stateless and doubles as reprojection's disocclusion fallback. Separately dispatched a **hybrid shell-marching spike** (`~/.claude/dispatch/plans/2026-08-24-shell-march-spike.md`, branch dispatch/shell-march-spike): mesh the zombie's analytic field at iso d=+0.03 via marching cubes over `sdBody` (validate.ts), rasterize the hull for entry/exit depth, sphere-trace only the thin shell (budget 16 steps) — if the look survives it obsoletes most step-count work for hero bodies. The spike is ALSO the first real task on the NEW **dsh harness** (DeepSeek, model `deepseek-v4-flash-vision-exp`, vision — it judges its own capture pairs; dsh resolves auth itself, no api_key_env/base_url in frontmatter). Judge it like any dispatch: verify commits on the branch, remember the silent-noop-on-rate-limit signature. Reference noted: PardesLine tutorial 04 (github.com/1904jonathan/PardesLine) does mesh->SDF->shell via voxel erosion + skimage marching_cubes — we have the analytic field so iso-offset replaces morphology exactly, but skimage marching_cubes is the fallback if a TS mesher is annoying (bake hulls in Python beside bake_humanoid_sdf.py), and erosion-band inner shells are the trick if back-face exit depths prove imprecise. Wider context recorded in Obsidian `Claude Notes/Blud/2026-08-24-sdf-render-optimization-options.md` (incl. why native Rust/C++ would NOT vastly speed this up — GPU-bound, WGSL compiles to the same Metal — and the gib-voxelization worker plan). **Shell-march spike DONE (2026-08-24 22:06, dsh harness test PASSED, branch `dispatch/shell-march-spike` `79cd406` — dispatch auto-committed after the dsh sandbox blocked git in the worktree, a known dsh gotcha not a failure):** look survives at geometry level (silhouette/smin/normals match at all 8 yaws, self-judged by the vision model); ~14x fewer mapBody evals/frame (shell 4.56 steps/px on a 30k footprint vs full 6.79 on 285k), frame ~16 vs ~29ms single-body (~1.8x; the 14x eval cut is the crowd win); CONFIRMED failure mode: +3cm hull inflation eats sub-3cm detail (mitten hands, no face) — productionizing = per-part hulls with adaptive inflation + posed hulls + wound handling. tsc clean, 1510 lab tests green, protected files untouched. dsh/deepseek-v4-flash verdict: precise brief-following, honest reporting, vision works — good enough for mechanical chain tasks (task-2) if zai quota needs relief; hold task-1b for a stronger model. **iq "Selfie Girl" (shadertoy WsSBzh) studied** — techniques note: Obsidian `Claude Notes/Blud/2026-08-24-selfie-girl-techniques.md` (license: techniques only, NEVER port its code). Top takeaways: (a) analytic bounding-INTERVAL clip — intersect ray vs cluster spheres and march only [entry, exit]; cheap sibling of levers 7/8, could land before either; (b) hair = ONE bezier + cross-section grid repetition = ~18 strands per curve eval — the answer to schoolgirl fringe prim cost; (c) `mapD` pattern: pores/fuzz detail only in the normal-pass map, the march runs the clean field (audit where surfaceNoiseAmp is paid today); (d) per-axis radius ramps on ellipsoids collapse several prims into one (his jaw); (e) cloth = onion-shell ellipsoid + sine warp + seam rounding via length(vec2(dA,dB)) — for the sailor collar/skirt hem; (f) iq ships UNDER-relaxed (0.95) and gets speed from bounding + cheap fields — counterpoint for the relax-1.4 debate.
  **Cyclops run result (2026-08-22/23, `zai/glm-5.3:xhigh`, 2h15, merged):** PASS on gates — front IoU 0.838 (mean 0.019, worst +0.044), side 0.751 (gate 0.75, just); render-check clean; registered in the lab; `cyclops-blob.test.ts` pins eye/maw/fangs/claws/tail-hook. Eye check: one domed eye in the upper chest, fang row, clawed arms, no legs, tail hooks up in profile. Weak (follow-up run, not a blocker): arms read as stubby sacks not long clawed limbs; spiked trapezius hood + dorsal spines absent; the maw groove is barely visible in the dark flesh — consider a lighter lip paint. Three characters now validate the measured loop on glm-5.3.
  **Bonewalker authored WITH blob:rings — the tool's first from-scratch trial
  (2026-08-27, `dispatch/bonewalker-character`):** sixth .blob character, a
  horned skeletal undead at 1.30 m off `refs/bonewalker-mesh/bonewalker.glb`
  (1.700 m Meshy T-pose, 67% measurable verts). Skeleton built entirely from
  the brief's rig-measured len= table — result: ZERO "BONE LENGTH IS OFF"
  blocks in every ring fit (mouse/schoolgirl drowned in them). Converged in 3
  ring rounds to ≤14mm mean residual everywhere except the foot (46mm — claw
  fan + the rig's 45° down-forward foot bone vs our horizontal one confound
  the ring mapping) and the pelvis (23mm — the fit reads bowl-mass rho ~55mm
  while the mesh's iliac wings spike to 119mm halfW; a radial blob cannot
  express blades, so the wings got their own prims). VERDICT: blob:rings
  earned its place — radius/scale/offset findings were applied as printed
  (blocks 3-12 round 1) and survived cross-checks; its flags correctly
  disowned the weak blocks (IMPOSSIBLE on the blend-buried spine ridge, NOT
  A LINE on calf/forearm bulges, t-support flags on the shoulder ball); it
  has NO eye and NO paint sense: it asked the pelvis 3x to shrink to 52mm
  semi-axis (render + mesh profile said starved), asked the painted spine
  ridge to vanish (twice, IMPOSSIBLE r), and cannot see the face/horns/claws
  at all. blob:measure was nearly useless here — even the legs are posed
  (wide crouch) so no clean --range window exists; row jerk 0.017 vs our
  0.006 says the mesh's bony knobbly read is a remaining gap. Face = baked
  decal (horns included in the head box; projection AIMED eyes+chin), body
  = rusted-red palette + bone-dust mottle + painted spine ridge/horns/claws.
  Character pins: 11 tests (bone lengths, lankiness, floor contact, waist
  pinch as a RELATION, ribcage deeper than wide, claw paint counts). tsc 0,
  1715 lab tests, render-check clean. Two tool lessons for the skill: (1) a
  capsule's bottom cap is a half-radius hemisphere — a ribcage bar starting
  at the bone head fills the waist pinch 2cm below it (the pin caught it);
  (2) a high-Hips rig (Meshy 58.1%) vs surface crotch (49.7%) means the
  spine chain rides ~0.108 low; parent clavicle to NECK and let an unmapped
  skull bone absorb the offset.
  **Schoolgirl run result (2026-08-23, `zai/glm-5.3:xhigh`, 65 min, merged as v1):** process PASS (measured both windows every edit, head-profile, vision-ask on front/back frames, 6 commits, tests pin measured numbers); band numbers PASS (legs window mean width err 0.008 worst +0.020; head 0.010/-0.027). LOOK: FAIL for the style goal — the torso is a stack of horizontal discs (collar plate, two white rings, skirt cylinder + disc hem, pleat fragments on the thighs); recognisable as a schoolgirl, not Tanida-smooth. TWO TOOL LESSONS: (1) in-range IoU is meaningless when whole-figure aspects differ (T-pose 0.919 vs 0.259): compareSilhouette normalises to the whole-figure bbox before taking range rows — fix: normalise within the window; (2) per-band width matching is satisfied exactly by stacked discs — the measure needs a stacking/step detector and the skill must say the bands cannot see it. Follow-up run after the tool fixes: smooth masses, blended torso, skirt as a flared cone.
  **Mouse proportions run (2026-08-22, `dispatch/mouse-proportions`):** rebuilt
  the mouse to the maus-biped RIG joint heights (skeleton was a big head on
  stubby legs — head ~53% of the file). Lengthened legs (thigh/shin ~46%) and
  torso (added `spine2`, chest 0.095→0.183), keeping height 1.10; legs/torso/
  head now ≈32/34/34 (ref 32.1/34.2/33.7). Re-fit head prims to the shorter
  skull; re-built the kit skeleton + re-authored tee/shorts/brows/shades; and
  fixed the DETACHED shoes (the old shoe's mouth ring sat at y~0 while the
  ankle was at 0.141) — the shoe ray now starts at the ankle and hangs rings
  to the ground. Mouse blob+kit tests, full 1958-test suite, tsc, build all
  green.
  [design](docs/superpowers/specs/2026-08-20-sdf-character-language-design.md) · [plan](docs/superpowers/plans/2026-08-20-sdf-character-language.md) · [primitive roadmap](docs/superpowers/specs/2026-08-21-blob-primitive-roadmap.md) · [chisel spike](docs/dev-notes/2026-08-21-chisel-primitive-sculpt/notes.md) · skill: `.claude/skills/authoring-sdf-characters/` · Obsidian: `Claude Notes/Blud/2026-08-21-blobforge-sharp-features-and-kits.md`
- `P8.clown-skull` [x] **clown skull + kit re-fit (owner review rounds)** — root
  cause was a WebGPU-lab integration bug: `webgpu/lab-main.ts` built every head
  from `DEFAULT_FACE` and threw away the `.blob`'s own `face` block, so the
  clown's 0.235x1.18 ball rendered as the 0.118x0.76 DEFAULT_FACE skull — a
  narrow head under a kit cap built for the big ball. Fix seeds `face` from
  `compileFace(parseBlob(src))`. Then re-fit the kit to the corrected head: cap
  band widened ~23%, ruff collar (the MISSING piece — the bells floated with
  nothing holding them) added as a flared loft with the beads/poms on its rim,
  hair tufts mount at the hairline and drape down ~100deg, capcone is a rounder
  beret, ruff silver-grey, eyes smaller + specular catchlight (eyeGlint).
  [branch `dispatch/clown-skull`]

- `P9` [x] **Ring-fit (`blob:rings`)** — fits existing `.blob` prims to a skinned
  reference mesh via `sdBody` residuals; pose-independent, suggests rather than
  applies, reports each prim as one coupled edit with its semi-axes. Spec
  `docs/superpowers/specs/2026-08-26-blob-ring-fit-design.md`, plan
  `docs/superpowers/plans/2026-08-26-blob-ring-fit.md`.

---

## Process notes

- **Completing a task:** flip `[ ]` → `[x]`, **collapse the row to a one-liner** (detail goes in the commit message + a dualmem checkpoint), commit.
- **Discovering a new task:** next available number in the right section, **one line**, commit.
- **Task rows are ≤2 lines.** If context needs more, put it in a linked dev-note / plan doc and leave a bare link on the row.
- **Milestone rollup:** when a milestone lands, collapse per-task detail into a single line with the commit range; the plan file + git log hold the rest.
- **Design questions:** re-read the design spec above before adjusting scope.
