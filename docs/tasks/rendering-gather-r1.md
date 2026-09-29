# Gather dispatch R1 (history)

The probe-gather dispatch work of 2026-09-10 and its measurements. Part of the task wiki: [TASKS.md](../../TASKS.md) is the front page. Sections are newest-first where dated; each keeps its own history.

## Gather dispatch R1 — measured, designed, ready (2026-09-10)

**The scaling evidence is IN and it justifies R1.** Sweeping ray count via
`BENCH_PRELUDE="__sdfGame.setProbeRays(N)"` (room 4, `BENCH_PASSES=1`):

| rays/probe | `compute:probe-gather` p50 |
| --- | ---: |
| 32 (shipped) | 4.00 ms |
| 16 | 1.83 ms |
| 8 | 0.75 ms |
| 4 | 0.21 ms |

Near-perfectly LINEAR, so the cost is unshareable per-ray work run serially inside
**448 threads (7 workgroups) on 1280 ALUs** — no latency hiding. `probe-norays` reads
**0.01 ms**, so dispatch + setup + blend is negligible: essentially all 4 ms is ray
work. The frame moves with it (room-4 median 17.7 -> 12.5 ms at 4 rays), so the
gather is a large slice of the frame.

⚠ **A LANDMINE:** there is no `probe-r4`/`probe-r8` leg in the harness. `BENCH_LEGS`
naming a leg that does not exist SILENTLY measures `baseline`. Use the prelude.

**✅ THE PROBE PASSED — OPTION A IS VIABLE, R1 IS READY TO IMPLEMENT.** Pinned as
`src/lab/sdf-zombie/webgpu/probe-gather-workgroup.test.ts` (4 tests): `workgroupArray`
constructs, **a workgroup array CAN be passed into a `wgslFn`**, and the generated
function parses it as a declared typed input with no phantom. ⚠ **`workgroupBarrier`
is NOT a TSL export in this three build** — the barrier must be declared in WGSL text,
which the probe found and which would otherwise have been a silent compile failure.
Option B (`subgroupAdd`) stays a fallback.

**Design + verification plan:** [docs/dev-notes/2026-09-10-r1-gather-dispatch-design.md](../../docs/dev-notes/2026-09-10-r1-gather-dispatch-design.md).
One thread per `(probe, ray)` = 200 workgroups. **FIRST STEP, 10 minutes:** verify
whether three's TSL can pass `ptr<workgroup, array<...>>` into a `wgslFn` function —
that decides between the one-dispatch shared-tree design and the workgroup-per-probe
fallback, and it cannot be answered without a GPU round trip. Do NOT write the kernel
before answering it: landing WGSL on an unverified binding mechanism is what caused
the flesh regression earlier today (`43779459`).

**NEXT, in order:** (1) the R1 binding-support probe, then R1 itself; (2) ~~the census-diff demo repeatability
gate~~ **DONE 2026-09-14 (stage 1)** — `docs/dev-notes/2026-09-14-demo-recorder.md`; three of six bench
windows this session were unusable, now the seeded+`simidle` bench is repeatable (census AND frame hash
identical across repeats); (3) R1, widening the
gather's 7-workgroup dispatch, now backed by the measured split; (4) far-body
LOD, **re-aimed** — the step axis is dead, use per-pixel work.

**Bench discipline, reconfirmed twice:** read the Repeatability section FIRST and
judge each delta against its own legs' spread. Only a within-leg pass row
survives a busy machine.
**[x] The harness ship-truth pins are RESYNCED (2026-09-10).** `setOccluder(false)`
and `setHullExitBound(true)` are now the pins, matching what the game runs
(`setOccluderEnabled(false)`, `GAME_HULL_EXIT_BOUND = 1`). Before this, every
delta the harness produced was taken with one extra pass the game does not run
and with a march bound the game has ON switched off — so it measured a
configuration that does not exist. The `BENCH_PRELUDE='…setOccluder(false)…'`
workaround is now a NO-OP. **Stored bench.json files predate the flip: they stay
internally consistent but are NOT comparable to a run from now on** — tag them
rather than mixing the two.

**[x] FRAME SPIKES SOLVED — interlaced scanline fields (`86185b01`).** Owner
captures: worst frame **125 → 38 ms**, p99 **63 → 34.3**, over-budget frames
**6.3% → 0.0%**, longest stall run **12 frames → 1**, avg fps pinned at the 30
cap. The march is the dominant pass — **75–83% of the GPU frame in the
PRE-interlace 2026-09-09 phase-0 run** — and its cost tracks covered pixels, so
marching half the scanlines each frame halves it; the comb is the intended
old-video look, not a cost. The shipped `'bodies'` field marches **800×300**
(800×600 content, height halved), so those percentages are not the current
shape of the frame; see the "Timings are stale" bullet below.
[Result](../../docs/dev-notes/2026-09-09-perf-spikes/field-rendering-result.md) ·
[spec](../../docs/superpowers/specs/2026-09-09-interlaced-field-rendering-design.md).
**Ships `'bodies'` at `setFieldComb(0.6)`** — the flip landed 2026-09-09
(`game-main.ts` calls `setFieldStyle('bodies')`; it was reverted to `'frame'`
for a day while two mesh-pass defects were diagnosed, both fixed in
`9f205aaa`). `'frame'` remains available via
`__sdfGame.setFieldStyle('off'|'sdf'|'bodies'|'frame')`
and `setFieldComb(x)` (one number, 0–1). 2026-09-09 review fixes on top:
composite held rows carry the held depth (`b67999c8`), held rows bracketed by
parity, polys unjittered in `'sdf'`/`'bodies'`, `'frame'` weaves on the output
grid so sdfScale ≠ 1 works (`6031389e`), field targets disposed. Handoff +
resolution: [bodies-style-handoff.md](../../docs/dev-notes/2026-09-09-perf-spikes/bodies-style-handoff.md).

| style | interlaced | crisp |
| --- | --- | --- |
| `sdf` | flesh only | has the flesh/bone disagreement |
| **`bodies`** | flesh + skeleton | level, viewmodel |
| `frame` | everything | — |

- [x] **Flesh/bone row disagreement resolved.** `'bodies'` puts bone and flesh
  on one cadence. A first cut still showed it in MOTION — held rows carried
  this frame's depth against last frame's colour, so moving bone beat stale
  flesh; both weaves now retain depth with colour.
- [ ] **`'bodies'` unverified with wounds exposing bone** — the case it exists
  for. Renders, cycles and occludes structurally; nobody has shot anything yet.
- [ ] **Timings are stale.** They predate whole-frame fielding AND were taken
  while the cull was silently throwing every frame. Re-establish from the
  shipped build.
- [x] Half-rate (C2) **retired** by this — it moved only the extreme tail and
  its hold-and-reproject desynced from full-rate polygons under camera motion.
  Mutually exclusive with fields; still available behind `setHalfRate`.
- [!] Depth prepass stays **OFF**: flipped on for one look pass 2026-09-09 and
  reverted — the silent range-dependent geometry deletion its comment warns of
  was "very noticeable". Needs the task-3 census before any future flip.
- [x] Marched-body visibility cull shipped (`fecbc54a`): frustum + `clearSight`
  on `setBodies`, 2 of 15 bodies marched in room 1. Win still unmeasured.
- [x] Static probe grid spike (lighting P3 step 1) in the WebGPU lab
  (`sdf-lab-webgpu.html`, panel `probe grid (P3 spike)`; `probeCfg.x = 0` is
  bit-identical everywhere else). CPU L1-SH gather against the enclosure,
  two bounces, ~60–400 ms bake. GPU A/B: directional ambient reads; at a few
  times the fill it is the radiosity lift P1 asked to measure.
  [Result](../../docs/dev-notes/2026-09-09-probe-grid-spike/result.md) ·
  [plan](../../docs/superpowers/plans/2026-09-09-static-probe-grid-spike.md).
  **Step 2 shipped ON in the game:** one grid per room baked in a worker at
  boot (~2 s total), stamped per body at spawn, matched to P1's level.
  `?probes=0` / `__sdfGame.setProbes(0)` = bit-identical P1.
- [x] Flashlight bounce spot (P4 step 1), ON: the beam's lit patch on the
  player's enclosure (paint, furniture first) as one analytic disc light every
  body adds to its ambient — a body between the lamp and a wall is lit from
  behind. `__sdfGame.setBounceSpot(g)` / `?bouncespot=0` = bit-identical.
  [plan](../../docs/superpowers/plans/2026-09-09-flashlight-bounce-spot.md).
