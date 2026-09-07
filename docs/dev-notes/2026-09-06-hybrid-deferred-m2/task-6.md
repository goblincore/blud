# Task 6 — full gameplay GPU validation

The complete gate passed 34 checks with zero page errors and exit0. Canonical `game-validation.json` records `scope:full`, `pass:true`, and `fullAcceptance:true` for **Task6 only**.

Owner-approved gameplay roster: zombie, soldier and goblin. Clowns, other unused characters, lab/hair fixtures and retired polygonal bone tubes are excluded. Bone sphere culling remains separate work. All selected actors must spawn; no generic exception waiver.

## Reproduce

```sh
LAB_VITE_PORT=5346 LAB_CDP_PORT=9346 TASK6_DEADLINE_SEC=1200 bash scripts/deferred-game-check.sh
```

The wrapper starts private Vite/Chrome resources, enforces a deadline and cleans up owned processes. Run from this reviewed branch. Source, evidence and report are committed together after this run; historical core/diagnostic files do not substitute for canonical full evidence.

## Coverage

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
- PASS P3-gameplay-characters-rendered
- PASS P4-zombie-wounds
- PASS P5-two-shared-chunks
- PASS P5-bake-transition
- PASS P5-actor-rebuild
- PASS P5b-muzzle-vs-flashlight
- PASS P7b-css-cap-640
- PASS P8-default-legacy
- PASS P8-explicit-legacy

## Corrections and review

See `full-direct-review.md` for the exact-ID equipment/chunk checks, matched wound pixels, fresh lifecycle cast, scoped settled ballistic aiming, flashlight source control and normal-oracle corrections. TypeScript and driver syntax checks passed. Read-only review found no blocking issues in the corrections. This recovery changed diagnostic/test behavior; ordinary unscoped aim callers retain their behavior.

## Open visual defect and next stage

The owner correctly noticed flat zombies. `material-parity-review.md` and `material-legacy.png` / `material-deferred.png` confirm lost authored specular/Fresnel/wetness and display response; procedural normal detail is still computed. Deferred also omits legacy AO/scatter, and the held gun appears substantially darker. This is an unresolved Task7 visual regression. A functional pass does not accept materials or the complete migration.

Task7 must restore and review material appearance, finish shadow/effect scenarios and measurements, and run its required build/regression checks. Legacy remains default. No M2 integration into main or remote push is claimed here.
