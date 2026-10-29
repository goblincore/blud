# Sector levels / Doom E1M1 experiment — hand-off (2026-10-24)

Branch `claude/level-design-abstract-459f86` (worktree `.claude/worktrees/level-design-abstract-459f86`).
Task wiki: [docs/tasks/levels.md](../tasks/levels.md) "Sector levels + the E1M1 experiment".

## RESUME HERE (2026-10-27) — state at context compaction
Branch `claude/level-design-abstract-459f86`, **draft PR goblincore/blud#89** (pushed; merged with main twice,
latest 4b16f611 incl. the analytic-normals/hood fixes). Dev server: `npm run dev:doom` (port 5174 if 5173 is taken);
regenerate E1M1 first: `python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom`.

Done since plan 3b (all owner-requested, see commit messages):
- Fog on sector levels 8..40 m (`webgpu/fog-range.ts`, `?fognear/?fogfar/?fog=0`), 7a3a81e0.
- Barrel grime pass a7e639f1 (finding: see-through dark decals can't darken the floor; very rough surfaces wash
  out pale under the flashlight at 1–2 m — both in dualmem as warnings).
- Shotgun: left click = both barrels, right = one; 10 pellets/barrel; player pellets 80 m/s, gravity −1.5
  (`PLAYER_GRAPESHOT`); room-level segment-vs-box pellet test; tracer cap 2 m — 88d15a05.
- **Pellets flew through bodies on long frame steps** (broad phase divided by segLen twice; < ~48 fps sector /
  < ~37 fps room) — fixed 1e0a56b7 (`segmentPointDistance`). Still open (room levels only): steep down shots on slow
  frames die at the floor kill before the actor test; a muzzle inside a box kills the volley at the muzzle.
- Player feel 5f953b6f: walk 4.4 m/s, smooth gun bob (step 1.4 m, −sin² dip), bullet-time knobs split
  (move/aim/fire/reload all 0.35 = original, owner reverted 0.66/0.6), `__sdfGame.bulletTime()`, `?bt_*`, BULLET TIME panel.
- 715dd710: per-weapon aim style (`webgpu/aim-style.ts`; shotgun = mouselook, others free aim; G = session override);
  **G killed mouselook** — the anti-drift pin undid every turn — fixed.
- E1M1 overrides (`scripts/levels/overrides/e1m1.json`, `doom_overrides.py`) 35a86d7b: start-room sunken centre
  (sector 27) is a nukage pit; two teratomas over the big pool. Doom-style floater movement 6dd20d42
  (`webgpu/floater-move.ts`; idle cruise high, descend when chasing; `__sdfGame.floatTuning()`).
- Teratoma toughness aec933a4 (per-character `MotionProfile.toughness`: 4 point-blank doubles; wound merge cap scaled).
- Pellet damage falloff 18f0c901 (`pellet-falloff.ts`: full ≤5 m → 0.3 at 18 m; slugs/barrels full;
  `__sdfGame.pelletFalloff()`, `?pelletMin=`). Owner question pending: teratoma at 25 m = ~61 doubles (raise floor to 0.5?).
- Adrenaline rush 678713db (`adrenaline.ts`: enemy hit → world eases to 0.55 over 0.8 s, sustains 30 s after the
  last hit, eases out 1.8 s; player/shots 0.85; edge distortion `post-adrenaline-edge.wgsl.ts`; `__sdfGame.adrenaline()`, `?adr_*`).
- Emitters part A e807dfca (screen banks, viewscreen, fluorescents, exit signs — animated procedural looks) and
  B1 48ee22d4 + 9127b3e1 (baked coloured emitter bounce, `emitterSurfaces`, cheap `glow` lights; E1M1 triangles 3.8×).
- CI fixes f47fc024 (motion digests pinned at 1e-7 — mac vs linux libm; stale kind message; location guard).
- World scale d09f8e03: Doom world at 35 units/m (was 32) — E1M1 ~9% smaller, bodies unchanged (agent report pending).

Landed right before compaction: world scale **35 u/m** (36 would make E1M1's 68-unit doors 1.89 m < the 1.9 m
headroom; ceiling 35.8) d09f8e03 + gate fixes c45856db (the old "round through geometry" failure was a gate
classifier edge — a round already in flight when the sampler started; sight-pose finder rings now scale with the
world; NOT yet verified end to end — rerun the doom gate on a quiet tree); low-health adrenaline + red border
32ef4319 (`__sdfGame.setHealth(hp)`; danger k = smoothstep(35, 20, hp) → world 0.55→0.2, player 0.85→0.6).
**Freeze on hit: FIXED (2026-10-28).** Not slow-mo / hit-stop / the adrenaline pass (uniform-driven). Cause: three
r186 keys every InstancedMesh's render object by uuid and names its instance buffer per node, so ~22 identical bone
batches per character type each built a node + pipeline on the first hit that exposed bone (0.6-1.0 s). ec5095e7
pre-warms batches; 79afe0ce makes them share ONE build/pipeline per material (segment-instance.ts: plain Mesh on an
InstancedBufferGeometry, matrices as named iM0..iM3 attributes; skeleton pipelines arena 21→2, E1M1 121→3; warm
drawOnce arena ~1.5→1.15 s, E1M1 ~8.3→7.2 s; shot 300 ms after respawn 232-274→36 ms). Teratoma first hit (kit-eye
maps + kit-eye-pop/cord/meat-wet pipelines, 0.7 s + 1.7 s) pre-warmed per step in 9649bde5 (now ~63 ms). Still open:
gore tear-off frames 50-140 ms for ~1.5 s (blood sim), first sight of an E1M1 room compiles its props (0.3-1.3 s),
two unattributed 1.2/1.9 s E1M1 frames, the arena respawn frame itself (~760 ms). Doom gate PAUSED by the owner
(manual playtests for now).

**Gore tear-off pass (2026-10-28, 3079ce7d).** The old `stepBlood`/`emitTrails` blame was a profiler artifact (process stalls charged to whatever ran); blood sim is ~2–7 ms/s and GPU-bound. Real fix: blood/gib blur pre-warm used `compileAsync` (wrong target keys) so first gore built 3 pipelines; now warms by drawing into the real no-depth half-float targets outside the post callback. Tear-off now 0 new pipelines (arena) / 2 (E1M1). Remaining ~50–65 ms frame is the **shot** (pellet `hit`/`woundFromPellet`/`traceProjectile` + 2 first-use MeshBasicMaterial on E1M1). Open: teratoma kit pipelines compile on first sight (~300 ms) — pre-warm like kit-eye. Probes `tear.mjs`, `ab-tear.sh` in the session scratchpad. **Follow-up: shot frame pass (2026-10-29)** below — the shot's cost was the pellet trace and wound probes (CPU folds) plus the tracer pipelines; `?shotfix=0`.

