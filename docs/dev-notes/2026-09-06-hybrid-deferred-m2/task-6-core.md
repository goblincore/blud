# Task 6 — CORE scope GPU gate report (machine-generated)

- scope: `core` (TASK6_SCOPE=core)
- fullAcceptance: **false** — a core pass is NOT full Task 6 acceptance
- source commit: `9e359f7b01811afb6fbba62c2cc81b5e8f98d567`
- result: PASS (complete)
- failure: none
- excluded: experimental bone tubes, retired by owner; SDF bones and baked geometry remain in scope.
- generatedAt: 2026-09-07T17:53:16.826Z
- ports: vite 5336 / cdp 9336, viewport 800x600
- core coverage: P0 boot · P1 render-control + surface-hash invariance · P2 opaque routes · P6 exact depth/sentinel/present · P7a scale/resize
- remaining for full Task 6: P3 characters · P4 wounds · P5 sever/bake/rebuild · P5b muzzle · P7b CSS cap · P8 legacy boots (next continuation)

## Checks (25)

- PASS P0-boot-deferred
- PASS P1-render-control
- PASS P1-sampling-invariance
- PASS P1-gain-invariance
- PASS P1-beam-invariance
- PASS P1-generation-invariance
- PASS P1-marker-hidden-from-gbuffer
- PASS P2-route-level-mesh
- PASS P2-route-flesh-sdf
- PASS P2-route-fpv-gun
- PASS P2-sdf-bones-and-readback-parity
- PASS P2-route-forward-probe-nearer
- PASS P2-route-forward-probe-behind-occluded
- PASS P2-normal-direction-flesh
- PASS depth-bracket:wall-tight
- PASS depth-bracket:flesh
- PASS depth-bracket:gun
- PASS depth-bracket:far-deepest-real-scene
- PASS far-true-empty:redirect
- PASS depth-bracket:wall-null-path
- PASS depth-bracket:flesh-null-path
- PASS far-true-empty:null-path
- PASS P6-depth-summary
- PASS P7a-scale
- PASS P7a-resize

Evidence JSON: `game-validation-core.json` (same directory).

## Coordinator verification

The run exited **0**. The implementation was being committed while the gate finished: the source-commit line above records the then-current HEAD plus working-tree edits, finalized in `085f26f6ae6a93f9dfe31029a8c45a2e622f0249` (only comments differ from the loaded driver).

- TypeScript: `npx tsc --noEmit` passed.
- Focused readback/grid tests: 20/20 passed with at most two workers.
- Driver syntax and diff whitespace checks passed.
- CPU Three-camera fixtures verified WebGPU depth reconstruction and fixed screen footprint at four distances.
- Private Vite/Chrome cleanup completed; the wrapper exited 0.
- Resize-up image inspected: the game composes, with flesh, gun and room visible. Pale/bright flesh remains for Task 7's material/visual review; functional success does not establish look parity.

Raw execution log: `core-direct-validation.txt`.
