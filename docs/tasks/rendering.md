# Rendering and performance

The march, temporal work, the upscaler, post, perf sessions. Part of the task wiki: [TASKS.md](../../TASKS.md) is the front page. Sections are newest-first where dated; each keeps its own history.

## Selective shutter blur — owner accepted and merged 2026-09-17

- [x] Blood + rotating gibs default ON at 44.44 ms / 120 px; lab comparison and in-game controls shipped.
  [Wrap-up, controls, evidence and limits](../../docs/dev-notes/2026-09-17-shutter-blur-game/WRAP-UP.md).
- [x] Hidden blur-panel bug fixed: **BLOOD + GIB BLUR** docks bottom-right, clear of Dynamite / Gib; H toggles visibility.
- [ ] Quiet-machine combined blur cost measurement; prior loaded-machine marginal timings are inconclusive.
- [ ] Investigate first-use gib-material compile hitch and in-app-browser GPU loss during warm-up; Chrome boots successfully.
- [x] **Boot stuck on "compiling pipelines" then WebGPU device lost — root-caused and fixed 2026-09-18** (uncommitted on
  `claude/webgpu-shader-compile-timeout-a59a9d`). NOT machine state: the march pipelines cost 75-100 s to compile whenever the
  OS-level Metal shader cache is cold, which is after ANY march WGSL edit (measured by changing one `smin` constant: `drawOnce`
  1.8 s cached -> 80-101 s cold, main thread blocked in `createShaderModule`). The warm-up built them SYNCHRONOUSLY in
  `drawOnce`; headed Chrome's GPU watchdog killed the GPU process mid-stall (Crashpad: gpu-process, `gpu_watchdog_thread.cc`),
  so the compile never finished, never cached, and every reload failed until a headless run filled the cache. Fix: the warm-up
  awaits `sdfLayer.precompilePasses` (async pipeline creation, `PRECOMPILE_COLD_PASS_TIMEOUT_MS` = 180 s per pass) BEFORE
  `drawOnce`. Headed A/B, cold cache: unfixed = `device-lost` after a 73.8 s blocked `drawOnce`; fixed = 75.8 s idle wait,
  `drawOnce` 1.1 s, gate `ready`. Cached boot unchanged (~2.3 s warm). The in-app-browser GPU loss above is likely the same.
- [x] **Mid-game "freeze after switching slug/pellets" — root-caused and fixed 2026-09-18.** Not the ammo switch: the first
  DISMEMBERMENT of a session (the slug is just what severs first) drew the shared gib/chunk march material — its own ~240 KB
  shader variant that no boot object uses — and three built it SYNCHRONOUSLY mid-game, once per context (gib shutter
  half-float layer, then the march MRT). Measured on a cold Metal cache: a 47.8 s no-frames stall, then a second one. The
  warm-up now adds a throwaway chunk view on the shared material before the async march compile, and
  `gibShutter.precompileSubject` compiles the shutter context. Probe after: zero large sync pipeline creations in play, worst
  frame 187 ms. This is also the old "first-use gib-material compile hitch" item above.
- [ ] Residual 100-190 ms hitches remain on the first slug hit / a later pellet hit (one small pipeline created each) — not
  yet attributed.
- [x] **Cold march compile attributed + cut (2026-09-21):** cost scales with `mapBody` CALL SITES (Metal inlines each). Merged 3
  groups bit-exact (180 s -> ~28 s), then calcNormal taps via one site (-> ~17 s; owner-approved march-hash re-pin, max RGB diff 6e-6).
  [Notes](../../docs/dev-notes/2026-09-21-march-cold-compile/NOTES.md). Rule: never add a `mapBody(` call site.

## Neural upscale (ESPCN family) — flesh 400×300 → 800×600 — 2026-09-11

- [x] Spec approved: `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md`.
  Reopens the 09-08 idea (that pilot was 1.4k params). Stage contract, `sp`/`dc` layouts.
- [x] P1+P2 built (plan `docs/superpowers/plans/2026-09-11-neural-upscale-p1p2.md`): stage, both layouts,
  G1-parity and the G2 capture pipeline — verdicts in `docs/dev-notes/2026-09-11-neural-upscale/`.
- [x] G2 pairs PASS (re-run r4): gate re-scoped to linear-depth registration — marches aligned at (0.0002, 0.003) px;
  colour and centroid checks were misreading aliasing. 60 pairs, 559 MB in /tmp (regenerable) — `g2-pairs.md`.
- [-] G1 cost bench (plan Task 6) DEFERRED 2026-09-11 (owner: machine under load; quality first, optimize after).
- [x] P3 spec `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md`; plans p3a–p3d + contracts in `docs/superpowers/plans/`.
- [x] P3a capture v2 built — smoke 24 pairs OK (`p3a-capture.md`). Owner: run the full ~1,000-pair capture (runbook in the plan).
- [x] P3c in-game loader: `?upscale=trained&upscalemodel=<name>`, U key A/B, G3 parity script — smoke **PASS** (`sp 1.71e-3` ≤ `2e-3`) once the fixture moved to seed 1, the G1-reference seed. The twin's `f16round` now rounds half-to-even (a correctness fix; it moved no number — this workload hits no ties). G1 parity re-run PASS on all 7 configs. `p3c-ingame.md`.
- [x] P3d pre-flight PASS on the 60 smoke pairs: train, G3, pull round trip, dashboard, in-game smoke (`p3-preflight.md`).
- [x] OWNER VERDICT 2026-09-12: **worth it** — playtested in-game, stable 30 fps, "smooth and details are not bad".
  All six runs passed G4 (best s32-rgbd 0.0233 vs bicubic 0.0284, nearest 0.0314, native 0.0141) for $2.21 of pod time.
- [x] LOCAL GRID 2026-09-12 (MacBook Air, 20k steps each): s32-rgbd best **0.02289** (G3 PASS, staged in
  `.upscale-models/s32-rgbd-best`; `?upscale=trained&upscalemodel=s32-rgbd-best`). Steps are spent (every run
  peaked by 16k); width is not (s8→s16→s32 = 0.0248→0.0238→0.0232); depth input buys nothing. Pod deleted.
  Assessment + next steps: `docs/dev-notes/2026-09-12-upscaler-next-steps.md` (Obsidian copy in Research/).