**Teratoma kit pre-warm (2026-10-28, db14ad19).** Kits (skinned glTF, `kit-overlay.ts`) were culled off-screen so first sight built 9–14 materials (0.3–1.0 s); also each kit made its own env texture whose id is in the build key, so copies never shared. Now one shared never-disposed env per renderer + `game-kit-prewarm.ts` un-culls one real kit mesh per step off-camera (then each further copy once, for cacoeye). E1M1 first sight: 0 kit builds; frame still 475–770 ms from **sector zone materials (23–27 builds, ~15–20 ms each) + pickup** — next first-sight target. Boot-in-play warm in drawOnce tried and dropped (keys mismatch). Seam `kitPrewarmPending()`.

**Level + prop pre-warm (2026-10-28, d7daff92, 839984d1).** Zone materials cannot share builds: each (zone, role, kind) batch has its own node graph (r186 keys nodes by id) and each zone room's light list holds its own lights + probe/level-list nodes, whose bindings live in the build state. So `game-level-prewarm.ts` un-culls one real level mesh per step (sector batches, barrels, pickups, glow floors), nearest the player first (`prewarm-order.ts`), and skips its step when the kit pre-warm built. Soldier guns built per instance (per-prop PMREM in the key): held props now share the kit env and the kit pre-warm warms props, plus kits/props hidden by the sector sight cull (`forcedRoot`, kept shown by `syncKitVisibility` for the step). E1M1 11-zone tour, 3 paired rounds: first-sight max 262–278 ms → 37–43 ms, 61 builds → 0, frames >50 ms 10 → 0; level pre-warm done 5.2–5.5 s after warmDone; boot max 113–121 → 103–129 ms (load noise), >50 ms frames after 2.5 s 1–3 → 5 (50–59 ms, one 129). Still built late: meat-gib / kit-eye stand-ins per new actor room (~10 ms each, can land 3 in one frame). Seams `levelPrewarmPending()`, `levelPrewarmDoneMs()`.

**Doors (2026-10-28).** Owner design built: sci-fi scratched-steel doors, two leaves split sideways into the jambs,
auto-open for the player and for enemies, close `wait` (4 s) after the doorway clears, never on an occupant.
- Format (spec §4): top-level `doors` entities `{ id, sector, faces: [line, line], a, b, width, depth, height, zones,
  style: "split", speed, wait, key? }`; the parser checks them against their lines. The converter writes one per
  doorway-shaped door sector (manual and remote-tagged; fast specials 6 m/s, others 3 m/s; key specials give `key`)
  and no longer writes the per-line `door` marker. E1M1: 5 doors (sectors 4, 26, 69, 83, 85); sector 2 (the W1 ambush
  wall, 14.6 m, not a doorway) stays an open hole (`doors_left_open`).
- Logic `sector-doors.ts` (pure): state machine, trigger (within 1.5 m moving toward it, or a body whose travel a
  leaf refuses within 1.5 m), occupant rule, leaf cover ((1 - open) / 2 each from the jambs). The ground owns a
  `DoorField`: face lines block bodies with their leaf pieces (`blockingNear`), rays where a leaf stands
  (`sector-ray.ts`: sight, the sight cull, shots, pellets, projectiles, debris). Navigation ignores doors (routes
  through); `doorTravel` wraps `encounterNav.canTravel` so enemies are held at the leaves and ask the door to open.
  Door faces are solid in the glow and emitter bakes (no colour through a doorway).
- Leaves `game-doors.ts`: two meshes per door (one per side, each lit by its zone), panel kind `slideDoor` (vent, brace,
  kick plate, hazard-striped leading edge), `positionNode` slides them by one uniform. The level pre-warm builds them:
  first sight of door-69 built 0 nodes / 0 pipelines (pipelineCensus +0). Leaf geometry hit WebGPU's 8 vertex-buffer
  limit (9 attributes): the bake attributes share one interleaved buffer.
- Probes `doors-probe.mjs` (session scratchpad); shots `.lab-tmp/doors/`. `?doors=0` = every doorway open, no leaves.
- Not built: door sound (`onPhase` hook; the game loads no audio), keys (a keyed door opens like any other),
  floaters (teratomas) ignore doors (own fly space), a corpse in a doorway neither holds nor blocks the door.
- **Readability cues (2026-10-28, owner: shut doors "sometimes just look like wall panels").** `?doorcues=` switches
  each (all on by default; `none` = all off, a list = only those, `all,-light` = remove one): `frame` (dark heavy-metal
  posts + header beam proud of the wall, reveal lining, threshold plate), `light` (status lamp bar on each header —
  red shut, green opening/open, amber closing — plus a faint spill on the header; beside the door where there is no
  header room), `recess` (leaves 12 cm back from the face planes), `tone` (leaves in cleaner, colder, lighter steel).
  Pure geometry `door-frame-geometry.ts`; one frame mesh per door side (game-doors.ts). Cost: +3 pipelines total
  (242 -> 245), first sight of door-69 still +0. Seams `doorCues()`, `setDoorLamp(gain, spill)`. Sheet:
  `.lab-tmp/doors-readable/doors-readable-sheet.png`. The lamp is the cue that carries at 10 m; frame and tone help up close.

**Zone cull and update LOD (2026-10-28, e0c2ed7c, c75557ca, 1d19c68b).** Owner: "occlusion logic and game logic to
optimize, like not rendering or updating enemies that aren't visible", designed for MAP28 scale. `?cull=0` turns it all off.
- Measured first (CDP 250 µs profiles + `frameSplit`, 4 spots, `?god=1`). E1M1 before: tick 4–7 ms (actor step 2–3.5,
  kit pose 0.5–0.9, 31 bodies of which 0–5 in the visual set), draw CPU 7–11 ms (three's per-object render ~4.3,
  matrix walk ~1.2, shadow pass ~0.6), GPU fence 4–16 ms (the SDF march dominates; level meshes barely move it).
  What it skipped already: the body march cull and kit/gun hiding were draw-only; every body still stepped, posed its kit
  and was ray-tested every frame, and every level mesh in the frustum drew (zone boxes are huge), behind walls or not.
- `sector-portals.ts` (pure): a frustum-wedge portal flood over the SECTOR graph (two-sided lines; no vertical opening =
  wall; closed door = shut face; sky ceilings show taller sectors in the wedge over their walls; margin 0.35 m, a portal
  within 0.5 m passes the wedge unchanged; void eye = fail open). `discVisible`: a body's 1.4 m flesh disc vs the flood.
- `actor-lod.ts` (pure): full / quarter (alert, ≥ 18 m, unseen: 1 frame in 4 with time accumulated, so routes and speed
  are the same) / sleep (director order idle, unseen, ≥ 8 m, settled). Anything in view, in a flooded sector, seen by the
  director, in combat, or restless (`ZombieActor.settled()`: damage in the last 2 s, knock, dying, burning, tear,
  collapsed...) is full.
