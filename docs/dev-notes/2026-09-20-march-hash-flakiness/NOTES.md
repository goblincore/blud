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

## Where to look next

room2 being stable while room1 is not is the strongest clue: whatever varies is
in room1's scene or its staging, not in the march itself. Candidates, cheapest
first: the temporal-reprojection start layer (state depends on how many frames
have been dispatched — the script's own header flags this reasoning for
`upscale-parity`), the static probe warm state, wall-clock-driven wind drift
(`gWindDrift`, read by `sdShell` on every `mapBody`), and the adaptive-resolution
rung. A capture of the scene's uniforms at hash time, diffed between two boots
that disagree, should name it in one run.

## Consequence

`scripts/march-hash.mjs` is currently a **liveness** check, not a regression
gate: a green run proves the pipeline renders, a red one proves nothing. Phase 2
of the march refactor is gated on this hash, so fixing it is TASK 0 of that plan
(`docs/superpowers/plans/2026-09-20-march-phase-2.md`). Until then, behaviour
claims for march work need another instrument (room2, or a per-uniform dump).

## Later the same day: 10/10 canonical on an idle machine

After the investigation above, ten consecutive runs on HEAD were canonical:
five with `MARCH_HASH_TILES=0` and five without, interleaved, in one session,
with nothing else running. Also ruled out in that session:

- **`?seed=`** — the page picks a random demo seed when the query is absent
  (`Date.now() & 0x7fffffff`, game-main ~437), which looked like the obvious
  culprit. It is not: `seed=1`, `seed=2`, `seed=7` and a no-op `nonce=` all give
  the SAME canonical hash, so the seeded streams do not reach the staged frame.
- **`MARCH_HASH_TILES=0` vs unset** — identical staging (the script only calls
  `setTiles` when `TILES === '1'`); the variable changes the pin CHECK, not the
  scene.

So the earlier non-canonical runs were not caused by the commit, the seed, or
the tiles flag. What they DID share is timing: they were taken immediately after
a full `vitest` run, while the machine was still busy. That reinstates *load*
as the correlate — not "another capture stole the GPU" as first claimed, but
"under load the capture reads a frame the staging has not actually settled".
That is the hypothesis the fix task tests; it is a hypothesis, not a conclusion.
