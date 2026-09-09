# Actor LOD and visibility culling — design

**Date:** 2026-09-09
**Status:** approved in brainstorm; not yet planned
**Owner decisions:** three-tier LOD; suspended actors keep converging via a cheap
route proxy (not a hard freeze); restore measurement first.

## Problem

The soldier and mesh-skeleton milestones improved the marched frame but the game
now misses its 30 fps (33.3 ms) target in bursts. Investigation
([notes](../../dev-notes/2026-09-09-perf-spikes/notes.md)) found the cost is not
in the raymarcher's wound term — the term every prior study chased — but in the
fact that **nothing in the frame is gated by visibility or distance**:

- `game-main.ts:912` hands `sdfLayer.setBodies()` **every actor in the level**.
- The SDF proxy boxes are `frustumCulled = false`
  (`zombie-gpu.ts:1759` — "the proxy IS the bound; don't double-cull"), so three
  culls nothing and an actor behind the camera or behind a wall is still drawn.
- The occluder pre-pass has been OFF since 2026-09-01 (`game-main.ts:948`); its
  rasterised distance under-reports past ~3 m. There is currently **no**
  visibility rejection of bodies of any kind.
- `for (const a of actors) a.step(dt)`, the kit/prop pose, `headShape`,
  `view.setTime`, `encounter.update` and `segMeshRenderer.update` all run for all
  15 actors every frame regardless of where the player is.
- `bodiesOnScreen()` (`game-main.ts:3248`) already computes a frustum test per
  actor per frame — **for the HUD only**. The result is discarded.

The owner also made enemies aggressive enough to pursue across rooms, so the
population of the player's room now exceeds its spawn count: the bench census
shows room 3 (3 spawned) with **8 bodies on screen**, and its `walk` segment —
`wounds 0, chunks 0, droplets 0, goo quads 0` — already costs 33.9 ms.

## Non-goals

- Reviving the GPU occluder pre-pass. It was disabled for a measured reason.
- Any change to AI behaviour, aggression, or encounter design. Cross-room
  pursuit must survive this work intact.
- Touching the march shader or the wound path. Those levers are tracked
  separately and are not what this design addresses.

## Phase 0 — restore measurement (lands first, separately)

The cull cannot be judged against today's numbers: the last clean attribution
predates the soldier, the meshes and the encounter system, and today's runs were
taken on a contaminated machine (load 43–63, 39% repeat spread).

1. Add two telemetry phases in the `game-main` frame loop, using the existing
   `telemetry.begin()` / `telemetry.end(name, token)` idiom:
   - `skeleton-mesh` — the skeleton source rebuild plus `segMeshRenderer.update`.
   - `encounter` — `encounter.update` plus the nav routing it triggers.
   These are the two largest additions since the last attribution and **neither
   is currently visible to an F8 capture**.
2. Add room 5 to the bench: `ROOM_IDS` in `scripts/sdf-game-bench.mjs` defaults
   to `1,2,3,4`, so the soldier room has never been benched.
3. Re-run `BENCH_PASSES=1 scripts/sdf-game-bench.sh` on rooms 3/4/5 on a
   genuinely quiet machine — no dispatch agents, no background VACUUM — and
   record the table as the baseline this work is measured against.

Phase 0 changes no behaviour and can merge on its own. It is expected to be its
own implementation plan; the LOD work below is the second.

## Architecture

A pure decision module plus thin wiring, matching the pattern
`adaptive-scale.ts` already establishes in this repo (pure controller, discrete
states, hysteresis, documented caller contract, unit-tested with no GPU).

### New module: `src/lab/sdf-zombie/actor-lod.ts`

```
classifyActors(state: ActorLodState, input: ActorLodInput): ActorLodResult
```

Pure. No `three`, no DOM, no GPU — importable directly by vitest, like
`crowd.ts` and `encounter-director.ts`.

