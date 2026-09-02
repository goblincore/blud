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

## Task 6 — distortion-corrected footprint epsilon, in-march AA on (2026-09-02,
### branch dispatch/2026-09-01-sdf-render-perf-r2-task-6)

**Machine load:** dispatch board checked — only this task holds
`status: running` (0–5b done, 7–9 pending; no other chain). Bench NOT
deferred for load.

**The change.** The fold's argmin already walks every prim of the dominant
group; the packed distortion factor rides the SAME group row (`grp.z`) the
cull multiplies its thresholds by. Three edits, all local:

1. `FOLD_GROUP` tail: `var<private> gFoldBestDistort: f32 = 1.0;` beside
   `gFoldBestIdx`, and the argmin store becomes
   `... gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }`. Private
   global rather than `mapBody`'s `.w` return slot — the wound-pass-r2 chain
   owns that slot for the pre-wound field. Same per-invocation contract as
   the argmin (mapBody resets, foldGroup writes at the argmin, MARCH_BODY
   reads straight after its `mapBody` call).
2. `MAP_BODY`: `gFoldBestDistort = 1.0;` beside the other two resets.
   Returns untouched.
3. `MARCH_BODY`: `let distort = max(gFoldBestDistort, 1.0);` right after the
   loop's `let dres = mapBody(...)`; `let hitEps = max(hitEpsBase, t * aaK)`
   → `... t * aaK / distort);` and the matching inner retract-guard
   `-max(hitEpsBase, t * aaK)` → `-max(hitEpsBase, t * aaK / distort)`.

At `aaCfg.y = 0` the whole term is `t * 0 / distort == t * 0 == +0`, so
`hitEps == hitEpsBase` exactly — the plumbing is bit-invisible until the
knob turns. The volume branch never folds and keeps the 1.0 default.

**Page plumbing (was missing, found while wiring the seam):** the game page
never assigned `aaCfg` at all — it rode the `Vector2(0.02, 0)` uniform
default (lab-main and bench-main have their own per-frame assignment; the
game page is bench-main-derived but that block is inside the aaStrength>0
branch which never ran here). Now: view creation sets
`aaCfg.y = GAME_AA (1.0)` and `aaCfg.x = sdfLayer.pixelConeK` (one-pixel
footprint at the current SDF pass height); `applySdfScale` refreshes
`aaCfg.x` on every view after a rung change re-sizes the pass — the
"confirm that assignment runs on rung change" step found it absent, so it
now does. `__sdfGame.setAa(strength)` / `get aa` seam beside `setOmega`
sets `.y` (and re-pins `.x`) on every view.

**TDD:** new source test in `march.wgsl.test.ts` (pins the private global,
the argmin store, the MAP_BODY reset, the no-`.w`-repurpose tripwire, and
both divide sites); three pre-existing string pins updated to the new
epsilon text. Fast loop 132 pass; `tsc --noEmit` clean.

