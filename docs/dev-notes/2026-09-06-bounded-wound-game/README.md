# Bounded torso game preview

User approved the comparison's appearance on 2026-09-06. “Simplified” refers to bounded damage states and loss of arbitrary per-hit detail, not an intended visual downgrade.

Preview: http://localhost:5289/sdf-game.html?slug&bounded-wounds

Worktree: `.worktrees/raymarch-bounded-wounds`, branch `codex/raymarch-bounded-wounds`. Main's soldier polish (`909b6a87`) was merged into this worktree before adapting the actor. Nothing from this task has been merged back to main or pushed.

## Behavior

One torso region per actor uses the immutable shared sphere recipes. The first eligible torso impact anchors the region in its transported wound frame and retains its depth cap. Later torso hits advance intact/light/heavy through the existing 160 ms state machine. Heavy uses two cutters even after hundreds of hits. The game uploads the bounded analytic recipe through existing wound rows (negative upload-only type); it does not allocate an actor volume. Hard capped subtraction has a matching analytic gradient and conservative cusp fallback.

The original 16-entry wound ring still drives hits, recoil, sever decisions, blood and debug history. Non-torso hits, burns and explicitly recorded stumps use stock visual wounds; when the torso region exists they have a separate latest-14 visual budget. This can drop two old fallback visuals earlier than the gameplay ring. The first torso anchor stays fixed, including after a hit on another side of the torso. This is an intentionally coarse first region, not a front/back regional model.

Preview transitions advance independently of frozen motion. Moving and frozen hull exclusions use rendered cutter positions/radii, as does optional bone exposure. Actor recreation starts fresh. Uncapped rows are explicitly cleared during preview slot repacking to avoid inheriting a previous cutter's cap.

## Validation

- 255 focused tests passed across the preset, shader, actor and soldier suites; subsequently added cap-slot and paired sever regressions also passed (the final actor preview file has 5 tests). TypeScript and production build passed. Build emits the existing large-chunk advisory.
- `gradient-check.mjs`: six real WebGPU cases, 64 points each, capped/uncapped and mixed stock/preset wounds. Scalar/gradient-field distance error was zero; independent CPU hard-cut values agree within 1e-6. Valid analytic derivatives agree with GPU finite differences within 0.001075. Cusp samples retain numeric fallback. No GPU errors.
- `check.mjs`: actual frozen game capture, one hit then 20 more. One hit uploads one preset cutter. After 21 total hits the upload contains two cutters while gameplay history holds 16. Nonempty rendered body, no captured console errors. Screenshots inspected (`game-1.png`, `game-20.png`). An initial harness call used an obsolete API name; the saved successful report uses `setWoundTuning`.
- Independent scoped review found the stale-cap issue, then confirmed its explicit zero-cap fix and regression. No remaining blockers in that review.

## Limits

This is a DEV-only opt-in analytic game preview, not a default change or a completed migration of the old mutable cached-wound branch. The shared sampled atlas remains in `shared-wounds-probe.html`. Game transitions interpolate cutter radii; the probe interpolates endpoint fields, so intermediate shapes are not an equivalence benchmark. Settled recipes share the same content; the game additionally retains its first-hit slab cap and existing material/internal geometry.

Detached pieces keep their existing torn-end and worker-bake path. No torso preset state is transferred into a detached cached volume. The paired actor test covers sever decisions/notifications, not GPU bake/re-gib lifecycle.

The captures and helper checks establish correctness for these fixtures, not timing, broad ray convergence, or stable 30 fps. Representative combat, region coverage, sampled game integration and final production selection remain separate work.

Rerun with the worktree Vite server on 5289 and a CDP browser on 9225:

```sh
node docs/dev-notes/2026-09-06-bounded-wound-game/gradient-check.mjs
node docs/dev-notes/2026-09-06-bounded-wound-game/check.mjs
```
