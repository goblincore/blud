# Deterministic demo recordings — the game bench, made repeatable

**Ask (owner, 2026-09-10):** Quake-1-style demo recordings, so a run can be
replayed instead of re-performed. "We're not that far off, we just have to fix a
few things." This plan says how far off, and sequences the fixes.

## Why this is worth doing now, in evidence

Repeatability is the binding constraint on every perf decision in this project,
and it has cost real work:

- **Three of six bench sessions this week were unusable.** Worst repeat spreads:
  116%, 116%, 187%, against 19%/23% and 1% on quiet windows. The 2026-08-31 note
  already warned about this and it keeps happening.
- **Even on a quiet machine the WORKLOAD differs between legs**, which no amount
  of machine-quiet fixes. The bench's own census proves it across identical legs
  of runs taken minutes apart:
  - room 4 `fire`: bodies `4→4` in one run, `4→2` in another
  - room 4 `fire`: droplets `0→69` in one run, `0→222` in another
  - room 3 `fire`: goo quads `0→272` vs `0→289` vs `0→406`

  Every one of those is a different amount of work in the same "identical" leg.
  A delta measured across them is measuring the scenario, not the change.
- **And it would unblock the thing this session could not do at all:** three
  shader changes are committed on `claude/sdf-march-perf-518bcc` whose WGSL
  transcription is UNVERIFIED, because verifying it needs either a quiet machine
  plus the owner's eyes, or a GPU parity check that does not exist yet. The
  capsule cull, the any-hit shadow rewrite and the box-first reorder are proven
  only at the CPU-twin level.

## What already exists (more than expected)

- **`game-bench-scenario.ts` is already a demo format.** Its own header: *"The
  scripted firefight, as DATA. Pure on purpose… every frame belongs to a
  segment; no shot is fired without a surface aim."* Steps are
  `{teleport, room}`, `{fire, barrels}`, `{fireSlug}`, anchored to frame ranges.
  That is a `.dem` minus serialization and a seed.
- **A seeded RNG stream is already the house pattern.** `mulberry32` is imported
  and used as `const rng = mulberry32(nextSeed++)` — a deterministic counter —
  feeding the gore path, and `bleedRng` is shared deliberately so
  `setBleed(false)` freezes gouts.
- **The timestep is already fixed and explicit.** `tick(dt)` takes dt with no
  internal clock read, and `step(n, dt = 1/60)` already steps a fixed 1/60; the
  bench has been fixed-step all along.
- **Determinism machinery already exists where someone hit this before:**
  `simLocked` (render lock) stops all mutation; `setLightClockFrozen` exists
  specifically so two renders of the same instant match; `pinnedReloadSeed`
  already overrides the reload seed; `autopilot` already provides scripted
  movement.

## The gaps, exactly

1. **Gameplay-path `Math.random()`** — 28 sites in non-test sources. Only a few
   matter: `reloadSeed` (no `pinnedReloadSeed` given) and the muzzle-flash
   rotation/texture/puff offsets (`game-main.ts:3359-3380`). Visual, EXCEPT the
   puff offsets can move light positions, which changes the gather.
2. **Wall-clock cull dwell — the important one.** `updateVisibleActors` uses
   `performance.now()` for `lastSeenMs` / `CULL_DWELL_MS`, and that decision
   chooses which bodies are DRAWN. This is the most likely single cause of the
   census drift above, i.e. of workload variance between legs.
3. **`view.setTime(performance.now() / 1000)`** (`game-main.ts:4375`) — render-side
   animation/wind phase, so it changes pixels but not sim state. Must be frozen
   for a frame hash, like the light clock already is.
4. **The chunk-bake worker is async** — its swap lands on whichever frame it
   finishes, which is why `cpu:phase:chunk-bake-swap` flickers in and out of the
   bench tables. Pin it to a recorded frame index.
5. **Nothing serializes or compares a replay.** No format, no hash, no tool.

## Staged plan

### Stage 1 — make the sim a pure function of (seed, inputs, fixed dt)

Small, and it is what fixes the workload drift in every perf A/B, so it pays
for itself immediately.

- `src/lab/sdf-zombie/webgpu/rng.ts`: one named seeded stream per subsystem
  (`bleedRng` already exists; add `fxRng`, `reloadRng`), each created from a
  single demo seed. Replace the gameplay-path `Math.random()` sites.