**Schoolgirl note:** she is NOT on `sdf-game.html` (one compiled
`zombie.blob`, ten bodies), so the 22x sole-plate case cannot be captured
here; the mechanism (divide by the dominant group's `grp.z`) is exercised
by whatever distortion the zombie's groups carry, and the lab owns the
extreme-factor eyeball.

Gates below.

### Gates (run by the task; the far-leg verdict and this write-up by the controller after the run hit its cap)

**Strength-0 parity** (`setAa(0)` both legs — the plumbing must be invisible): room 3 a-vs-b 82 / 110 px against a 104-px noise floor, occupancy bit-identical; room 4 a-vs-b 57 / 103 px against 91 px, occupancy bit-identical (hits 88086, rasterised 172640, steps 6.07 / 3.87). **PASS.** Captures `task6/aa0-r3`, `task6/aa0-r4`.

**Visual gate, near (2 m, room 4, `setAa(0)` vs `setAa(1)`):** a-vs-b 6532 / 6434 px (0.63%) against a noise floor of 8 px; hits 34693 → 35202, mean steps on hits 5.75 → 5.10 (−11%), misses 3.87 → 3.70. Vision read on the side-by-side: PASS (silhouettes smoother, body unchanged). Captures `task6/near2m`.

**Visual gate, far (8 m through the tunnel sightline, room 4, 9 bodies on screen, a slug crater staged on the far body via `fire()` + wound poll):** a-vs-b 6915 / 7038 px against a 104-px noise floor; hits 16023 → 16638 (+3.8% — flesh the smaller epsilon left unresolved at range), mean steps on hits 7.57 → 6.16 (**−18.6%**), misses 12.55 → 11.73. Controller's read of `far8m-ab1-crop.png` (left = AA on, right = off): all nine bodies present on both sides; the crater on the far body reads on both; AA-on silhouettes are slightly smoother at the doorway figures and the near arm; no halo, no shrink, no ghost outline. **PASS.** Captures `task6/far8m`.

**Bench:** not run — **DEFERRED to task 9** (`setAa(0)` lever in the sweep). The step deltas above are the load-immune signal: −11% near, −18.6% far on hit pixels.

**Default:** `GAME_AA = 1.0` ships. Verdict: PASS on all three gates.

## Task 7 — bodies receive the level's shadows (2026-09-02, branch dispatch/2026-09-01-sdf-render-perf-r2-task-7)

Written by the controller from the run's commits and its smoke capture; the run hit its cap while re-running that capture after a fix.

**What landed (3 commits + auto-commit):** `LEVEL_SHADOW` helper (4-tap PCF on a `texture_depth_2d`, normal + depth bias in `levelShadowCfg`), gated into MARCH_BODY's key and specular terms only (`341ecf7`); a level-only twin `SpotLight` (intensity 0, shadow camera on layer 0, posed with the flashlight every frame) and the march binding of its `shadow.map.depthTexture` + `shadow.matrix` (`84457b7`); seam `__sdfGame.setLevelShadow()`, default `GAME_LEVEL_SHADOW = 1.0`. Suite green on the tip (693 webgpu tests), `tsc` clean.

**A real bug found and fixed on the way (`a53161d`):** the first smoke run's pipeline failed to compile because the `texture_depth_2d` parameter was emitted as a `0.0` float literal. Cause: a colon pattern inside the wgslFn signature COMMENT was read by three's WGSL function parser as a phantom input, shifting every later binding by one — `levelShadowTex` landed on a `float(0)`. Fix: comment reworded, plus a regression test that runs three's real parser over the source. Same hazard class as the file header's "each source must begin with fn" and the backtick-in-template trap the run also hit once. Recorded as a warning in memory.

**Smoke capture (room 3 default frozen view, `setLevelShadow(true/false)`, `task7/smoke-r3`):** noise floor 124 px; a-vs-b 519 / 461 px with one hot cell (19,14); same-state pairs 112 / 93 px. Controller's read of the enlarged pair (left ON, right OFF): the near body is pixel-identical — **no acne** — and the far body through the doorway takes a plausible partial shadow from the door frame; nothing missing, no halo. **The planned pillar-between-lamp-and-body staging did NOT run** (out of time), so the shadow-edge read is the owner's: `__sdfGame.setLevelShadow(true/false)` on the test page, standing so a pillar shadows a zombie. Bias knobs live in `levelShadowCfg` (normal bias 0.02 m, depth bias 0.0005).

**Bench:** not run — **DEFERRED to task 9** (`setLevelShadow(false)` lever). Expected cost: one extra 1024² level-only depth pass per frame plus one shadow-map tap per hit pixel.

**Default:** ships 1.0, seam kept. Verdict: landed and compiling; smoke clean; pillar gate pending owner eyeball.

## Task 8 — measure the per-body upload (2026-09-02, branch dispatch/2026-09-01-sdf-render-perf-r2-task-8)

**Step 1 — instrument.** All three `view.update` call sites in `game-actor.ts`
(per-frame `step`, `stampBlast`, `applyProjectileHit`) routed through one timed
wrapper accumulating a module-level `uploadMs` + call counter (module-level on
purpose: all ten actors share it). Exposed as `__sdfGame.uploadMs()` on the
seam, returning `{ ms, calls }` and zeroing — calls so the sampler divides by
real frames, not an assumed 60 Hz. Driver: throwaway CDP probe modeled on
`perf-r2-parity.mjs` (not committed); page booted normally, `setAdaptive(false)`,
`setSdfScale(1.0)`, teleport room 4, NOT frozen (idle wander), 10 bodies
uploading per frame, sampled 1×/s.

**Step 2 — the numbers (machine quiet — this task was the only `status:
running`).** Worktree 5298/9298, headless Chrome, WebGPU resolved:

- Twelve 1 s samples: **0.057–0.123 ms/frame** (all ten uploads summed),
  total 613.1 ms over 9 590 uploads → **0.064 ms/frame average** (~6.4 µs per
  body upload). Frames/s ran ~50 early (bodies off-screen) and dipped to ~26-38
  when the wanderers walked into view — the ms/frame stayed flat across both.
- Per-frame distribution (114 back-to-back reads): min 0.010, **p50 0.060**,
  p90 0.080, **max 0.090 ms/frame**.

That is 3-5× under the plan's 0.3 ms threshold, and it matches the mechanism:
10 bodies × 38 KB RGBA32F = 380 KB/frame ≈ 19 MB/s at 50 fps — packing +
`writeRow` + `needsUpdate` is noise next to one blit. The 116-of-128 wasted
columns cost bytes, not time: the WGSL reads texels by integer `textureLoad`
index and never touches the tail, and the cluster folds early-break on the
live count, so a narrow texture buys upload bytes and nothing else.

**Verdict: measured, not worth it.** Step 2's branch taken — the
instrumentation came back OUT (this commit), the texture stays 128 wide, no
Step 3, no parity gate needed (nothing that renders changed; the instrumented
tree itself never shipped a pixel). `blob:render-check` not run for the same
reason. If a future body ever carries ≫12 prims, re-measure before narrowing:
`MAX_PRIMS` is the allocation width and the pack arrays' size, the shader is
width-agnostic, and a three.js DataTexture cannot be resized in place — any
narrowing must be decided once at view creation.

## Task 9 — bench sweep on a quiet machine (2026-09-02, branch dispatch/2026-09-01-sdf-render-perf-r2-task-9)

Attempt 1 (branch `…-task-9-attempt1`, commit `972522b`) added `BENCH_PRELUDE`
to `scripts/sdf-game-bench.mjs` (one JS expression per invocation, applied
AFTER the leg's ship-default pins, so a prelude always wins; recorded in
results rows and meta) and verified it end to end, then burned its cap on the
full 138-run static matrix. This run cherry-picked `972522b`, merged task 8
(TASKS.md both-blocks conflict kept, as in the blobforge merge), and ran ONLY
the targeted sweep: `BENCH_LEGS=baseline BENCH_ROOMS=3,4 BENCH_REPEATS=3`
(6 runs + spike per invocation, ~90 s each), one lever per invocation via
`BENCH_PRELUDE`, so every delta shares the session. Own servers 5297/9297.

**Machine honesty.** NOT quiet in the task-0 sense. At start the stale
headless Chromes/Vites were gone, but the 1-min load oscillated 4→23 through
the sweep: Slack's startup burst (~40% combined) at inv2-3, then at 12:15 the
user opened Xcode (fseventsd 122%, git scanner 65%) and ran LearnCard builds
(`rollup -c` 190%, `tsc` 204%, `vite build` 145% — not dispatch tasks, user
activity in another project). Load is recorded next to every row below; each
table is judged by its OWN repeat spread per the standing rule.

### The sweep (all on the finished chain, ship defaults unless stated)

| inv | prelude | r3 p50 (reps) | r4 p50 (reps) | worst spread | load @start |
| --- | --- | --- | --- | ---: | --- |
| 1 | none — finished chain | **9.85** (9.85/10.29/9.73) | **7.85** (7.85/8.46/7.77) | 9% | 4.40 |
| 2 | `setOmega(0.6)` (t2 lever OFF) | 10.55 (11.02/10.55/10.52) | 9.33 (9.70/9.24/9.33) | 5% | 23.47 |
| 3 | `setWoundEarlyOut(false)` (t3 OFF) | 9.88 (9.88/9.94/9.51) | 7.90 (8.17/7.79/7.90) | 5% | 21.52 |
| 4 | `setDepthGate(true)` (t5/5b ON) | 14.63 (14.64/14.63/14.55) | 12.48 (12.76/12.09/12.48) | 6% | 6.05 |
| 5 | `setAa(0)` (t6 OFF) | 9.91 (9.85/9.91/11.84) | 8.47 (8.24/8.47/8.75) | 20% (inv5 r3 rep2 caught a burst) | 4.20 |
| 6 | `setLevelShadow(false)` (t7 OFF) | **INVALID — 211% spread, re-run pending** | **INVALID** | 211% | 6.32 |
| 7 | `setHullExitBound(true)` (t1 ON, for the record) | pending | pending | — | — |

Census healthy in every kept run (r3: 8 bodies, 0→20 wounds; r4: 9→4 bodies,
wounds + chunks) — the per-run reload is doing its job; no leg timed an empty
room.

### Verdicts so far

- **inv2 (omega 0.6 vs ship 1.0): ship default CONFIRMED.** Turning plain
  sphere tracing off costs +0.70 ms r3 / +1.48 ms r4 — every delta ≫ the 5%
  spreads, and r4's is 2× the inv1 spread. Task 2's lever earns its default.
- **inv3 (wound early-out off): ship default CONFIRMED.** +0.03 ms r3 /
  +0.05 ms r4 — at 20 wounds the early-out is worth ~0 on this hardware, but
  it is free, never loses, and its parity passed; ships on.
- **inv4 (depth gate ON): ship-off CONFIRMED, decisively.** +4.78 ms r3 /
  +4.63 ms r4 at 6% spread. Reproduces task 5b's ~6-7 ms pass-structure loss
  almost exactly — the sub-pass blits + scene walks dominate any march-step
  saving at 3-4 bodies. `GAME_DEPTH_GATE` stays 0; the decision rule ("flip
  to 1 only if inv4 beats inv1 in r4 by more than the larger spread") does
  not come close — inv4 LOSES by 4.63 ms against a 0.69 ms spread.
- **inv5 (AA off): ships ON, cost ≈ noise-to-marginal.** r3 unresolved
  (−0.06 ms under a 20% spread); r4 −0.62 ms is at/just over the clean-rep
  spread (~6-9%). The in-march AA costs ≲0.6 ms/frame in the densest room
  for footprint-correct silhouettes — the task-6 trade stands.

### inv6 re-run (12:42, load 20 but IO-wait — CPU 80% idle) and inv7

The first inv6 (12:15, spread 211%, 10.72→12.81→28.40 escalating across
repeats) coincided with fseventsd at 122% + Xcode's git scanner — discarded.
The re-run at load 20 came back CLEAN at 7% spread, confirming the 2026-08-31
lesson: what poisons the bench is CPU-saturating churn (a build, fseventsd),
not IO-wait load average.

| inv | prelude | r3 p50 (reps) | r4 p50 (reps) | worst spread | load @start |
| --- | --- | --- | --- | ---: | --- |
| 6b | `setLevelShadow(false)` (t7 OFF) | 9.90 (9.90/10.37/9.70) | 8.55 (8.95/8.55/8.41) | 7% | 20.08 (IO-wait) |
| 7 | `setHullExitBound(true)` (t1 ON, record only) | 10.07 (12.42/9.74/10.07) | 7.57 (7.57/7.50/7.80) | 28% (r3 rep0 caught the decay) | 7.15 |

- **inv6b (level shadows off): ships ON; cost ≈ 0 r3, ~0.7 ms r4.** r3
  +0.05 ms = nothing; r4 +0.70 ms is at the spread floor (inv1 r4 spread was
  0.69 ms) — call it marginal. The twin-light depth pass + 4-tap PCF is
  nearly free at these body counts. The owner's pillar eyeball gate is still
  open; perf gives it no reason to revert.
- **inv7 (hull exit bound): the census is the verdict, as in task 1c.**
  Room 4 fire segment: bodies 9→4 — the exit bound DELETED four of nine
  bodies mid-run, and room-3 wounds landed 16 vs baseline's 20 (bullets
  whiffing against clipped bodies). The −0.28 ms r4 "win" is bought by
  rendering half the room; the r3 delta is noise under a 28% spread. Never
  ships; the perfCfg.x path stays for diagnostics only.

### Occupancy counters on the finished chain (12:50, driver
`/tmp/perf-r2-occupancy-task9.mjs` — attempt 1's update of the task-0
driver: occluder read-back instead of pinned OFF, full round-2 state
readback)

