# Self-shadow spike: SDF self-shadow on the dominant key (plan 1, task 1)

Spec: [shared light list design §6](../superpowers/specs/2026-09-26-shared-light-list-design.md).
Script: `scripts/sdf-selfshadow-spike.sh` (`LAB_TMP=.lab-tmp`, `LIGHT_GATE_SHOT=<dir>`; `SS_ARGS="strength,reach"` for tuning runs).
Images and raw JSON: [`2026-09-27-self-shadow-spike/`](2026-09-27-self-shadow-spike/). Start with
[`contact-sheet.png`](2026-09-27-self-shadow-spike/contact-sheet.png): each row is OFF | ON | the on-minus-off difference ×8 (red means darker with it on).

**Status: waiting on the OWNER LOOK GATE.** Two of the four acceptance criteria fail (the tube scenes show no change, and the cost is over 1 ms). See the verdict section below.

## What was built

- `woundShadow` (`march/fields/wounds.wgsl.ts`) takes two new parameters, `reach` and `steps`. The loop's literal bound stays 14. `steps` only breaks early. The wound path passes `0.4, 14`, so its arithmetic is unchanged.
- There is one call site with two modes (`occlusion.wgsl.ts`):
  - **Wound mode** runs when the wound shadow is on and the hit is near a wound. It uses the wounded field, k = |cfg.y|, reach 0.4 and 14 steps, as before.
  - **Self-shadow mode** runs otherwise, when `woundShadowCfg.z > 0` and the hit is within 12 m. It uses the **smooth field** (`woundCfg.x` = 0 wounds), k = 24 (a literal), `woundShadowCfg.w` as the reach, and a break after 8 steps.
  - It uses the same `mapBody` inline, so no new call site is added.
- `woundShadowCfg` is now a vec4: z is the self-shadow strength, w is the reach. The lab default z = 0 leaves the self-shadow off. The refine twin forces z = 0.
- The pure module is `webgpu/self-shadow.ts`. The game writes the uniform with `applySelfShadow` at the actor site and at the crowd-type site. `?selfshadow=0` turns it off at boot. The look seam is `__sdfGame.setSelfShadow(enabled, strength?, reach?, k?)`. In the spike, `k` is recorded but not applied: the WGSL uses a literal 24.
- `WINDOW_SHADOW_SIZE` went from 1024 to 512 (spec §6).
- `wShadow` still multiplies only the key diffuse and the key specular. Ambient, fill, scatter, fresnel and the rim are untouched.

## Method (and a deviation that matters)

The first run followed the task text: `frozen` boot, 900 ms settle, then off and on. Its off/on difference covered the **whole frame, level included**, which the self-shadow cannot touch. The frames differed because the lamp swing, the lamp flicker and the VHS row noise all kept running between the two shots. On that run the dining "dark +5.6 pp" and the bolt "mean −11%" were mostly noise.

The script now pins everything before each pair: `setDemoHold(true)` and `setLightClockFrozen(true)`, then `step(30)` to settle, then `step(12, 0)` after each toggle, so the sim clock does not advance. With these pins the level pixels match exactly between off and on. The script also reports the share of body-box pixels that got **darker or brighter by more than 0.03** between off and on, which is the shadow's footprint.

`timeDraws(n)` returns **one number**: the median ms of n fenced `drawOnce` frames, CPU and GPU together. That number is noisy, about ±2–3 ms at third class headless. The cost loop therefore runs 8 interleaved off/on rounds, and each round also drains `passTimings()` and sums the GPU passes labelled `*march*` per frame.

## Numbers: the shipped tuning (strength 0.7, reach 0.4, 8 steps, k 24)

The body box covers x 0.38–0.62 and y 0.2–0.8 of an 800×600 frame, with the actor framed from 2.4 m. "dark" is the share of pixels under 0.04 luminance.

