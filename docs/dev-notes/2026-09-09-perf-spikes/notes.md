# Performance spikes after the soldier + mesh-skeleton milestones (2026-09-09)

**Question (owner):** since the soldier landed and bones were replaced with
meshes, overall performance improved but the game now spikes off the 30 fps
target. What can be done given everything already optimised?

**Short answer:** the spikes are not in the raymarcher, and the levers the
project believes are exhausted are exhausted *for the march*. What has changed
since the last attribution is CPU-side and structural: the simulation, the AI
and the new mesh-skeleton renderer all run for **every actor in the level, every
frame, with no room, distance or visibility gate**, and the one measured safety
net (adaptive resolution) is switched off. The current bench numbers are ~3x
worse than the last recorded baseline for the same room and leg.

---

## 1. The measurement basis is stale — this is the first problem

Every number the project trusts predates the work the owner is asking about:

| Study | Date | What it measured |
| --- | --- | --- |
| `2026-08-31-game-perf-baseline` | 08-31 | pre-soldier, pre-mesh, pre-encounter |
| `2026-09-07-gpu-pass-attribution` | 09-07 | 4 zombies, procedural bones, no director/nav/casings |
| skeleton mesh migration | 09-08 | **"no controlled timing result is claimed"** (wrap-up.md) |

The mesh skeleton renderer became the forward default **without a single
performance measurement**, by its own wrap-up note. The bench also never runs
**room 5**, the soldier room (`BENCH_ROOMS` defaults to `1,2,3,4`).

## 2. Same harness, same room, same leg — a large regression

`BENCH_LEGS=baseline scripts/sdf-game-bench.sh`, room 3, overall median
chunk-mean ms:

| date | room 3 | source |
| --- | ---: | --- |
| 2026-08-31 | 21.42 | `2026-08-31-game-perf-baseline/bench-rooms34.md` |
| 2026-09-07 | 14.15 / 13.97 / 14.66 | `2026-09-07-gpu-pass-attribution/passes.md` |
| **2026-09-09** | **45.26 / 40.96** | this run |

Room 5 (3 soldiers + 2 zombies), first numbers ever recorded: 42.79 / 59.56 ms
median, max chunk 90–120 ms.

Per segment, with the census the harness prints alongside it:

| room | walk | fire | gib | bodies on screen | wounds | droplets | goo quads |
| ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 3 | **33.88** | 46.02 | 49.69 | 8→10 | 0→16 | 0→66 | 0→289 |
| 5 | **60.10** | 64.14 | 51.46 | 8→4 | 0→16 | 0→198 | 0→382 |

**The walk segment is the most important number here.** It runs with
`wounds 0→0, chunks 0→0, droplets 0→0, goo quads 0→0` — nothing on screen but
bodies — and it already costs 34 ms in room 3 and 60 ms in room 5, against a
33.3 ms budget. On 2026-09-07 the comparable walk was ~8 ms GPU. **The floor
has risen, independently of the wound term the previous studies were chasing.**
That is the signature of a per-body cost, not a per-wound cost, and it is what
points at the ungated simulation and the mesh path rather than at the march.

Spike pass (fenced per frame): room 3 p50 120.6 / max 492.1 (**4.1x**), room 5
p50 63.7 / max 335.4 (**5.3x**), worst segment `fire` in both. The harness says
to read the ratio, not the absolute — a 4–5x max/p50 is its spike signature.

> **CAVEAT, and it is a real one.** These runs were NOT on a quiet machine: a
> concurrent dispatch agent (`dsh`, bloatmaw r4) was driving its own headless
> Chrome, and a dualmem `sqlite3 VACUUM` was running; 1-min load ran 43–63 for
> the whole session, and repeat spread reached 39% in room 5.
> The repo's own warning ("check background load before trusting any blud SDF
> perf A/B") applies. Absolute values are inflated by an unknown factor. The
> *direction and size class* survive that discount — 14 → 41 is not a 10% noise
> effect — but **the table above must be re-run clean before any lever is
> chosen against it.**

## 3. Root cause candidates, with what was actually measured

### 3.1 CONFIRMED — nothing in the simulation is gated by room or visibility

`game-main.ts` holds one flat `actors` array of **every actor in all five rooms**
(1+2+3+4+5 = 15, four of them soldiers). Every frame, for all fifteen,
regardless of which room the player is in:

- `for (const a of actors) a.step(dt)` (motion, rig, brain)
- kit overlay pose (`character.pose(...)`) — glTF skinned armour + held prop
- `headShape(a.posed())`, `view.setTime`, wound-preview advance
- `encounter.update(snapshots, ...)` — sight/hearing/relay/fire-lease over all agents
- `segMeshRenderer.update(actors.map(...), actors)` — see 3.2
- crowd `separate(agents)` over all actors + player

Per-actor cost has grown a lot (soldier kit, carry IK, casings, director orders,
nav routes, 21 mesh segments) while the gate on that cost is still nonexistent.
This is the single biggest structural lever and it costs nothing visually.

### 3.2 CONFIRMED — the mesh skeleton path is unbounded and unmeasured

`skeleton-spike/mesh-renderer.ts` `update()`:

- Builds **~282 `THREE.Mesh` objects** in one group (11 zombies x 18 segments +
  4 soldiers x 21) and touches every one of them every frame.
- Calls `cache.get(s)` **before** `s.isLive()`, so severed/hidden segments still
  pay a `meshBoneSource()` object allocation + template-string key + Map lookup
  every frame. ~282 short-lived strings per frame is GC fuel, and GC pauses are
  spikes.
- Has **no telemetry phase at all**, so an F8 capture cannot attribute it.

### 3.3 CONFIRMED — mesh extraction is seconds-scale, synchronous, in-frame

