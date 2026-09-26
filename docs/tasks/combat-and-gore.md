# Combat, weapons and gore

Weapons, gibs, blood, burning, decapitation, shot visuals, the viewmodel. Part of the task wiki: [TASKS.md](../../TASKS.md) is the front page. Sections are newest-first where dated; each keeps its own history.

## Decap / ragdoll bugs + debug hooks — 2026-09-22

- [x] **Legless bodies stood in the air.** `missingLimbs()` (webgpu/game-actor.ts) only counted a leg gone when its
  CLUSTER died; a mid-limb `severDistal` (shoot the shin off) leaves the cluster alive, so two shot-off legs never hit
  collapse's both-legs trigger. Now any dead prim in a leg counts that leg missing (one leg ⇒ existing hop-limp).
- [x] **Knees folded backwards on collapse.** Only elbows had a `RigBendConstraint`; the collapse ropes cap leg LENGTH
  but not the hinge side. `rig-bind.ts` now emits thigh/shin knee stops with the pole at −bodyForward (150° maxFlex,
  same shape as the elbow stop). `rig-bind.test.ts` bend count 2 → 4.
- [x] **Debug hooks.** `actor.debugSever(limb, 'full' | chainIdx)` + `__sdfGame.decapitate({id, at, dist, frame})` —
  behead on demand and frame the stump. `__sdfGame.replayDemo(name?, {speed, stopAt, resume})` + `demoList()` +
  dev-only `/__lab/list-demos` — watch an F7 recording at real time and FREEZE on a frame. Recorder now logs per-frame
  `dt` (live play is variable-rate; replay used to re-step everything at 1/60 and drift).
