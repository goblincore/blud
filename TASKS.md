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

**NotBlood-core port landed + playtested (2026-06-15, `fde5200`)** — explosion-outcomes (launched-alive / flung-corpse / re-gib / head-pop) AND the tables-codegen + death/gib pipeline are merged to main and parity-confirmed. `scripts/gen_notblood_tables.py` generates raw Build-unit tables; `tuning.ts` is a curated overlay; pure `resolveDeathOutcome()` ports `actKillDude`. Codegen already caught a real off-by-one (burning-cultist HP). See `R7`.

**Next session — pick up (prioritized):**
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
- `X1.27` [~] **Baked-SDF dynamite grip + underhand release — OWNER VISUAL GATE PENDING** — six-frame right-hand grip clip (Task B), strict v2 loader + adjacent-slab WGSL sampler (C), hash-checked derived GLB + exact hand transform (D), pure grip controller + clip-only deferred release (E), and full lab integration with captures/benchmark (F) all landed and green. All dispatch chains A–F complete; the marker handoff measured 0.000 mm; clip ≈ static in benchGpu (−0.07 ms median delta). Do NOT mark complete until the owner watches the loop and explicitly passes the ten-point checklist. [design](docs/superpowers/specs/2026-08-17-sdf-dynamite-grip-release-design.md) · [plan](docs/superpowers/plans/2026-08-17-sdf-dynamite-grip-release.md) · [notes+captures+bench](docs/dev-notes/2026-08-17-sdf-dynamite-grip/notes.md) · [loop (jiggle off)](docs/dev-notes/2026-08-17-sdf-dynamite-grip/grip-release-loop.webm) · [loop (jiggle on)](docs/dev-notes/2026-08-17-sdf-dynamite-grip/grip-release-loop-jiggle.webm)
- `X1.25` [x] **PSX-AA post pass** — FXAA at internal res + temporal smear + optional
  sharp-bilinear upscale, `post` panel sliders, all-off = pixel parity. The first
  run's 'color shift' was a Y-flip (kimi-oai, 2 runs). Owner slider session open.
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

---

## Process notes

- **Completing a task:** flip `[ ]` → `[x]`, **collapse the row to a one-liner** (detail goes in the commit message + a dualmem checkpoint), commit.
- **Discovering a new task:** next available number in the right section, **one line**, commit.
- **Task rows are ≤2 lines.** If context needs more, put it in a linked dev-note / plan doc and leave a bare link on the row.
- **Milestone rollup:** when a milestone lands, collapse per-task detail into a single line with the commit range; the plan file + git log hold the rest.
- **Design questions:** re-read the design spec above before adjusting scope.