- `game-zone-cull.ts`: draw flood from the camera → level meshes (zone batches by zone; barrels, pickups, door leaves and
  frames by the sectors under them) go to `layers.mask = 0` (not `.visible`, which game logic and the pre-warm own; a mesh
  the level pre-warm is forcing is never hidden). The march cull skips the sight rays of bodies in no flooded sector.
  Tick: an omni flood from the eye pre-tests the visual set and feeds the LOD; a hidden settled body skips its kit pose;
  hidden kit/prop roots skip three's matrix walk (0.21 → 0.085 ms a walk at 101 bodies, several walks a frame).
  Flood cost 40–250 µs on the loaded machine (2 a frame). Seams `zoneCull()` (zones, sectors, culled meshes, flood
  steps, tiers), `setZoneCull(on)`, `sceneWalk()`. `?stress=N` adds N enemies of the level's own kinds near its spawns.
- A/B, 2 paired rounds, split medians (ranges), cull=0 → cull=1:

  | E1M1 | tick ms | draw CPU ms | actor step ms | kit pose ms | GPU fence ms |
  |---|---|---|---|---|---|
  | start | 4.2–6.8 → 2.3–3.1 | 7.1–11.5 → 5.0–7.6 | 2.2–3.3 → 0.9–1.1 | 0.5–0.9 → 0.1 | 6.0–6.3 → 4.2–6.6 |
  | pool (open) | 4.7–7.1 → 4.4–9.9 | 6.9–10.3 → 6.6–16.5 | 2.2–3.5 → 2.2–5.0 | 0.5–0.8 → 0.2–0.4 | 9.6–12.8 → 11.8–16.8 |
  | court | 5.1–6.5 → 3.6–6.5 | 7.6–11.2 → 7.0–12.6 | 2.4–3.1 → 1.6–2.8 | 0.6–0.8 → 0.2 | 13.7–15.3 → 14.7–17.2 |
  | west | 3.8–5.6 → 2.3–3.6 | 7.3–11.2 → 6.4–9.5 | 2.1–3.0 → 1.0–1.6 | 0.5–0.8 → 0 | 4.3–6.4 → 4.6–7.6 |
  | **stress (101)** start | 15.8–24.0 → 7.9–8.2 | 15.9–27.0 → 12.3–12.4 | 8.7–13.8 → 3.5–3.6 | 2.5–3.5 → 0.4 | 5.0–6.3 → 5.3–6.7 |
  | stress pool | 23.7–31.9 → 20.5–23.6 | 22.0–32.0 → 19.7–19.9 | 12.2–16.5 → 12.1–13.9 | 3.1–3.9 → 0.8 | ≈ |
  | stress court | 21.3–34.3 → 13.9–19.4 | 19.9–32.8 → 15.0–21.3 | 11.2–19.0 → 7.5–10.5 | 2.9–4.2 → 0.6–0.8 | ≈ |
  | stress west | 13.3–21.2 → 7.8–8.5 | 15.6–26.6 → 12.0–13.3 | 7.7–12.4 → 4.2–4.6 | 2.4–3.4 → 0.3 | noisy |

  The big open pool room sees most of the map, so it gains little (honest: in range of noise). GPU is unchanged.
- Correctness: frozen same-frame shots cull on vs off at 8 views differ only by animation noise (`.lab-tmp/zone-cull/shots2`);
  door-85 shut → only sectors 52, 82 seen; the first frame its open fraction leaves 0 the sectors beyond are flooded
  (0 of 90 frames open-but-hidden), shots at 4 % / 30 % open match (`.lab-tmp/zone-cull/door`); pursuers alerted by a
  shot walk to it in the quarter tier with the player 31 m away behind a shut door and arrive like cull=0 (min distance
  0.06–0.9 m vs 0.07–1.2 m); 12-zone tour with `pipelinelog`: the same 11 new pipelines (explosion fx) on and off, 0
  level/kit builds on first sight.
- Not done, on purpose: zone batching is per zone (12 big zones in E1M1; three doors are inside one zone), so mesh culling
  is coarse — MAP28 wants the converter to split zones at doors / by size; glow floors (one mesh per kind) and
  `sector-light` per-zone updates are not culled (measured ~0.1 ms, not worth it); the vertical opening is ignored except
  for none; lifts/moving floors will need the graph's "no opening" rule refreshed; per-actor view objects and the encounter
  director still run for every body (director 0.2–0.75 ms at 101); three's per-object render (~4–6 ms) is now the
  biggest CPU item for what IS visible (batch level meshes further, or instance pickups).

**Level batching: three's per-object cost (2026-10-28, 07b721be, 495744f4).** Owner goal: after the zone cull three's
per-object render (~4–6 ms) was the biggest CPU item; cut draws and per-object work without changing the look, as prep
for MAP28. `?batch=0` restores the old per-object path; `__sdfGame.setLevelBatch(on)` switches it in a booted level
(in-boot A/B; casing pools stay plain meshes either way).
- Measured first with a new seam `drawsByObject(n, detail)` (every object three renders, by name and camera, loop
  stopped). E1M1 main-camera objects per frame, start/pool/court/west: 140 / 197–212 / 203–212 / 190–196. Of these:
  **32 were the 16 soldiers' spent-casing pools** (two InstancedMeshes each, count 0, drawn every frame before anyone
  fired; each its own build: three keys an InstancedMesh by uuid), ~50 the player's arms and gun (constant), 25–51 sector
  batches (already one per zone, role, kind), up to 23 pickups (17–23 in the open rooms), 3–9 barrel drums and lids
  (+ the scorch pool and the gun's own two `barrel` parts), 4–8 door leaves and frames, 1 glow floor, ~10 kit pieces.
  `?stress=100` 237 / 373–379 / 379–384 / 305–310 (130 casing pools).
- **Pickups** (`game-level-batch.ts`, pure core `level-batch.ts`): one plain Mesh per item type on an
  InstancedBufferGeometry with the matrix as named attributes (skeleton-spike/segment-instance.ts, so a batch builds once
  and no InstancedMesh uuid trap), lit by the scene's list like before (pickups were never room-lit, so the item is the
  whole key). Each pickup keeps its logical mesh (spin, cd tilt, the debris seam); each frame after the zone cull the
  shown rows (not taken, in a sector of the camera flood — the same per-sector placement the cull used) are packed to the
  front, instance count = shown. frustumCulled false (instances everywhere), so the batch draws from frame 1 and builds
  at boot; the level pre-warm skips it. E1M1: 53 pickups → 3 batches (health 44, shells 8, shotgun 1).
