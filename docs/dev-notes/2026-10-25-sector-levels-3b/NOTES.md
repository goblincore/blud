# Sector levels 3b — debris on sector floors, and exploding barrels (notes)

[Plan](../../superpowers/plans/2026-10-25-sector-levels-3b-debris-and-barrels.md) ·
[spec](../../superpowers/specs/2026-10-24-doom-sector-levels-design.md) §6.1, §8, §9 ·
[plan 3a notes](../2026-10-24-sector-levels-3a/NOTES.md) · [hand-off](../2026-10-24-sector-levels-handoff.md) items 2f, 4 ·
2026-10-25

Owner playtest after 3a: "dropped bodies/kit, ejected shells and blood stains float in mid-air on raised/sunken
floors"; other parts of E1M1 need interaction, barrels first. Both are done: on a sector level every loose piece a
fight leaves lands on the floor under it, falls off ledges and stops at sector walls, and E1M1's Doom barrels are our
own toxic drums that explode, chain, hurt and are shielded by walls. Room levels pass no ground and run their old
y = 0 code, byte for byte.

## What was built (per task, with commits)

| Task | What | Commits |
| --- | --- | --- |
| 1 | `debris-ground.ts` (pure interface: `floorAt`, `ceilAt?`, `bounce(prev, next, vel, restitution, friction, radius)`, `landingFloor`) and `webgpu/sector-debris.ts` (the sector implementation: one horizontal `sectorSegmentHit` probe per moving piece per step, at the start height clamped into the start sector's floor..ceiling band, run on by the piece's radius, the normal from the side the piece is on; cached per map). Review: probe band, radius stop, side-true normal, `ceilAt` (Infinity under sky); the push-out of a centre already inside its radius is checked (never off the map, never across a line) | e076aa27, 18a034e1, e7428182 |
| 2 | Gib chunks (marched, mesh gibs incl. torn meat and the brain, sprite pieces, the snapped eye) read the floor under them and bounce off sector walls; `debrisGround(ctx)` / `sectorHitBetween` in `game-hit-trace.ts`; spawns clamped inside the level from the body centre | 944e5439 |
| 3 | Blood drops land on the floor under them and stop at walls (running down to that wall's floor); splats are drawn at their own y (GPU view, goo layer, WebGL twin). Review: a first splat jittered over another floor goes at the drop's spot; gouts and wound drops seeded with the body's floor and clamped inside | 40ce3923, fc1c5322 |
| 4 | Entrail rope nodes take the floor under each node (floor only; a rope over a ledge hangs off it) | 2f451a72 |
| 5 | Dropped guns (`prop-drop.ts` via `held-prop.ts`), shed kit pieces (`kit-damage.ts`) and casings (`shotgun-casings.ts`) rest on the floor under them and stop at walls | 9e7eeaff |
| 6 | Bodies whose floor drops more than 0.75 m FALL under gravity; collapsed rig points meet the floor under each point (`applyFloorContact`, `constrainRigBends`). Review: each point judges its own rise (a floor > 0.75 m above its previous position is a wall); soldiers' fall pose releases over a lower floor; bodies stand on the disc floor (`floorUnder`, nav's rule); a falling body never hovers at a lip | 9d8ad9b7, 8ef6c863, 4973ebb5 |
| 7 | Burn piles read the floor; `detonateAt`'s air-vs-ground `floorDistM` is the height over the floor under the blast | 601c5a6b |
| 8 | Dynamite bundles bounce off sector walls and rest on the floor under them; the throw starts inside the level | 84138d39 |
| 9 | Debris seams: `__sdfGame.debris()` (every loose piece as plain data), `collapseActor`, `bloodBurstAt`, `throwTestBundle`; `spawnCrowd` stands its grid on the floor. Review: head-pop / brain bursts seated (`seatBurstSpawn`), kit at the half-diagonal, guns meet walls at their bounds centre, no ceiling cap under sky | 41e34ec0, 95bbfd46, 657d57b7 |
| 10 | `barrels` in the sector level format; `doom_map.py` keeps Doom's type 2035 regardless of skill (multiplayer-only still skipped); the parser refuses a barrel more than 1 cm off its floor | 37f279b1, b046b23f |
| 11 | Pure barrel rules (`barrel-state.ts`: HP, hits by kind, blast catch with an FNV-1a 0.1–0.3 s delay, the fuse step, segment vs drum) and the player's blast share (`blast-player.ts`, rocket rule proven equal) | 07967889, b046b23f (chain reach 4.5 m) |
| 12 | The look (`barrel-look.ts` pure profile + albedo; `game-barrel-view.ts`): lathe drum with rolling hoops, chimed rims, recessed lid, procedural toxic green with a black/yellow hazard band, rust at the foot, the level's `metalSheet` maps, lit like the sector walls, a faint lid glow; a sooty stub and a floor scorch after | c14be91d |
| 13 | Barrels in play (`barrel-runtime.ts` pure + `game-barrels.ts`): the drums' boxes in the colliders (removed when one goes), the blast IS `detonateAt` (its closing `catchBlast` is the chain), the player's share unless sector geometry shields the capsule centre; `detonateAt` on sector levels drops bodies whose torso centre is shielded; nav routes round the drums. Materials per zone (E1M1: 6 materials, +5..7 pipelines). Review: shield probes seat inside the map (`seatBlastProbe`) | 1727107d, b9fda4d1 |
| 14 | What sets a barrel off: player pellets and slugs, enemy rounds, the flail (`barrelsInStrike`: reach and arc, 3D distance to the nearest surface point, not behind a wall). A drum cuts a projectile's segment like a wall; a body in front still takes the round. Review: blasts seat on their own side of thin walls (`inside` hint), warbull rockets start inside from the body centre, rocket player damage shielded | f325ee4e, 0f26f64c |
| 15 | Doom gate section 6 (debris). Found and fixed: the torso BONE asset piece drew 0.27–1.03 m above the floor on every level (its prim support spheres sat below its mesh) — asset pieces now rest on supports from their drawn mesh (`extent.ts supportSpheresFromPoints`); the hurt floor is timed on the sim clock (`__sdfGame.simTime`) | 9c0093eb, f3e1e18f, ced1bdce |
| 16 | Doom gate section 7 (barrels), seams `barrelLog()` booms/scorches/blasts, `hurtLog()`, `spawnTestRocket`; the gate's walks wait on sim time | a5680d20 |
| 17 | This note, the regressions, the task wiki | (this commit) |