- [x] **GPU probe gather — dynamic layer, ON** (the paper's core). Per-frame
  compute pass writes muzzle-flash radiance + body visibility per probe for
  the player's room; bodies are capsules from their posed bones. Two march
  slots (pins 95); `?probedyn=0` / `__sdfGame.setProbeDynamic(0,0)`
  bit-identical; defaults radiance 0.05, visibility 1 — untuned, owner to
  judge. GPU-verified via `__sdfGame.step` (hidden tabs stop rAF).
  [Spec](../../docs/superpowers/specs/2026-09-09-gpu-probe-gather-design.md) ·
  [plan](../../docs/superpowers/plans/2026-09-09-gpu-probe-gather.md) ·
  [result](../../docs/dev-notes/2026-09-09-probe-grid-spike/result.md).
  Soldier muzzle flashes and the flashlight BEAM (as a spot) are gathered
  lights too; the analytic bounce spot ships at gain 0 (`?bouncespot=1`).
  Afterglow (rise 0.6 / fall 0.12), flash boost 4×, and a DIRECT per-body
  muzzle light (`bodyFlash` slot, `setBodyFlash`, 0.06) — owner-confirmed
  2026-09-09: soldier flashes light zombies and soldiers around them at range.
  Membership by current position (+1.5 m), nearest room from tunnels; the
  player's flash lights as a 0.14 s burst. Knobs: `setProbeDynamic(0.15, 1, 4)`.
- [x] **Temporal reprojection start for the march — SHIPPED ON 2026-09-10**
  (`?tstart=0` off). Rays start at last frame's reprojected hit minus a
  margin, gated to the body being marched. March pass p50 14.9 → 11.3 ms on
  the room-4 bench; no visible artefacts after the own-body gate.
  [plan + result](../../docs/superpowers/plans/2026-09-10-temporal-march-start.md).
  Follow-up (same day, pushed): `bodyEntry` folded into the start max,
  recovery probes rewind instead of dropping the bound, wound-zone gate on
  the accepted start, adaptive motion-scaled margin — floor PARKED at 0.25
  after the owner playtest found glitches at 0.15 in real play (the frozen
  closeup bisect missed them: static camera, VHS/weave off).
  Owner-confirmed fixes from the same night: fresnel lint at range (graze
  accept capped at a hard 1 cm — its first version scaled with the AA
  epsilon, 2% of distance, a ~1.9 m band at 12 m), stacked-body
  see-through holes (~90%: window-width refusal on the body's OWN box
  chord + graze accept + per-body hull cap; an adversarial-review pass
  caught the first version capping against the SHARED shellIn, which
  silently disabled the start for non-frontmost bodies), graze-crawl cost
  bounded by a 2 mm step floor (gib p50 15.2 -> 7.0), probe gather
  amortized to half rate + tracer slots capped at 2 (the fire-segment
  gather spike was TRACERS filling the slots), SSCS ships OFF (the FPV
  weapon is inside its march volume — painted a moving weapon-silhouette
  rectangle on melee targets), pipeline warm-up + loading screen at boot.
  Adversarial deepseek-v4-flash review dispatched and reconciled
  (20e7e898). Instruments: `scripts/tmp/tstart-ab.mjs`,
  `tstart-artifact-check.mjs`, `__sdfGame.temporalDiag()` (frozen-frame
  per-pixel ON/OFF). KNOWN-RARE: a one-frame distorted halo around wounds
  (owner sighting 2026-09-10, once, non-reproducible) = the documented
  wound-halo class at relax 1.0 (postmortem below / Obsidian
  2026-08-24-wound-halo-postmortem); watch on F9 marks, fix direction is
  the perf spec's retract-reconvergence lever.
- [ ] **NEXT: render optimization pass, round 2** — backlog with owner notes in
  Obsidian `Claude Notes/Planning/2026-09-09-blud-render-optimization-backlog.md`.
  Done in round 1 (2026-09-10): pass timings via `__sdfGame.bench({mode:'passes'})`,
  shadow maps 512, per-room accent light lists, temporal reprojection start
  (shipped ON). Rejected: reduced-scale flesh (interlace grows; owner) and
  neural upscale. Order now: (1) gather the MOST ACTIVE room — soldiers
  firing in room 5 do not light it while the player is elsewhere (one room
  per frame); serve the room with the most light sources, later all rooms
  in one buffer; (2) far-body LOD — fewer march steps, coarser/no wounds
  for small-screen-fraction bodies; (3) blood simulation — owner recordings
  put ~50% more droplets in flight on late frames; (4) static probe term
  per vertex on walls (24 tex + 32 buffer loads per level pixel);
  (5) accent point lights out of the direct list once the probe look is
  accepted. Measure with the bench, not recordings (30 fps cap).
- [x] **Level surfaces reading the probes, FORWARD path — built + GPU-verified
  2026-09-09** on `claude/level-probe-lighting` (not merged; owner playtest
  next). `ProbeLightingNode` (`webgpu/probe-lighting-node.ts`) adds each
  room's probe irradiance (static grid + gather layer) to the level
  materials' indirect diffuse via `material.lightsNode`; the hemisphere
  fades as the weight rises. Seams `__sdfGame.setLevelProbes(weight, gain)`,
  `?levelprobes=0`. Matched ≈ off (+0.35 lum); a shot lights the adjacent
  wall/ceiling +7..9 and decays with the buffer. Two plan corrections: the
  dungeon hemi is 0.05 (rig), and the level needs `× PI` vs the march's
  `albedo*amb`. Body-under-floor darkening invisible at defaults (scales the
  tiny static term only). Per-pass cost unmeasured (no timestamp samples).
  [plan + result](../../docs/superpowers/plans/2026-09-10-level-probe-lighting.md).
- [x] VHS post-FX wired, ships ON at the owner-tuned **`blud`** preset
  (`VHS_PRESETS.blud`, swept in the panel below 2026-09-09: artefacts up, mush
  down — full intensity + full horizontal blur, noise ~off at 0.005, grade
  pulled to 0.38, the wobble nearly still, and heavy jittered chroma bursting
  on 61% of rows at 34 Hz). `?vhs=blud|soft|balanced|chaotic|off` overrides.
  The three club-mutant presets are untouched and still pinned.
- [x] VHS post-FX wired, originally default OFF. `__sdfGame.setVhs('soft'|'balanced'|'chaotic'|null)`,
  `setVhsTerm(name, v)`, or boot with `?vhs=soft`. Runs after FXAA and replaces
  SMEAR while on (setting preserved). GPU-verified 2026-09-09: compiles, upright,
  off restores the clean frame, zero errors. Eight port defects fixed first
  ([plan](../../docs/superpowers/plans/2026-09-09-vhs-postfx-fixes.md)). Look is
  untuned — `chaotic` is very heavy; judge with fields on.
  [Spec](../../docs/superpowers/specs/2026-09-09-vhs-post-fx-design.md).
- [x] VHS **tuning panel** (`vhs-panel.ts`), the third panel-chrome shell:
  all 13 terms as sliders plus soft/balanced/chaotic/off, in the third slot
  (right:524px), SHIPS VISIBLE BUT COLLAPSED like its siblings. Rows are
  derived from `VHS_TERM_RANGES` and COPY emits `setVhs` + the delta from the
  preset, so the emitted keys cannot drift from the setter. Seams:
  `__sdfGame.vhsPanel(on)` / `vhsPanelCollapsed(on)` / `vhsTerms`; H still
  toggles every panel. **Capture scripts must dismiss all THREE panels now.**
  Browser-verified 2026-09-09 (sliders write + read back the clamp, COPY
  round-trips, console `setVhs` resyncs the sliders, zero page errors).
  It paid for itself immediately: `VHS_PRESETS.blud` above is this panel's
  first output, swept here and pasted out of COPY.


**[~] Hybrid deferred renderer (M2) — material repair accepted by owner manual playtest on 2026-09-07; integrated with latest main.** The merged build passes all 34 gameplay GPU checks with zero page errors and the CPU/build checks. [Integration notes](../../docs/dev-notes/2026-09-07-m2-main-integration/notes.md). Task 7 stopped at owner request; gamma/flashlight tuning and unfinished automated shadow/performance validation remain follow-ups. Deferred remains opt-in.

**[x] Soldier combat/animation polish — owner approved; merged to main (909b6a87).** Fixed movement, aim, recoil, gait and lab controls. [First pass](../../docs/dev-notes/2026-09-06-soldier-polish/notes.md).

**[x] Soldier shotgun/readability — merged to local main (64aa78ee).** Exaggerated low-poly semiauto, bent support-arm aim, shared lab/game muzzle flash. [Design and captures](../../docs/dev-notes/2026-09-06-soldier-shotgun/notes.md).

**[x] Soldier appearance and damage pass — merged to local main (64aa78ee).** Bulk/olive armor, tuned face and red eyes, localized armor loss/severs/collapse, scoped wounds, skin save and Vite cache fixes. [Result and gotchas](../../docs/dev-notes/2026-09-06-soldier-bulk/notes.md).

**[~] SDF FRAME ATTRIBUTION — measured 2026-09-07 on branch `claude/bvh-sdf-raymarching-f02f18`; two dispatch tasks in flight.** Per-pass GPU timestamps (`BENCH_PASSES=1 scripts/sdf-game-bench.sh`, `gpu-pass-timing.ts`) show the march IS the frame and wounds grow it 6 → 26 ms; the near-wound bone/organ fold (no spatial cull) is 25–30% of that, the goo density pass is free. Both dispatch tasks landed and are PARKED with numbers: per-ray wound list ≈0; bone sphere cull at cluster granularity exact but −5% fire only (bone evals −18%: the torso cluster's one sphere holds ribs+spine+pelvis) vs tubes −13–23%. Per-rigid-segment bone spheres then built (Kimi dispatch), exact, bone evals −48%, **SHIPPED ON** as the game default (−5–7% wounded march in room 3; culling is now exhausted). Chain merged into this branch. NEXT real lever: baked bone-segment meshes as G-buffer members after deferred M2 is green. [Segment notes](../../docs/dev-notes/2026-09-07-bone-segment-spheres/notes.md). Bone tubes stay OFF (look); baked bone-segment meshes wait for deferred. [Eight runs + root cause](../../docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md) · [plans](../../docs/superpowers/plans/2026-09-07-bone-sphere-cull.md) · Obsidian `Claude Notes/Blud/2026-09-07-sdf-frame-attribution-and-wound-cost.md`.

**[~] Game tile visual playtest + telemetry — integrated on main; owner visual run next, before performance comparisons.**
[Usage](../../docs/dev-notes/2026-09-06-game-tiles-telemetry/notes.md): `?tiles-playtest`, F6 tiles, F8 record/save, F9 geometry/wound marker; ordinary tile default off, no GPU timing claim.

**SOLDIER ANIMATION — historical implementation notes (2026-09-05); completed and superseded by the approved passes above.** The soldier
marches, runs, carries the shorty and hip-fires it in the lab; the skinned
kit and the gun ride the rig (`rig-frames.ts` → `KitOverlay.pose`,
`held-prop.ts`). Gait is now a PROFILE (`SHAMBLE` = the zombie verbatim,
pinned bit-exact in `gait-pins.test.ts`; `MARCH`/`RUN` blended by speed);
arms have a third style, `carry` (right arm authored rotations, left hand
FABRIK'd onto the gun's fore-end — `carry.ts`). Found and fixed on the way:
the goblin and soldier had NO motion at all (rig points the gait could not
name → `makeMotionJoints` null); the joint schema grew eight secondary names
and dedups by position. Two dispatch misses fixed by hand after the chain:
three's GLTFLoader strips the dots from `clavicle.l`-style node names
(`kitBoneKey`), and `setMotionEnabled(false)` snaps the rest pose to the
authored base, so holdPose now freezes with `poseHeld` instead. Lab:
`,`/`.` speed band (`1` is a sever key), `F` fire, `K` collapse;
`__sdfLab.holdPose('walk'|'run'|'hip')` for captures; `BLOB_POSE=` on the
turntable. Known pre-existing: a WebGPU "binding size is zero" validation
error on lab boot, on the zombie page too — not from this work. Phase 2
(shoot-back AI in sdf-game) and phase 3 (shouldered aim) are separate specs.
Round 3: the march and run legs now follow per-phase curves sampled from the
soldier's `Walking` clip and the Meshy zombie-biped `running` clip
(`gait-curves/`, `scripts/gait-from-clip.ts`); the zombie stays on the
sinusoid shamble, pinned
([clip-gait spec](../../docs/superpowers/specs/2026-09-05-clip-driven-gait-design.md)).
Lab dressing room: upload a face PNG / pick a skin tone, save both into the
repo via the dev-only `/__lab/save-*` endpoints
([spec](../../docs/superpowers/specs/2026-09-05-lab-dressing-room-design.md)).
[spec](../../docs/superpowers/specs/2026-09-05-soldier-animation-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-05-soldier-animation.md) ·
[strips](../../docs/dev-notes/2026-09-05-soldier-animation/notes.md)

**[x] SOLDIER SHOOT-BACK AI (phase 2) — implemented and polished on main.**
The following is the original implementation/dispatch context; current state is summarized above.
The first enemy that shoots back, and the milestone where the game learns
enemies come in KINDS. New pure `soldier-brain.ts` (standoff band → aim →
fire → recover → reposition, backpedal when rushed); `brain.ts` is untouched
behind an `EnemyMind` seam that defaults to `zombieMind`. Behavior only —
**no player damage** (there is still no player health in sdf-game). One
soldier, one room, no ranged crowd arbiter. Most of the work is plumbing:
game-main only imports `zombie.blob`, the face sheet is a module constant,
and `game-actor` never sets `MotionConfig.profile`. Watch the sheet block —
that trap cost an hour on 2026-09-04.
[spec](../../docs/superpowers/specs/2026-09-06-soldier-shootback-ai-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-06-soldier-shootback-ai.md) (9 tasks).
Tasks 1–5 dispatched (`zai/glm-5.3-flash:high`); **tasks 6–8 HELD** in
`~/.claude/dispatch/plans-hold/` — they hand-port lab-main's kit/prop/face
wiring into game-main, which the shared-character-view work below replaces.
Task 9 is the owner playtest, never dispatched.

**[~] SHARED CHARACTER VIEW + game-main split — DESIGN APPROVED 2026-09-06.**
game-main.ts is 5450 lines and lab-main.ts 4779, both one `async main()`;
game-main's holds **191 bindings**. The size is a symptom — the disease is that
the lab and the game duplicate the wiring that puts a character on screen, and
it has caused four copies of the same registry (lab silent-zombie fallback,
bench-main's face table, soldier tasks 6+7). Phase A: `character-registry.ts`
(pure data) + `character-view.ts` (body/view/face/kit/prop + per-frame pose),
adopted by the lab then the game — where it REPLACES held tasks 6–7. Phase B:
five factory modules out of game-main, `tick()` (~700 lines) extracted last
because its call ordering is load-bearing and undocumented. Pure refactor:
baselines captured first, no test file may be edited.
[spec](../../docs/superpowers/specs/2026-09-06-shared-character-view-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-06-shared-character-view.md) (12 tasks:
Phase A 1–6, Phase B 7–12). Phase A task 5 replaces held soldier tasks 6–7 and
inherits deleting the `brain()` migration shim task 5 left in game-actor.
Task 3 + 4c REVERTED 2026-09-06 for a "goblin regression", then RE-LANDED the
same day (`cae594c2`) once a goblin actually reached the gate: neither symptom
was task 3's. The eyes were the rigid-head bug below; the displaced kit is an
asset load race that reproduces on the reverted lab. Six hash-gated views
byte-identical, four game gates PASS, 3583/3583.
Task 3 (`character-view.ts`, adopted by the lab) done on
`dispatch/2026-09-06-shared-character-view-task-3` — build/GPU view/sheet data
(catch + 2026-09-04 story now live there)/kit/prop/pose moved out of lab-main;
captures byte-identical, suite 3558/3558 green (task 2's follow-up `da9216b`
replaced the false invariant, so no expected red any more). Plan defects fixed
in the new test only: the prescribed broken-sheet fixture could never parse (a
lone sheet block dies on `no "root" bone declared` before compileSheet runs —
fixture now carries a minimal skeleton), and the prescribed file holds 5 tests,
not 6.
Task 2 (`character-registry.ts`) done on
`dispatch/2026-09-06-shared-character-view-task-2` with a FINDING the owner must
call: the plan's invariant **kit ⇒ bespoke motion profile does not hold** —
goblin, clown and clown-alt carry polygon kits but have no motion profile and
walk with the zombie's shamble (`motionProfileFor` default; motion-profile.test.ts
even pins `motionProfileFor('clown')` to `ZOMBIE_PROFILE`). The invariant test
ships RED (1 failure in the suite, 3551/3552) per the plan's own protocol —
report, don't weaken. Fix is either author real profiles for the three, or bless
shamble-as-their-walk and relax the invariant. Smaller find: `minotaur.blob`'s
sheet block declares `image minotaur-face.png` but no such PNG exists under
`public/assets/lab/faces/` — the lab has been 404ing it silently; the registry
records it as declared.

**[x] F-face-rides-skull — FIXED 2026-09-06 (`295c848d`). Eleven characters, one line.**
Rigid-head membership was `limb==head && a===b at rest` — SPHERES only, "exactly
the face prims face.ts emits". True of face.ts, false of any `.blob`-authored
face: the goblin's ears, nose and lip blobs carry `tip=` so they bound
per-endpoint and slid off the skull whenever it turned (at rest both binds
agree — hence "looks fine with movement off"). 11 of 16 characters affected;
the ZOMBIE authors none, which is why no gate saw it. Rule is now "both ends
bind to a skull rig point", spheres still unconditional, so the change is
ADDITIVE and a test pins the zombie's rigid set to exactly his head spheres.
`boneFrames` held a second copy of the shape check and now shares the predicate.

**[x] P-pixel-gate-blindness — FIXED 2026-09-06 (`806cbbac`).** Every view and
all four game gates rendered the ZOMBIE, so a visible goblin regression passed
green and got a correct refactor reverted. `CHARACTER=` adds a goblin canary
(the only character with both a kit and a generated sheet); `MOTION=walk` adds
a mid-gait view, since every pre-existing view holds the REST pose where the
goblin always looked right. Determinism measured before either was trusted:
zombie-walk 3/3 identical, goblin 3 different hashes in BOTH modes.

**[x] P-crowd-capture-hang — FIXED 2026-09-06 (`342be37f`). 48 min → 1 min 47.**
It never exited (live CDP WebSocket held node's loop), so callers wrapped it in
`timeout` and `refactor-baseline.sh` treated **rc=124 as its SUCCESS path**.
Every capture burned its whole budget doing nothing: measured unwrapped, a
capture takes **7 s** against the 240 s budget. Contract inverts — 0 is
success, 124 is a real hang. Any comment still saying otherwise is stale.

**[ ] F-kit-load-race — the goblin's armour lands late, then teleports on.**
Owner, watching live: "initially the mesh elements aren't on the goblin as it's
moving and then they teleport onto it" — deferred by owner, "not something we
need to address atm". Measured: geometry is IDENTICAL across 8 boots (kit bone
world matrices to 4 dp, flesh centroid, root shift) while all 8 screenshots
hash differently, so it is not the rig or the body that moves. `loadKit` is
fire-and-forget. This is why the goblin views sit in `MANIFEST-EYEBALL`; they
move back into `MANIFEST` when it is fixed.

**[x] F-slug-gate — FIXED 2026-09-06. The gate was wrong, not the renderer.**
It compared a wound's LIVE position against a pre-shot prediction, but
`applyProjectileHit` stamps and then `impulseAt` TRANSLATES the nearest rig
point by `IMPULSE[type]` **metres** (0.18 for a slug's blast profile) — so it
measured the deliberate recoil and called it placement error: 18.3 cm against
a 3 cm tolerance. Unnoticed because the gate needs a vite server + headless
Chrome and never runs under `npm test`, and no misplaced crater was ever
visible in play. `game-actor` now records each wound's world position at stamp
time (WeakMap, between `pushWound` and `impulseAt`), exposed as
`stampWorldOf()` / `debugWounds().stampSurface` and marked DIAGNOSTIC ONLY —
rendering keeps using `woundWorldPos` so a crater rides the flesh it is carved
into. **Result: 0.86 cm** (live surface still 18.37 cm, which the gate now
prints as recoil rather than error). `b04854f`.

**[ ] F-bleed-gate — THE BLEED PARITY GATE IS FLAKY, near a coin flip (measured 2026-09-06).**
`sdf-game-bleed-gate.mjs parity` sets its pass threshold per run from two
same-state captures and fails when the toggle cycle exceeds it. On
**byte-identical code**, four runs gave floors 137k/141k/191k/153k and toggles
204k/37k/164k/119k — the toggle swings **5.5x**, the floor 40%, and the verdict
flipped FAIL then PASS PASS PASS. In the failing run the gate's own two control
cycles (same state, **no toggle**) differed 4x and it takes the max, so the
threshold is whatever the noisiest control was. It also passed on
`maxChannelDelta` while failing on pixel count. **A single FAIL from this gate
is not evidence.** Re-run 3x before believing it. Fix: more control samples, or
gate on `maxChannelDelta` instead of raw pixel count. Recorded in the
[refactor baselines README](../../docs/dev-notes/2026-09-06-refactor-baselines/README.md).

**[~] SOLDIER SHOOT-BACK AI — IN THE GAME, WORKING, JANKY (2026-09-06).**
He spawns in room 1 with his kit, his gun and his own baked face; notices,
marches to ~3 m, bursts 1–3 shots with the weapon visibly raised, holds a
settle beat, repositions. Measured: aim 1.48s, FIRE 2.18/3.23/4.28, settle
4.63, move 5.08. **Owner verdict: "working but needs a ton of work"** — after a
shot he drifts toward the player or runs into a wall.
**NEXT SESSION: rewrite the behaviour against a real FPS reference.** The
NotBlood source (in this repo, the basis of the original billboard version) has
gun cultists to port from; `src/game/enemy/cultist-ai.ts` is the legacy
billboard FSM. Owner's shape: in attack mode fire three times, reposition only
*slightly*, fire again; move further when fired at; more drastic moves when hit
and not killed.
[spec](../../docs/superpowers/specs/2026-09-06-soldier-shootback-ai-design.md)

**[!] TASK 3/4c REVERTED — the lab must NOT adopt `character-view` yet.**
Task 3's extraction rigidly offsets the goblin's KIT from his FLESH (~0.155 m
XZ, zero Y) — armour bunched one side, a goggle piece protruding from his face.
Confirmed with a deterministic freeze (`pauseLoop` + `holdStill`) on both
commits. The kit loads at `[0,0,0]` in both, so the suspect is
`buildCharacterBody`'s closing `translateBody(result, start)` — the original
hero path never translated (only crowd bodies did). The module and the GAME's
use of it are fine and were kept. **Do not restore without a goblin view in the
pixel gate.**

**[ ] THE PIXEL GATE ONLY EVER RENDERS THE ZOMBIE.** All five clean views,
three wounded views and four game gates use the zombie; the registry tests
assert 16 characters parse and build but nothing renders them. That is why a
visible goblin regression passed everything green. Add a **goblin** view — he
is the only character with both a polygon kit and a generated face sheet.
Capture comparisons must use the deterministic freeze; `setMotionEnabled(false)`
alone leaves the pose wherever the walk stopped and produces false diffs.

**[ ] RESTORE the "kit ⇒ bespoke motion profile" invariant** (I deleted it in
task 2 and was wrong). goblin, clown and clown-alt carry kits but walk on
`ZOMBIE_PROFILE`'s shamble, which mangles the goblin's SDF face prims in
motion — he looks correct with movement off. Either restore the test or author
real profiles for the three.

**[ ] F-bleed-gate is a coin flip** — see below; re-run 3x before believing a FAIL.

**[x] Zombie analytic normals — owner passed integrated combat playtest; hybrid mode enabled by default (2026-09-06).**
[Integration evidence](../../docs/dev-notes/2026-09-06-analytic-normal-integration/README.md); procedural flesh/wound gradients with automatic legacy fallback and retained comparison toggle. Owner reports smoother play but attribution is uncertain. Broader Task 5 performance study remains open: moving/multi-actor and direct original-shader controls are unmeasured. Stable 30 fps combat is the product target.

**[~] Zoned baked wounds — Task 3 resumed from saved work (2026-09-05); Tasks 1–2 done, 4–6 pending behind numerical/memory gates.**
[Plan](../../docs/superpowers/plans/2026-09-04-zoned-baked-wounds.md); defer expensive GPU verification under load; current shipping baseline and actual close-up coverage still require matched comparison.

**[x] A-schoolgirl-described — SCHOOLGIRL, describe-and-judge arm SHIPPED (2026-09-05).**
`characters/schoolgirl-described.blob`: the same subject as schoolgirl.blob,
authored from the plate alone (no blob:rings/measure — fitting is the control
this run compares against). The exchange student from the wrong genre: three
beats = oversized glossy BOB, RED neckerchief (real knot+tails, not paint),
white SLOUCH BOOTS (vs the measured version's socks+mary-janes). Face = the
schoolgirl's own bake re-baked to schoolgirl-described-face.png; sheet
0.34/0.40/0.49 (the bake's printed 0.19/0.237 is generic — this bake is the
schoolgirl's, whose solve is 0.38/0.42). Render-check exit 0, 2565 tests
green, controls (schoolgirl.blob / schoolgirl-alt.blob) untouched.

**[ ] A-female — FEMALE CHARACTER, described-authoring RUNNING (2026-09-05).**
Second run of the method the soldier proved: proportions from a plate, style
from the approved cast (goblin/soldier/zombie/clown), identity left to the
agent, no measurement step.
[plan](../../docs/superpowers/plans/2026-09-05-female-described.md). Reference is a
NUDE A-pose body -- proportions only; its Rigify rig has 722 joints of IK/MCH
helpers so the fitting tools cannot read it regardless, and its dress/belt/
necklace/watch meshes are out of scope per the owner.

**QUEUED BEHIND HER, in order:**
1. **`hairlock`** (Selfie Girl item 4) aimed at the SCHOOLGIRL, not this
   character -- her head is 7 prims, 5 of them hair, and loose. The female
   reference wears a BUN, which is the one case the technique suits least: it
   is for flowing wavy strands, and a compact updo is two or three ordinary
   prims. Deferred deliberately -- radiusRamp was built ahead of a character
   that needed it and two of its four face features shipped at zero.
2. **Her WAM kit: armour, and SOFT CLOTHES.** The soft half has a real fork
   and it is not obvious which way it goes. `.blob` ALREADY does cloth --
   the schoolgirl's skirt and sailor collar are `shell` prims (`thick=` /
   `clip=` / `rim=`), a thin onioned surface clipped to a hem. So the choice
   was: put drape in WAM, or extend the SDF shell. **DECIDED (owner,
   2026-09-05): extend the SDF SHELL.** Selfie Girl item 5 -- domain-warp it
   with low-frequency sines for wrinkles, plus the rim trick where the shell
   meets its clipping plane, `length(vec2(dShell, dPlane)) - r`.
   The leverage is why: the shell prim already ships and the schoolgirl's
   skirt and sailor collar already use it, so wrinkles land on EXISTING
   garments for free rather than only on new ones -- and it keeps WAM for the
   hard things goblin-kit.wam argues it exists for. Warp amplitude must
   default to 0 so no current character moves.
   **LICENCE, unchanged:** the Selfie Girl shader forbids reuse of the Work.
   Re-derive; implement from iq's own articles. Do not read the shader.


**[x] A-female — THE WIDOW SHIPPED (2026-09-05), describe-and-judge again.**
`characters/female.blob` (33 prims, clothed, no kit): the cast's gothic
mourning widow — black dress/gloves/stockings as paint, wasp waist, oversized
dark bun, pale skin, one red cameo choker. Baked face decal from the
reference's head meshes only (its 722-joint Rigify rig and clothes ignored).
One pipeline fix: `blob-face-bake.py` now REPEAT-wraps UVs (`% 1.0`) before
atlas sampling — the female mesh's UVs run outside 0..1 and clipping smeared
the atlas edge in streaks.

**[x] A-soldier — SOLDIER SHIPPED (2026-09-05), and the method changed on the
way.** `characters/soldier.blob` (15 prims, body only) + `soldier-kit.wam`
compiled to `public/assets/lab/soldier-kit.gltf` (pauldrons, cuirass, belt +
pouches, knee plates, boots) in the goblin's iron. Bare weightlifter arms, orb
hands, trousers and hips as paint, baked face decal with glowing eyes.

**THE RESULT WORTH KEEPING: describe-and-judge beat measure-and-fit.** The
mesh-fitting route ran a 10-task chain plus a day and produced a pot-bellied
egg with an unreadable face — while `blob:rings` reported clean, 2524 tests
passed and `render-check` exited 0. The measurements passed things that looked
wrong, because the bones that mattered were SKIPPED and a skipped bone is
indistinguishable from a converged one. Re-authored from a written description
with NO measurement step, it took **22 minutes and 24 prims**. Brief:
[plan](../../docs/superpowers/plans/2026-09-04-soldier-described.md); the abandoned
attempt is preserved at tag `blobforge-experiment-2026-09-04`. The lesson is
not "prose drifts" — it is that UNBOUNDED prose drifts. A spec that pins the
three beats carrying the read and frees everything else works fine.

**Five renderer/lab bugs found by shipping one character**, all fixed:
* `headShape()` anchored the face projection to the largest head prim, so hair
  or a hat could steal it — by definition a covering prim out-sizes what it
  covers, so there was no tuning escape.
* TWO silent catches around the sheet block, both claiming "reported by the
  body compile path" (it is not — the body compiles fine with a bad sheet).
  One invalid key put the ZOMBIE'S face and head on the character with nothing
  said anywhere. Both are loud now.
* Six face-panel controls had no `.blob` home (`texRelief`, `texStrength`,
  `eyeGlowAmp`, `eyeGlowCut`, `projSpherical`, `faceForward`), and
  `texStrength` was worse — a hardcoded assignment ran AFTER the sheet and
  overrode it. A `copy face+sheet as .blob` button closes the loop.
* The face-texture sliders read backwards AND could not reach their own
  character's values (floor 0.4, soldier ships at 0.18).
* The decal is gated by surface NORMAL, not distance — `face.ts`'s "juts past
  the projection plane" framing is wrong.

**Method note that cost four rounds:** headless `blob:shot` captures are
reliable for SILHOUETTE and useless for anything lighting-dependent. The
turntable exposes darker than the lab, so glow and tone read differently —
judge look in the lab, use captures for shape.

**NOT DONE, handed off:** walk cycle, carrying/firing animations, and the
shotgun. He is intended as the first non-zombie enemy that shoots back.



**SOLDIER AUTHORED FROM DESCRIPTION — AWAITING OWNER TURNTABLE VERDICT
(2026-09-04, branch dispatch/soldier-described).** `characters/soldier.blob`
(~30 prims): green flat-top box cap, pauldron yoke, belt+pouches, grey-green
cuirass with muted-red front plate, two-block olive fatigues, red boots,
baked face decal (`blob:face-bake -- soldier`). Registered in lab-main
CHARACTERS. Gates: render-check exit 0, vitest 2510 green, tsc clean.
Lesson of record: big plates take `color=`+`gloss`, NOT `metal` (reads black
under the single key); box prims take no `r2=`/`tip=`.

**FISHEYE LENS — SHIPPED ON sdf-game, AWAITING PLAY VERDICT (2026-09-03).**
The game view now renders WIDER than the player sees and the canvas blit
squeezes it back: `renderFovDeg` 90 (up from 75), `centerFovDeg` 60, and the
ratio between them is the bend. Straight lines are gone; the centre is
magnified 1.73x. The map lives in `src/lab/sdf-zombie/webgpu/fisheye.ts` and is
shared by the blit shader and the DOM reticle — they must not diverge. The warp
is folded into post-aa's existing blit as a 4-tap rotated grid (NO new pass:
that file's orientation invariant counts intermediate passes) and supersedes
sharp upscale. `k = 0` is an exact identity, so lab/bench are untouched and the
all-off parity gate still holds. Seams: `__sdfGame.setFisheye(centreDeg)` /
`setRenderFov(deg)` / `.fisheye` (reports `visibleFovDeg` alongside
`renderFovDeg` — the warp crops the mid-edges, so those differ). Measured at
the game's 4:3 cap: 90 rendered, **72.2 visible**, 60 at centre; **+4 ms/frame**
(35.9 -> 39.8 headless, a baseline already over the 30 fps budget).
`setRenderFov(85)` buys most of that back.
[spec](../../docs/superpowers/specs/2026-09-03-fisheye-lens-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-03-fisheye-lens.md) ·
[notes](../../docs/dev-notes/2026-09-03-fisheye/notes.md)

**[ ] F-aim.1 — free aim can point off-screen, and the crosshair goes with
it.** Owner deferred 2026-09-03 ("leave it, I'll judge it in play"). A
regression from the fisheye: free aim's clamp lives in the TRUE frustum while
the lens only shows 72 of the 90 degrees rendered, so aim can address points
outside the visible frame. There is no auto-recentring (`game-main.ts:1115`),
and shoving the reticle past the dead zone is HOW you turn — so a player
looking up parks the crosshair off the top of the screen and it stays there.
Measured at 4:3: the crosshair leaves the frame above `aim.y 0.730` / `aim.x
0.848`; the corner is the fixed point, so `aim (1,1)` is fine. Weight it heavier than an edge
case: `deadzoneY` is 0.38, so the crosshair leaves the frame over the top ~45%
of the deflection you need to look up — any firm upward flick gets there.
CHEAPEST PROBE FIRST: `FREE_AIM.recentreRate` already exists (`free-aim.ts:64`)
and ships at 0.0; a small non-zero rate would not fix the clamp but would stop
the crosshair PARKING off-screen, which is the actual complaint. Two fuller
fixes in the notes — reframe `aim` as screen space (preferred, touches firing
maths) or clamp `moveAim` in screen space and renormalise `deadzonePush`.

**BONE TUBES — BUILT, AWAITING OWNER VERDICT (2026-09-02).** Skeleton out of the marched field: posed bone prims drawn as ONE instanced analytic tube mesh (interleaved 18-float instances, WGSL vertex sweep, march-parity lighting) in the polygonal pass; the composite depth test hides bone under flesh and reveals it in cavities. Organs stay in the field. `packBones` flag (default on = legacy layout) flips bone rows out of the inside-flesh array. Counter gate (12-slug recipe): bonesTotal 1,807,616 → 309,992 with tubes on = exactly the organ share (≈8 of ~46.7 prims/body); meanPerPayingRay 276.4 → 47.0 — bone evals deleted, organs remain by design. Reel captured (torso / head / armL chunk, `scripts/bone-tubes-reel.sh`): no bone through intact skin seen; a-vs-b diffs at/below noise floor. Seams `__sdfGame.setBoneMesh(on)` / `.boneMesh` / `.boneTubes()`; default **OFF** until the owner's look verdict. Branch `claude/bone-tubes`.
[spec](../../docs/superpowers/specs/2026-09-02-bone-tubes-design.md) · [plan](../../docs/superpowers/plans/2026-09-02-bone-tubes.md) · [notes](../../docs/dev-notes/2026-09-02-bone-tubes/notes.md)

**ZOMBIE SKELETON RE-AUTHORED — AWAITING OWNER LOOK (2026-09-03).** Tubes showed the field skeleton was six 12 cm rib stubs over 20 cm of a 34 cm spine; the owner's reference is a standard human torso. Now: twelve rib pairs as HOOPS (two Bezier bars per rib meeting at the flank), cage half-width 0.167 in a 0.19 chest, upper ribs short/flat, 7 widest, 8-10 on the costal margin, 11-12 floating; kyphotic spine at the BACK; sternum; clavicles; a pelvis with iliac-wing fans, crest arcs, sacrum and a closed pubic ring. Flesh 23 + bone 90 = 113/128, containment clean at 4 mm. Emitted by `scripts/zombie-skeleton-gen.ts` (`--check --write`), which owns the per-rib table. `rig-bind.ts` torso/head bones now bind to the nearest AXIAL joint (a hoop's midpoint is nearer the hip/shoulder, which shear). Instancer cap 512 → 1024 (820 tubes live). Captures + notes: [docs/dev-notes/2026-09-03-zombie-skeleton/](../../docs/dev-notes/2026-09-03-zombie-skeleton/notes.md). Owner's first look drove round 2 (same day): the cage sheared because point-binds carry no rotation — torso bones now pose as ONE rigid frame per axial segment (`BoneFrame` in rig-bind.ts, shear test pinned); six thicker ribs instead of twelve; pelvis as fat blades + ring; noise mottle + blood flecks in the tube shader (helpers split into their own WGSL strings — wgslFn takes one fn per string, silently draws nothing otherwise). 23 + 68 = 91 prims, 600 tubes. Owner verdict: an improvement, merged to main as-is; tubes are NOT yet good enough to replace the field bones (a capsule pelvis is 'a messy line drawing', the cage reads as spiky tubes going in and out of sync) — `setBoneMesh` stays OFF. Follow-ups in the notes: a solid-mass primitive for the pelvis, one continuous loop per rib.

**Post-dispatch verification found three defects, all fixed (2026-09-05):**
the ring's arm-gap measure excluded `encircle`, so the pair actually
interpenetrating (an attacker and a WAITER, -0.051 m) was invisible to a gate
that reported everything clear; `ENGAGED_RADIUS` was 0.55, which settles two
bodies 1.10 m apart against a 1.20 m arm span (the 90-degree ring spacing was
derived from the arm reach, this number was not); and raising it to 0.70 then
put `meleeRadius` 1.0 INSIDE the separation equilibrium (0.70 + the player's
0.32 anchor = 1.02 m), so a body stood in `engage` for ten seconds without
swinging. Now 0.70 / 1.25, waiters included, gate window 12 s instead of 3 s
and refusing to report if it never saw an `attack`. Gate: room-4 arm gap
+0.435 m shipped, -0.020 m with waiters put back on the walking circle.
**Known and NOT fixed:** idle wanderers in other rooms still clip (they use the
base 0.35 m circle; raising it spreads every crowd — owner's call), and one
token-holder stays pinned by furniture at 2.85 m, so two nominal attackers are
really one until navigation lands.

**SWING VARIANTS — LANDED (2026-09-05), awaiting owner look.** The owner read
the one-arm hook as "a swimmer's motion", correctly: every arm angle was
`attackDrive × magnitude`, and that scalar runs 0 → −1 → +1 → 0, so pitch is
FORCED negative at the wind-up and positive at the strike — the arm must travel
from behind the body to in front of it, and a hook needs it raised at both
ends. The body keeps the signed drive (its weight shift was never wrong); the
arm now rides `armArc`, interpolating between explicit per-variant angles.
Two swings: a hook whose pitch CLIMBS 0.35 → 0.95 while yaw sweeps across, and
an overhead that is 2.1 rad of near-pure pitch. The off arm holds a raised
guard instead of counter-swinging — two arms in opposition through a
near-horizontal plane is the crawl. Variant is rolled at swing start from a
SECOND per-body RNG (sharing the wander generator would shift every subsequent
wander decision); the arm keeps alternating underneath, so a pack shows four
silhouettes. Guard: `flatArcRatio` 0.6, pinned by a test the shipped swing
fails, plus a gate assertion that both variants actually fire. Frames:
[docs/dev-notes/2026-09-05-swing-variants/](../../docs/dev-notes/2026-09-05-swing-variants/notes.md).
[spec](../../docs/superpowers/specs/2026-09-05-zombie-swing-variants-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-05-zombie-swing-variants.md)

**ZOMBIE COMBAT CHOREOGRAPHY — LANDED (2026-09-05), awaiting owner look.**
The owner's play-test of the crowd/brain build: arms clip when several
surround you, and the two-arm slam is "merely… okay". `melee-ring.ts` caps the
swingers at two and requires 90° of bearing separation between them — angles
are the claimants' CURRENT bearings, NOT fixed slots, which would orbit the
ring as the player turns. The arithmetic: separation's 0.35 m circles touch at
0.70 m while an arm reaches 0.6 m, so the circles are satisfied and the arms
always overlap; two holders 90° apart at 1.0 m are 1.41 m apart, clear with
0.2 m to spare (75° gives 1.22 m, which clears by 2 cm — not clearing).
`brain.ts` is now seven named states and absorbed the blast hold that used to
be a private timer in `game-actor.ts`. `attack.ts` is an alternating one-arm
hook; `motion.ts`'s reach pivot gained a world-up sweep to carry it, with the
lab's bit-identity pin untouched. Gate: `minHandGap()` — the owner's
screenshot as a number — plus the token cap and the spacing, all proven to
fail. Notes + frames:
[docs/dev-notes/2026-09-05-zombie-choreography/](../../docs/dev-notes/2026-09-05-zombie-choreography/notes.md).
**Still open:** getting stuck on furniture — navigation is its own spec and is
NOT in this change.
[spec](../../docs/superpowers/specs/2026-09-05-zombie-combat-choreography-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-05-zombie-combat-choreography.md)

**ZOMBIE CROWD + BRAIN — LANDED (2026-09-04), awaiting owner look.** The two
reports from the same session: bodies clipped through each other constantly,
and nothing in the level cared where the player was. Three pure modules —
`crowd.ts` (soft ground-plane circle separation, the player entering the set as
an immobile anchor), `brain.ts` (same-room + 70° facing-cone aggro that locks on
with a 4 s grace; a gunshot bypasses the cone), `attack.ts` (wind-up / strike /
hold / recovery off ONE signed scalar, so the lunge and the arms cannot peak on
different frames). `MotionConfig` gains one optional `attack` field that
BRANCHES rather than adding a zero — `x + 0` turns `-0` into `+0` — so the lab's
motion is bit-identical, pinned by a 30-frame exact-pose test.
**Two spec defects the gate found end-to-end, both invisible to unit tests:**
(1) a chaser aiming at the brain's standoff point could NEVER engage —
`arriveRadius` 0.4 stops it 1.4 m out, outside `attackRange` 1.0 — so the walk
goal is now the player himself and the engage latch halts it on the way in;
(2) the furniture rejection deadlocks a chaser (a wanderer picks a new leg, a
chaser re-aims into the same crate forever), so the rejection now pushes out
along the shallowest axis and a blocked line arcs around one COMMITTED side.
`brain.ts` stayed pure geometry through both. Gate:
`scripts/sdf-game-crowd-gate.mjs` — probe pair settles at 0.700 m wired,
0.437 m with the nudge removed (proven to FAIL). Notes + 6 frames:
[docs/dev-notes/2026-09-04-zombie-crowd/](../../docs/dev-notes/2026-09-04-zombie-crowd/notes.md).
**Deliberate gaps:** the swing does NO damage (owner's call — rhythm first, no
player health this round); chasers stop at their room's doorway because
`stepWander` clamps to room bounds, so cross-room pursuit needs navigation.
[spec](../../docs/superpowers/specs/2026-09-04-zombie-crowd-and-brain-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-04-zombie-crowd-and-brain.md)

**[ ] F-eject.1 — spent cases clip through the frame, and every reload throws
them identically.** Owner, 2026-09-03, after the breech merge: "the shells
eject but seem to clip through the gun frame so there needs to be some tweaking
there. also they always eject the same animation would be better to have some
randomness but not a blocker." Two separate things. The clip is a collision the
hand-off does not test for — `ejectedShell()` is a pure ballistic arc from the
breech with no awareness of the receiver it passes over, and the gate only
checks where a case STARTS (within 5 cm of a chamber mouth), not where it
travels. The sameness is `ejectedShell()` being deterministic by design
(`game-viewmodel.ts`: "same reload, same arc, every time") — which was the right
call for gating and the wrong one for feel. Randomising it means the eject gate
needs a seed it can pin, or it becomes flaky.

**SHELLS: EJECT CLIP + LOAD INSERTION — DONE (2026-09-04), F-eject.1 and
F-eject.2** — [notes + before/after strip](../../docs/dev-notes/2026-09-04-shell-reload/notes.md).
Owner: "the shells eject but seem to clip through the gun frame", "new shells
magically appear to load", "the reloading thing is more urgent". Both were the
same class of bug: cases handled in RIG space with no idea where the bore was.
* **Eject clip.** The tumble started AT the chamber mouth (not where the
  7 cm extract slide had left the case), snapped to rig −Z (not the bore,
  66° off it on the open gun) and flew in rig +Y — so its rear half was back
  in the tube and its rise cut the chamber wall and standing breech. Now:
  `boreFrameInRig()` reads `out`/`side` off the live Muzzle/Breech locators;
  the hand-off is the extracted case's centre (`mouth + out·SHELL_LEN/2`),
  bore-aligned via quaternion, with velocity `0.55·out + 2.05·up + side`
  and end-over-end spin about `side`. Cases leave the frame and are DROPPED
  once past the apex and back near breech height (`EJECT_DROP_BELOW_M`) —
  the old arc fell back through the frame past the camera as a huge shell.
  Per-reload seed jitters the arc (`reloadSeed`, `pinReloadSeed(n)`; seed 0 =
  reference); at the hand-off beat every seed is the origin, so the eject
  gate is seed-invariant — it now reads 3.50 cm (the SHELL_LEN/2 offset), the
  stale hardcoded breech still fails at 16.8.
* **Load insertion.** Two stages, mirroring the eject: a rig-space CARRY
  (0.74→0.96, `loadCarry`) with the cases riding rigidly in the hand to
  `stagedShellCenter()` — tips 1.5 cm behind the mouths, ON the bore axis —
  then a barrel-local INSERT (0.96→1.11, `insertStage`) sliding the seated
  Shell_L/R nodes in along their own z, the extract in reverse. The support
  hand's two breech keys are DERIVED each frame (`loadHold()` → `HandHold`
  into `supportHandPose(t, hold)`); the authored table had the hand at the
  bottom of the frame at 1110 ms while the cases seated by themselves.
* **Two placements were wrong before they were right**, both in the notes:
  the orb behind the heads along `out` sat between the eye and the breech
  and hid the whole load (`out` points largely at the camera on the presented
  gun); and "left of the pair" went screen-RIGHT because the GLB is yawed
  180° so the model's right chamber is screen-left — `loadHold` now picks the
  side by `side.x < 0` in rig space.
* **Forearms** are now anchored to fixed ELBOW_L/R points behind the camera
  and re-aimed per frame (`aimForearm`), 0.90 m long: the 0.15/0.26 capsules
  ended in a rounded stump that came into view on a hard look down (the
  detached arm the owner saw), and a hand at the breech with its resting arm
  direction pointed the forearm straight at the eye. Checked at pitch ±1.45
  with the reticle at both frame edges: no end in view.
* Gate strip now samples 960 (staged) and 1040 (mid-insert);
  `GAME_EXTRA_BEATS=530,560` adds frames without touching the owned list.
* **Round 2, owner's pass:** the remaining clip was the MODEL — the receiver's
  top strap ran forward over the chambers, so an open mouth sat level with the
  receiver top and every case spent its first 35 mm inside it. The body loft
  now steps down to action flats (z −0.004) forward of the breech face;
  `shorty-double.glb` re-exported (13994 tris). Pose retuned LOW (dy 0.040,
  roll −16; a true drop put the reload off the bottom edge because the breech
  rests there). Hand is a fist centred on the pair, covering heads then mouths
  as it pushes (owner: "you wouldn't really see the shells"). KeyT slow-mo
  (1 → 0.25 → 0.1) for inspection. The flat bar across the open mouths was the
  `extractor` box sitting ON the bore axis — now a plate under the tubes.
  Owner's second look: "it looks better yes". **Round 3:** the hinge pin sits
  inside the chamber's length, so the open chamber swung DOWN through the
  tray and the tray showed inside the empty bore as a grey slab (owner found
  it by hand). Flats now ramp −0.004 → −0.022 toward the knuckle and taper in
  width; the bore plug starts at `HOLLOW_DEPTH` 27 mm (gate asserts that);
  chamber inner wall is matte `Bore` via a second material slot. Owner:
  "other than that I think I like this, think it can be merged". Merged to
  main `6c783f2`. **Round 4 (post-merge):** the top rib's underside was inside
  the hollow chambers (showed as a rectangle in the empty bores) — now a 10 mm
  valley strip; the "asymmetric shelf" was the ramped tray's side face seen on
  the near side only (loft is symmetric; both-side renders in the notes) —
  tray now a constant 0.040 half-width under the tubes.

**[x] F-arm.1 — the FPV forearms should resemble the goblin SDF character.**
Spec written 2026-09-04 (approach B, owner-approved in conversation):
[docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md](../../docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md)
— Blender-authored arm GLB (thicker skin with ball joints, leather bracer
with brass hardware matching the gun, a SMARTWATCH on the left wrist with a
drawable glowing screen), generated albedo + normal skin maps with no
emissive, kit parity for the watch. **BUILT 2026-09-05** via the dispatch UI
on kimi/k3 (8 tasks, branch `dispatch/2026-09-04-fpv-goblin-arms-task-8`):
`goblin-arm.glb` (8942 tris) from `scripts/model_goblin_arm.py`, `game-arms.ts`
dresses it (generated albedo + normals, NO emissive, gun env map), smartwatch
on the left wrist with a drawable glowing screen (`__sdfGame.watchScreen`),
kit parity in `goblin-kit.wam`, gate check 2b. Task 1's agent stopped on a
plan defect of mine (the albedo's own tests were unsatisfiable as written);
fixed by hand after the chain: wart darkening is a multiplicative shade, the
mottle mix is linear (0..80%), the mean test budgets luminance at 8% and hue
at 12% per channel. 3169 tests, tsc, gate all green. Evidence:
[docs/dev-notes/2026-09-04-fpv-goblin-arms/](../../docs/dev-notes/2026-09-04-fpv-goblin-arms/notes.md).
Owner's first look (2026-09-05) drove three more: a TWO-BONE arm (Upper_L/R
nodes, `armIk` to shoulder anchors behind the camera — the one-piece stick
showed its end at extreme pitch), skin re-toned to the character's face
(saturated, wet, fine dark speckle via a fleck lattice; NOT the matte
darkening tried first), chrome spike studs on the bracer, warts moved off the
fist, knuckle nubs removed (they read as warts). 3177 tests, tsc, gate green. Second look: shoulders moved to CAMERA space (a rig-space shoulder swung in
front of the eye under free-aim pitch), grain moved into the normal +
roughness maps (pit field), finer tile, greener/darker tone. Then: with free aim pitched up the
straight hand-to-shoulder line ran THROUGH the receiver — the IK now has a
bend floor (34°) toward a camera-space outward hint, so the forearm always
leaves the hand past the gun. Owner: "good job for now" — **merged.** Follow-up **F-arm.2 — the watch
as an in-game device** (shells / health / timer drawn on the screen canvas).
Owner, 2026-09-04: "the arm itself probably needs some work to more
accurately resemble the goblin SDF model (I guess that will be the main
player character)". Today each arm is one skin-coloured capsule from the hand
orb to a fixed elbow; the goblin blob has a forearm bar r=0.028 with an elbow
blob r=0.038 over a 0.235 bone (`goblin-skin.ts` already carries the
numbers), mottle, and a real hand. Options: pose the SDF goblin's own arm
prims in the view-model (the hands sheet / hand-volume path already marches a
hand), or author a low-poly forearm+hand in Blender alongside the shorty.
Not a blocker; the elbow-anchor from F-eject gives whichever replacement its
attachment point.

**SHORTY BREECH MECHANISM — DONE (2026-09-03), all 8 tasks** —
[plan](../../docs/superpowers/plans/2026-09-03-shorty-breech-mechanism.md) ·
[spec](../../docs/superpowers/specs/2026-09-03-shorty-breech-mechanism-design.md).
Fixed three defects, one of them not in the owner's report ("the tube is
solid, not hollow... the ejected shells dont come out of the right
location"):
* `chamber{i}` was built with `cyl()`, which caps both ends — breaking the
  action open showed two solid domed knobs where the mouths should be.
  Rebuilt with `tube()` + a `taper_tube()` forcing cone; a raycast down each
  bore is now part of the model gate (`[shorty] OK`), proven to FAIL when the
  chamber is reverted to `cyl()`.
* Breech-face detail (`mouth{i}`, `extractor`) sat at the chamber's FRONT,
  35 mm from the real breech face — moved to y = −0.031, with a widened
  standing breech (Task 3) that now carries its own barrels instead of
  overhanging the frame.
* The eject origin was a stale hardcoded constant that could not follow the
  barrels through their swing. Cases now extract along their own local bore
  axis as children of `Barrels`, then hand off to a free tumble spawned at
  the LIVE `Breech_L/R` world position, read every frame via `breechInRig()`
  (exposed for gating as `__sdfGame.breechWorld()` / `.lastEjectOrigin`).
  **Task 7 Step 5b's gate was landed late, during Task 8:** the runtime
  plumbing shipped in `a5c7f7e` but the assertion the audit actually asked
  for — sample `lastEjectOrigin` at the eject beat, assert within 5 cm of
  `breechWorld()` — had no driver anywhere in the repo (`git log` / grep for
  `breechWorld` outside `game-main.ts` came up empty). Added to
  `sdf-game-shorty-gate.mjs` at the 510 ms beat (== `RELOAD.ejectAtSec`, the
  first frame the tumble owns the position, before it drifts downrange):
  passes at 1.18 cm on the real build, proven to FAIL at 16.8 cm when `breech`
  is hardcoded back to the old `(0.105, -0.075, -0.360)` constant.
Reload retimed to the reference's tempo (45° over 0.33 s, shut in 0.14 s,
1.30 s total — up from 1.05 s); `scripts/sdf-game-shorty-gate.mjs` derives its
wait from `__sdfGame.reloadTotalSec` rather than a hardcoded frame count, and
its reload strip now samples the actual beats (present/break/eject/load/snap)
instead of a stale timing left over from the shorter reload.
**Verification (Task 8):** three render angles, not one — FPV, a straight-on
rear view, and a three-quarter — in
[docs/dev-notes/2026-09-03-shorty-breech/](../../docs/dev-notes/2026-09-03-shorty-breech/)
(`before-open45.png` vs `after-open45{,-rear,-threequarter}.png`). The
three-quarter is the angle that actually proves hollowness by eye (a dark bore
reads all the way from muzzle to breech); the straight-on rear view, looking
near the bore axis, would look the same whether the chamber were solid or
hollow, so it's read for FRAME FIT (mouths seated within the widened receiver,
not overhanging it) rather than hollowness — the raycast gate is what proves
hollowness, per the render-vs-raycast audit below. In-game reload captured
headlessly (`__sdfGame.step`/`setLoopRunning(false)`, `ingame-reload/`)
confirms by eye: the top lever is at full throw while the hinge is still shut
(180 ms vs 350 ms), cases tumble up and away after sliding out the tilted
bores, the extractor sits visibly proud between two genuinely dark, empty
mouths mid-reload (650/900 ms), and the fresh cases seat and the action snaps
shut (1110/1180 ms).

**FPV WEAPON OVERHAUL — GOBLIN SAWED-OFF — MERGED (2026-09-03).**
`sdf-game.html`'s view-model is a procedural break-action sawed-off double
(`shorty-double.glb` from `scripts/model_grapeshot_shorty.py`; the break is a
code-driven rotation of the GLB's `Barrels` node about its `Hinge` locator, no
baked animation). Built by an 8-task dispatch chain, then three owner look
passes on top.

Round 2 (`d2b1276`): the reload became a KEYFRAME table — the first pass drove
the present with `sin(PI·t/total)`, peaking at mid-reload, so every beat
smeared across every other; red-hull/brass-head cases eject and are shoved back
in; the support hand crosses the body and visibly does the loading; recoil;
muzzle flash rebuilt as a generated ragged star with smoke
(`flash-sprite.ts` — it was untextured `PlaneGeometry`, hence "a rectangle").
Round 3 (`1e99b54`): gun centred and both hands hung off the model's own
`Grip_Hand`/`Fore_Hand` locators, so they cannot drift out of contact again.
Round 4 (`b1f44d7`): **FREE AIM** — the Realms of the Haunting scheme. The
mouse moves a reticle; the camera only turns once it passes a central dead
zone; shots go through the reticle, not screen centre; distance-driven walk
bob. `G` toggles it against classic mouse-look.

Gates: suite 2807/2814 (the 7 are the pre-existing `blob-measure.test.ts`
environmental failures), tsc/build clean, `scripts/sdf-game-shorty-gate.sh`
exit 0. Measured in-engine, not asserted: flash `spotCfg.x 1 → 1.81`, reload
`2 → 0 → 2` with the hinge `0 → 0.610 rad` by t=0.3 and shut by 0.9, and free
aim turning the camera **0.000°** inside the dead zone against 137°/s at full
edge push.

**KNOWN TEMPORARY: the flash lights marched bodies by borrowing the
flashlight's `spotCfg`/`spotColor` uniforms inside the per-actor beam replay.**
The real fix is a second light slot in the march; it cannot land while the
perf-r2 chain is rewriting `march.wgsl.ts`, which is precisely why the borrow
exists. Tracked under the spec's "Deferred".

**FREE-AIM DEFECTS + PANELS — MERGED to main (2026-09-03, 6 commits).** Three
owner reports off `fpvbugs.mov`, all measured before being fixed:
* **The gun pointed 32.5° away from the reticle.** `weaponYawDeg` was a flat
  15° cap, but a reticle at x=±1 is 47.5° off-axis at 790×555. The cap became
  a 0..1 FRACTION of the true `atan` angle, so the mismatch is now
  inexpressible rather than merely retuned (`weaponYawFrac`, clamped).
* **Pointing it fully swung the gun off-screen**, because `aimRig` rotated
  about the EYE (muzzle at screen-x 1.54). `pivotOffset()` rotates about the
  GRIP instead → 0.66, in frame. Its first version had the Euler factors
  REVERSED (`Ry·Rx` where three.js `'XYZ'` applies `Rx·Ry·Rz`) and ignored the
  bob roll — up to 124.8 mm of grip drift under combined yaw+pitch, invisible
  to tests that held one angle at zero. Fixed in `92aacef`; a 5000-pose fuzz
  is now 1.7e-13 mm.
* **Shots spawned 0.5 m BEHIND the eye** — `muzzleWorld()` subtracted forward
  where it should have added, so every projectile was born 1.1 m behind the
  barrel and flew through the player's head. Wrong in BOTH aim modes since it
  was written; only slug mode drew something slow enough to see. Now reads the
  GLB's live `Muzzle_L/R`, falling back to `muzzle-pos.ts` (the tested helper
  the page had reimplemented with the sign flipped).
