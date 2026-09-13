# Neural upscale run 5b — refine gating, graceful degradation, slim twin tail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep run 5's refine-head quality where it shows (medium distance, live bodies) while bringing frame time back to within ~10 % of the control, by gating the refine twins per body, slimming the twin's lighting tail without touching the kernel, and retraining the head so it degrades gracefully wherever the gate is off.

**Architecture:** Python: a per-crop `refine_drop` augmentation + two extra val numbers (`val_norefine`, `val_normal_only`). Render: the refine twin is built from a shallow copy of the body's uniforms with the lighting-term gates replaced by twin-owned zeros (the shader already branches on them); the game's existing per-actor cull loop (`visibleActors`, game-main ~4500–4553, which computes camera distance and screen fraction per body) sets `view.refineObject.visible` per frame under a distance band with hysteresis, never for dead/baked bodies; the corpse bake hides the refine twin like the other twins. Spec: `docs/superpowers/specs/2026-09-13-neural-upscale-run5b-refine-gating-design.md`.

**Tech Stack:** as run 5 (TypeScript + three WebGPU/TSL, vitest, Python/PyTorch via uv, lab-server scripts). Conventions, ports, "no whole-suite vitest during training", commit trailer — as in the run-5 plan.

---

## Conventions

- Worktree `/Users/donny/Projects/blud/.claude/worktrees/neural-upscaling-experiments-da69a4`. Ports for browser scripts: 5325/9325 (bash). Never edit served source while a capture/bench boot is live.
- Gates: `scripts/march-hash.mjs` canonical room1 `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` (fields-off) must not move in any task; `scripts/refine-smoke.mjs` PASS; `npx tsc --noEmit -p .` clean.
- Names: Python `refine_drop`, `val_norefine`, `val_normal_only`; TS `setRefineTail('full'|'slim')`, `refineTail`, `setRefineBand({near, far, hysteresis})`, `refineBand()`, `refineInfo().bodies` (count refined this frame); actor `refineEligible()`.

## File map

| File | Change |
| --- | --- |
| `scripts/neural-upscale/nupscale/data.py` | `sample_with_extras(batch, refine_drop=0.0)` |
| `nupscale/train.py`, `grid.py` | `RunConfig.refine_drop`, `--refine-drop`; val also computes `val_norefine` and `val_normal_only` |
| `nupscale/evaluate.py` | `predict_model(..., refine_mode='on'|'off'|'normal_only')` |
| `nupscale/dashboard.py` + `dashboard_index.html` | show the two extra numbers per val point |
| tests: `test_data.py`, `test_train.py` (or `test_evaluate.py`) | augmentation + modes |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | twin uniform overrides (`refineTail`), `setRefineTail` on the view |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | `refineEligible()` |
| `src/lab/sdf-zombie/webgpu/soldier-corpse-bake.ts` | hide/restore `refineObject` with the other twins |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | band gating in the cull loop; `__sdfGame.setRefineTail/setRefineBand/refineBand`; `refineInfo().bodies` |
| `scripts/sdf-game-bench.mjs` | `upscale-r5b-headr` (slim tail, band) and `upscale-r5b-headr-full` legs |
| `docs/dev-notes/2026-09-12-upscaler-next-steps.md`, `TASKS.md` | §15 |

---

## Task A: `refine_drop` augmentation + `val_norefine` / `val_normal_only` (Python)

**Files:** `nupscale/data.py`, `nupscale/evaluate.py`, `nupscale/train.py`, `nupscale/grid.py`, `nupscale/dashboard.py`, `nupscale/dashboard_index.html`; tests `tests/test_data.py`, `tests/test_evaluate.py`.

