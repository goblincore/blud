# Bleeding Wounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-calibre bleeding on the game page — pellet ooze, slug spurt-to-drip, stump gush — anchored to wounds on the animated body, landing as splat decals.

**Architecture:** A pure `WoundEmitter` extension to `blood-sim.ts` (spawn decisions only — anchors are passed in per call), game-page wiring that recomputes anchors each frame via `woundWorldPos`, and the lab's existing `blood-view-gpu` renderer reused with one deliberate material change. Spec: `docs/superpowers/specs/2026-08-31-bleeding-wounds-design.md` — read it first.

**Tech Stack:** TypeScript, three.js WebGPU, vitest. House patterns: seeded `mulberry32`, CDP capture scripts via `scripts/lab-servers.sh`.

---

## Context the implementer needs

**The depth trap, pre-solved — do not rediscover it.** `blood-view-gpu.ts` creates its droplet material with `depthWrite: false`. On the game page that is a bug: the SDF composite paints flesh over the whole main pass wherever the flesh's depth (carried in the SDF target's alpha) beats the *polygonal depth buffer*. A mid-air droplet that writes no depth leaves the wall's depth at its pixel, so a body in front of the wall but *behind the droplet* still wins — the droplet vanishes exactly when a body is behind it. This is precisely why the muzzle flash had to move to a post-composite pass (see the warning in `game-main.ts` history / dualmem). Droplets do NOT need that treatment: give the game-page droplet material `depthWrite: true` + `alphaTest: ~0.3` (cutout instead of soft blend — acceptable at placeholder quality) and the composite's depth test handles occlusion both ways for free. **Splats stay `depthWrite: false`** — they lie on the floor and the floor's own depth already arbitrates them correctly.

**Stump anchoring is already solved.** `game-actor.ts` `detach()` produces `stumpWound: Wound | null` and stamps it into the wound ring — a stump emitter is just a wound emitter whose wound is the stump wound. `woundWorldPos(posedPrims, wound, 0)` + `woundCarveNormal(...)` (both already imported by `game-main.ts`) give anchor and direction each frame, riding the animated body.

**The lab must stay bit-identical.** `blood-sim.ts` is shared; add the emitter machinery beside the existing burst/trail/splat paths without touching their behaviour. The lab's `createBloodView` call sites keep their current materials — make the depthWrite/alphaTest change via an options parameter defaulting to current behaviour.

**Wound kinds:** the game's wound types route through `woundFromPellet` / `woundFromSlug` (`game-weapon.ts`) and `Wound.type`. Map: pellet→`pellet`, slug→`slug`, stump wound→`stump`, burn→no emitter.

---

### Task 1: `WOUND_BLEED` table + pure emitter spawning (TDD)

**Files:** Modify `src/lab/sdf-zombie/blood-sim.ts`; test `src/lab/sdf-zombie/blood-sim.test.ts` (extend).

- [ ] Failing tests first:
  - per-kind rates: stepping a `pellet` emitter 2 s at 60 Hz with a fixed seed spawns a small pinned count; `slug` spawns most droplets in its first second (front-loaded decay); `stump` total > slug total; all three hit **zero spawns** after their lifetime (2 s / 8 s / 10 s).
  - determinism: same seed + same step sequence ⇒ identical droplet counts and positions.
  - direction: spawned velocities lie within the cone around the passed normal (dot(vel_normalised, normal) above a bound for, say, 90% of spawns).
  - caps: spawning past `MAX_DROPLETS` recycles oldest; no growth.
- [ ] Implement: `export const WOUND_BLEED = { pellet: {...}, slug: {...}, stump: {...} }` (rate curve params, speed band, cone angle, lifetime) and `spawnWoundDroplets(sim, kind, ageSec, anchor: Vec3, normal: Vec3, dt, rng)` — pure; the caller owns anchors. Rate = `base * decay(ageSec)`, fractional accumulation so low rates still emit (carry remainder per emitter — the caller passes an accumulator or the fn returns the new remainder).
- [ ] `npx vitest run src/lab/sdf-zombie/blood-sim.test.ts` green; **run the full lab suite** — existing burst/trail/splat tests must be untouched.
- [ ] Commit.