* **Weapon now CROSSES the frame** (`dd1cd08`), not just nods: pivoting about
  the grip pins it at screen-x 0.12 by definition. `weaponSlide()` is linear
  in the reticle (the angles are `atan` of it — projection vs framing).
* **Tuning panels ship COLLAPSED** (`panel-chrome.ts`): title bar visible so
  they stay findable, body closed so captures show the game. Not persisted —
  a remembered state is how two machines stop capturing the same frame.

**PROCESS NOTE, worth more than any of the above:** four defects in this pass,
and NOT ONE was caught by a test going red. Tests that re-derived the
implementation's own arithmetic; a plan step naming the wrong gate; a gate
measuring a crater after the engine had shoved it 18 cm; a gate outside
`npm test` that nobody ran. Green is not evidence unless the check could have
failed — mutation-test the check before trusting it.

**OPEN (owner):** free-aim feel — the 0.45 dead zone and 1.9 rad/s turn rate
are calibrated to be sane, not to match the reference; they are the character
of the whole scheme. Slide defaults (0.10/0.045 m) accepted as fine for now.
Knobs: `__sdfGame.setAimTuning({...})`, `__sdfGame.setGunTuning({...})`. Gun
finish still reads slightly chrome under the dungeon rig.
[spec](../../docs/superpowers/specs/2026-09-03-freeaim-and-panels-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-03-freeaim-and-panels.md)