`SegmentMeshCache.get()` extracts on miss by running surface-nets at 1 cm cells,
**on the main thread inside the render frame**, with no budget. Measured
(vitest/Node, so read as an order of magnitude, not a Chrome number):

| character | segments | cold total | worst single segment |
| --- | ---: | ---: | --- |
| zombie | 18 | ~3.1 s (second prime; 28 s incl. JIT) | `axial:1-2` — dominates |
| soldier | 21 | ~7.9 s | `axial:2-3` — 7.3 s alone |

Warm lookup is 0.019 ms / 18 segments, so the steady state is fine. The problem
is that the *first frame that draws a character kind* pays this, unprewarmed.

### 3.4 DISPROVED — severing does **not** invalidate the mesh cache

Hypothesis was that a limb sever re-derives bone prims (`severDistal` splits
bones across the cut plane), changing the segment revision and forcing a
mid-combat re-extraction. Measured directly: a mid-limb cut on each of armL,
armR, legL, legR produced **0 new revisions and 0 ms of extraction**. Severed
segments are dropped from the source list (`a0fa2c2a`), not re-extracted.
Recording this so nobody re-runs the same theory.

### 3.5 PARTIAL — navigation is bursty, ~1 ms per route

`encounter-navigation.ts` `route()` measured at **0.96 ms** for a blocked
same-room route on the real level (grid 68x44 = 2,992 cells).
`nearest()` is a **full linear scan of all 2,992 cells** with a `canStand` call
each, and `route()` calls it twice; `new Int32Array(2992)` is allocated per call.
The route cache expires after **0.6 s or 0.6 m of goal movement** — and the goal
is the player, who in an FPS moves further than 0.6 m constantly. So every
pursuing actor re-routes on a near-frame cadence, unstaggered: N actors x ~1 ms
landing on the same frame. Second-order next to 3.1/3.2 but exactly spike-shaped.

### 3.6 CONTEXT — the one measured safety net is off

`adaptive-scale.ts` is the only lever with a measured mechanism behind it
(resolution scale was the only thing that moved the frame in the 08-31
baseline). `game-main.ts:672` ships `adaptiveEnabled = false` — owner decision
2026-09-04/05, because the resolution drop is visible and unwelcome up close.
That is a legitimate aesthetic call, but it means **nothing at all absorbs a
load transient today**. The frame cap is 30 (`setFrameCap(30)`), so the budget
is 33.3 ms.

### 3.7 CONTEXT — the march's own levers really are exhausted

From `2026-09-07-gpu-pass-attribution` (runs 4-6): the march is the whole GPU
budget, growing 8 -> 19 -> 31 ms as wounds land; wound early-out does nothing,
the near-wound step multiplier already ships at its fast value, the union-reach
cull already ships on (worth 2x), the owner re-fold is 2-3 ms in room 3 and
nothing in room 4. The two levers that were identified and never built:
**per-tile wound lists** and a **wound-aware entry bound**.

Note also: run 7 ("bones out of the marched field") was abandoned UNRESOLVED on
a loaded machine. The mesh migration has since shipped exactly that change
(`view.setPackBones(false)`), so its win is sitting there unmeasured.

---

## 4. What to do, in order

### Tier 0 — restore the ability to measure (blocks everything else)

1. Add the two missing telemetry phases: `skeleton-mesh` (source rebuild +
   `segMeshRenderer.update`) and `encounter` (director + nav routes). Roughly
   ten lines; without them an F8 capture is blind to the two biggest additions
   since the last attribution.
2. Add room 5 to `BENCH_ROOMS` and re-run `BENCH_PASSES=1` on rooms 3/4/5 on a
   genuinely quiet machine (no dispatch agents, no VACUUM). Re-partition the
   frame with today's content before choosing a lever.

### Tier 1 — structural, high confidence, no visual cost

3. **Simulation LOD.** Gate the per-actor work in the frame loop by room +
   distance. Actors more than a room away get a coarse or lower-rate step and
   skip kit pose, head shape, view updates and mesh posing entirely.
4. **Gate `segMeshRenderer.update()` and the bone instancer to near/visible
   actors** — ~282 meshes down to the handful actually on screen.
5. **Move `isLive()` above `cache.get()`** and hold the baked mesh on the slot,
   so a steady frame does zero allocation and zero string building.

### Tier 2 — spike-specific

6. **Prewarm the mesh cache per character kind at load**, or move extraction to
   a worker. Never let a seconds-scale extraction land in a gameplay frame.
   Separately: consider a coarser `MESH_CELL` for the axial segments, which are
   where essentially all the extraction cost lives.
7. **Amortise navigation.** Replace the `nearest()` linear scan with a direct
   cell-index lookup (O(1) from the coordinates), and stagger route recomputes
   across frames so N actors never re-route together.

### Tier 3 — the march, once measurement is restored

8. Build one of the two identified levers: per-tile wound lists, or a
   wound-aware entry bound.
9. Harvest the free number: measure what taking bones out of the marched field
   actually bought (the unresolved run 7), now that it ships by default.

### Tier 4 — a safety net the owner can live with

10. Adaptive resolution is off because the drop is ugly. Rather than nothing,
    either re-arm it with a high floor (0.7+ only, so it can shave one rung
    without the mush), or make the fallback a **content** lever — freeze distant
    actors' animation, drop far mesh segments — since the owner's objection is
    specifically to resolution loss up close.

---

## Reproduction

```
BENCH_LEGS=baseline BENCH_ROOMS=3,5 BENCH_REPEATS=2 \
  LAB_VITE_PORT=5299 LAB_CDP_PORT=9299 scripts/sdf-game-bench.sh
```

Extraction and navigation costs were measured with throwaway vitest probes
(deleted); the numbers above are what they printed.