**Input** (per frame): camera position and frustum planes as plain numbers,
player position, the level's collider AABBs, the room-adjacency graph, and one
snapshot per actor of `{ id, pos, room }`.

**Output:** a `Tier[]` parallel to the input snapshots, plus the next
`ActorLodState`. **The result is never written onto the actor objects** — game
main holds it in a frame-scoped array and consumers index it. This keeps the
actor type unchanged and the function honestly pure.

**State is keyed by actor `id`, not array index.** Actors are spawned, gibbed
and recycled; an index-keyed state would silently transfer one actor's dwell
timer to another.

### The three tiers

| Tier | Test | Pays |
| --- | --- | --- |
| `active` | inside the frustum **and** `clearSight` clear | everything, exactly as today |
| `near` | out of frustum or occluded, but inside the promotion radius | full AI, motion and rig; **no** marching, mesh posing, kit/prop pose, `headShape` or `view` updates |
| `suspended` | beyond the promotion radius | coarse route proxy only (below); no motion solve, no rig, no rendering |

### The visibility test

Frustum: reuse what `bodiesOnScreen()` already computes — the same torso-sphere
test, its result kept instead of thrown away.

Occlusion: **`clearSight(camera, torso, colliders)`**, already exported from
`encounter-director.ts:25`, already pure, an exact slab test the AI already
trusts. 15 actors × 75 colliders is negligible, and it carries no shader risk.

**Room-graph pre-filter.** Before either test, reject on topology: an actor whose
room is neither the player's room nor adjacent to it via `TUNNELS` (which already
carries `a`/`b` room ids, resolved through `nav.roomAt()`) is a `suspended`
candidate without any geometry work. This is deliberately the structure that
survives into a real level — the current greybox has **no doors**, and adding one
later is exactly "remove an edge from the graph, add a collider `clearSight`
already handles."

**Thresholds are metres with stated rationale, never numbers fitted to this
greybox.** The whole test level is ~27 × 17 m, so a radius fitted to it will not
transfer. Starting values, to be validated by the bench and the owner's manual
pursuit check rather than accepted as given:

| Threshold | Start | Rationale |
| --- | ---: | --- |
| promotion radius (enter `near`) | 14 m | Beyond the encounter director's own 10 m sight cap and 12 m hearing cap, so an actor is suspended only once it is outside every range at which it can perceive the player at all |
| demotion radius (enter `suspended`) | 18 m | 4 m of hysteresis — more than an actor covers in one coarse tick at cruise |
| minimum dwell per tier | 0.5 s | Longer than the doorway transit that makes `clearSight` flip |
| coarse-tick stagger | every 6th frame | 5 Hz at the 30 fps cap; a suspended actor at cruise moves ~0.3 m per tick, well inside the 4 m hysteresis band |

### Hysteresis

Separate enter and exit thresholds plus a minimum dwell time per tier. Without
both, an actor at a boundary — or standing in a doorway, which is exactly where
`clearSight` flips — oscillates, and the oscillation costs more than the cull
saves. Both are pinned by tests: an actor walked slowly across each boundary must
change tier at most once.

### Suspended actors: the coarse route proxy

The owner's requirement is that cross-room convergence keeps working. A suspended
actor therefore still moves — it just stops paying for the parts nobody can see.

New method on `ZombieActor`: **`stepCoarse(dt)`**. It advances
`state.wander.pos` and yaw along the actor's existing cached nav route
(`routeGoal` / `routeCache`, `game-actor.ts:480`) and does nothing else — no
`stepMotion`, no `stepRig`, no kit, no view. Suspended actors are stepped on a
**staggered low-rate schedule** (`id % N` against a frame counter) so they never
all tick together, which is the same burst the current unstaggered route cache
already produces.

`a.pose().pos` must stay correct while suspended: the encounter director's sight
and hearing tests and the promotion radius all read it.

### Promotion — the one genuinely fiddly part

