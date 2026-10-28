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

**Gore tear-off pass (2026-10-28, 3079ce7d).** The old `stepBlood`/`emitTrails` blame was a profiler artifact (process stalls charged to whatever ran); blood sim is ~2–7 ms/s and GPU-bound. Real fix: blood/gib blur pre-warm used `compileAsync` (wrong target keys) so first gore built 3 pipelines; now warms by drawing into the real no-depth half-float targets outside the post callback. Tear-off now 0 new pipelines (arena) / 2 (E1M1). Remaining ~50–65 ms frame is the **shot** (pellet `hit`/`woundFromPellet`/`traceProjectile` + 2 first-use MeshBasicMaterial on E1M1). Open: teratoma kit pipelines compile on first sight (~300 ms) — pre-warm like kit-eye. Probes `tear.mjs`, `ab-tear.sh` in the session scratchpad.

**Teratoma kit pre-warm (2026-10-28, db14ad19).** Kits (skinned glTF, `kit-overlay.ts`) were culled off-screen so first sight built 9–14 materials (0.3–1.0 s); also each kit made its own env texture whose id is in the build key, so copies never shared. Now one shared never-disposed env per renderer + `game-kit-prewarm.ts` un-culls one real kit mesh per step off-camera (then each further copy once, for cacoeye). E1M1 first sight: 0 kit builds; frame still 475–770 ms from **sector zone materials (23–27 builds, ~15–20 ms each) + pickup** — next first-sight target. Boot-in-play warm in drawOnce tried and dropped (keys mismatch). Seam `kitPrewarmPending()`.

**Level + prop pre-warm (2026-10-28, d7daff92, 839984d1).** Zone materials cannot share builds: each (zone, role, kind) batch has its own node graph (r186 keys nodes by id) and each zone room's light list holds its own lights + probe/level-list nodes, whose bindings live in the build state. So `game-level-prewarm.ts` un-culls one real level mesh per step (sector batches, barrels, pickups, glow floors), nearest the player first (`prewarm-order.ts`), and skips its step when the kit pre-warm built. Soldier guns built per instance (per-prop PMREM in the key): held props now share the kit env and the kit pre-warm warms props, plus kits/props hidden by the sector sight cull (`forcedRoot`, kept shown by `syncKitVisibility` for the step). E1M1 11-zone tour, 3 paired rounds: first-sight max 262–278 ms → 37–43 ms, 61 builds → 0, frames >50 ms 10 → 0; level pre-warm done 5.2–5.5 s after warmDone; boot max 113–121 → 103–129 ms (load noise), >50 ms frames after 2.5 s 1–3 → 5 (50–59 ms, one 129). Still built late: meat-gib / kit-eye stand-ins per new actor room (~10 ms each, can land 3 in one frame). Seams `levelPrewarmPending()`, `levelPrewarmDoneMs()`.

In flight at compaction (background agents in this session; their results arrive after compaction):
- World-scale agent: comparison shots + doom gate rerun + diagnosis of the gate failure
  "rounds: 1 round steps went through sector geometry" seen after B1 (cause unknown: real regression or classifier).
- Low-health adrenaline: below 35 HP the rush deepens to 0.2 by 20 HP (smoothstep), player 0.85→~0.6, a RED BORDER
  fading inward at the screen edges (owner), only during a rush unless `lowHealthAlways`.

Queued next (owner-approved):
1. **Push screens and exit signs harder** (owner, after the B1 sheet): stronger green/amber spill near the banks,
   a clear red pool at exit signs (dim nearby fluorescent strips a little), and make alcove enemies pick up screen
   colour (today the body key is the nearest light regardless of power, so the troffer light wins). Touches the
   converter — run after the scale agent.
2. **B2: light shafts + dust motes** under fluorescent ceilings / off screens (use `emitterSurfaces`, the `glow`
   light positions, `fluoroCellMean` so dead troffers cast none; calm under ?flashes=reduced).
3. **Doors** (owner decided 2026-10-27): sci-fi scratched-steel doors that **split sideways** (two panels part
   left/right, Alien/Star Trek style — door geometry separate from the sector ceiling, our own procedural look),
   **auto-open on approach** (player or enemy; close after a few seconds; no use key). E1M1 has 8 door lines; the
   converter writes door sectors open today. Needs: door state per door sector, panel meshes, collision/nav/sight
   blocked while closed (sector-ray, navigation edges, bounce/light occlusion), enemies opening them, sound later.
4. **Occlusion and update culling** (owner 2026-10-27: "make sure we don't render or update enemies that aren't
   visible"). Render side exists: sector-aware body cull + kit/gun cull + view-sync skip (7cb532eb..51f0a636).
   Missing: simulation LOD for unseen/far enemies (rig/motion/brain at reduced rate when not visible and not
   engaged; idle wanderers far away frozen or ticked slowly), level-geometry culling per zone (portal/zone
   visibility so whole zones behind walls aren't drawn), and lights/emitter work skipped for unseen zones. Measure
   first (frameSplit seam), then cull; doors become natural portals.
5. Later: cross-zone lights, pickup balance, more zombies
   (sparse), room-level barrels, doom gate run on a quiet machine.

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
