# SDF perf round 2 — notes

Plan: docs/superpowers/plans/2026-09-01-sdf-render-perf-round2.md
Review: Obsidian `Claude Notes/Blud/2026-09-01-sdf-render-and-blobforge-review.md`

One section per task: state, before/after, spread, verdict. Every timed bench
is subject to the plan's machine-load rule (defer and mark it); parity and
visual gates are NOT deferrable and run regardless.

## Task 0 — baseline (2026-09-01, base b899348)

**Machine load:** `wound-r2-task-4` (the concurrent wound-pass-r2 chain) held
`status: running` across this task's window (started 23:00 UTC; its worktree
was committing minutes before). Per the ground rules the timed bench is
**DEFERRED (machine loaded)** — task 9 re-takes it on a quiet machine with
`BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh`. The occupancy
counters are taken anyway: they are counters, not timers, and are immune to
background load (established 2026-08-31 in game-perf-baseline follow-up 2).

| room | median ms | spread | hits | marched (rasterised) | mean steps hit / miss |
|---|---|---|---|---|---|
| 3 | DEFERRED (machine loaded) | DEFERRED | 73612 | 111555 | 10.6 / 24.7 |
| 4 | DEFERRED (machine loaded) | DEFERRED | 81793 | 176349 | 10.4 / 5.2 |

Shell ON (732 instances, not overflowed), occluder OFF, cone OFF, fxaa ON,
smear 0.25, scale 1.0 at 800x600, relax 1.0 (omega 0.6), half-rate OFF,
backend webgpu — all read back off the live seams. Adaptive resolution was
pinned OFF for the read (the bench harness disables it during legs too; a
loaded machine would otherwise downscale the march target and the counts
would not be comparable). Servers on this chain's ports: vite 5299 / CDP 9299.

### Occupancy protocol (task 9: reproduce exactly this)

Fresh page at the bench viewport (1280x800), settle 5 s. Per room: pin
`setAdaptive(false)`, `setSdfScale(1.0)`, fxaa ON, smear 0.25, cone OFF,
occluder OFF; `freeze(false)` + `teleport(room)` (the seam's room-centre,
facing +z), 2 s of natural wander (≈ the walk segment), `freeze(true)`,
settle 0.5 s, then `__sdfGame.occupancy()` twice, 1 s apart. Driver was
`/tmp/perf-r2-occupancy.mjs` this session only — recreate from this text if
gone (no-deps CDP, same plumbing as `scripts/sdf-game-bench.mjs`).

- The two reads on the frozen scene are bit-identical in both rooms: the
  counter is deterministic at a pinned state, so any later delta is scene or
  shader, never jitter.
- Full counts. Room 3: 480000 target px, rasterised 111555 (coverage 23.2%),
  hits 73612, misses 37943, occupancy 66.0%, missStepShare 54.5%, 3 bodies on
  screen. Room 4: rasterised 176349 (coverage 36.7%), hits 81793, misses
  94556, occupancy 46.4%, missStepShare 36.5%, 4 bodies on screen.

### Read-across for tasks 1–8, and what changed since the round-1 notes

- The timed 21–27 ms baseline of 2026-08-31 is stale — shadow-hull spanning
  grew the outer hull from 30 to 51 instances per body, and a one-off HUD read
  showed ~54 ms. Nothing later in this plan may cite the old number; task 9
  owns the trusted table.
- Hull footprint after spanning, at this protocol: room 4 rasterises 176349 px
  against the 75314 recorded in round-1 follow-up 4 (shell ON both times).
  Poses and placement differ (live-wandered room-centre vs the bench's frozen
  centroid placement), so read it as direction — the hulls cover markedly more
  screen than before spanning — not as an exact delta.
- The shell already deleted most of the classic miss market: misses now carry
  36–55% of all march steps (63–84% pre-shell, follow-up 2). What remains is
  hit-pixel cost (mean 10.4–10.6 steps) plus misses that still run deep —
  room 3's miss mean is 24.7 steps, room 4's only 5.2.
- Verdict: measurement state pinned and recorded; timed legs deferred to task 9
  per the machine-load rule.

## Task 1 — hull exit bounds tMax on the un-relaxed path (2026-09-01, branch dispatch/2026-09-01-sdf-render-perf-r2-task-1)

**What changed.** `MARCH_BODY` gains a `perfCfg: vec4<f32>` parameter (LAST in
the WGSL signature and in `createMarchMaterial`'s positional `march({...})`
binding — the 2026-09-01 spotCfg2/spotColor swap is why the position matters).
`tMax` becomes
`select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax)` with
`let relax = woundCfg2.y > 1.0;` hoisted above it; the proxy-box far plane
stays the bound whenever the seam is off, on the relaxed path, or without a
shell (`shellOut` 1e9 makes `min` the identity). The "DELIBERATELY NOT FOLDED"
comment block is rewritten to the new contract with the halo history kept.

**Seam name:** `perfCfg.x`, game-page constant `GAME_HULL_EXIT_BOUND = 1`,
live toggle `__sdfGame.setHullExitBound(on)` + `__sdfGame.hullExitBound`.
Chunks inherit it through `copyTemplateLook` (`u.perfCfg.value.copy(...)`),
same path as `woundCfg2`; the lab binds the all-zero default and is
bit-identical.

**Bench: DEFERRED (machine loaded)** — `wound-r2-task-4b` held
`status: running` across this task's window. Task 9 re-takes it.

**Parity + occupancy: see Task 1b.** Not run here by design — this task is
the shader change and its seam only.

**Gates that DID run here:**
- `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — 125/125
  (guard rewritten to the new contract first, verified failing before the
  shader change, passing after).
- `npx tsc --noEmit` — clean.
- `npx vitest run src/lab/sdf-zombie/` — 1930/1930 across 103 files.
- `npm run blob:render-check -- zombie` — exit 0, "0 hole cluster(s)" (run
  on LAB_VITE_PORT=5297/LAB_CDP_PORT=9297 — 5299 was busy with a non-Blud
  server; the wrapper's `node_modules/.bin/tsx` is a broken self-referential
  symlink in the shared main-repo install, so the check ran via the identical
  wrapper sequence with `npx --no-install tsx` as the runner. Environmental;
  not a repo change).