- [ ] **NECK STUMP STILL WRONG (the reported bug).** A decapitated stump's flat face renders pale grey/cream, not
  interior meat. Not reproduced under instrumentation yet. Measured: the stump wound sits ~7.5 cm ABOVE the cut
  (`severLimb`'s `lerp(anchor.a, cluster.center, 0.6)`, r ≈ 0.11 on ZOMBIE), so the crater floor IS ~3.5 cm deep —
  deeper than `muscleDepth`, i.e. the tissue ramp should already be clot-dark there. Prime suspects: (a) the flat cut
  face is not covered by the wound mask at all and shades as plain skin, (b) spec/fresnel glare on a flat, wet,
  up-facing plane (`fres` is only faded by `wmRim`, so an unmasked face keeps full fresnel). Next: `decapitate()`,
  screenshot the face, then bisect with `setFlatAlbedo` / `setMarchDebugMode` / `surfCfg.z = 0`.
- [ ] **Replay still drifts** even with per-frame dt: owner reports enemy behaviour does not reproduce from the same
  inputs+seed. Suspect actor-side state that is not on the seeded streams (or reads wall time). Parked.

## Narrow FOV + the weapon's own FOV — 2026-09-21

- [x] **Owner: narrow the frame to 58 render / 46 centre** (was 72/60), for claustrophobia and to show the wound system.
  `FISHEYE_DEFAULTS` shipped; visible FOV 63.0 -> 49.0 deg at 16:9, bend almost unchanged. Starting values, tune by eye.
  [Notes + captures](../../docs/dev-notes/2026-09-21-narrow-fov/NOTES.md).
- [x] **The weapons are no longer framed by the world FOV** — chose (b) *own FOV*, not (a) per-weapon retuning.
  A `view-model-fov-rig` under the camera carries `(r, r, 1)`, `r = tan(centre/2)/tan(60/2)`, which is EXACTLY the old
  projection for camera-parented geometry (proved in `game-viewmodel.test.ts`). One transform, all three slots, no
  per-weapon work, survives future FOV tuning; `z` pinned at 1 so depth/occlusion are untouched. Cost: non-uniform scale
  tilts the view model's normals, and a ~3.8% residual because the lens itself changed. Seam: `__sdfGame.setViewmodelFov`.
- [x] Tools: `scripts/sdf-game-fov-capture.sh` (9 shots, 3 FOV legs x 3 weapon slots, FOV read back and gated),
  `scripts/sdf-game-fov-gpu-ab.sh` (one page, uncapped, alternating legs).
- [x] **Fixed on the way: `__sdfGame.fisheye` was a boot-time SNAPSHOT** — and so were 94 others (next row).
- [~] **Cost: the coverage half is measured, the GPU-ms half is NOT.** Median `coverageFrac` 0.155 -> 0.27 (**1.75x**,
  matching the 1.72-1.81x arithmetic) over six alternating legs. But the GPU busy A/B came back **vsync-bound**
  (frame p50 16.6 ms, ~3.7 ms idle on BOTH arms) so its "1.01x" means nothing — the elastic-clock trap arriving through
  the presenter, not the frame cap. Raising the DPR does not help: the march target is **capped** and does not follow it,
  so the FOV adds no marched pixels, only march depth on pixels that now hit flesh. **Next: vsync off needs a Chrome flag
  in the shared `scripts/lab-servers.sh` — not taken unilaterally.**
- [ ] Owner to judge the captures and tune 58/46 by eye; `setViewmodelFov` if the weapon wants to sit differently.
- [ ] F-aim.1 (free aim misplaces under the lens) is UNCHANGED and still deferred — it reproduces at every FOV.

## Burning enemies — flame look + flame lab — 2026-09-17

- [x] Foundation: `sdf-flame-lab.html` + per-body burn + surface fire/char + glow, heat warp, shutter, fire light.
  [Spec](../../docs/superpowers/specs/2026-09-17-burning-enemies-flame-lab-design.md) ·
  [plan](../../docs/superpowers/plans/2026-09-17-flame-lab-foundation.md) ·
  [captures](../../docs/dev-notes/2026-09-17-flame-lab/NOTES.md).
- [x] Tongues: owner chose **flame cards** (Blood FIRE01 atlas, `npm run flame:atlas`, untracked). Screen-space stays switchable; volumetric skipped.
  Polish: seams, curl flow, leg coverage, burn-down, dark scorched bone. [Plans](../../docs/superpowers/plans/2026-09-18-flame-polish.md).
- [x] In-game test harness: slot `3` ignites what you hit, `__sdfGame.igniteAll()` / `extinguishAll()`. Throwaway, not the weapon.
  Needs the atlas + `public/assets/lab/flaregun-placeholder.glb` (both untracked). [Notes](../../docs/dev-notes/2026-09-18-flare-ingame-test/NOTES.md).
- [x] **Owner playtest feedback pass (2026-09-18/19) — merged to main.** **Handoff: [2026-09-19-burning-fire-handoff](../../docs/dev-notes/2026-09-19-burning-fire-handoff.md)** (state, learnings, open list).
  Volumetric fire is the game default (swept flame sheets, card accents, nearest-4 volume + crossfaded full-card LOD, skin 0.3, rise 0.45, no smoke);
  room fire light; zombie burn panic (soldier OFF); ivory bone; soldier legs burn. Open: cheap smoke, head flame (optional), real flare gun.
- [x] **Cold-boot compile (2026-09-19):** [census](../../docs/dev-notes/2026-09-19-shader-compile/NOTES.md) — cold = 4 march programs x ~48 s. Gib + crowd compiles
  deferred to background ([notes](../../docs/dev-notes/2026-09-19-defer-compile/NOTES.md)): cold loader ~195 s -> ~48 s, warm 2.5 -> 1.75 s, no mid-game compile.
  Next (optional): merge crowd+body programs; march phase 2 (shrink marchBody). march split: tasks 1-3 done (task 3: 25 feature blocks + test split, [notes](../../docs/dev-notes/2026-09-18-march-split/NOTES.md)).
- [x] **Melee close-up perf harness (2026-09-21):** `scripts/sdf-game-melee-bench.sh` — [notes](../../docs/dev-notes/2026-09-21-melee-harness/NOTES.md). The arena's cast WALKS to the
  player, freeze, then clean -> wounded -> wounded+fire with alternating seam legs (`MELEE_LEGS` injects more). Quiet run: frame 17.0 / 22.8 / **36.7 ms**, march 13.2 / 19.3 / 27.7 —
  reproduces the owner's GPU-bound episode. Miss rays are 46-50 % of walk steps there. Found: bodies spawned after boot never march (debug-spawn bug?); `applyShipDefaults` is not ship.
- [~] **Telemetry v3 + CPU frame attribution (2026-09-20).** [Notes](../../docs/dev-notes/2026-09-20-telemetry-v3/NOTES.md). Recordings now
  carry `selfPhases`, `unattributedCpuMs` (was ~half the frame, now 0), region + per-pass CPU laps, and auto `long-frame` /
  `shader-build` (r186 `onNodeBuilderCreated`) / `flare-shot` events. **Finding: `cpu:sdf:polys` is 5.0 of a 7.6 ms draw — the
  CPU lever is the polygonal pass (static merge / BatchedMesh / render bundles), not the SDF chain; occluder hull 1.7 ms/frame.**
  Fixed on the way: weapon-switch pipeline rebuilds (muzzle light under hideable `gunRig`, 115-445 ms) and the flare hit-test
  stall (61-86 ms -> 0.2 ms, bit-identical). **v4 (`f3900e74`, fix `335b178a`): frames carry `gpu {busyMs, idleMs, passes}`.**
  Owner session: GPU busy p50 21.0 / p95 28.2 / p99 34.0 ms of 33.3; CPU 12.7 / 15.3 -> **the GPU (the march, 12.3 ms mean, 28-38 ms
  with 8 bodies at 1.6 m) is the tighter side**; CPU work buys headroom, not frame time. `cpu:sdf:polys` is 815 meshes walked 3x
  (main + 2 shadow maps): 426 un-instanced skeleton segment meshes for ALL 23 actors, 147 level meshes.
  **Visual-actor cull: DONE (`caed76d7`, 2026-09-21)** — [notes](../../docs/dev-notes/2026-09-20-visual-actor-cull/NOTES.md). Skeleton meshes, live hulls,
  wound exclusions and view-time follow a padded view cone + the march cull's sight test; sim untouched; `?visualcull=0` A/B.
  Visual set 23 -> 5-6, visible meshes ~818 -> ~497, gate canonical. **Measured: ~1.5-2 ms CPU (tick 6.1 -> 4.7; draw -0.7..-1.0),
  GPU unchanged at full clock — well short of my 4-6 ms estimate.** **METHOD WARNING: GPU ms under the 30 fps cap is elastic (the
  GPU downclocks; same work read 11.7 vs 18.9 ms). GPU A/Bs must run in ONE page with `setFrameCap(0)`; never compare GPU ms
  across sessions** ([notes](../../docs/dev-notes/2026-09-20-telemetry-v3/NOTES.md)). Also fixed: the peek bug (`584690a0`, per-cluster line of sight) and march-hash hashing the
  per-body fallback (`5d7f6a18`). **March floor experiment DONE** ([notes](../../docs/dev-notes/2026-09-21-march-floor/NOTES.md)): normalised to
  a constant clock, one body is 15.7 ms full-screen -> 4.7 ms at 3% of screen (raw ms hid this); floor ~5-7 ms = `sdf:shell-hull`
  ~3.7 ms FIXED + a per-TARGET-pixel share of the march; steps / spot shadow / temporal start do nothing; the shell costs
  +1..+4 ms with one body, saves ~0.6 ms with 4-5, and is not pixel-neutral. **Owner ruled out lowering march resolution
  (too noticeable).** No cheap 4-5 ms found in the march; open, unsized: MRT diet (3x rgba32float), cheaper hull targets.
  Open: cold GIB background compile can hit its 180 s timeout and settle `failed` -> no gib chunks that session; warm `plate`,
  `flame-cards`, explosion materials at boot; per-sever `gib-asset-*` material rebuild; first dynamite gib 33-56 ms; `sdBody` `prims.slice`.
  Dead end: a magnification-aware fisheye filter does not recover 60/60 sharpness (the loss is sample density; a 3x upscaler is the lever).
- [x] **Close-up wound cost — owner re-fold RAISER GATE SHIPS (2026-09-22).** `counts2.z = SHIP_REFOLD_MODE = 2` (zombie-gpu.ts). Melee bench, one page,
  alternating (load <= 6, indicative): `sdf:march` wounded 27.9 -> **25.3**, wounded+fire 29.1 -> **25.5** ms; march-hash `room1` + `room1-wounded`
  bit-identical to the full re-fold. `setOwnerRefold(true)` = ship; `setOwnerRefoldFull(true)` = the old full re-fold. Also landed:
  **ragged soldier craters ON** (owner-approved look: one noise-ragged row per wound instead of wound + 3 lobes), exact fixes (`setWoundExact`, OFF: ~0 gain),
  **mode 4 per-limb accumulators PARKED behind `?limbs`** (owner liked the look but it LOSES to the gate: 26.9 / 28.7 ms, and +9 s cold compile — the 0.2 m
  cull slack folds too many groups near wounds). Details: [WOUND-COST.md](../../docs/dev-notes/2026-09-21-multiscale-march/WOUND-COST.md) "2026-09-22".
- [x] **Fire's march cost = the burn PANIC behaviour, not the fire (2026-09-22).** `setBurnBehaviour(false)` (burn visually, behave unburnt): `sdf:march`
  unchanged; with panic +13-17 ms (zombies charge the camera). Fire rendering costs ~3.5 ms of frame in `post:fire-march` only.
- [x] **Miss-ray culling — built, proven safe (0 hits lost), a LOSS (2026-09-22).** `setMissCull`, OFF. -36/-41 % walk steps saved only ~0.5 ms
  of march; the prepass costs 7-8 ms. **Miss steps are nearly free — rank levers by cost near surfaces, not step counts.** Found + fixed a latent
  prepass bug: the block cone was half as wide as its proof (be3ec43c). [WOUND-COST.md](../../docs/dev-notes/2026-09-21-multiscale-march/WOUND-COST.md).
- [x] **Cost-weighted census (2026-09-22)** — [notes](../../docs/dev-notes/2026-09-22-cost-census/NOTES.md). Debug modes 13/14 + `costCensus`. Wounded melee: wound-zone hits = 68 % of
  prim work (post-hit 35 % > walk 32 %); grazing misses 1-4 px from a body ~200 prims/px (12-21 %); far misses ~9 prims/px (nearly free).
- [ ] **START HERE (2026-09-23, later): 0.25 march + checker + edge coverage — ~38 % faster frame, owner-accepted look under the retuned VHS.**
  Merged to main (PR #20), flag-only (`?accum=1&accumscale=0.25&accumchecker=1&accumedge=1`) except the new VHS `blud` defaults.
  **Owner: not the default yet — more exploration first.** Melee crush frame 12.55 -> 7.80 ms (quiet pair; a second pair was CPU-bound
  under load). Open threads (quiet re-run, default vs setting, wounded/fire look, exact edge direction, split false near-miss, far-pass
  timer, trained upscaler, VHS dependence): [TEMPORAL-RECON-FINDINGS "Round 2"](../../docs/dev-notes/2026-09-22-cost-census/TEMPORAL-RECON-FINDINGS.md).
- [ ] **(earlier) START HERE (2026-09-23): [cost-census HANDOFF](../../docs/dev-notes/2026-09-22-cost-census/HANDOFF.md) + [TEMPORAL-RECON-FINDINGS](../../docs/dev-notes/2026-09-22-cost-census/TEMPORAL-RECON-FINDINGS.md)**
  — branch `claude/march-census-r2` (unmerged). Kept: flame 24/0.3 default, per-pixel object motion vectors (debug mode 16), accumulation v2
  (`?accum=1`, ghosting fixed). Parked behind flags: checker reconstruction + t16 stack + distance split (`?accum=1&accumscale=0.25&accumchecker=1`;
  owner: not shippable up close in motion). Measured NO-GO: hybrid edge re-march. Before merging: re-time the flame default quiet and confirm the
  ship frame is unchanged (A/B vs 53087f8c). Later experiment (owner): trained upscaler with TEMPORAL inputs. Flame streak/heat compensation: owner
  wants shutter-type blur and a large-wavelength subtle shimmer.
- [ ] **NEXT (close-up march):** cheaper post-hit probes (AO/scatter) in wound zones, then the wound-zone walk, then grazing misses. Superseded plan below:
  cost near surfaces — per-step cost in wound zones and grazing silhouettes (a cost-weighted census, not a step count),
  the mode-4 census bug in the panic state, and (maybe) a per-wound cull slack for mode 4.
- [ ] **Multi-scale march + learned reconstruction — RESEARCH (2026-09-21), nothing built.** [Notes](../../docs/dev-notes/2026-09-21-multiscale-march/NOTES.md).
  Close-up `sdf:march` at scale 1.0 / **0.5 ship** / 0.25: clean 31.4 / **7.6** / 2.7 ms, 5 wounds 44.4 / **13.8** / 7.7, room 4 32.6 / **10.1** / 2.9
  (one page, uncapped, alternating). Ceiling of a 4x reconstruction = 5-7 ms/frame; depth rebuilds within 5 mm on 95 % of body pixels from
  1/16 of the samples. Ray-start priors stay dead (hit rays take ~4.2 steps) — the saving is in NOT running pixels. **Two free findings:
  wounds cost ~4.5 ms that does not shrink with resolution (unexplained), and 32-49 % of walk steps are rays that miss** (the parked
  prepass ignored coarse misses; culling on them may flip its verdict). Next: those two, then an OFFLINE 4x train (rgb / rgbdn / rgbdn+sparse truth).
  **Wound cost ROOT-CAUSED (same day):** [WOUND-COST.md](../../docs/dev-notes/2026-09-21-multiscale-march/WOUND-COST.md) — the owner re-fold in `mapBody` is ~95 % of it
  (5.9 of 6.2 ms at ship scale; `setOwnerRefold(false)` = a clean body's cost). It fires over the whole torso and almost always loses. A value-preserving
  **raiser gate** is in behind `counts2.z == 2` / `__sdfGame.setOwnerRefoldGate(true)`, **ships ON since 2026-09-22**: 14.95 -> 13.41 ms, diff inside the frame's own noise.
  **CPU threat mask also built, OFF** (`counts2.z == 3` / `setOwnerRefoldMask(true)`, `wound-threat.ts`, mask rides the fraction of `ROW_WOUND_FLAGS.x`): names only real
  neighbours in the staged hip-wound scene so it cannot beat the gate there; **untimed — machine was under Docker load; re-run quiet.** 5 stamps = 16 wound rows.
  Before flipping: march-hash/parity with the gate on + owner look at a raised arm over a torso crater. ~5 ms remains (3 options in the note). Per-ray wound list is a LOSS (13.8 -> 21.3), keep OFF.
- [x] **Cold-cache flesh bug (2026-09-20, fixed).** Not the warm gate and not three r186: the body program was ready, but the
  defer-compile per-body FALLBACK never drew. Crowd-attached proxies spawn hidden and only sdf-layer's depth-gate-ON branch
  re-shows the `setBodies` list; the game ships the gate OFF, so members stayed hidden (skull + bones) until the background
  gib + crowd compiles landed (measured cold: gib alone 264 s) — and a reload restarts them, hence "random". Fix: the draw fn
  shows/hides attached proxies itself. Repro trick: reuse a Chrome profile killed mid-background-compile (body cached, gib/crowd cold).
- [ ] Then: the real flare gun (projectile, stick, burning AI, damage) — owner's separate session. Burn-down on death is wired but unreachable (game has no health yet).
- [~] Spin-offs from the [wildfire teardown](../../docs/dev-notes/2026-09-18-wildfire-fire-teardown.md): shared `curl-volume-node.ts` + `soft-fade.ts`.
  **Explosion curl: seam fixed and verified** (edge-map gate `npm run explosion:seam`, all scenes clean, billow kept; ship values
  curlStrength 1.1 / curlScale 18 / softFade 0.4 — game default still OFF, one-line flip). Blood: DENSITY spike reads as goo;
  per-stream fusion landed (correct, +0.2 ms, lab-only) but crossing sprays still read as one mass — next: rope-not-fan emission, then capsule field.

## Dynamite gib appearance — owner accepted 2026-09-16

- [x] Preserve flesh shading, cut geometry and face texture through settle baking; owner manual test accepted.
  [Results, captures and limits](../../docs/dev-notes/2026-09-15-gib-baked-vs-marched/parity-fix/RESULTS.md) · PR #8.
- [x] Startup + first/repeated-blast freeze profiled with corrected attribution; blast stalls fixed.
  Explosion light visibility toggle re-keyed three's lightsNode and rebuilt 17-18 pipelines per blast frame
  (p95 221-234 ms → 31-35 ms, 11 long frames → 0 over six blasts). Candidate `fd704125` on
  `codex/blud-action-stall-fix`; [results + raw evidence](../../docs/dev-notes/2026-09-16-startup-freezes/RESULTS.md).
  Still open: steady-state probe gather at the 1024-row cap (338-1069 ms p95), warm hidden-mesh flip re-key,
  opt-in carve 22.3 s build, and the unreproduced owner 38.9 s.
- [ ] Next: body-to-gib tearing transition; active melting and retired NotBlood sprites are references. Design remains open.
- [~] Playtest follow-ups 2026-09-16 (candidates on `codex/playtest-followups-task-*`, not merged).
  Task 1 cold start (`64a4737b`); task 2 split limbs + recognizable heads + leaner plan — the default `parts`
  shape is a priority prefix of one split-only 14-piece plan (no whole-limb fallback at any budget), the
  skull/pelvis duplicates are gone and the gore pass is face-aware in the march and the bake.
  [diagnosis, census, captures, limits](../../docs/dev-notes/2026-09-16-playtest-followups/ANATOMY-HEADS.md).
- [ ] Then: blast shockwave A/B + integrated rupture review (task 4); NotBlood launch dispersion (task 3);
  floating/upright settled pieces (later follow-up, not this task).
- [~] Offline reusable gib assets 2026-09-16 — tasks 1–3 done on `codex/offline-gib-assets-task-3` (not merged):
  generator + committed zombie/soldier sets (43 pieces, 8.4 MB, 12 mm cells) and the mesh path
  `?gibrender=assets` (loads/deforms them, exact sim parity), but the default stays `march`: blockers are
  `bakeColor.a == 0` on 100% of asset verts (no wet/cut mask) and the mesh head face projection is unwired
  (head excluded, counted `head-face`). Task 3 fixed a rupture-path cut-cap spike (2,540/37,738 verts) with a
  CPU regression test; loader 8.65 MB / 33–190 ms / 0 runtime extraction; no measurable moving-gib cadence
  cost at 14–56 pieces. [report, captures, exact usage + blockers](../../docs/dev-notes/2026-09-16-offline-gib-assets/REPORT.md).
- [~] Offline gib-asset metre poles on ANIMATED bodies 2026-09-17 — fixed on `codex/offline-gib-spikes`
  (not merged): the owner's live-playtest poles were `sub` cut caps used as skinning targets (a point
  sphere ~3–5 m out with no axis, so its radial could not rotate with the posed body). Bind table is now
  additive-only (schema 3 / `GIB_ASSET_BIND_MASK`), `primTransformPoint` rotates the radial, and the
  renderer refuses an out-of-runtime-bounds deform (counted marched fallback, pool released once).
  Worst vertex outside the runtime additive union: **4.28 m zombie / 5.19 m soldier → 0.036 / 0.030 m**;
  344 CPU piece-spawns, 0 fallbacks; gate cost 0.44–0.50 ms/body. Substantive tip `9b1d05d0`.
  [report](../../docs/dev-notes/2026-09-17-offline-gib-spikes/REPORT.md).
  Default stays `?gibrender=march`; the GPU/native-vision pass on live moving/damaged actors is the
  outstanding step (GPU not approved for this task).

## Shot visuals — tracer rounds — 2026-09-09

- [x] Projectiles no longer draw as shaded yellow balls. Each carries an additive
  velocity-aligned STREAK plus a view-facing EMBER (`webgpu/tracer-sprite.ts`), with a
  0.30-0.95 m near-fade so nothing blobs at the muzzle. Player and soldier pellets share it.
- [!] A velocity-aligned streak FORESHORTENS to a sliver on your own forward shots —
  measured, and why the ember exists. Owner may still want the player's streak dropped
  (one branch in `placeTracer`); enemy fire is the case the streak actually pays off in.
- [-] `scripts/sdf-game-tracer-look.sh` is a LOOK capture, not a gate. Its header carries
  the three rigging traps (LAB_TMP outside the vite root, `?frozen`, room1's only clear lane).

## GIB GORE — SHAPE SOLVED, MATERIAL STILL WRONG — 2026-09-11
> **NEXT ACTION: fix the GORE MATERIAL's texture. The shape is accepted; the look is
> not.** Three renderers exist and the owner has looked at all three — marched
> pieces, sprite sheet (REJECTED), and the carved whole-body meshes (the current
> path). Verdict on the carve, verbatim: *"in terms of shape i think are fine but
> they literally look like rocks - nothing even abit fleshy about them - pale, like
> gray offwhite with some maybe texture that is linear streaky looking looks kinda
> like concrete meets marble a little"*, then *"they dont look right still gray and
> stone"* and *"i dont think the texture is right either it doesnt look like the
> zombie skin texture at all."*
>
> ## 2026-09-15 (later) — THE SETTLED GIB STILL DOES NOT MATCH THE MARCHED ONE
>
> **READ [`docs/dev-notes/2026-09-15-gib-baked-vs-marched/HANDOFF.md`](../../docs/dev-notes/2026-09-15-gib-baked-vs-marched/HANDOFF.md) FIRST.**
>
> The goal is the owner's: *"the idea was to optimize it so htey arent marched
> but keep the same look"*. KEEP the bake, MAKE IT MATCH. A reference exists and
> is one flag — `?chunkbake=0` (or the panel's `settle bake` row) leaves a landed
> piece marched, which he confirmed is the target: *"thats wahat i want"*. Diff
> against it; do not ship it.
>
> **After a full lighting pass his verdict was "still looks the same".** Not
> better — the same. So the remaining gap is probably NOT lighting.
>
> **PRIME SUSPECT — the albedo, and it is a known bug class.** Every baked piece
> measures (`__sdfGame.bakedAlbedoStats()`) mean rgb (0.487, 0.334, 0.265) with a
> total range of 0.09 and **`meanWoundMask: 0`**. The wound mask is dead, so
> `mix(baseColor, tissue, wm)` discards the whole tissue ramp and the piece is ONE
> COLOUR. Cause is upstream: pieces reach the baker with `torn: []`
> (`lastBakeInfo.torn: 0`) — trace `bakeData()` → `tornLocals` → `piece.tornAt`.
> **`gib-carve.ts` had the identical bug and it is already fixed there**
> (`cutAwareField`); the settled path has real torn ends that simply are not
> arriving. Do this before touching the shader again.
>
> Fixed this session and verified: the 12-slot record pool throwing inside the
> tick; the settled-chunk material never registered with `litChunkMaterials` (so
> it had NO flashlight and NO room light — a regression that landed AFTER the
> owner approved the bake on 2026-09-05); per-pixel micro-detail from the march's
> own noise source strings as wgslFn includes; baked per-vertex AO through the
> worker; the 0.15 key floor; a gib-specific fresnel (0.6 → 0.18) for the edge
> glow; `gibbones=core` default; gib bones as MESH tubes. Three panel sliders and
> a `settle bake` toggle.
>
> Still absent from `chunkShade`: backlit scatter (flesh authored `translucency
> 0.45`) and wound shadow.
>
> ---
>
> ## 2026-09-15 — REBASED ONTO THE CROWD MARCH, AND THREE MORE FIXES
>
> The branch is on main as [PR #8](https://github.com/goblincore/blud/pull/8)
> (draft). 47 commits squashed to one integration commit — a commit-by-commit
> rebase needed ~26 separate integrations of `game-main.ts` and most intermediate
> commits would not have compiled, so they could not have been verified. Full
> history kept at `backup/pre-rebase-2026-09-15`. Six conflicts, all in
> `game-main.ts`; the two that needed judgement were main's replay-determinism
> refactor (weapon slots had to become a RISING-EDGE scan inside
> `applyInputEdges`, and mousedown had to keep the tick deferral).
>
> **THE WHOLE SUITE PASSED WHILE THE FEATURE WAS DEAD IN THE BROWSER.** Three
> runtime-only faults, none of which a test could see:
>
> 1. `createChunkGpuView` THREW "shared chunk material is full (12 slots)" from
>    inside the tick, where the animation loop swallowed it — after the body was
>    spliced out of `pendingGibs` and before `retireActor`, so a gib vanished
>    silently (`gibbed: 1, gibPieces: 0`, body never retired, nothing logged).
>    Main's crowd march sizes one shared record buffer from what the page passes,
>    and the page passed the PRE-DYNAMITE `MAX_CHUNKS` of 12 while the recycler
>    allowed 64. Now one ceiling: `MAX_CHUNK_BUDGET = 96`. Measured 0 -> 19 pieces.
> 2. A settled piece had no per-pixel detail at all. The bake drops it on purpose
>    ("the baked surface is the clean field") and this shader's header claimed the
>    march's fbm "has no mesh-side equivalent and does not need one" — it does.
>    The march's OWN `HASH13`/`NOISE3`/`FBM` source strings are now wgslFn
>    includes, so parity is structural. Amplitude follows the live creature's
>    `surfCfg2.y`; `?chunkdetail=` / `__sdfGame.setChunkDetail(x)` overrides it.
> 3. **THE SETTLED-CHUNK MATERIAL WAS NEVER REGISTERED.**
>    `createBakedChunkMaterial` is built in two places and only the corpse path
>    wrapped it in `registerLitChunkMaterial` — but the CHUNK BAKE path is the one
>    that wins in normal play. So every per-frame push went past it, including the
>    FLASHLIGHT: settled pieces kept `spotCfg.x = 0` (beam off) against a fixed
>    2.4 directional key — a body lit by a lamp that is not there, at ~2.5x, which
>    is what blows flesh pale. `litChunkMaterials` was added to fix exactly this
>    class of miss and this path was left out of the fix.
>
> **The instrument that caught (3) is kept.** A look A/B could not tell "the term
> does nothing" from "the term never arrived" — sweeping `setChunkDetail` 0.06 ->
> 0.9 changed nothing on screen. `__sdfGame.chunkDetailApplied()` reports what the
> MATERIALS hold rather than what was requested; it read `[]` against 12 baked
> pieces on screen. After the fix, `[0.06]`.
>
> **BONES: MESH ON A BODY, MARCHED IN A GIB — by design.**
> `resolveSkeletonMode` returns `'mesh'` by default (only deferred mode or
> `?skeleton=procedural` forces otherwise), so a living actor wears extracted
> segment meshes. A DETACHED chunk does not: `spawnChunkPiece` calls
> `setPackBones(boneOnly ? true : !boneMesh)`, so a bone-only gib piece always
> packs its bone rows into the marched field — without that it would march an
> empty field and the skeleton would be invisible. Measured after a gib: the 7
> remaining live chunks are all `kind: "bone", render: "march"` and settled; the
> 12 that BAKE are the flesh. So the pale capsules in a settled pile are the
> skeleton, pale by design (`boneColor`), and bones never bake.
>
> **STILL UNJUDGED: the look.** Nothing above is an owner view-test. The harness
> available here throttles `requestAnimationFrame` whenever its pane is hidden
> (it reported 1030 ms/frame with zero gibs), and a floor of recycling gore will
> not hold still for an A/B — so no frame-time or appearance claim from it is
> trustworthy. What is established is mechanical: the uniforms now arrive.
>
> **ALSO IN THE SQUASHED COMMIT, and not described anywhere below** (these
> landed after the 2026-09-11 banner was written):
>
> - **The carve cuts at JOINTS now.** Pieces were even slabs of each cluster's
>   bounding box (`armL.0/1/2`), which the owner read as "too abstract ... should
>   at least somewhat resemble pieces from the character". They are cut on a
>   NEAREST-BONE-GROUP VORONOI over melt-bones.ts's eleven groups, so a boundary
>   falls where two groups' bones are equidistant — on a limb, the joint. Eleven
>   pieces: skull, cage, pelvis, upper arms, forearms, thighs, shins. `cells` now
>   SUBDIVIDES an anatomical part rather than defining one, and defaults to 1.
> - **Baked per-vertex AO**, because a mesh fragment shader cannot sample the
>   field the way the march's cheap AO does. iq's five-tap against the piece's own
>   clipped field (not the whole body's — a gib flies away from the body, so
>   occlusion by a torso it is no longer attached to would be a shadow from
>   nothing). Opt-in via `bakedAo`, with the same attribute discipline `goreKind`
>   taught.
> - **The tissue ramp no longer runs off the end of its range.** Its knees
>   describe layers under skin and are authored for a crater a centimetre deep; a
>   slab cut is 100 mm deep across its face. 21.2% of vertices were landing on
>   VISCERA and 0.0% on fat — a butcher's cross-section ("beef chunks I get from
>   the Piggly Wiggly"). The depth the albedo sees now saturates at the clot knee,
>   and viscera is gated off plain cuts (the march gates it on the CAVITY mask;
>   the bake had collapsed that to `wm > 0`).
> - **CORRECTION — bones were never in the carved geometry.** The module header
>   claimed "one field over flesh AND its 68 authored bone prims", and that was
>   the headline justification for the carve over the per-piece bake. `sdBody`
>   skips `op === 'bone'` in BOTH folds and says so: "the CPU field never shows
>   it". The test that "proved" it only counted bone prims whose BOUNDING BOX
>   overlapped a region, never a vertex. The skeleton is real on a cut, but as
>   MATERIAL: `makeKindAt` tags the vertices a cut drove INSIDE a bone. Header and
>   test both corrected.
>
> > **Known regression:** the carve library build is ~19.7 s at boot
> (`?gibrender=carve` only, measured idle; was 3-5 s before the anatomical
> partition). The default `march` path is unaffected.
>
> ---
>
> **FOUR causes, all fixed (2026-09-11, second session). Needs an owner view-test.**
> The plaid-texture theory in the row below was a RED HERRING: the blowout survived
> turning that layer fully off, and turning it off made it WORSE (10.9% vs 7.7%).
> 1. **The wound mask was identically ZERO.** `gib-carve.ts` builds its field with
>    `torn: []` (a rest pose has no wounds), but the march's chain is
>    `albedo = mix(baseColor, tissue, wm)` — wm is "the sole authority on whether
>    this pixel is wounded", so the whole tissue ramp was computed and discarded.
>    Measured: **0.00% of 23,846 vertices** had any mask, while **33% of the surface
>    sits >2mm beneath the original skin** — a third of every gib was painted as
>    intact outer skin, alpha 0, fully matte. The CUT is the wound, and depth beneath
>    the original skin is the mask (`cutAwareField`). Now bimodal at the shipped 1 cm
>    cell: 60% skin, 32% meat, ~2% rim.
> 2. **`goreKind` was never set.** The carve uses `createBakedChunkMaterial({goreDetail:
>    true})`, which branches the ENTIRE material on that vertex attribute; the geometry
>    never had one and three said so every frame (`THREE.AttributeNode: Vertex attribute
>    "goreKind" not found on geometry`). An unbound selector takes the organ arm (albedo
>    62% toward a pale wash, wetness forced >= 0.86, gloss 48 -> **220**) or the bone arm
>    (gloss 90). Now derived from the authored bone/organ prims, so exposed ribcage
>    shades as bone. Pinned by a test.
> 3. **`__sdfGame.goreDetail()` never reached the carve** — it wrote only `gorePartMat`,
>    so every live tuning attempt on `?gibrender=carve` was a silent no-op. Same shape
>    as the flashlight bug in the row below.
> 4. **`chunkShade` was the march's INVERSE in two places** — this was the "white
>    concrete". (a) Fresnel: the march does `surfCfg.z * (1.0 - wmRim)`, killing it
>    inside a wound ("whole patches clip to white and sweep across the cavity as the
>    camera moves", X1.17); this did `* (1.0 + wm * 1.5)`. (b) No tone-map shoulder:
>    the march runs lit flesh through `softShoulder` under the beam, this returned
>    `diffuse + specular` raw — and its specular is ADDITIVE, never multiplied by
>    albedo. Both ported. Measured blown-to-white pixels: **7.7-17% -> 0.46%**, against
>    **0.0%** on the marched body in the same frame.
>
> **Carries a caveat:** the shoulder also applies to SETTLED CHUNK bakes (same
> material, they track the flashlight). Deliberate — matching the marched body is the
> point — but it is a visible change beyond the carve and has NOT been view-tested.
>
> **The SDF->mesh pipeline was never missing.** `chunk-bake-field.ts` +
> `surface-nets-cpu.ts` is it (per-vertex albedo mirroring the march's albedo chain),
> and the carve already called it. It was being fed inputs that switched off the half
> that makes meat look like meat.
>
> Read [the handoff](../../docs/dev-notes/2026-09-11-gibs-as-classic-gore-parts/HANDOFF.md)
> first: it opens with this state, the dead ends (a perlin-via-`wgslFn` attempt that
> measurably delivered NOTHING), the traps with their numbers, and the rigs.
> Look at: `?gibrender=carve` (current), `?goreparts=1` (bench, same material),
> `?gibrender=sprite` (rejected, reference).

- [x] **THE OWNER'S LOOK PASSES REJECTED THE BODY'S OWN FLESH** — "tubes and balls",
  then "weird oblong sausages", then (on the procedural mesh parts that replaced
  them) "they just look like crystals rn". The accepted direction is the REFERENCE
  game's: *"generate spritesheets based on the rendered SDF and then cut those up
  randomly and use them in the gibs … sure you trade 3d but its not important in
  this case"*.
- [x] **THE SHEET EXISTS AND CAN SHIP.** `public/assets/lab/gore/{sheet.png,
  manifest.json,index.html}` — **154 pieces from 16 frames (77 clean + 77 from a body
  carrying 10 wounds)**, sheet 512x1950, coverage 0.45/0.78/1.00. Generated from OUR
  rendered zombie, so unlike `public/assets/gibs-placeholder/` (extracted Blood art,
  gitignored, never commit) it is committable.
- [x] **THE PIPELINE.** `blob-turntable.mjs` with `BLOB_MASK=1` writes an EXACT body
  mask per angle by capturing twice (once with `__sdfLab.body` hidden) and diffing —
  that replaced three failed background keys, all measured (the lab's background is a
  fogged AND dithered gradient). `scripts/gib-sheet.mjs` cuts with radial-noise masks
  so edges are TORN (not rectangles), jitters the grid so no two pieces share a
  silhouette, merges multiple sources (`--also`) and packs one sheet + rect manifest
  with each piece's `origin` and source `yawDeg`. `scripts/lib/png-write.mjs` is a
  new PNG ENCODER (the repo had only a decoder), round-tripped against that decoder.
- [x] **WOUNDS ARE BAKED INTO THE PIXELS.** `__sdfLab.wound(n, seed, type)` is a
  direct, deterministic, AIM-FREE seam that REPORTS what it stamped
  (`.woundCount()` reads the body back), because the synthetic-click path measured
  **+0.4%** and could never have worked — the click-shoot pipeline is god-cam-only
  and the capture rig freezes the rig. Clean vs 10 wounds: **25.38% of the body's own
  pixels change** (34.51% at yaw 0).
- [x] **THE BENCH.** `?gibparts=sheet|sprite` (own render vs the reference extract)
  and `?goreparts=1` (mesh parts) are comparable in one place; 308 billboards spawn,
  drawn (shown-vs-hidden **5.38%** of pixels), no page errors.
- [x] **THE BLAST IS WIRED — `?gibrender=sprite`, OPT-IN** (2026-09-11, second
  pass). A render mode BESIDE the piece mode, orthogonal to `?gib=`: the piece set
  still comes from `pieces|clusters|parts`, and this only chooses what each chunk
  looks like. A sprite piece is **the same `Chunk` state** stepped by **the same
  `stepChunk`** with the same colliders — no new physics — plus a billboard quad
  (`webgpu/gib-sprite-pieces.ts`, +21 tests). **MEASURED** (`sdf-gib-sprites-rig.mjs`):
  a blast spawns **19 sprite billboards, 0 marched pieces, tier `sprite`, 0 dropped**;
  all 19 fall, come to rest and PARK (none below the floor); hiding them changes
  **2.93%** of the presented frame; six blasts leave **128 live + 19 parked =
  147 meshes**, exactly the cap, with **1 geometry and 129 materials**. The
  **degradation is retired**: the tier ladder and the `?maxchunks` view pool do
  not exist in this mode, because a quad has no proxy box and no bake — which is
  what produced the owner's original "tubes and orbs" report. Gate PASSES in both
  arms; the wall/ceiling rig PASSES on sprite pieces (8040 piece-frames, 67
  pieces, every one inside a room or tunnel); the **live-loop soak PASSES**
  (`SOAK_QS='&gibrender=sprite'` — 8 detonations, 9 gibs, 211 pieces, 0 stuck
  tears, 0 queued gibs, peak **128 live = exactly the cap**, geometry/material
  held at **1/107**).
- [x] **SPRITES ARE CHEAPER, BUT ONLY THE MARCHED ARM IS ABOVE THE NOISE FLOOR.**
  Paired shown/hidden GPU rows in one boot each (camera AIMED at the pile, with
  `screenPosOf` proving it): marched pieces moved `sdf:march` **+2.90 ms** at 51
  pieces (29 on screen); the sprite arm moved **no row** beyond ±1.4 ms of noise
  with both signs (`sdf:march` itself read −0.28 ms). Cadence is useless for this
  on a vsync-capped page: both arms sat at 16.70 ms. NOT a controlled A/B —
  different boots, different piece sets — so the claim is the narrow one: **a
  sprite blast is not measurably expensive, and the marched path is.**
- [x] **IN-PLANE ROLL.** A billboard that only copies the camera quaternion is a
  decal. The piece's own `longAxis` (a real `Chunk` field, tumbled by the piece's
  real `quat`, the same axis `stepChunk` topples flat) is projected into the
  camera's screen plane and the projection's ANGLE is the roll — no accumulator,
  so it is right after a pause and in a static capture. Degenerate case (axis
  pointed at the camera) falls back to the spin's in-plane direction.
- [x] **NO BLOOD TRAILS IN SPRITE MODE — the owner's first report, and a real gap.**
  `emitTrails` was fed only `liveChunks`, which is EMPTY by construction in sprite
  mode (a sprite piece has no marched view), so a sprite blast threw gore that
  trailed nothing. Both lists now feed it, with the two id spaces OFFSET because
  `emitTrails` keys its per-emitter clock by id and both sequences start at 1.
  MEASURED and pinned by the rig: droplets **38 → 600** while 67 pieces fly.
- [x] **THE ELONGATED OVOID PIECES WERE THE CUTTER, NOT THE GORE.** Owner: *"they
  are all somewhat elongated ovoid shaped, they whould be more chunky like
  squareish"*. **All 154 shipped pieces were tall — median aspect 0.36, not one
  square-ish** — because a fixed `COLS=4, ROWS=4` grid sat over a STANDING BODY's
  bounding rect (~186x392) and every cell inherited its 0.47 aspect. Fixed by
  searching (cols, rows) PER FRAME for the squarest cells near `--cells 16`: **177
  pieces, median aspect 0.97, all square-ish**. Corroborated independently: hiding
  the sprites now changes **5.85%** of the presented frame, up from 2.65%, i.e.
  they really do cover more pixels. The mask also became a 5-gon (`--sides`) with a
  `--polyscale` dial, but **that half is NOT visually verified** — the alpha is
  `body AND polygon`, so the facets only show where the cut lands inside the flesh.
- [ ] Owner asked for **more blood and dirt streaks**: cheapest form is 2-3 wound
  levels merged into the sheet (`BLOB_WOUND_TYPE` = pellet|burn|blast, one turntable
  run each) plus streaks applied AT THE CUT, which needs no shader work.
- [x] **THE MESH PARTS' BUMP WAS NEVER RENDERING — the owner found this by eye.**
  *"when i saw the mesh they had no texture no nothing just albedo"* — correct, and a
  real render bug. Cause: the bump sampled `positionLocal` at 6-43 cycles per unit on
  parts built AT FINAL SIZE (0.075-0.115 m) with no mesh scale, so a whole part
  spanned **less than one noise cycle** — the fbm was a smooth ramp, i.e. a uniform
  normal tilt, not texture. (The blood decals DID land, because one of their fields
  runs at frequency 60 — the only term fine enough to vary at pixel scale.) FIXED by
  scaling the noise domain through `goreCfg.w`, which was declared and never read.
  **MEASURED** (`scripts/gore-detail-ab.mjs`, neighbourhood roughness inside the
  parts' own pixels): **x0.996 at the old unscaled scale → x1.120 at the shipped 12**,
  plateauing 4-32. Live: `__sdfGame.goreDetail({detail, bump, blood, noise})`.
- [x] **THE GIB LIBRARY — the owner's design: bake an archetype's gibs ONCE, reuse
  for every instance.** "we should bake it at spawn and basically reuse across a
  character instance eg all zombies use the same gib library". `webgpu/gib-library.ts`
  (+7 tests) bakes the archetype's `gibParts` split into named meshes and caches them
  per archetype (`gibLibraryFor`), so the second zombie asks for `zombie` and gets the
  same object. It needs NO renderer, NO actor and NO blast: `bakeChunkGeometry` is pure
  synchronous CPU, so a library is built straight from a rest-pose body. **Verified
  against the real archetype** (compiled `characters/zombie.blob`: 23 flesh prims, 6
  clusters, **68 bone prims** → 24 split pieces): the flesh pieces all bake with real
  geometry, baked albedo and a wound mask; geometry is **recentred** (required twice
  over — to re-instance at all, and because the detail material's bump samples
  `positionLocal`, so world-space vertices would give every instance a different,
  grain-fine noise field); and asking twice is provably ONE bake.
- [ ] **KNOWN GAP, and it is the bones: a bone-only piece bakes to NOTHING.** Every
  `bone.*` piece comes out of `bakeChunkGeometry` with zero vertices — the CPU field
  only unions bones in NEAR A WOUND (it mirrors the shader's `applyBones` nearWound
  gate), and a bone piece has no flesh and no wound, so its field is empty. The
  existing design sidesteps this deliberately (`game-main`: "Bone-only pieces retain
  their original SDF path", gated on `data.flesh.length > 0`), because marched bone
  pieces never needed a mesh. A LIBRARY does. **THE FIX:** a bone bake path that
  composes the field from the bone prims ALONE. Pinned as `it.fails` in
  `gib-library.test.ts`, so it starts failing the moment bones land and forces the
  assertion to be promoted; the library also warns per piece
  (`[gib-library] … produced no geometry`) so the gap is loud, never silent.
- [x] **BUILD THE LIBRARY FROM THE COMPILED ARCHETYPE, NOT `makeZombie()`.** A trap
  that cost a test cycle: the TS fallback carries NO authored bones, so a body built
  from it splits into 10 pieces with zero `bone.*` and no `torso.chest` at all — a
  library built from it is a library with no skeleton in it. `characters/zombie.blob`
  compiled through `compileBlob(parseBlob(src))` is the archetype the game uses, and
  the one with the bones.
- [ ] **Bones in the sprite path** — DEFERRED by the owner until the meat direction
  is settled. Today a sprite blast has no bones at all (in the marched path a bone
  piece is its own `kind` with its own thud physics and the pale-bone shade; sprites
  render everything as one billboard).
- [ ] **View-angle sets for the head** (handoff item 4). NOT done, and it is a
  CUTTER job, not a runtime one: the shipped sheet's 154 pieces carry `yawDeg` and
  every one of the 8 yaws is represented (17-23 pieces each), but they are
  INDEPENDENT random cuts, not 8 views of the same part — so there is nothing to
  select between yet. Build it by projecting a piece's 3D anchor into all 8 yaws
  and cutting around the projection; do NOT cut the same screen rect across yaws,
  because the anatomy differs per frame and the piece would morph as it spins.

## Weapon slot 2 — dynamite, for tuning the blast + gib — 2026-09-10

- [x] **UNLIMITED AMMO IS THE DEFAULT** (owner: "it should be unlimited for now to
  make testing easier"). The grapeshot's 2-shell magazine + 1.30 s reload is pure
  friction for a tuning pass, so running dry is OFF unless asked for:
  `?ammo=finite` / `__sdfGame.setInfiniteAmmo(false)`. That flag is now the ONLY
  way to exercise the reload, so `sdf-game-shorty-gate.mjs` — whose whole subject
  IS the reload — boots with it pinned. The dynamite was already unlimited (the
  prop pool refills the hand after each throw's recovery). The gun's 0.45 s fire
  cooldown still applies: unlimited AMMO, not unlimited rate of fire.
- [x] Branch `claude/dynamite-weapon-slot` (worktree `.claude/worktrees/dynamite-weapon-slot`):
  `2` selects a throwable bundle (hold LMB to cook, release to throw), the game's
  FIRST live-actor gib, and a procedural GPU explosion. Gate:
  `node scripts/sdf-game-dynamite-gate.mjs <vite> <cdp>` — PASS, zero page errors.
  [design + evidence](../../docs/dev-notes/2026-09-10-dynamite-weapon-slot/README.md).
- [ ] **OWNER LOOK PASS PENDING** on both the bundle prop's hold pose and the
  fireball. `?explosionfx=procedural|standin` A/Bs it in-page;
  `node scripts/sdf-explosion-fx-shot.mjs` writes the PNG pairs. Numbers measured,
  look NOT judged.
- [x] **"i didnt see any skeleton chunks and the gib parts still looked like tubes and
  orbs" — REPRODUCED, AND THE CAUSE WAS THE POOL DEFAULT, not the piece set.** The piece
  pool is GLOBAL and a pile from earlier blasts is charged against a later blast's budget,
  and `?maxchunks` shipped at **24** — the exact count of the split piece set. So a blast
  that gibs several bodies can only afford the full set for the FIRST one, and the rest
  walk down the tier ladder to `clusters+cage`: six tubes with the skeleton packed INSIDE
  them. Reproduced twice, deterministically, by `node scripts/sdf-pile-crowding.mjs 5391
  9391 24 64` (five blasts in a row in the arena): at **24** the 3-body blast gives
  `parts-core:16` then `clusters+cage:7`, **17 of the last body's pieces dropped and 18
  recycled on the frame they were born, `buriedBonePieces 6`**; at **64** the same blast
  gives `parts:24` to every body with `buriedBonePieces 0` (pile 28 bone pieces / 154
  rows). Default is now 64 (`?maxchunks=N`, 1..96). NB a body in round 1 reads `parts:19`
  — that is the SOLDIER (19 pieces), the arena roster is mixed, so a tier log can only be
  read with the piece count beside it.
- [x] **...AND THE GATE PASSED THROUGH THE WHOLE BUG.** At the old default the gate's own
  gib probe reported `lastGibTier: clusters+cage`, 17 pieces dropped, "18 of this gib's
  pieces recycled immediately" — and PASSED, because the bone-census assertion is
  conditional on `lastGibTier === 'parts'`, i.e. skipped in exactly the degrading case.
  The gate now asserts the SHIPPED configuration never degrades the last body of a
  multi-body blast (`knobbed` runs are exempt and print the row), and it was proven to
  FIRE by setting the default back to 24 and watching it fail with the owner's own
  condition. Also: both the gate and the new rig now call `Network.setCacheDisabled`,
  because that falsification run first reported the NEW default and PASSED — Chrome served
  a cached transform of `game-main.ts` while vite served the edited file. **A long-open
  tab serving a stale module graph is the other candidate explanation for an owner look
  pass that does not match the numbers; hard-reload before judging.**
- [x] **THE COLLAPSIBLE TUNING PANEL the owner asked for** ("or if you want me to manual
  tune please add another tuning panel that is collapsible"):
  `src/lab/sdf-zombie/webgpu/dynamite-panel.ts` (+ `dynamite-panel.test.ts`), fourth slot
  (right:782px) beside GOO/WOUND/VHS, visible but collapsed, hidden with them on `H`.
  19 rows generated from ONE key table, which the test pins against
  `applyDynamiteTuning`'s switch cases — the "a tuning that LOOKED applied and was not"
  bug has shipped twice here (setBeam, then goo). Presets `split` / `tubes (old)` (his own
  A/B) and `plume` / `ball (old)`. Every gib knob it owns is now `let`, so a slider lands
  with no reload: `maxChunks`, `gibMode`, `gibBones`, `gibStaggerFrames`, `gibTearSec`,
  `gibVelScale`, `fxSize`, plus `tearShape {amplitudeM, jiggleAmp}` pushed to every actor
  (including bodies that start tearing later). Seams `__sdfGame.setDynamiteTuning(patch)` /
  `.dynamiteTuning()` / `.dynamitePanel(on)` / `.dynamitePanelCollapsed(on)`.
- [ ] **A gib is 24 pieces** for a zombie (12 flesh + 11 bone + 1 organ) and **19** for a
  soldier against a 64-view pool: `?maxchunks=N` raises it and the tier ladder
  (`parts` 24 → `parts-core` 15 → `clusters+core` 9 → `clusters+cage` 7 → `clusters` 6 →
  a nearest-first slice) degrades the shape rather than the count — which is also the knob
  to raise if a crowded blast still reads as tubes. `lastBlastMs` is 18-28 ms per
  detonation (CPU, headless) and the cap barely moves it — the resolver's trace/wound
  split dominates.
- [ ] The burst does **not light the room**: `explosion-vfx.ts` exposes
  `lightIntensity` and nothing feeds the probe gather's dynamic light list yet.
- [x] **THE ARENA** (owner: "the rooms are quite small... we might need a big open
  space with some zombies"): a 16x16x6 m chamber east of the annex, 8 zombies,
  `__sdfGame.teleport(6)` to jump straight in. Roster 15 -> 23. Its 6 m ceiling
  forced the bundle's ceiling to resolve PER ENCLOSURE (`ceilingAt`) rather than
  from one global plane. **The annex is now a through-room** (it gained an east
  door) — a topology change, flagged in game-level.ts; the three level gates that
  assumed it was sealed were updated to assert BOTH halves (the door exists AND
  the closed sides still contain a capsule).
- [ ] Arena look unjudged: 2 braziers at power 13 in 8x the volume of an 8x8x3 m
  room — the frame reads brighter than the corridor rooms (mean 80 against 23-35),
  though 8 bodies at close range could account for that. Owner's call.
- [x] **Perf: the blast pause, round 2 — the wound phase was still 18.1 of a
  22.0 ms resolve.** Two levers, both measured. (1) The CARVE-depth probe, the
  SECOND `probeFlesh` call per wound, was never capped: 150 `sdBody` folds
  against the rim probe's 36. It is capped now at the point past which the
  shader's slab cannot bind (`thick ≥ radius / 0.45`), so the carved field is
  unchanged — `?carvecap=0` is the control, woundMs median 7.6 vs 13.6.
  (2) A body this blast is about to GIB no longer gets 16 wounds stamped on it
  that nothing reads (`ResolveExplosionOpts.woundsOnGibbed`, default TRUE so the
  lab/tests keep their contract, FALSE from the game): interleaved in one boot,
  woundMs median **8.5 → 0.0**. Seams `?gibwounds=1`, `?carvecap=0`,
  `__sdfGame.setGibWounds(on)`. [Detail](../../docs/dev-notes/2026-09-10-dynamite-weapon-slot/README.md).
- [x] **Perf: the blast pause, round 1. `trace 5.2 + WOUND 50.2 + cut 0.3` ms** — the cost
  was never the field or the chunk spawn, it was `probeFlesh` marching 150
  `sdBody` folds per wound for a measurement only used as `min(1, thick/2·lip)`.
  Capped exactly at `2·lip` (`?woundcap=0` is the control): woundMs median
  **8.8 vs 26.9** interleaved in one boot, 3x. End-to-end the gate's
  `lastBlastMs` went **45 → 25 ms**. Splits exposed at
  `__sdfGame.dynamite().blastProfile` / `.resolveProfile`.
- [x] **Gib quality: the SPLIT PIECE SET + the skeleton as its own pieces** —
  `src/lab/sdf-zombie/gib-parts.ts` (+13 tests): torso → chest/abdomen/pelvis,
  every limb at its joint, head whole, and the skeleton released as bone-ONLY
  chunks (the eleven `partitionBones` groups: ribcage, spine/pelvis mass, skull,
  eight long bones). Measured: **zombie 24 pieces (12 flesh + 11 bone + 1
  organ), soldier 19**. Cuts are SEALED and CAPPED (a `sub` sphere per side,
  `2 × blendK` past the plane), so the union of the pieces still covers the
  body's surface to within the cluster seam — 5.4% of surface points off by
  >2 mm against `gibAll`'s 3.7%, both bounded by the same 27 mm at the armpit.
- [x] **The body→gib TRANSITION, stages (a) and (b)** — pieces spawn at their
  posed transform with ZERO velocity and their blast impulse is QUEUED over
  `?gibstagger` waves (default 3), nearest-the-blast-first, so frame 0 is the
  body's own silhouette and it comes apart outward. The queue's delay counts
  DRAINS, so every piece gets at least one full frame at rest (a frame-indexed
  queue released the first wave before the first frame was DRAWN). MEASURED
  frame by frame by `scripts/sdf-gib-look.mjs`: 24 held at frame 0, then 16, 8,
  0 — and that rig prints what the body became BY NAME, including `bone.cage`.
- [x] **THE REAL LOOP, not just `step()`** — `node scripts/sdf-dynamite-soak.mjs
  5391 9391 [rounds]` throws real bundles on the game's own rAF loop (it never
  calls `step` and never stops the loop) and detonates on live bodies, sampling
  throughout. That is where the pre-tear window, the deferred spawn and the view
  pool meet variable dt and overlapping blasts — every other rig in the repo
  drives tidy 1/60 s slices instead. It asserts no page errors, a pool that
  never exceeds its cap, nothing left `tearing`/`pendingGibs` after settling, and
  that no bone piece ever shades as meat. Measured: 3 throws → 3 detonations →
  `bone 11 buried 0`; 6 detonations / 8 gibs / 90 pieces in one run; peak pool
  24 of 24. It also found the `selectSlot(2)` trap (below).
- [x] **`selectSlot()` REFUSES A KEY NUMBER** — `WeaponSlot` is the string union
  `'shotgun' | 'dynamite'` and the seam silently accepted `selectSlot(2)`: the
  switch ran, `phase` read `'up'`, NOTHING was live, and every later press was
  dropped with no error anywhere (a soak rig lost an hour to it). The seam now
  returns `{ok:false, reason:'unknown-slot:2'}` and the gate asserts the refusal.
- [x] **The gate runs against the feature's own A/B controls.** `GATE_QS` boots
  the same gate on a knob (`GATE_QS='&gibtear=0'` the instant swap,
  `&gib=clusters|pieces` the legacy piece sets), so "`?gibtear=0` restores the old
  behaviour" is checked rather than claimed. All four arms PASS; the knob runs
  report the bone census instead of asserting it, because a legacy piece set has
  no bone pieces by design.
- [x] **The AIR burst is still a fireball, measured.** `PLUME_KIND=air
  node scripts/sdf-plume-shape.mjs` reads fire 1.47 x 1.52 m (a ball) and smoke
  1.88 x 1.85 m, against the ground burst's 2.72 x 2.18 (a plume) and 3.75 x 3.10
  (a flattened cap) — i.e. the shape terms differentiate the reference's two
  sequences the way the reference art does. An in-hand detonation is an air
  burst, so this is the case a "make it a mushroom" change most easily breaks.
- [x] **"You can see it" is measured, not argued** — the bone census proves the
  pieces are FLAGGED as bone; `scripts/sdf-gib-look.mjs` now proves they reach
  the FRAME by hiding them and reading the RENDERER's march-target `frameHash`
  (it changes when they go, and a no-change control reads identical). Three
  attempts were needed and the two discarded ones are documented traps: a capture
  without a draw, and the explosion VFX ageing in the RENDER path so every draw
  differs (control 55k px). Reach for `frameHash` first.
- [x] **The tier ladder now guarantees a ribcage in a crowd.** Measured in the
  arena — the room the owner tests in — a point-blank bundle gibs FIVE bodies,
  and with a reserve floor of 6 slots every one of them got the shape whose bones
  are BURIED: `bonePieces 0`, i.e. no visible skeleton at all, which is the
  complaint reproduced by the allocation. Floor raised to 7 and a
  `clusters+cage` rung added (six limb chunks + the ribcage ALONE, the one bone
  group worth a slot when there is exactly one), so a body down to seven slots
  still shows a ribcage.
- [x] **The skeleton is in the pile AND DRAWING AS BONE — asserted from the page,
  which is the claim "you can see it" rather than "it was spawned".**
  `chunkCensus()` now reports, per live piece, what it was spawned AS
  (`bonePieces`, `boneRows` packed, `organPieces`) against what it will RENDER as
  (`bonesShadingAsMeat`, `organsShadingAsBone`, `buriedBonePieces`), and the
  dynamite gate asserts five things about it. Measured: a throw's gib reads
  `bonePieces 7, boneRows 35, bonesShadingAsMeat 0, buriedBonePieces 0`; a
  two-body blast into a 24-piece pool reads `bonePieces 3, buried 6`, and into a
  48-piece pool `bonePieces 22, buried 0`.
- [x] **The tier ladder put the skeleton back in the meat, so it was fixed.**
  The bone census caught it: a degraded blast spent the first body's allowance on
  a bone-FREE twelve-piece flesh set and the second's on six `clusters` chunks
  whose bones are packed INSIDE the meat — `bonePieces 0`, i.e. the owner's
  complaint reproduced by the fallback. The bone-free rung is gone (still
  reachable as `?gibbones=off`, which makes it the first tier) and a
  `clusters+core` rung (six limb chunks + skull/cage/pelvis as bone-only pieces)
  took its place, so every body down to six slots keeps a visible ribcage.
- [x] **THE BLAST TELEPORTED BODIES: the rig shove was handed a VELOCITY where it
  wants METRES.** Owner, playing: *"the shockwave or whatever causes a weird animation
  glitch for bodies not close to the explosion where they are like teleported outside the
  screen then animated backwards"* — and that is exactly what the code did.
  `impulseAt(bound, world, delta)` displaces the nearest rig point by `delta` **metres**;
  every other caller passes metres (`IMPULSE[type]` is 0.04-0.18, motion's `kick.delta`),
  and `blast()` passed `impulse.vel` — the resolver's concussion **velocity**, 2.0 m/s at
  the launch floor and **25.2 m/s point-blank**. So a body at the radius edge had one
  joint teleported ~11 m out of frame and the rest-pose pull then sprang the whole body
  back over the following frames. `RigImpulse`'s own doc already said so: *"a world point
  plus a concussion VELOCITY (m/s) — the wiring turns it into an impulseAt
  displacement"*. Fixed by `shoveFromVelocity` (one frame of travel, capped at 0.35 m —
  which lands a radius-edge body on the same 0.18 m a blast WOUND shoves by, so the two
  paths finally agree). Measured: the pose `blast()` writes now moves **0.18 m**, against
  **5.5 m** before (11 m for the joint itself). Four tests pin it and the falsification
  run fails at 5.5.
- [x] **The AOE is now focusable — `aoesize` and `edge fling` on the panel.** Same
  session, same report: *"it seems the effective radius of the explosion is quite large …
  the area of effect should be abit more focused"*. `ResolveExplosionOpts` gained
  `radiusScale` (multiplier on every distance-gated term at once: damage, wounds, launch,
  hand band, prune) and `launchFloor` (how much of the point-blank launch survives to the
  radius EDGE — the shipped 0.45 is NotBlood's "edge survivors fly comically", and it is
  the other half of why the blast feels big). Both default to the reference, so the
  shipped blast is unchanged until he moves a slider. **The fireball's size is
  deliberately NOT folded in** (`burst.heightM` still uses the REFERENCE radius): the look
  was tuned and judged on its own via `?fxsize`, and a gameplay slider that silently
  resized it would invalidate that pass. The gate asserts the slider reaches the
  RESOLVER (radiusM 4.6875 → 2.34375 at 0.5x).
- [x] **A SEAM THAT REPORTED A CONSTANT MADE THE NEW KNOB LOOK INERT.** The `detonate`
  seam returned `radiusM: explosionRadiusM()` — the reference CONSTANT, not `fx.radiusM` —
  so the first run of the new gate assertion read 4.6875 at BOTH slider positions and
  failed. Every rig in the repo reads that field, so any radius tuning would have looked
  like it did nothing. The seam (and `dynamite().lastBlastRadiusM`) now report what the
  blast actually resolved at. Same bug class as the `?maxchunks` half-wiring: **when a
  knob looks inert, suspect the instrument before the knob.**
- [x] **Does the blast light the room? YES, and it is measured — plus it is now a
  slider.** `node scripts/sdf-explosion-light-check.mjs` sweeps the arena's WHOLE-FRAME
  mean: at the shipped `fxlight=1` it goes **30.16 → 39.05 (+8.89, ~30% brighter)**, with
  0.5 and 2.0 reading +4.93 and +15.19, i.e. the light carries across the room and scales
  linearly. Both the real detonation and the capture seam ignite it. `?fxlight` was a URL
  knob only, so it is now `blast light` on the panel (0-4) — "is this enough room light"
  is his call, and a reload per attempt is not how to answer it.
- [x] **THE BLAST'S LIGHT DID NOT REACH — it was inverse-square by construction.**
  Owner: *"the explosion seems to have a rather small radius of light effect"*, and
  *"lighting the room will fix it"* for picking the gibs out of the dark. A packed probe
  light accumulates as `intensity / d²` (`probe-dynamic.ts` and its WGSL twin), so at 2 m
  a wall got 1/4 of the peak and at 8 m 1/64: a bright disc of floor at the crater and
  almost nothing across the room. `DynLightInput.fill` adds the SOFT component a real
  detonation has (the flash scattering in air, dust and smoke) at
  `intensity · fill / (1 + d²/LIGHT_FILL_REF_M²)` — REF 4 m, so the far field is
  **12.8x** the hard term's contribution at 8 m for the same peak. It rides in the packed
  light's `cosInner` slot, which a POINT light never reads (the cone branch is gated on
  `cosOuter > -1.5`), so no buffer layout changed. MEASURED in the arena: the probe
  gather's own radiance **1476.6 → 3056 (+107%)**, peak **3.9 → 10.4**, and the CPU twin
  agrees. `?fxspread` / panel `light reach` (default 1.2, 0 = the pure point light).
- [x] **...and the light DOES cross the room — measured in the frame, per tile.** The new
  `scripts/sdf-blast-light-reach.mjs` reports the presented frame as a 4x4 tile grid with
  an `fxlight=0` control at the same frame age, because a whole-frame mean cannot tell
  "the crater blew out" from "the room filled". Measured: the blast's own contribution is
  **min +3.1, median +5.6, max +18.6 across ALL SIXTEEN tiles** — it lifts the far corners,
  not just the crater. What it is NOT is large: the fill's OWN marginal effect on the frame
  is +1 to +1.5 in a handful of mid/far tiles, because the dynamic probe layer is applied
  at `probeDynGain 0.15` and the room's baseline lighting dominates it. **The strong lever
  the owner wants is therefore `blast light` (`?fxlight`), which scales the mesh pool and
  the gather together: measured +8.89 whole-frame mean at 1x and +15.19 at 2x.**
- [x] **A THROTTLED BACKGROUND TAB MADE THE LIGHT LOOK BROKEN.** The first version of the
  reach rig waited in wall-clock time between arms and measured a FROZEN page: the
  explosion light sat at `age 0` and never aged, the probe readback froze at whatever the
  last gather wrote, and every "frame" was the same stale presented image — so the fill
  measured as exactly zero effect twice. The rig now drives frames with `step()`, prints
  the light's age (a stalled page is visible in the output rather than inferred), boots ONE
  ARM PER BOOT (the readback stops updating after a few gathers in one boot: measured, arms
  4-6 all returned arm 3's value), and disables the module cache.
- [x] **DETACHED PIECES HAD NO WALL COLLISION AT ALL.** Owner: *"it seems the gibs dont
  bounce off the walls/have collission"* — correct, and the mechanism was that
  `stepChunk` knew about exactly one surface: a floor plane at `y < radius`. A piece
  thrown at a wall flew through it and out of the level. The stepper now takes the
  LEVEL'S OWN collider boxes (`levelColliders()` — the same walls the player and the
  wander clamp collide with, **split around every doorway and tunnel mouth**, so a gib
  sails out of an open door and bounces off the wall beside it) plus the page's existing
  per-enclosure `ceilingAt`, because the collider boxes stop at `WALL_H` and the ceiling
  is not one of them. Sphere-vs-AABB with the closest-point normal, restitution
  `wallRestitution 0.55` (mirroring the floor), and the tangential component damped by
  the floor's own 0.72 — a gib skids along a wall exactly like it skids along the floor.
  A piece whose CENTRE is inside a box (a fast one tunnelling a thin wall in a frame)
  is pushed out along its shallowest penetration axis.
  MEASURED, `scripts/sdf-gib-wall-bounce.mjs`: **771 piece-frames were in no enclosure
  at all (inside a wall or through one) without the colliders, and 0 with them** — and
  the highest piece centre fell from **4.87 m to 2.97 m**, i.e. pieces were also going
  out through the 3 m rooms' roofs. Six unit tests, including the doorway gap and a
  bit-identical check that a stepper given no geometry behaves exactly as before.
- [x] **THE BODY TEARING IN HALF AND RUBBER-BANDING BACK — the signal's direction was
  handed a VELOCITY.** Owner: *"its like a rubberbanding effect … the upper torso/arms/head
  fly off leaving just the legs and then they rubberband back to the body"*, on bodies that
  are NOT gibbed. `stagger.ts` builds the hit reaction by scaling the signal's `dir` by
  METRE amplitudes (`lurchAmp` 0.26, `flinchAmp` 0.085) into `rootOffset` plus
  `offsets.chest`/`offsets.neck`/shoulders — so `dir` must be a UNIT vector — and `blast()`
  was passing the resolver's concussion **velocity**: 0.26 × 25.2 × 1.3 (gain) = **8.5 m**
  of chest-and-neck offset. MEASURED intra-body chest-to-foot span after a point-blank
  blast: **0.667 → 8.23 m in five frames**, easing back to 0.67 m over the next half second.
  Fixed with `unitOrZero` at the signal boundary (the only violating caller — the pellet and
  slug paths pass `dirN` / a `/dl`-normalized vector), and the contract is now written into
  `stagger.ts`'s header and the `ShotSignal` type. Re-measured: **0.305 m**, which IS the
  designed lurch (0.26 m × gain), i.e. a body that leans into a hit instead of tearing.
  Three tests, including one that the same direction at a tenth the speed produces the same
  reaction.
- [x] **...AND THAT IS ALSO WHAT THE EARLIER "TELEPORT" REPORT WAS.** The `impulseAt`
  m/s-vs-metres bug (fixed in `1d843e16`, capping the joint shove at 0.35 m) was the SMALLER
  half: it produced a 0.35 m joint displacement with a hidden `delta/dt` = 21 m/s kick. The
  dominant term was this lurch scale, which the cap never touched — which is exactly why the
  same complaint came back from the other end. Two lessons: a cap on a displacement does not
  fix a wrong unit, and `pos += delta` without `prev` is a kick of `delta/dt` (a Verlet
  point's velocity IS `pos - prev`), so `impulseAt`'s "0.18 m" is really 10.8 m/s.
- [x] **GORE PARTS, FIRST SLICE — the shapes and a bench to judge them on.** Owner:
  *"i would prefer if like upon explosion the whole character became chunky meaty textured
  and blood stained mesh parts … it doesnt really have to resemble the SDF body part shapes
  at all … bones … classic bone silhouette shaft with knobby heads"*. Built:
  `src/lab/sdf-zombie/gore-parts.ts` (+11 tests) — five MEAT variants (ico shell + seeded fbm
  + QUANTIZATION onto a coarse grid, with a cut plane on the severed ones) and four BONES
  (capped tapered shaft with TWO LOBES PER END, so a head reads as a condyle, not a ball on a
  stick), painted through the game's own meat ramp (`bakeChunkAlbedo`) with the part's own
  procedural wound mask and depth fields as the blood decal. De-indexed before
  `computeVertexNormals`, so the normals are FACE normals: faceting is what separates "meaty
  chunk" from "tube", and it is the whole point. `?goreparts=1` lays a bench of 18 parts in
  front of the spawn through the REAL gib mesh path (shared `createBakedChunkMaterial`, same
  `bakeColor` attribute, same router registration); `__sdfGame.goreShowcase()` re-lays it and
  `.goreShowcaseVisible(on)` hides it. MEASURED drawn: presented-frame differential shown vs
  hidden **1.54% of pixels** against a **0.84%** no-change control, no page errors. Capture
  `/tmp/gore-parts/showcase.png`.
  **NOT wired into a blast yet, and the blood/normal detail is per-VERTEX, not per-pixel** —
  both deliberately second, so the shapes are judged first. The design note records that the
  mesh material is shared and single-purpose, so a procedural decal/normal layer is real work
  and belongs with the wiring.
- [x] **THE SPRITE BENCH — the reference game's approach, wired.** Owner: *"generate
  spritesheets based on the rendered SDF and then cut those up randomly and use them in the
  gibs … sure you trade 3d but its not important in this case"*, then *"placeholder atlas is
  fine to see how it feels then we can generate our own sheet"*. `?gibparts=sprite` lays
  **54 billboards** (every frame of the reference atlas at 0.34 m and 0.2 m) through
  `webgpu/gib-sprites.ts`: per-piece `PlaneGeometry` sized to the sprite's own aspect
  (a leg gib is a long rectangle, a head is square), `MeshBasicNodeMaterial` with
  `map`/`transparent`/`depthWrite:false`/`alphaTest`, billboarded CPU-side at spawn and per
  frame (`tick` early-returns under the render lock, so a capture would otherwise shoot the
  bench edge-on). MEASURED: 27 atlas frames load, 54 billboards, no page errors, drawn —
  shown-vs-hidden **13.23% of pixels** against the mesh bench's 1.5%. The atlas is the
  DEV-ONLY Blood extract (gitignored, never ship), so this path warns and degrades on a
  fresh clone; it exists to answer one question before any generation work: does a billboard
  read as gore in this room. **The reference sprites are 10x5 to 26x22 px** (Blood's native
  res), which is the argument for generating our own at our own resolution. Known limits
  recorded: sprites are UNLIT (no per-pixel room light — they read pasted-on in a dark room),
  alpha quads with `depthWrite:false` sort by draw order, and a billboard has no side
  silhouette.
- [ ] **OWNER ON THE BONES AND THE "OBLONG SAUSAGES".** He reported no bones again —
  "idk maybe its too dark in that room" — and that the chunks "still look rather like
  weird oblong sausages". The census says the skeleton IS in the pile and drawing as bone
  (22-30 bone pieces, 120-174 bone rows, `buriedBonePieces 0`, `bonesShadingAsMeat 0`),
  so the two live hypotheses are (a) it is genuinely too dark to pick pale bone out of
  gore — the new `blast light` slider tests that in ten seconds — and (b) a stale tab.
  The SAUSAGE read is a real aesthetic gap and is NOT yet addressed: the pieces are the
  body's own SDF prims, so they keep the body's material and read as clean flesh tubes.
  Candidates (not started, needs his steer): tint the pieces toward blood, add a grime/
  noise term to the chunk material, or carry the body's accumulated wounds onto the piece.
- [ ] **OWNER LOOK CALL on the release sequence.** `node
  scripts/sdf-gib-look.mjs 5391 9391 /tmp/gib-look` writes 10 frames (0 → 667 ms)
  and refuses to pass if two consecutive frames are identical. Whether the body
  reads as being torn apart is the owner's call; everything else about it is a
  measurement.
- [ ] Stage (c) (the ~0.1 s pre-tear bulge) needs the body to OUTLIVE the
  swap — a gibbing blast stamps no wounds and retires the actor in the same
  frame, so the rim-splay pump has nothing to swell yet.
- [x] **The pool is the gib's ceiling, and the shape now degrades before the
  count does**: `?maxchunks` caps a multi-body blast, and the greedy
  nearest-first allocation with a floor held back per remaining body hands out
  the richest rung that fits. Measured in the arena (a point-blank bundle gibs
  2 bodies there, 5 when the horde is packed): 7 pieces per body of
  `clusters+cage`, 23 of 24 views used, `bonePieces 4` with 79 packed bone rows.
  **The last clause of that measurement is now WITHDRAWN** — "a visible ribcage
  survives even in the cheapest rung" is true of the PILE and false of the BODY:
  those 4 bone pieces came from the FIRST body's `parts-core` rung plus the
  second's single cage, and the second body's own six chunks had their skeleton
  buried (`buriedBonePieces 6`). `sdf-pile-crowding.mjs` measures it per body now.
  The blast side is nearly free (`lastBlastMs` 17.6 / 18.4 / 17.9 ms at 24 / 48 / 64).
- [x] **What a piece costs — FINAL, on the frame cadence.** `node
  scripts/sdf-piece-cost.mjs 5391 9391 [qs]` alternates pieces shown/hidden in
  30-frame bursts on the LIVE loop and reports the real inter-frame delta:
  **16.70 ms in both arms, 22 of 22 pieces in frame, paired difference zero across
  eight bursts.** RE-RUN AT THE NEW DEFAULT (2026-09-11, `?maxchunks=64`, 61 pieces
  live of 64 with 4 in frame): **16.70 ms both arms again**, paired difference 0.00 ms
  across all eight bursts, `sdf:march` 12.82 shown vs 12.42 hidden. So the pieces do not move the frame rate
  — and the honest caveat is that a vsync-limited page hides any cost that fits
  the budget by construction: the same run cross-references `sdf:march` at 20.19
  shown vs 17.54 hidden, i.e. **~2.7 ms of a 16.7 ms budget**. That is the number
  the pre-bake had to beat; it does not beat it.
- [x] **What a piece costs, and why the MESH PRE-BAKE IS DECLINED.** `sdf:march`
  cannot compare two states (the SAME state read 2.6, 3.8 and 18.8 ms in one
  boot), so the earlier "5.1 → 6.7 at 24, 4.0 → 13.1 at 48" claim was inside the
  instrument's own spread and is WITHDRAWN. Measured PAIRED and interleaved
  instead: **~0.5 ms per frame per piece that is IN FRAME** — 24 pieces cost
  0.50 ms, 64 pieces (9 of them in frame) cost 4.82 ms — and hiding only the
  OFF-SCREEN pieces saves nothing (frustum culling measured −0.29 ms, so it is
  reverted, with the reason left at the mesh itself). The pre-bake's prize is
  therefore a few ms for the ~1 s a gib is airborne, against a pose seam at
  release, the pieces losing the body's accumulated wounds, and a boot-time bake
  pipeline. Seams: `__sdfGame.setChunksVisible(on)`,
  `chunkCensus().inFrustum`. [Measurement + decision](../../docs/dev-notes/2026-09-11-piece-cost-and-the-pre-bake-decision/README.md).
- [x] **§3(c) the pre-tear flesh distortion — BUILT.** The body is BENT by the
  shockwave for `?gibtear` seconds (default 0.1, 0 = the old instant swap) before
  it becomes pieces: `src/lab/sdf-zombie/gib-tear.ts` (+7 tests) displaces every
  posed prim outward from the blast, weighted `e^{-d/0.6}`, shuddering at 20 Hz,
  VIEW-ONLY (the actor's `posed()` stays clean, so the pieces are built from the
  undistorted pose and the hand-off is exact). It is a JS prim displacement, not
  a shader term — the design note's "a per-frame uniform plus a shader term" was
  wrong: no uniform displaces the marched field per prim, and adding one means
  threading `mapBody`'s 19-parameter signature, its 13 call sites and the
  chunk-view copy list, while the POSE path already re-packs every prim row and
  refits every cull bound each frame. Three bugs came out of the gate and the
  look rig: a `tearing()` predicate that never went false, a clock that lived in
  the (skippable) body step so `?frozen=1` left bodies bent for ever and never
  gibbed, and a piece counter that counted only the blast frame. MEASURED frames
  0-2 bending → frame 3 the hand-off to 24 pieces → waves at 4 and 6.
- [ ] **§3(d) the body-sized debris puff — DE-PRIORITISED, and the reason is
  the same measurement that declined the pre-bake.** The puff existed to cover
  the ONE frame where the representation changes (§4: an SDF body becoming a
  pre-baked MESH). With SDF pieces there is no representation change to cover:
  frame 0 IS the body's own silhouette, measured (24 held impulses, all pieces
  at their posed transform, union within the cluster seam). So a puff here would
  buy nothing but a layer between the player and the gore the owner is judging,
  after he already cut `?fxsmoke` to 0.38 for exactly that reason. Build it only
  if he asks for debris for its own sake — the mechanism is a smoke-only burst
  from `explosion-vfx.ts` at the body's centre, which needs a per-burst tuning
  override.
- [x] **The explosion: the size bug and the ball.** `?fxsize` was applied
  TWICE on the procedural path (2.38× smaller than the atlas it is judged
  against) and the stand-in had a third convention — one multiplier, three arms,
  now. The ball was four terms: one isotropic spread feeding x/z/y, `stretchY ≥
  1` in both envelopes, a centre-weighted spawn direction, and no fire role.
  All four are gone: separate horizontal/vertical terms, a `flatten`, a rim
  spawn, and half the fire now rides the CAP. The ring's reach and the sparks'
  speed are bounded to the plume. `?fxplume=0` is the round-ball A/B (four
  settings, not one). [Write-up](../../docs/dev-notes/2026-09-11-explosion-plume/README.md).
- [ ] **OWNER LOOK CALL on the plume.** `EXPLOSION_FX=atlas|procedural`,
  `FX_QS='&fxplume=0'` and `FX_TUNING='{"ringOpacity":0}'` on
  `node scripts/sdf-explosion-fx-shot.mjs` write the PNG pairs. CORRECTED
  2026-09-11: an earlier claim here said the reference's mass sits in the air and
  ours at the crater (centroid 332 vs 440). **That was the ground RING.** The
  ring is a large low-lying annulus that dominates the changed area, so a
  whole-burst centroid mostly measures the ring. With it dropped
  (`FX_TUNING` above) the same arm reads **centroid 362 against the atlas's 332**
  — 30 px of 600 at 3.4 m, i.e. the plume's vertical mass distribution is already
  where the reference's is, and there is NO measured case for raising it. The
  centroid repeats to under a pixel across boots; the CAP-STEM BAND metric that
  used to live beside it was removed (the same arm read 7.45 then 0.26 — its
  boundaries come from the bounding box, which one stray pixel re-cuts).
- [x] **The plume's shape, in metres, as its own rig** —
  `node scripts/sdf-plume-shape.mjs 5391 9391 [qs]` reads the module's own
  per-layer geometry (`explosionFx().layerExtents`: the box each layer DREW and
  the mean height of its bottom/top quartiles, in world units) instead of
  photographing it. Gated: the fire's mass RISES (0.77 → 1.92 m), the layer has
  spread, the smoke is a late bloomer, and the cap ends wider than tall
  (3.75 × 3.10 m against a 1.68 m reference quad). The control arm
  (`FX_QS='&fxplume=0'`) reports fire 1.21 × 2.71 m and a cap 2.72 × 3.75 m —
  taller than wide, no flatten — so the switch is real in geometry. CAVEAT, and
  it is why sizing is still the owner's call: these are BILLBOARD extents and
  the fire's round falloff means the visible fire is well inside them.