- **Casing pools** (`shotgun-casings.ts`): plain meshes on materials shared by every pool of a hull colour; an empty pool
  leaves the render once it has been drawn (built) once. Boot pipelines 304 → 274.
- **Barrels** (`game-barrel-view.ts` BarrelBatches): per zone, every intact drum (own dents) and lid merged into one mesh
  each on the zone's shared materials and light list, rebuilt without a drum on its blast (same layout, no new build);
  stubs unchanged; named `barrels-<part>-zone-<n>` so the zone cull takes them by zone (barrels were placed by sector).
  E1M1: 6 barrels in 3 zones → 2 draws per seen zone.
- **Static matrices**: sector-level level-group objects get matrixAutoUpdate off once (`freezeLevelMatrices`; doors slide
  in the vertex shader). Matrix walk: noise-level here (~0.1 ms of 0.6–0.9 normal; 2.4 → 1.7 ms at stress start, mostly
  the casings), kept as structure for MAP28's bigger level group.
- **Not done, on purpose:** door frames (each side's material carries its door's lamp-status uniform, ≤ 2 doors a zone
  on E1M1: ≤ 2 draws), sector batches (already one per zone/role/kind; merging kinds needs texture arrays), glow floors
  (one mesh per kind already), scorches (one InstancedMesh already).
- **BundleGroup spike: dropped.** three r186 `BundleGroup` (static) freezes its render list until `needsUpdate`: no
  per-object frustum culling (had to turn it off: more vertex work) and every zone-cull change re-records the whole
  bundle; in the cached path three still runs each object's node and binding refresh per frame (only encoding is saved),
  and bundles execute at the end of the pass. Spike (82 zone batches in one bundle, in-boot alternation, 3 pairs): draw
  CPU −0.4..−1.1 ms at start/west, ±0 at pool/court (noise ±1 ms); frozen shots equal. Not worth the caveats.
- A/B, in-boot alternation (`setLevelBatch`), 2 boots × 4 pairs per spot, medians (ranges over boots), off → on. The
  machine was under heavy outside load (load average 13–670 during the runs), so the frame-split ms are noisy; the CPU
  profile of three's `_renderObjects` (inclusive, per frame, 3 pairs, 200 µs sampling) is the cleaner read:

  | E1M1 | main draws | objects walked | draw CPU ms | tick ms | three renderObjects ms |
  |---|---|---|---|---|---|
  | start | 140 → 107 | 1789 → 1724 | 5.2–9.4 → 5.2–8.8 | 2.7–4.7 → 2.6–4.9 | 2.70 → 2.52 |
  | pool | 201–212 → 159–168 | 1789 → 1724 | 17.5–22.0 → 14.2–22.4 | 10.5–15.9 → 10.9–16.4 | 3.97 → 3.63 |
  | court | 203–210 → 159–182 | 1768 → 1703 | 13.4–16.7 → 12.8–15.3 | 7.7–9.2 → 7.2–8.7 | 3.89 → 3.77 |
  | west | 190–196 → 136–145 | 1772 → 1707 | 6.7–9.6 → 6.5–10.1 | 2.9–4.1 → 2.8–4.4 | 3.12 → 3.12 |
  | **stress (131)** start | 237 → 108 | 5175 → 5110 | 9.9–16.0 → 8.1–15.1 | 8.7–14.6 → 7.7–14.4 | 4.27 → 3.22 |
  | stress pool | 373–379 → 242–247 | 5175 → 5110 | 22.6–29.9 → 20.2–24.2 | 38–40 → 27–39 | 7.44 → 5.16 |
  | stress court | 379–384 → 238–244 | 5155 → 5090 | 20.3–25.7 → 22.4–25.4 | 23–29 → 30–37 | 11.7 → 16.6 (noise) |
  | stress west | 305–310 → 158–165 | 5158 → 5093 | 9.9–10.2 → 9.3–14.5 | 9.4–9.5 → 8.7–14.3 | 4.86 → 5.29 (noise) |

  Honest read: draws drop 20–30 % (normal) and 35–55 % (stress), but the objects removed were cheap ones (empty instanced
  pools, octahedra): three's per-object loop gains ~0.1–0.35 ms normal and ~1–2 ms at stress start/pool. Tick is
  unchanged (combat noise at pool/court).
- Correctness: frozen same-pose shots on vs off (`?nospawn&vhs=off`, pickup spin pinned with `setPickupSpin`) at 7 views
  (the 4 spots, a pool look-down, two barrel views): 0 px over 24 at every view, mean diff equal to the on-vs-on noise;
  after a b50 → b48 chain the stubs, scorches and the rebuilt merge (b49) match batch=0 too. Pickup p13: health 40 → 65,
  health batch 25 → 24 drawn from the same pose, taken 1. Barrels: b50 hit → b48 chained, zone 12 merge 3 → 1 drums,
  both stubs shown. door-4 opens 0 → 1 in ~1 s. Zone cull at start: 61 of 114 placed meshes culled. 12-zone tour
  (`pipelinelog`): the same 11 new pipelines (explosion FX) batch on and off, 0 level builds on first sight.
- Seams: `drawsByObject(n, detail)`, `levelBatch()` (on, pickups members/taken/drawn, barrel merges, casing pools shown),
  `setLevelBatch(on)`, `setPickupSpin(yaw)`. Probes `batch/` in the session scratchpad (`m.mjs`, `alt.mjs`, `profalt.mjs`,
  `shots.mjs` + `diff.py`, `func.mjs`).
- **Left for MAP28:** the player's arms and gun are now the biggest bucket (~50 objects every frame: 24 bracer spikes,
  the gun's parts) — merging static same-material parts per bone at load would cut ~30; kits (~10 pieces a visible
  enemy); sector batches grow with zones × kinds (finer zones for the cull multiply them: weigh the two together, or
  texture-array the kinds); per-door frames if MAP28 packs doors into one zone; three's per-object node/binding refresh
  is the floor (~15–20 µs an object here).

**Emitter push: screens and exit signs harder (2026-10-29).** Owner brief after the B1 sheet; three steps, each
alone behind `?emitpush=spill,exit,key` (no param = all three, `none` = the B1 look; pure `webgpu/emit-push.ts`).
The converter writes the lights of every on/off combo of the two placement steps and tags a light not in all four
with `push: [combos]` (level-json keeps the booted combo's), so the level JSON serves every variant.
- **spill**: screen banks get one light per (sector, 8-way facing) wall group of >= 20 m² (ref scale; a sector with
  none keeps its one light) instead of one at the area-weighted middle of a whole room (E1M1's computer room: one
  light 6 m from every bank); power 8 + 0.2/m², cap 30 (`SPILL_SCREEN_LIGHT`); spacing judged within a zone only;
  screen-bank bake x3 (`?spillbake=`). Zone 2 now holds 4 bank lights (the alcove troffer and the 2 dim viewscreen
  lights drop: per-zone cap stays 4); emitter lights total 12 -> 14 (cap `MAX_EMITTER_LIGHTS_PUSH` 15), list 25 -> 27 of 32.
- **exit**: the sign's light hangs low in front of it (wall sign 0.6 m out; hanging box: its sector's fill point,
  not under the lintel against the door), 0.5 m under its bottom edge, >= 1.2 m over the floor, power 50 (was 1.5;
  20 barely read: the cheap tier is diffuse-only and the passage floor is dark metal plate); fluorescent lights
  within 6 m of a sign x0.7, fluorescent bake within 5 m x0.6 (`?exitdim=`), sign bake x6 (`?exitbake=`; adds
  little on metal, the light does the work). Signs skip the min gap to troffers.
