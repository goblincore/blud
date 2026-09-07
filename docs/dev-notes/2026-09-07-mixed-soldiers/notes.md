# Mixed soldier room and pursuit

Room5 branches east from room2 through a two-metre passage. It has three soldiers, two zombies, cover and lateral walking lanes. `__sdfGame.teleport(5)` is the existing debug shortcut; normal entry is through room2's new east doorway.

`RoomDef.zombies` still means total actors for old consumers. `soldiers` chooses the first N spawn slots, so room5 has `zombies:5, soldiers:3`. Current actor room is derived from position, including passage halves; never use the immutable home room for engagement.

`encounter-navigation.ts` builds a static .4m floor grid from rooms/tunnels and radius-inflated collider boxes. Routes and shortcuts are swept safe. The game actor routes targets, checks actual integrated movement and crowd nudges, and preserves committed attack/recovery halts. This is static map navigation, not a dynamic navmesh or ragdoll physics engine.

`encounter-director.ts` owns sight, hearing, last-known positions, nearby direct-sighting relays, fire lane checks and a rotating ranged attack lease. Sight is capped at 10m; gunfire can be heard within 12m. Memory expires after eight seconds, with a two-second search when the actor reaches the remembered point, then a return home. Hidden live player coordinates are not supplied to individual brains. Zombies keep their existing melee ring; soldiers reserve a clear spread corridor and reposition around blockers. Downed actors leave attack arbitration. Opposing doorway traffic grants lower-ID right of way and a swept-safe lateral step to the yielding actor; checking only which actor is closer to each target deadlocks head-on traffic.

`shotgun-casings.ts` ejects one red/brass shell .18s after each shot, using the posed receiver transform. Two instanced meshes per soldier hold a capped pool of 128 shells; the oldest recycles. Small ballistic steps handle bounce and tumble, then settled instances stop updating. No picking or gameplay collision is registered. Pool disposal follows CharacterView disposal. Shell floor is currently the level's flat y=0 floor; steps/elevated surfaces would need a floor query.

Verification: unit/integration coverage for layout connectivity and spawn clearance, swept routes, real actor room crossing, sight loss/hearing, fire lease rotation, blocked spread corridors, head-on traffic, shell ejection timing, settling and capacity. `scripts/verify-mixed-soldiers.mjs` exercises the real WebGPU game, multiple shooters, settled shell matrices and retreat through the new passage. Existing soldier fall/corpse-bake work is retained.

References: [Valve — The AI Systems of Left 4 Dead](https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf), especially separation of perception, path following and local avoidance; [Jeff Orkin — Three States and a Plan](https://gdcvault.com/play/1013282/Three-States-and-a-Plan). These informed the small coordinator; this does not introduce a GOAP framework.

Validation results: full suite **233 files / 3,676 tests passed**; production build passed (existing large-chunk advisory); final focused navigation/director/actor recheck **36 tests passed** after preserving committed halts. Real WebGPU smoke observed all three room5 soldiers firing across runs, red/brass instance pools filling, shell centres resting at y=.012, and room5 zombie14 following the retreat into room2. No browser errors. Soldier cross-room movement is also exercised directly by the actor integration test. Screenshot: `/tmp/mixed-soldiers.png` (local ephemeral QA artifact).

## Main integration

Integrated main through `e2f0e0b7` (bounded/localized wound rendering) without conflicts. Both real WebGPU smoke drivers passed on the combined code: multiple shooters, floor shells, cross-room pursuit, then soldier corpse mesh baking and restoration on a new hit. Production build passed. The traffic pass snapshots desired routes before yielding, so reversed actor enumeration cannot remove the right-of-way decision; a regression covers the original narrower passage too.

The live port5184 server serves `.worktrees/soldier-polish`; keep that worktree/branch while the server is in use. Main checkout's pre-existing reference-image deletion and untracked face assets are unrelated and were left untouched. Integration is local; no remote push requested.

Final combined verification: **236 test files / 3,697 tests passed**, TypeScript and production build passed, both WebGPU smoke drivers passed with zero browser errors. Main is advanced to this tested code plus these notes.
