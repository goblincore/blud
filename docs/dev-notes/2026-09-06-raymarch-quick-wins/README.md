# Raymarch quick edits — 2026-09-06

Base: `0a1906d0`. Scope: exclusive oriented primitive evaluation and early rejection of unsupported analytic normals. Wound shadows remain disabled; no default or marcher tolerance changes.

`foldGroup` selects `sdPrim` or `sdPrimO` once. `ngBody` exits after group work reports unsupported (reason 1), and `ngExcluded` stops scanning after discovering unsupported geometry. Numerical reasons retain the original traversal because a later unsupported contributor can supersede them. Production fallback and reason diagnostics are preserved. The isolated point probe may expose a different partial distance/owner for an invalid result; these are not used by production shading.

Validation:

- Baseline: 209 focused tests passed.
- Updated existing exclusive-evaluation assertion failed on the original code (198 passed / 1 failed), then passed after the edit.
- Final focused shader/reference suite: 238 tests passed; TypeScript passed.
- Real WebGPU: 48 fixtures × 64 points, cluster/tile traversal, listed/omitted and culled groups, oriented/unoriented primitives, supported shapes and unsupported geometry in each group position. Effective normals, scalar fields, dominant scalar owners, valid analytic results, and fallback reasons matched the baseline exactly (max delta 0).
- Instrumented group calls in first-group unsupported fixtures dropped from 192 to 64. Oriented primitive calls dropped from 384 to 192. These counters deliberately prevent dead-code elimination and establish source-level eliminated work only. The uninstrumented compiler may already remove discarded calculations; no frame-time benefit is claimed.
- Negative control replaced candidate helpers with the baseline and correctly failed the eliminated-work assertion.
- Independent scoped code review found no blockers; noted the invalid point-probe payload distinction above.

Run from the worktree with an owned Vite/Chrome lifecycle:

```sh
export LAB_VITE_PORT=5289 LAB_CDP_PORT=9289
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node docs/dev-notes/2026-09-06-raymarch-quick-wins/check.mjs
node docs/dev-notes/2026-09-06-raymarch-quick-wins/check.mjs --negative-control # expected failure
```

No gameplay FPS benchmark was run: the machine was busy with another dispatch. This is helper correctness evidence, not a representative combat benchmark or whole-renderer visual comparison.