- **Cull dwell on SIM TIME, not wall time.** Accumulate `simTime += dt` in
  `tick` and use it for `lastSeenMs`. In real play `dt ≈ wall elapsed` so the
  dwell behaviour is unchanged; under fixed-step replay it becomes exact. This
  is the change that makes the census stable.
- Drive `view.setTime` from `simTime` (it is animation phase, not physics).
- Make the chunk-bake swap land on a recorded frame index.

**Verification:** run the same scenario twice with the same seed and diff the
per-frame census (`bodies`/`wounds`/`droplets`/`goo quads`). It should be
IDENTICAL. That is a cheap, GPU-free-ish assertion and it is the gate for this
stage.

### Stage 2 — the frame hash (the parity gate)

The highest-value stage for this project, because it converts "needs a quiet
machine and the owner's eyes" into "compare a number".

- A `demohash` mode: replay a scenario, read back the composited frame (or the
  fixture's capture region), hash it, emit one line per frame.
- A comparison script: two hashes, first divergent frame, and a per-region
  difference count so a real change is distinguishable from a deliberate one.

**What this buys immediately:** `probe-dynamic-cull.test.ts` proves the CPU twin.
A frame hash would prove the WGSL transcription of the same maths — the exact gap
in this branch's three shader commits. And it belongs in CI as a regression gate.

### Stage 3 — serialization

- A `.dem` file: `{ seed, scenarioName, initialWorldState, inputFrames[], dt }`,
  recorded from a live session and replayed headless.
- Recording inputs only (not state) is the Quake model and is what keeps the file
  small; it requires Stage 1 to be complete, because any wall-clock read or
  unseeded RNG diverges instead of erroring.

## The gate has a tool now, and it already fails

`scripts/census-diff.mjs` reads stored `bench.json` / `passes.json` files, groups
the repeats of each (leg, room), and reports every census field whose value is
not the same in every repeat. It compares EVERY field present rather than a
hardcoded list, so a field added to the bench later is covered automatically.
Exit code 1 on any drift, so it can gate a script.

```
node scripts/census-diff.mjs <bench.json> [more.json ...]
```

Run against the two runs already committed in
`docs/dev-notes/2026-09-10-probe-gather-cost/` — both taken on reasonably quiet
machines, both with the scenario scripted — it reports **12 drifted fields**.
These are WITHIN a single run, across repeats of the same scripted leg, so they
are NOT machine noise. The workload genuinely differed:

| leg/room | field | rep0 | rep1 | rep2 |
| --- | --- | ---: | ---: | ---: |
| room 4 `fire` | `bodies` (last) | 2 | 4 | 3 |
| room 4 `fire` | `droplets` (last) | **222** | 74 | 53 |
| room 4 `fire` | `gooQuads` (last) | 406 | 296 | 282 |
| room 3 `fire` | `droplets` (last) | 30 | 67 | 65 |

So the same "identical" leg ran with a **4x spread in droplets** and a different
number of bodies on screen. Any millisecond delta measured against those is
measuring the scenario. **This is the concrete justification for stage 1**, and
it is a cheaper, harder piece of evidence than the repeat-spread percentages,
because it isolates the workload from the machine.

Once stage 1 lands, this tool is the gate: the census must be IDENTICAL across
repeats, and `census-diff.mjs` exits non-zero until it is.

## Payoff, stated honestly

**What it fixes:** workload repeatability (the census drift), and verification of
shader changes without a quiet machine or a human. It also makes documented
bench numbers re-derivable, which is currently impossible.

**What it does NOT fix:** wall-clock TIMING noise from machine load. A
millisecond A/B still needs a quiet machine. Determinism makes both legs do the
same *work*; it cannot make the GPU run at the same speed. Do not expect it to
replace the Repeatability discipline — they are complementary.

**Same-machine only.** Hashes will not survive a different GPU or driver, and
should not be expected to. Parity is a same-build, same-machine comparison.

**One design consequence worth banking:** this is an argument for the
gather's **two-dispatch** reduction (one thread per (probe, ray) writing a ray
buffer, then a per-probe pass summing in INDEX ORDER) over a `subgroupAdd` or
atomic reduction. Fixed summation order keeps the result bit-stable, so the hash
still matches. WebGPU has no `f32` atomics anyway.

## Do not break

- Do not make the hash a gate on anything that is legitimately allowed to vary
  (the interlaced field's parity, the probe gather's `frameSeed`, the flicker
  clock) without freezing those first via the existing switches.
- Do not let a "deterministic" mode silently change the shipped defaults. Every
  seam here should be inert unless a demo is being recorded or replayed.