### Task 2: game-page emitter registry + sim wiring (TDD)

**Files:** Modify `src/lab/sdf-zombie/webgpu/game-main.ts`; test via a new pure module if the registry logic is extractable — prefer `src/lab/sdf-zombie/bleed-registry.ts` (+ test) so the ledger is unit-testable: `{register(bodyId, woundIndex, kind, now), evictForBody(bodyId), perBodyCap (merge/evict oldest at 6), live(now) → refs}`.

- [ ] Failing tests: per-body cap evicts oldest; expired emitters (past lifetime) drop out of `live()`; `evictForBody` clears.
- [ ] Implement registry; wire in `game-main.ts`:
  - on `actor.hit(...)` path → register `pellet`/`slug` from the wound just stamped (the actor's `wounds()` tail); on the sever dispatch → register `stump` for the stump wound.
  - per frame (inside the `!wanderFrozen` block, after actors step): for each live emitter, recompute anchor/normal via `woundWorldPos`/`woundCarveNormal` on `a.posed().prims`, call `spawnWoundDroplets`, then step the blood sim and stamp splats (existing sim step API — mirror the lab's usage in `lab-main.ts`, grep `bloodSim` there).
  - enable **chunk trails** on flying severed chunks (sim supports it; mirror lab usage).
- [ ] `npx tsc --noEmit` clean; full `npx vitest run src/lab` green.
- [ ] Commit.

### Task 3: renderer on the game page

**Files:** Modify `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts` (options param), `src/lab/sdf-zombie/webgpu/game-main.ts`.

- [ ] Add `createBloodView(opts?: { dropletDepthWrite?: boolean })` — default false (lab unchanged). When true: `depthWrite: true`, `transparent: false`, `alphaTest: 0.3` on the droplet material only.
- [ ] Game page: create with `dropletDepthWrite: true`, add `view.objects` to the scene (default layer — the polygonal pass), `view.sync(sim, camera)` each frame.
- [ ] Splat z-offset: confirm the existing splat placement doesn't z-fight the game floor; nudge if needed.
- [ ] `__sdfGame.setBleed(on)` toggle + `get bleed` returning `{enabled, emitters, droplets, splats}` counts. **Ships ON** (it is the feature), but the toggle must make OFF bit-identical.
- [ ] tsc + full vitest green. Commit.

### Task 4: gates

**Files:** Create `scripts/sdf-game-bleed-gate.mjs` (copy the CDP plumbing pattern from `scripts/sdf-game.mjs`), dev note `docs/dev-notes/2026-08-31-bleeding-wounds/notes.md`, TASKS.md row.

- [ ] **Off-state bit-identical**: freeze + `setLoopRunning(false)` + ~8 settle steps (post-AA smear settles — two same-state captures differ ~8% until it converges; see perf-baseline note follow-up 5), capture with `setBleed(false)` twice (noise floor) and vs pre-change build behaviour. Pixel-diff zero above noise floor.
- [ ] **Per-calibre reel**: pellet hit, slug hit, slug sever — 12-frame PNG sequences each, plus a droplet-in-front-of-body frame proving the depth fix (droplet visible with a body behind it). Save under the dev-note dir.
- [ ] **Bench**: `scripts/sdf-game-bench.sh` `BENCH_LEGS=baseline` before/after — the `fire` segment is the probe; quote chunked+fenced numbers only, with the repeatability table. A delta under the legs' spread is UNRESOLVED, not zero.
- [ ] Dev note with honest results; TASKS.md row (≤2 lines) under Current focus. Commit.

## Verification (whole plan)

- `npx tsc --noEmit` clean; `npx vitest run src/lab` green (baseline 1696 + new).
- Production build passes.
- Lab pages behaviourally untouched (no lab-main/panel edits; blood-view default unchanged).
- The reel exists and the depth-fix frame is in it.
