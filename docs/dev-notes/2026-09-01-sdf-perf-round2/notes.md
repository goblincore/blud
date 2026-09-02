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

### Task 1b — the parity harness, and Task 1's parity gate (2026-09-01,
### branch dispatch/2026-09-01-sdf-render-perf-r2-task-1b)

**Machine load:** `wound-r2-task-4b` held `status: running` across this
window. Per the ground rules any timed bench is DEFERRED (machine loaded) —
task 9 re-takes it. Occupancy counters and pixel diffs are load-immune, and
the parity gate is NOT deferrable, so both ran normally. Servers on this
chain's ports: 5299 was held by a non-Blud vite (404 on both `/sdf-game.html`
and `/sdf-lab-webgpu.html`), so the harness ran on 5297/9297 per the plan's
fallback; the wrapper now fails loudly when the port serves no game page
instead of dying 150 s later as "page boot: never became ready".

**What was built** (no page changes — the page boots normally, everything
drives through `__sdfGame` after `resolveGpu()`):
- `scripts/perf-r2-parity.sh` / `scripts/perf-r2-parity.mjs` — the Task-0
  occupancy driver extended into `capture <outDir> --room <3|4> --on "<js>"
  --off "<js>" [--occupancy]` and a standalone `diff <pngA> <pngB>`. Per
  room: boot + pin (adaptive off, scale 1.0, fxaa on, smear 0.25, cone off,
  occluder off), `freeze(false)` + `teleport(room)`, 2 s wander,
  `freeze(true)`, 2500 ms smear settle; then `state-1/2.png` (same state
  twice = noise floor), then off → on → off → on with 2500 ms settle and a
  `Page.captureScreenshot` each (b-1, a-1, b-2, a-2). Screenshots come
  BEFORE any `occupancy()` call in a state — occupancy re-steps one frame
  with a debug config (game-main.ts) and the next state's settle must
  absorb that; the order is the Task-0 protocol's and the repeat pairs
  below prove it clean. `decodePng`/`diffPngs` are copied verbatim from
  `scripts/dungeon-shadowab.mjs`; a 32-px cell grid view was added on top
  (diffPngs' hotCells answer "how bad", the grid answers "where").

#### Harness proof on the shell seam (room 3, `setShell(true)` vs `(false)`)

- Noise floor (state-1 vs state-2): **19 px = 0.0019%**, maxD 72.
- a-1 vs a-2: 79 px = 0.0077%; b-1 vs b-2: 127 px = 0.0124% — both at the
  0.015% settled floor from the 2026-08-31 gate. Toggle is state-clean.
- a vs b: 2363 / 2341 px = 0.23%, hot cells 18-19/12-14 (the body region);
  the shell changes almost nothing visible, as the 2026-08-31 gate recorded.
- Occupancy: `hits` identical on/off (77597, and bit-identical across the
  repeat toggles); `rasterised` 480000 → 114952 with the shell on (4.2×),
  matching the round-1 picture. Harness proven; `hits` ≠ 0 in every state.

#### Task 1 parity gate — `setHullExitBound(true)` vs `(false)`

Room 3 (3 bodies):

| pair | changed px | frac | maxD |
|---|---|---|---|
| noise floor (state-1 vs state-2) | 33 | 0.0032% | 98 |
| a-1 vs b-1 | 2055 | 0.2007% | 539 |
| a-2 vs b-2 | 2052 | 0.2004% | 539 |
| a-1 vs a-2 | 5 | 0.0005% | 47 |
| b-1 vs b-2 | 9 | 0.0009% | 71 |

Room 4 (4 bodies):

| pair | changed px | frac | maxD |
|---|---|---|---|
| noise floor (state-1 vs state-2) | 100 | 0.0098% | 691 |
| a-1 vs b-1 | 355 | 0.0347% | 691 |
| a-2 vs b-2 | 352 | 0.0344% | 691 |
| a-1 vs a-2 | 99 | 0.0097% | 691 |
| b-1 vs b-2 | 17 | 0.0017% | 82 |

Occupancy (bit-identical across repeat toggles in both rooms):

| room | hits on/off | rasterised | meanStepsMiss off → on | missStepShare off → on |
|---|---|---|---|---|
| 3 | 77977 / 77977 | 115544 | 25.11 → 14.73 | 0.538 → 0.406 |
| 4 | 84584 / 84584 | 174061 | 5.75 → 5.18 | 0.371 → 0.347 |

The perf shape is exactly as Task 1 predicted: `hits` identical (the hull
still contains every hit), miss steps cut 41% (room 3) / 10% (room 4).

#### FINDING: the room 3 gate FAILS — a whole background body vanishes

**Task 1's parity gate fails in room 3: 0.2007% ≫ the 0.05% gate.** The
2055 changed pixels are ONE connected, figure-shaped component (2043 px,
perimeter/area 0.18 — a filled blob, not a ring), bbox x 586–938,
y 393–618. 2049/2055 changed pixels are BRIGHTER with the bound OFF.
`vision-ask.py` on the crops, quoted: crop b (OFF) shows "a smaller
reddish/rust-colored humanoid standing in a dark room, body angled forward
with one arm extended"; crop a (ON) shows only the pink foreground body —
"no full humanoid figure is visible … the left background is near-black".
The bound does not draw a halo hugging silhouettes — it deletes an entire
background body's visible pixels wherever that body is seen past the
foreground body's hull region. Room 4 shows the same failure at smaller
scale (355 px, largest component 220, again 288/355 brighter-with-OFF).

The occupancy counters make the finding sharper, not softer: `hits` is
BIT-IDENTICAL on/off in both rooms, so the march's hit set is unchanged —
yet the shipped image loses the body. The loss therefore happens around the
march (depth/composite or hull-fetch interaction), not in the march's hit
determination the counters see. Note the un-relaxed loop's tMax exit is
provably exact per-ray (`omega <= 1.0 → break`, miss discards identically,
start clamp only moves a start that was already past the hull), which is
why Task 1's reasoning held for isolated rays and why the failure had to
be a cross-body/hull-texture effect the per-ray argument doesn't cover.
Also observed, recorded for completeness: room 4's ON state drifts frame-to-
frame (a-1 vs a-2 = 99 px vs room 3's 5 px) while OFF stays clean (17 px).

**Consequence for the shipping default:** `GAME_HULL_EXIT_BOUND = 1`
(Task 1's commit d686704) must NOT ship as-is — at real-render parity it
deletes visible bodies. Recommended owner action: flip the default to 0 (or
fix the underlying hull-bound interaction) before any merge; the step win
the bound buys (missStepShare 0.538 → 0.406 in room 3) is real but is not
takeable at this parity. Per the plan this task stops at the finding — no
tuning was attempted, no shader or default changed here. Task 9's bench
table should keep the bound OFF unless the owner resolves the finding.

**Verdict:** harness proven (shell seam: noise floor 0.0019%, repeat pairs
≤ 0.0124%, occupancy exact). Task 1 occupancy gate PASSES (hits identical,
meanStepsMiss down). Task 1 parity gate FAILS in room 3 (0.20%, body loss;
vision-quoted above) — reported, stopped, not tuned. Harness ready for
tasks 2–8 as-is.
