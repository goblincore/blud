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

## Task 2 — plain sphere tracing, omega 1.0 on the game page (2026-09-01,
### branch dispatch/2026-09-01-sdf-render-perf-r2-task-2, commit 0907cc3)

**Machine load:** `wound-r2-task-5` holds `status: running` across this
window (the concurrent wound-pass-r2 chain again). Per the ground rules the
timed bench is **DEFERRED (machine loaded)** — task 9 re-takes it. The
occupancy counters and pixel diffs are load-immune and all ran normally
(same reasoning as task 0/1b). Vision judged via `scripts/vision-ask.py`
(glm-5.x cannot see PNGs); answers quoted below.

**What changed:** `GAME_OMEGA = 1.0` beside `GAME_RELAX`, applied per-view as
`view.uniforms.marchCfg.value.y = GAME_OMEGA`, seam `__sdfGame.setOmega(v)`
(clamped 0.1–1.0) / `get omega`. The lab is untouched (its 0.6 stays the
owner's bisect reference; `characters/zombie-blob.test.ts` pins it).

**Harness configuration for this task (tasks 3–8 may want the same):**
- `GAME_HULL_EXIT_BOUND = 1` (task 1's default) FAILS parity per task 1b and
  must not ship — so every capture below pins `__sdfGame.setHullExitBound(false)`
  inside BOTH legs (`--off`/`--on`), isolating omega from the known-broken
  bound. The noise-floor pair (state-1/2) ran before the first toggle, i.e. at
  the boot state (bound ON, omega 1.0); the legs themselves are all bound-OFF.
- The bench's ship-defaults reset in `scripts/sdf-game-bench.mjs` now pins
  `setHullExitBound(false)` for the same reason — benches must stay comparable
  to the task 0 baseline (taken before the bound existed) and to task 9's
  bound-OFF table.
- `scripts/perf-r2-parity.mjs` gained `--pre "<js>"`: JS run ONCE on the
  frozen scene before any capture, then a 2500 ms settle — used here as
  `--pre "__sdfGame.aimSurface(); __sdfGame.fireSlug()"` for the wounded legs
  (the slug-gate precedent: aim+fire work on a frozen scene). Default no-op;
  task 1b behaviour unchanged.

### Occupancy gate (frozen scene, bound OFF in both legs, `--occupancy`)

| room | omega | hits | rasterised | mean steps hit | mean steps miss | missStepShare |
|---|---|---|---|---|---|---|
| 3 | 0.6 | 77956 | 115541 | 10.40 | 25.11 | 0.538 |
| 3 | 1.0 | 77955 | 115541 | 5.76 | 15.54 | 0.565 |
| 4 | 0.6 | 90303 | 170141 | 10.76 | 6.82 | 0.359 |
| 4 | 1.0 | 93907 | 170141 | 6.23 | 4.57 | 0.373 |

Both repeat reads within each leg were bit-identical. Room 3: hits unchanged
(±1 px of AA epsilon), steps −45% on hits, −38% on misses. Room 4: hits RISE
90303 → 93907 (+3604) — omega 1.0 converges flesh that 0.6 left unresolved at
range, the direction the plan predicted (the review's 27171 → 46224 was a
different scene config; the gate here is the rise, which is what shows) —
with steps −42% on hits, −33% on misses. Gate PASSES.

### Visual gate — frozen A/B/A/B via `scripts/perf-r2-parity.sh`

Ports: vite 5299 held by a non-Blud server (as in task 1b) → ran the plan's
fallback 5297/9297. Four legs, each `--off "setHullExitBound(false);
setOmega(0.6)"` / `--on "setHullExitBound(false); setOmega(1.0)"`:

| leg | noise floor | a-1 vs b-1 | a-2 vs b-2 | a-1 vs a-2 | b-1 vs b-2 |
|---|---|---|---|---|---|
| r3 unwounded | 66 px 0.0064% | 367 px 0.036% | 347 px 0.034% | 69 px | 75 px |
| r4 unwounded | 116 px 0.0113% | 1675 px 0.164% | 1664 px 0.163% | 121 px | 64 px |
| r3 wounded (`--pre` slug) | 95 px 0.0093% | 351 px 0.034% | 355 px 0.035% | 61 px | 62 px |
| r4 wounded (`--pre` slug) | 34 px 0.0033% | 571 px 0.056% | 565 px 0.055% | 12 px | 13 px |

No hot cells anywhere; maxD equals the noise floor's own 691 (one flickering
pixel present in every pair including state-1 vs state-2). The a-vs-b deltas
are 5–30× the repeat pairs but are DIFFUSE silhouette/flesh-resolution
change, not task 1's concentrated body deletion (which was one 2043-px
figure-shaped component, 18–19 hot cells). The wounded legs diff at the SAME
size as the unwounded ones (r3: 351 vs 367 px; r4: 571 vs 1675) — the wound
adds no omega-sensitivity, which is the quantitative signature of the
nearWound path holding 0.6 locally.