State read back off the live seams: shell ON (732 instances, not
overflowed), cone OFF, fxaa ON, relax 1.0 (omega 1.0 — read, not pinned:
ship), woundEarlyOut ON, aa 1.0, levelShadow ON, depthGate OFF,
hullExitBound OFF, halfRate OFF, scale pinned 1.0, adaptive pinned OFF,
target 800x600, backend webgpu. **Occluder reads FALSE and that is ship
truth:** the game page boots `sdfLayer.setOccluderEnabled(false)` (round 1
killed the clamp; the pass is diagnostics-only), while the bench's applyLeg
pins `setOccluder(true)` on every leg — a constant additive cost across all
seven invocations, so every delta above is unaffected. The occupancy read
itself follows the task-0 protocol (occluder OFF), so the rows below are
comparable to task 0's table.

| room | rasterised | hits | misses | occupancy | missStepShare | mean steps hit / miss | bodies | vs task 0 (omega 0.6) |
|---|---:|---:|---:|---:|---:|---|---:|---|
| 3 | 112035 | 74526 | 37509 | 66.5% | 56.9% | 5.9 / 15.4 | 3 | steps hit 10.6→5.9, miss 24.7→15.4; occ 66.0→66.5% |
| 4 | 178216 | 87189 | 91027 | 48.9% | 38.3% | 5.9 / 3.5 | 4 | steps hit 10.4→5.9, miss 5.2→3.5; occ 46.4→48.9% |