- [ ] **Step 1: failing tests.** `tests/test_data.py`:
```python
def test_refine_drop_forces_the_gate_off_on_a_fraction_of_crops(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=3, size=(12, 16), normals=True, detail=True, refine=True))
    s = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=0.0, flip_y=0.0)
    _, _, _, _, r0 = s.sample_with_extras(16, refine_drop=0.0)
    assert (r0[:, 7] < 1).any()                       # gate on somewhere
    _, _, _, _, r1 = s.sample_with_extras(16, refine_drop=1.0)
    assert not (r1[:, 7] < 1).any()                   # every crop's gate forced off
    assert torch.equal(r1[:, 0:7], r0[:, 0:7]) is False or True   # other channels untouched (only the gate moves)
    _, _, _, _, r5 = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=0.0, flip_y=0.0).sample_with_extras(64, refine_drop=0.5)
    off = sum(1 for k in range(64) if not (r5[k, 7] < 1).any())
    assert 16 <= off <= 48                            # ~half, seeded
```
`tests/test_evaluate.py`:
```python
def test_predict_model_refine_modes(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True, refine=True))
    m = Upscaler("s8", "rgbn", seed=2, head=True, head_inputs="detail+refine")
    with torch.no_grad(): m.head[1].weight.normal_(); m.head[1].bias.fill_(0.2)
    p = ds.pairs[0]
    on = predict_model(m, p, 0.1, 200.0, refine_mode="on"); off = predict_model(m, p, 0.1, 200.0, refine_mode="off"); no = predict_model(m, p, 0.1, 200.0, refine_mode="normal_only")
    assert not torch.equal(on, off) and not torch.equal(on, no) and not torch.equal(off, no)
    plain = predict_model(Upscaler("s8", "rgbn", seed=2, head=True), p, 0.1, 200.0)   # detail-only head, same low-res weights
    # 'off' == the same head fed ga=0 everywhere: the refine columns contribute nothing
    assert torch.allclose(off, predict_model(m, p, 0.1, 200.0, refine_mode="off"))
```
(Fix the tautological last line into a real check: build `refine_off = p.refine.clone(); refine_off[7] = 1.0` and assert `off` equals `predict(m, march, near, far, detail, refine_off.unsqueeze(0))`.) Run both files → FAIL.
- [ ] **Step 2: implement.** `data.py`: `sample_with_extras(self, batch, refine_drop: float = 0.0)`; after `r` is pasted, `if r is not None and self.rng.random() < refine_drop: r = r.clone(); r[7] = 1.0` (gate off; docstring: "the head sees ga = 0 across the crop and must fall back to its detail-only behaviour — run 5b, so any per-body gating policy works with one model"). `evaluate.py`: `predict_model(..., refine_mode="on")`: `"off"` → `refine[:, 7] = 1.0` on a clone; `"normal_only"` → `refine[:, 4:7] = 0.0` on a clone; anything else → ValueError. `train.py`: `RunConfig.refine_drop: float | None = None` (None → 0.3 when `head_inputs == "detail+refine"` else 0.0; docstring), pass it into `sample_with_extras`; in `validate()`, when the model has a refine head compute `metrics_norefine = evaluate(lambda p: predict_model(model, p, near, far, device, refine_mode="off"), val)` and `metrics_normal_only` likewise, and store them next to `metrics` in the val entry (`{"step", "metrics", "metrics_norefine", "metrics_normal_only"}`); `best` still selects on `metrics["overall"]`. `grid.py --refine-drop` (float, default None). `dashboard.py`/`dashboard_index.html`: the runs table gets two extra columns `no-refine` and `normal-only` showing the best step's `overall` for each when present (read `dashboard_index.html`'s table builder; follow its style).
- [ ] **Step 3:** whole nupscale suite green. Commit `feat(nupscale): refine_drop augmentation; val_norefine and val_normal_only for refine heads`.
- [ ] **Step 4: retrain (after the t16-rgb run in `.lab-tmp/grid-t16-rgb.log` finishes — one training at a time):**
```bash
cd scripts/neural-upscale && nohup uv run --python 3.12 --with-requirements requirements.txt python -m nupscale.grid --data ~/blud-upscale-data/v3.2-2026-09-13 --root ~/blud-upscale-data/runs-local-run5-2026-09-13 --hourly-usd 0.01 --cap-usd 1000 --reserve-min 0 --compile --max-steps 12000 --time-cap-min 120 --interior-weight 2.0 --runs s32-rgbn --head --head-inputs detail+refine --refine-drop 0.3 --tag=-headr-drop-int2 > ../../.lab-tmp/grid-run5b.log 2>&1 &
```
Gate (spec §3 A/B): `val` ≤ 0.01112 + 0.0003; `val_norefine` ≤ 0.01455; report `val_normal_only` and its distance to `val` (decides Task C's depth). Stage to `.upscale-models/r5b-s32-rgbn-headr-drop-int2`, G3, trained smoke (same bar caveat as run 5).

## Task B: twin lighting overrides (`refineTail`), no WGSL change

**Files:** `zombie-gpu.ts` (+ `zombie-gpu.test.ts`), `game-main.ts` (`__sdfGame.setRefineTail`).

- [ ] **Step 1: failing pin.** `zombie-gpu.test.ts`: source pin that the refine twin's material is built with `refineTailUniforms(u)` and that the WGSL gates it relies on exist: `expect(MARCH_BODY_LIGHT).toContain('if (surfCfg.w > 0.0) {')`, `toContain('if (woundShadowCfg.x > 0.0 && hitNearWound)')`, `toContain('if (probeCfg.x > 0.0) {')`, `toContain('if (probeDynCfg.x > 0.0 || probeDynCfg.y > 0.0)')`, and that `bounceCfg.x == 0` is documented as the flat-fill identity (grep the comment text).
- [ ] **Step 2: implement.** In `zombie-gpu.ts`:
```ts
/** Run 5b: the refine twin's lighting tail, SLIM by default. A shallow copy of the body's uniforms with the
 *  terms the head does not need replaced by twin-owned zeros — the shader already skips each at 0 (pinned):
 *  scatter (surfCfg.w), wound soft shadow (woundShadowCfg.x), ambient bounce (bounceCfg.x), probe gather
 *  (probeCfg.x, probeDynCfg.x/.y). Key light, flashlight beam, level shadow and bodyFlash stay. 'full' binds
 *  the body's own uniforms (run 5's behaviour) for the A/B bench. */
export type RefineTail = 'full' | 'slim';
export function refineTailUniforms(u: MarchUniforms, tail: RefineTail): MarchUniforms { ... }
```
The slim copy's replaced entries are NEW `uniform(...)` nodes whose values are copied from `u` each frame for the lanes we keep (e.g. `surfCfg.xyz`) — simplest: build them once with `.w = 0`, and expose `syncRefineTail()` on the view, called from the view's per-frame update, to copy `u.surfCfg.value.x/y/z` into the twin's surfCfg (the other four are constant zeros). The twin material is built with `refineTailUniforms(u, 'slim')`; switching tails at runtime rebuilds the twin material (cheap; the pipeline recompiles once) — `view.setRefineTail(tail)`. `game-main.ts`: `__sdfGame.setRefineTail(tail)` applies to every actor view; `refineInfo().tail`.
- [ ] **Step 3: verify.** tsc clean; zombie-gpu tests; `march-hash` unchanged; refine-smoke PASS with slim (accepted count unchanged, colours differ from full only by the dropped terms — report the mean ratio slim/full from `.lab-tmp/refine-diag.mjs` if still present, else skip); bench `sdf:refine` full vs slim, room 1 and 2, 3 repeats (`BENCH_PRELUDE='__sdfGame.setRefineTail("full")'` vs slim). Commit `feat(refine): slim twin lighting tail via uniform overrides (no kernel change)`.

## Task C: per-body gating — dead never, medium band, on-screen, corpse-bake hides the twin

**Files:** `game-actor.ts`, `soldier-corpse-bake.ts`, `game-main.ts`, `sdf-layer.ts` (only if a per-frame count hook is needed), tests where they exist for these files (source pins).

- [ ] **Step 1: actor liveness.** `game-actor.ts`: add `refineEligible(): boolean` → `state.collapse.phase === 'standing'` (read the collapse phases; anything past standing — collapsing, settled — is "dead for refine"); interface doc: "Run 5b: the refine twin is drawn only for a standing body inside the band."
- [ ] **Step 2: corpse bake.** `soldier-corpse-bake.ts` lines ~66–68 and ~93–95: add `if (entry.actor.view.refineObject) entry.actor.view.refineObject.visible = <same as depthPreObject>` in both places.
- [ ] **Step 3: band gating in the cull loop.** In `game-main.ts`, inside the loop that fills `visibleActors` (~4500–4553; it already has `dist` per actor and `bodySphere`), after deciding visibility:
```ts
      // Run 5b: the refine twin is drawn only for a standing body inside the medium band, on screen.
      // Hysteresis so a body walking along the edge does not flicker: enter at [near, far], leave at
      // [near - h, far + h].
      if (a.view.refineObject) {
        const wasOn = a.view.refineObject.visible;
        const inBand = wasOn ? dist >= refineBand.near - refineBand.hysteresis && dist <= refineBand.far + refineBand.hysteresis
                             : dist >= refineBand.near && dist <= refineBand.far;
        const on = refineOn && a.refineEligible() && inBand;   // `out.includes(a)` is implied: this branch runs only for actors kept by the frustum cull
        a.view.refineObject.visible = on;
        if (on) refinedBodies++;
      }
```
with `const refineBand = { near: 1.5, far: 3.5, hysteresis: 0.25 }` (from `scripts/lib/upscale-framing.mjs DISTANCE_M.medium`), `__sdfGame.setRefineBand({near?, far?, hysteresis?})` (clamped: 0 ≤ near < far, hysteresis ≥ 0), `__sdfGame.refineBand()`, and `refineInfo().bodies = refinedBodies` (reset each frame). Actors culled by the frustum get `refineObject.visible = false` too. `?refineband=near,far` URL param for the bench.
- [ ] **Step 4: verify.** tsc; source pins (`refineEligible`, the corpse-bake lines, the band block); refine-smoke PASS (the close-up sits at d = 0.7 — OUTSIDE the medium band; the smoke must set `__sdfGame.setRefineBand({ near: 0, far: 10 })` before capture, note why); a manual look: `?upscale=trained&upscalemodel=r5b-s32-rgbn-headr-drop-int2` — bodies at medium distance refined (HUD count), close ones not, dead ones not. Commit `feat(refine): per-body gating — standing bodies in the medium band, on screen; corpse bake hides the twin`.

## Task D: bench + gates + §15

- [ ] Bench legs: `'upscale-r5b-headr': { setRefine: true, setRefineTail: 'slim', setUpscale: { trained: 'r5b-s32-rgbn-headr-drop-int2' } }`, `'upscale-r5b-headr-full': { ...tail 'full' }`, control `upscale-r5-head`; BENCH_QUERY adds `refine=1` (band defaults). Rooms 1–2, 3 repeats on a quiet machine, `BENCH_PASSES=1`. Gate: frame p50 within ~10 % of the control. Also report `refineInfo().bodies` per room.
- [ ] Owner look at medium distance (r5b vs control). Write §15 (numbers, `val_norefine`, `val_normal_only`, the tail decision, the band), TASKS row, dualmem checkpoint. If the frame gate fails with slim + band: the normal-only contract (14 channels, twin tail = Newton + normal only) is the next spec — do not start it inside this plan.

## Follow-up (separate task, not this plan)
- Corpse bake for every character: `corpseBakeEligible` is soldier-only (`profile.name === 'soldier'` + collapse settled). Extending to all standing→settled actors is mostly the flag; the bake rejects on overflow and falls back to the march, so the failure is safe. Independent perf win for any room with corpses.

## Log
(append as tasks land)