**[ ] P-gates.1 — the slug placement gate is unsound in BOTH builds.**
`sdf-game-slug-gate.mjs` stamps a crater, then `applyProjectileHit` shoves the
struck rig point by `IMPULSE.blast = 0.18` m with NO falloff, then the gate
measures the crater's displaced anchor and calls the delta a placement error.
Subtracting the shove the slug lands 0.48 cm from prediction. It passed before
only because its single fixed target happened to strike a prim the shove does
not carry — sweep all ten bodies and the OLD code fails z10 at 14.54 cm. Fix:
expose the stamped impact point (`__sdfGame.lastImpact`) and assert against
that; sweep several bodies.

**[ ] P-gates.2 — `wound-panel-verify.mjs` asserts a schema that no longer
exists** (wants 5 sliders against 14; checks `woundFibreAmp`, 0 occurrences in
`src/`, 15 in `scripts/`). Stale since `b6474d8`. It also never closes its CDP
socket, so the process hangs after printing `done.` — needs a `timeout`
wrapper until fixed.

**[ ] P-gates.3 — `muzzleWorld()`'s two branches disagree by 24 cm.** Live
locator sits at eye + `(−0.038, −0.290, +0.566)`; the headless fallback
constants put it at `(−0.2, −0.12, +0.5)`. Spec claimed the fallback "keeps
the headless contract" — it does not, and nothing compares them. Re-derive the
constants from the GLB and pin with a test.