| scene | off mean | off std | off dark | on mean | on std | on dark | darkened >0.03 | brightened |
|---|---|---|---|---|---|---|---|---|
| tube-third (actor 22) | 0.126 | 0.086 | 8.4% | 0.126 | 0.086 | 8.5% | 0.1% | 0.0% |
| tube-dining (actor 7) | 0.152 | 0.106 | 13.6% | 0.152 | 0.106 | 13.6% | 0.0% | 0.0% |
| bolt-third (actor 22, window held at 32) | 0.346 | 0.286 | 5.1% | 0.329 | 0.270 | 5.1% | 10.6% | 0.0% |

**Cost at third class** (pose (0, −12), 10 bodies in the dump, the nearest 2 m away):

- Frame medians (`timeDraws(9)`, 8 rounds): off 17.50 ms, on 20.05 ms, **delta +2.55 ms**.
- GPU march medians (the `*march*` passes): off 5.43 ms, on 6.77 ms, **delta +1.33 ms**.

### Every run

The step count is a WGSL literal, so runs at different step counts are different builds. Reach and strength came through the seam.

| run | steps / reach / strength | tube-third darkened | tube-dining darkened | bolt darkened, mean | frame Δ | march GPU Δ |
|---|---|---|---|---|---|---|
| 1, unpinned (as the task was written) | 12 / 0.6 / 0.7 | noise | noise (dark +5.6 pp was the level changing) | noise | +2.25 ms (18.35 → 20.60; the task's 4 alternating blocks) | not measured |
| 2, pinned | 12 / 0.6 / 0.7 | 0.2% | 0.0% | 11.3%, −5.8% | +1.00 ms (18.85 → 19.85; 4 alternating blocks) | not measured |
| 3, pinned, interleaved | 12 / 0.6 / 0.7 | 0.2% | 0.0% | 11.5%, −5.8% | +4.00 ms | +1.67 ms |
| 4 | 8 / 0.6 / 0.7 | 0.2% | 0.0% | 10.7%, −4.9% | +3.75 ms | +1.62 ms |
| 5 | 8 / 0.4 / 0.7 | 0.2% | 0.0% | 10.5%, −4.9% | +1.15 ms | +1.36 ms |
| 6, shipped defaults | 8 / 0.4 / 0.7 | 0.1% | 0.0% | 10.6%, −4.9% | +2.55 ms | +1.33 ms |
| probe, tube-third only | 12 / 0.8 / 1.0 | 0.4% | — | — | — | — |

The GPU march delta is the reliable cost number. It barely moves with the step count. The reason is the walk's stride: `clamp(h, 0.01, 0.06)` caps each step at 6 cm, so reaching 0.4–0.6 m takes 7 to 10 samples whatever the cap is. The cost floor is about 8 smooth `mapBody` evaluations per hit pixel, roughly +1.3 ms of march GPU at third class.

## Acceptance criteria

1. **Visible (std rises in the tube scenes): FAIL.** Under the tubes, std does not move and fewer than 0.2% of body pixels change. The shadow does fire:
   - it darkens 10.6% of the body in the bolt scene;
   - `crowdUniformDiff` shows the type and the view agree on `woundShadowCfg`;
   - at strength 1.0 and reach 0.8 the tube scene still changes only 0.4%.

   The likely cause is the tube key itself. `presentingLamp` builds a mostly overhead direction biased 30% toward the viewer, and its intensity floor on the type is only about 0.21 of the preset key (`spotCfg2.z`). Under that key, the places a self-shadow could darken either already face away from `L` or sit hidden behind the form from the camera. The body under a tube is carried by the fill, ambient and rim, and the self-shadow does not touch any of those. This is a hypothesis from the uniform values and the probe, not a measured breakdown.
2. **Never black (dark rises at most 5 pp): PASS.** The largest rise is +0.1 pp.
3. **Mean held (drops at most 25%): PASS.** The largest drop is −4.9%, in the bolt scene.
4. **Cost (on minus off, frame median, at most 1.0 ms): FAIL, even at the plan's fallback of 8 steps and reach 0.4.** The frame delta was +1.15 ms on one run and +2.55 ms on another, which is noisy. The GPU march delta is a steady +1.33 to +1.36 ms. The spec's next cut, a half-resolution self-shadow, is not part of this spike.

## What it looks like (described from the images)

- **tube-third and tube-dining:** there is no visible difference between off and on. The difference map shows a few speckles on the eye and hand edges only.
- **bolt-third** (the window light held at 32 from the −x side): the shadow is visible and reads as modelling, not holes:
  - the torso's flank under the far arm and the inside of that arm darken as a shaded band;
  - the inside of the near arm darkens along the torso;
  - the nose and brow throw a shadow across one cheek and eye socket;
  - the crotch and inner thighs darken.

  The shadowed flesh keeps its colour, sheen and the fresnel rim. No part goes to black. At a glance the change is modest: a firmer, more sculpted side rather than a dramatic cast shadow. Its edges are hard, as intended, with no ringing or banding visible at this resolution.

## Boot time (cold `drawOnce`, a fresh profile each run)

The base is the commit before the spike's code commit (`HEAD~1` at the time of the run), built in a throwaway worktree.

The runs are listed in the order they ran:

```
base 1  {"drawOnce":1387,"warmMs":1976}
base 2  {"drawOnce":1419.2,"warmMs":2084}
new  1  {"drawOnce":1511.2,"warmMs":2080}
new  2  {"drawOnce":1550.5,"warmMs":2340}
extra pair, run in reversed order (new first) to check for an ordering bias:
new  3  {"drawOnce":1458.7,"warmMs":2110}
base 3  {"drawOnce":1483.9,"warmMs":2153}
```

The task's two runs each show a gap of +9% (1403 against 1531), which is just inside the ±10% noise band. The reversed pair flips the sign (new is 25 ms faster). Over all three runs each, base averages 1430 and new 1507, a gap of +5%, which is within run-to-run noise. The extra `select` arguments do not look like they changed the inline. That verdict is soft: the ordering effect is as large as the gap.

## Tuning that shipped

`SELF_SHADOW = { strength: 0.7, reach: 0.4 (maxReach 0.8), k: 24 (a WGSL literal, not live), steps: 8, maxCamDist: 12 }`.
The uniform default is `woundShadowCfg = (0, 12, 0, 0.4)`, so the lab keeps it off. The game writes z and w for every body.

Steps and reach are the plan's cost fallbacks (12 → 8, then 0.6 → 0.4). They were applied because criterion 4 failed at 12 steps and 0.6 m. The cost still misses the 1 ms budget.

## Deviations from the task text

- **The capture pins its clocks** (`setDemoHold`, `setLightClockFrozen`, `step(…, 0)`), and it reports the darkened and brightened footprint. Without the pins the A/B measured lamp swing and VHS noise, not the shadow.
- **The cost loop interleaves 8 off/on rounds and also reads the GPU march passes** from `passTimings`. `timeDraws` returns a single median ms, and alone it is too noisy to test a 1 ms budget.
- **An extra pin was updated:** `wounds.wgsl.test.ts` pinned `if (res < 0.02 || t > 0.4) { break; }`, and that now reads `if (i >= steps || res < 0.02 || t > reach) { break; }`. The task named the other pins but not this one.
- **Off by one:** `i >= steps` is checked after the sample, so `steps = 8` takes up to 9 samples, and the task's 12 would have taken 13. The wound path passes 14, which the `i < 14` bound already reaches first, so it is unchanged.
- **`t` is the march's hit distance along the camera ray.** It is in scope in the light block, and it is the same `t` that the block returns in `.w`.
- **A `typeof location` guard** was added on the module-level `?selfshadow` read, so importing the leaves module outside a browser does not throw.
- **There is no `game-context-coverage` test file.** `npm test -- game-context-coverage` matches nothing. The substitute was `game-context.test.ts`, plus `game-state-lighting.test.ts`, which pins sources from `game-main`.
- **`applySelfShadow` at the crowd site** sits inside the existing `if (src)` block, right after the `applyWindowKey` line.

## Owner verdict

_Pending._