Both frozen-scene double reads bit-identical in both rooms (deterministic at
a pinned state, as in task 0). Coverage is unchanged (same hulls, same
wandered poses within noise) — what moved is STEPS: plain sphere tracing
(task 2) plus the AA footprint exit (task 6) cut mean hit steps ~44% and
miss steps 33-38%. Total march steps per frame: room 3 ≈1.01M vs 1.72M
(−41%), room 4 ≈0.83M vs 1.34M (−38%). Miss share of steps rose a point or
two (54.5→56.9%, 36.5→38.3%) only because hit steps fell even faster — the
miss market the shell already shrank did not grow. No lever left on the
table here matches the depth gate's fantasy: the remaining cost is hit-pixel
march + fill, which is what the shell/AA work already minimized.

### Sweep coverage of deferred benches

Tasks 1-8's timed steps that this sweep now covers, one lever per
invocation on the finished chain: task 1 (inv7, hull exit bound — confirms
1c's rejection), task 2 (inv2, omega), task 3 (inv3, wound early-out),
tasks 5/5b (inv4, depth gate — re-decided OFF), task 6 (inv5, AA), task 7
(inv6b, level shadow). Task 8 needed no bench here (its own measurement was
taken quiet: 0.06 ms/frame). Task 4's specialiser retirement changed no
runtime default (build-time only) — nothing to re-bench. Task 1c's ship
decision is untouched by inv7's confirmation.

**Verdict: every ship default of the finished chain survives its lever-off
re-run; the depth gate re-decision lands OFF (inv4 loses by 4.63 ms against
a 0.69 ms spread); hull exit bound stays dead by census, not by timer.**
