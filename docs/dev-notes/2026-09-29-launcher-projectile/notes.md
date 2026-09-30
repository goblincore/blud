# Launcher grenade gameplay — 2026-09-29

Accepted model/animation pass: [PR #26](https://github.com/goblincore/blud/pull/26), branch `codex/grenade-launcher-fpv`, commit `947e2aff`. Gameplay is pushed on the separate stacked branch `codex/grenade-projectile`, [PR #27](https://github.com/goblincore/blud/pull/27), based on the FPV branch.

## Play and review

Open `/sdf-game.html?launcher=1` in the normal dev server (append `&level=night-train` for the authored train). Slot 4, left click, R reload. The round now leaves the live muzzle with the reticle's free-aim convergence, before recoil rotates the weapon. Aim a little low at close range to account for the upward bias. The fuse is immediately active; it continues during bounces, embedding and weapon switches.

[Gameplay review clip](review/grenade-gameplay.mp4) · [Embedded can](review/embedded.png) · [Runtime gate](boot-current/gate.json) · [Boot comparison](boot-comparison.json).

The clip's first segment is a real launcher shot. The second stages a direct torso shot through `launchGrenade`, the same pool/physics/damage path with a controlled origin/velocity, to inspect attachment and detonation. Actors are frozen except for a brief live movement during the attachment check. VHS is disabled for inspection. The initial `runtime/` captures retain the discarded glossy material for comparison; `review/` shows the current matte olive/brass can.

## Behavior and ownership

- 16 m/s muzzle velocity plus 2 m/s upward bias, 14 m/s² gravity; immediately active 1.6 s fuse. Swept collision and fixed 120 Hz integration prevent thin-wall tunnelling and make frame partitions agree. World planes/boxes, doors/furniture and per-enclosure ceiling use the active level's collision data.
- Hard contacts reflect/damp velocity (restitution .48, tangential damping .78); weak floor contacts settle. Flesh embeds the nose .022 m behind the hit surface, leaving the rear of the can visible. Metal plates and skeletons bounce. The larger game prop is 7 cm across to keep it readable in FPV.
- Attachment uses two points in the same hit primitive's wound frame, so position and axis follow the posed flesh. Missing actor, severed/dead cluster or removed primitive releases it with the remaining fuse. Actor puncture uses a normal small wound/flinch.
- Detonation calls the existing full blast pipeline (wounds, damage/meter, reaction, gibs, blood/guts, room light, VFX and camera kick), with .75 of the current dynamite AOE radius setting: about 2.88 m at the default .82 setting. Near blasts damage the player through the existing blast damage path; `god` suppresses that in captures.
- Each burst sends 32 deterministic fragments at 38 m/s, capped at 7 m even on a long frame. They sweep against the nearest world/body surface, stamp normal small wounds and stop at walls. An embedded host receives the blast, with fragment self-hits skipped. Fragment visuals expire in about .184 s.
- Pure logic: `grenade-flight.ts`, `grenade-collision.ts`, `grenade-attachment.ts`. `webgpu/game-launcher-projectiles.ts` owns bounded pools (8 cans, 96 fragment meshes), scene updates, damage routing and plain diagnostics. `game-launcher-view.ts` owns the muzzle handoff. World physics runs after actors pose, independent of reload speed/holstering. All geometry/materials are pooled before warm-up; stock Basic paint avoids the bright local lights washing out the small can. No new custom shaders or lights.

## Verification

- `npm test -- grenade-flight game-grenade-launcher game-weapon-slots game-state-weapon game-viewmodel explosion-aoe`: **141/141 pass**. Fifteen new tests cover arc, fixed-step equivalence, bounce/fuse/rest, thin walls, closest actor, point-blank embedding, metal/skeleton bounce, static attachment, attachment rotation/loss, deterministic fragments, range expiry and wall blocking.
- `npx tsc --noEmit`, `git diff --check`: pass. Context coverage is **3/4**, with the same existing `actorFill` state binding as FPV base `947e2aff` (extractor gives `['ctx','actorFill']` for both). No new main()-scope state. No full suite or production build claimed.
- `scripts/sdf-game-grenade-gate.sh`: warm-ready, real muzzle launch, visible live flight, floor bounce, fuse while holstered, flesh embed, actual moved attachment, blast resolver, damaging fragment, expiry and zero console/GPU errors. Eleven stills inspected; the movie and extracted flight/embedded frames were also inspected.
- Latest gate: 9 accumulated bounces, 1 embedded target, 3 detonations, at least 1 fragment wound, 2 gibbed actors and 27 gib pieces through the shared gore path. Attachment shift exceeds .26 m with 0 m error to the live primitive anchor. All flights/fragments expire.

Sequential new-browser-profile startup runs, identical ring/seed/launcher query and 1200×800 capture:

| Version | drawOnce | Total warm |
| --- | ---: | ---: |
| Accepted FPV base `947e2aff` | 1676.2 ms | 2562 ms |
| Grenade gameplay | 1959.4 ms | 2938 ms |

Single samples; OS Metal shader cache not purged. The new opt-in pool adds roughly .28 s to this measured first draw and .38 s to total warm; these numbers do not measure steady-frame performance. Temporary baseline checkout and owned Vite/Chrome processes removed/stopped.

## Limits and next tuning

Only the standard explosive/fragment round is implemented. No launch/bounce/reload audio or alternate ammunition yet. The existing explosion visual and blast radius tuning are reused; blast occlusion retains that resolver's current behavior, while fragment paths do collide with walls. Detached gore is not an attachment target; a severed attachment releases instead of following the detached chunk. Deferred mesh routing is wired but this pass verifies the ordinary forward renderer. Launcher fire is still outside demo input recording/replay.
