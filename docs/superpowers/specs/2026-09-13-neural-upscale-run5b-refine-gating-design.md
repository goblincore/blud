# Neural upscale run 5b — making the refine pass affordable

**Date:** 2026-09-13 · **Status:** approved (owner, after run 5's Gate 2) · **Builds on:** run 5
(`2026-09-13-neural-upscale-run5-sdf-refine-design.md`, results §14 of the next-steps note).

## 1. Problem

Run 5's refine head is the best-looking upscaler (owner: "definitely the best looking, especially at medium
distance") and the best-measuring one (0.01112 vs the control's 0.01455). Its pass costs 6–11 ms per frame
(+23–45 % frame time), because every body's refine twin runs the march's whole post-hit tail at 4× the pixels.
The owner's read: the gain is most visible at medium distance, least at close range (where a body is most of
the pixels) and irrelevant on dead bodies.

## 2. Decisions (owner)

- Gate the pass **per body**: never for dead/baked bodies; only inside a medium distance band; only on screen.
- Make the head **robust to the gate being off** by a training augmentation, so any gating policy works with
  one model.
- Slim the twin's lighting tail (no soft shadows / scatter / bounce for the twin — "there aren't any soft
  shadows in the game really").
- Evaluate a **normal-only** variant to learn whether the twin needs to light at all.
- Frame-time target: within ~10 % of the control in rooms 1 and 2, look preserved at medium distance.

## 3. Pieces

### A. Training augmentation — the head degrades gracefully (`nupscale`)
`CropSampler.sample_with_extras(batch, refine_drop=0.3)`: with probability `refine_drop` per crop, set the
refine gate to "not accepted" over the whole crop (`refine[7] = 1.0`; the other refine channels are irrelevant
once the gate is 0 because every refine channel is multiplied by `ga`). `RunConfig.refine_drop` (default 0.3
when `head_inputs == "detail+refine"`, 0 otherwise); `grid.py --refine-drop`. Validation reports TWO numbers for
a refine model: `val` (refine on, as today) and `val_norefine` (gate forced off across the val set) — the
dashboard shows both. Gate: `val` ≤ run 5's 0.01112 + noise; `val_norefine` ≤ the control's 0.01455.

### B. Normal-only ablation (`nupscale`, evaluation only)
`evaluate.py`: an option to zero the re-lit colour channels (refine[4:7]) at eval time. Run it on the model from
A: `val_normal_only`. If it lands within ~5 % of `val`, the twin's lighting carries nothing the net needs → the
tail can drop to Newton + normal (a later, separate contract change). If it lands near `val_norefine`, colour
matters → keep the slim lit tail of C. Reported in §15; decides C's depth.

### C. Twin lighting overrides (`zombie-gpu.ts`, no WGSL change)
The refine twin is built from a shallow copy of the body's `MarchUniforms` in which the lighting-term gates are
replaced by twin-owned uniforms: `surfCfg` with `.w = 0` (scatter off), `woundShadowCfg = (0, 0)` (wound soft
shadow off), `bounceCfg` and `probeCfg`/`probeDynCfg` zeroed (ambient bounce / probe gather off), `bodyFlash`
kept, level shadow kept (one texture tap). The existing shader branches skip those terms at zero — pinned by a
source-text test listing the gates. A live switch `__sdfGame.setRefineTail('full' | 'slim')` (default slim) so
the bench measures each term's cost. Parity: the march's own uniforms are untouched (march-hash unchanged).

### D. Per-body gating (`sdf-layer.ts` / `game-main.ts`)
Each frame, before the refine pass, the game sets `view.refineObject.visible` per body:
- `false` if the actor is dead, collapsing, or corpse-baked (the corpse bake already hides the march twins; it
  must hide the refine twin too — a run-5 leak),
- `false` if the proxy box is off screen (frustum test on the box),
- `true` only inside a distance band `[near, far]` measured camera→body centre, with hysteresis
  (`enter` / `exit` margins) so a body walking along the edge does not flicker.
Defaults from the capture's class thresholds (`medium` = the middle class in `scripts/upscale-capture-v2.mjs`);
live knobs `__sdfGame.setRefineBand({ near, far, hysteresis })`, `__sdfGame.refineBand()`, and a HUD count of
refined bodies. The head handles un-refined bodies via A.

### E. Bench and gates
`refine-on` / `upscale-r5b-headr` legs with the band at defaults; pass rows `sdf:refine` full vs slim; frame
p50 rooms 1–2 vs the control. Gate: within ~10 % of the control. Look gate: owner A/B at medium distance.

## 4. Non-goals / follow-ups
- Corpse bake for every character (today soldier-only via `corpseBakeEligible`): a separate task on TASKS.md —
  it helps every frame with corpses and is independent of the upscaler.
- A `normal-only` head contract (14 channels) is NOT built here; B only measures whether it would be worth it.
- No change to the march kernel, the target filter, or the loss.

## 5. Sequence
A + B (one retrain, ~20 min) → C (bench each term) → D (bench the band) → E → §15 of the next-steps note.