Plan and hand-off docs: 99a1aedd, 0ba9d00f (owner decisions), 6d20fb7d (2g: emissive screens queued after 3b).

## Every y = 0 site (as fixed)

| # | File / place | Was | Now (sector levels; room levels unchanged) | Task |
| --- | --- | --- | --- | --- |
| 1 | `gib-chunks.ts` `stepChunk` | floor plane y = 0, boxes only | `landingFloor` at the chunk's current x/z every step, `bounce` off sector walls | 2 |
| 2 | `gib-chunks.ts` `chunkSettled` | grounded at y ≤ support | grounded at `floorY` + support | 2 |
| 3 | `game-hit-trace.ts` `chunkCollidersAt` | boxes + ceiling | + `debrisGround(ctx)` (chunks, flesh bits, eye, mesh gibs, sprite pieces) | 2 |
| 4 | `blood-sim.ts` `stepBlood` | lands at y ≤ 0.01, no walls | lands on the floor under the drop, stops at walls | 3 |
| 5 | `blood-sim.ts` `stamp` | splats at y = 0 | splats at the drop's floor | 3 |
| 6–8 | `blood-view-gpu.ts`, `goo-layer.ts`, `blood-view.ts` | splat drawn at a fixed y | at the splat's own y | 3 |
| 9 | `entrails.ts` `stepGutChain` | nodes clamp to y = 0 | each node to the floor under it | 4 |
| 10 | `prop-drop.ts` / `held-prop.ts` / `character-view.ts` | `floorY` 0 | floor under the gun's bounds centre, walls | 5 |
| 11 | `shotgun-casings.ts` `step` | rest at 0.012 | floor + 0.012, walls | 5 |
| 12 | `kit-damage.ts` shed pieces | rest at 0.01 | floor + 0.01, walls (half-diagonal) | 5 |
| 13 | `motion.ts` floor block | drop eases at 6 m/s | > 0.75 m drop falls under gravity; disc floor | 6 |
| 14 | `motion.ts` `applyFloorContact` | one floor plane | floor under each point, own-rise rule | 6 |
| 15 | `rig.ts` `constrainRigBends` | one floor plane | floor under each point | 6 |
| 16 | `game-burning.ts` `updateCards` | `groundY: 0` | the floor under the pile | 7 |
| 17 | `game-dynamite-step.ts` `detonateAt` | `floorDistM = max(0, y)` | height over the floor under the blast | 7 |
| 19 | `dynamite-flight.ts` `stepSub` | floor 0, boxes / arena rect | floor under the bundle, sector walls, ceiling (none under sky) | 8 |
| 20 | `game-dynamite-step.ts` `stepDynamite` | no floor/walls | passes the debris ground | 8 |
| 21 | `game-dynamite-throw.ts` `throwBundle` | hand position | clamped inside from the eye | 8 |
| 22 | `game-seams-spawn-goo.ts` `spawnCrowd` | `p0 = [cx, 0, cz]` | the floor under each spot | 9 |
| 23 | `game-loop.ts` pickups | fixed in 3a | gate check only (floor + 0.25) | 15 |