**[ ] P-panels.1 — `button()`, the copy-button block and the `note` styling
are still byte-identical** in `goo-panel.ts` / `wound-panel.ts`. The
`panel-chrome.ts` extraction took the shell only; the copy button is the part
with real behaviour in it.

**[x] P-env.1 — `tsx` was not installed, and its shim was a SELF-POINTING
symlink.** `node_modules/.bin/tsx -> /Users/donny/Projects/blud/node_modules/.bin/tsx`
(dated 2026-08-31), and `node_modules/tsx/` does not exist, though `tsx` is in
`devDependencies`. This is the whole of the "7 pre-existing environmental
failures" quoted all over this file: `scripts/blob-measure.test.ts` shells out
to it and gets `ELOOP` in the main checkout, `ENOENT` in a worktree (which has
no `node_modules` at all). So the suite has been 7 red for days for a reason
nobody diagnosed — it was repeatedly waved through as "environmental", which is
true but was never the same as "understood". **FIXED 2026-09-03:** removed the self-link, `npm install` — `tsx v4.23.12`
resolves via `../tsx/dist/cli.mjs` and `blob-measure.test.ts` is **7/7 green**.
The suite is clean for the first time in days. Note a worktree still fails
these: the test resolves `tsx` from its own repo root and worktrees carry no
`node_modules`, so run this file from the main checkout.
[spec](../../docs/superpowers/specs/2026-09-02-fpv-weapon-overhaul-design.md) ·
[plan](../../docs/superpowers/plans/2026-09-02-fpv-weapon-overhaul.md) ·
[note](../../docs/dev-notes/2026-09-02-fpv-weapon-shorty/notes.md) ·
[blockout](../../docs/dev-notes/2026-09-02-fpv-weapon-blockout/notes.md)

**HULL-REFINE RENDERER — PARKED (owner, 2026-09-02): "annoying visual glitches… doesn't seem to offer much benefit atm; maybe with crowds". Revisit = phase 2 early-Z on the crowd case.** Phase 0 built, look passes headless parity, cost a wash at one body. Per-frame GPU surface-nets hull + fragment band refinement through the SHIPPED march (`march.wgsl.ts` untouched). Dispatch chain (kimi/k3, 5 tasks) landed the code; six bugs then separated a green suite from a zombie on screen (relaxed stepMul, vec4-padded soup stride, chunk hulls never extracted, extraction before the wound upload, a 4M-eval/frame live test, a 70-eval vertex pull) — all fixed and pinned. Headless A/B (8 stepped poses, 6 live instants, crater on/off, the 3-item reel): hull ≡ march. Owner: "pretty impressive… slightly less jiggly… pretty close". Fenced bench, one body, close camera, machine load 15–110: march ~22–27 ms, hull ~25–27, hull draw-only ~22 — extraction ≈3–4 ms, no win without early-Z (phase 2). NOT the hull: torso-sphere wounds billboard on both renderers and in-game (`damage.ts frame()` vs `game-actor` yaw-0 contract) — spun off. Page: `sdf-hull-spike.html`, seams `__hullSpike.*`, driver `scripts/hull-spike-drive.mjs`, reel `scripts/hull-spike-reel.sh`.
[notes](../../docs/dev-notes/2026-09-02-hull-refine-spike/notes.md) · [spec](../../docs/superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md) · [plan](../../docs/superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md)

**WOUND BILLBOARDING — FIXED (2026-09-02, `claude/serene-jemison-7c15a7`).**
Owner: a crater on the zombie's back rotated round to the front as it turned
(torso + legs; head fine). Root cause: torso blobs are axis-less spheres, so
their wound frame is a fixed WORLD basis unless `bodyYaw` de-yaws it; the game
actor stamped AND uploaded at yaw 0. Contract now: stamp(posed, yaw) /
upload(posed, yaw) / sever-resolve(rest, 0) — one body frame, three views
(`game-actor.ts refreshWounds` note). `cutLimbs`/`cutChains`/`ExplosionBody`
take an optional `bodyYaw` for callers on POSED prims; every posed-prim
consumer in `game-main.ts` + `bleed-registry.ts` quotes the live yaw. Gates:
actor upload keeps its body-frame offset through a >1 rad turn; sever at
yaw≠0; turned-body explosion == rest-body stamp. Not yet on the hull-spike
branches (`sdf-hull-spike.html` lives there) — they get it on merge.

**GORE R3 REFINEMENTS — QUEUED (2026-09-02), from the review of
`claude/continue-previous-work-91055b` (wound r2, unmerged).** Ordered list in
[docs/dev-notes/2026-09-02-gore-r3-refinements.md](../../docs/dev-notes/2026-09-02-gore-r3-refinements.md):
(1) BUG — `applyBones` hard-codes taper/profile/bend to none, so the
authored curved ribs render as STRAIGHT capsules (verify: zero one rib's
`bend=`, diff); (2) cull the bone fold (no spatial test today — ~17 bones ×
3 loads per field eval in the wound zone, ×4 for normals); (3) count bone
evals instead of timing them; (4) torso cavity + organs as `W_ORGAN` in the
same array; (5) gate the per-hit bone-material read on `wm > 0`; (6) bone in
gib chunks; (7) collision. Merge picture: gore × perf chain conflicts only in
`march.wgsl.ts` signatures + one `game-main.ts` block — merge ONCE after the
chain finishes (~1 h); gore × elbow branch is clean.

**THE THREE-r185 DISTANCE DECAY WAS FOG — ROOT-CAUSED AND FIXED (2026-09-04,
main `8da0bdd`).** The "unexplained TSL distance decay" that killed the occluder
pre-pass and held `GAME_HULL_EXIT_BOUND` at 0 for weeks is **scene fog**. The
pre-pass materials render through the main scene, and the WebGPU node system
applies fog to every fogged material's **output** — so the written distance was
`mix(dist, fogColor, smoothstep(near, far, viewZ))`. Dungeon rig fog is
near 2.5 / far 13: exact below 2.5 m, collapsing toward `fogColor` with range.
That is the "near field exact, true 9 m stores 2.8 m" signature exactly, and the
measured ladder **fits the fog curve to four decimals**. Fix: `material.fog =
false` in `occluder-hull.ts` and `shell-hull-outer.ts`. **Consequences:** a
texture round-trip of a ray parameter is now clean (task-3's depth prepass is
un-gated), and the exit bound's measured-but-untakeable step win
(missStepShare 0.54 → 0.41) is takeable — task 1b re-takes its census and
decides the flip. Second bug fixed in the same run: **`?frozen=1` killed the
march layer** — booting frozen meant the outer hull never built, shell targets
stayed zero, `shellOut = 0` discarded every fragment, and the whole march layer
went invisible while the CPU field, predictor and polygonal world read fine.
Task 1 was capped at 120m mid-Question-A; its work was auto-committed, verified
independently here (tsc 0, 2457 tests green) and merged. **Question A —
shading vs marching at fill-screen — is still UNANSWERED** (spreads blew out,
the page crashed under load spikes); it is task 1b's.

**CLOSE-UP HARNESS LANDED (same commit).** `scripts/sdf-game-closeup-bench.mjs`
+ `buildCloseup()` in `game-bench-scenario.ts` + the `setFlatAlbedo` seam: pins
fourteen ship levers explicitly, searches the distance ladder 1.6 → 0.6 m
keeping the rung with the **best** flesh coverage, stamps camera-facing wounds,
and fails loudly if fewer than 3 stamp / the blood sim is non-empty / a stamp
severed something. Rotates the starting leg per rep against thermal ramp. Task
1b extracts it to `scripts/lib/sdf-closeup-stage.mjs`; every later task imports
it rather than re-deriving a scene. Chain is now fully serial (one bench at a
time — concurrent benches are what spoiled the tile table and the r2 sweep):
**1b → 4 (goo) → 2 → 3 → 5**, all `pending` except 1b and 4.

**CLOSE-UP WOUND CULL — DONE, SHIPS ON (2026-09-05, `dispatch/2026-09-05-closeup-wound-cull`, commit 8c03342).** `applyWounds` now tests ONE bounding sphere of every wound's reach (`woundBound` uniform, computed by `woundReachBound` at `setWounds` from the live woundCfg/woundCfg2 — not a hardcoded copy) BEFORE its 16-slot loop; outside it the loop would early-out per wound anyway, so the cull is a value no-op by construction. Parity PROVEN, not hoped: 0 changed pixels, wounded ON/OFF + ON/ON + both unwounded pairs (`scripts/closeup-woundcull-capture.mjs` — note it pins `performance.now`, because the fire flicker ticks off wall-clock even frozen and jitters ~19% of pixels at d>0 between same-state captures). Bound proven live in-page (r 0.933 m on the 5-wound staging). Bench (BENCH_REPEATS=4, quiet machine, 0 rejects): cullOff − ship = **+1.4 ms median** (rep deltas 3.0 / −2.1 / 2.5 / 0.5 — one inversion inside rep noise) of the ~25.3 ms (ship − unwounded) wound gap; stepFull re-confirmed at −7.8 ms. The far-sample loop was ~5% of the wound cost on the fill-screen staging because the camera-facing wound cluster sits where the march steps concentrate. **Step 2 (per-cluster wound lists) spec'd in the notes and deliberately NOT built** — it attacks a sub-slice of the remaining in-bound loads (≪1.4 ms) while 69% of the gap is lever-1 stepping + intrinsic in-reach maths. Next real lever: re-gate the 0.6 near-wound factor at ω 1.0 (look-gated, separate task). Seam `__sdfGame.setWoundCull(on)` / `.woundCull` / `.woundBound()`. Suite 3141/3141, tsc clean.
[notes](../../docs/dev-notes/2026-09-04-closeup-2-probes/notes.md#wound-union-reach-cull-2026-09-05-dispatch2026-09-05-closeup-wound-cull)

**CLOSE-UP TASK 3 (depth prepass) — BUILT, CENSUS-CLEAN, DOES NOT SHIP
(2026-09-05).** The quarter-res coarse march of the field exists and works:
one texel per 4x4 SDF-pixel block, cone radius = the block's half-diagonal
(the proof the start is a lower bound), per-body twins resolving to the
NEAREST touch via frag_depth, consumed as a third max() term at the ray
start. Census CLEAN at six views (0.5/3/9 m + head/thin + rooms 3/4): hits
kept 99.99-100.02%, state-clean, pixel diffs at/below noise; meanStepsHit
-5% to -45%. But Question A's walk share did not survive its own baseline:
re-measured at today's 13.9 ms wounded fill-screen frame the walk is
**15.9%** (normal 13.86 vs flat 11.65), so halving the walk buys ~1 ms while
the pass costs ~0.5-2 ms (growing with bodies - the coarse rays march long
distances at standoff). Bench: fill-screen +0.5 ms, room3 +0.95, room4 +1.94.
**Verdict: ships OFF** (`GAME_DEPTH_PREPASS = 0`,
`__sdfGame.setDepthPrepass`); the seam, the census
(`scripts/sdf-depth-prepass-census.mjs`) and `depthPreStats()` stay. Three
new shader-wiring traps found and pinned, all rendering as "every body
unlit-black with every uniform dead": a PAREN in a WGSL-signature comment
truncates three's parameter parse exactly like the known colon hazard;
calling a helper by its CONST name instead of its source name is an
unresolved call target; and `vec4(a, b, 0, 0)` composed from two SCALAR
uniforms in a wgslFn literal breaks WGSL generation outright — pass ONE vec4
uniform whole. Also: `createZombieGpuView`'s positional createMarchMaterial
call silently dropped the new argument (the march sampled the 1x1 zero
fallback while the twin wrote real starts) — positional call sites must be
re-counted when a parameter is added.
[notes](../../docs/dev-notes/2026-09-04-closeup-3-depth-prepass/notes.md).

**CLOSE-UP TASK 5 (settled-chunk bake) — LANDED, SHIPS ON (2026-09-05,
cherry-picked from `dispatch/2026-09-04-closeup-task-5`, never merged: its
history carries the 116 MB glb).** A chunk that passes `chunkSettled` is
extracted ONCE on the CPU (field + albedo mirror of the march's tissue ramp,
noise, bone/organ attribution, torn gore) into a static lit mesh in the MAIN
scene (early-Z occluder), its `ChunkGpuView` recycled through a 12-view ring.
Nine gates green: seam-off parity with main pixel-identical (c76adada), bake
5.3 ms one-shot on a 128-vert piece, baked piece hittable (pellet loop tests
baked pieces BEFORE the floor kill — a settled piece rests at y 0.02, exactly
the kill plane; this ordering cost the dispatch hours and is pinned with
ORDER comments), leak soak bounded (views cap 12, 25 bakes recycle clean).
Dispatch timed out before the look capture and the firefight bench; **owner
look verdict in-game: "looks great, nothing off from non baked"** → ships
ON (`GAME_CHUNK_BAKE = 1`), with ONE bake per frame added on landing so a
double-barrel's settling chunks cannot stack 5 ms bakes into one frame.
**Owed:** the on/off firefight bench number (rooms 3/4). Seams
`__sdfGame.setChunkBake/chunkBake/chunkStats/spawnTestChunk`; drivers
`scripts/sdf-chunk-bake-gate.sh`, `scripts/sdf-chunk-bake-look.mjs`.
[notes](../../docs/dev-notes/2026-09-04-closeup-5-bake-settled/notes.md).

**CLOSE-UP TASK 4 (goo) — DONE, NEGATIVE RESULT (2026-09-05).** The premise
("the goo layer is the blood cost") does NOT reproduce. Measured with the
item seams landed on `dispatch/2026-09-04-closeup-task-4-attempt1` (parity-
pinned default-off, suite green): whole goo chain (density + blurs + surface
composite) = **~0.26 ms idle, ~0.1–0.5 ms in a room-4 firefight (cov ~1%),
~0.14 ms at the saturated-pool worst case (256-ring, 6.3% cov)**. Coverage
caps at ~6% even staring into an accumulated pool at 1.6 m. All three items
→ **no-ship, seams stay default-off**: item 1 has a real look cost in the
shipped depth mode (depth-tested upsample drops the flying-spray fusion —
recovered in overlay mode, so the fix path is known: packed-depth
reconstruction for sparse texels); item 2 is invisible + cost-neutral by
construction; item 3's `fallMask` still submits every splat (saving ~0 by
construction) and the pools survive anyway. Parity vs MAIN: CLEAN all three
scenes (idle exact 0%). Item A/B medians storm-blocked (sibling dispatch
load 70–160 half the session) and moot given the bound. Notes + numbers:
[docs/dev-notes/2026-09-04-closeup-4-goo/notes.md](../../docs/dev-notes/2026-09-04-closeup-4-goo/notes.md).
If the owner's "blood spray causes issues" needs chasing, it is NOT this
layer — candidate suspects outside task 4's scope: billboard blood view,
chunk physics, sim step.

