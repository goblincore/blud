# march-hash is bistable across boots — evidence, 2026-09-20

## What happened

The leaves wave-1 agent reported the gate as cross-boot nondeterministic AT BASE
and was told otherwise: on 2026-09-19 every isolated run of every commit gave the
canonical line, and the non-canonical values it saw coincided with a window where
two headless captures shared the GPU. That correction (appended to
`docs/dev-notes/2026-09-19-game-main-leaves-1/NOTES.md`) is **WRONG** and this
note supersedes it. The agent's original reading was right.

## The decisive run

`e3077f7c` — the exact commit that produced the canonical line 3/3 on
2026-09-19, run alone — on 2026-09-20, alone, nothing else capturing
(`ps` for `--remote-debugging-port=93xx` = 0):

```
run A  room1 ce7045ac…  repeat ce7045ac…  wounded c27e8b49…
run B  room1 9871c2c2…  repeat ce7045ac…   -> "not deterministic within boot"
```

Same code, same machine, different day. So the hash depends on machine/session
state, not on the commit, and NO commit-to-commit comparison through this gate
is trustworthy until that state is identified.

## Values seen so far

`8f2b74e7…` (the pin), `ce7045ac…`, `9871c2c2…`, `b6422b41…`, and with the
dynamic probe layer disabled a further `7f6af545…`, `68a4b602…`, `2c6161db…`.
The wounded field moves with room1 (`1381a866…` vs `c27e8b49…`), so whatever
varies is upstream of the wound stamp. **room2 is stable** at
`35b6d561…` across every run of both days.

## Ruled out

- **Concurrent captures.** The values reproduce with nothing else running.
- **This week's refactors.** `e3077f7c` predates all of them.
- **The dynamic probe gather** (the `gatherTick`-phase bug class that
  `sdf-demo-hash` hit, and a plausible suspect since the staging never resets
  that phase): forcing `setProbeDynamic(0, 0)` in the staging did NOT collapse
  the values — it produced a new set, still varying per boot.
- **Interlaced fields**, already pinned off by the script itself (its header
  documents the earlier bimodality this is NOT).

## Where to look next (ANSWERED — see RESOLVED below)