Vision-ask on the side-by-side composites (TOP = 0.6, BOTTOM = 1.0), quoted:

- r4 unwounded: "1) Yes [same bodies/positions/silhouettes] 2) Neither [no
  artifact in either half] 3) Bottom [omega 1.0 resolves more far detail]."
  Individually, 0.6 showed "no clearly resolved humanoid body" in the far
  background while 1.0 shows the far doorway silhouette — flesh emerging at
  range, not loss.
- r3 unwounded: "1) Yes — identical … 2) No unique artifact in either half …
  3) Essentially tied" (room 3's far body is a few px either way; room 4 was
  the discriminating case and favours 1.0).
- r3 wounded: "1) Yes [crater same in each half] 2) Yes [same bodies/poses]
  3) No [no half-unique artifact]".
- r4 wounded: "1) 1/1 — a dark-red crater/wound is visible on the nearer
  right-side body in BOTH halves, and it matches: same location … same size,
  same dark red interior. 2) 1 — yes … 3) 0 — no half-unique artifact."

No halos, no box washes, no missing bodies in any leg. The rim/lighting
mentions in individual-frame reads are the shipped rim-light feature and
appear in both legs.

### Bench gate

**DEFERRED (machine loaded)** — `wound-r2-task-5` status: running; task 9
re-takes `BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh` (which
now benches the bound-OFF state via the reset pin) on a quiet machine.

**Verdict:** occupancy gate PASSES (steps down on hits and misses in both
rooms; room 4 hits rise with omega 1.0). Visual gate PASSES in all four legs
(silhouettes identical, far flesh better or tied, craters unchanged, zero
omega-attributable artifacts). Shipping change is safe; timed win to be
quantified by task 9.

## Task 1c — the shell-exit readback: selection was never wrong, the DISTANCE
### is (2026-09-02, branch dispatch/2026-09-01-sdf-render-perf-r2-task-1c)

**Machine load:** the wound-pass-r2 chain still holds `status: running`
across this window. Nothing timed ran here at all (no bench was scheduled
for this task); the readback below is counters + CDP captures, load-immune.
Ports: vite 5299 held by the known non-Blud server → 5297/9297 per the
fallback.

**Step 1 (commit ccbf1bb):** `GAME_HULL_EXIT_BOUND = 0` shipped alone with
the task-1b finding in its comment, before any diagnosis. The chain no
longer boots a body-deleting default regardless of what the diagnosis finds.

**Step 2 — the readback.** A temporary `__sdfGame.shellExitProbe(pixels)`
seam (removed before the final commit; driver recreated from this text if
gone) froze a room-3 scene per the Task-0 protocol, re-stepped one frame,
read `shellExitTarget` back with `readRenderTargetPixelsAsync`, and printed
per pixel: the stored exit vs the nearest-front/farthest-back camera
distances of EVERY body's hull along that pixel ray (per-body sphere sets
from `buildOuterHullInstances([posed], { shellAmp })`, radii scaled by the
mesh's `1/FACE_INSET` = `/0.9356`, so they describe exactly what the exit
pass rasterises).

