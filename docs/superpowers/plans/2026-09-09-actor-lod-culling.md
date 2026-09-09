# Marched-body visibility cull — plan (REVISED 2026-09-09 after measurement)

> **SCOPE CUT.** This plan originally specified a three-tier actor LOD system
> with a pure `actor-lod.ts` controller, `stepCoarse`/`resume` on the actor, and
> a Verlet rig translation on promotion. **Phase 0 measured that premise as
> wrong** and it has been deleted. See
> `docs/dev-notes/2026-09-09-perf-spikes/phase0-baseline.md`.

## What the measurement said

Clean machine (load 3.5), `BENCH_LEGS=baseline BENCH_PASSES=1`, rooms 3/4/5:

| | room 3 | room 4 | room 5 |
| --- | ---: | ---: | ---: |
| `sdf:march` | 17.30 (75%) | 18.47 (83%) | 20.84 (82%) |
| `cpu:phase:skeleton-mesh` | 0.40 | 0.50 | 0.50 |
| `cpu:phase:encounter` | 0.20 | 0.20 | 0.20 |

The original plan argued the frame had gone CPU-bound because ~282 meshes are
touched per frame across 15 ungated actors. The live page confirms that count
exactly — `actors 15, segments 282, 502,756 tris, hidden 0` — and it costs
**0.7 ms**. The march is the frame, as the 2026-09-07 study already said.

**Deleted from this plan:** the `near`/`suspended` tiers, `ZombieActor.stepCoarse`,
`resume`, the Verlet promotion translation and its tests, the staggered coarse
tick, and the room-adjacency graph. That was the design's riskiest machinery
(a wrong Verlet translation ships a body-explosion bug) aimed at 0.7 ms.

## What shipped instead — Task 1 (DONE, `fecbc54a`)

One visibility filter on `setBodies`, in `game-main.ts`:

- `updateVisibleActors()` replaces `bodiesOnScreen()`, keeping the frustum
  answer that was already computed every frame for the HUD and discarded.
- Occlusion via `clearSight(camera, point, colliders)` — already exported from
  `encounter-director.ts`, already trusted by the AI, exact for AABB colliders.
  **Not** a revival of the GPU occluder pre-pass, which was disabled for a
  measured reason (its distance under-reports past ~3 m).
- Two sight probes per actor: torso centre and a head-height point, because a
  body leaning out of cover reveals its head first.
- Asymmetric hysteresis: becoming visible is **instant**; going invisible must
  persist `CULL_DWELL_MS` (250 ms). A wrongly culled visible body is a visible
  bug; a wrongly kept one is only a cost.
- An actor with no torso cluster (mid-gib, exotic body) is never culled.
- `lastSeenMs` is keyed by actor **id**, not array index — actors are spawned
  and gibbed, and an index would hand one body's grace period to another.
- Seam: `__sdfGame.setActorCull(on)`, `__sdfGame.actorCull()`.

**No simulation LOD.** `a.step()`, the kit pose, the encounter director and the
mesh renderer all still run for every actor. Cross-room pursuit is untouched.

Verified: `npx tsc --noEmit` clean; `npx vitest run` 4325/4326 (the one failure
is the pre-existing `surface-nets.wgsl.test.ts`); live A/B in room 1 reads
**2/15 visible with the cull on, 15/15 off**, with the on-screen enemy present
in both frames.

---

### Task 2: The A/B leg — the win is still UNMEASURED

**Files:** Modify `scripts/sdf-game-bench.mjs`

The honest position: an off-screen proxy box already clipped to no fragments,
so the **frustum half probably buys little**. The occluded case — on-screen but
behind a wall, which rasterises a full box and marches it — is the real target.
Nobody has measured either.

- [ ] **Step 1: Add the leg.** In `ALL_LEGS`, after `'occluder-off'`:

```js
  // The body visibility cull (2026-09-09) SHIPS ON, so baseline includes it;
  // this leg is the "before" column.
  'actor-cull-off': { setActorCull: false },
```

- [ ] **Step 2: Pin the ship default** so legs cannot contaminate each other.
      In `applyLeg`'s pinned block, after `__sdfGame.setBoneCullMode('segment');`:

```js
    __sdfGame.setActorCull(true);
```

- [ ] **Step 3:** `node --check scripts/sdf-game-bench.mjs` → exits 0.

- [ ] **Step 4: Commit.**

```bash
git add scripts/sdf-game-bench.mjs
git commit -m "bench: add the actor-cull-off A/B leg"
```

---

### Task 3: Measure it, on a quiet machine

- [ ] **Step 1:** `uptime && ps aux | sort -k3 -rn | head -5`. Require 1-minute
      load **below 5** and no `dsh`, no other bench, no `sqlite3 ... dualmem`.
      **STOP if not.** Three runs in this investigation had to be discarded as
      contaminated, and one reported a 3x regression that was really 2x
      measurement noise.

- [ ] **Step 2: Re-baseline first.** `main` has since merged march work
      (`edd18bbd`, secant accept + triangulated wound shadow), so the Phase 0
      table is stale. Both legs must come from the same run.

```bash
BENCH_LEGS=baseline,actor-cull-off BENCH_PASSES=1 BENCH_ROOMS=3,4,5 BENCH_REPEATS=3 \
  LAB_VITE_PORT=5301 LAB_CDP_PORT=9301 scripts/sdf-game-bench.sh
```

`BENCH_LEGS` is load-bearing — without it the harness runs all 34 legs.
**Room 5 needs 3+ repeats**: at 2 it spread 55%, which is unusable for a delta.

- [ ] **Step 3: Write it up** in `docs/dev-notes/2026-09-09-perf-spikes/`, with
      the `uptime` verbatim, the per-room `sdf:march` delta, each leg's own
      repeat spread, and an explicit statement of whether the delta **exceeds
      that spread**. A delta smaller than either leg's spread is UNRESOLVED, not
      zero — say so in those words. Do not widen repeats until it looks good.

- [ ] **Step 4: Owner gate.** Play it. Confirm no enemy pops in or out at a
      doorway edge, and that cross-room pursuit still arrives. Report pass or
      fail.

## Done when

- The A/B leg exists and both legs come from one quiet-machine run.
- The write-up states the delta **and** whether it beats the spread.
- The owner's play check is reported.