room2 being stable while room1 is not is the strongest clue: whatever varies is
in room1's scene or its staging, not in the march itself. Candidates, cheapest
first: the temporal-reprojection start layer (state depends on how many frames
have been dispatched — the script's own header flags this reasoning for
`upscale-parity`), the static probe warm state, wall-clock-driven wind drift
(`gWindDrift`, read by `sdShell` on every `mapBody`), and the adaptive-resolution
rung. A capture of the scene's uniforms at hash time, diffed between two boots
that disagree, should name it in one run. (It did — and it was none of these;
the dump pointed at the staged CAMERA, i.e. the coverage search's rung pick.)

## Consequence

`scripts/march-hash.mjs` is currently a **liveness** check, not a regression
gate: a green run proves the pipeline renders, a red one proves nothing. Phase 2
of the march refactor is gated on this hash, so fixing it is TASK 0 of that plan
(`docs/superpowers/plans/2026-09-20-march-phase-2.md`). Until then, behaviour
claims for march work need another instrument (room2, or a per-uniform dump).

---

# RESOLVED (2026-09-20, task 0) — the cause, the fix, the proof

Everything above this line is the historical record; this section supersedes it.
The consequence paragraph no longer holds: the gate is a regression gate again.

## Reproducer (Step 1)

A concurrent full `npx vitest run` reproduces it on demand. The gate gave
canonical `8f2b74e7…` at loadavg ~3–8 and flipped to `ce7045ac…` / `9871c2c2…` /
`b6422b41…` at loadavg ~10–16 — the same value set as the spontaneous flips.
It does NOT reproduce against a FINISHED vitest run or a declining load
average; the load must be live during the boot window.

## The varying input, NAMED (Step 2)

**The coverage search staged a DIFFERENT LADDER RUNG.** Not a uniform, not
temporal state, not the probe gather.

The instrument: `MARCH_HASH_DUMP=<path>` in `scripts/march-hash.mjs` (kept —
useful later) snapshots, at hash time: camera/projection matrices, per-piece
march uniforms + in-page FNV of each dataTexture/records array, actor poses,
probe-gather census (`__sdfGame.probeDynamic`), `levelProbes` per-room probe
cfg, the warm phase record, and the march target's rSum/nonZero. Diff of a
canonical boot vs a `ce7045ac…` boot:

- ALL per-piece data/records/uniform hashes: **identical** — actors, march
  material state and every AI position were bit-equal across boots; `frames`
  and gather-frame counters both 0 (irrelevant).
- camera matrixWorld: canonical staged rung **d=0.7** (camera z = −4.8 + 0.7
  = −4.1); the bad boot staged rung **d=1.6** (camera z = −3.2) — the FIRST
  rung of `CLOSEUP_LADDER`.

A different rung is a different pose, hence a completely different march image —
which is why the wounded field moved with room1 and why every temporal-state
suspect was a dead end. room2 stayed stable because its crowd scene's coverage
margin is wide enough that the same race never flipped ITS argmax.

**Mechanism.** `stageCloseUp` picks the rung by coverage from
`__sdfGame.occupancy()`, which dispatches one frame (`step(1/60)`) and reads
the march target back. Under CPU load, three's asynchronous render submission
can DEFER that frame past the readback, which then returns the last content
that actually LANDED — at boot, an all-zero target. Coverage reads 0 for every
rung, `cov > best.cov` never fires, the first rung wins by default. Measured
under live vitest load with a census probe — every rung read
`{"hits":0,"rasterised":0,"cov":0}`; the same probe with wait-and-retry reads
went live within ~1.5 s per rung and then matched the idle census
byte-for-byte (d=0.7: hits 132177, rasterised 168052). The census VALUES were
never the varying part — only their LIVENESS was. This also explains why
`setProbeDynamic(0,0)`, seeds and tiles changed the value set without
collapsing it: they perturb the hashed image, not the race.

The zero readback is possible because `resolveGpu()` (lab-renderer.ts) fences
timestamp queries only — `resolveTimestampsAsync()` — not the frame's render:
a readback can overtake a render that is deferred on the CPU side (async
pipeline work), though never one already submitted to the queue.

## The fix (Step 3) — in the staging, not the pin

Commit `ea1ccd83`: `scripts/lib/sdf-closeup-stage.mjs` + `scripts/march-hash.mjs`.

1. **Settled occupancy census** (`stageCloseUp`): each rung reads until two
   consecutive `occupancy()` reads AGREE and are live (`rasterised > 0`),
   250 ms apart so a just-submitted frame can land between them; 30-try cap,
   then a loud error.
2. **Settled march target before the first capture**: `hashMarchTarget()`
   (consumes no frames, so the read-parity contract is untouched) must be live
   (`nonZero > 0`) and STABLE across a 250 ms gap; instability means a deferred
   render just landed, so keep waiting (40-try cap, then FAIL).
3. **Same settle, plus distinct-from-room1, before the wounded capture** — a
   stale pre-wound frame would otherwise fail the wound-visibility check
   spuriously.
4. **`capture()` retries an all-zero readback** — the same deferred-render
   signature — re-running the whole two-read pair each attempt so the
   read-parity contract is preserved whatever the retry count.

Why this is the regime the march work is consumed in: the gate must hash the
frame it actually STAGED — the settled, converged render — never whichever
frame happened to land first. This is the settling discipline the fields-off
pin already embodied, applied to liveness instead of scene state. No pin was
moved and no comparison loosened; the canonical values are unchanged.

## Repeat evidence (Step 4)

All through the fixed gate (`ea1ccd83`), on this machine:

- **HEAD `ea1ccd83`, 10/10 boots identical**: room1 = `8f2b74e7…`,
  room1-wounded = `1381a866…` every time. Boots 1–3 idle; boots 4–10 under a
  live `npx vitest run`, loadavg 4.6 → 16.2 (7 boots under load, ≥3 required).
  One infra failure inside boot 3 (CDP websocket closed — page gone, the known
  shader-compile-stall crash class) — retried clean, not a hash mismatch.
- **`e3077f7c`, 5/5 boots identical**: same `8f2b74e7…` / `1381a866…` (game
  code at `e3077f7c`, gate scripts from the fix commit).
- **room2** (`MARCH_HASH_ROOM=2 MARCH_HASH_TILES=0`): `35b6d561…`, unchanged,
  now through the fixed staging.
- **The pin does NOT move**: `e3077f7c` and HEAD both give `8f2b74e7…` with
  both numbers recorded here; the commits between are the verbatim seam
  extractions, and the gate now confirms they are pixel-neutral.
- Full vitest suite after the change: 15 failures = the base failure SET
  (`game-actor-torso-slug` ×2, `march-step-soundness`, `surface-nets-cpu`,
  `blob-measure`, the blob/skeleton set). `npx tsc --noEmit` clean;
  `sdf-closeup-stage` tests 7/7.

## For TASKS.md (owner to carry over — not edited there, another session owns it)

- march phase 2 Task 0 is DONE at `ea1ccd83` on
  `dispatch/2026-09-20-march-hash-settle`: gate fixed in the staging, pin
  unchanged, 10/10 + 5/5 evidence above. Tasks 1–6 can start; their "pixel
  gate" rows should quote room1 AND room2 as the plan already specifies.
- The gate is slower by design now (~+3 s: the settle reads); it is a gate,
  not a benchmark.
- If a boot dies with `CDP websocket closed — page gone`, that is the known
  shader-compile-stall crash, not the gate: rerun.
- `MARCH_HASH_DUMP=<path>` remains available for future state-at-hash-time
  diffs; it names staging divergences in one run.
