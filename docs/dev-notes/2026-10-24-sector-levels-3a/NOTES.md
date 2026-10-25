# Sector levels 3a — enemies, pickups and the exit in E1M1 (notes)

[Plan](../../superpowers/plans/2026-10-24-sector-levels-3a-enemies.md) ·
[spec](../../superpowers/specs/2026-10-24-doom-sector-levels-design.md) §6.3, §9, §9.1 ·
[plan 1 notes](../2026-10-24-sector-levels-1/NOTES.md) · [plan 2 notes](../2026-10-24-sector-levels-2/NOTES.md) ·
[hand-off](../2026-10-24-sector-levels-handoff.md) · 2026-10-25

## What was built

- **Converter things** (`doom_map.py`, `doom_tables.py`, Task 1): Doom's THINGS become spawns and pickups;
  zombiemen → a biomech variant (FNV-1a of the spawn id mod 3 over deadeye / butcher / flayer,
  `--zombieman mix|deadeye|butcher|flayer`), shotgun guys → `soldier`, imps → `zombie`; `--skill 1..5`
  (default 4, Doom's "hard" bit), multiplayer-only things skipped. The exit line becomes a walk-in trigger box
  (`id: "exit"`, `event: level.end`, `completeOn: "level.end"`). New spawn kinds `deadeye`, `butcher`, `flayer`
  in `level-def.ts` / `level-json.ts`.
- **Grid navigation core** (`grid-navigation.ts`, Task 2), moved unchanged out of `encounter-navigation.ts`
  (now a thin room wrapper), and **navigation over sector ground** (`sector-navigation.ts`): cells open where a
  body fits, edges within the step and headroom rules, `floorAt`.
- **Segment vs sector geometry** (`sector-ray.ts`, Task 3, pure): the first wall / floor / ceiling a 3D
  segment meets; `sectorSightBlocker` for sight.
- **Bodies on sector floors** (Task 4): the motion state's `floorY`, eased toward the floor under it at 6 m/s,
  lifts the root and every `groundY` plane. No floor callback → floor 0 (room levels unchanged).
- **Navigation, sight and shots on sector levels** (Task 5): sector navigation built at boot on sector levels;
  the director's sight is floor-relative (feet + 1.4 m, both ends) and blocked by sector geometry; projectiles
  and enemy rounds stop at walls, floors and ceilings (an enemy round's first step starts at the shooter's eye;
  rounds expire by age only on sector levels).
- **Gate** (Task 6, `scripts/sdf-game-doom-gate.mjs` section 5) and one debug seam,
  `__sdfGame.enemyRounds()` (the live enemy-round list, read only, so an in-page sampler follows rounds by
  identity).

## E1M1 converter summary (skill 4)

```
public/assets/levels/doom-e1m1.level.json: 88 sectors, 486 lines, 12 zones, 8 door lines, 12 lights (3 pool)
things: spawns {'zombie': 4, 'butcher': 2, 'flayer': 5, 'deadeye': 2, 'soldier': 16}, pickups {'health': 44,
'shells': 8, 'shotgun': 1}, 1 exit triggers [[[58.0, -0.75, 35.0], [58.8, 1.25, 37.0]]]; skipped types {2: 1, 3: 1,
4: 1, 10: 2, 11: 5, 12: 2, 15: 4, 24: 7, 35: 2, 48: 2, 2028: 8, 2035: 6}, 0 in no sector, 0 not on skill 4,
19 multiplayer-only
```

29 spawns, 53 pickups (44 health — 38 of them Doom's +1 bonuses, each healing a full 25 — 8 shells, the shotgun).

## Gate (`LAB_VITE_PORT=5497 LAB_CDP_PORT=9497 LAB_TMP=.lab-tmp SHOTS=1 bash scripts/sdf-game-doom-gate.sh`)

Two full runs, 2026-10-25, load average 3.9–5.9; both pass end to end (fixture 5/5, route 7/7, sections 4 and 5).
Second run (after the review fixes, commit 84b1fa19):

```
nav: [sector-nav] built in 574.3 ms (88 sectors, 486 lines)
budget: 292 draw calls, 33.50 ms a frame at the start (readings 33.2, 33.5, 33.7); bodies drawn 0 / in frame 0 / in sight 0 / 29; load 4.8
ok   E1M1 budget: 33.50 ms with enemies (fails only over 50 ms at load < 8)
ok   enemies spawned: butcher 2, deadeye 2, flayer 5, soldier 16, zombie 4 (= the converter's 29)
ok   enemies after 3 s: 29 on their floors (worst feet gap 0.000 m; floors -4.25, -1.5, -0.75, -0.5, -0.25, 0, 0.75, 3.25; posed body lowest − floor -0.07..0.10 m over 29, band -0.15..0.25)
ok   enemies after 20 s: 29 on their floors (worst feet gap 0.000 m; ...; posed body lowest − floor -0.07..0.12 m over 29, band -0.15..0.25)
ok   enemies walk: 6 moved > 2 m in 17 s (most 2.83 m, actor 5)
ok   rounds: 8 shots (5 dodged; 3 fired while ducked, 0 of them blind, not judged), 64 rounds followed over 477 frames — 8 stopped at the player, 56 at walls/floors/ceilings (geometry within two frames ahead), 0 expired in flight, 0 other; slowest frame 79 ms; 0 stepped through sector geometry
budget near a cluster (actor 26, 2 near): 250 draw calls, 33.30 ms; bodies drawn 2 / in frame 2 / in sight 2 / 29
budget same pose facing away: 378 draw calls, 34.10 ms; bodies drawn 9 / in frame 9 / in sight 0
ok   exit: trigger exit (level.end) completes the level
ok   sight: hidden 4.75 m from soldier 19 behind a wall for 6 s — 0 shots, health 90 -> 90
ok   sight: stepped 0.93 m into soldier 19's sight — it fired after 1.2 s (all shooters 19, ...; 0 rounds through geometry)
```

Plan 2's checks hold: hazard 100 → 90 in 3.2 s, glow G/R 2.84, sector light A/B 1.84, bounce G/R 2.13 vs 1.19.

How the checks work:

- **Spawned:** `brains()` counted by character equals the level JSON's spawns by kind.
- **On their floors:** each actor's feet (actorList pos y) within 0.08 m of `ground(x, z).floor`, the floor
  finite (catches an unwired `floorAt` or a body in the void); and the POSED body's lowest point
  (`actorGround(id).bodyLowest`) minus the floor inside −0.15..+0.25 m (feet y eases toward the same `floorAt`
  the check reads, so it alone only measures easing lag). Measured −0.07..+0.17 m over three runs.
- **Walk:** at least one actor moves > 2 m in 17 s with the player parked at the start (4–6 do, ~2.8 m:
  idle wandering, not pursuit).
- **Rounds stop at walls (god mode):** the player stands ~4.7 m in front of a soldier that sees it; a sampler on
  requestAnimationFrame counts shots (an actor's `sinceFire` resetting, with the shooter's line of sight at fire
  time) and follows every round by identity, testing each frame's step (and the shooter's eye → first sample)
  with `sectorSegmentHit`. As each volley leaves, the player ducks behind the wall 0.9 m away for 0.7 s so the
  rounds miss and fly on into the walls behind. A round counts as a wall stop only when it vanished young
  (age < lifeSec − 2 × the slowest frame) with sector geometry within two frames' flight ahead. Fails on any
  step through geometry, on any blind shot (shots fired while ducked are reported, not judged), or when no round
  stopped at a wall.
- **Walls block sight (`?god=0`, the hazard boot):** a pose 2.5..5 m from a soldier (fire range 6 m) that it
  cannot see and nobody within 12 m can: 6 s, no shot, no round, health unchanged; then an open pose 0.9 m away
  in that soldier's sight and field of view: the CHOSEN soldier must fire within 6 s.
- **Exit:** standing in the trigger box completes the level (`levelComplete()`).
- **Nav build:** `[sector-nav] built in 518–739 ms` over six boots (load 4–6) — once per boot, before the first
  frame.

## Budget

The plan's rule replaces plan 2's start check: **plan 2 failed the start pose over 33.3 ms; with enemies the
gate fails only over 50 ms at a load average under 8** and reports otherwise.

| pose | draw calls | frame ms (median of 3 × `timeDraws(21)`) | bodies drawn / in sight | load |
| --- | --- | --- | --- | --- |
| start, run 1 | 148 | 32.7 (31.1, 32.7, 33.2) | 1 / 0 | 4.4 |
| start, run 2 | 292 | 33.5 (33.2, 33.5, 33.7) | 0 / 0 | 4.8 |
| pit corridor facing a soldier (40.9, 13.1), run 1 | 384 | **67.3** (35.5, 67.3, 77.4) | **10 / 1** | 5.4 |
| same, facing away | 242 | 34.1 | 1 / 1 | 5.4 |
| trial run, same corridor pose | 438 | **74.8** (39.9, 74.9, 74.8) | 10 / 1 | 4.7 |
| pit corridor (48.1, 7.6), run 2 | 250 | 33.3 | 2 / 2 | 3.9 |
| same, facing away | 378 | 34.1 | 9 / 0 | 3.9 |

Two findings, neither fixed here:

- **(a) Bodies drawn behind sector walls.** `updateVisibleActors` (`game-render-controls.ts`) culls by frustum
  then `bodyInSight` (`actor-sight.ts`), which tests `ctx.world.colliders` (boxes) only — on a sector level
  nothing blocks it, so every body in the frustum is drawn. At the corridor pose 10 were drawn with 1 in sight:
  67–75 ms, against 33–34 ms facing away (1 drawn). This is the likely cause of the owner's 46 ms with bodies
  5/29 in the HUD. Fix: also test the sector sight blocker in `bodyInSight` on sector levels. Not every case
  costs that much: at the second corridor pose 9 drawn / 0 in sight cost nothing visible (34.1 vs 33.3 ms),
  so the cost depends on what is drawn (near, big on screen) — measure after the fix.
- **(b) The start pose reads ~33 ms with no body drawn**, against plan 2's 9.9–11.2 ms at the same pose.
  Undiagnosed. The readings cluster at 33.2–34.1 ms and the slow ones at 67–77 ms (about 2×), which looks
  quantised — `timeDraws` fences each frame on the GPU, and the fence may be waiting on a ~30 Hz present cadence
  in headless Chrome rather than the frame's own cost (but the flat gate's same probe reads 8.1 ms on this
  machine, so there is no hard 33 ms floor); or the 29 actors' sim adds the time. Check with the
  bench's pass timings, or `timeDraws` at `?level=doom-e1m1` with the spawns stripped, before acting.