- [x] S64 GRID WITH NORMALS + FLIPS + 9-CHARACTER ROSTER (2026-09-12) — DONE, best **s64d-rgbn 0.0145** vs bicubic 0.0191 on v3
  (normals + width stack; 3rd layer > 2× width; depth useless; edge band is where normals pay). Results §6 of the
  next-steps note. **Runtime normals LANDED same day** (renderer-level MRT around the march, second attachment
  for `?upscale` boots only; `dc` layout refused at 64 wide — 17 sampled textures): `v3-s64d-rgbn-best` loads
  in-game (`?upscale=trained&upscalemodel=v3-s64d-rgbn-best`), compile smoke PASS on all configs, G3 PASS 6e-7.
  Trained-smoke GPU-vs-twin sits at 3–5e-3 vs the 2e-3 bar for EVERY s64 model incl. the no-normals one — f16
  accumulation at 64 wide, bar unchanged, owner's call (p3c-ingame.md). Fields + stage stack was tried and
  REVERTED the same evening (owner: "looks bad" — comb artifacts sharpened; needs a fields-on retrain first). Built: `s64`/`s64d` ladder in py+ts;
  `rgbn`/`rgbdn` input sets (Python side; TS twin + runtime MRT normals still TODO before an rgbn model can ship
  in-game); flip augmentation in `CropSampler` (vector-aware); march debug mode 9 = world normals,
  `__sdfGameDebug.readMarchNormals()`, capture writes view-space `normal.npy` (contracts §1). Smoke v3 6 pairs OK
  (unit normals, hit mask identical, 7.7 s/pair). Roster: zombie goblin soldier + bonewalker clown cyberdemon
  female gnasher minotaur (the other lab bodies fail to spawn: no motion joints). Launch: `.lab-tmp/grid-s64.sh`.
- [x] COST BENCH (the deferred P1 Task 6): upscale legs added to `scripts/sdf-game-bench.mjs`
  (`march-half`, `upscale-s8`, `upscale-s32`, `upscale-s32-rgbd`); clean 3-repeat run in `/tmp/sdf-game-bench-upscale-clean`.
- [x] **SHIPPED 2026-09-12: s32-rgbd + CAS sharpen 0.5 is the default boot** (`public/assets/lab/upscale/
  s32-rgbd-best.json`; `?upscale=0` = native). s64 REJECTED (6x compute, no visible gain). VHS 'blud' retuned
  (intensity 0.81, blur 0.17). Unsharp mode tried, left off. Decisions: next-steps note §8.
  FOLLOW-UP: `scripts/sdf-game-bench.mjs` `baseline` leg pins `setUpscale(null)` and is no longer ship truth —
  add a ship leg that loads the tracked asset before trusting any new baseline number.
- [x] RUN 3 DONE (2026-09-12): t24/t16 dilated ladder, reparam, gradient weight 1.0 — ALL within ±1 % of s32-rgbn
  (0.0157–0.0164). The s32 cost class is saturated on L1; t16-rgbn (half cost, −3 %) is the cheap-tier candidate.
  Next quality step = full-res procedural detail channels (demodulation) + a look metric, not net shape. Note §12.
- [x] WOUND MEAT DETAIL (2026-09-12): soldier wound band gets clots / striation / crevice / shattered glints
  (march.wgsl.ts soldierWound block), uniform `meatCfg` + wound-panel MEAT group (4 sliders); march param count
  re-pinned 99 → 100. Owner look pending (Chrome lost WebGPU under the training load — relaunch).
- [x] **RUN 4 — FULL-RES RELIEF (radiance demodulation) — DONE 2026-09-13, head KEPT.** Controlled pair on v3.1
  (652/57 pairs): s32-rgbn-head-int2 **0.01443** vs control 0.01474 (2–3 % on every region, inside noise); t16-head
  0.01505. Owner look: "subtle, not a regression" → keep. G3 PASS 7e-7; trained-smoke head 3.0e-3 (control 1.5e-3),
  the head's f16 pass, bar unchanged. Staged `.upscale-models/r4-*` (`?upscale=trained&upscalemodel=r4-s32-rgbn-head-int2`).
  Results + reading: next-steps note §13. NEXT CANDIDATES (Obsidian `Research/2026-09-13-upscaler-sample-the-surface-
  not-the-march.md`): one-step SDF refinement at output res → same head; meat/albedo through the anchor channel;
  temporal via anchor MVs (shared with shutter motion blur — build blur conventionally first).
- [x] **RUN 5 — ONE-STEP SDF REFINEMENT AT OUTPUT RES — DONE 2026-09-13; QUALITY WIN, COST TOO HIGH AS BUILT.**
  Spec `docs/superpowers/specs/2026-09-13-neural-upscale-run5-sdf-refine-design.md`, plan + log
  `docs/superpowers/plans/2026-09-13-neural-upscale-run5-sdf-refine.md`. Controlled pair on v3.2 (748 pairs):
  refine head **0.01112** vs control 0.01455 (−24 % overall, −32 % face; native 0.00905). Gate 2 (owner): "definitely
  the best looking, especially at medium distance" — but frame +23 % (room 1) / +45 % (room 2); `sdf:refine` 6–11 ms.
  Staged `.upscale-models/r5-*` (`?upscale=trained&upscalemodel=r5-s32-rgbn-headr-int2`). Results §14 of the
  next-steps note. Gates: refine-smoke, refine-check, march-hash (fields-off canonical a8ab4efa), G3 9e-7.