**CLOSE-UP TASK 1B — DONE (2026-09-04).** Harness extracted to
`scripts/lib/sdf-closeup-stage.mjs` (staging record byte-identical pre/post
extraction — proven by diff across four runs, not by reading). **Question A
ANSWERED at decision grade** (two genuinely-quiet windows out of ~10
attempts, ranges quoted): of the wounded fill-screen frame — clean walk
~29%, **wound-adjacent walk ~41% (the stablest number: wound shadow + wound
fold near craters)**, post-hit shading chain ~30%, shading on the clean body
alone ~5%; wound total ~66%. Tasks 2/3 are NOT aimed at the wrong half, but
the biggest single column is the wound WALK, which lever 3's early-out
(≈0) doesn't bite and lever 2's probes don't touch — task 2's scope should
absorb the wound-shadow walk, and everything must be measured on the WOUNDED
fill-screen staging. Stability machinery now load-gated (reject >+8 rise /
>24 abs loadavg, counted makeup reps, 16 rejections in the final run), crash
retry re-connects (fixed: ws death used to pend forever — one run lost).
Instrument findings: `hashMarchTarget` is NOT a live-frame parity hash
(stale target outside debug-mode renders; poisons the next occupancy read);
the bare `teleport` seam drops the player inside the frozen spawn cluster
where the mode-4 depth-winner bias reads hits=0 for a room the canvas
renders — stand off 4 m (bench framing) before censing a crowd.
[notes](../../docs/dev-notes/2026-09-04-closeup-1b/notes.md)
**STEP 3 DONE — `GAME_HULL_EXIT_BOUND` SHIPS 1 (`6a514a0`).** Re-taken
census clean at five views (room 1 at 0.5/3/9 m + rooms 3/4 standoff):
hits/rasterised/meanStepsHit bit-identical on/off, pixel diffs at noise,
state-clean — the historical body-deletion was the fog and it is gone.
Step win by counter: missStepShare 0.58 → 0.46, meanStepsHit unchanged.
Timing A/B unresolvable on that night's machine (spreads 11–40%, load
quoted per row) — the flip rests on exactness + counters + r2's −0.28 ms.
Gates: tsc 0, vitest src/lab 2457/2457.