## Shots looked at (`.lab-tmp/doom/e1m1-enemies-0..3.png`, never committed; pitch −0.18 to get feet in frame)

- **0** — a soldier in the pit corridor (floor −4.25), close; standing at human scale against the corridor;
  boots partly behind the view-model gun.
- **1** — two soldiers on the 3.25 m ledge room, one firing: boots clearly on the floor, scale right against the
  brick and the ledge block. The clearest evidence shot.
- **2** — a zombie by the nukage (floor −1.5); its feet are hidden by the gun (an earlier run showed the zombie
  behind it on the floor at the foot of the wall).
- **3** — a flayer on floor −0.75 with its feet on the floor; a soldier behind it on what reads as the 0.25 m step
  (soldier 25's floor is −0.5).

Nothing sunk or floating, at the right scale. The route shots (`e1m1-<i>-<k>.png`) still show the empty-route
look from plan 2.

## Regressions (room levels unchanged)

Run 2026-10-25 on ports 5497/9497, load average 3.6–5.0:

| gate | result |
| --- | --- |
| `scripts/sdf-game-loop-gate.sh` (Night Train) | **PASS** — loadout, pickups, damage (a zombie bites, health 90), death, ending |
| `scripts/sdf-game-flat-gate.sh` | **PASS** — fridge collision 0.30 m, hall → room 0.17 m, hall → bathroom 0.13 m, 8.1 ms a frame |
| `scripts/sdf-game-wake-gate.sh` | **PASS** — boot, layout, outdoors, gate blocked/open, multi-floor refused |
| `scripts/sdf-game-crowd-gate.mjs` (no `.sh`; run against the gate's servers) | **FAIL, pre-existing** — section 4 "negative control": with the player at (−4.8, 0) "tunnel 4-1 mouth" the room-4 zombies (1.1–5.9 m off) and the room-1 soldier stay alert. Run 1 timed out earlier, on `step(15)` (flake). The **base** (b7295f5e, before Task 2, temporary worktree, same Chrome) fails identically, twice: same crowd 0.887 m, probe 0.740 m, the same alert list (soldier sinceFire 0.683). Not caused by plan 3a; the gate's tunnel pose looks stale against the ring's current layout or the brain's lose rules. |
| arena `?level=arena&spawn=deadeye` | boots ready on webgpu, 0 errors; deadeye `engage`, feet y 0.000, moved 1.76 m in 5 s |
| arena `&spawn=butcher` | ready, 0 errors; butcher `attack`, feet y 0.000, moved 5.86 m |
| arena `&spawn=flayer` | ready, 0 errors; flayer `attack`, feet y 0.000, moved 5.85 m |

The arena checks are a scratch driver (boot, `brains()`, `actorList()`, console errors), not a committed gate.

## Decisions taken in this plan

- Exit = walk into the switch: a 0.8 m deep trigger box on the exit line's front side, floor to floor + 2 m,
  firing `level.end`; `completeOn: "level.end"`. A use key comes with doors.
- Skill: Doom's "hard" flag (UV, bit 4) by default, `--skill 1..5`; multiplayer-only things skipped.
- Zombieman variant: FNV-1a of the spawn id mod 3 over `[deadeye, butcher, flayer]`; `--zombieman`.
- Pickups: shotgun → `shotgun`; shells / clips / bullets / boxes → `shells`; stimpack, medikit, armour, bonuses
  → `health`; everything else skipped and counted. Barrels skipped (plan 3b).
- Bodies ease onto floors at 6 m/s both ways (no pop up a step; a falling body is 3b's business).
- Sight height is floor-relative (feet + 1.4 m, both ends).
- Gate: the start budget rule is the plan's (fail > 50 ms at load < 8), replacing plan 2's 33.3 ms check.

## Gaps

- **Barrels, gore, blood, dynamite and flames on sector floors** → plan 3b (they still assume y = 0; sites in the
  hand-off item 4).
- **Doors**, lifts, secrets, a use key; **enemies don't open doors** (there are none to open yet).
- **The exit is walk-in**, not a switch you use.
- **Pickup balance deferred by the owner** ("keep all 44 for now"): 44 health including 38 bonuses that each heal
  25.
- **The level feels sparse** (owner): wants more zombies / enemies. Idea: a converter knob adding seeded zombie
  packs per zone by area on top of Doom's things.
- **Distance fog veil in glowing rooms** (owner): the dungeon fog hides the green-lit walls of pool rooms
  (hand-off item 2c; per-vertex fog scale preferred).
- **Render cull vs sector walls** (finding (a) above) and the **start-pose 33 ms** (finding (b)).