Two readback gotchas cost the first attempt and are recorded so the next
person does not repeat them:
- `copyTextureToBuffer` on the WebGPU backend does NOT flip rows (buffer
  row 0 = texture TOP row; `WebGPUTextureUtils.copyTextureToBuffer` is a raw
  `copyTextureToBuffer` with no flip), unlike WebGL `readPixels`. The first
  probe read a vertically mirrored frame and still "matched" 65/79 sampled
  pixels — a slow-varying buffer plus a tolerant threshold makes a wrong
  mapping look right. Rows are padded to 256 B as the occupancy comment
  says (`bytesPerRow = ceil(w*4/256)*256`, confirmed in the same file).

Grid probe over task 1b's diff bbox (x 560–960, y 370–640, 20 px steps,
294 points, 244 covered by some hull), frozen scene, `sdfTarget 800x600`:

| population | count | stored vs computed farthest back face |
|---|---|---|
| near-body pixels (body #4, hull entry 0.54–0.79 m) | 219 | match within 0.15 m — near-field encoding EXACT |
| far clusters (see below) | 19 | stored 2.0–3.7 m where the true hull exit is 8.1–9.1 m |
| zero-where-covered | 6 | sub-texel edge pixels, benign |

The two far clusters, and this is the whole finding:

| cluster (screenshot px) | stored | computed covering hull | true exit |
|---|---|---|---|
| x 568–616, y 392–488 | 2.0–3.5 m | body #2 (room 2, through the far doorway), entry 8.5 | 9.12 m → stored 2.84 |
| x 776–808, y 392–488 | 3.3–3.7 m | body #1 (room 2, behind the wall), exit 8.1–8.5 | → stored 3.3–3.7 |

`vision-ask.py` on a same-staging screenshot (quote): "a small pink/red
figure standing far away in the central doorway, roughly x 405–455,
y 255–345" in its ~900×530 assumed frame = **x 576–647, y 363–490 at
1280×800 — exactly cluster 1**. The decayed value sits on the VISIBLE
doorway figure. Cluster 2 sits on blank wall (invisible flesh — consistent
with task 1b's diff being exactly ONE figure-shaped component). Body #2 at
~9 m, flesh ~8.9 m, march clamped to 2.84 m → rays stop metres short →
discard → **body #2 in the doorway is task 1b's deleted figure**. Room 4's
smaller failure (0.035%) fits the same curve: its visible bodies sit
nearer, where the encoding is still accurate.

**The task-1c hypothesis is REFUTED in its mechanism, confirmed in its
consequence.** The exit pass DOES hold the farthest back face: at pixels
covered by both the near hull (exit ~0.96) and a far hull, the stored value
is the far hull's — max semantics verified by readback, so `setClearDepth(0)`
+ `GreaterDepth` works and none of Step 3's candidates apply ((a) the clear
is honoured; (b) MaxEquation would maximise wrong values; (c) a depth-clear
quad likewise). What decays is the WRITTEN DISTANCE: true ~9 m stores
~2.8 m, true ~8.3 m stores ~3.5 m, near field exact. That is the SAME
unresolved phenomenon MARCH_BODY's occluder comment measured on the
identical material pattern ("true 7.9 -> 3.782, true 9.9 -> 2.079 ... who
ever works out why an instanced MeshBasicNodeMaterial writing
length(positionWorld - cameraPosition) decays with distance can revive
this"). The shell hull "is unharmed only because shellIn is a ray START and
shellOut a > 0 test" — as a tMax BOUND the under-report is fatal, exactly
as that comment warned.

**Consequence for the bound:** a correct bound needs `shellOut >= flesh`
for every visible body; the encoding cannot deliver that beyond ~4–5 m.
Fixing it means root-causing the three-r185 TSL distance decay — the
documented open problem, out of this task's scope. **`GAME_HULL_EXIT_BOUND`
STAYS 0.** Step 4 (parity with the bound on) does not run: it is gated on a
real fix landing, and task 1b already documents the bound-on failure this
readback now explains. The step win the bound buys (missStepShare
0.538 → 0.406 r3) remains untakeable until the decay is fixed.

**Second finding — occupancy `hits` bit-identical was never evidence of an
unchanged hit set.** MARCH_BODY's occupancy mode returns BEFORE the discard
so missed rays still write, and a miss writes DEPTH at its give-up distance
(documented in the shader). Wherever proxy boxes overlap, a near box's miss
clobbers a far body's real hit before the readback — so the deleted
figure's hit→miss flips are invisible to the counter. Any future "hits
identical on/off" claim must be read with that bias in mind.

**Verdict:** readback evidence recorded whichever way it went (acceptance
criterion met); hypothesis refuted; default 0 ships; suite green (103
files / 1930 tests); temporary seam removed; no other page changes.

## Task 3 — wound-loop early-out behind perfCfg.y (2026-09-02, branch dispatch/2026-09-01-sdf-render-perf-r2-task-3)

Two dispatch attempts; the shader change and seam landed in the first
(`4138ac4`, cherry-picked as `eeae03b`), the gates ran in the second, and the
second timed out inside its bench legs. This section was written by the
controller from the second attempt's report; the numbers are the agent's.

**What changed:** `applyWounds` loads a wound's position first, computes
`r`, and skips the meta/cap loads and every op after them when
`r > reach = w.w * max(2, 2*rimOffset + 3*rimWidth) + 4k + 0.25` — exact by
construction (crater r < radius; smin is exactly min beyond 4k; the rim
bump at three widths is 1.2e-4 of amp). `perfCfg` is threaded through
`mapBody` and every caller. Seam `__sdfGame.setWoundEarlyOut()`; default
`GAME_WOUND_EARLY_OUT = 1`.

**Parity, wounds staged (room 3, three slug stamps on the nearest zombie's
torso via `stampWoundAt` in the harness `--pre`, seam A/B/A/B):** noise
floor 23 px / 0 big; a-1 vs b-1 7 px (below noise); a-2 vs b-2 70 px with a
40-px "big" blob that decodes to a 7x9 patch at x 40–46, y 16–26 — the HUD
frame-time readout ticking 16.7 → 16.6 ms, present identically in the
same-state pair a-1 vs a-2 (61 px / 40 big / same maxD 691). Torso crops:
craters present and identical across all four legs. **Gate PASSES.**

**Lab:** `npm run blob:render-check -- zombie` exit 0, 0 hole clusters (the
lab binds `perfCfg` zero). Note for the next runner: the repo's
`node_modules/.bin/tsx` was a self-referential symlink on this machine;
`vite-node` runs the TS scripts.

**Bench:** two legs ran (seam OFF fire-segment p50: room 3 17.86 ms, room 4
16.04 ms; seam ON: room 3 slower, room 4 faster, both inside 3-repeat
spread). Inconclusive at that sample size and the run was cut off adding
repeats — **DEFERRED to task 9**, which A/Bs `setWoundEarlyOut(false)` on
the finished chain.

**The first attempt's "the early-out eats the craters" was a confounded
base-vs-branch comparison across two page loads; on one load the seam is
pixel-identical in the body region.** Verdict: ships ON.

## Task 4 — occluder hull split + specialiser retired (2026-09-02, branch dispatch/2026-09-01-sdf-render-perf-r2-task-4)

Both halves are deletions of work nothing consumes; the shader is untouched,
so GPU parity is exact by construction.

**(a) Hull split.** `OccluderHull.update` gained `opts?: { occluder?: boolean }`
(default ON, so every existing caller is unchanged): `occluder: false` skips
the inner-hull `buildHullInstances` walk + `fillInstances` while the SHADOW
twin always rebuilds (the shadow map is always live). `game-main.ts` passes
`{ occluder: sdfLayer.occluderEnabled }` at BOTH call sites (frame loop and
the `refreshHull` diagnostic seam) — `__sdfGame.setOccluder(true)` resumes
the rebuild on the next frame, so the A/B seam still works.
`syntheticSphereCheck` is unaffected (it writes via `setSpheres` directly).

Plan deviation worth recording: the plan's Step-1 test snippet calls
`hull.update([], { occluder: false })` — with the positional signature
`(bodies, wounds, opts)` that binds the options object as WOUNDS and `opts`
defaults to `{}`, so the occluder half still ran and the test failed with
count 0 (which is also exactly what `tsc` would reject). The test passes
`update([], [], { occluder: false })` instead.

**(b) Specialiser retired** (owner call, per the plan's recommendation).
Confirmed the bit-rot before deleting: `specialise.ts` emitted
`sdPrim(p, ${i}, data)` — three arguments — against `SD_PRIM`'s current
seven (`p, i, data, r2, prof, cpos, band`), so `?specialise=1` would have
failed pipeline creation. Deleted `specialise.ts` + `specialise.test.ts`;
removed from `zombie-gpu.ts` the `specialiseMapBody` import, the
`specialise?: boolean` view option, and the ternary at the
`createMarchMaterial` call (now plain `marchBody`); `buildMarchFn` lost its
never-again-used swap parameter (the mapBody-slot-in-HELPERS note stays);
`lab-main.ts` lost the `specialiseShaders` state and the
`setSpecialise`/`get specialise` seam; `march.wgsl.test.ts` lost the import,
the 'counts prims in the specialised fold too' heatmap-parity test and its
`oneClusterBody` helper, and a comment referencing the mirrored signature.
−439 lines net.

**Tests:** new split test red-then-green in `occluder-hull.test.ts` (29/29);
`npx tsc --noEmit` clean; `npx vitest run src/lab/sdf-zombie/` 102 files /
1913 tests green.

**Bench: DEFERRED (machine loaded).** One full run was attempted
(BENCH_ROOMS=3,4 BENCH_REPEATS=3): repeatability spreads 34–161% (baseline
room 3 legs 9.09 / 23.69 / 10.27 ms) — the dispatch board showed only this
task running, but the user's Chrome was actively rendering through the run
(WindowServer 24–32%, Chrome GPU/helper bursts, load avg 2.3–4.4). The
expected delta is a small CPU-side win, far under that noise, so the run
does not resolve it; task 9 re-takes it. The run still doubles as a boot /
visual smoke under the new code: both rooms played the full walk/fire/gib
protocol (census: room 3 bodies 8→8, room 4 9→9; wounds staged; gibs fired).

**Direct CPU measurement of what the split removes** (micro-bench,
`buildHullInstances` × 9 rest-pose zombies, 2000 reps, rest pose — the
walk's cost is prim-count-bound): **p50 5.0 µs, p90 5.7, p99 11.6 per
frame** (270 instances at rest; posed bodies emit the same count). ≈0.03%
of the 16.7 ms frame — the win is honest, one walk per frame removed, and
invisible to the frame bench by construction.

## Task 5 (written by 5b — task 5 never wrote one) + Task 5b — the accumulated-depth gate, made to bite (2026-09-02)

### The dead-gate finding (task 5)

Task 5 landed the plumbing — per-body front-to-back passes with a `prev`
target + blit, `prevT` fetched from the blit's alpha (zombie-gpu.ts ~529–538,
~720–735), a `bodyEntry` ray/proxy-box entry (`march.wgsl.ts` ~1415–1440) —
and shipped the discard as `if (min(shellIn, bodyEntry) > prevT)`. That form
is structurally inert: `min(shellIn, bodyEntry) <= shellIn`, and `shellIn` is
the SHARED nearest hull entry across ALL bodies (one instanced hull pass), so
at any pixel where the gate should fire `shellIn` is the nearer body's own
hull entry, which precedes its flesh — i.e. `shellIn <= prevT` almost
everywhere, and the min() can never exceed `prevT`. Task 5's occupancy
instrument proved it: counters bit-identical on/off in rooms 3 and 4 (its
r3 gate: a-vs-b 25/2 px vs 66 px floor; r4: 97/54 px vs 54 px floor — parity
PASS, but the gate did nothing). The −49 marched pixels it reported at one
point came from the `tMax = min(tMaxSel, prevT)` clamp, not the discard.

### The max fix (5b step 1)

Both `shellIn` and `bodyEntry` are lower bounds on the first point at which
THIS body could be hit; the larger of two lower bounds is still a lower
bound (and the tighter of the two). The exact discard is therefore
`if (max(shellIn, bodyEntry) > prevT) { discard; ... }` — it can never drop
a fragment this body would have shaded, and it actually fires wherever the
fragment's own proxy-box entry lies behind an already-accumulated hit.
Comment block and the `march.wgsl.test.ts` string pin updated to say why.
`tsc --noEmit` clean; march.wgsl.test.ts 126/126.

### Why the occupancy counters CANNOT see this gate (instrument bias, both scenes)

`__sdfGame.occupancy()` reads debug mode 4 counters from the march target,
where **only the depth-winning fragment per pixel survives to write** (the
mode-4 doc block says so itself). The gate deletes the work of fragments
that were going to LOSE the depth test — the survivors' counters are
unchanged, so `rasterised`, `hits` and (mostly) the step means are
bit-identical on/off BY CONSTRUCTION. The win is fragment invocations the
instrument is blind to; the honest occupancy expectation for this gate is
"identical counters", and any counter movement is survivor bias (see room 4).
Timed proof of the step win belongs to the bench below / task 9.

### Step 2 — synthetic maximal-overlap scene (task5b/overlap/)

Task 5's driver staged the camera behind one zombie looking through it at
another 17 m away but timed out separating its 32k-px diff from the dungeon
fire flicker (animates on `performance.now()` even frozen). 5b recreates the
staging as a harness `--pre`: after freeze, pick the two farthest-apart
zombies in room 4, teleport the camera 1.6 m behind the near one (shrunk to
stay in-bounds), yaw colinear on the pair — so the noise floor itself is
taken IN the staged scene. Staging realised as a ~1.6 m near torso filling
the right foreground with the far body partly hidden behind it plus corridor
figures (scene-a-mid.png; vision-ask: "no missing flesh chunks or holes —
smooth shiny surfaces, frame-clipped edges, and occlusion").

| pair | changed px | frac | maxD |
|---|---|---|---|
| noise floor (state-1 vs state-2) | 99 | 0.0206% | 691 |
| a-1 vs b-1 (gate on vs off) | 200 | 0.0417% | 691 |
| a-2 vs b-2 | 125 | 0.0260% | 691 |
| a-1 vs a-2 (same-state) | 94 | 0.0196% | 691 |
| b-1 vs b-2 (same-state) | 88 | 0.0183% | 691 |

maxD 691 in EVERY pair including the floor = the fire flicker, present in
all legs equally. The a/b residual above floor is small and NOT noise:
overlay-ab-vs-floor.png separates pixels that differ only in the a/b pairs
(86/54 px, 0.011%), and the same cell set repeats across the two independent
A/B pairs — deterministic. vision-ask on the overlay: the a/b-only pixels
"lie ON the dark zombie silhouette edges … border the outline of the zombie
bodies, rather than in empty floor or wall space". Reading: at silhouette
EDGE samples the OFF render let the hidden body's shaded fragment bleed into
the per-sample resolve; the gate removes that fragment before it shades, so
the occluded body's sub-pixel fringe resolves to the occluder's color. No
geometry is missing (far body present in both states), no flesh over-
discarded — `bodyEntry` is sound. Occupancy counters: bit-identical on/off
(hits 76314, rasterised 141081) — expected, see the instrument-bias note.
**Verdict: parity PASS** — a-vs-b at the same order as the same-state pairs,
residual confined to hidden-body silhouette fringe.

### Step 3 — rooms 3 and 4 parity with the gate biting (task5b/r3, task5b/r4)

Standard room-centre frozen views, `--on "__sdfGame.setDepthGate(true)"`
`--off "__sdfGame.setDepthGate(false)"`, occupancy after each state.

Room 3 (3 bodies):

| pair | changed px | frac | maxD |
|---|---|---|---|
| noise floor | 63 | 0.0062% | 691 |
| a-1 vs b-1 | 97 | 0.0095% | 691 |
| a-2 vs b-2 | 38 | 0.0037% | 691 |
| a-1 vs a-2 | 4 | 0.0004% | 41 |
| b-1 vs b-2 | 92 | 0.0090% | 691 |

a-vs-b (97/38) sits inside the same-state spread (4–92) and at the floor's
order; the 97-px leg's changed cells are the flicker cells the floor pair
also catches plus one 51-px cell at the HUD corner that does not repeat in
the second A/B pair. Occupancy: bit-identical (hits 77708, rasterised
115134, means equal to 2 dp).

Room 4 (4 bodies, ring sightlines):

| pair | changed px | frac | maxD |
|---|---|---|---|
| noise floor | 120 | 0.0117% | 691 |
| a-1 vs b-1 | 100 | 0.0098% | 691 |
| a-2 vs b-2 | 66 | 0.0064% | 691 |
| a-1 vs a-2 | 102 | 0.0100% | 691 |
| b-1 vs b-2 | 90 | 0.0088% | 691 |

a-vs-b BELOW the floor in both legs. Occupancy: `hits` 89644 and
`rasterised` 166820 bit-identical; `meanStepsMiss` 3.19 (off) → 3.43 (on) —
survivor bias, not a regression: where a NEAR box's mode-4 miss (writing its
give-up depth) used to clobber a farther box's miss counters, the gated far
fragment no longer marches and the nearer survivor's (larger) step count
shows through. Counted miss STEPS are the wrong denominator for this gate;
the deleted work is invisible to the instrument by construction.

### Default

`GAME_DEPTH_GATE` **ships 0** (flipped from the parity verdict after the
bench read below — see Default, revised). The parity evidence made it
CORRECT: steps 2 and 3 passed (a-vs-b at/below noise floor everywhere; hits
identical; deterministic residual confined to sub-pixel fringe on
already-occluded silhouettes). But a perf lever must default to its measured
PERFORMANCE direction, and the bench says the per-body pass structure itself
is a net loss at 3-4 bodies. The seam stays; task 9 re-decides with a quiet
machine and, if it resolves positive at higher body counts, flips back to 1
in game-main.ts.

### Bench (task5b-bench/) — UNRESOLVED spreads, directional read acted on

`BENCH_ROOMS=3,4 BENCH_REPEATS=3 BENCH_LEGS=baseline,depth-gate-off`,
vite 5301 / CDP 9301 (5299/9299 belong to the task-0 worktree's servers —
NOT killed, per the never-kill rule; the port guard only proves the page
loads, not whose build, so a foreign pair must be avoided manually).
Dispatch board: only this task running. Late-run contamination nevertheless:
repeatability spread of the overall median — baseline r3 5% (quiet), r4 18%;
depth-gate-off r3 82%, r4 89% (each off leg's third repeat blew up while
baseline held: e.g. r4 off 9.08 / 14.42 / 17.15).

| leg | room | reps (overall median ms) | spread % |
|---|---|---|---|
| baseline (gate ON) | 3 | 18.65 / 18.55 / 19.41 | 5% |
| baseline (gate ON) | 4 | 16.37 / 15.46 / 18.19 | 18% |
| depth-gate-off | 3 | 11.60 / 12.29 / 21.07 | 82% |
| depth-gate-off | 4 | 9.08 / 14.42 / 17.15 | 89% |

Formally UNRESOLVED by the bench's own rule (delta must exceed each leg's
spread). But the WALK segments tell a directional story the spread does not
cover: baseline walk legs are tight (15.80 / 15.84 / 16.93 r3; 17.60 /
17.46 / 20.49 r4 — 5-17%), and in the run's first two reps (before the
late-run blow-up) the OFF legs pair tightly WITH EACH OTHER and sit ~6-7 ms
BELOW baseline: r3 walk off 9.09 / 8.59 vs on 15.80 / 15.84 (−42%); r4 rep0
10.93 vs 17.60 (−38%). Four independent fresh-page boots agree in direction.
A skip-work change cannot make the OFF state faster — so the ON path's
pass structure COSTS ~6-7 ms/frame at these body counts: each body's
sub-pass pays a full-target blit + a `renderer.render(scene, camera)` call
(scene-graph re-walk; sdf-layer.ts pass-2 loop), ×(bodies+1) per frame,
while the march work it skips (hidden fragments behind nearer bodies —
room views hold 3-4 bodies) is smaller than that overhead. The gate's
target scenario — many bodies sharing a silhouette — is not the 3-4-body
rooms; it may still win there, which only a quiet-machine sweep at higher
census can show.

**Decision recorded above: default 0, bench leg renamed `depth-gate-on`
(applyLeg pins the off state as ship default), task 9 re-takes the A/B**
(`BENCH_LEGS=baseline,depth-gate-on`) and re-decides the default on clean
numbers. Spike pass (baseline only, fenced): r3 p50 32.5 / max 396.8 ms,
r4 p50 23.6 / max 527.1 — the fenced-max protocol, not a gate.
