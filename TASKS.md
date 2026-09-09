# Blud — Task Tracker

> **Session start: read this file first.** It's the cross-cutting status board.
> Per-milestone step-by-step tasks live in `docs/superpowers/plans/`.
> This file is **coarse-grained state only** — keep rows to ≤2 lines and link out for detail.

## Bench harness — no more silent hangs — 2026-09-09

- [x] `scripts/sdf-game-bench.mjs` can no longer hang forever. `send()` had no
  timeout and no reject path and nothing rejected `pending` on socket death, so a
  lost CDP response wedged the run (observed: 141/204 legs, then 19+ min of silence).
  Every wait is now bounded and every failure names the leg/room/rep, phase, CDP
  method and console tail.
- [x] One wedged leg no longer kills the matrix: a per-leg watchdog abandons it and
  the run continues; `BENCH_MAX_CONSEC_FAILS` (3) stops a dead browser. Reports gain
  an INCOMPLETE banner and the exit code is non-zero on any partial run.
- [x] Completed legs land in `$BENCH_OUT/bench-progress.jsonl` as they finish, so an
  aborted run keeps what it measured — `bench.json`/`bench.md`/`passes.md` are still
  end-of-run only. Knobs: `BENCH_SEND_TIMEOUT_MS`, `BENCH_LEG_TIMEOUT_MS`.

## Shot visuals — tracer rounds — 2026-09-09

- [x] Projectiles no longer draw as shaded yellow balls. Each carries an additive
  velocity-aligned STREAK plus a view-facing EMBER (`webgpu/tracer-sprite.ts`), with a
  0.30-0.95 m near-fade so nothing blobs at the muzzle. Player and soldier pellets share it.
- [!] A velocity-aligned streak FORESHORTENS to a sliver on your own forward shots —
  measured, and why the ember exists. Owner may still want the player's streak dropped
  (one branch in `placeTracer`); enemy fire is the case the streak actually pays off in.