- [x] **RUN 5b — refine gating + graceful degradation + slim twin tail — DONE 2026-09-13, GATE MET.** refine_drop
  retrain 0.01118 (refine on) / 0.01511 (off); slim tail −7…14 % of the pass; band gating (standing bodies, 1.5–3.5 m,
  hysteresis; dead never refines in either cull mode; corpse bake hides the twin); body-ownership early-out (key in
  the normal attachment'"'"'s alpha). Clean bench: 5b slim+band 21.3/24.3 ms vs control 21.9/22.2 (−3 %/+9 %); open band
  30 ms. §15. Owner: "at medium lgtm" → ships as the **high** graphics setting.
- [x] **DEFAULT-MODEL BENCH — DONE:** t16-rgb (v3.2, 0.0154; no normals, no head) 19.0/18.7 ms vs ship s32-rgbd 19.5/20.4
  vs r5-head 21.9/22.2. Owner: **t16-rgb is the new default**.
- [~] **SHIP: t16-rgb default + `graphics=high` (5b refine head) — in flight.** Track both exports under
  `public/assets/lab/upscale/`, boot by setting (`?graphics=high` / `__sdfGame.setGraphics`), keep CAS 0.5; bench
  `upscale-ship` leg points at the new default. Then merge to main.
- [x] **BOOT/MID-GAME FREEZE — FIXED 2026-09-13** (e71cee3d…3c1480f1): `SdfLayer.precompilePasses` compiles every
  twin layer in its own target+MRT (gated on the pass's own enable flag; 8 s race per compile) plus the private
  fullscreen passes, `UpscaleStage.precompile` every net pass incl. sharpen; `[warm]` log now counts them. First
  refined frame 21 → 6 ms in the headless check. `flashAge`/`bounceSpotGain` hoisted; a `drawReady` gate closes the
  rest of the TDZ class (the draw callback was armed ~4700 lines before boot finished). Boot warm-up 1.0 → 1.9 s.
- [ ] **SHELL-HULL TWIN SHADER IS BROKEN** (pre-existing, found by the warm-up work): `unresolved value 'woundBound'`
  in its `mapBody` call — turning the shell pass on yields a failed pipeline (and hung `compileAsync` before the
  race). Own ticket; until fixed, off-at-boot passes are not warmed and would stall once if switched on mid-session.
- [ ] **MERGED CROWD MARCH — HIGH PRIORITY AFTER RUN 5b (owner 2026-09-13: crowds are the game; gibs would
  otherwise be an explosion of marched instances).** One union field, one ray per pixel. Split by what varies:
  per TYPE (shared by all zombies): face sheet, segment-volume atlas, rest prim template, material/lighting knobs;
  per INSTANCE (a record in a storage buffer): pose/bone transforms, wounds + severed flags, melt/flash, variant,
  placement. Prim rows: first keep CPU posing and share one tall atlas with per-instance row ranges; later pose on
  the GPU from the type template. Tile list (`?tiles-playtest`) becomes the per-pixel instance/cluster index. One
  material per type; gibs become instances; the refine becomes a fullscreen pass (no twins, no Task E).
  Hand-off brief for a fresh session: `docs/superpowers/specs/2026-09-13-merged-crowd-march-brief.md` (Obsidian
  copy in Planning/). Design + stage (a) plan written 2026-09-13 (autonomous session; decisions D1–D10 need owner
  ratification): spec `docs/superpowers/specs/2026-09-13-merged-crowd-march-design.md`, plan
  `docs/superpowers/plans/2026-09-13-merged-crowd-march-stage-a.md` (8 tasks: baselines → records → one-slot
  kernel [hash gate] → CrowdType → `?crowd=1` → parity + crowd bench → default flip). D1–D10 ratified by owner
  2026-09-13. D1–D10 ratified by owner 2026-09-13. **Stage (a) 0–7f + stage a-2 landed** (a-1 records/one-slot kernel,
  a-2 CrowdType/`?crowd=1`, 7b parity gate, 7d slot table + frame guard, 7f spread spawns; a-2 quad dispatch
  `b3ee7742`: one full-screen quad per type, tile-sphere entry, empty-tile discard, `?crowddispatch=quad|boxes`,
  default quad). Canonical per-body hash `a8ab4e…` unchanged; quad/boxes parity PASS. **Stage a-2 (2) knee
  (2026-09-14, `## Stage a-2 (2)`):** the quad removes the duplicate-trace growth (cost per visible body flat
  ~7–8.5 ms over 5→17 visible; 2.18x total 2→8 vs the boxes' 13.68x in 7f) but paid a fixed full-screen cost —
  at 2 bodies the boxes' walk (12.26 ms) beat the quad's (41.12 ms, 3.4x). **Stage a-2 (3) — union screen-rect
  quad (2026-09-14, `## Stage a-2 (3)`, code `1c68162f`):** each type's quad now rasterises the CPU-computed
  union NDC rect of its visible instances (`crowdScreenRect`, one LIT tile of margin; full screen if an inflated
  corner is behind the eye; meshes hidden if none visible), shared by the lit material and its depth-pre twin;
  `info()` reports `rect`/`rectFrac`. Parity quad+boxes PASS with every gated line identical to a-2 (1). The
  low-`n` fixed cost is **gone**: n=2 walk quad 0.99–1.23× boxes (was 3.4×), quad ≤ per-body in rooms 1–2, n=8
  overall 69.64 ≤ the a-2 (2) 92.99, 16 completes at 132.38. But `rectFrac` is already 1.00 from n=8 up (the
  rect has nothing left to give at high `n` — the cost is the flat per-body slope over a screen-bound quad),
  **n=20 aborts the frame guard (probe never answered in 60 s) and 24 was not attempted.**
  **Distance-crowd bench (2026-09-14, `## Distance crowd` in the dev note):** the a-3 bar was re-measured on the
  scene the game actually shows — the player in room 1's near corner down the 11 m diagonal, a 0.9 m grid of
  bodies in the far-half 3.5 x 7 m strip (~6.3 m mean camera distance), camera pinned (`holdPlayer`) and
  wanderers frozen. Sweep 8/12/16/20/24 at scales 1.0 and 0.5: **every row completed, including 24 at ship
  scale** (`sdf:march` 30.20 ms overall / 30.33 walk, fenced 36.42 ms; `rectFrac` 0.50, `clampedTiles` 0),
  and **crowd-quad beat per-body at every completed n at both scales** (total march 0.35–0.63x at 1.0, 0.79–0.84x
  at 0.5; per-visible-body 0.54–0.68x at 1.0, tie at n=8 0.5). **RECOMMENDATION: FLIP THE DEFAULT (Task 8) —
  quad dispatch on, per-body behind a flag.** Both flip conditions hold. Remaining non-blocking gap: the 48-body
  `tile-binning-submit < 1 ms` bar is untested (48 bodies at 0.9 m fit no region in this level; a
  longer-sightline space is future work). Plan
  `docs/superpowers/plans/2026-09-14-merged-crowd-march-stage-a2-tile-quads.md`.
  **DEFAULT = CROWD MARCH, BOXES DISPATCH (2026-09-15).** The revert below rested on a bench whose legs
  fought different fights (`setCrowd` mid-session respawns the cast; fixed in `sdf-game-bench.mjs`). On matched
  fights the crowd march with the instanced-box dispatch beats per-body on the owner's real room-1 recording
  (frame p50 17.3/15.4 vs 19.8/19.2 ms) and keeps the 8..24-body wins; the one-screen quad does not (20.3/20.2)
  because of raster footprint no exact lever removed (`docs/dev-notes/2026-09-14-crowd-firefight-cost.md`).
  `?crowd=0` opts out; `?crowddispatch=quad` keeps the quad reachable. Canonical hashes: default (boxes)
  `0b84c119…`, `MARCH_HASH_CROWD=1` quad `a350361d…`, `MARCH_HASH_PERBODY=1` `a8ab4efa…`. Next test of the
  crowd: the owner's WIP branch with dynamite and an 8–10 zombie room.

  **DEFAULT REVERTED TO PER-BODY (2026-09-14 evening).** The equal-workload bench on the owner's 56 s
  room-1 recording (`BENCH_DEMO`, both legs replay the same fight) is a wash overall and the crowd quad
  loses the fire-heavy third by ~15 ms (three overlapping type quads cover 45–81 % of the screen each);
  its wins are 8..24-body scenes that ordinary rooms do not hold yet. `?crowd=1` opts in; canonical
  hashes: default per-body `a8ab4efa…`, `MARCH_HASH_CROWD=1` crowd `a350361d…`. Two crowd bugs fixed on
  the way (baked corpses kept marching, 87ca510c; full-screen quad for a near-plane-straddling body,
  dc4a7a4c). Next lever: per-instance rects / a shared union quad. See `## Flip decision bench` in
  `docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md`.

  **TASK 8 DEFAULT FLIP LANDED (2026-09-14, task-8 commit `the merged crowd march is the default; ?crowd=0
  opts out`):** the merged crowd march (quad
  dispatch, tile list on) is the SHIPPED default — a flagless boot attaches every actor to its character type
  and draws one union field per type. `?crowd=0` (or `__sdfGame.setCrowd(false)`) opts out to the per-body
  path; `?crowd=1` is accepted as a no-op. `crowdInfo()` reports `{ on, default: true, flag: 'crowd=0' | null,
  fallbackReason, tilesOn, dispatch, types }`. New canonical march hash (crowd quad, tiles on)
  `a350361d6a223946a4cb8aac9bc2a3a70ee15bfd` (wounded `07f60ecf…`); the per-body hash
  `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` is unchanged and reachable in one self-checking command via
  `MARCH_HASH_PERBODY=1 node scripts/march-hash.mjs`. **Crowd tiles are mandatory:** the per-type
  `ComputeTileBinding` always bins and the draw fn stamps `tileCfg.x = 1`, independent of the per-body
  `?tiles-playtest` switch (the old cross-coupling let a ship-defaults `setTiles(false)` silently pin the
  crowd to the slow cluster walk). **Compatibility rule:** `?refine=1` or the cone pass forces the boot
  per-body (the refine twins/cone read per-body state the instance record does not carry), warns once
  (`[crowd] refine/cone twins are not supported under the crowd march (stage 3); falling back to per-body for
  this boot`), and records the reason in `crowdInfo().fallbackReason`. Flip bench rooms 1–2
  (`BENCH_LEGS=baseline,crowd-off`, `BENCH_PASSES=1`, `BENCH_REPEATS=1`): `sdf:march` room1 13.41 (crowd) vs
  66.61 (per-body); room2 33.59 vs 37.63 — crowd ≤ per-body in both. **What remains:** stage 3 (refine as one
  fullscreen record-reading pass; delete the REFINE_LAYER twins), stage 4 (gibs as a chunk/slot type, corpse
  bake for every character), the 48-body `tile-binning-submit < 1 ms` bar (needs a longer-sightline scene; no
  region in this level holds 48 at 0.9 m), and the per-instance `segVolumeMeta` gap (bone-cull 'segment'
  falls back to 'cluster' for attached views).

  **Determinism gate PASSES (2026-09-14, demo-recorder stage 1)** — the reason the fire/gib
  crowd-vs-per-body verdict was held ("the two legs shot different fights") is fixed.
  `BENCH_QUERY='seed=4242'` + the bench's `?simidle=1` boot make the scripted scenario play
  the same fight every run: `census-diff.mjs` exit 0 across 3 repeats with the census AND the
  frame hash identical, on a loaded machine. Re-run the flip's fire/gib legs with that query
  before merging the flip. See `docs/dev-notes/2026-09-14-demo-recorder.md`.
- [ ] **BAKED MESH LOD (plan 2026-09-14):** `docs/superpowers/plans/2026-09-14-baked-mesh-lod.md` — L1 textured bake (rest-anchor + aux vertex attrs, per-pixel detail/mottle/meat/gloss; the "untextured smooth corpse" fix), L2 corpse bake for every character, L3 distance LOD (per-type segment bake shared by all instances, posed per frame, hysteretic band; removes far bodies from the march). Owner 2026-09-14: distant crowds are the real crowd case.
- [ ] **CORPSE BAKE FOR EVERY CHARACTER:** `corpseBakeEligible` is soldier-only (`profile.name === 'soldier'` +
  collapse settled), so dead zombies keep marching at full cost. Extending eligibility to any settled actor is
  mostly the flag (the bake rejects on overflow and falls back). Independent of the upscaler.
- [ ] P4 (brainstormed, spec pending) — **read `docs/dev-notes/2026-09-12-visual-direction-handoff.md` first**:
  upscaler as an AESTHETIC tool (90s pre-rendered CG, soft ray-traced, characters only, normals + adversarial loss),
  blood overhaul (conventional rendering FIRST — narrow-range filter, refraction, volume — then learn it cheap),
  gibs parked pending the prebaked-mesh rework. Cost bench (P1 Task 6) still deferred.
- [ ] P3 plain-language overview for the owner: `docs/superpowers/plans/2026-09-11-neural-upscale-p3-overview.md`
  (copy into Obsidian `Claude Notes/Research/` once macOS stops blocking writes to ~/Documents). Nothing executed yet; dispatch order: p3a/p3b/p3c parallel, then p3d.

## Raymarch — Claybook cheap wins — 2026-09-09

- [x] Last-step SECANT accept in `MARCH_BODY` (Claybook GDC slide 25), behind
  `perfCfg.w` — 0 = off, bit-identical to the old march. `?laststep=K` on the game and
  bench pages, `__sdfGame.setLastStep(K)`. A/B (`BENCH_LEGS=baseline` + prelude):
  room 1 11.92 → 10.17 ms; rooms 2-4 inside repeat spread. Close-up pair looked identical.
- [x] Wound soft shadow uses iq's TRIANGULATED coverage (slide 39), same 14 samples.
- [x] Ships ON: `GAME_LAST_STEP = 4` in `game-main.ts`; `?laststep=0` restores the old march.
- [-] Per-frame narrow-band VOLUME bake of heavy bodies (their core trick) judged not
  worth a spike. Notes: `Claude Notes/Research/2026-09-09-claybook-gdc-sdf-techniques.md`.

## Current focus

> **Session start: read
> [docs/dev-notes/2026-09-10-PASSOFF-3.md](../../docs/dev-notes/2026-09-10-PASSOFF-3.md) first**
> (latest: R1 shipped, then TWO temporal ideas built and killed — held-row
> reprojection and accumulation-as-reconstruction — plus the per-object motion-blur
> idea that was then unspecced (blood/gib shutter blur is now accepted and merged;
> see the [wrap-up](../../docs/dev-notes/2026-09-17-shutter-blur-game/WRAP-UP.md)), and the open items). Then
> [docs/dev-notes/2026-09-10-PASSOFF-2.md](../../docs/dev-notes/2026-09-10-PASSOFF-2.md)**
> (R1 and what it unlocked). Then
> [docs/dev-notes/2026-09-10-PASSOFF.md](../../docs/dev-notes/2026-09-10-PASSOFF.md) —
> the earlier session's, still correct except that its NEXT-ACTION ORDER is done
> (its item 1 was R1). Both carry the CURRENT vs HISTORICAL doc map and the traps.
> Everything below is the detail behind them.

> **THE MARCH'S CHEAP TEMPORAL LEVER IS ALREADY BANKED — DO NOT REBUILD IT.**
> Temporal START (start the ray from last frame's reprojected hit depth, margin
> 0.25 m) SHIPS, owner-passed, `?tstart=0` to disable: room-4 march p50 17.4 → 7.3
> ms pre-gate, 14.9 → 11.3 with the own-body gate. C2's half-rate per-pixel
> reprojection is built and VERIFIED (raw hold lags dx=+21 px, reproject dx=0) and
> retired to a toggle. What remains is ONE thing: the held rows of a DEEPER
> interlace get no reprojection. Scoped experiment, first change and the numeric
> acceptance test (dx ≈ 0 at nf=3) are in
> [docs/dev-notes/2026-09-10-temporal-reprojection-NEXT-SESSION.md](../../docs/dev-notes/2026-09-10-temporal-reprojection-NEXT-SESSION.md)
> §"SCOPED — 2026-09-10, session 2".

> **HELD-ROW REPROJECTION: BUILT, MEASURED, AND REJECTED — DO NOT RE-DERIVE IT.**
> Worse, the close-up that sold it: at the owner's REAL viewing range (body at
> 4 m, walking-speed strafe) the reprojection does not move h/3 toward h/2 AT ALL
> (h/2-vs-h/3 is 6.00 levels with it off, 6.17 with it on). It works only when a
> body fills the frame (at 0.7 m, h/3 vs a same-pose ground truth: 15.53 → 9.25,
> −40%), because parallax scales as 1/distance and the reprojection is
> HORIZONTAL-only by design. The owner's verdict: "it looks exactly the same."
> The residual at range is the ROW STRUCTURE (two rows in three are other
> INSTANTS), which is also what "the lines are way too distracting at 3 and 4"
> meant all along. CONSEQUENCE: the motion-vector follow-up inherits the same
> ceiling — do not build it expecting deeper interlace. Code: `main` @ fc7c70c7
> (inert, OFF), branch `held-row-reproj` @ 81a87262 (wiring + rig), unmerged.
> **TEMPORAL ACCUMULATION — PROCEEDING (owner: "some ghosting is not a big deal
> since it adds to the degraded CRT look").** The cost side is measured: a
> **half-scale march (`setSdfScale(0.5)`, a quarter of the marched pixels) is
> worth `sdf:march` 8.18 → 4.12 ms and the fenced frame 16.64 → 8.51 ms — ~8 ms of
> a 16.6 ms frame**, the best single lever measured this session. Below 0.5 there
> is nothing left (0.35 buys 0.2 ms of frame). Bench legs `sdfscale-0.75/0.5/0.35`.
> THE OWNER LOOKED: **`setSdfScale(0.5)` alone is "too pixelated and aliased"**, so
> the RECONSTRUCTION is the point of the exercise, not a nicety. PLAN:
> [docs/superpowers/plans/2026-09-10-temporal-accumulation.md](../../docs/superpowers/plans/2026-09-10-temporal-accumulation.md).
> Its design rests on three verified facts — the march target IS `sdfScale`'d; the
> composite ALREADY nearest-upsamples it at output res; and the level must stay
> CRISP (so the accumulation is FLESH-ONLY, before the composite, never of the
> composited result). The accumulation must be at OUTPUT resolution: into the
> low-res grid it is only a blur, and the JITTER — which changes which low-res
> texel each output pixel reads — is what turns it into supersampling.
> **GATE 1 PASSED (2026-09-10).** Implemented (OFF by default; turning it on turns
> the field weave off). Still-camera convergence against a converged FULL-SCALE
> accumulation: **5.818 → 0.347 mean |Δ| levels, settling inside the 17-frame window
> α=0.25 predicts** — the reconstruction works. The metric matters: against the
> UNJITTERED scale-1.0 render it reads as a catastrophic regression, because that
> render is one aliased sample and removing aliasing must look "further away"; a
> converged accumulation is the fair reference. A nearest reconstruction cannot work
> (a sub-pixel jitter becomes a two-pixel texel flip; the tell was that sharpness was
> UNCHANGED) — it is bilinear now. Resolve cost 0.05 ms against the 4.06 ms the
> march gives up. **NEXT: a clean cost run on an idle machine, then the owner's eyes
> in MOTION for shimmer** (ghosting is pre-accepted; shimmer is the unshippable one).
> Camera reprojection only, no validity/clamping/object vectors in v1 (ghosting
> pre-accepted by the owner). Frame-hash question DECIDED in
> [docs/dev-notes/2026-09-10-temporal-accumulation-frame-hash-DECISION.md](../../docs/dev-notes/2026-09-10-temporal-accumulation-frame-hash-DECISION.md)
> (keep every layer and ADD the accumulated one; the accumulator must be
> resettable and epoch-labelled; the gate is a sequence comparison from an epoch;
> the jitter must NOT be frozen by demoHold).

> **THE MARCH'S PIXEL-WASTE METRIC IS BROKEN, AND THAT IS THE FIRST THING TO
> FIX.** `__sdfGame.occupancy()` returns BEFORE the discard, so inside overlapping
> proxy boxes the giving-up fragment wins the depth test and reports "no flesh":
> room 4 read 29,588 marched pixels and ZERO hits, with 1.0 mean steps on the miss
> rays. Rooms with 3 bodies therefore price nothing. Rig:
> `scripts/sdf-march-occupancy.sh`; write-up in PASSOFF-2 §2.1. Fix the reader
> (post-discard hit flag) before trusting any pixel-waste number.

> **THE MARCH'S STEP AXIS IS EXHAUSTED — measure before levering.** Every step
> lever is banked (plain sphere tracing at omega 1.0, wound step 1.0, the secant
> last step, footprint AA) or owner-observed dead (over-relaxation → box washes;
> the quarter-res depth prepass → visible geometry deletion, reverted the same
> day; the cone pre-pass; deeper interlace). The missing measurement is a
> per-pixel STEP-COUNT HISTOGRAM. See PASSOFF-2 §2.1.


### 2026-09-10 — R1 SHIPPED: the gather is 10–32× faster

**DONE, VERIFIED, BENCHED.** `compute:probe-gather` **4.00 → 0.18 ms** (room 4)
and **4.87 → 0.15 ms** (room 3). The pass used to run one thread per PROBE (400
threads = ~7 workgroups of 64, ~35% of one wave, no latency hiding) and measured
near-perfectly LINEAR in ray count, i.e. unshareable per-ray work executed
serially. It now runs one thread per (probe, ray) — 200 workgroups at 32 rays —
with a workgroup-local reduction folded by each probe's lane 0. Labelled GPU
total **−2.1 to −2.5 ms/frame**. Evidence, tables and the full trail:
[docs/dev-notes/2026-09-10-r1-gather-dispatch-implemented/](../../docs/dev-notes/2026-09-10-r1-gather-dispatch-implemented/README.md).

**EQUIVALENCE IS PROVEN, NOT ASSERTED.** Against the pre-R1 build (`49fb77ee`,
worktree) in identical conditions: the dynamic probe layer differs by **at most
one ulp (5.96e-8) at every ray count**, the hit structure is identical
(non-zero float counts equal at all 11 sweep points), and **`rays=1` is
BIT-IDENTICAL** — which, because that output depends on the whole capsule/box/
light set, also certifies the two boots fed the gather byte-identical inputs.

**READ BEFORE ACTING ON THE OLD ORDER.** R2's target was ~56% of 4 ms; the pass
is 0.18 ms now, so R2 is worth ~0.1 ms — a poor trade, exactly as the design
predicted. Cadence 2→4 was −5.2% at 4 ms and is ~0.2% of the frame now; the
owner's look call should be made on the LOOK alone.

**OPEN AND UNEXPLAINED: `sdf:march` reads 1.2–1.5 ms HIGHER** in four R1 runs
across two rooms. Most of it is a pass-boundary move (the frame's unlabelled gap
shrinks by about the same amount), but the residual is not explained, and the
control that would settle it must gate the gather at the SOURCE: `setProbeRays(0)`
does NOT work as a gather-off control (with no rays the march row collapses to
~0 ms and the gap balloons to 11–12 ms).

**NEW SEAMS — `?dynblend` / `?dynfall`** (+ `__sdfGame.setProbeBlend` /
`setProbeFall`), both pinned in the bench reset block. Set BOTH to 1 for a
history-free gather: without them no cross-run A/B of the gather is a measurement
at all (two boots of ONE build disagree, because the afterglow depends on how many
frames the run dispatched before the read). `?dynblend=1` alone is not enough —
the rate is `lumNew > lumPrev ? blend : fall`.

**GATES.** `scripts/sdf-gather-dispatch-check.sh` measures it (in-page FNV over
the f32 bit patterns + the raw buffer; `--diff A B` compares two saved runs with
NO browser). vitest pins the barrier shape (exactly one, top-level, unreachable
behind any guard), the ABSENCE of a count guard in the kernel, the power-of-two
`threadsPerProbe` that keeps a probe's ray group inside one workgroup, and the
module-scope workgroup declarations in the GENERATED WGSL, not just the source.

### 2026-09-10 — R1's consequence: the gather is now a QUALITY knob

**THE GATHER IS NO LONGER A BUDGET LINE.** At 0.15–0.39 ms, the light count
(1/2/4 caps) and the ray count (16/32/64) are inside the instrument's own
resolution: six bench legs came back non-monotonic and all stayed under 0.39 ms
(new legs `probe-lights1/2/4`, `probe-rays16/64` in `scripts/sdf-game-bench.mjs`).
The defensible claim is the BOUND, not a slope. **Consequence: more lights, more
rays and more frequent gathers are now affordable, and R2 is not.**

**TRACERS: MEASURED, RAISED TO gain 6 / slots 4, THEN REVERTED TO 2 / 2 — same
day, 2026-09-10.** The raise was on a real measurement (one boot, one frozen
volley, noise floor 284 px with ZERO above 2 levels: the shipped defaults changed
1,796 pixels by >2 levels, gain 6/slots 4 changed 369,088 = 76.9%); the REVERT is
on the owner's look, and its reason is a limitation of the rig rather than of the
plumbing — **the rig freezes the volley, i.e. it measures the STEADY STATE**, while
in play the light moves and the afterglow ramps over ~4 frames; and **in the room
you shoot FROM the muzzle flash is already lighting it**, so a faint second light
is not what you would notice. The plumbing is proven (the light reaches the
probes; the layer responds exactly linearly, 0.5338/gain-unit per 2 tracers; the
light count is exactly what the cap implies). **Tracer lights would earn their
keep in a room you are NOT in, where nothing competes with them** — revisit
alongside the multi-room work below, and turn the SLOT CAP first (the bigger of
the two levers: 1,796 → 207,929 pixels at shipped gain).
[docs/dev-notes/2026-09-10-tracer-light-visibility/](../../docs/dev-notes/2026-09-10-tracer-light-visibility/README.md)
(evidence, before/after images in `shots/`, and the three rig traps).
Rig: `scripts/sdf-game-tracer-light-check.sh`.

**NEXT (sketched, NOT scheduled): LIGHT ANOTHER ROOM.** Owner wants it "at some
point... maybe some kind of basic is it in the line of sight algorithm". Sketch
with what already exists (the `TUNNELS` room graph via `accentRoomsFor`, the
per-room light list `levelSceneLights`, per-room grids, `segmentHitsBox` as the
LOS primitive) and the one hard constraint — **a `probeDyn` storage node is bound
at material creation and CANNOT be rebound**, so each receiving room needs its own
node at build time:
[docs/dev-notes/2026-09-10-multi-room-dynamic-light-SKETCH.md](../../docs/dev-notes/2026-09-10-multi-room-dynamic-light-SKETCH.md).
Cost is no longer the obstacle (0.18 ms per room per gather, after R1).

**AND THE LIMIT THAT MATTERS: the dynamic light is SINGLE-ROOM BY CONSTRUCTION.**
Shooting INTO another room lights nothing, and no gain value changes that: the
tracer is dropped from the light list outside the gather's room + 1.5 m
(`tracer-lights.ts`), the probes being lit are the PLAYER'S room's
(`dynRoom = enclosureKeyAt(player.pos)`), and there is exactly ONE 400-probe
dynamic layer bound into the level lighting (`game-main.ts` ~2107, ~2255). The
muzzle flash has the same gate — which is the giveaway that this is the
architecture, not the tracer feature. Doing it for real needs a layer per lit
room, a gather per room with a light, and per-room material binding; the GPU time
is small (0.18 ms/room) and the bookkeeping is the work. Also note the rig above
measures an UPPER BOUND (frozen volley = the steady state); in play the light
moves and the afterglow ramps over ~4 frames.


### 2026-09-10 — perf session: gather −33%, a measured split, two levers closed

**BOTH BRANCHES ARE MERGED INTO `main`** — `claude/sdf-march-perf-518bcc`
(`a76978fa`) and `claude/determinism-stage1` (`d3a8cdb7`). Nothing is left to
merge; continue on `main` rather than resurrecting a branch. Working tree clean.
Cadence follow-up `f845c71b`: `probeGatherRate` 2→4 is worth **~5% (room 3)**,
superseding the handoff's "VOID, needs one re-run". Handoff:
[docs/dev-notes/2026-09-10-perf-session-handoff.md](../../docs/dev-notes/2026-09-10-perf-session-handoff.md).

**SHIPPED AND MEASURED — probe gather −33%.** `compute:probe-gather` went
**7.19 → 4.85 ms** (room 3) and **6.02 → 3.99** (room 4), with non-overlapping
per-leg ranges and 19%/23% repeat spread. Three exact optimisations: a
bounding-sphere cull with a `tMax` bound in `kdHitCapsule`, an any-hit
`kdCapsuleBlocks` bounded by the light distance replacing the full nearest search
the shadow path ran per light per ray, and testing the ≤16 boxes before the ~200
capsules in `kdShadowed`. Equivalence is PROVEN against an independent reference
in `probe-dynamic-cull.test.ts`, not asserted.

**MEASURED — the gather's cost split, which was previously a model.** With
diagnostic seams (`?dynrays=0` = no ray work, `?dynlights=0` = primary rays
only): primary **2.15 / 1.82 ms**, per-light shadow **2.84 / 2.26 ms** =
**57% / 55%**. So the shadow share is real, and R2 (sample the shadow map the
frame already rasterises instead of sweeping analytically) targets ~56% of it.

**READ THIS BEFORE QUOTING THE GATHER.** It runs every OTHER frame
(`probeGatherRate = 2`), so its amortised cost is **~2 ms/frame**, not the 4–5 ms
the pass row shows. The pass row prices ONE gather and is invariant to cadence by
construction. Only `sdf:march` (6.7–9.7 ms, no cadence) is a true per-frame row.

**CLOSED — do not re-open:**
- **Cone pre-pass: DO NOT SHIP.** The documented −22% does not reproduce
  (`sdf:march` is *higher* with it on); `TASKS.md` X1.14 already measured 0.4%
  and X1.15 says the occluder hull supersedes it. Enabling it also reproduces a
  CPU submission stall (`gpu:idle` 15–20 ms, negative harness gap) in two
  independent runs.
- **Step budget / miss-pixel 96-step tail: DEAD.** A 6× cut produces NO
  monotonic trend in `sdf:march`, reproducing the 2026-08-31 finding on the
  interlace config. Per-step is not the axis.
- **The cone's −22% in `sdf-layer.ts:220-238` is stale doc-rot** (predates the
  occluder hull).

**FIXED + GATED (both were MY bugs, both owner-visible):**
- Harness legs reset: new probe seams were not pinned in the ship-defaults
  block, so a leg leaked into the next rep's baseline. Rule: **any new seam a leg
  can set MUST be pinned in the reset block.**
- `?dynrays` / `?dynlights` booted every unparameterised page with ZERO rays and
  an empty light list (`Number(null) === 0` passed a `>= 0` guard), zeroing the
  dynamic probe layer — characters in the player's room rendered as black
  silhouettes. Fixed and made structural in `webgpu/boot-params.ts`
  (`parseIntParam` reads the RAW string) with `boot-params.test.ts` as the gate.
- **`?tracerlightslots` defaulted to 0, not 2** — the same `Number(null)` class,
  PRE-EXISTING (not from this session), found by auditing all 18 `URLSearchParams`
  reads after the regression rather than by another playtest. Tracer /
  muzzle-streak lights therefore never fed the gather's dynamic light list on a
  bare page, so gunfire contributed no indirect light. The other numeric params
  are safe and were checked individually: `?shadowmap` uses `> 0`, and
  `?laststep` checks `raw === null` — which is the correct pattern, and the one
  `boot-params.ts` generalises. **Lesson: audit the bug CLASS, not the
  instance.** All three wrong-default bugs this session had the same signature —
  a wrong value that reads as a design choice rather than as an error.

**[~] FRAME HASH — BUILT, AND IT ALREADY FAILS USEFULLY (`0ca65f62`, `b04d36e5`).**
`frame-hash.ts` (pure, 22 tests) + `demo-hash.ts` (in-page, 13 tests) +
`frameHash()` / `setDemoHold()` / `demoScenario()` + `scripts/sdf-demo-hash.sh`
(`ab` | `record` | `verify` | `negative`); the bench reports frame-hash drift
beside census drift. Hashes `marchTarget` + the gather's dynamic layer
(target-level), NOT the composited screen.
**Proven:** the readback is bit-stable across no-step re-reads (a mismatch is
never an artefact); **the render sequence IS deterministic** — 24 consecutive
positions aligned across two boots match **23/23 at a one-position offset**, all
digests distinct; the interlaced field's two-value parity alternation is real, so
mixed-parity recordings are REFUSED; and both boots dispatched **exactly 36
gathers**, so the schedule is not the problem.
**Falsified, do not retry:** pinning `frameSeed` during recordings, and anchoring
the dispatch phase (that reset also corrupted the `seedIdle` diagnostic into
negative values — both the reset and the diagnostic are gone).
**[!] LOCALISED: THE ENGINE BOOTS INTO ONE OF TWO STATES.** Per-tile digests over
the 800×300 march target: tiles 0-3, 8, 11 are **BIT-IDENTICAL in every run and
boot** (`1109108741`); only 4,5,6,7,9,10 — the central band where the BODIES are —
vary. The LEVEL renders identically every time. The max stat takes one of exactly
two values (13.3995 or 0.981266, a 13.7× difference: a body lit or not). Two boots
in ONE stored run reuse digests from EARLIER runs, so this is a discrete branch
chosen at boot, not noise — find the BRANCH, not another clock to freeze.
**Excluded, each by measurement:** readback, sim state, field parity, gather seed,
dispatch schedule (36/35/18), gather inputs (byte-identical), camera (identical to
6 dp), VHS (`setVhs(null)` over 4 boots → same 2 digests, same branch-B hash
`3035244172`; VHS runs downstream of the march target and cannot touch it), and the
room-probe worker bake (now gated by a new `roomProbesReady` seam — still
diverges).
**[x] THE PRESENTED FRAME IS HASHED (owner request).** `__sdfGame.presentedShot()`
returns the canvas as base64 PNG; `scripts/lib/demo-presented.mjs` decodes and
digests it; the recorder hashes it every sampled frame and compares it across runs.
New failure path: **"GPU layers MATCH but the presented frame does NOT"** — which
localises a difference to the post chain by elimination. Verified live (800x600,
same nonZeroBytes, different digests `3654678759` vs `465050184`). **8-BIT by
construction**, so sub-LSB differences do not exist here — use it for what the
owner SEES, `frameHash` for what the renderer COMPUTED. **VHS's temporal blend
still blocks a green screen hash** even with `setTimeFrozen` (which fixes the
clock half only).
**Method guards:** the recorder's duplicated FNV-1a is GATED by `frame-hash.test.ts`
against canonical vectors (a tool-side digest skew would fake every divergence),
and `demo-presented.test.mjs` (7 tests) covers the PNG decoder through all five
filter types plus both false-pass cases.
**[x] VHS time pinned anyway** via a new `postAa.setTimeFrozen(on)` driven by
`setDemoHold`. The owner's instinct was right even though it was not this bug: VHS
OWNS temporal blending (reads the previous frame's output) AND drives 60/24 Hz
row-noise hashes off `performance.now()`. Freezing the time removes the clock
dependence but NOT the history — which is the standing reason the hash measures the
march target and not the presented image, and it must be dealt with before the hash
can ever cover the composited frame.
**The branch is CHARACTERISED (4 boots, 1 vs 3):** at one body pixel, R −3.3%,
G −6.6%, B −12.1%, **ALPHA BIT-IDENTICAL** — so not coverage, not a missing body,
not vertex position; a UNEQUAL RGB scale is lighting/colour rather than exposure.
A control pixel in tile 0 reads identical in all four boots, so the level really is
stable. A minority branch (1 in 4) means a two-run A/B has ~5-in-8 odds of drawing
two different branches — which is why "record twice and compare" failed so
reliably. **Next: the body's lighting path, blue-weighted, not geometry.**

**Open — and the obvious hypothesis is FALSIFIED.** A third layer now hashes the
gather's INPUTS (packed bone capsule instances). Result: **`instances` IDENTICAL
across two boots** (hash `3080687726`, count 35, every sample) while `probeDyn`
and `marchTarget` still differ. So the inputs are excluded, as are the seed
(pinned), the schedule (36 dispatches both boots), the sim state (render-locked)
and the readback (bit-stable). What is left is state these layers do not cover:
the gather's own GPU-side accumulation, the **room probe grid baked in a WORKER
at boot** (async, lands whenever it finishes — best next candidate), or the
march's own per-frame state. Separately, a gather-independent period-2 mechanism
remains (field jitter phase is the candidate). **Dispatch count is excluded too**
(rate 4 → 18 dispatches: `instances` still identical, `probeDyn` still 0 shared,
march still a two-value alternation; one run went fully stable on `probeDyn` while
its march kept alternating, so the two layers vary independently). **Cheapest next
pin: the room-probe grid's WORKER bake completion frame** — async, lands whenever
it finishes, and nothing in a recording pins WHEN (the same fix the plan already
wants for the chunk-bake worker). Full evidence: handoff, "IT IS BUILT".
**[x] AND IT ALREADY FIRES ON THE BENCH.** `endHash` is wired into the page's
bench, so the harness reports frame-level drift beside census drift. A
`baseline,occluder-off` × 3 × 2 run reports **all four leg-runs drifting on BOTH
layers** (baseline march rep0→rep1 `2990198133`→`1661108024`, max 11.13→12.55;
probeDyn drifted too). **Stage 1 fixed the census-visible part of the drift; this
is the part it could not see — two repeats of one leg do not just COUNT different
things, they RENDER different frames.**

**[x] DEEPER FIELDS (h/3, h/4) — MEASURED AND REJECTED ON LOOK (owner, 2026-09-10).**
*"when it's still it's not that bad but it's when moving the lines are just way too
distracting at 3 and 4. 2 is fine."* The still-frame softness WAS my build (steps 1-2
shipped without step 3) and the **history ring (`8e57c278`) fixed that half**. The
**motion tearing is structural**: at h/3 a held row reads a real sample taken 1-2
frames ago, which is a stale image at a different camera position once you move, so
the weave interleaves three instants down the screen. Fixing it needs temporal
REPROJECTION on held rows — a real feature that would eat much of the saving and
carries the desync risk that retired half-rate C2. **h/2 stays; `?fields` is an
opt-in diagnostic, NOT a pending look decision.** The generalisation and the ring stay
(tested, inert at 2, a prerequisite for any future temporal work).

**[x] FLESH BUG RESOLVED (`43779459`) — it was ONE COMMENT, and it was mine.**
`b1da21d1` put a `//` comment inside `COMPOSITE_WGSL`'s parameter list; three's WGSL
parser sweeps the parameter text with `/name\s*:\s*type/` INCLUDING comments, so
`"deliberately: these"` became a phantom input, the call gained an argument and the
composite never compiled — no flesh on ANY page, default included. Pinned now by a
test that runs the real parser and requires parsed inputs == declared params, plus a
152-fn scan. **The console said it at load** (`THREE.TSL: Input 'deliberately' not
found`); nobody read it. Second instance of the class (see `march.wgsl.test.ts`), and
"inputs bind positionally" — which the offending comment claimed — is false: they
bind BY NAME. **`?fieldsdemo=1` IS GONE** (removed after the fix): `?fields=N` alone now does what
it says. Verified live — `?fields=3` → 800x200, `?fields=4` → 800x150, no errors.
**Next: the owner's look pass at h/3 and h/4, then the history ring.**

**[!] DEEPER INTERLACE — historical brief (SUPERSEDED, kept for the lesson):
[docs/dev-notes/2026-09-10-interlace-handoff-START-HERE.md](../../docs/dev-notes/2026-09-10-interlace-handoff-START-HERE.md).**
**✅ MISSING FLESH RESOLVED 2026-09-10:** a `//` comment inside `COMPOSITE_WGSL`'s
parameter list became a phantom wgslFn input (`deliberately: these`), so the composite
never compiled at ANY divisor. The comment moved out of the signature and the shader is
pinned by `sdf-layer.test.ts` "no comment phantoms". The flesh is verified on screen at
h/2, h/3 and h/4. Open: the owner's look pass at h/3 and h/4, then drop the
`?fieldsdemo=1` gate. The history below predates the fix. The ACTUAL bug is NOT the fields: the flesh is missing on a DEFAULT page (no
`?fields`, standing still) — a regression in the shipped config. The divisor work is
a red herring until that is fixed, and the first action is a five-minute checkout of
`b1da21d1~1` to see whether the default was already broken before it. **The
output-target readback in `sdf-field-count-diag.mjs` is BROKEN** (returns `[8781,
8992, 9230, 15360]` on an rgba32f target — impossible), so every "output lost the
surfaces" conclusion is void; the march numbers stand. GATED OFF (`?fields=3|4` also needs `?fieldsdemo=1`);
the flesh does not render and the ASSEMBLY is the open bug (2026-09-10).**
Two of the three two-field constants are fixed (the bone weave's `outRow / 2`, and
`fieldParity` defaulting to 2 fields — which made a third of the fresh rows
unreachable), and the third (the jitter's two-field centering) with them.
**Measured in ONE boot at held parity:** the flesh IS marched at every divisor —
surface texels cover **3.90% / 3.91% / 3.91%** at h/2, h/3, h/4, with 0
non-finite and 100% RGB non-zero — so culling, sizing and the march parity are
EXONERATED. The flesh is lost between the march target and the composited frame.
**Tool left for the next agent (committed):** `node scripts/sdf-field-count-diag.mjs`
— reads the march AND output targets at every divisor in one boot, counting surface
texels over every texel. **Its output verdict is not yet trustworthy:** the output
target reads 0% surfaces at h/2 TOO, and h/2 works, so `alpha < 1` is the wrong
marker for the output (it is full-height and publishes a different alpha). Re-base
that side on COLOUR before trusting it. New seam for the job:
`__sdfGame.readOutputTarget()`. **Do NOT instrument the march target again — it is
exonerated (3.90%/3.91%/3.91%).**

**[~] DEEPER INTERLACE — steps 1+2 DONE, measurement DEFERRED (2026-09-10).**
`fieldCount` is a live uniform (LAST input, shader-clamped so a bad binding
degrades to no-interlace rather than dividing by zero in the composite);
`setFieldCount(n)` / `?fields=N` / `__sdfGame.setFieldCount` land with it; both
target heights follow the divisor; `'frame'` REFUSES >2 rather than no-opping.
**Proven live:** h/2 → 800x300 (shipped), h/3 → **800x200**, h/4 → **800x150**,
all `nonFinite 0` and non-empty; the round trip genuinely changes the target.
**NOT proven: the `fields = 2` bit-identity check could not run** — its control
failed (two reads with NO field change, two steps apart, render-locked, return
different digests), so the claim is still open. **Measurement deferred:** one
contaminated attempt gave `sdf:march` 1.13 ms (r3) beside 8.75 (r4) — the census
drift again; no number is quoteable. Re-measure on a QUIET machine against
`fields=2`, reading `sdf:march`.

## NEXT SESSION — full temporal reprojection on held rows (owner-deferred 2026-09-10)

**Deferred by the owner, not started.** Spec:
[docs/dev-notes/2026-09-10-temporal-reprojection-NEXT-SESSION.md](../../docs/dev-notes/2026-09-10-temporal-reprojection-NEXT-SESSION.md).

Why it is on the list: the deeper fields were rejected on look for MOTION tearing
(the history ring fixed the still half). Scope it as a general capability, not as
"fix h/3" — if held rows reproject correctly under motion, that unlocks deep fields
AND revisits the retired half-rate C2 path, which failed for the same reason.

**The trap to read first:** `holdMode 2` already does a per-pixel reprojection, but
it is CAMERA-ONLY — it assumes the held row is the same scene from an older camera.
True for walls, FALSE for a body that has moved, and the bodies are what the owner
was looking at. C2 died on exactly this axis. It needs PER-VERTEX motion vectors,
a motion-vector target, a disocclusion validity test, and depth added to the history
ring first (the ring stores colour only today). Order: ring depth -> motion vectors
-> validity -> composite. Acceptance is the owner's eyes IN MOTION; a still-frame
comparison cannot see this defect.
