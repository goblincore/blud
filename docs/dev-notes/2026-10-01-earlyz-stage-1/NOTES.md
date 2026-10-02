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

`scripts/earlyz-run.sh smoke` (`LAB_TMP=.lab-tmp`, headless Chrome on the owner's Mac, Metal). Two boots on one tab, the
pack staged in each (`STAGES.pack`: 6 zombies 0.7 m apart, mean 3.46 m ahead, from the ring's room-1 near corner):

- **off first** (`?frozen=1`): the shipped boot. It also records the GPU baseline that the flag-on boot is held to.
- **then on** (`?frozen=1&earlyz=1`): the plan's checks, the same GPU baseline, then `STAGES.melee` on the same page.
  A melee staging failure is recorded as a failed `melee staged` check, and the flag-on checks still report.

A second CDP client on the tab collects the console (`$LAB_TMP/earlyz-smoke-<phase>.console.log`). The run is bounded:
a 45-minute watchdog, `fail()` waits at most 10 s for its diagnostic read, and `connectGame`'s `send` now rejects at
once on a closed socket (it used to hang forever). `--on` / `--off` runs one phase.

**Result of record (second review follow-up, `uptime` load 2.51 3.58 3.93 at start): every check PASS, exit 0.**
No game-code fix was needed. The pack is crowd type `zombie@1`: spawnDebugCharacter files a body under the PLAYER's room, and
the ring's room 1 has no zombie of its own.

```
gpu baseline: 0 uncaptured GPU errors with the flag off
PASS  [off] flag off
PASS  [off] earlyz not on
PASS  [off] the pack is visible (zombie@1 visible >= 6)
PASS  [off] no front batch (every type front === 0)
PASS  [off] no seed built
PASS  [off] patch never emitted
PASS  [off] GPU device not lost
PASS  [off] no page exceptions (0)
PASS  [on] flag on
PASS  [on] patched + detected
PASS  [on] patch emitted frag_depth greater
PASS  [on] seed drew
PASS  [on] the pack drew as front batches (zombie@1 front === 6, back === 0)
PASS  [on] the pack is visible (zombie@1 visible >= 6)
PASS  [on] no uncaptured GPU errors (earlyz listener)
PASS  [on] GPU device not lost
PASS  [on] uncaptured GPU error count 0 <= flag-off baseline 0
PASS  [on] melee staged
PASS  [on] melee: camera inside the near body's proxy box + 0.25 m guard (margins [1.129,0.775,0.366])
PASS  [on] melee: the near body's type (soldier@1) moved front -> back (front 1 -> 0, back 0 -> 1)
PASS  [on] melee: no new GPU errors, device not lost
PASS  [on] no page exceptions (0)
```

Flag on, pack staged:

```
earlyzInfo {"flag":true,"on":true,"reason":null,"gpuErrors":[],"patchHits":20,"seed":{"built":true,"on":true,"reason":null},"batches":{"soldier@1":{"front":1,"back":0},"zombie@2":{"front":2,"back":0},"zombie@3":{"front":0,"back":0},"zombie@4":{"front":1,"back":0},"juggernaut@6":{"front":0,"back":0},"warbull@6":{"front":0,"back":0},"zombie@6":{"front":0,"back":0},"soldier@5":{"front":0,"back":0},"zombie@5":{"front":0,"back":0},"zombie@1":{"front":6,"back":0}}}
gpuDiagnostics {"lost":null,"uncaptured":[],"uncapturedCount":0}
```

Flag off, pack staged: `{"flag":false,"on":false,"reason":null,"gpuErrors":[],"patchHits":0,"seed":{"built":false,"on":false,"reason":"not requested"},...}`,
every type `{"front":0,"back":0}`, `gpuDiagnostics` `{"lost":null,"uncaptured":[],"uncapturedCount":0}`.

**Melee (camera-inside fallback).** `STAGES.melee` stages room 1's first body, which on the ring is the soldier (body 1,
type `soldier@1`, at `[-4.8, 0, -4.8]`). The ladder asks for 0.4 m. After `step` the camera stood at `[-4.8, 0, -4.13]`,
which is 0.67 m away on the floor, pitch -1.0 rad: the player collision resolved the overlap. Coverage was 0.336.
- The proxy box the split tests has centre `[-4.8, 1.08, -4.8]` and half `[0.879, 1.065, 0.786]`. The centre is the view
  object's position and the half is the view's `bodyHalf`.
- The camera sat at `[-4.8, 1.62, -4.13]`. Inside margins (half + 0.25 - |camera - centre| per axis) were
  **`[1.129, 0.775, 0.366]` m**, all positive.
- `soldier@1` moved from `{front 1, back 0}` (pack) to **`{front 0, back 1}`**.
The pack behind the camera stayed `zombie@1 {front 6, back 0}`. `patchHits` stayed 20, `gpuErrors` stayed `[]`, and
`uncapturedCount` stayed 0.

- **crowdInfo** (both phases identical): crowd on, `boxes` dispatch, tiles on, no fallback. Visible types:
  `zombie@1` 6/6 at mean 3.46 m (the pack), `soldier@1` 1 at 4.84 m, `zombie@2` 2 at 12.65 m, `zombie@4` 1 at
  13.93 m. Camera `[-8.2, 0, -8.2]`, yaw 3π/4. Every drawn body landed in `front`: the camera is outside every
  proxy box, as the pack scene intends.
- `patchHits` 20 counts `getFragDepth` calls answered with `frag_depth, greater` (calls, not shaders).
- **Console.** The flag-on boot logs `[earlyz] on: front-face crowd proxies + frag_depth greater + level-depth seed`
  and no `[earlyz]` warning. There were zero page exceptions in either phase. Every other warning is in BOTH phases,
  so none is the flag's:
  - the `flaregun-placeholder.glb` fallback (a dev placeholder absent in this worktree; its network 404 is logged
    only on the tab's first boot)
  - Dawn's `Draw with an index count of 0 is unusual`
  - three's `Unable to serialize Texture`, 44x with the flag on and 26x off. The extra 18 under the flag were not traced.
- **An informal look, not the parity gate** (first version of the smoke). One pair of screenshots of the pack, flag on
  vs off, `?seed=7&loader=0`, 30 frames. Both show the same six bodies and the soldier behind them, with nothing missing
  or clipped. Viewport crop: mean abs diff 1.5 / 255, 0.8 % of pixels differ by more than 15, mean luminance 52.69 vs
  52.47. These are two separate boots with only the seed pinned, so this is not a parity number; `earlyz-parity.mjs`
  is the measurement.

**Timings.** The table counts from navigate to the loader gate being ready plus the background crowd job finishing.
"crowd job" is when that job finished (`warmDone.phases.backgroundDone.crowd`).

| Run | phases | `uptime` load at start | off: ready / crowd job | on: ready / crowd job |
| --- | --- | --- | --- | --- |
| 1 | on, off | 2.36 2.97 3.20 | 5.0 s / 3.3 s | **27.6 s / 25.5 s** (cold) |
| 2 | on, off | 2.63 2.96 3.19 | 4.5 s / 3.3 s | 5.9 s / 4.1 s |
| 3 | off, on | 7.33 3.77 3.53 | 5.4 s / 3.6 s | **27.0 s / 25.6 s** (cold) |
| 4 | on | 9.77 5.81 4.36 | — | 6.5 s / 4.6 s |
| 5 | on | 8.97 5.77 4.36 | — | 5.9 s / 4.3 s |
| 6 | off, on | 4.41 5.09 4.23 | 5.5 s / 3.6 s | 6.0 s / 4.5 s |
| 7 (of record) | off, on | 2.51 3.58 3.93 | **47.8 s / 46.0 s** (cold) | **36.1 s / 34.0 s** (cold) |

- **The cold compile.** The front-face crowd program's cold compile is **~22-30 s, paid in the background crowd job after
  `ready`**, not behind the loader. `drawOnce` stays 1.6-2.3 s in every boot, flag on or off.
- **Cold runs.** Run 3 came 22 minutes after the warm run 2, with no source change, and its front program was cold
  again. Runs 4-6 were warm straight after it, in both phase orders, so the order is not the cause.
- **Run 7 went cold for the shipped crowd program as well** (off-phase crowd job 46 s, layer precompile 3.3 s instead
  of ~0.1 s). So the shader cache loses entries between runs for both programs, not only the flag's. That is
  consistent with machine-level cache churn (other sessions share the machine) rather than something the flag does.
  Cause not traced further.
- **Not the boot-time gate.** These are smoke observations, not the gate against the base branch.

**Scene preludes, checked once outside the smoke.** This was a scratch run, flag on.
- `doorway` (ring): `tunnel-1-2`, player `[-3.3, -3.6]` in `room1`, aimed at the mouth `[-0.8, -4.8]`, 12 spawned.
  Batches: `zombie@1 {front 9}`, so 9 of the 12 far-room bodies were drawn.
- `far` (ring): 16 spawned, `zombie@1 {front 16}`.
- `pack` on `level=night-train`: refused by the ring-only guard, as intended.
- `train-doorway`: `tunnel-1-2`, player `[1.2, -13.5]` in `guards-van`, mouth `[0, -16]`, 12 spawned. Batches:
  `zombie@1 {front 4, back 1}`.
  - The `back 1` is the level's own zombie `van-guard`, at `(0.6, 0, -13.8)` in `night-train.level.json`, 0.67 m from
    the camera.
  - It is kept deliberately as a realistic close-body case for parity and the bench.
- No GPU errors in any of these.