**CLOSE-UP FRAME RATE + GORE COST — SPEC WRITTEN, 5 TASKS QUEUED INERT
(2026-09-04).** Successor program to perf r2, aimed at the owner's restated
problem: **a body filling the screen**, and heavy blood spray. Spec
[docs/superpowers/specs/2026-09-04-close-up-and-gore-cost-design.md](../../docs/superpowers/specs/2026-09-04-close-up-and-gore-cost-design.md)
carries the nine closed ideas (adaptive REJECTED, tiles nil, upload nil, depth
gate exact-but-OFF, exit bound deletes bodies, occluder ~nothing, shell/hull
parked, omega 0.6 costs) — **re-proposing any of them is a failure.** Dispatch
`~/.claude/dispatch/plans/2026-09-04-closeup-task-{1..5}-*.md`, `status: queued`,
trigger manually. Graph: **task-1 diagnostics** → task-2 ∥ task-5; task-2 →
task-3; **task-4 (goo) parallel to everything**. Two things task-1 settles that
nobody has measured: (a) **shading vs marching at fill-screen** — every counter
here counts *steps* and none separates the per-pixel shading chain, so tasks 2/3
may be aimed at the wrong half of the frame; (b) **does a written ray parameter
survive a texture round-trip** — the three-r185 decay (true 9 m reads 2.8 m,
near exact) killed the occluder pre-pass AND holds `GAME_HULL_EXIT_BOUND` at 0,
and task-3's quarter-res depth prepass does the same write/read. Root-causing it
unblocks two features. Task-4 (goo): the cost is **not** the 600 billboards, it
is `goo-layer.ts` compositing at **full canvas res** (`:854`) over
`densityScale 0.5` pre-blurred inputs, plus additive-quad overdraw
(`quadScale 3.2`, no depth reject) — owner agrees, easy win. Task-5: settled gib
chunks are static fields still marched as 12 proxy boxes (`MAX_CHUNKS`,
`game-main.ts:1712`); bake once at settle and the hull's ~3-4 ms/frame
extraction objection is *deleted*, plus baked meshes are real early-Z occluders.
NOTE: **no corpse exists in `sdf-game.html` yet** (sever/gib only; death state is
on the zombie-crowd branch) — settled chunks are the beachhead and the path
generalises to corpses unchanged.

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
**2026-09-02 later:** task 5b done. `max(shellIn, bodyEntry)` is exact
(larger of two lower bounds on the first possible hit) and provably bites:
staged-overlap + rooms 3/4 parity all at/below the capture noise floor,
residual = sub-pixel fringe on occluded silhouettes, no missing geometry;
`hits`/`rasterised` bit-identical (mode-4 counters only record the depth
winner — the instrument CANNOT see this gate). BUT the bench A/B measured
the per-body PASS STRUCTURE as a ~6-7 ms/frame net loss at 3-4 bodies
(each sub-pass: full-target blit + renderer.render scene walk; the run's
two clean paired reps agree, spreads 82-89% otherwise formal-UNRESOLVED).
`GAME_DEPTH_GATE` ships 0; bench leg renamed `depth-gate-on`; task 9
re-takes the A/B on a quiet machine and re-decides the default.
Task 6 DONE (AA on): strength-0 parity bit-identical both rooms; near 2 m
and far 8 m visual gates pass (owner-independent read of the far pair:
all nine bodies, crater survives, smoother silhouettes); hit-pixel steps
−11% near, −18.6% far; `GAME_AA = 1.0` ships. Its run hit the cap mid
vision-read; controller closed the notes. Next: task 7 (level shadows).
**2026-09-02 evening:** task 7 LANDED (twin level-only spotlight, 4-tap
PCF in the march, `setLevelShadow` seam, ships ON) and fixed a real
wgslFn-parser hazard (a colon pattern in a signature COMMENT parsed as a
phantom input, shifting every later binding by one — regression test runs
three's real parser). Its run hit the cap re-running the smoke; controller
read the pair: no acne on the near body, plausible door-frame shadow on
the far one. **Pillar-between-lamp-and-body eyeball is the owner's:**
`__sdfGame.setLevelShadow(true/false)`. Next: task 8 (upload measure).
**CHAIN COMPLETE (2026-09-02).** Task 8: per-body upload measured at
0.06 ms/frame for all ten bodies (3-5× under the threshold) — not worth
narrowing. Task 9 (second run, 90 m cap, targeted sweep rooms 3/4 ×3 with
`BENCH_PRELUDE` per lever): **every ship default survives its lever-off
re-run.** Finished chain r3 9.85 ms / r4 7.85 ms. Omega 0.6 costs +0.70/+1.48
(t2 confirmed); wound early-out ≈0 but free (t3 on); **depth gate ON costs
+4.8/+4.6 ms at 6% spread — stays OFF** (pass-structure overhead beats the
step saving at 3-4 bodies; the seam stays for higher counts); AA off saves
≤0.6 ms (t6 stays on); level shadows cost ≈0 r3 / ~0.7 r4 (t7 stays on);
hull exit bound "wins" −0.28 ms by DELETING 4 of 9 bodies (census) — never
ships. Occupancy vs task 0: total march steps −41% r3 / −38% r4, hit steps
−44%. Machine was NOT quiet (owner's Xcode/LearnCard builds mid-sweep);
every table carries its load and is judged by its own spread. Final branch
`dispatch/2026-09-01-sdf-render-perf-r2-task-9` = the whole chain; merge
order: chain → this plan branch → main, then gore, then elbow.
**2026-09-02 later:** task 8 done — measured, NOT worth it. Ten uploads =
p50 0.060 / max 0.090 ms/frame (room-4 idle, machine quiet), 3-5x under the
0.3 ms gate; instrumentation removed, texture stays 128 wide, no Step 3.
Chain's code tasks complete; **task 9** (bench sweep, unchained) waits for a
quiet machine and a manual trigger.
**2026-09-02 later:** task 9 DONE — BENCH_PRELUDE one-lever sweep on the
finished chain (r3/r4 x3). Every ship default survives its lever-off re-run;
depth gate re-decided OFF (on loses 4.6 ms at 6% spread); hull exit bound
dead by census (deletes 4 of 9 bodies in r4); occupancy: omega 1.0 + AA cut
mean march steps ~40% with coverage unchanged — the march is harvested,
remaining cost is hit-pixel fill. Machine never fully quiet (user Slack/Xcode
builds) — load recorded per row; CPU-saturating churn wrecks the bench,
IO-wait does not (see notes §task 9). Perf r2 COMPLETE; owner still owes the
task-7 pillar eyeball (`setLevelShadow`).
[plan](../../docs/superpowers/plans/2026-09-01-sdf-render-perf-round2.md) ·
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
[bleed note](../../docs/dev-notes/2026-08-31-bleeding-wounds/notes.md) ·
[c2 note](../../docs/dev-notes/2026-08-31-temporal-c2-spike/notes.md)

- `X5.melt` [x] **Melting death — flesh sags into goo, the skeleton falls out**
  — DONE (lab) 2026-09-03, all 7 dispatch tasks. Owner's brief with a Fallout 2
  reference clip: *"the whole flesh would distort and fall away like stretchy
  gooey dough and the bones fall out onto the ground in a fleshy puddle."*
  LAB ONLY — no weapon gate, no game wiring.
  **MECHANISM CHANGED from the earlier `c52b05b` attempt** (branch
  `claude/blob-side-grammar`), which displaced the field with ridged noise
  inside `mapBody` and was never visible at any amplitude. That commit's own
  finding says why — the march marches a SMOOTH field, so a displacement there
  warps the normal and never moves the surface — but the deeper problem is that
  noise makes a surface WOBBLE and cannot make a body shorter or wider, which
  is the entire signature of the reference. Superseded rather than debugged.
  **What ships instead:** CPU animation of the prim table. Sag is per-ENDPOINT
  so capsules stretch into strands; descent is paced by the melt front rising
  through the body so it reads as a candle rather than a lift; radius grows by
  `1/sqrt(yScale)` so volume goes sideways and the puddle is wider than the
  body was tall; `blendK` fuses by depth so only the pooled part goes blobby.
  Bone exposure then falls out of the existing hard `min` for free. Bones
  release as ELEVEN rigid groups (skull, cage, pelvis, eight long bones), not
  45 loose tubes.
  **SHIPPED MECHANISM (supersedes the `c52b05b` ridged-noise attempt, which
  warped a normal and never moved a surface):** pure CPU prim-table animation
  in `src/lab/sdf-zombie/melt.ts` — per-ENDPOINT sag on a melt front rising
  through the body (`softness 0.65`, `frontLead 1.75`), volume-conserving
  crush (`r ∝ 1/√yScale`), `blendK` fuse, clusters re-fit per frame; bones
  release as 11 rigid groups into the chunk stepper (`MELT_BONE_RELEASE_U
  0.4`) and land in the puddle; organs melt at half rate on a catch-up
  schedule; `meltCfg` ramps flesh to wet dark red at twice the sag rate.
  **TWO GATES, both PASSING.** `c52b05b` shipped green and tested and
  changed zero pixels. Gate A (in-suite AABB on the real `zombie.blob`):
  height 0.10x, width 1.60x, centroid 0.08x, 10/11 bone groups at rest in
  the puddle. Gate B (fixed-camera pixels via `npm run melt:shot`): height
  0.20x, width 2.32x, centroid 0.18x. The final tuning pass (task 7) barely
  moved the ratios — it killed a mid-ramp totem-pole and a floating skull
  that only the FRAMES showed.
  **TRAP:** `checkBoneContainment`'s 4 mm margin is violated on purpose —
  bones breaching flesh IS the effect. "Fixing" it deletes the feature.
  **Known and accepted:** the render loop still re-uploads the frozen
  puddle's rows per frame (state and geometry are frozen, uploads are not —
  noted honestly in the notes, elision is arena-work); a transient dark gap
  in the draining torso at t≈0.5 reads as a hole at a glance.
  [design](../../docs/superpowers/specs/2026-09-03-zombie-melt-design.md) ·
  [plan](../../docs/superpowers/plans/2026-09-03-zombie-melt.md) ·
  [notes](../../docs/dev-notes/2026-09-03-zombie-melt/notes.md)

- `X1.wound-r2` [~] **Bone through wounds + tissue-depth shading** — branch
  `claude/continue-previous-work-91055b`, **NOT merged**. 11 dispatch tasks,
  suite green (2620/162). Bone is `op:'bone'` in its own `body.bonePrims`
  array (NOT in `prims` — ~20 consumers filter on `op` and only 4 want bone),
  packed after the flesh, folded as a hard `min` after `applyWounds` gated on
  `nearWound` (an exact identity, since containment keeps bone inside flesh).
  Tissue ramp skin→fat→muscle→clot off `carved` (mapBody's previously unused
  `.w`), fibre × `wm`, bone stained at the cavity wall. Panel default-on.
  Bench **UNRESOLVED +0.0%**; halo PASS 12 angles.
  **Owner playtest 2026-09-02:** limb bone "looks quite good", a slug reaches
  bone in one shot (not the lab's 14 pellet blasts). Fibre **not noticeable**
  at 0.6 — try 1.4, else cut it. **Aesthetic blockers before merge:** the
  ribcage reads as "a big white central pillar" (it IS a slab — one `bar` on
  spine at `wide=1.45` plus per-prim derived twins; needs real rib prims and
  one-bone-per-RIG-BONE derivation instead of per-prim), and the skull is a
  small round ball with no jaw. The "organs/entrails exposed on body shots"
  ask is now its own feature — see `X1.entrails` (built on this branch).
  [spec](../../docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md) ·
  [plan](../../docs/superpowers/plans/2026-09-01-wound-pass-r2.md) ·
  [note](../../docs/dev-notes/2026-09-01-wound-r2/notes.md)

- `X1.entrails` [~] **Cavity viscera + gut ropes — BUILT, 8/8 dispatch tasks
  done on `dispatch/2026-09-02-entrails-task-8`, awaiting owner playtest**
  (2026-09-02, NOT merged). Torso slug/blast wounds open a CAVITY (per-wound
  flag set at stamp time, new wound row `ROW_WOUND_FLAGS`) that gates a
  torso-only viscera stop on the tissue ramp, and — rolled per hit
  (`spillChance` slug 0.35 / blast pinned 1.0, seeded `bleedRng`) — spawn a
  verlet gut rope (`entrails.ts`, 10 nodes / 0.55 m, one per body, pinned to
  the wound's emit point so it rides the gait) drawn as `kind: 'gut'`
  droplets through the existing goo metaball pass; second qualifying hit or
  collapse tears it free, it falls, settles and freezes. Panel knobs:
  viscera, cavity knee, gut thickness, spill chance. Gates 1–3 green
  (off-state parity, determinism, rope cap — all mutation-checked); captures:
  rope reads unmistakably at 2.4 m under the beam, tear+fall verified
  (found+fixed: torn-from-rest ropes froze mid-air — settle metric summed
  carried velocity only); **viscera tint itself NOT discernible at 1.8 m** on
  the zombie — the bone plug claims the crater floor just past the viscera
  knee, so look-strength (darker/shallower/deferred tint) is an owner call.
  Bench UNRESOLVED (+0.8%, spread 4–10%) — and goo's first-ever baseline
  exists: 10.21 ms p50, room-4 firefight. **Found+fixed en route: the slug
  spill roll was DEAD CODE** — `shouldSpill` keyed on `wound.type` but slugs
  stamp `type: 'blast'` (blast crater profile), so every torso slug spilled
  at the blast pin; now a stamp-time `Wound.spillCalibre` marker. RULE: never
  key slug-vs-blast behaviour on `wound.type`.
  [spec](../../docs/superpowers/specs/2026-09-02-entrails-design.md) ·
  [plan](../../docs/superpowers/plans/2026-09-02-entrails.md) (branch
  `claude/continue-previous-work-91055b`) ·
  [note](../../docs/dev-notes/2026-09-02-entrails/notes.md)

- `X1.organs` [~] **Organs in the cavity + springy guts — BUILT, 6/6 dispatch
  tasks done on `dispatch/2026-09-02-organs-task-6`, awaiting owner playtest**
  (2026-09-02, NOT merged). Organ prims (`W_ORGAN = 5`) ride the bone array —
  same `nearWound` gate, same containment validator, packed after the flesh —
  shaded pale salmon off the shared hitMat load, gated by `organAmp` (0 =
  shades as plain bone, one-knob off-state); 8 authored coil prims on the
  zombie's pelvis/spine, below the ribs. The spilled gut rope is now a SPRING
  (skip-one constraint, `coilTightness 0.55` / `springiness 0.35` — it can no
  longer hang as the owner's "rigid dark T") and takes the organ colour
  through goo's previously-unused density alpha (`gutFrac = a/r`, per-pixel,
  blood near a rope stays blood). Gates: off-state parity PASS (pack rows
  byte-identical except `primScale.w`; goo inert without gut droplets — all
  pinned by source tests, the goo one watched failing on the pre-organ build);
  containment PASS on all ten characters, margin untouched; counter
  **meanPerPayingRay +31.2%** (12-slug staged set, 3 alternating legs per
  build, organAmp-0 reads bit-identical counters — delta is the prims; below
  the ~45% guess because foldGroup culls organs off non-abdomen rays);
  combat-range captures: the rope recoils into a segmented glossy coil and
  the absorb-0 discriminator proves the pale-salmon mask end to end, **but at
  shipped absorb 1.6 the rope reads RED (the `trans` filter eats the tint —
  owner call: lower absorb or discount absorption by gut fraction)**, and the
  crater's own organ prims barely surface (bone plug claims the floor — same
  geometry-beats-tint finding as entrails; lever is placement, not colour).
  Chest still opens onto ribs. [spec](../../docs/superpowers/specs/2026-09-02-organs-and-springy-guts-design.md)
  · [plan](../../docs/superpowers/plans/2026-09-02-organs-and-springy-guts.md)
  (spec+plan on branch `claude/continue-previous-work-91055b`) ·
  [note](../../docs/dev-notes/2026-09-02-organs-guts/notes.md)

- `X1.zombie-behaviour` [ ] **Zombies never attack, and they clump/clip**
  (owner ask 2026-09-02, for a later session). Two halves: they should attack
  the player at some point, and collision needs work — they clump and clip
  into each other. The clipping is not only feel: interpenetrating bodies are
  a documented render failure mode (`march.wgsl.ts:1703`, "the
  interpenetrating-crowd holes") and are the owner's leading hypothesis for
  the intermittent wound-flip glitch (`glitchwound.mov`, not reproducible on
  demand — PARKED, retest after collision lands). Reuse the existing pure
  modules — `wander.ts`, `gait.ts`, `motion.ts`, `ik.ts`, `stagger.ts`,
  `collapse.ts` — this is a retarget, not a new rig.


- `P1.blob-frame-face` [x] **The two exposed placement defects FIXED, plan
  judged** — branch `dispatch/framefix-task-3`, 2185 -> **2188** green (112
  files), tsc clean. Task 1: bands past the fit's own 45 deg report bar are
  banded along the CHAIN's direction through the cloud's centroid
  (`cloudBandLine`) - stations land in the statement frame (no
  bandRange transfer), radii stay cloud-parallel (no sqrt(r2+d2) inflation,
  no offset= double-count); at-or-under-bar bones band bit-identically
  (pinned). Mechanism correction on record: at ~90 deg the cloud AXIS
  projects to a point, so the whole flesh footprint rode the radius - the
  prosthetic's 9 bands (4 from>to) collapsed to [0.196, 0.233]. Task 2
  (dispatch/framefix-task-2, 5f34bb0): the face block rides headRise/headLead
  measured against a real build; horn-inflated-headRadius hypothesis REFUTED
  (neck-carry angle, both characters). **Task 3 re-draft: prosthetic shin.r
  5 bands, 0 inverted, full span (was 4 inverted in a 0.04 sliver); depth
  side mean 142 -> 95.4 mm (unflagged, beats round 1's flagged 193.7), front
  88 -> 70.3 mm (still pose-flagged); chain properties hold at the artifact's
  formatting noise.** The eye: the grey ball at one knee is GONE - the leg
  reads as a connected limb with grey on its upper half; round 1 still owns
  the plate read (sub-band scale, fenced off). Third honest NO on likeness
  (T-pose + identity), but the plan's owed deliverable - a leg, not a ball -
  is delivered. Face band still worst side band (-272.7 mm): it measures
  T-pose ARM mass (Task 2 measured -4 mm of it on genuine face pixels); the
  Done-when gate is miscalibrated until the reference is posed. NOTE: Task 1
  was recorded done by dispatch with ZERO commits - implemented here;
  reports are not commits. Mutations 4/4 killed. Full verdict + numbers +
  matrix: [notes](../../docs/dev-notes/2026-09-02-blobforge-depth/notes.md)


- `P1.chain-drift` [x] **`blob:draft` chain closes — ALL 4 TASKS DONE; verdict on the re-draft: still NO vs hand-authoring, for NEW reasons** — plan
  [2026-09-02-blob-draft-chain-drift](../../docs/superpowers/plans/2026-09-02-blob-draft-chain-drift.md),
  suite 2170 -> **2182** green (112 files), tsc clean. len=/dir= now come
  from the RIG chain (joint-to-joint × one global scale; the >45° cloud
  steering demoted to a REPORTED check — schoolgirl builds connected without
  it), a branch rule extends a mapped bone up to its .blob parent's tail
  joint so the rig TREE chains into .blob's chain (the Hips stubs were the
  residual +0.25 m sole error), and offsets carry the surface. Task 3 made
  the three acceptance properties TESTS (soles on floor; height line; every
  mapped len= == rig × scale — end to end on a synthetic rig through the
  real pipeline) and the CLI prints the numbers on stderr + in the header.
  The height property then caught the CROWN overshoot: +0.1006 m on a 1.9 m
  fixture — the scale came from the VERTEX extent, but the built surface
  adds the end bands' radii (grounding absorbed the sole side, so it all
  showed at the crown; top prim = the skull band ball, radius 0.1199).
  Fix: ONE corrective ratio, exact because every fit is linear in the scale
  — `calibrated()` re-fits at g · height / builtExtent. Measured after:
  minotaur +0.02%, schoolgirl +0.01%, minotaur@--height 1.9 −0.01%; soles
  0.0000; worst len= dev ≤ 5e-5 m (print rounding). Also fixed en route:
  the skull statement now names its true source (axisFromParent was set on
  the assembler's Built record but dropped in assembly, so the fit comment
  claimed a principal-axis fit).
  **Task 4 (2026-09-03): both characters re-drafted and judged.** Minotaur
  soles −0.0001 m / +0.02% / len= dev 4e-5; schoolgirl 0.0000 / +0.01% /
  3e-5, and she builds connected with NO cloud steering (dress axes 80-87°
  reported, not obeyed). Budget 72/80; prosthetic unmirrored (asym 0.627).
  Depth: side mean 340 -> 142 mm, front 164 -> 88 mm, the +340 mm torso
  drum bulge GONE. **Verdict: still round 1 for this character — but the
  old failures (0.3 m float, 8% tall) no longer exist.** New defects, both
  different: `bandRange`'s frame transfer collapses an oblique cloud's
  bands (prosthetic shin.r, 76° off-axis -> 0.19-0.23 slivers, some
  from>to, mid-shin gap); the TS-authored face block is the worst
  side-view band (−367 mm) now the drum is gone. Also fixed: the emitted
  header still claimed the pre-fix source story. Full verdict + numbers:
  [notes](../../docs/dev-notes/2026-09-02-blobforge-depth/notes.md). Next for the
  toolchain, unchanged: LBS-pose the reference, `--apply`, and now the two
  new placement defects.

- `P1.blobforge-2026-09` [x] **Blobforge session: `blob:depth` ships, `blob:draft`
  is parked** — merged to main. Suite **2137** green (109 files), tsc clean.
  **SHIPPED:** `blob:depth` (front/side depth-map diff — the instrument that
  sees INSIDE the outline); `side=l|r` single-sided limb prims; the `box`
  primitive; `face.ts` `headRise`/`headLead` (defaults 0, existing characters
  untouched).
  **`blob:depth` earned it.** On the rejected round-1 minotaur its worst three
  side bands were all TORSO lines (340/312/253 mm) against a schoolgirl control
  of 56.5 mm — while `blob:measure` blamed the ARMS and `blob:rings` reported a
  size, not a shape. That blindness is structural: a radial average and a
  silhouette both score a smooth drum and a muscled torso identically.
  **`blob:draft` PARKED** after three fix rounds, code removed from main (lives
  at 8d75076). Each round fixed a real defect and exposed the next flaw in the
  spec: chain drift -> frame transfer -> unbounded prim aspect. The owner
  rejected it in the lab as worse-FORMED than the hand-authored r1 — 65:1 prim
  aspect against a shipped norm of 1.8, and half bonewalker's blend.
  **OPEN, and worth doing:** nothing in the toolchain measures **prim
  degeneracy** — `validateBody` returned 0 errors and `blob:render-check`
  exited 0 on a body full of 65:1 fins. Also open: `parseBlob` accepts
  arbitrary garbage as leading trivia; and the vault roadmap's pose-the-
  reference and `--apply` items.
  [notes](../../docs/dev-notes/2026-09-02-blobforge-depth/notes.md)

- `M?.minotaur` [x] **Minotaur — DONE ENOUGH, not a great character.** Owner
  2026-09-03: *"not particularly good result from this. but i guess that is
  okay, part of the process."* It is a working, correctly formed, correctly
  proportioned mid-tier enemy and it does NOT need more rounds. What it never
  got was muscle definition, and that is now known to be an ENGINE limit
  rather than an authoring failure (`X4`, `X5`). Closed deliberately.
  Original entry follows.

- `M?.minotaur-log` [x] **Author the minotaur from r1, by hand** — `minotaur.blob`
  is r1's content. **Round 4 done** (`6190370`): horns raised from ear height
  (y 1.702, 34% up the cranium) to the crown (roots 1.873, tips 2.021, clearing
  the cranium's own 1.959 — they had been dying 0.11 BELOW it); flesh
  retargeted from the reference texture's measured brown to the zombie's
  `henenlotter-latex` pink, which also revealed abs and pecs the brown was
  hiding; plate gloss 0.70 → 0.90-0.95 with the albedo brought down ~35%.
  Owner: much better, but **the plates still don't read metallic and the
  pitting hurts** → `X2.hard-surface-material`.
  **Round 5 — cross-section** (`feb53d7`): the relief map showed every height
  band as the same arch, proud at the centreline and behind at the flanks —
  a dome where the mesh is a broad slab. chest `wide` 1.40→1.700, waist `deep`
  1.35→1.210 (an INVERTED taper), traps `offset` x 0.052→0.162 (they had
  overlapped into one mass filling the throat, the worst cell on the map).
  21.6mm → 15.3mm.
  **Round 6 — muscle** (`ebf23a8`, `89e102e`): pec pair, sternum groove,
  lower-pec shelf, ab bar, linea alba, cross-lines, obliques. 15.3mm →
  12.8mm and **rejected on sight** — owner: *"i dont see any muscles just
  the mass and the normal bumpy texture."* Diagnosed rather than re-tuned;
  see `X4.body-sheet`. The masses were kept (a real improvement to the form);
  the creases stay narrow rather than wide, because 12.3mm was available with
  200mm-wide "lines" and that score comes from shaving proud material.
  Still owed: the prosthetic must FUSE at the hip and read as a limb
  (**call `daylightOf` — it exists and no round has called it**; ~2% of
  standing height is where separation reads), torso muscle relief, and a face
  re-bake + re-solve (owner wants sharp teeth, cybernetic plating, wires and
  glowing red eyes — the last is blocked on `glow=`, see below).
  **`blob:depth` in the loop.** [ref](../../docs/dev-notes/refs/minotaur-mesh/minotaur.glb)

- `X2.hard-surface-material` [~] **Teach the SHADER about hard surfaces** —
  four dispatch tasks QUEUED (`status: pending`, so task 1 has a Run button) at
  `~/.claude/dispatch/plans/2026-09-03-hardsurf-task-{1..4}.md`, serial chain,
  `glm-5.3-flash` on `pi`, base `claude/blob-side-grammar`. **Task 1 DONE
  2026-09-03** (branch `dispatch/hardsurf-task-1`, f2368cb): `gloss` now scales
  BOTH flesh-noise paths by `(1 - gloss)` at the point of application —
  micro-detail folded into its amplitude guard (`detailAmp`, so full-gloss
  prims skip the six fbm lookups outright) and `marchCfg.z` into calcNormal's
  noiseAmp; the `ROW_PRIM_COLOR` read hoisted above calcNormal (ONE load, not
  two) with the albedo OVERWRITE kept after the face pass. 2271 tests green
  (4 new, all mutation-verified); render A/B: cyclops lens pitting visibly
  gone (improved), minotaur plates smoother, mouse is a NO-OP (its preset has
  both noise amps at 0 — nothing to suppress), flesh byte-identical.
  **Tasks 2-4 DONE 2026-09-03 on the dispatch chain** (task 2 `9a39bc2`+`d0b584a`
  metal: diffuse to a rendered 0.45 floor, spec tinted by the prim's albedo
  renormalised to iron F0 0.56 — raw-albedo tint went BLACK first try; task 3
  `b85e792`+`25f5577`+`ea96278` glow= in primClip.w on both pack branches, with
  the minotaur's glowing eyes as the acceptance case; task 4 `211e454` verdict).
  **Task 4 verdict
  (docs/dev-notes/2026-09-03-hard-surface-material/notes.md): plates GONE
  pitted and GONE chrome-plastic blowout, but they read as BLACKENED metal, not
  milled steel — root cause is the round-4 darkened plate ALBEDO, not the
  shader (the 0.45 diffuse floor is as low as stays readable); owner call:
  accept blackened-iron or raise the five plate colours.** Glow eyes work —
  cybernetic head unblocked. Nothing else got worse: cyclops lens cleaner,
  mouse and schoolgirl-alt frame-identical (72 frames read), 2301/118 green,
  render-check 0 holes, budgets 61/128 prims and **6/6 clusters — at the hard
  ceiling, no seventh added**. Watch: the plan's "48/128" was stale; and the
  base `claude/blob-side-grammar` boots the lab with a meltCfg TSL error
  (fixed by ea96278) — before-shots in any A/B off it FAIL the shot gate while
  rendering fine.
  `box` taught the FIELD about hard surfaces; nothing taught the shader, so a
  machined plate is textured and wobbled as though it were skin.
  (A) `gloss` suppresses `surfaceNoiseAmp`/`silhouetteNoiseAmp` — both are
  body-wide and applied ~260 lines before the shader knows a prim is painted;
  (B) a `metal` modifier (`prof` bit 4) — there is NO metalness in the shader
  at all, so a painted prim gets full diffuse + untinted white highlight, i.e.
  polished plastic, which is why raising gloss produced shinier plastic;
  (C) per-prim `glow=0..1` — nothing on a character can glow today, since
  `faceGlow` is × `(1 - decal)` at `march.wgsl.ts:2179` and the minotaur uses
  `decal 1`. **(C) is what blocks the cybernetic head.**
  Loudest trap, in the plan: `pack.ts`'s cluster/group `shaped` flags gate
  whether the shader reads `ROW_PRIM_SHAPE` at all, so a metal-ONLY prim would
  have its bit silently dropped — the exact bug found in those same two lines
  this session (omitted `p.shell`, schoolgirl-alt's cape a solid blob for
  weeks).
  [design](../../docs/superpowers/specs/2026-09-03-hard-surface-material-design.md) · [plan](../../docs/superpowers/plans/2026-09-03-hard-surface-material.md)

- `X4.body-sheet` [~] **Paint muscle onto the field** — four dispatch tasks
  QUEUED at `~/.claude/dispatch/plans/2026-09-03-bodysheet-task-{1..4}.md`
  (priority 2, behind hardsurf); **task 1 was running at session end**.
  Three rounds of measured, rejected torso work converge on one conclusion:
  the DISPLACEMENT mechanism is right and only its CONTENT is wrong.
  Geometry cannot carry muscle (AO is a single tap at 0.06m, self-shadowing
  was cut, so authored grooves scored 12.8mm and were invisible at every
  yaw); procedural structure cannot either (ridged/anisotropic noise makes
  convincing TEXTURE, but creases land in RANDOM places and a pec split has
  to be where the pec split is); but displacement DOES read. So: an authored
  greyscale plate, projected, displacing the field.
  **The plate may not need painting** — `blob:relief` already computes
  reference-minus-body front-wall depth per cell, which IS a displacement
  map; `--emit-map` is task 1.
  **CORRECTION carried into this from `X5`:** it must go in the SHELL block,
  not `mapBody` — a sheet in `mapBody` alone is a normal map with extra
  steps. The spec predates that finding; fix it before task 3.
  [design](../../docs/superpowers/specs/2026-09-03-body-sheet-design.md) · [plan](../../docs/superpowers/plans/2026-09-03-body-sheet.md) · [evidence](../../docs/dev-notes/2026-09-03-torso-relief/notes.md)

- `M?.mancubus` [ ] **NEXT CHARACTER — start fresh here.** Owner is shifting
  from the minotaur to a **mancubus-style** enemy (Doom): bloated, sagging,
  huge low belly, narrow shoulders, arm cannons.
  **Why this fits, in the engine's own terms** — every failure mode this
  toolchain showed on the minotaur is a mancubus asset:
  * smooth-min blended masses want to be a centre-heavy dome. That IS a
    mancubus body; the minotaur's cross-section pass spent itself fighting it
  * `silhouetteNoiseAmp` lumps are the ONE thing that reads clearly on any
    character (real geometry, breaks the silhouette). They failed as muscle
    and are exactly right as sagging, uneven flesh
  * the mottle competed with muscle relief; on a bloated thing it reads as hide
  * **no crisp relief needed** — the wall of `X4`/`X5` (creases cannot read
    without a cavity-AO term) simply does not apply to a body with no muscle
    definition to show
  * the arm cannons are hard-surface: `box` + `metal` + `glow`, all three
    shipped this session, `glow` with a dark A/B behind it
  **Carry over:** the round-5 cross-section method (fit against
  `blob:relief`, bounded by judgement, then LOOK). It worked — 21.6 → 15.3mm
  and the render agreed — and a mancubus silhouette is the easy direction for
  it, unlike the V-taper the engine resisted.
  **RUN IT DIFFERENTLY, and this is the lesson worth more than the tooling:**
  this session went to instruments and engine work over and over instead of
  authoring, and THREE separate times a score improved while the render did
  not. Lead with frames. Use measurement only to catch gross proportion
  errors, never as the thing being optimised. Accept cruder measurement and
  spend the hours on shape.
  Needs: a reference mesh in `docs/dev-notes/refs/mancubus-mesh/`.

- `X7.origin-merge` [x] **DONE (`aec25e0`)** — origin/main merged; the melt
  spike from this branch removed in favour of the shipped zombie melt.
  Local main is now **87 ahead, 0 behind** origin and safe to push.
  The lesson worth keeping: **both sides had independently named a uniform
  `meltCfg` and a setter `setMelt`, so git merged the two shader files with
  NO conflict marker** and produced two params, two uniforms, two bindings —
  and a `noiseCfg` line that fed the zombie melt's PROGRESS into the spike's
  displacement AMPLITUDE. A clean merge output means nothing when two
  branches name the same thing differently; check for duplicates by hand.
  Suite 3091 green / 186 files.

- `X8.collapse-noiseCfg` [ ] **Tidy-up: collapse `noiseCfg` back to `f32`** —
  it is a vec4 whose y/z/w are literal zeros since `aec25e0`. It survives as
  a vec4 only because hard-surface's gloss/metal kill is written against it
  (`vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0)`).
  ~15 shader edits plus the exact-string test pins in `march.wgsl.test.ts`.
  Not urgent, but three permanently-dead lanes on a shared struct is exactly
  how `primClip.w`'s "spare" comment went stale and got packed over.

- `X6b.bodysheet-merge` [ ] **Merge `dispatch/bodysheet-task-4` — a real 3-way
  integration, not a resolve.** The hardsurf chain and main are IN main as of
  `bb6a55b`; the body sheet is the one thing left out, deliberately. It
  conflicts with hardsurf on the SAME `calcNormal` call site, and both edits
  are needed:
  * hardsurf wraps the amp — `vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), noiseCfg.y, noiseCfg.z, noiseCfg.w)`
  * bodysheet adds three params — `..., noiseShift, bodyTex, sheetCfg, sheetProj, volumeTex, ...`
  The merged form needs both, plus the same reconciliation in
  `march.wgsl.test.ts` (which pins the call site as an exact string) and in
  `zombie-gpu.ts`. Budget real time; the exact-string test pins will catch a
  sloppy resolve, which is the good news.
  **Worth remembering it is the LOWEST-value of the three** — live and
  provably in the right place, but faint, and blocked behind the gradient
  budget until that is priced.

- `X6.merge-dispatch` [x] **DONE — hardsurf chain and main merged — DO THIS FIRST NEXT
  SESSION** — both branched off `121ef37` and both are LINEAR, so two merges
  take everything: `dispatch/bodysheet-task-4` (14 commits, contains tasks
  1-4) and `dispatch/hardsurf-task-4` (11+ and still running at session end).
  **They will conflict.** They overlap on ten files including
  `march.wgsl.ts`, `pack.ts`, `types.ts`, `blob-parse.ts` and
  `minotaur.blob`; both added a `prof` bit and both touched the noise
  config, which the melt work also widened to `noiseCfg: vec4`. Merge one,
  run the suite, then the other — the suite is the gate, not the diff.
  **Both returned honest verdicts:**
  `glow=` WORKS — a dark A/B with two red glowing eyes and a `glow=0.0`
  control where they vanish (`/tmp/minotaur-dark-{glow,noglow}-crop.png`).
  The BODY SHEET is live but FAINT: the diff heatmap shows "a vertical
  sternum-groove band down the centre-chest, window edges clean, head and
  arms untouched — the mechanism puts structure exactly where anatomy is,
  but faintly". And when it tried the design's own amp 0.018 to give the
  effect its best chance, **the budget guard refused the capture**
  (`displacement product 0.419 violates budget 0.200`).
  **That is the same wall `X5` hit**, and it is the finding to carry: the
  amplitude that READS needs more gradient than the budget allows, so it has
  to be BOUGHT with `stepMultiplier` rather than tuned around. Both are
  transient effects, so that is affordable — but nobody has priced it yet,
  and that price is now the real lever for both.

- `X5.melt` [~] **Melting-flesh effect — PICK UP HERE NEXT SESSION** — owner's
  brief: *"when shot the whole zombie melts, the flesh basically turns into a
  pile of goo and bones."* Plumbing is IN and tested (`c52b05b`, suite 2286
  green) and **NOT visible yet — do not assume it works.**
  Shipped so far: a `meltCfg` uniform; `mapBody`'s `noiseAmp: f32` widened to
  a `noiseCfg: vec4` (silhouette amp, melt amp, melt freq, melt time) because
  the two are one mechanism differing in content; a ridged displacement term
  at both the normal site and the shell site; `setMelt` lowering
  `stepMultiplier` 0.6→0.28 as amplitude rises; lab keys `m` / `M`; console
  seams `__sdfLab.melt / meltOff / setMeltTuning / meltDirect / meltState`;
  and `scripts/melt-capture.mjs` for frame-by-frame capture.
  **State:** at amplitude 0.20 — far past sane — captured frames are
  UNCHANGED. The uniform is confirmed set JS-side (`meltCfg` reads
  `[0.2,3,0,0]`, `marchCfg.y` drops to 0.28), so the break is between the
  uniform and the shader.
  **THE NEXT DIAGNOSTIC, not yet run — do this first, before any tuning:**
  turn the shell on (`__sdfLab.setShellDisplace(true)`) and capture with melt
  at ZERO. If the silhouette noise visibly changes the body, the shell path
  works and the melt branch inside it is at fault; if it does not, the shell
  path is inert in this configuration and that is the bug. One test separates
  the two.
  **Why it matters beyond the effect:** finding this corrected two claims made
  earlier the same day — the "Lipschitz overshoot" diagnosis (the march never
  saw those spikes' displacement; the artefacts were `calcNormal`'s
  tetrahedron differences) and "gain × maxFreq × amp is the march's budget"
  (the march marches the SMOOTH field and pays nothing). Both are corrected in
  the note. Melt remains a transient EFFECT, not a look: it needs gradient the
  budget does not cover, bought with `stepMultiplier`.
  [notes](../../docs/dev-notes/2026-09-03-torso-relief/notes.md)

- `X3.metal-damage` [ ] **Wounds and gibs on metal** — the OTHER half of the
  owner's "hard surface parts shouldn't deform like the flesh". Shooting the
  prosthetic today opens a wet red crater in it and severing tears it like
  meat. Lives in `damage.ts` / `gib-chunks.ts` / `humanoid-sever.ts` rather
  than in shading, so it is deliberately NOT in `X2`. Not spec'd.

- `X1.box-prim` [~] **Hard surface in `.blob` — the `box` primitive** — branch
  `claude/enemy-characters-blobforge-b45932`, **NOT merged**. Every primitive was
  a capsule or round cone, so the format could not make a FLAT FACE; the next
  characters are biomechanical (a cannon arm, plated greaves, a tripod chassis).
  Adds one bare word `box` on `blob`/`bar` — a modifier, not a new kind, so it
  inherits mirror/offset/core/paint/chamfer for free and will compose with
  `carve` once that takes a limb word. Half-extents are `r x wide/tall/deep`,
  the SAME semi-axes a capsule gets, which is what keeps `blob:rings` working on
  a box with no change to the fitter. `round=` is a FRACTION of `r` (0..1,
  inset), not metres — the field evaluates in the scale-divided frame where an
  absolute length distorts anisotropically.
  **ALL 9 TASKS DONE**, suite 1930 -> 1982 green (104 files), tsc clean.
  **Proven end to end:** `blob:render-check` exit 0 on a box fixture, and the
  frames show flat faces with a crisp vertical edge at a 3/4 yaw — a capsule
  cannot make that. Evidence in
  [docs/dev-notes/2026-09-02-box-primitive/](../../docs/dev-notes/2026-09-02-box-primitive/).
  **Next: the minotaur.** Its dispatch task is written and QUEUED at
  `~/.claude/dispatch/plans/2026-09-02-minotaur-character.md` (`glm-5.3-flash`,
  base_branch = this branch) — waiting on a dispatch-ui slot, two tasks running
  as of 2026-09-02. In-repo copy:
  [plan](../../docs/superpowers/plans/2026-09-02-minotaur-character.md).
  **Watch for:** `blob:rings` is paint-blind and WILL ask for the prosthetic
  plates to shrink — overrule it there, as bonewalker's spine ridge taught.
  **Two Minor follow-ups from the final review, neither blocking:**
  (a) no test covers `box` composed with `carve`/`groove` — reading the code it
  should work (the cluster `shaped` flag accounts for `p.box`, `sdPrim`'s branch
  is generic) but that is inferred, not verified; low exposure while `carve` is
  head-only, worth a test before anyone tries a rectangular vent slot.
  (b) `hands.ts` skips `Math.max(radius, radiusB)` on the grounds that no
  hand-authoring file sets `radiusB` — true today, rots silently if a tapered
  hand prop ever lands.
  **Two findings worth knowing independently of this work:**
  (1) the outer-bound survey went 4 -> 8 sites (`boxReach`); the plan claimed
  four, and the two hardest to find RECOMPUTE a bound instead of consuming one
  — `rig-bind.ts`'s `applyRig` is the per-frame POSED-body path for every rigged
  character. (2) **a LIVE pre-existing bug was fixed**: `pack.ts`'s two `shaped`
  bitflag checks disagreed — the group-level one omitted `p.shell`, and the
  additive fold reads ONLY that flag, so `schoolgirl-alt`'s cape has been
  drawing as a SOLID BLOB instead of a thin sheet since `9a85fe7`. **Its
  appearance changes as a result — that is the fix, not a regression, and it
  wants an owner look.**
  [spec](../../docs/superpowers/specs/2026-09-02-blob-hard-surface-box-design.md) ·
  [plan](../../docs/superpowers/plans/2026-09-02-blob-hard-surface-box.md)

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
  [spec](../../docs/superpowers/specs/2026-08-31-blood-viscosity-design.md) ·
  [plan](../../docs/superpowers/plans/2026-08-31-blood-viscosity.md)

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
[note](../../docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)

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
[note](../../docs/dev-notes/2026-08-31-game-perf-baseline/notes.md) ·
[spike](../../docs/dev-notes/2026-08-25-shell-march-spike.md)

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
[spec](../../docs/superpowers/specs/2026-08-31-sdf-crowd-perf-investigation-design.md) ·
[plan](../../docs/superpowers/plans/2026-08-31-game-perf-baseline.md) ·
[note](../../docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)

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

**`2026-08-25-tile-all-bodies` DELETED (2026-09-04) — replaced by
`2026-09-04-merged-march`, PARKED.** crowd-alive shipped (merged to main); the
tile follow-up never ran and its whole premise expired. Four reasons: the owner
restated the real problem as one body **filling the screen**, not a crowd, and
named tile binning "measured nil — not the cost"; the perf r2 chain harvested
~40% of march steps and landed on **hit-pixel fill** as the remainder, which
tiles (a per-step prim-fold cut) do not touch; r2 task 8 killed the per-body-CPU
worry (0.06 ms/frame for ten bodies); and its `base_branch: dispatch/crowd-alive`
no longer exists. Its cost table (58 ms @15 bodies, ~21 ms non-pixel floor)
predates the chain and is void. **The one surviving idea** is a single **merged
march pass** over all bodies (prim data reached via the entry stream's
`bodyIndex`, a field designed for this and never exercised) — the only form of
the overlap fix r2 did *not* test, and precisely the form that removes the
per-draw pass structure that made task 5b's exact-and-biting depth gate cost
+4.6 ms at 3–4 bodies. Brief at `~/.claude/dispatch/plans/2026-09-04-merged-march.md`,
`status: queued`, priority 4: **do not trigger** until the close-up work is done
and only if its Phase 0 shows per-pass overhead growing with body count.

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
   [spec](../../docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md) ·
   [plan](../../docs/superpowers/plans/2026-09-01-dungeon-relighting.md)

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
  [frozen-capture-verdict.md](../../docs/dev-notes/2026-09-01-dungeon-relight/frozen-capture-verdict.md).
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

- `L2.followup-wounds` [~] **Wound pass round 2 — IMPLEMENTED, awaiting owner
  pass (branch `dispatch/2026-09-01-wound-r2-task-11`, tasks 1-11 of 11,
  2026-09-01).** Deep wounds now expose anatomically-placed bone that STOPS the
  carve: bone is an ordinary prim (`op:'bone'` → `primScale.w 4`) in its own
  `body.bonePrims` array, auto-derived at 0.38× flesh radius + authored
  overrides (zombie cranium dome + ribcage plate; goblin skull + chest), folded
  as a hard `min` AFTER `applyWounds` gated on `nearWound` — exact because
  bones are containment-filtered strictly inside flesh. Wound interiors shade
  by depth under the original skin — `mapBody`'s spare `.w` slot carries the
  pre-wound field; ramp skin→fat→muscle/clot + torn fibre ride `surfCfg3`
  (each key bit-gated at 0); bone-ness rides `bestIdx` with a wall stain.
  `bones` block in `.blob`; tuning panel on the game page
  (`__sdfGame.woundPanel(true)`); amplitude guards make every feature a one-key
  kill. Bench (room-4 firefight, 3 legs alternating): bone fold **+0.0% —
  UNRESOLVED under the 4% within-run spread**. Gates: off-state parity PASS
  (structurally — this harness has NO pixel floor: same-build runs differ
  52-82k px, so gates were field assertions + described captures, per plan
  amendment); undamaged identity PASS (packed flesh rows bit-identical
  ±derived bone, mutation-verified); halo check PASS (12 angles, no annuli, no
  camera-sweeping crescents); dungeon PASS (slug crater reads under the beam at
  2.6 m; ramp/bone detail does not resolve at that range — owner call).
  Captures catalogue + traps (stale task-8 vite squatting the default capture
  ports; plan's Step-2 probe unwritable as printed — lab page has no
  `__sdfGame`; stump rod is a PRE-EXISTING main artifact only recoloured by
  the ramp): [dev note](../../docs/dev-notes/2026-09-01-wound-r2/notes.md).
  Spec + plan live on branch `claude/continue-previous-work-91055b`, not main.
  **Owner owes three calls:** bone too readily on skinny limbs (not stageable
  from the lab — torso-only stamper); stump protrusion feature-or-bug
  (pre-existing); fibre anchor stretch keep/kill (unevidenced, rest-pose
  captures cannot show it).


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
   - Spec → [docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md](../../docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md)
   - **Plan series (4 + 3.5):** [1. foundation+harness](../../docs/superpowers/plans/2026-06-18-blud-deterministic-core-foundation.md) ✅ **DONE** · [2. player on sim](../../docs/superpowers/plans/2026-06-18-blud-deterministic-core-player.md) ✅ **DONE** (playtest-confirmed) · [3. dynamite on sim](../../docs/superpowers/plans/2026-06-18-blud-deterministic-core-dynamite.md) ✅ **DONE** (generic `kThing` mover [MoveThing port: gravity/floor+wall bounce], dynamite throw/fuse/impact-detonation as a sim kThing, explosion `SimEvent` → legacy AOE/VFX, retired Rapier projectile; 505 tests; **playtest-confirmed** after 4 fixes: mirrored-X throw direction, in-hand cook fuse 1.5→2.0s, right-hand throw origin) · 3.5 kickable head ✅ **DONE** (playtest-confirmed) — severed head is a deterministic sim kThing on SimState (gravity/floor+wall bounce, age-despawn 30 s), player punts it by walking into it (kick along facing + anti-pin cooldown), cosmetic billboard from sim.headRenders(); both head sources (normal popHead + explosion-launch) rerouted via chunks.spawnHeadHook. Playtest fixes (NotBlood MoveThing/actKickObject): floor friction (no infinite glide), soccer-ball kick launch, billboard floor-clip offset, Blood elastic 40960 · 4. shotgun cultist on sim ✅ **DONE** (playtest-confirmed) — full `aicult.cpp` ground AI on `SimState.dudes` (Idle/Chase/Dodge/Goto/Search/SThrow/SFire/Recoil), deterministic segment-vs-AABB LOS, sim-authoritative player damage; folds `F2.cultist.dodge/search/los`. Playtest changes: 8-pellet shotgun reworked from hitscan → **travelling sim pellets** (NotBlood nHitscanProjectiles; deterministic `PelletState`, dodgeable, 35 m/s) + debug **god mode** (G key). Open visual polish: `F2.cultist.pellet-visual`.
   - ~~Deferred: pellet-vs-player damage + deterministic `applyExplosionToPlayer`/`player.hp`~~ — **landed in plan 4** (sim-authoritative hp + legacy AOE player-exclusion). Open: `F2.cultist.sfx`/`F2.cultist.gibs`.
   - Context: dualmem `port-vs-recreate` + Obsidian `Claude Notes/Blud/2026-06-10-port-vs-recreate-thinking.md` + `2026-06-18-deterministic-120tic-core-design.md`.
3. **M5 bestiary + Phase 1 gate** — 30-min arena = fun playtest before any level code.

Key reference docs (open these before touching their area):
- Design spec — [docs/superpowers/specs/2026-04-20-blud-design.md](../../docs/superpowers/specs/2026-04-20-blud-design.md)
- NotBlood source map — [docs/dev-notes/2026-04-22-notblood-source-reference.md](../../docs/dev-notes/2026-04-22-notblood-source-reference.md)
- Animation system — [docs/dev-notes/2026-04-21-animation-system.md](../../docs/dev-notes/2026-04-21-animation-system.md)

---
