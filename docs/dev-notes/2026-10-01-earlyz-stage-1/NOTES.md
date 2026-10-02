# Early-Z stage 1 — results of record (2026-10-01)

Plan: `docs/superpowers/plans/2026-10-01-sdf-march-early-z-stage-1.md` · Spec: `docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md`

## Baselines (before Task 1)

Recorded at base commit `c484305c` (clean tree, branch `claude/sdf-rendering-dream-techniques-f29768`), no stage-1 code yet.

- `npm test -- march-golden crowd-type game-context`: 5 files, 49 tests — **48 passed, 1 failed (pre-existing)**.
  - `march-golden.test.ts` 2/2 pass
  - `crowd-type.test.ts` 11/11 pass
  - `game-context.test.ts` 3/3 pass
  - `scripts/game-context-codemod.test.ts` 29/29 pass
  - `scripts/game-context-coverage.test.ts` 3/4 pass. **Pre-existing failure, not caused by this plan:**
    `binding maps > leaves ctx as the only state binding in main()` expects `['ctx']` and gets
    `['ctx', 'actorFill', 'fleshSpawnRng']`. Both bindings are already in committed `game-main.ts`
    (`const actorFill = new WeakMap(...)` ~L2627, `const fleshSpawnRng = mulberry32(...)` ~L5408). Later tasks
    must hold this at exactly this one failure with exactly these two extra names, and must not add a third.
- `node scripts/march-hash.mjs` (default mode, run inside `lab-servers`, load average 2.9 at start): **PASS**, exit 0, first run.
  The script prints no PASS word. It calls `fail()` and exits non-zero on any mismatch, so exit 0 with `room1`
  equal to the pinned `DEFAULT_HASH` is the pass.

  ```
  {"room1":"d7392d5234c98ddc1babb3b29860abc3a02ced84","room1-repeat":"d7392d5234c98ddc1babb3b29860abc3a02ced84","room1-wounded":"76bd51aa6eb281297999463529a0b782ce2b67f6"}
  ```

## Smoke (Task 11)

`scripts/earlyz-run.sh smoke` (`LAB_TMP=.lab-tmp`, headless Chrome on the owner's Mac, Metal). Branch head `2e1f0c4a`.
The smoke boots `sdf-game.html?frozen=1&earlyz=1`, waits for the loader gate and the background crowd job, stages
`STAGES.pack` (6 zombies 0.7 m apart, ~3.5 m ahead, room-1 near corner), steps 6 frames, reads `earlyzInfo()`. A second
boot on the same tab (`?frozen=1`, flag off) stages the same pack and checks the shipped boot. A second CDP client on the
tab collects the console (`$LAB_TMP/earlyz-smoke-<phase>.console.log`).

**Result: all six flag-on checks PASS and all five flag-off checks PASS, exit 0, on the first run.** No code fix was needed.
Two runs, identical verdicts and identical `earlyzInfo` / `crowdInfo`.

| Run | `uptime` load at start | on: page ready (gate + crowd job) | on: crowd job done | off: page ready | off: crowd job done |
| --- | --- | --- | --- | --- | --- |
| 1 (cold) | 2.36 2.97 3.20 | 27.6 s | 25.5 s | 5.0 s | 3.3 s |
| 2 (warm) | 2.63 2.96 3.19 | 5.9 s | 4.1 s | 4.5 s | 3.3 s |

The cold cost of the new front-face crowd program is **~22 s, paid in the background crowd job after `ready`**, not
behind the loader: `drawOnce` was 1659 ms (run 1, on), 1613 ms (run 2, on), 1592 / 1583 ms (off). This is a
smoke observation, not the boot-time gate against the base branch (fresh Chrome profile per run, but the shipped
programs were already in the machine-global shader cache: the off-phase crowd job took 3.3 s in both runs).

```
earlyzInfo {"flag":true,"on":true,"reason":null,"gpuErrors":[],"patchHits":20,"seed":{"built":true,"on":true,"reason":null},"batches":{"soldier@1":{"front":1,"back":0},"zombie@2":{"front":2,"back":0},"zombie@3":{"front":0,"back":0},"zombie@4":{"front":1,"back":0},"juggernaut@6":{"front":0,"back":0},"warbull@6":{"front":0,"back":0},"zombie@6":{"front":0,"back":0},"soldier@5":{"front":0,"back":0},"zombie@5":{"front":0,"back":0},"zombie@1":{"front":6,"back":0}}}
PASS  [on] flag on
PASS  [on] patched + detected
PASS  [on] patch emitted frag_depth greater
PASS  [on] seed drew
PASS  [on] a front batch drew
PASS  [on] no uncaptured GPU errors
```

Flag off (same page, second boot):

```
earlyzInfo {"flag":false,"on":false,"reason":null,"gpuErrors":[],"patchHits":0,"seed":{"built":false,"on":false,"reason":"not requested"},"batches":{ ...every type {"front":0,"back":0} }}
PASS  [off] flag off
PASS  [off] earlyz not on
PASS  [off] no front batch (every type front === 0)
PASS  [off] no seed built
PASS  [off] patch never emitted
```

- **crowdInfo** (both phases identical): crowd on, `boxes` dispatch, tiles on, no fallback. Visible types:
  `zombie@1` 6/6 at mean 3.46 m (the pack), `soldier@1` 1 at 4.84 m, `zombie@2` 2 at 12.65 m, `zombie@4` 1 at
  13.93 m. Camera `[-8.2, 0, -8.2]`, yaw 3π/4. Every drawn body landed in `front` (none in `back`): the camera is
  outside every proxy box, as the pack scene intends. `STAGES.melee` is the `back` case; the smoke does not run it.
- `patchHits` 20 counts `getFragDepth` calls answered with `frag_depth, greater` (calls, not shaders).
- **Console.** The flag-on boot logs `[earlyz] on: front-face crowd proxies + frag_depth greater + level-depth seed`
  and no `[earlyz]` warning. Every other warning is in BOTH phases, so none is the flag's: the
  `flaregun-placeholder.glb` fallback (a dev placeholder absent in this worktree; its network 404 is logged only on
  the first boot of the tab), Dawn's
  `Draw with an index count of 0 is unusual`, and three's `Unable to serialize Texture` (44x on, 26x off; the
  extra 18 under the flag were not traced).
- **An informal look, not the parity gate.** One extra pair of screenshots (`?seed=7&loader=0`, pack, 30 frames)
  on vs off: the same six bodies and the soldier behind them, no body missing or clipped. Viewport crop
  mean abs diff 1.5 / 255, 0.8 % of pixels differ by more than 15, mean luminance 52.69 vs 52.47. `earlyz-parity.mjs`
  is the measurement; these are two separate boots with only the seed pinned, so this pair is not a parity number.