- **key**: a body's lights are also ranked by power over the level's median lamp power (clamp 0.1..4,
  `ListLight.rankScale`, rank only: the packed weight / brightness is unchanged), sector levels only. bodyNorm
  divides every lamp by its own power, so a 2.6 viewscreen out-keyed a 10 screen bank by being nearer.
- Measured (`.lab-tmp/emit-push/emit-push-sheet.png`, `measurements.txt`; 960x600 shots, torch off, frozen):
  computer-room floor before the south banks lum 19.2 -> 26.3, G/R 1.15 -> 1.22; wall under the banks 14.4 -> 17.6,
  G/R 1.28 -> 1.40; floor under the exit sign R/G 1.00 -> 1.60 (RGB 14/15/15 -> 24/15/15), door below it R/G 1.02 ->
  1.74; passage wall at 9 m R/G 1.22 -> 1.46. Keys (slot 0): soldier at the south banks blue viewscreen 2.6 ->
  green bank 26.5; soldier at the west alcove viewscreen -> green bank; soldier at the east banks troffer -> green
  bank; alcove flayers troffer -> green bank (all on; spill alone: the zone fill; key alone: the troffer, which
  is the strongest light at them while it exists). Body pixel colour moves little in a rect (the list weight
  carries no power), the sheet shows the flayers turn from cold white to olive-green.
- Cost: draw calls at the room pose identical per variant (107/268 alternate with timeDraws, same in all);
  pipelinelog 12-zone tour all / none: the same 11 explosion-FX builds, 0 level builds, max frame 37 / 39 ms.
- Open: the bank lights stand 0.9 m out at y <= 2.4 under screens at 2.5-6.4 m, so the 6.4 m ceiling gets bake
  only; the second E1M1 sign (sector 70) earns no light (6 m same-family spacing); fluorescent strips beside the
  sign turn pink at 0.9 m.

In flight at compaction (background agents in this session; their results arrive after compaction):
- World-scale agent: comparison shots + doom gate rerun + diagnosis of the gate failure
  "rounds: 1 round steps went through sector geometry" seen after B1 (cause unknown: real regression or classifier).
- Low-health adrenaline: below 35 HP the rush deepens to 0.2 by 20 HP (smoothstep), player 0.85→~0.6, a RED BORDER
  fading inward at the screen edges (owner), only during a rush unless `lowHealthAlways`.

Queued next (owner-approved):
1. **DONE 2026-10-29 (see "Emitter push" above).** **Push screens and exit signs harder** (owner, after the B1 sheet): stronger green/amber spill near the banks,
   a clear red pool at exit signs (dim nearby fluorescent strips a little), and make alcove enemies pick up screen
   colour (today the body key is the nearest light regardless of power, so the troffer light wins). Touches the
   converter — run after the scale agent.
2. **B2: light shafts + dust motes** under fluorescent ceilings / off screens (use `emitterSurfaces`, the `glow`
   light positions, `fluoroCellMean` so dead troffers cast none; calm under ?flashes=reduced).
3. **Doors — DONE 2026-10-28 (see "Doors (2026-10-28)" above).** (owner decided 2026-10-27): sci-fi scratched-steel doors that **split sideways** (two panels part
   left/right, Alien/Star Trek style — door geometry separate from the sector ceiling, our own procedural look),
   **auto-open on approach** (player or enemy; close after a few seconds; no use key). E1M1 has 8 door lines; the
   converter writes door sectors open today. Needs: door state per door sector, panel meshes, collision/nav/sight
   blocked while closed (sector-ray, navigation edges, bounce/light occlusion), enemies opening them, sound later.