The rig is verlet points in **world space**. An actor that traverses two rooms
while suspended would leave its rig points behind, and promoting it would snap or
stretch the body on the first visible frame.

On promotion, translate every rig point by the position delta accumulated while
suspended, rather than re-binding at rest — translation preserves pose
continuity and is cheaper than a re-solve. Mesh geometry costs nothing on
promotion because `SegmentMeshCache` is keyed by revision and shared across
actors of the same kind (measured: warm lookup 0.019 ms / 18 segments).

This gets an explicit test: suspend an actor, traverse it a long distance, promote
it, and assert every rig point sits within a stated tolerance of the body centre.

## Wiring in `game-main`

One `classifyActors` call per frame, before the actor step, and then at each
consumer:

- `sdfLayer.setBodies(...)` — `active` only.
- `segMeshRenderer.update(...)` — `active` only (parallel `entries`/`owners`
  arrays filtered together).
- `boneInstancer.update(...)` — `active` only.
- the kit/prop pose, `headShape`, `view.setTime` loops — `active` only.
- `a.step(dt)` — `active` and `near`; `a.stepCoarse(dt)` for `suspended` on its
  staggered turn.
- `encounter.update(...)` — **unchanged, all actors, every frame.** AI is not
  degraded at any tier; this is what keeps cross-room aggression intact. The
  routing stagger applies only to `suspended` actors, because that is where
  `stepCoarse` owns the tick. Route bursts among `active`/`near` actors are a
  separate, smaller problem (measured ~0.96 ms per route, unstaggered) and are
  explicitly **out of scope here** — tracked in the perf notes, not fixed by
  this design.

Target: roughly 20 lines added to `game-main.ts`, which is already 6,743 lines
and which `docs/architecture/repository-map.md` wants smaller.

## Seams and diagnostics

- `__sdfGame.setActorLod(on)` — live A/B, following the `setOccluder` /
  `setDepthGate` convention. **Required**: without it the bench cannot measure
  the win, and this repo has been burned before by shipping unmeasured changes.
- A bench leg `actor-lod-off` in `ALL_LEGS`.
- Tier counts (`active` / `near` / `suspended`) added to the bench census and to
  `__sdfGame` diagnostics. A cull's cost column is unreadable without knowing
  how many bodies it actually culled — the census section of `bench.md` exists
  for exactly this reason.
- The HUD's existing `bodies N/M` becomes `bodies active/near/suspended`.

## Testing

Pure vitest, no GPU:

- `classifyActors` tier assignment for each of frustum-in/out, occluded/clear,
  inside/outside radius, and each room-graph case.
- Hysteresis: an actor walked slowly across each boundary changes tier at most
  once.
- State keyed by id: removing an actor mid-run does not transfer another's dwell
  timer.
- `stepCoarse` advances along the cached route and leaves motion/rig untouched.
- Promotion: rig points land within tolerance of the body after a long suspended
  traverse.

GPU/bench acceptance:

- The Phase 0 baseline re-taken with `actor-lod-off`, then the same rooms with it
  on. Judge each delta against its own legs' repeat spread, per the harness's own
  repeatability section.
- Manual owner check that cross-room pursuit still arrives — this is behaviour the
  owner added deliberately and it is the one thing this work must not cost.

## Risks

| Risk | Mitigation |
| --- | --- |
| Promotion pop on a visible actor | Promotion only happens off-screen by construction; rig translation preserves pose; pinned by test |
| An `active` actor mis-culled and popping in | `clearSight` is exact for AABB colliders; the torso sphere is generous; hysteresis biases toward staying `active` |
| Cross-room aggression quietly weakened | `stepCoarse` keeps convergence; owner manual check is an explicit gate |
| Thresholds over-fitted to the doorless greybox | Room graph is the primary filter; radii stated in metres with rationale |
| The win is smaller than the noise | Phase 0 lands first; A/B seam plus census tier counts make the delta readable |