- [-] `scripts/sdf-game-tracer-look.sh` is a LOOK capture, not a gate. Its header carries
  the three rigging traps (LAB_TMP outside the vite root, `?frozen`, room1's only clear lane).

## Skeleton migration wrap-up — 2026-09-08

- [x] Mesh actor skeletons accepted and merged into main; now the forward default, including production.
- [-] Further aesthetic tuning paused; cavity brightness remains open. [Handoff](docs/dev-notes/2026-09-07-skeleton-comparison/wrap-up.md).

## Roster — bloatmaw — 2026-09-09

- [x] `bloatmaw` merged (`5aae04b0`): a floating flesh ball, mostly mouth, with
  tiny shackled arms. Third prose-brief character; the roster's FIRST legless one.
- [x] Floating solved deliberately: `stance` OMITTED (grammar knows only
  humanoid/digitigrade) so `checkStance` is off by choice; hover gap 0.302 m named;
  a vestigial spine chain keeps the gait wiring happy — `gait.ts` `leg()` returns
  zero offsets for a missing chain, so the shamble degrades to root sway.
- [ ] Brow still reads as a flattish lid, not a fleshy ridge with sockets; the
  little wings are barely visible. Both are "does it read?" calls.
- [!] ALL FOUR ROUNDS WERE AUTHORED BLIND — the Chrome sandbox fix
  (`70147f98` + `7c20c17a`) landed only after r4. The next pass is the first that
  can see its own frames.
- [-] Ships `blob:silview` / `blob:inspect` — CPU renderers the blind runs wrote
  for themselves. Useful; keep.

## Roster — gnasher — 2026-09-09

- [x] `gnasher` merged (`982024f3`, polished `dec159cb`): a hunched pink flesh
  brute. Second character from a PROSE BRIEF only. SDF flesh + horns/tusks WAM kit.
- [x] Round 1 was authored BLIND (deepseek-v4.1-flash) and committed three of its own
  failing pins, skipped its kit and never rendered. Rounds 2-3 ran on `deepseek-v4-flash-vision-exp` and fixed all three by moving GEOMETRY, not thresholds.
- [ ] Still thinner from the side than the front promises. The arm-daylight pin
  (`> 0.038`) caps torso width, so going further is a deliberate trade, not more tuning.
- [!] `blob:render-check` not run on it (owner accepted on manual turntable review).
- [-] `scripts/gnasher-{silhouette,head-colour}.ts` are general CPU analysis tools
  despite the names — rename generically when a second character wants them.

## Roster — cyberdemon — 2026-09-08

- [x] `cyberdemon` merged (`bc95b19f`): the first character authored from a PROSE
  BRIEF ONLY — no reference mesh, no plate. SDF flesh + WAM kit. [Spec](docs/superpowers/specs/2026-09-08-cyberdemon-character-design.md).
- [ ] Two accepted cosmetic weaknesses to fix later: the lit eyes read as a cyan
  visor band (the failure mode `face.ts` documents), and the red chest cabling reads as a flat band, not bundled loom.
- [!] Its dispatch run CRASHED with dispatch-ui and committed nothing; the work was
  rescued off the worktree. `blob:render-check` has not been run on it.

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

## Orientation — active vs. historical

> **The active project is the SDF-rendered FPS.** It lives in
> `src/lab/sdf-zombie/` (the "lab" name is historical, not obsolete). The
> **retired project** is the sprite/bestiary/arena procedural-generation game
> and the old NotBlood simulation — kept runnable only as a **behavior
> reference** for dynamite and gibbing.
>
> Entries below that describe the retired sprite game or the old NotBlood sim
> (the pre-SDF M-series and the old-game backlog) are **historical / reference
> only** — preserved for provenance, not current work. Do not treat historical
> roadmap entries as in-flight.
>
> Current vs. proposed source layout: [docs/architecture/repository-map.md](docs/architecture/repository-map.md).
> Legacy dynamite/gibbing reference: [docs/reference/legacy-dynamite-gibbing.md](docs/reference/legacy-dynamite-gibbing.md).

---

## Current focus

**[~] Hybrid deferred renderer (M2) — material repair accepted by owner manual playtest on 2026-09-07; integrated with latest main.** The merged build passes all 34 gameplay GPU checks with zero page errors and the CPU/build checks. [Integration notes](docs/dev-notes/2026-09-07-m2-main-integration/notes.md). Task 7 stopped at owner request; gamma/flashlight tuning and unfinished automated shadow/performance validation remain follow-ups. Deferred remains opt-in.

**[x] Soldier combat/animation polish — owner approved; merged to main (909b6a87).** Fixed movement, aim, recoil, gait and lab controls. [First pass](docs/dev-notes/2026-09-06-soldier-polish/notes.md).

**[x] Soldier shotgun/readability — merged to local main (64aa78ee).** Exaggerated low-poly semiauto, bent support-arm aim, shared lab/game muzzle flash. [Design and captures](docs/dev-notes/2026-09-06-soldier-shotgun/notes.md).

**[x] Soldier appearance and damage pass — merged to local main (64aa78ee).** Bulk/olive armor, tuned face and red eyes, localized armor loss/severs/collapse, scoped wounds, skin save and Vite cache fixes. [Result and gotchas](docs/dev-notes/2026-09-06-soldier-bulk/notes.md).

**[~] SDF FRAME ATTRIBUTION — measured 2026-09-07 on branch `claude/bvh-sdf-raymarching-f02f18`; two dispatch tasks in flight.** Per-pass GPU timestamps (`BENCH_PASSES=1 scripts/sdf-game-bench.sh`, `gpu-pass-timing.ts`) show the march IS the frame and wounds grow it 6 → 26 ms; the near-wound bone/organ fold (no spatial cull) is 25–30% of that, the goo density pass is free. Both dispatch tasks landed and are PARKED with numbers: per-ray wound list ≈0; bone sphere cull at cluster granularity exact but −5% fire only (bone evals −18%: the torso cluster's one sphere holds ribs+spine+pelvis) vs tubes −13–23%. Per-rigid-segment bone spheres then built (Kimi dispatch), exact, bone evals −48%, **SHIPPED ON** as the game default (−5–7% wounded march in room 3; culling is now exhausted). Chain merged into this branch. NEXT real lever: baked bone-segment meshes as G-buffer members after deferred M2 is green. [Segment notes](docs/dev-notes/2026-09-07-bone-segment-spheres/notes.md). Bone tubes stay OFF (look); baked bone-segment meshes wait for deferred. [Eight runs + root cause](docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md) · [plans](docs/superpowers/plans/2026-09-07-bone-sphere-cull.md) · Obsidian `Claude Notes/Blud/2026-09-07-sdf-frame-attribution-and-wound-cost.md`.

**[~] Game tile visual playtest + telemetry — integrated on main; owner visual run next, before performance comparisons.**
[Usage](docs/dev-notes/2026-09-06-game-tiles-telemetry/notes.md): `?tiles-playtest`, F6 tiles, F8 record/save, F9 geometry/wound marker; ordinary tile default off, no GPU timing claim.

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
([clip-gait spec](docs/superpowers/specs/2026-09-05-clip-driven-gait-design.md)).
Lab dressing room: upload a face PNG / pick a skin tone, save both into the
repo via the dev-only `/__lab/save-*` endpoints
([spec](docs/superpowers/specs/2026-09-05-lab-dressing-room-design.md)).
[spec](docs/superpowers/specs/2026-09-05-soldier-animation-design.md) ·
[plan](docs/superpowers/plans/2026-09-05-soldier-animation.md) ·
[strips](docs/dev-notes/2026-09-05-soldier-animation/notes.md)

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
[spec](docs/superpowers/specs/2026-09-06-soldier-shootback-ai-design.md) ·
[plan](docs/superpowers/plans/2026-09-06-soldier-shootback-ai.md) (9 tasks).
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
[spec](docs/superpowers/specs/2026-09-06-shared-character-view-design.md) ·
[plan](docs/superpowers/plans/2026-09-06-shared-character-view.md) (12 tasks:
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
[refactor baselines README](docs/dev-notes/2026-09-06-refactor-baselines/README.md).

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
[spec](docs/superpowers/specs/2026-09-06-soldier-shootback-ai-design.md)

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
[Integration evidence](docs/dev-notes/2026-09-06-analytic-normal-integration/README.md); procedural flesh/wound gradients with automatic legacy fallback and retained comparison toggle. Owner reports smoother play but attribution is uncertain. Broader Task 5 performance study remains open: moving/multi-actor and direct original-shader controls are unmeasured. Stable 30 fps combat is the product target.

**[~] Zoned baked wounds — Task 3 resumed from saved work (2026-09-05); Tasks 1–2 done, 4–6 pending behind numerical/memory gates.**
[Plan](docs/superpowers/plans/2026-09-04-zoned-baked-wounds.md); defer expensive GPU verification under load; current shipping baseline and actual close-up coverage still require matched comparison.

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
[plan](docs/superpowers/plans/2026-09-05-female-described.md). Reference is a
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
[plan](docs/superpowers/plans/2026-09-04-soldier-described.md); the abandoned
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
[spec](docs/superpowers/specs/2026-09-03-fisheye-lens-design.md) ·
[plan](docs/superpowers/plans/2026-09-03-fisheye-lens.md) ·
[notes](docs/dev-notes/2026-09-03-fisheye/notes.md)

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
[spec](docs/superpowers/specs/2026-09-02-bone-tubes-design.md) · [plan](docs/superpowers/plans/2026-09-02-bone-tubes.md) · [notes](docs/dev-notes/2026-09-02-bone-tubes/notes.md)

**ZOMBIE SKELETON RE-AUTHORED — AWAITING OWNER LOOK (2026-09-03).** Tubes showed the field skeleton was six 12 cm rib stubs over 20 cm of a 34 cm spine; the owner's reference is a standard human torso. Now: twelve rib pairs as HOOPS (two Bezier bars per rib meeting at the flank), cage half-width 0.167 in a 0.19 chest, upper ribs short/flat, 7 widest, 8-10 on the costal margin, 11-12 floating; kyphotic spine at the BACK; sternum; clavicles; a pelvis with iliac-wing fans, crest arcs, sacrum and a closed pubic ring. Flesh 23 + bone 90 = 113/128, containment clean at 4 mm. Emitted by `scripts/zombie-skeleton-gen.ts` (`--check --write`), which owns the per-rib table. `rig-bind.ts` torso/head bones now bind to the nearest AXIAL joint (a hoop's midpoint is nearer the hip/shoulder, which shear). Instancer cap 512 → 1024 (820 tubes live). Captures + notes: [docs/dev-notes/2026-09-03-zombie-skeleton/](docs/dev-notes/2026-09-03-zombie-skeleton/notes.md). Owner's first look drove round 2 (same day): the cage sheared because point-binds carry no rotation — torso bones now pose as ONE rigid frame per axial segment (`BoneFrame` in rig-bind.ts, shear test pinned); six thicker ribs instead of twelve; pelvis as fat blades + ring; noise mottle + blood flecks in the tube shader (helpers split into their own WGSL strings — wgslFn takes one fn per string, silently draws nothing otherwise). 23 + 68 = 91 prims, 600 tubes. Owner verdict: an improvement, merged to main as-is; tubes are NOT yet good enough to replace the field bones (a capsule pelvis is 'a messy line drawing', the cage reads as spiky tubes going in and out of sync) — `setBoneMesh` stays OFF. Follow-ups in the notes: a solid-mass primitive for the pelvis, one continuous loop per rib.

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
[docs/dev-notes/2026-09-05-swing-variants/](docs/dev-notes/2026-09-05-swing-variants/notes.md).
[spec](docs/superpowers/specs/2026-09-05-zombie-swing-variants-design.md) ·
[plan](docs/superpowers/plans/2026-09-05-zombie-swing-variants.md)

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
[docs/dev-notes/2026-09-05-zombie-choreography/](docs/dev-notes/2026-09-05-zombie-choreography/notes.md).
**Still open:** getting stuck on furniture — navigation is its own spec and is
NOT in this change.
[spec](docs/superpowers/specs/2026-09-05-zombie-combat-choreography-design.md) ·
[plan](docs/superpowers/plans/2026-09-05-zombie-combat-choreography.md)

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
[docs/dev-notes/2026-09-04-zombie-crowd/](docs/dev-notes/2026-09-04-zombie-crowd/notes.md).
**Deliberate gaps:** the swing does NO damage (owner's call — rhythm first, no
player health this round); chasers stop at their room's doorway because
`stepWander` clamps to room bounds, so cross-room pursuit needs navigation.
[spec](docs/superpowers/specs/2026-09-04-zombie-crowd-and-brain-design.md) ·
[plan](docs/superpowers/plans/2026-09-04-zombie-crowd-and-brain.md)

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
F-eject.2** — [notes + before/after strip](docs/dev-notes/2026-09-04-shell-reload/notes.md).
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
[docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md](docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md)
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
[docs/dev-notes/2026-09-04-fpv-goblin-arms/](docs/dev-notes/2026-09-04-fpv-goblin-arms/notes.md).
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
[plan](docs/superpowers/plans/2026-09-03-shorty-breech-mechanism.md) ·
[spec](docs/superpowers/specs/2026-09-03-shorty-breech-mechanism-design.md).
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
[docs/dev-notes/2026-09-03-shorty-breech/](docs/dev-notes/2026-09-03-shorty-breech/)
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
[spec](docs/superpowers/specs/2026-09-03-freeaim-and-panels-design.md) ·
[plan](docs/superpowers/plans/2026-09-03-freeaim-and-panels.md)

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
[spec](docs/superpowers/specs/2026-09-02-fpv-weapon-overhaul-design.md) ·
[plan](docs/superpowers/plans/2026-09-02-fpv-weapon-overhaul.md) ·
[note](docs/dev-notes/2026-09-02-fpv-weapon-shorty/notes.md) ·
[blockout](docs/dev-notes/2026-09-02-fpv-weapon-blockout/notes.md)

**HULL-REFINE RENDERER — PARKED (owner, 2026-09-02): "annoying visual glitches… doesn't seem to offer much benefit atm; maybe with crowds". Revisit = phase 2 early-Z on the crowd case.** Phase 0 built, look passes headless parity, cost a wash at one body. Per-frame GPU surface-nets hull + fragment band refinement through the SHIPPED march (`march.wgsl.ts` untouched). Dispatch chain (kimi/k3, 5 tasks) landed the code; six bugs then separated a green suite from a zombie on screen (relaxed stepMul, vec4-padded soup stride, chunk hulls never extracted, extraction before the wound upload, a 4M-eval/frame live test, a 70-eval vertex pull) — all fixed and pinned. Headless A/B (8 stepped poses, 6 live instants, crater on/off, the 3-item reel): hull ≡ march. Owner: "pretty impressive… slightly less jiggly… pretty close". Fenced bench, one body, close camera, machine load 15–110: march ~22–27 ms, hull ~25–27, hull draw-only ~22 — extraction ≈3–4 ms, no win without early-Z (phase 2). NOT the hull: torso-sphere wounds billboard on both renderers and in-game (`damage.ts frame()` vs `game-actor` yaw-0 contract) — spun off. Page: `sdf-hull-spike.html`, seams `__hullSpike.*`, driver `scripts/hull-spike-drive.mjs`, reel `scripts/hull-spike-reel.sh`.
[notes](docs/dev-notes/2026-09-02-hull-refine-spike/notes.md) · [spec](docs/superpowers/specs/2026-09-02-sdf-hull-refine-renderer-design.md) · [plan](docs/superpowers/plans/2026-09-02-sdf-hull-refine-phase0.md)

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
[notes](docs/dev-notes/2026-09-04-closeup-2-probes/notes.md#wound-union-reach-cull-2026-09-05-dispatch2026-09-05-closeup-wound-cull)

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
[notes](docs/dev-notes/2026-09-04-closeup-3-depth-prepass/notes.md).

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
[notes](docs/dev-notes/2026-09-04-closeup-5-bake-settled/notes.md).

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
[docs/dev-notes/2026-09-04-closeup-4-goo/notes.md](docs/dev-notes/2026-09-04-closeup-4-goo/notes.md).
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
[notes](docs/dev-notes/2026-09-04-closeup-1b/notes.md)
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
[docs/superpowers/specs/2026-09-04-close-up-and-gore-cost-design.md](docs/superpowers/specs/2026-09-04-close-up-and-gore-cost-design.md)
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
  [design](docs/superpowers/specs/2026-09-03-zombie-melt-design.md) ·
  [plan](docs/superpowers/plans/2026-09-03-zombie-melt.md) ·
  [notes](docs/dev-notes/2026-09-03-zombie-melt/notes.md)

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
  [spec](docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md) ·
  [plan](docs/superpowers/plans/2026-09-01-wound-pass-r2.md) ·
  [note](docs/dev-notes/2026-09-01-wound-r2/notes.md)

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
  [spec](docs/superpowers/specs/2026-09-02-entrails-design.md) ·
  [plan](docs/superpowers/plans/2026-09-02-entrails.md) (branch
  `claude/continue-previous-work-91055b`) ·
  [note](docs/dev-notes/2026-09-02-entrails/notes.md)

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
  Chest still opens onto ribs. [spec](docs/superpowers/specs/2026-09-02-organs-and-springy-guts-design.md)
  · [plan](docs/superpowers/plans/2026-09-02-organs-and-springy-guts.md)
  (spec+plan on branch `claude/continue-previous-work-91055b`) ·
  [note](docs/dev-notes/2026-09-02-organs-guts/notes.md)

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
  matrix: [notes](docs/dev-notes/2026-09-02-blobforge-depth/notes.md)


- `P1.chain-drift` [x] **`blob:draft` chain closes — ALL 4 TASKS DONE; verdict on the re-draft: still NO vs hand-authoring, for NEW reasons** — plan
  [2026-09-02-blob-draft-chain-drift](docs/superpowers/plans/2026-09-02-blob-draft-chain-drift.md),
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
  [notes](docs/dev-notes/2026-09-02-blobforge-depth/notes.md). Next for the
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
  [notes](docs/dev-notes/2026-09-02-blobforge-depth/notes.md)

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
  **`blob:depth` in the loop.** [ref](docs/dev-notes/refs/minotaur-mesh/minotaur.glb)

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
  [design](docs/superpowers/specs/2026-09-03-hard-surface-material-design.md) · [plan](docs/superpowers/plans/2026-09-03-hard-surface-material.md)

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
  [design](docs/superpowers/specs/2026-09-03-body-sheet-design.md) · [plan](docs/superpowers/plans/2026-09-03-body-sheet.md) · [evidence](docs/dev-notes/2026-09-03-torso-relief/notes.md)

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
  [notes](docs/dev-notes/2026-09-03-torso-relief/notes.md)

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
  [docs/dev-notes/2026-09-02-box-primitive/](docs/dev-notes/2026-09-02-box-primitive/).
  **Next: the minotaur.** Its dispatch task is written and QUEUED at
  `~/.claude/dispatch/plans/2026-09-02-minotaur-character.md` (`glm-5.3-flash`,
  base_branch = this branch) — waiting on a dispatch-ui slot, two tasks running
  as of 2026-09-02. In-repo copy:
  [plan](docs/superpowers/plans/2026-09-02-minotaur-character.md).
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
  [spec](docs/superpowers/specs/2026-09-02-blob-hard-surface-box-design.md) ·
  [plan](docs/superpowers/plans/2026-09-02-blob-hard-surface-box.md)

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
  the ramp): [dev note](docs/dev-notes/2026-09-01-wound-r2/notes.md).
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

- `X-wind` [ ]  **Hair that SWINGS in the wind, not just ripples** — deferred
  by the owner 2026-09-05 after confirming the ripple ("subtle but it's
  there").
  Today `STRAND_WIND_RIPPLE` advances the strand bundle's wobble PHASE with
  the accumulated wind drift, so waves travel down each strand. That was
  chosen because it is **free**: a constant added to a phase changes neither
  the wobble's amplitude nor its slope along `t`, so `strandReach` and
  `strandLipschitz` are untouched and no bound site moves.
  The convincing effect — a lock blowing downwind — is a genuinely bigger
  change and the cost is known in advance:
  - the bundle must displace toward the TIP, weighted by `t`, so
    `strandReach` grows. That is a MULTIPLIER of the parent radius, so the
    sway wants expressing in units of `cell` (as `wave` already is) rather
    than in metres, or it does not fit the shape all eight outer-bound sites
    use.
  - `strandLipschitz` grows by the wind slope, which joins the wobble
    slope's budget — so deep sway and fast wobble start competing, the way
    `warp`/`warpFreq` do under the shell pinch cap.
  - the displacement must be a BOUNDED function of the drift (the drift
    accumulates forever), i.e. oscillating rather than monotonic, or the
    hair flies off.
  Same wind uniform (`__sdfLab.setWind`), same body anchor.

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
- `X1.29` [x] **Near-wound step multiplier — MEASURED, DELIBERATELY LEFT AT
  0.6.** Owner A/B'd 0.6 against the sound 0.4 on screen (`setWoundStep`) and
  could not tell them apart, so the frame budget won. Everything below is why
  it is a decision now rather than an oversight, so it can be re-taken without
  re-deriving. The wounded field is not a distance bound and nobody had
  measured how badly: max |grad| is 2.06 for ONE stock blast (sound
  multiplier 0.48) and 3.92 for a blast + six-pellet spread (0.26), against a
  0.6 inherited from the shell's fbm under-relaxation. What 0.6 looks like,
  counted over every pixel of a real frame on a shotgunned torso: **4.32% of
  that body's hit pixels at 1.5 m** (2.16% at 2.5 m, 0.97% at 4 m) shaded from
  inside the meat — contiguous patches, not speckle, 686 of them at 2.5 m with
  normals >45° wrong, tissue-ramp depth up to 13.7 mm too deep. STABLE across
  camera motion (2892 of 2903 pixels persist over 0.23°), which is why it read
  as gore rather than as a bug. A single wound is clean at any value — this is
  a STACKING artifact. 0.4 removes every >45° error and 92% of the pixels for
  **+23% / +18% / +16% march steps at 2 / 4 / 8 m** on a wounded body (0.3
  removes the sub-threshold remainder for +45/+36/+32%); unwounded bodies and
  hit counts unchanged. Re-take it live with `__sdfGame.setWoundStep(0.4)` /
  `__sdfLab.setWoundStep(0.4)` (perfCfg.z; 0 = the compiled constant), one
  constant to make it permanent. Characterised by
  `webgpu/march-step-soundness.test.ts` — the measured gradient, and one
  recorded ray pinned BOTH ways (shades 11 mm inside at 0.6, stops in front of
  the wall at 0.4), so the file stays honest whichever value ships. Related,
  NOT
  fixed: `coneMarch` steps `(d - r) * marchCfg.y` with no wound term at all,
  so an enabled cone pre-pass can certify a crater's interior as empty (cone
  ships OFF).
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
- **Design questions:** re-read the design spec above before adjusting scope. **Real problem restated (owner, 2026-09-04): frame dips when a body FILLS the screen (and under heavy blood particles).** Next levers, pixel-scaling only: (1) post-hit probes → derivative normals + reduced-rate AO/thin (6 → ~1 evals/pixel), (2) quarter-res depth prepass to start rays near the skin without vertex cost. Adaptive resolution REJECTED for close-up (visible res drop). Tile binning measured nil — not the cost. Plan note: Obsidian `Claude Notes/Planning/2026-09-04-sdf-close-up-frame-rate-plan.md`.

**Hit batching SHIPPED (2026-09-05):** pellet impacts batched per actor per frame (`beginHits/endHits`) — landing frame with 16 pellets 6.7 ms CPU (was 12–18 ms for 4 pellets; ~16 whole-body repacks on a point-blank double barrel). Left: per-pellet CPU flesh probes (~6 ms/16 pellets), first-shot 131 ms pipeline compile (prewarm). Notes: docs/dev-notes/2026-09-04-closeup-2-probes/notes.md.

**Close-up wounded frame, quiet-machine verdict (2026-09-05):** ship 25.6 ms (step 1.0 + cull), step 0.6 = 32.2 (+26%), cull off = +1%, bones out of field = −16% (4.2 ms; the planned baked-bone replacement collects it), unwounded 15.1. Wound step 1.0 was THE lever and is shipped; the cull is a harmless no-op; the earlier 50 ms readings were machine load. Notes: docs/dev-notes/2026-09-04-closeup-2-probes/notes.md.
