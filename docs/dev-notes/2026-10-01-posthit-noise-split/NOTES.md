# Post-hit cost split: what does the procedural noise cost? (2026-10-01)

Research probe, not a gate. Asked while scoping the "Dreams" spike (bake the
procedural surface detail once per character type into a rest-space texture):
is the noise worth baking for speed?

**Answer: no. The procedural noise costs ~0 ms.** Post-hit work is real
(1.7 ms clean, 3.7 ms wounded on one close body), but it is field probes and
lighting, not noise. Baking the noise would buy nothing for speed.

## Method

`posthit-split-probe.mjs` (this directory; `./run-probe.sh` owns its own vite +
headless Chrome). Same staging as the 2026-09-21 multiscale probe: one page,
`?frozen=1`, ship boot (t16 upscaler on, crowd program), `setFrameCap(0)`,
room 1 close-up (body at 0.7 m, 38 % cover), march scale 0.5, and
`bench({ kind: 'closeup', mode: 'passes' })`. Legs alternate inside the page in
rotating order, 3 blocks × 90 frames, medians.

- Half A: `ship` alternating with `flat` (`setFlatAlbedo`, which skips the whole
  post-hit chain).
- Then the noise lanes are zeroed on every view and crowd type via
  `setUniformAll`:
  - `surfCfg2.y`: micro-detail normal, 3 fbm at 22;
  - `surfCfg2.z`: mottle;
  - `marchCfg.z`: silhouette fbm in the normal taps and the AO/scatter probes.

  Every one of these terms is branch-guarded on its amplitude, so zero skips the
  fbm and doesn't just multiply it by 0.
- Half B: `nonoise` alternating with `flat`. `flat` is the shared reference
  across both halves and the drift check.

Load average 3.6–3.9 during both runs.

## Results (`sdf:march` GPU ms, p50)

| scene | ship | walk only (A) | nonoise | walk only (B) | post-hit ship | post-hit nonoise | **noise cost** | drift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clean | 7.72 | 6.00 | 7.61 | 5.88 | 1.72 | 1.72 | **0.00** | −0.11 |
| 5 wounds | 17.82 | 14.11 | 18.43 | 14.76 | 3.71 | 3.67 | **0.03** | +0.65 |

Fenced frame p50: clean 10.74 ship / 8.68 flat; wounded 21.16 ship / 17.29 flat.
Raw rows: `posthit-split-room1-{clean,wounded}.json`.

## Reading

- Noise (about 9 fbm per hit, roughly 144 `hash13`) is lost in the noise floor. It
  runs once per hit pixel, after the walk, and the GPU hides it.
- Post-hit is 1.7 / 3.7 ms. That is the field re-evaluations (analytic normal
  gradient + detail, AO and scatter probes, wound soft shadow) plus lighting, not
  noise.
- The walk is the cost: 6.0 ms clean, **14.1 ms with 5 wounds**. Wounds add
  ~8 ms to the WALK, more than twice everything post-hit.
- Consequence for the Dreams spike: "bake the surface detail" (direction 1) is
  not a perf lever. Keep it only as a look tool (higher-frequency baked detail).
  Perf levers are the walk (wounds), the fixed floor, and hidden-pixel work
  (early-Z), not shading noise.