4. **Occlusion and update culling — DONE 2026-10-28 (see "Zone cull and update LOD" below).** (owner 2026-10-27: "make sure we don't render or update enemies that aren't
   visible"). Render side exists: sector-aware body cull + kit/gun cull + view-sync skip (7cb532eb..51f0a636).
   Missing: simulation LOD for unseen/far enemies (rig/motion/brain at reduced rate when not visible and not
   engaged; idle wanderers far away frozen or ticked slowly), level-geometry culling per zone (portal/zone
   visibility so whole zones behind walls aren't drawn), and lights/emitter work skipped for unseen zones. Measure
   first (frameSplit seam), then cull; doors become natural portals.
5. Later: cross-zone lights, pickup balance, more zombies
   (sparse), room-level barrels, doom gate run on a quiet machine.

## Shot frame pass (2026-10-29)
**The cost.** A double-barrel volley (2 × 10 pellets, 80 m/s) into a body 2.5 m off made one frame of 50–65 ms
(steady 10–25 ms). Telemetry captures (`__sdfGame.telemetry.start()/stop()/lastCapture()`, which keep per-frame
`tickCpuMs`/`drawCpuMs`, exclusive spans and a GPU busy/idle summary) showed the frame was **CPU-bound JS**, not the
march: tick 20–42 ms, draw 10–23 ms, GPU busy 15–20 ms with 40–70 ms idle.

**Root causes** (new `hit:*` spans split `projectiles-and-hits`: `hit:trace`, `hit:actor`, `hit:bleed`, `hit:flesh`,
`hit:headshot`, `hit:segmesh`, `hit:sector`, `hit:boxes`, `hit:skull`, `hit:kiteye`, `hit:adrenaline`, `hit:corpses`):
1. **The pellet trace** (`traceProjectile` with `sdBody`): 5 cm substeps over each pellet's frame segment, one CPU
   fold (~10 µs on the zombie) each, 880–1540 folds a volley. Worst on E1M1, whose first sector step starts at the
   EYE and reaches nothing: 2.7 m of empty air traced per pellet, 14–33 ms in the frame BEFORE the hits.
2. **The wound probes** (`woundFromPellet` → `rimScaleFor` + `probeFlesh`): ~45 folds per pellet hit, 7–14 ms.
3. **The pellet tracers' pipelines** (the 2 first-use `MeshBasicMaterial` builds on E1M1): additive, double-sided,
   so three draws them twice (cw + ccw pipelines). Built the first frame a pellet is still in flight when the
   effects overlay draws — on E1M1 the hit frame; the arena's pellets hit in their first step and are never drawn.
4. **Torn meat scaled copies** (`game-meat-gib.ts`): each new size bucket cloned + scaled its GLB geometry in the
   hit frame (~1.7 ms for an E1M1 soldier volley). Small.
Not it: blood sim, decals, sound, sector ray tests (`hit:sector` 0.1–0.4 ms), sever/repose/upload (`wound-flush` 1.5–4 ms).
The per-pellet arithmetic warning of 2026-09-04 in damage.ts was not the cost.

**What changed** (all behind **`?shotfix=0`**, which restores the old paths):
- `body-field.ts` **`bodyField`**: sdBody minus the limbs and prims that cannot change it. Each additive prim / cluster
  gets a sphere; `(|p−c|−R)/distort` lower-bounds its field, and the quadratic smin / chamfer return `d` exactly once
  the new value clears `|d| + 4k`, so the skip is **bit-identical** (`body-field.test.ts`, whole cast, at rest and
  severed). Shells and strands under-report past the scale ratio and always fold. No per-cluster slices. The wound
  probes get it through `damage.ts unwarpHit`. Zombie fold 7.9 → 3.4 µs, cultist 30 → 4 µs (vitest).
- **`traceField`**: the trace's field answers "no hit" without folding outside every limb sphere + blend margin
  (the GPU march draws no surface outside the same spheres). Pellet landings pinned identical over the cast.
  Trace 4–8× faster (vitest).
- **`prewarmTracer`** (`game-weapon-rig.ts`): one pooled tracer view drawn once at opacity 0, far under the floor,
  on a step the kit warm built nothing, while no round is in flight.
- **Meat copies** pre-built one a step in `meatGib.prewarm()` for the sizes the live bodies can throw (`meatSizesFor`).

**Before / after** (shot only, `NODECAP=1`, 2.5 m, interleaved A/B rounds on a loaded machine — an Android emulator
and other apps were running, steady medians swing 10–26 ms between runs). `tearMax`/`n50`/`pipes`/steady from 7
rounds per arm (`tear.mjs` ×4 + `tel.mjs` ×3); CPU numbers from the 3 telemetry rounds (medians):

| | arena before | arena after | E1M1 before | E1M1 after |
|---|---|---|---|---|
| `tearMax` median (range) | 47 (43–77) | 44 (39–75) | 51 (44–100) | 47 (43–69) |
| frames > 50 ms (total over 7) | 1 | 2 | 9 | 3 |
| new pipelines on the shot | 0 | 0 | 2 | **0** |
| steady median | 20.0 | 13.8 | 23.7 | 24.5 |
| worst shot-frame CPU (tick + draw) | 30.1 | 26.8 | 39.9 (82 worst) | 37.8 (51 worst) |
| `hit:trace` (volley) | 6.5 | **2.3** | 16.4 (32 worst) | **4.3** |
| `hit:actor` (volley) | 7.1 | **4.5** | 8.9 (18 worst) | **4.7** |
| `hit:flesh` | 0 | 0 | 3.2 | 1.1 |

The hit path's own CPU fell ~17 → ~10 ms (arena) and ~31 → ~12 ms (E1M1). `tearMax` moves less than the CPU because
the headless page is capped at 30 Hz (a 34–40 ms frame is still one long interval) and the machine noise is as large
as the effect. **Left open:** the hit frame still does ~10 ms of hit work plus the first gore draw (goo layer,
`sdf:polys`, `shell-hull` 2–3× their steady CPU while new blood appears) — draw-side CPU, not the march (GPU busy
stays 15–20 ms). Next suspects if it matters: `hit:actor`'s 45 probe folds a hit, `wound-flush`, and spreading the
gout spawns. Probes: `tel.mjs`, `ab-tel-final.sh`, `ab-final.sh` in the session scratchpad.

## Why
Owner: the representational levels (Night Train, the Wake's graveyard) felt less interesting than the
abstract test spaces (ring, arena). Theory: non-architectural, Doom-like layouts feel more alien.
Experiment: rebuild Doom E1M1's layout from `doomu.wad` in our look and play it.

## Documents
- Spec: [2026-10-24-doom-sector-levels-design.md](../superpowers/specs/2026-10-24-doom-sector-levels-design.md)
- Plan 1 (walk an empty E1M1): [plan](../superpowers/plans/2026-10-24-sector-levels-1-walk-e1m1.md) · [notes](2026-10-24-sector-levels-1/NOTES.md) — **done, reviewed, fixed**
- Plan 2 (glowing pools + sector light): [plan](../superpowers/plans/2026-10-24-sector-levels-2-pools-and-light.md) · notes `2026-10-24-sector-levels-2/NOTES.md` (written by Task 7) — Tasks 1–6 done and reviewed; Task 7 (gate + tuning sheet) was running at hand-off
- Plan 3a (enemies, pickups, exit): [plan](../superpowers/plans/2026-10-24-sector-levels-3a-enemies.md) · [notes](2026-10-24-sector-levels-3a/NOTES.md) — **done**

## Owner decisions so far
- Faithful heights (sectors), the WAD as source (not the Sketchfab E1M3 mesh), map E1M1.
- Doors in the spec, but deferred: owner wants **sci-fi scratched-steel sliding doors** later —
  ask "slide up (Doom) or sideways (split panels)" before planning; needs a door mesh/material.
- Lighting: Doom's light levels darkened (A), `?doomlight=0` to compare.
- Enemies: zombieman → random biomech variant (deadeye pistol / butcher axe / flayer sickle),
  shotgun guy → soldier, imp → zombie.
- Order after the first walk: lighting + pools + enemies before doors.
- Playtest of the empty walk (2026-10-24): "I like it, scale feels decent, the darkness is good — it
  feels familiar yet strange", but "hard to judge since it's literally just geometry".
- Follow-up after the full playtest: formalize the level model around Doom-style sectors as part of
  the overall engine/code structure (rooms vs sectors, zones, Rust port) — gated on the verdict.

## Open items at hand-off
1. **Plan 2 Task 7** — gate (hazard damage, glow G/R, sector-light A/B), budget, and a **tuning sheet**
   `.lab-tmp/doom/tuning-sheet.png` (light curve columns: off / max 0.07 γ2.2 (current default, measured
   invisible: +0.3–1.6 grey) / 0.35 γ1.6 / 0.6 γ1.2 / 1.0 γ1.0; pool glowGain 1.0 / 0.6 / 0.35 / 0.2).
   Owner picks; then change the defaults (`DEFAULT_SECTOR_LIGHT` in `sector-light.ts`, glowGain in
   `game-sector-light.ts`).
   **Done 2026-10-24:** gate + sheet built ([notes](2026-10-24-sector-levels-2/NOTES.md)); the owner picked
   **max 0.35 γ1.6** and **glowGain 0.35**, now the defaults. (With the flashlight off the old default measured
   on/off 1.20, +2.4–3.3 grey — the "invisible" reading above had the flashlight on.)
2. **Pool light doesn't colour the room** (owner noticed, 2026-10-24). The converter writes one pool light
   per pool (3 in E1M1, power 14, `mood: 'fire'`, y = floor + 0.6) — `fire` puts it in the cheap
   list tier (diffuse-only, shadowless). Check: did the owner's run have the regenerated level (pool
   lights landed in a02856d1)? If yes, the cheap tier is too weak/short-range — try a higher power, a
   higher position, a full (non-cheap) light for the biggest pool, or a bigger range; measure the green
   on nearby walls with the gate's image-mean tooling.
2b. **Owner playtest (6:17 pm, screenshot): the pool is an unlit green shape floating in black — no green
   in the room.** Diagnosis + fix, queued as the NEXT task after Task 7 (same files: game-sector-mesh.ts,
   game-sector-light.ts, doom_map.py — don't run in parallel with Task 7):
   - Likely bug: level lights pick the FIRST zone room whose bounding box holds them (level-json.ts light →
     room accents via `inRoom`), and zone boxes overlap on sector levels, so a pool light can land in the
     wrong zone's light list. Fix: on sector levels assign each light to the zone of the sector it stands in
     (as `sectorActiveLevel.spawnList` now does for spawns), e.g. re-home accents after parse in
     sector-json.ts using sector-ground.
   - Bounce: bake a per-vertex `glowBounce` RGB attribute at mesh build — sum over pools of pool colour ×
     area weight × falloff(distance from vertex to the pool's nearest point, e.g. 1/(1+(d/3)²), cut at ~12 m,
     only where the vertex can "see" the pool: same or neighbouring sector, or skip occlusion for v1) —
     added into the sector emissive term (× a `bounceGain` uniform, seam-tunable). Free per frame.
   - Optionally the biggest pool gets a full (non-cheap) shadowless light for direction on walls/bodies (~1 ms).
   - Then redo the tuning sheet with bounce on, and measure green on walls near pools (mean G/R of a wall
     crop) before/after.
   **Done 2026-10-24 (items 2 and 2b):** diagnosis: the sector-0 pool light WAS in zone 0's list, but the
   whole room round the pool is sector 1 = zone 1, and with no tunnels on sector levels a zone's surfaces
   shade only their own zone's accents, so the light reached only the pit's 0.75 m risers. The box bug was
   real for another pool (sector 53's light sat in zone 9, not 10): fixed, lights are re-homed by the sector
   under them (`sector-json.ts` rehomeAccents). The room colour comes from a **baked glow bounce**
   (`sector-bounce.ts`, default `bounceGain` 36 — owner pick after playtest, 12 was too weak — × glowGain); the full-tier light (option 3) was skipped —
   it would need neighbouring-zone light masks. Details and numbers: [plan 2 notes](2026-10-24-sector-levels-2/NOTES.md) "Glow bounce".
2c. **Distance veil in glowing rooms (owner playtest 2026-10-24).** Owner: the "dark fog" that hides things
   until you're close makes sense in dark rooms, not in a glowing pool room. Cause: `DUNGEON_RIG` scene fog
   (`dungeon-lighting.ts`: near-black, `fogNear 2.5`, `fogFar 13`) applies to every sector mesh (the glow
   floor itself has `fog = false`, so the pool shows but the green-lit walls behind it fade to black).
   Fix options: (a) per-vertex fog scale on sector meshes — reduce fog where the baked glowBounce (or sector
   light) is high, via a custom fogNode / `fogNode` factor on the sector materials; (b) per-zone fog range
   eased by the player's zone (cheap, but whole-room); (c) treat bright emissive as fog-immune (fog only the
   lit term). Prefer (a). Owner said pool brightness is fine; enemies first, this after.
2d. **Pickup balance (later, owner 2026-10-24: "keep all 44 for now").** E1M1 skill 4 converts to 44 `health`
   pickups, 38 of them Doom's +1 health/armor bonuses (2014/2015), each healing a full 25 (`pickups.ts`).
   Options when balancing: skip the bonuses, or give them a small item. Skill 4 has 16 soldiers (all of
   Doom's shotgun guys are UV-only); `--skill 3` gives 6 monsters.
2e. **Owner playtest with Task 1 spawns (2026-10-24, 11:38 pm):** enemies see/shoot through walls (expected
   until 3a Task 5), some float (expected until Task 4), and the level "feels a bit sparse — add some zombies
   and more enemies in general". Frame time read 46 ms with bodies 5/29 in the HUD — check the budget with
   enemies in Task 6. Density idea: a converter knob that adds zombie packs per zone by area (seeded), on top
   of Doom's things.
2f. **Owner playtest after plan 3a + cull (2026-10-25):** enemies change elevation properly, but dropped
   bodies/kit, ejected shells and blood stains float in mid-air on raised/sunken floors (plan 3b: y = 0 sites
   for gibs, blood, entrails, prop drop, brass, flames, dynamite). "The parts with enemies feel good"; other
   parts need interaction (barrels, doors/switches, secrets). The level is monochrome (one brick texture) —
   rooms need material variation (Doom's per-sidedef/flat textures → a small palette of our materials).
   **Floating debris and barrels done 2026-10-25 (plan 3b, item 4); materials: levels.md item 6.** Doors,
   switches and secrets still open (item 5).
2g. **Expressive lighting: screens and light panels (owner approved 2026-10-25, queued after plan 3b).**
   Owner: the computer room and its enemy alcove need fluorescent / coloured lighting and glowing screens.
   E1M1 emitter textures (WAD counts): COMPUTE2/COMPUTE3/COMPTALL (17 sides), PLANET1 viewscreen (16),
   LITE3 strips (14), EXITSIGN (8), TLITE6_* ceiling flats (12). Today they map to tech / dim light-panel.
   Plan: (1) new emissive families + our own procedural looks — CRT computer banks (green/amber readouts,
   slow scroll, flicker), the viewscreen (dark glass, drifting star/planet display, scanlines), fluorescent
   strips/ceilings (cold blue-white, rare flicker), red exit signs; (2) these surfaces light the room: baked
   coloured bounce onto nearby surfaces (generalise sector-bounce from pools to emissive walls/ceilings),
   plus real coloured converter lights for the strongest emitters (screen banks, fluorescent ceilings over
   alcoves) so bodies are lit; (3) tuning sheet (computer room, alcove, fluorescent corridor), brightness
   seams. Limit: lights still don't cross zones (cross-zone lights follow-up).
   **Part B1 done 2026-10-27 (the emitters light the room).** Colour is one source now: the shader's per-panel
   colours (amber/green screens, LED hues, planets, troffer tint, sign red) live in `emitter-layout.ts` and are
   interpolated into the WGSL, with CPU means (`screenCellMean`, `viewscreenMean`, `fluoroCellMean`, `signMean`;
   mask covers pinned against the generated masks by `emitter-masks.test.ts`). `sector-emitters.ts`
   `emitterSurfaces(map)` lists every emitter wall quad / fluorescent ceiling (area, normal, kind, sector, seed,
   mean colour × the floor-limited sector factor, ≤ 2 m patches); `createEmitterBounce` bakes a disc-like area
   light per patch (A·cosθe·facing / (πd² + A), 8 m cutoff, 2.5D line of sight, art weights screens 4× / signs 2×)
   into two vertex attributes per gain class (`emitScreen` RGB × screenGain; `emitFS` fluoro / sign scalars ×
   fluoroGain / signGain), all × `emitBounceGain` (default 30; `?emitbounce=`, `__sdfGame.sectorLight({ emitBounceGain })`).
   Lines and walls near emitters are refined like pools'; flats near them get interior vertices (`refineFaces`,
   longest-edge bisection, boundary never split: a floor vertex at a wall's foot lies in its plane and catches
   nothing). E1M1: 4855 → 18367 triangles, bake 36–90 ms (load-dependent), 262 patches on 55 surfaces; no new
   draw calls (same meshes). The converter places cheap coloured lights (`mood: "glow"`, a new steady cheap-tier
   mood) for the strongest emitters: teal-green before screen banks, dim blue at the viewscreens, cold white under
   fluorescent ceilings, a small red at the exit sign; ≤ 12, ≤ 4 per zone, in the zone of the sector they stand in
   (E1M1: 12, list 25 of 32). `?emitlights=0`, `?emitlightgain=`, `sectorLight({ emitLightGain })`. Also: LED blinks
   freeze under `?flashes=reduced`, the glow clock wraps at 3600 s (f32), fluorescent ceilings fit whole troffers
   over their polygon's box (a slanted edge still cuts cells), LITEBLU* is a light panel.
   Sheet: `LAB_TMP=.lab-tmp bash scripts/sdf-game-doom-emitlight.sh` + `python3 scripts/sdf-game-doom-emitlight-sheet.py`
   → `.lab-tmp/doom/emitters-light-sheet.png` (B1 off / ½ / default / 2×, torch on and off). Honest read: walls next
   to the banks go green (computer room wall over the banks, torch off: 8.6/10.2/7.6 → 17.3/21.8/14.9 RGB, G/R 1.19 →
   1.26), but the room's floors turn COLD (fluorescent ceilings and the teal light: floor under the south screens
   B/R 1.09 → 1.30), so the computer room reads lit, more by its troffers than its screens. Bodies take an emitter
   light as their key when it is nearest (the old presenting-lamp path ignores power): the alcove flayers shift a
   little cold (B/R 0.87 → 0.90) and read ~14 % DARKER (the key now comes from the troffer light overhead). The exit
   sign's red barely shows (G/R 1.15 → 1.11 on the passage wall): its strips outshine it. Limits: lights don't cross
   zones; a sector's flicker / strobe does not move the baked bounce.
   **Part B2 (next):** light shafts and dust motes under the fluorescents / in front of the screens.
3. **Plan 3a** — enemies on sector floors (motion `floorY`), navigation over sectors, sight and shots vs
   sector walls, pickups, exit as a walk-in trigger (E is slug mode; no use key yet).
   **Done 2026-10-25** ([notes](2026-10-24-sector-levels-3a/NOTES.md)): 29 enemies on their floors, sector
   navigation, sight and rounds stopped by walls, the walk-in exit; gate section 5 passes. Open from it: the body
   render cull ignores sector walls (10 drawn / 1 in sight → 67–75 ms; likely the owner's 46 ms), and the start
   pose reads ~33 ms (plan 2: ~10 ms), undiagnosed.
4. **Plan 3b** (not written) — exploding barrels (no HP/destructible system exists; reuse
   `detonateAt`, add player blast damage, chain delay 0.1–0.3 s) and gore/blood/dynamite/flames/prop drops
   on sector floors (y = 0 sites listed in the plan-3 research: gib-chunks 335, blood-sim 555/559/620,
   entrails 177, prop-drop via character-view 695, game-burning 424/438, dynamite-flight 183,
   game-dynamite-step 57).
   **Done 2026-10-25** ([plan](../superpowers/plans/2026-10-25-sector-levels-3b-debris-and-barrels.md) ·
   [notes](2026-10-25-sector-levels-3b/NOTES.md)): every debris kind rests on the floor under it, falls off ledges
   and stops at sector walls (item 2f's floating debris); E1M1's 6 barrels explode, chain (4.5 m), hurt and are
   shielded by sector walls; gate sections 6 and 7 pass. Next: the barrel grime pass (owner), then item 2g.
5. Doors (see above), lifts, secrets, a use key.

## How to run
- `npm run dev:doom` (opens `/sdf-game.html?level=doom-e1m1`). The level file is generated and
  gitignored: `python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom`.
- Gate: `LAB_TMP=.lab-tmp SHOTS=1 bash scripts/sdf-game-doom-gate.sh` (`DOOM_GATE_ONLY_FIXTURE=1` for the
  committed fixture only). Frame budget fails randomly under high machine load (other sessions).
- Tuning seams: `__sdfGame.sectorLight({ max, gamma, on, glowGain, bounceGain, screenGain, fluoroGain, signGain, emitBounceGain, emitLightGain })` (`?bouncegain=`, `?emitbounce=`, `?emitlightgain=`, `?emitlights=0`), `sectorBake()`, `hazardPoint()`, `health()`, `ground(x, z)`.

## Working method used
Subagent per task; one reviewer per task doing spec compliance then code quality; fixes back to the
same implementer; final branch review. Reviews caught real bugs each time (step-height check below the
floor, line-order-dependent loop tracing on E1M1 sector 28, island-in-hole capture, 36 zones / lights
outside sectors, reversed WGSL smoothstep edges).

## Next spike (owner idea, 2026-10-28): Doom 2 MAP28 "The Spirit World"

After the E1M1 exploration wraps (perf, doors, culling), and after a spec that makes sector levels the standard format, convert Doom 2 MAP28. It's the owner's pick: a long late-game level with mixed areas, to test perf and feel at scale. It needs:
- `doom2.wad` support in `doom_map.py` (MAP## names);
- linedef specials as a small trigger/action system: switches, lifts, doors, keys, teleporters, triggered sectors;
- damaging floors;
- zone culling at scale.

Enemies aren't built yet; map the roster onto the current cast and note the gaps. The WAD-derived JSON is still never committed.
