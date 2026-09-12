# P3d pre-flight — local train → export → G3 → pull → dashboard → in-game smoke

- **Date:** 2026-09-11
- **Checkout SHA:** `74658f755017ce3be3afdb77948e8dd675a9d184` (parent of this task's commit; the
  P3d Task 1 commit "RunPod pack/launch/bootstrap/pull/stop scripts")
- **Harness:** `pi` (macOS arm64 `Donnys-MacBook-Air.local`, Metal/MPS, Chrome 152 headless)
- **Plan:** `docs/superpowers/plans/2026-09-11-neural-upscale-p3d-preflight-runpod.md`, Task 2
- **Dataset:** `/tmp/blud-upscale-data/preflight-v2` — 60 pairs (40 train / 20 val, 12 showcase),
  converted from the P2 smoke capture `smoke-2026-09-11-r4` by `nupscale.convert_p2`. Both the
  capture manifest and the converted copy already existed, so Step 3's regeneration was not needed
  and no GPU capture time was spent.
- **Verdict: PASS** — Steps 4–7 all passed, with no gate weakened and no retry required.

## Step 2 — unit test (host CPU)

```
tests/test_preflight.py ... 1 passed
```

## Step 4 — pre-flight training (MPS, 10-minute budget)

`python -m nupscale.preflight --data /tmp/blud-upscale-data/preflight-v2 --root /tmp/blud-upscale-runs/preflight`

`PREFLIGHT: PASS` — all five `PREFLIGHT.json` checks true. Reference MPS run in parentheses.

| Check | Result | Number |
|---|---|---|
| `trainingFinished` | ✅ true | `state=done`, `step=600` (ref 600) |
| `lossFell` | ✅ true | head mean 0.0787 (`[0.0850, 0.0777, 0.0734]`) → tail mean 0.0544 (`[0.0551, 0.0536, 0.0546]`) — ref 0.085 → 0.054 |
| `beatsNearestOnTrain` | ✅ true | model 0.032243 vs nearest 0.033481 on the 40 train pairs (ref 0.0322 vs 0.0335) |
| `exportsWritten` | ✅ true | `s8-rgb/exports/s8-rgb-best/model.json` and `…-final/model.json` |
| `withinBudget` | ✅ true | **23.1 s** ≤ 600 s (training loop 16.9 s; ref 24 s) |
| device | — | `mps` |

Validation (reported, not gated): model **0.021997**, nearest 0.022796, bicubic 0.021273 (ref
0.0220 / 0.0228 / 0.0213 — the model beats nearest but not bicubic at this smoke size, exactly as
the reference did; G4 is not part of the pre-flight budget gate).

## Step 5 — pack, serve, pull (the pod round trip, locally)

`pack-exports.sh` wrote `/tmp/blud-upscale-runs/preflight/exports.tar.gz` (3.4 MB) containing
`s8-rgb/exports`, `dashboard.json` and `PREFLIGHT.json`.

`pull.sh --url http://127.0.0.1:8768` (local `python3 -m http.server`) ran G3 on both exports.
Both exports have the same `weightHash 63fcfcac` because with `val_every=200` the only validation
is at the last step, so best == final here.

```
G3: PASS   # s8-rgb-best
  s0002-f000 sp: covered 52376/246000 maxRelRgb 2.38e-7 depthMismatch 0 coverageMismatch 0 (outside band 0) PASS
  s0002-f000 dc: covered 52376/246000 maxRelRgb 2.53e-7 depthMismatch 0 coverageMismatch 0 (outside band 0) PASS
  s0002-f001 sp: covered 53031/252504 maxRelRgb 1.79e-7 depthMismatch 0 coverageMismatch 0 (outside band 0) PASS
  s0002-f001 dc: covered 53031/252504 maxRelRgb 1.79e-7 depthMismatch 0 coverageMismatch 0 (outside band 0) PASS
G3: PASS   # s8-rgb-final (same four lines)
installed into /Users/donny/.claude/dispatch/worktrees/2026-09-11-neural-upscale-p3d-preflight-runpod-task-2/.upscale-models: s8-rgb-best s8-rgb-final
pull exit 0
```

## Step 6 — dashboard serves and is complete

```
1
dashboard OK: s8-rgb step 600 12 showcase pairs, 4 images fetched
```

`index.html` served the expected heading, `dashboard.json` had `state=done` with validation
metrics, `baselines` included nearest and bicubic, and the first showcase pair's base images plus
one best image all returned HTTP 200. The server was then stopped.

## Step 7 — the pulled model in the game (Chrome / Metal / WebGPU)

```
self-check: [{"layout":"sp","pixels":480000,"covered":18909,"maxRelRgb":0.00128173828125,"coverageMismatch":0,"coverageMismatchFar":0,"depthMismatch":0},
             {"layout":"dc","pixels":480000,"covered":18909,"maxRelRgb":0.0012819766998291016,"coverageMismatch":0,"coverageMismatchFar":0,"depthMismatch":0}]
            sp-vs-dc {"pixels":480000,"bothCovered":18909,"maxRelRgb":0.00024336576461791992,"coverageMismatch":0}
SMOKE: PASS
```

The pulled `s8-rgb-best` export self-checked at sp `1.28e-3` / dc `1.28e-3` with 0 coverage and 0
depth mismatches — matching the plan's reference `1.28e-3` and inside the `2e-3` gate.

## Retries / surprises

- None. Every plan command produced its expected output on the first run.
- Step 3's capture and conversion were skipped because both artifacts already existed
  (`smoke-2026-09-11-r4` and `preflight-v2`); the converted dataset had all 60 pairs' files present.
- `native` fixtures are absent from this converted P2 dataset (`convert_p2` leaves `files.native`
  null), so the dashboard has no native baseline image — the plan's Step 6 check only requires
  nearest + bicubic, and the trainer treats a missing native baseline as `None`.
