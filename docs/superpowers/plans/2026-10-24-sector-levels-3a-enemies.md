# Sector levels 3a — enemies, pickups and the exit in E1M1 — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** E1M1 plays as a level: Doom's monsters at their own positions (zombiemen → a random
biomech variant, shotgun guys → soldiers, imps → zombies), walking E1M1's floors, steps and ledges,
seeing and shooting only through open space; shots stopping at sector walls, floors and ceilings;
Doom's pickups on the floor; the exit switch ends the level.

**Spec:** `docs/superpowers/specs/2026-10-24-doom-sector-levels-design.md` §6.3 (navigation and
actor ground height), §9 and §9.1 (things, the zombieman's variants). Plan 1 and 2 notes:
`docs/dev-notes/2026-10-24-sector-levels-1/NOTES.md` (known gaps) and `…-sector-levels-2/NOTES.md`.

**Architecture:** pure modules decide; game modules plug them in where the y = 0 assumptions live.
- `grid-navigation.ts` (new, pure): the grid BFS / follow / nearest core extracted unchanged from
  `encounter-navigation.ts`, which becomes a thin room-level wrapper (identical behaviour).
- `sector-navigation.ts` (new, pure): the same navigation interface over sector ground — cells open
  where a body fits, edges allowed within the step and headroom rules, `roomAt` through the sector's
  zone, `floorAt`.
- `sector-ray.ts` (new, pure): where a 3D segment first hits sector geometry (walls by part, floors,
  ceilings) — used by projectiles, enemy rounds and line of sight.
- `sz/motion.ts`: a motion state learns a `floorY` (eased toward the floor under it) that lifts the
  root shift and every place `joints.groundY` is used as a world plane. No floor callback → floor 0,
  byte-identical to today.
- The converter writes spawns, pickups and an exit trigger from Doom's THINGS and exit lines.

**Tech Stack:** TypeScript, three.js WebGPU, Vitest, Python 3 + pytest, headless-Chrome gate.

**Decisions taken in this plan:**
- **Exit = walk into the switch.** E is slug mode and there's no free use key; the converter writes a
  trigger box (0.8 m deep, the switch line's width, floor to floor + 2 m) on the exit line's front
  side, firing `level.end`, and sets `completeOn: "level.end"`. A real use key comes with doors.
- **Skill:** things with Doom's "hard" flag (Ultra-Violence, bit 4) by default; `--skill 1|2|3|4|5`;
  multiplayer-only things (bit 16) are skipped.
- **Variant pick:** FNV-1a of the spawn id, mod 3 over `[deadeye, butcher, flayer]`; `--zombieman
  mix|deadeye|butcher|flayer` (default `mix`).
- **Pickups:** shotgun → `shotgun`; shells/clip/bullets/boxes → `shells`; stimpack, medikit, armor,
  bonuses → `health`; everything else skipped and counted in the summary. Barrels are skipped here
  (plan 3b).
- **Enemies step up smoothly:** `floorY` eases toward the floor at 6 m/s (the player's eye rate), so
  a body never pops up a step; drops ease at the same rate (a falling body is plan 3b's business).
- **Sight height** becomes floor-relative (feet + 1.4 m, both ends), so a soldier on a ledge sees a
  player below.

**Out of scope (plan 3b and later):** barrels, gore/blood/dynamite/flames on sector floors, doors,
lifts, monsters opening doors, sound, per-sector body darkening.

## Rules for every task

- **Port-ready by construction:** game logic in pure, renderer-free modules with tests (no `three`
  import); state on `ctx` slices or inside a feature module (`npm test -- game-context-coverage`);
  deterministic (seeded, sim time).
- **Room levels must not change.** The ring testbed, Night Train, the Wake, the Flat and the arena
  keep byte-identical behaviour: every new parameter defaults to today's value (floor 0, no sector
  geometry). Prove it with the existing tests (motion snapshot tests in
  `src/lab/sdf-zombie/__snapshots__`, `encounter-navigation.test.ts`, the actor tests) passing
  UNCHANGED, and the regression gates in Task 7.
- Work ONLY in your worktree. Never `git stash`. Don't reinstall `node_modules`.
- **Targeted tests only** (`npx vitest run <paths>`, `npm run test:changed`) plus `npm run typecheck`
  (~2 min, once per round). Never the full suite.
- **Headless capture only.** Gates need `window.__warmGate.phase === 'ready'`. Machine load is often
  high: a budget failure at load average > 15 is re-run, not "fixed".
- **Prove claims with numbers** and look at screenshots yourself.
- **Anything derived from the WAD is a dev placeholder:** never commit
  `public/assets/levels/doom-*.level.json` or `.lab-tmp/`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/grid-navigation.ts` | create | Grid BFS core (moved from encounter-navigation) |
| `src/lab/sdf-zombie/webgpu/encounter-navigation.ts` | modify | Room wrapper over grid-navigation (same API, same results) |
| `src/lab/sdf-zombie/webgpu/sector-navigation.ts` | create | Navigation over sector ground |
| `src/lab/sdf-zombie/webgpu/sector-ray.ts` | create | Segment vs sector walls/floors/ceilings |
| `src/lab/sdf-zombie/webgpu/sector-ground.ts` | modify | `linesNear(x0, z0, x1, z1)` candidate query |
| `src/lab/sdf-zombie/motion.ts` (+ `ik.ts`, `soldier-footwork.ts` only if they read groundY directly) | modify | `floorY` on the motion state |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | modify | pass `floorAt`; y=0 writes → floorY |
| `src/lab/sdf-zombie/webgpu/game-main.ts:~689` | modify | build sector navigation on sector levels |
| `src/lab/sdf-zombie/webgpu/encounter-director.ts` | modify | sight vs sector rays; floor-relative heights |
| `src/lab/sdf-zombie/webgpu/game-tick.ts` | modify | projectiles + enemy rounds vs sector-ray; zombie boxes at their floor |
| `src/lab/sdf-zombie/webgpu/game-hit-trace.ts` | modify | `ceilingAt` via ground on sector levels |
| `src/lab/sdf-zombie/webgpu/game-loop.ts` | modify | pickup meshes at their floor |
| `src/lab/sdf-zombie/webgpu/level-def.ts`, `level-json.ts` | modify | spawn kinds deadeye/butcher/flayer |
| `scripts/levels/doom_map.py`, `doom_tables.py`, `scripts/tests/test_doom_map.py` | modify | things, exit trigger, `--skill`, `--zombieman` |
| `scripts/sdf-game-doom-gate.mjs` | modify | enemy and exit checks |
| `docs/dev-notes/2026-10-24-sector-levels-3a/NOTES.md` | create | results |

---

## Task 1: Spawn kinds and the converter's things

**Files:** `level-def.ts`, `level-json.ts` (+ `level-json.test.ts`), `scripts/levels/doom_map.py`, `doom_tables.py`, `scripts/tests/test_doom_map.py`.

- [ ] **Step 1 (TS):** `SpawnKind` gains `'deadeye' | 'butcher' | 'flayer'`; the whitelist in
  `level-json.ts` (~402–403, the "kind must be …" error) accepts them; they do not bump
  `room.soldiers` (only `'soldier'` does). Test in `level-json.test.ts`: a copy of `two-rooms` with a
  `deadeye` spawn parses; `'imp'` is refused with the message listing all kinds. Confirm
  `game-spawn.ts` `spawnAll` passes non-zombie kinds straight to `spawnEnemy(ctx, name, …)` (research
  says it does, ~505–513) — no change there.

- [ ] **Step 2 (Python tables):** in `doom_tables.py` add

```python
# Doom thing types -> ours (spec 2026-10-24 §9). Zombiemen become a biomech variant (§9.1).
ZOMBIEMAN = 3004
THING_SPAWNS = {9: "soldier", 3001: "zombie"}            # shotgun guy, imp (for now)
ZOMBIEMAN_VARIANTS = ("deadeye", "butcher", "flayer")
THING_PICKUPS = {
    2001: "shotgun",
    2008: "shells", 2049: "shells", 2007: "shells", 2048: "shells",     # shells, box, clip, box of bullets
    2011: "health", 2012: "health", 2014: "health", 2015: "health", 2018: "health", 2019: "health",
}
SKILL_BITS = {1: 1, 2: 1, 3: 2, 4: 4, 5: 4}               # Doom skill -> THINGS flag bit
MULTIPLAYER_ONLY = 16
```

- [ ] **Step 3 (Python, test first):** extend the test WAD with things: a zombieman (flags 7) in A,
  a shotgun guy (flags 4, hard only) in A, an imp (flags 1, easy only) in A, a clip (flags 7) in B,
  a multiplayer-only shotgun (flags 23) in A, and an exit line: give the test WAD a third tiny
  sector or reuse line (0, 1)'s special = 11 (an exit switch). Tests:
  - default skill 4: spawns are the zombieman (kind in the variants) and the shotgun guy (soldier);
    the imp is absent; `--skill 1` keeps the imp and drops the shotgun guy;
  - the multiplayer-only shotgun is absent; the clip is a `shells` pickup at `y == floor(B)`;
  - spawn and pickup ids are stable (`s<thingIndex>`, `p<thingIndex>`); spawn `yaw` uses the same
    `radians(90 - angle)` rule as the start;
  - `--zombieman butcher` makes every zombieman a butcher; `mix` is deterministic (same output twice)
    and uses FNV-1a 32 of the id string mod 3;
  - the exit: `completeOn == "level.end"` and one trigger `{id: "exit", event: "level.end", once:
    true}` whose box lies on the exit line's FRONT side (the sector on the line's left — our
    winding), 0.8 m deep, spanning the line, from the front sector's floor to floor + 2;
  - the summary counts kinds and skipped thing types.

- [ ] **Step 4 (Python):** implement in `convert()` (new args `skill=4, zombieman="mix"`; CLI flags
  `--skill`, `--zombieman`). Positions: `[X(x), floor_of_sector_at(x, y), Z(y)]` using the existing
  inside test. A thing in no sector is skipped and counted. FNV-1a:

```python
def fnv1a32(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h
```

  The exit trigger box: for each line with an exit special, the front sector f; the line's left
  normal n (our winding: left of v0→v1, i.e. `(-dz, dx)` normalised in our x/z); the box is the axis
  aligned bounds of the quad `{a, b, a + 0.8 n, b + 0.8 n}`, y from `floor(f)` to `floor(f) + 2`.
  (A diagonal switch line gives a slightly bigger box — fine.)

- [ ] **Step 5:** `python3 -m pytest scripts/tests/test_doom_map.py -q`; regenerate E1M1
  (`python3 scripts/levels/doom_map.py "$HOME/MIYOO BACKUP/Roms/PORTS/Games/Doom (PrBoom)/doom/doomu.wad" E1M1 --svg .lab-tmp/doom`);
  TS parse check (`npx tsx -e` with `parseSectorLevel`, as in plan 1) — it must pass, including
  "spawn/pickup must stand in a sector" and the trigger. Report the summary (spawns by kind, pickups
  by item, skipped). Commit (no generated files): `feat(levels): E1M1's things — biomech zombiemen,
  soldiers, zombies, pickups, the exit`.

---

## Task 2: Grid navigation core, and navigation over sectors

**Files:** create `grid-navigation.ts`, `sector-navigation.ts` (+ tests); modify `encounter-navigation.ts`, `sector-ground.ts`.

- [x] **Step 1: Extract the core, behaviour unchanged.** Read `encounter-navigation.ts` fully. Move
  the grid build, `nearest`, BFS `route`, `follow` into `grid-navigation.ts`:

```ts
export interface GridNavSpec {
  bounds: WanderBounds;
  step: number;
  canStand(p: Vec3): boolean;
  canTravel(a: Vec3, b: Vec3): boolean;
  roomAt(p: Vec3): number;
  /** Feet height at p (0 on room levels). */
  floorAt(p: Vec3): number;
}
export function createGridNavigation(spec: GridNavSpec): EncounterNavigation
```

  and make `createEncounterNavigation(rooms, tunnels, boxes, radius)` build its `canStand` /
  `canTravel` / `roomAt` exactly as today and call it (`floorAt: () => 0`). Add `floorAt` to the
  returned navigation type. **All of `encounter-navigation.test.ts` must pass unchanged** (and the
  crowd/director tests that use navigation).

- [x] **Step 2: `linesNear` on sector ground.** `SectorGround` gains
  `linesNear(x0: number, z0: number, x1: number, z1: number): readonly number[]` — the line indices
  in the grid cells the box covers (deduplicated). Test it on the fixture.

- [x] **Step 3: `sector-navigation.ts` (test first).** Tests on the sectors fixture (plan 1 diagram:
  A floor 0 with a column, B 0.5 step, C 1.5 ledge, D −1 pit):
  - `canStand` is false in the column, outside the map, and within `radius` of a one-sided wall;
    true in the middle of A, B, C, D;
  - `canTravel` A→B true (0.5 m up), B→C false (1.0 m up), A→D true (down), D→A false;
  - `route` from A's middle to B's middle exists; from A to C does not (no way up the ledge);
    from D to A does not;
  - `roomAt` gives zone room ids (A, B, C → 1; D → 2), 0 in the column;
  - `floorAt` returns the sector floor.

  Implement `createSectorNavigation(map, ground, rooms, boxes, radius = 0.34): EncounterNavigation`:
  - `canStand(p)`: `ground.floorAt(p)` finite; headroom `ceilAt − floorAt ≥ SECTOR_HEADROOM_M`; no
    line returned by `ground.blockingNear(x, z, radius, floor)` within `radius` of p (distance to
    segment); outside every inflated box of `boxes` overlapping feet..feet + 1.8.
  - `canTravel(a, b)`: sample every 0.12 m; for consecutive samples p→q: `canStand(q)` and
    `floor(q) − floor(p) ≤ SECTOR_STEP_M` (any drop is fine).
  - `roomAt(p)`: `ground.sectorAt` → `map.sectors[s].zone` → the room named `zoneName(zone)` → its id
    (0 when none).
  - bounds: the vertices' extent; `step: 0.4`.
  The cost: build once at load (E1M1 ≈ 120 × 110 m → ~80k cells; if building takes > 300 ms in the
  gate, report it — a coarser 0.5 m step is the fallback).

- [x] **Step 4:** run the new tests + `encounter-navigation.test.ts` + any test that imports it
  (`grep -l encounter-navigation src/lab/sdf-zombie/**/*.test.ts`); typecheck. Commit:
  `feat(levels): grid navigation core; navigation over sector ground`.

---

## Task 3: Segment vs sector geometry (pure)

**Files:** create `sector-ray.ts` + test.

- [ ] **Step 1: Tests first** (fixture):
  - a horizontal segment at y 1 from A (0, 1, −1) toward the north wall (0, 1, 1) hits at z = 0
    (t ≈ 0.5), kind `'wall'`;
  - from A at y 0.25 toward B across the riser line z = −8 hits the riser (`'wall'`, the lower part
    between floors 0 and 0.5) — at y 0.75 it passes into B;
  - from B (y 1.0) toward C across z = −12 at y 1.0 hits the C riser (lower part, floors 0.5..1.5);
    at y 1.8 it passes;
  - a segment ending below A's floor hits `'floor'` at y = 0; one rising above A's ceiling hits
    `'ceil'` at y = 4;
  - a segment through the column hits its face;
  - D's ceiling is sky (`materials.ceil === 'sky'`): a segment rising above D's ceiling height is
    NOT stopped by it (sky is open; it leaves the map) — returns null for the sky part;
  - a segment wholly inside open space returns null.

- [ ] **Step 2: Implement.**

```ts
export type SectorHitKind = 'wall' | 'floor' | 'ceil';
export interface SectorHit { t: number; point: [number, number, number]; kind: SectorHitKind }

/** The first place segment a→b meets sector geometry, or null. */
export function sectorSegmentHit(map: SectorMap, ground: SectorGround,
  a: readonly [number, number, number], b: readonly [number, number, number]): SectorHit | null
```

  Walls: for each candidate line from `ground.linesNear(bbox of a, b)`, 2D segment–segment
  intersection gives `t` and `y = a.y + t (b.y − a.y)`; one-sided → hit; two-sided → hit when
  `y < max(floors)` (lower part) or `y > min(ceils)` (upper part) — except the upper part is open
  when both sectors' ceilings are sky. Floors/ceilings: walk the segment's sector at `a`; if b's y
  is below `floorAt(b)` (or above a non-sky `ceilAt(b)`), solve `t` where y crosses that height
  (use the sector at the crossing's x/z; for the short per-frame steps this is exact enough). Return
  the smallest `t`. Pure; no three.

- [ ] **Step 3:** tests pass; commit `feat(levels): segment vs sector geometry (pure)`.

---

## Task 4: Bodies stand on sector floors

**Files:** `src/lab/sdf-zombie/motion.ts` (+ the modules below only where they read the floor directly), `src/lab/sdf-zombie/webgpu/game-actor.ts`, `game-spawn.ts`, `game-tick.ts`.

Read first: `motion.ts` around `makeMotionState` (~371), the root shift (~799–801), every use of
`joints.groundY` (~287, 705, 718, 1245, 1326, 1459, 1465, 1575–1592), `ik.ts` 225–245,
`soldier-footwork.ts` 42–84, `rig.ts` 114/144, `pose.ts` 84/163, `wander.ts` 100/144–147; in
`game-actor.ts`: the motion step (~1532), `correctFrame` (~1543–1551), y = 0 writes (~255, 287,
1256–1259, 1353, 1755–1758), `pose()` (~2282).

- [ ] **Step 1: Test first (motion).** In a motion test file, step a zombie motion state with
  `floorAt: () => 1` for 2 s: `state.floorY` reaches 1 (eased: after 1/60 s it is ≤ 0.1), the frame's
  `floorY` is the old value + 1, the root shift's y is 1, `wander.pos[1]` is 1; with a floor that
  steps from 0 to 0.5 mid-walk, `floorY` rises at ≤ 6 m/s. With NO `floorAt` option, a recorded frame
  equals the frame before this change: the existing snapshot tests must pass unchanged.

- [ ] **Step 2: Implement in `motion.ts`.**
  - `MotionState.floorY: number` (init 0 in `makeMotionState`; or `start[1]` when a caller passes a
    real start y — keep 0 when start[1] is 0).
  - `stepMotion` takes an optional `floorAt?: (x: number, z: number) => number`. After the wander
    position updates: `target = floorAt(x, z)`; if finite, move `floorY` toward it by at most
    `FLOOR_EASE_MPS × dt` (6 m/s); `wander.pos[1] = floorY`.
  - Root shift y = `floorY` (was 0).
  - Every place `joints.groundY` is used as a WORLD plane adds `floorY` (stance, step plants,
    hand/paw ground, `floorY` in the frame, the soldier fall, floor contact). Keep it one helper
    (`worldGround(state) = joints.groundY + state.floorY`) so the edit is uniform. Where a module
    outside motion.ts reads `groundY` itself (`ik.ts`, `soldier-footwork.ts`, `rig.ts`, `pose.ts`),
    pass the world ground in rather than reaching for joints.
  - `wander.ts` writes `y = 0` for targets: leave them (targets are x/z; `wander.pos[1]` is set
    from floorY after the step).

- [ ] **Step 3: Game side.** `game-actor.ts`: pass `floorAt: (x, z) => ground.floorAt(x, z)` into
  the motion step when the level has sectors (thread `ctx.world.level.ground` through the actor's
  options at spawn, `game-spawn.ts`); `correctFrame` translates by dy too when it undoes a move;
  the y = 0 writes listed above become the actor's current `floorY` (goal points, knock clamp,
  `lastPlayerPos` keep the player's y, `nudge`). `game-spawn.ts`: spawn feet at `s.pos[1]`
  (`standingFloor` of the spawn point). `game-tick.ts` ~218–221: zombie boxes span
  `p[1] .. p[1] + 1.8`.

- [ ] **Step 4: Verify.** The motion/actor/rig/IK/footwork tests and snapshots unchanged
  (`npx vitest run src/lab/sdf-zombie/motion*.test.ts src/lab/sdf-zombie/ik*.test.ts src/lab/sdf-zombie/soldier-footwork*.test.ts src/lab/sdf-zombie/rig*.test.ts src/lab/sdf-zombie/webgpu/game-actor*.test.ts` — adjust the glob to what exists), `npm run test:changed`, typecheck. Commit:
  `feat(actors): bodies stand on the floor under them (sector levels)`.

---

## Task 5: Navigation, sight and shots on sector levels

**Files:** `game-main.ts` (~689–690), `encounter-director.ts`, `game-tick.ts` (~784–904 player projectiles, ~952–963 enemy rounds, ~970–993 rockets/bile, ~291–294 player room), `game-hit-trace.ts` (~153–165 `ceilingAt`).

- [ ] **Step 1: Build sector navigation.** At `game-main.ts` ~689: on a sector level,
  `createSectorNavigation(def.sectors, ctx.world.level.ground as SectorGround, level.rooms,
  level.staticColliders)`; else today's call. Everything downstream (director, actors, player room
  at `game-tick.ts` ~291) uses the same interface.

- [ ] **Step 2: Sight.** `encounter-director.ts` ~115–116, 105, 158–161, 210: sight runs from
  `[x, actorFloor + 1.4, z]` to `[px, playerFeet + 1.4, pz]`; on sector levels it is also blocked when
  `sectorSegmentHit(map, ground, from, to)` is non-null. Targets keep the player's real y. Add a
  test in the director's test file if it has one (a wall between → not visible); otherwise cover it
  in the gate.

- [ ] **Step 3: Shots.** In `game-tick.ts`:
  - player pellets/slugs (~858–866): on sector levels, before the actor test, `hit =
    sectorSegmentHit(map, ground, prevPos, p.pos)`; a hit kills the projectile at `hit.point` (spawn
    the same impact the AABB branch spawns, if any); keep the old `y <= 0.02` floor kill for room
    levels only;
  - enemy rounds (~952–963): same test before `segmentHitsCapsule` against the player;
  - rockets and bile (`hitsWorld`, ~970–993): add the sector hit; their floor/ceiling use the sector.
  - `game-hit-trace.ts` `ceilingAt`: on sector levels `ground.ceilAt(x, z)` (Infinity for sky →
    the room-level fallback height).

- [ ] **Step 4: Pickup meshes** (`game-loop.ts` ~100): y = `p.pos[1] + 0.25` on sector levels
  (keep `Math.max(0.25, p.pos[1])` on room levels).

- [ ] **Step 5:** typecheck, `npm run test:changed`, `npm test -- game-context-coverage`. Commit:
  `feat(levels): enemies route, see and shoot through sector space; shots stop at walls`.

---

## Task 6: Gate and play numbers

**Files:** `scripts/sdf-game-doom-gate.mjs`.

- [ ] **Step 1: E1M1 enemy checks** (after the route section; boot `?level=doom-e1m1&god`):
  1. **Spawned:** `__sdfGame` actor listing (find the seam: `grep -n "actors" src/lab/sdf-zombie/webgpu/game-seams*.ts`)
     count by character equals the converter's summary (read the level JSON in node).
  2. **On their floors:** after 3 s (AI running), every live actor's feet y is within 0.08 m of
     `ground(x, z).floor` and `ground` is finite (no actor in a wall or the void).
  3. **Walk the room:** after 20 s with AI on and the player parked at the start, the same holds, and
     at least one actor has moved > 2 m (navigation works on sectors).
  4. **Walls block sight:** park the player in the start room behind a wall from the nearest enemy
     group (choose a pose from the SVG/route); for 6 s, no enemy fires (shot count seam, or player
     health unchanged with `god=0`); then step into the open and see fire within 6 s. If a seam for
     shots fired doesn't exist, use health with `?god=0` and a high-health cheat if available;
     report what you used.
  5. **The exit:** `setPose` into the exit trigger box (from the JSON) → the level completes (the
     loop's done flag or the LEVEL COMPLETE overlay — find the seam).
  6. Budget at the start with enemies: report draw calls and frame ms (do not fail on it under load;
     fail only if > 50 ms at load average < 8).
  7. SHOTS: four shots with enemies in view (pick poses near spawn clusters).

- [ ] **Step 2: Run** `LAB_TMP=.lab-tmp SHOTS=1 bash scripts/sdf-game-doom-gate.sh`. LOOK at the
  shots: bodies standing on floors and steps (not sunk, not floating), at the right scale.

---

## Task 7: Regressions, notes

- [ ] **Step 1: Room levels unchanged.** Run the existing gates that exercise actors and navigation
  on room levels: `scripts/sdf-game-loop-gate.sh` (Night Train), the crowd gate
  (`scripts/sdf-game-crowd-gate.mjs` via its `.sh` if present), `scripts/sdf-game-flat-gate.sh`,
  `scripts/sdf-game-wake-gate.sh`, and the arena boot (`?level=arena&spawn=deadeye`, `butcher`,
  `flayer`). Report each.
- [ ] **Step 2: Notes** `docs/dev-notes/2026-10-24-sector-levels-3a/NOTES.md`: what was built, the
  converter summary for E1M1, the gate numbers, the shots looked at, the decisions list above, and
  gaps (barrels, gore on floors, dynamite floor, flames — plan 3b; doors; enemies don't open doors;
  the exit is walk-in).
- [ ] **Step 3:** `docs/tasks/levels.md`: item 5 split into 5a (done, links) and 5b (barrels + gore
  floors, next). Commit: `test(levels): E1M1 with enemies — gate, notes`.