Sites 18 (`explosion-aoe.ts` default, the lab's) and 24 (pellet/rocket y 0.02 kills, room levels only since 3a) were
left as they are, as the plan says.

## The numbers

- **Barrels** (owner, 2026-10-25: use these, tune after playing): radius 0.3 m, height 0.95 m, 20 HP; pellet 4,
  slug 20, flail 10, enemy round 3. A blast lights every intact barrel whose centre is within **4.5 m** (centre to
  centre, 3D, not shielded) after 0.1–0.3 s (FNV-1a of `id:blastCount`, no RNG stream touched). A barrel shot to 0 HP
  goes up on the next barrel step; it explodes at floor + 0.475 m; the player takes up to 55, quadratic to 0 at 4.0 m.
  The blast itself is the dynamite blast, unchanged.
- **E1M1 has 6 barrels, not 8.** The WAD has 9 type-2035 things; 3 are multiplayer-only (flag 16, skipped by the
  same rule as every other thing); the skill filter changes nothing (6 at skill 1, 4 and 5). Converter (2026-10-25,
  this run):

  ```
  public/assets/levels/doom-e1m1.level.json: 88 sectors, 486 lines, 12 zones, 8 door lines, 12 lights (3 pool)
  things: spawns {'zombie': 4, 'butcher': 2, 'flayer': 5, 'deadeye': 2, 'soldier': 16}, pickups {'health': 44,
  'shells': 8, 'shotgun': 1}, 6 barrels, 1 exit triggers [[[58.0, -0.75, 35.0], [58.8, 1.25, 37.0]]]; skipped types
  {2: 1, 3: 1, 4: 1, 10: 2, 11: 5, 12: 2, 15: 4, 24: 7, 35: 2, 48: 2, 2028: 8}, 0 in no sector, 0 not on skill 4,
  19 multiplayer-only
  ```

  b35 (8, −0.5, −11), b36 (3, 0, −22), b37 (−6, 0, −9), b48 (59, −0.75, 22), b49 (66.5, −0.75, 19),
  b50 (55.5, −0.75, 19.5).
- **The chain on E1M1:** the closest pair, b48 → b50, is 4.3 m apart, so the plan's first 3.5 m reach would never
  chain on E1M1; the owner raised it to 4.5 m (Doom-like). The fixture's b1 → b2 (1.1 m) is the short-range check.

## Doom gate (`LAB_TMP=.lab-tmp SHOTS=1 LAB_VITE_PORT=5515 LAB_CDP_PORT=9515 bash scripts/sdf-game-doom-gate.sh`)

Run on the merged tree (2e6a40ee: origin/main's bullet time, free aim, the shotgun aim fix and the GPU bake merged in),
2026-10-25, E1M1 regenerated first. The machine was loaded by other processes (load average 10–45 through the runs).

- **Run 1 FAILED in 5.4b, a load artifact of the gate's classifier, not the game:** `rounds: {"shots":6,"seen":48,
  "atPlayer":16,"atWorld":0,"expired":32,...,"maxFrameMs":1203.7}` → `FAIL: rounds: no round stopped at a wall`. The
  sampler counts a vanished round as a world stop only while `age < lifeSec − 2 × slowest frame`. With one 1.2 s
  frame stall that bound is 2.0 − 2.4 < 0, so every round that was not at the player read "expired", and
  `passedCount` was 0 (no round stepped through geometry). Re-run once, as the rule allows for load-caused stalls.
- **Run 2 PASSED end to end** (exit 0, load 10–29). Key lines:

```
ok   fixture: walked up the 0.5 m step / stopped 0.32 m short of the 1.0 m ledge / dropped into the pit / stopped 0.32 m from the column
ok   debris blood: 10 drops over the C/B edge in 1 burst(s) -> 0 in the air 4 s after each, 16 splats on their floors (by floor {"0":2,"1.5":9,"0.5":5}, worst |y - floor| 0.0000 m)
ok   debris surface blood: 24/24 stains on sector-wall-techPanel-zone-0
ok   debris chunk ledge C->B: settled on floor 0.5 (pos.y - support - floor -0.0000 m), never off the map or inside a riser
ok   debris chunk A->pit D: settled on floor -1 (0.0000 m) / B riser: on floor 0 / north wall: z -2.75..-0.25 / column: on floor 0
ok   debris corpse: the pit zombie lies on floor -1 (posed body lowest - floor -0.258 m, band -0.3..0.25)
ok   debris bundle: left C after 0.73 s; 335 resting samples on floors 0, 0.5 (worst |y - floor| 0.0000 m), none off the map or inside a riser
ok   barrels placed: b1..b5 intact on their floors (b1 -1, b2 -1, b3 -1, b4 1.5, b5 0)
ok   barrels chain: b1 hit -> b1 -> b2 0.283 s (band 0.1..0.3 ± 0.050); b3 b4 b5 intact; player 100 -> 80, blast share 20 (the rule's 10 + 10); zombie gibbed; scorches 2
ok   barrels shielded: b5 gone 3.22 m off behind the column — health 80 -> 80 (unshielded the rule gives 2)
report rocket behind the column: health 80 -> 80 (unshielded, rockets.ts's rule would give about 4)
ok   barrels shot: fire() at b3 from 2.3 m — 5 hits (pellet), b3 gone within 1.1 sim s
ok   barrels raised: b4 on the C ledge went up, its scorch at y 1.5048 (band 1.504 ± 0.002)
ok   E1M1 legs 1–7 reached (start → zigzag walkway, floors -0.75..0)
budget: 172 draw calls, 21.10 ms a frame at the start; load 29.0; split tick 7.2 + draw 7.8 + GPU wait 5.2 = 20.2 ms
ok   enemies spawned: butcher 2, deadeye 2, flayer 5, soldier 16, zombie 4 (= the converter's 29)
ok   enemies after 3 s / 20 s: 29 on their floors (worst feet gap 0.000 m; posed body lowest − floor -0.09..0.10 m, band -0.15..0.25)
ok   enemies walk: 11 got > 2 m from their 3 s spot in 18.7 sim s
ok   rounds: 6 shots (4 dodged), 47 rounds — 7 stopped at the player, 40 at walls/floors/ceilings, 0 expired, 0 other; slowest frame 802.6 ms; 0 stepped through sector geometry
ok   debris E1M1 drawn: 13 settled carved pieces, lowest drawn vertex - floor -0.008..0.000 m (band -0.03..0.08)
ok   debris E1M1: 353 items on the floor under them (sprite 13 on -1.5; splat 256 on -1.5; casing 30 on -4.25/0; gun 1 on 0; pickup 53 on ten floors; worst 0.000 m); fight debris on non-zero floors -4.25, -1.5
ok   debris corpse: soldier 20 lies on floorUnder 0 (posed body lowest - floor -0.026 m)
ok   exit: trigger exit (level.end) completes the level
ok   hazard: sector 0 (nukage, 5/s) took health 100 -> 90 in 3.25 sim s; off the pool health holds
ok   sight: hidden 4.75 m from soldier 19 for 6 s — 0 shots; stepped 0.93 m into sight — it fired after 1.2 s (0 rounds through geometry)
ok   glow: the pool reads green (G/R 2.84); bounce: wall G/R 2.44 on vs 1.34 off; sector light A/B 1.326
ok   barrels E1M1: 6 = the converter's, intact on their floors (b35 -0.5, b36 0, b37 0, b48 -0.75, b49 -0.75, b50 -0.75)
ok   barrels E1M1 chain: b48 -> b50 (4.30 m) — 0.146 s (band 0.1..0.3 ± 0.050); others intact; player 2 m off b48: 100 -> 87, blast share 13 (the rule's 13 + 0)
budget at the barrel pose (2 m off b48, after the chain): 2067 draw calls, 144.70 ms; load 24.8; split tick 3.3 + draw 26.4 + GPU wait 33.0 = 62.7 ms
```

Budgets are reported, not judged above load 8. Draw-call counts swing run to run under load (start: 172 in run 2,
2395 in run 1; Task 16's runs 336–649), so they are not a measure of this plan. The barrel-pose frame (62.7 ms
split, the blast's light and VFX still live) needs a quiet-machine re-measure before anyone reads a cost into it.

## Bullet time on E1M1 (the merge's fresh-shot step)

The merge changed the player's pellet step to `rdt * btScales.shot`, and the sector-level "fresh round starts at the
eye" test to `p.ageSec - shotDt < 1e-6`. I checked it with a scratch CDP driver (not committed). I booted
`?level=doom-e1m1&god`, froze the actors, found the nearest wall from the start (1.43 m at yaw 2.356), stood 0.3,
0.6 and 2 m from it, and fired with `setBulletTime(false / true)`. Then I hand-stepped the sim one tick at a time
(`__sdfGame.step(1)`) and read `bulletTime().pellets` after each tick:

```
off, 0.3 m: t0 n8 (spawned at the muzzle, 0.58 m along: past the wall) | t1 n0
off, 0.6 m: t0 n8 (0.62 m) | t1 n0
ON (intensity 1.00), 0.3 m: t0 n8 (0.58 m, past the wall) | t1 n0
ON, 2 m: t0 n8 in the map 0.62 | t1 0.91 | t2 1.20 | t3 1.49 | t4 1.78 | t5 2 left (2.07, in the map: spread pellets on an oblique wall) | t6 0
```

In bullet time, shots stop at sector walls on the first tick. A muzzle past a hugged wall never puts a round through
it (the first segment runs from the eye). The spawn sits past the wall only before the first tick, the same as
before the merge. A first rAF-sampled version of the check read that pre-tick spawn as "past the wall" in bullet
time (8 of 8, 0.58 m along). That was a sampling-order artifact, and the hand-stepped run above settles it.

## Regressions (room levels unchanged), merged tree, 2026-10-25

| gate | result |
| --- | --- |
| `scripts/sdf-game-loop-gate.sh` (Night Train) | **PASS** — loadout, pickups (sawn-off 2 + 4, reserve 12), damage (a zombie bites, health 90), death, ending |
| `scripts/sdf-game-flat-gate.sh` | **FAIL on the frame budget only, twice** (36.9 ms, then 71.6 ms > 33.3, load 13–19). Every other check passes both runs: boot, layout, all six collisions 0.30–0.32 m, hall → room 0.16–0.18 m, hall → bathroom 0.13–0.20 m. An earlier run on this branch (`.lab-tmp/flat-gate.log`, 01:49) passed at 21.2 ms. Re-measure on a quiet machine |
| `scripts/sdf-game-wake-gate.sh` | **PASS** |
| `node scripts/sdf-game-dynamite-gate.mjs` | **PASS** — slot 3 switches, cooks (0.658), throws, detonates (1 gibbed), asset tier 13/14 pieces |
| `scripts/sdf-chunk-bake-gate.sh` | **FAIL `leak-bounded`, pre-existing**; the other 7 pass (smoke-boot, sever-staging, off-determinism, bake-happens, bake-not-slow, on-differs-from-off, baked-piece-hittable). `baked` climbs 3 a cycle, 8 → 26 (cap 12). Same on **origin/main** (d11ea41c, 10 → 25) and on the **pre-merge tip** (a5680d20, 9 → 24), in temporary worktrees, removed after. Not caused by 3b or the merge. The first attempt died writing `/tmp/sdf-chunk-bake/look-marched.png`: the gate hard-codes that path and never creates the folder |
| `scripts/sdf-game-surface-blood-gate.sh` | **PASS** — toggle diff 0 px; 36 floor stains, 120 final |
| `node scripts/sdf-game-bleed-gate.mjs parity` | **PASS** — smear 0 toggle cycle diff 0 px; smear 0.25 reported 110 px (0.023 %), max delta 1 |
| `scripts/sdf-game-launcher-gate.sh` | **PASS** — 12 images, shot / reload / manual / switch gates green |
| `node scripts/sdf-game-crowd-gate.mjs` | **FAIL section 4, unchanged from 3a** — crowd 0.887 m, probe 0.740 m, chase 4/4, swing OK, then "zombies stayed alert with the player out of the room" (the room-1 soldier, sinceFire 0.683): the identical numbers 3a recorded on its base |
| arena `?level=arena&spawn=soldier` (scratch driver) | soldier fired (3 casings in ~2 sim s), `collapseActor` → **casings rest at y 0.0120 (3/3), the gun at y 0.0300** — the y = 0 path unchanged |

The launcher and surface-blood gates rewrite their tracked evidence under `docs/dev-notes/2026-09-29-grenade-launcher/`
and `docs/dev-notes/2026-09-30-surface-blood/`. Those files were restored, not committed; copies of this run's
output are in `.lab-tmp/t17/`.

## Shots looked at (`.lab-tmp/doom/`, never committed)

- `fixture-barrels-1.png`: a drum up close against the tech panel. It reads green and lit like the wall, with the
  hazard band clear, but it is clean and saturated next to the grimy walls. That is why the owner queued the grime pass.
- `e1m1-barrels-0.png`: b48 in the foreground and b50 behind it, two frozen soldiers, the drums standing on the
  −0.75 floor (no gap, no sink).
- `e1m1-barrels-1.png`: the chain going off: the blast light, the ring, flying pieces.
- `e1m1-barrels-2.png`: after: b48's sooty stub in front of the gun, b50's stub behind it. The scorch is dark on the
  dark tread plate and hard to read.
- `e1m1-debris-0.png`: the gib pile on the −1.5 floor: carved pieces and splats on the plate, nothing floating,
  nothing sunk.

## Decisions (the plan's, kept)

- The floor is read at each piece's current x/z every step (`landingFloor`). Off the map a piece keeps its last floor.
  A piece's floor is the floor under its centre (a gun straddling a riser may hang or sink: see gaps).
- Spawns start inside the level (clamped from the body centre) on the body's floor.
- Walls: one horizontal probe per moving piece per step at its start height, clamped into the start sector's band.
  Entrail nodes take the floor only.
- Corpses: a > 0.75 m drop falls under gravity; rig points meet the floor under each point.
- Blasts on sector levels are shielded by sector geometry (one probe per target). Room levels have no filter.
- Room levels pass no debris ground and run the old y = 0 code byte for byte (the existing tests pass unchanged, and
  the regression gates above).

## Owner decisions (2026-10-25)

1. **Dynamite does not hurt the player**, enemies only (today's behaviour). `blast-player.ts` serves rockets
   (unchanged rule) and barrels only.
2. **Barrel numbers: the draft values**, tune after playing.
3. **All E1M1 barrels regardless of skill** (barrels are scenery); multiplayer-only still skipped.
4. **A destroyed barrel keeps blocking enemy pathing until reload**, accepted for 3b.
5. **Barrels in room levels: later.**
6. **Chain reach 4.5 m** (was 3.5; E1M1's closest pair is 4.3 m). A lit barrel caught by a second blast keeps its
   fuse.
7. **E1M1 has 6 barrels, not 8** (see the numbers above).
8. **Next (owner):** a grime pass on the barrel's look, then emissive screens and light panels (hand-off item 2g).

## Known gaps

- **Corpse rig points have no sector-wall collision** (only per-point floor contact): a point sliding under a high
  ledge can end up inside the riser (Task 6).
- **A corpse in the fixture's pit sinks −0.26 m** (posed lowest point vs the floor), against about −0.15 m on floors 0
  and 0.5 and the arena. Inside the gate's band; report only.
- **Long guns can overhang** a riser by about (half-length − 0.3 m): a gun's floor is read at its bounds centre, not
  its footprint.
- **Destroyed barrels keep blocking pathing until reload** (nav is built once with the drums' boxes; owner decision 4).
- **A frozen actor tears apart in one shot** (seen in the gate's frozen-actor staging).
- **The flail on a drum alone gives no hit-feel** (no hit-stop or kick when the strike meets only a barrel).
- **Only the shotgun's pellets and slugs, enemy rounds and the flail damage barrels** (plus any blast that goes
  through `detonateAt`: dynamite, rockets, another barrel). No other player weapon hits a drum.
- **A warbull hugging a wall and firing a rocket is not staged in the gate** (the muzzle clamp is unit-tested; the
  gate's rocket check is the test rocket behind the column).
- **The barrel look needs a grime pass**, queued by the owner.
- **Lights do not cross zones** (a blast or a pool light in one zone does not reach the next zone's surfaces).
- **The fog veil in glowing rooms** (hand-off item 2c) is still open.
- No barrel sound; no metal shrapnel; enemies do not avoid lit drums; barrels in room levels later.
- **Boot `drawOnce` before/after Tasks 12–13** was not recorded in the repo, and this run's load (10–45) made a
  cold-boot A/B meaningless. Re-measure (`node scripts/boot-time.mjs <vite> <cdp> level=doom-e1m1`, fresh profile,
  against the pre-3b base) on a quiet machine.

## Merge notes (2e6a40ee, origin/main into this branch)

Conflicts resolved in `TASKS.md`, `module-index.md`, `blood-sim.test.ts`, `motion.ts`, `game-dynamite-step.ts`,
`game-player.ts` (+ test), `game-tick.ts` and `game-weapon.ts`. What to know:

- `detonateAt(ctx, at, inHand, inside?, spareActorId?)`: 3b's `inside` hint comes before main's `spareActorId`
  (the firer spared its own blast). The sector shield filter runs on the spared list. Every caller was checked: the
  rocket passes `(…, false, undefined, d.owner)`, the overcook and the thrown bundle pass `inside`, and barrels and
  the seam pass neither.
- `stepPlayer(…, ground, airScale)`: 3a's sector ground stays the fifth argument, bullet time's `airScale` is the sixth.
- The player's pellets step on `shotDt = rdt * btScales.shot`; the sector "fresh round starts at the eye" test reads
  `ageSec - shotDt`. Verified above.
- Rockets and the barrels' fuses step on the world `dt` (`game-tick.ts`), so bullet time slows them with the world.
