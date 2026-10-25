# Sector levels / Doom E1M1 experiment — hand-off (2026-10-24)

Branch `claude/level-design-abstract-459f86` (worktree `.claude/worktrees/level-design-abstract-459f86`).
Task wiki: [docs/tasks/levels.md](../tasks/levels.md) "Sector levels + the E1M1 experiment".

## Why
Owner: the representational levels (Night Train, the Wake's graveyard) felt less interesting than the
abstract test spaces (ring, arena). Theory: non-architectural, Doom-like layouts feel more alien.
Experiment: rebuild Doom E1M1's layout from `doomu.wad` in our look and play it.

## Documents
- Spec: [2026-10-24-doom-sector-levels-design.md](../superpowers/specs/2026-10-24-doom-sector-levels-design.md)
- Plan 1 (walk an empty E1M1): [plan](../superpowers/plans/2026-10-24-sector-levels-1-walk-e1m1.md) · [notes](2026-10-24-sector-levels-1/NOTES.md) — **done, reviewed, fixed**
- Plan 2 (glowing pools + sector light): [plan](../superpowers/plans/2026-10-24-sector-levels-2-pools-and-light.md) · notes `2026-10-24-sector-levels-2/NOTES.md` (written by Task 7) — Tasks 1–6 done and reviewed; Task 7 (gate + tuning sheet) was running at hand-off
- Plan 3a (enemies, pickups, exit): [plan](../superpowers/plans/2026-10-24-sector-levels-3a-enemies.md) — written, not started

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
3. **Plan 3a** — enemies on sector floors (motion `floorY`), navigation over sectors, sight and shots vs
   sector walls, pickups, exit as a walk-in trigger (E is slug mode; no use key yet).
4. **Plan 3b** (not written) — exploding barrels (no HP/destructible system exists; reuse
   `detonateAt`, add player blast damage, chain delay 0.1–0.3 s) and gore/blood/dynamite/flames/prop drops
   on sector floors (y = 0 sites listed in the plan-3 research: gib-chunks 335, blood-sim 555/559/620,
   entrails 177, prop-drop via character-view 695, game-burning 424/438, dynamite-flight 183,
   game-dynamite-step 57).
5. Doors (see above), lifts, secrets, a use key.

## How to run
- `npm run dev:doom` (opens `/sdf-game.html?level=doom-e1m1`). The level file is generated and
  gitignored: `python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom`.
- Gate: `LAB_TMP=.lab-tmp SHOTS=1 bash scripts/sdf-game-doom-gate.sh` (`DOOM_GATE_ONLY_FIXTURE=1` for the
  committed fixture only). Frame budget fails randomly under high machine load (other sessions).
- Tuning seams: `__sdfGame.sectorLight({ max, gamma, on, glowGain, bounceGain })` (`?bouncegain=`), `hazardPoint()`, `health()`, `ground(x, z)`.

## Working method used
Subagent per task; one reviewer per task doing spec compliance then code quality; fixes back to the
same implementer; final branch review. Reviews caught real bugs each time (step-height check below the
floor, line-order-dependent loop tracing on E1M1 sector 28, island-in-hole capture, 36 zones / lights
outside sectors, reversed WGSL smoothstep edges).
